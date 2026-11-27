// TapeRelay：清单和文件布局的规则（Files §3.1、Files §3、Files §5.5）。2026-10-12 由主编写窗口编写（CHANGELOG 第 113 条；I-094 第 3 点）。
// 不依赖任何库（浏览器、Service Worker、Node.js 都能直接用；只引同样不依赖任何库的 circuit.mjs）：客户端库（files.mjs、read.mjs）和网关
// （kernel-ext/src/relay-gateway.mjs）共用这一份，改规则只改这里。
import { isAccount } from './circuit.mjs';
// 有意不共用的：参考适配器（conformance/offline/reference-adapter.mjs）自己写一份，一致性测试要用独立写的实现，才查得出两边一起错的地方；
// 参考服务器的 Range（server/src/handlers.mjs）是 TapeRelay §6.2 读一个对象的，网关的 Range 是 TapeRelay §12.2 读一个文件的，各自一份。

export const CHUNK = 1048576;              // 公开文件的块大小（Files §3.1）
export const ENCRYPTED_CHUNK = 1048536;    // 加密文件每块的明文（Files §5.2：比 1 MiB 少 40 字节，加密后正好不超过 1 MiB）
export const FANOUT = 32766;               // 一个索引对象最多列的项数（Files §3，D-053）
export const MAX_MANIFEST = 16384;         // 清单最多 16 KiB（Files §3）
export const HEX64 = /^[0-9a-f]{64}$/;
const enc = new TextEncoder();

/**
 * 内容类型（Files §3，D-101）：照 TapeKit 内核的 safeContentType（kernel/src/path.js）：删掉英文字母、数字、下划线、空格和「. + / ; = -」以外的字符，
 * 只留前 100 个字符；开头不是「类型/子类型」的形式就按 application/octet-stream 处理。合进 TapeKit 时可以直接用内核的函数
 */
export function contentTypeOf(ct) {
  const s = String(ct || '').replace(/[^\w.+/;=\- ]/g, '').slice(0, 100);
  return /^[\w.+-]+\/[\w.+-]+/.test(s) ? s : 'application/octet-stream';
}

/** Files §3：{ n: 块数, levels: 层数, lower: 下层索引对象的个数 }；大小不是正整数或超过两层（v0.1 不支持）时返回 null */
export function layoutOf(size, chunkSize = CHUNK) {
  if (!Number.isSafeInteger(size) || size < 1) return null;
  const n = Math.ceil(size / chunkSize);
  if (n <= FANOUT) return { n, levels: 1, lower: 0 };
  if (n <= FANOUT * FANOUT) return { n, levels: 2, lower: Math.ceil(n / FANOUT) };
  return null;
}

/**
 * 读清单（Files §3；加密文件的清单 Files §5.5 字段相同，只是 chunkSize 为 1,048,536，另**必须**有合法的 from，第 150 条按第 148 条的规范补上）：按各字段的要求检查，未知字段忽略。
 * 返回 { manifest } 或 { error }：manifest 只含本版定义的字段，内容类型已按 contentTypeOf 处理；error 是一句说明。
 */
export function checkManifest(text) {
  if (typeof text !== 'string' || enc.encode(text).length > MAX_MANIFEST) return { error: '清单超过 16 KiB' };
  let m;
  try { m = JSON.parse(text); } catch { return { error: '清单不是合法的 JSON' }; }
  const chunkSize = m?.type === 'public' ? CHUNK : m?.type === 'encrypted' ? ENCRYPTED_CHUNK : null;
  const ok = m && typeof m === 'object' && m.version === 1 && chunkSize !== null && m.chunkSize === chunkSize && Number.isSafeInteger(m.size) && m.size >= 1
    && typeof m.name === 'string' && typeof m.contentType === 'string' && typeof m.index === 'string' && HEX64.test(m.index)
    && (m.sha256 === undefined || (typeof m.sha256 === 'string' && HEX64.test(m.sha256)));
  if (!ok) return { error: '清单不合格（Files §3）' };
  if (m.type === 'encrypted' && !isAccount(m.from)) return { error: '加密的清单缺 from，或 from 不是电路的规范名字（Files §5.5）' };
  if (!layoutOf(m.size, chunkSize)) return { error: 'v0.1 不支持这么大的文件（Files §3）' };
  const manifest = { version: 1, type: m.type, name: m.name, contentType: contentTypeOf(m.contentType), size: m.size, chunkSize, index: m.index };
  if (m.sha256 !== undefined) manifest.sha256 = m.sha256;
  if (m.type === 'encrypted') manifest.from = m.from;
  return { manifest };
}
