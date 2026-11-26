// TapeRelay 客户端库：边解密边存盘的下载（前端第 3 步，D-682；docs/FRONTENDS-DESIGN.md 第二节「默认播放器」）。2026-11-08 由编写窗口
// 照调查二第 4 节编写。原来「下载」先把整个文件读进内存再存（256 MiB 的文件 Chrome 多占约 644 MiB）；容器网站装不了 Service Worker，
// StreamSaver 那种办法用不了。按下面的先后，能用哪一档用哪一档（saveFile）：
// 1. 「另存为」对话框（showSaveFilePicker，Chrome、Edge 的电脑版）：逐块写进用户选的文件；必须在点击的处理函数里、任何网络等待之前打开
//    （所以 saveFile 要在点击里同步调用，它第一件事就是开对话框）；用户取消回 cancelled；
// 2. 浏览器的私有文件区（OPFS：Firefox 111 起、安卓 Chrome、Safari 新版）：逐块写进一个临时文件，再交给 <a download>，内存只占约一块；
//    先查剩余空间（要约 2 倍文件大小：临时文件 + 下载出来的那份）；临时文件名以 taperelay-dl- 开头，下次打开页面时清掉（cleanupTempDownloads）；
// 3. 上限（memoryMax，默认 200 MiB）以内：整个放进内存再存；
// 4. 再大：抛 too-large-to-save（页面提示「换电脑上的 Chrome 或 Edge」）。
// 每一档都边写边算整个文件的 SHA-256：清单里有 sha256 的，对不上就停下（file-hash-mismatch），对话框写的文件 abort()、临时文件删掉、内存里的不存，
// 不留半个文件。每一块本身在 read 里已经核对过哈希、解开过。TapeKit 预览查看器、扩展模式的沙盒框里下载一概用不了（报给 TapeKit 团队，SPEC-PENDING 第 48 条）。
// f：{ manifest: { size, sha256? }, read(a, b) }（openEncryptedFileWithKey 给的）。不存任何钥匙。
import { sha256 } from '@noble/hashes/sha2.js';
import { ENCRYPTED_CHUNK } from './manifest.mjs';

