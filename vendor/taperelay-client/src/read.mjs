// TapeRelay 客户端库：读取（TapeRelay §6.2、TapeRelay §7.2；用例 C7）。2026-10-11 由主编写窗口编写（CHANGELOG 第 90 条）。
// - 每个对象都核对 SHA-256；一台服务器读不到（404、451、连不上、限流）或核对不过，就换下一台（TapeRelay §6.2、TapeRelay §7.2 第 3 步）；
// - 索引对象核对哈希和长度（Files §3）；每一块核对哈希和长度（Files §3.6 第 3、4 步）；
// - 只读一部分时，只取用到的下层索引对象和块；读完整个文件、清单里又有 sha256 时，再核对整个文件（Files §3.6 第 5 步）。
import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from './core.mjs';
import { layout } from './files.mjs';
import { CHUNK, FANOUT } from './manifest.mjs';
import { TapeRelayError } from './client.mjs';

/** 按顺序问各台服务器，返回第一个读得到、核对通过的对象的字节；都不行时抛出最后一个错误。opts 原样交给 client.getObject（例如 maxBytes） */
export async function readObject(client, servers, sha, opts) {
  let last = null;
  for (const name of servers) {
    try { return await client.getObject(name, sha, opts); } catch (e) { last = e; }
  }
  throw last ?? new TapeRelayError('not-found');
}

const hashesIn = (bytes) => Array.from({ length: bytes.length / 32 }, (_, i) => hex(bytes.subarray(i * 32, i * 32 + 32)));

/**
 * 按清单读文件的 [start, end) 字节（默认整个文件）。servers：发现文件列出的服务器名字，按偏好排序。
 * 返回 Uint8Array。读的是整个文件、清单里有 sha256 时，核对不符就抛错。
 */
export async function readFile(client, servers, manifest, { start = 0, end = manifest.size } = {}) {
  const { n, levels, lower } = layout(manifest.size, manifest.chunkSize);
  if (!(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end <= manifest.size && start < end)) throw new Error('读取的范围不对');
  const top = await readObject(client, servers, manifest.index);
  if (top.length !== 32 * (levels === 1 ? n : lower)) throw new Error('顶层索引对象的长度不对（Files §3）');
  const topHashes = hashesIn(top);
  const lowerCache = new Map();
  async function chunkHash(i) {
    if (levels === 1) return topHashes[i];
    const j = Math.floor(i / FANOUT);
    if (!lowerCache.has(j)) {
      const b = await readObject(client, servers, topHashes[j]);
      const want = Math.min(FANOUT, n - j * FANOUT);
      if (b.length !== 32 * want) throw new Error(`第 ${j} 个下层索引对象的长度不对（Files §3）`);
      lowerCache.set(j, hashesIn(b));
    }
    return lowerCache.get(j)[i - j * FANOUT];
  }
  const first = Math.floor(start / CHUNK), last = Math.floor((end - 1) / CHUNK);
  const out = new Uint8Array(end - start);
  let o = 0;
  for (let i = first; i <= last; i++) {
    const bytes = await readObject(client, servers, await chunkHash(i));
    const want = i < n - 1 ? CHUNK : manifest.size - (n - 1) * CHUNK;
    if (bytes.length !== want) throw new Error(`第 ${i} 块的长度不对（Files §3.6 第 4 步）`);
    const part = bytes.subarray(i === first ? start - i * CHUNK : 0, i === last ? end - i * CHUNK : bytes.length);
    out.set(part, o);
    o += part.length;
  }
  if (start === 0 && end === manifest.size && manifest.sha256 && hex(sha256(out)) !== manifest.sha256) throw new Error('整个文件的 SHA-256 与清单不符（Files §3.6 第 5 步）');
  return out;
}
