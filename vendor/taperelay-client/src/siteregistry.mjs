// TapeRelay 客户端库：把发现文件（TapeRelay §4）、公开文件的清单（TapeRelay §7.1）写到容器的链上网站（TapeKit 的 SiteRegistry，TapeKit SPEC 附录 B.5）。
// 2026-10-11 由主编写窗口编写（CHANGELOG 第 90 条）。
// - 分块写：第一块 putFile，之后每块 appendChunk（expectIndex 等于当前块数，防止重复追加）；每块最多 24,000 字节，最多 350 块；
// - 写到一半能接着写：链上已有同一份内容（声明的 SHA-256、内容类型相同）的前几块时，从下一块接着追加，不重写；
// - 写完读回核对：fileInfo 的大小、哈希、块数都对，再把链上的字节读回来算 SHA-256。
// chain：{ call({ to, data }) → 返回数据（0x 开头的十六进制）, send({ to, data }) → 等交易确认后返回，失败抛错 }。
//   浏览器里由钱包发交易；发主网交易之前，调用方必须逐笔给用户看摘要、等用户确认（安全规则 6）。这里不碰私钥。
// ABI 的编解码用 TapeKit 内核的 abi.js（只引用，不改 TapeKit，D-090）。
// 2026-11-08（前端第 2 步，D-692）：加单页回退 fallbackPath / setFallback（TapeKit SPEC 附录 B.5）：容器网站里没有扩展名的路径
// （例如分享链接 /f/<电路名>/<指纹>）落回这个文件。setFallback 的选择器照规范里的签名算，上主网前要和真合约核对。
import { encodeCall, decodeResult, bytesToHex } from '../vendor/tapekit-kernel/abi.js';
import { sha256Hex, selectorOf } from './core.mjs';

export const SITE_CHUNK = 24000;
export const SITE_MAX_CHUNKS = 350;
const READ_RANGE = 96000;                     // 超过 96 KB 用 readRange 分段读（TapeKit SPEC 附录 B.5）
const sel = selectorOf;
export const SELECTORS = Object.freeze({
  putFile: sel('putFile(address,string,string,bytes32,bytes)'),
  appendChunk: sel('appendChunk(address,string,uint256,bytes)'),
  fileInfo: sel('fileInfo(address,string)'),
  read: sel('read(address,string)'),
  readRange: sel('readRange(address,string,uint256,uint256)'),
  fallbackPath: sel('fallbackPath(address)'),
  setFallback: sel('setFallback(address,string)'),      // 照 TapeKit SPEC 附录 B.5 的签名算：上主网前要和真合约核对
});

/** 容器网站的单页回退路径（没设是 ''） */
export async function fallbackPath(chain, registry, container) {
  const [p] = decodeResult(['string'], await chain.call({ to: registry, data: encodeCall(SELECTORS.fallbackPath, ['address'], [container]) }));
  return p;
}

/** 设单页回退路径（一笔交易；path 要是网站里有的文件，例如 index.html） */
export async function setFallback({ chain, registry, container, path }) {
  await chain.send({ to: registry, data: encodeCall(SELECTORS.setFallback, ['address', 'string'], [container, path]) });
}

/** fileInfo：{ size, contentType, sha256（不带 0x）, updatedAt, chunkCount }；chunkCount 为 0 表示没有这个文件 */
export async function fileInfo(chain, registry, container, path) {
  const out = await chain.call({ to: registry, data: encodeCall(SELECTORS.fileInfo, ['address', 'string'], [container, path]) });
  const [size, contentType, sha, updatedAt, chunkCount] = decodeResult(['uint', 'string', 'bytes32', 'uint', 'uint'], out);
  return { size: Number(size), contentType, sha256: sha.slice(2), updatedAt: Number(updatedAt), chunkCount: Number(chunkCount) };
}

/** 读回链上文件的全部字节 */
export async function readSiteFile(chain, registry, container, path, size) {
  if (size <= READ_RANGE) {
    const [b] = decodeResult(['bytes'], await chain.call({ to: registry, data: encodeCall(SELECTORS.read, ['address', 'string'], [container, path]) }));
    return b;
  }
  const out = new Uint8Array(size);
  for (let o = 0; o < size; o += READ_RANGE) {
    const [b] = decodeResult(['bytes'], await chain.call({ to: registry, data: encodeCall(SELECTORS.readRange, ['address', 'string', 'uint256', 'uint256'], [container, path, o, READ_RANGE]) }));
    out.set(b.subarray(0, Math.min(b.length, size - o)), o);
  }
  return out;
}

/**
 * 写一个链上文件。container：容器地址（0x…，由电路名字经内核算出；不是协议里的身份）；bytes：文件内容；contentType：例如 application/json。
 * 返回 { written（这次发的交易数）, sha256 }；读回核对不符时抛错。onProgress({ done, total })：每发完一笔调用一次。
 */
export async function writeSiteFile({ chain, registry, container, path, contentType, bytes, onProgress }) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > SITE_CHUNK * SITE_MAX_CHUNKS) throw new Error('链上文件的大小要在 1～8,400,000 字节之间');
  const sha = sha256Hex(bytes);
  const total = Math.ceil(bytes.length / SITE_CHUNK);
  const chunkAt = (i) => bytesToHex(bytes.subarray(i * SITE_CHUNK, (i + 1) * SITE_CHUNK));
  const info = await fileInfo(chain, registry, container, path);
  // 接着写的条件：声明的哈希和内容类型相同，已有的块数不超过要写的，已有的大小正好是这些块的大小
  const resumable = info.chunkCount > 0 && info.sha256 === sha && info.contentType === contentType && info.chunkCount <= total
    && info.size === Math.min(bytes.length, info.chunkCount * SITE_CHUNK);
  let next = resumable ? info.chunkCount : 0;
  let written = 0;
  if (next === 0) {
    await chain.send({ to: registry, data: encodeCall(SELECTORS.putFile, ['address', 'string', 'string', 'bytes32', 'bytes'], [container, path, contentType, `0x${sha}`, chunkAt(0)]) });
    written++;
    next = 1;
    onProgress?.({ done: next, total });
  }
  for (let i = next; i < total; i++) {
    await chain.send({ to: registry, data: encodeCall(SELECTORS.appendChunk, ['address', 'string', 'uint256', 'bytes'], [container, path, i, chunkAt(i)]) });
    written++;
    onProgress?.({ done: i + 1, total });
  }
  const after = await fileInfo(chain, registry, container, path);
  if (after.size !== bytes.length || after.sha256 !== sha || after.chunkCount !== total || after.contentType !== contentType) throw new Error('写完后链上的文件信息与要写的不符');
  if (sha256Hex(await readSiteFile(chain, registry, container, path, after.size)) !== sha) throw new Error('写完后读回的内容与要写的不符');
  return { written, sha256: sha };
}