export const SAVE_MEMORY_MAX = 200 * 1048576;
export const TEMP_PREFIX = 'taperelay-dl-';
const coded = (code, message) => Object.assign(new Error(message), { code });
const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** 下载用的文件名：去掉控制字符和格式控制字符、路径分隔符和 Windows 不许的字符，最多 120 个字符；空的叫 file */
export const safeFileName = (name) => [...String(name ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '')].slice(0, 120).join('').replace(/[\\/:*?"<>|]/g, '_') || 'file';

/** 把一个 Blob（或磁盘上的 File）交给浏览器下载（不在页面里打开） */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = safeFileName(name);
  a.href = url;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** 逐块读、交给 sink(bytes)，边读边算 SHA-256；下一块和这一块的写同时进行。读完核对清单的 sha256（有的话） */
async function pump(f, sink, onProgress) {
  const total = f.manifest.size;
  const whole = sha256.create();
  const at = (i) => Math.min(total, i * ENCRYPTED_CHUNK);
  const n = Math.ceil(total / ENCRYPTED_CHUNK);
  let next = n ? f.read(0, at(1)) : null;
  for (let i = 0; i < n; i++) {
    const bytes = await next;
    next = i + 1 < n ? f.read(at(i + 1), at(i + 2)) : null;
    next?.catch(() => {});                                         // 出错时由下一轮的 await 报，这里免得「没人接」的警告
    whole.update(bytes);
    await sink(bytes);
    onProgress?.(at(i + 1), total);
  }
  if (f.manifest.sha256 && hexOf(whole.digest()) !== f.manifest.sha256) throw coded('file-hash-mismatch', '整个文件的 SHA-256 与清单不符');
}

/** 私有文件区（OPFS）里能不能逐块写（主线程的 createWritable） */
const opfsWritable = () => typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
  && typeof globalThis.FileSystemFileHandle === 'function' && 'createWritable' in globalThis.FileSystemFileHandle.prototype;

/** 清掉以前下载留下的临时文件（OPFS 里以 taperelay-dl- 开头、超过 maxAgeMs 没动过的）；用不了 OPFS 的什么也不做 */
export async function cleanupTempDownloads(maxAgeMs = 10 * 60000) {
  if (!opfsWritable()) return 0;
  let n = 0;
  try {
    const root = await navigator.storage.getDirectory();
    for await (const [name, h] of root.entries()) {
      if (!name.startsWith(TEMP_PREFIX) || h.kind !== 'file') continue;
      const file = await h.getFile();
      if (Date.now() - file.lastModified > maxAgeMs) { await root.removeEntry(name); n++; }
    }
  } catch { /* 清不了不要紧，下次再清 */ }
  return n;
}

/**
 * 下载 f（照文件开头说的先后）。要在点击的处理函数里同步调用（第一件事是开「另存为」对话框，之前不能有网络等待）。
 * name：建议的文件名；memoryMax：整个放进内存的上限；onProgress(done, total, how)；tiers：用哪几档（默认 picker、opfs、memory 都用；测试用来只试某一档）。
 * 返回 Promise<{ how: 'picker' | 'opfs' | 'memory' | 'cancelled' }>；存不了抛 too-large-to-save，核对不过抛 file-hash-mismatch（不留文件）
 */
export function saveFile(f, { name, memoryMax = SAVE_MEMORY_MAX, onProgress, tiers = ['picker', 'opfs', 'memory'] } = {}) {
  const total = f.manifest.size;
  let pick = null;
  if (tiers.includes('picker') && typeof globalThis.showSaveFilePicker === 'function') {
    try { pick = globalThis.showSaveFilePicker({ suggestedName: safeFileName(name) }); } catch (e) { pick = Promise.reject(e); }
    pick.catch(() => {});
  }
  return (async () => {
    if (pick) {
      let handle = null;
      try { handle = await pick; } catch (e) { if (e?.name === 'AbortError') return { how: 'cancelled' }; }   // 沙盒、没有权限：退到下一档
      if (handle) {
        const w = await handle.createWritable();
        try { await pump(f, (b) => w.write(b), (d, t) => onProgress?.(d, t, 'picker')); await w.close(); } catch (e) { await w.abort().catch(() => {}); throw e; }
        return { how: 'picker' };
      }
    }
    if (tiers.includes('opfs') && opfsWritable()) {
      let root = null, free = 0;
      try { root = await navigator.storage.getDirectory(); const e = await navigator.storage.estimate(); free = (e.quota ?? 0) - (e.usage ?? 0); } catch { root = null; }
      if (root && free > total * 2.1 + 16 * 1048576) {
        const tmp = `${TEMP_PREFIX}${Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => x.toString(16).padStart(2, '0')).join('')}`;
        let w = null;
        try {
          const fh = await root.getFileHandle(tmp, { create: true });
          w = await fh.createWritable();
          await pump(f, (b) => w.write(b), (d, t) => onProgress?.(d, t, 'opfs'));
          await w.close();
          w = null;
          downloadBlob(await fh.getFile(), name);                      // 磁盘上的文件，不占内存；临时文件下次打开时清掉
          return { how: 'opfs' };
        } catch (e) {
          await w?.abort().catch(() => {});
          await root.removeEntry(tmp).catch(() => {});
          if (e?.code) throw e;                                          // 读不到、核对不过：照实报
          // 写不进私有文件区（例如沙盒框、隐身模式）：退到下一档
        }
      }
    }
    if (!tiers.includes('memory') || total > memoryMax) throw coded('too-large-to-save', '这个浏览器存不了这么大的文件');
    const parts = [];
    await pump(f, (b) => { parts.push(b); }, (d, t) => onProgress?.(d, t, 'memory'));
    downloadBlob(new Blob(parts, { type: 'application/octet-stream' }), name);
    return { how: 'memory' };
  })();
}
