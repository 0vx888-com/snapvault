// TapeRelay 客户端库：公开文件的切块、索引对象和清单（Files §3.1、Files §3）。2026-10-11 由主编写窗口编写（CHANGELOG 第 90 条）。
// 文件可以是 Uint8Array，也可以是浏览器的 File / Blob（按块读，不一次读进内存）。
// 第 113 条（I-094 第 3 点）：块大小、层数、内容类型和读清单的规则移到 manifest.mjs（不依赖任何库），网关也用它（2026-11-07 D-640 起这里不再转出那几个名字）。
// 2026-10-22（UTC+8，D-344）：withManifest 时清单对象也放进计划（extraObjects，最后传），清单对象也存在服务器上、记在电路名下（按清单读的人从服务器上拿得到它）。
import { sha256 } from '@noble/hashes/sha2.js';
import { hex, fromHex, concat, sha256Hex, utf8 } from './core.mjs';
import { CHUNK, FANOUT, MAX_MANIFEST, contentTypeOf, layoutOf, checkManifest } from './manifest.mjs';

/** Files §3：块数、层数、下层索引对象的个数（manifest.mjs 的 layoutOf）；v0.1 不支持的大小抛错 */
export function layout(size, chunkSize = CHUNK) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('文件大小至少 1 字节');
  const l = layoutOf(size, chunkSize);
  if (!l) throw new Error('v0.1 不支持这么大的文件（Files §3）');
  return l;
}

/** Uint8Array 或 Blob → { size, read(a, b) } */
export function sourceOf(x) {
  if (x instanceof Uint8Array) return { size: x.length, read: async (a, b) => x.subarray(a, b) };
  if (x && typeof x.size === 'number' && typeof x.slice === 'function') return { size: x.size, read: async (a, b) => new Uint8Array(await x.slice(a, b).arrayBuffer()) };
  throw new Error('文件要是 Uint8Array 或 Blob');
}

/**
 * 按 Files §3.1、Files §3 算出一个公开文件要上传的全部对象：各块的哈希、索引对象（顶层在第一个）、清单和文件的标识。
 * 块的字节不留在内存里，上传时再按序号从文件读（uploadFile）。wholeSha256：是否在清单里写整个文件的 SHA-256（可选）。
 * withManifest：清单对象（清单 JSON 的 UTF-8 字节，D-119）也要上传：放进 extraObjects，另给 manifestObject: { bytes, sha256 }。
 */
export async function planPublicFile(input, { name = '', contentType = 'application/octet-stream', wholeSha256 = false, withManifest = false } = {}) {
  const source = sourceOf(input);
  const { n, levels, lower } = layout(source.size);
  const chunkHashes = [];
  const whole = wholeSha256 ? sha256.create() : null;
  for (let i = 0; i < n; i++) {
    const bytes = await source.read(i * CHUNK, Math.min(source.size, (i + 1) * CHUNK));
    chunkHashes.push(sha256Hex(bytes));
    whole?.update(bytes);
  }
  const indexObjects = indexObjectsOf(chunkHashes, { levels, lower });
  const fileId = indexObjects[0].sha256;
  const manifest = { version: 1, type: 'public', name: String(name), contentType: contentTypeOf(contentType), size: source.size, chunkSize: CHUNK, index: fileId };
  if (whole) manifest.sha256 = hex(whole.digest());
  const manifestJson = JSON.stringify(manifest);
  const manifestBytes = utf8(manifestJson);
  if (manifestBytes.length > MAX_MANIFEST) throw new Error('清单超过 16 KiB（文件名太长？）');
  if (!withManifest) return { source, chunkHashes, indexObjects, manifest, manifestJson, fileId };
  const manifestObject = { bytes: manifestBytes, sha256: sha256Hex(manifestBytes) };
  return { source, chunkHashes, indexObjects, manifest, manifestJson, fileId, manifestObject, extraObjects: [manifestObject] };
}

/** Files §3：由各块的哈希拼出索引对象；顶层在第一个，两层时后面依次是各下层索引对象。每项 { bytes, sha256, level, position } */
export function indexObjectsOf(chunkHashes, { levels, lower } = layout(chunkHashes.length, 1)) {
  if (levels === 1) { const bytes = concat(...chunkHashes.map(fromHex)); return [{ bytes, sha256: sha256Hex(bytes), level: 0, position: 0 }]; }
  const lowers = [];
  for (let j = 0; j < lower; j++) {
    const bytes = concat(...chunkHashes.slice(j * FANOUT, (j + 1) * FANOUT).map(fromHex));
    lowers.push({ bytes, sha256: sha256Hex(bytes), level: 1, position: j });
  }
  const top = concat(...lowers.map((l) => fromHex(l.sha256)));
  return [{ bytes: top, sha256: sha256Hex(top), level: 0, position: 0 }, ...lowers];
}

/** 读公开文件的清单（Files §3；规则在 manifest.mjs 的 checkManifest）：不合格或不是公开文件抛错；未知字段忽略，只返回本版定义的字段 */
export function parseManifest(text) {
  const { manifest, error } = checkManifest(text);
  if (error) throw new Error(error);
  if (manifest.type !== 'public') throw new Error('清单不合格（Files §3）');     // 加密文件的清单（Files §5.5）第 3 阶段再接
  return manifest;
}
