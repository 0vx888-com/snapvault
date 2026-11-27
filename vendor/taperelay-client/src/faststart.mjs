// TapeRelay 客户端库：上传前把 MP4、MOV、M4V、M4A 的目录（moov）挪到文件开头（2026-11-13）。
// 手机拍的视频常把 moov 放在文件末尾；边下边播时播放器得先取文件末尾那一段才能开始，远距离的线路上要多等十几秒。
// 挪到开头以后，开头那一块里就有目录，可以直接播。只改盒子的顺序，并把样本表里的块位置（stco、co64）照挪动的距离改过来，
// 音视频数据一个字节不动。拿不准的一律原样返回（已经在开头、分段的 MP4、压缩的 moov、带 iloc 的、位置超过 32 位放不下的、写坏的）。
// input：Blob（浏览器里的 File）或 Uint8Array；返回 { data（同样的类型）, moved（挪了没有） }。只读 moov 进内存，别的部分在 Blob 里照原样切片拼接。
import { u32, u64, boxAt, children } from './isobmff.mjs';

const MAX_TOP_BOXES = 4096;
const MAX_MOOV = 64 * 1048576;
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta']);

const isBlob = (x) => typeof Blob !== 'undefined' && x instanceof Blob;
const sizeOf = (x) => (isBlob(x) ? x.size : x.length);
async function bytesAt(x, a, b) { return isBlob(x) ? new Uint8Array(await x.slice(a, b).arrayBuffer()) : x.subarray(a, b); }

/** 文件顶层的盒子：[{ type, start, size }]；写坏了返回 null */
async function topBoxes(x) {
  const total = sizeOf(x), out = [];
  for (let p = 0; p < total;) {
    if (out.length >= MAX_TOP_BOXES || p + 8 > total) return null;
    const h = await bytesAt(x, p, Math.min(total, p + 16));
    const b = boxAt(h, 0, total - p);
    if (!b || p + b.size > total) return null;
    out.push({ type: b.type, start: p, size: b.size });
    p += b.size;
  }
  return out;
}

/** 把 moov 里每个 stco、co64 的块位置在 [from, to) 里的加 shift；碰到拿不准的盒子返回 false */
function patchMoov(m, from, to, shift) {
  let ok = true;
  const walk = (start, end) => {
    for (const c of children(m, start, end)) {
      if (!ok) return;
      if (c.type === 'cmov' || c.type === 'iloc' || c.type === 'saio' || c.type === 'mvex') { ok = false; return; }
      if (c.type === 'stco' || c.type === 'co64') {
        const n = u32(m, c.body + 4), wide = c.type === 'co64';
        if (c.body + 8 + n * (wide ? 8 : 4) > c.end) { ok = false; return; }
        for (let i = 0; i < n; i++) {
          const p = c.body + 8 + i * (wide ? 8 : 4);
          const v = wide ? u64(m, p) : u32(m, p);
          if (v < from || v >= to) continue;
          const nv = v + shift;
          if (!wide && nv > 0xffffffff) { ok = false; return; }
          if (wide) { const hi = Math.floor(nv / 2 ** 32), lo = nv % 2 ** 32; new DataView(m.buffer, m.byteOffset).setUint32(p, hi); new DataView(m.buffer, m.byteOffset).setUint32(p + 4, lo); }
          else new DataView(m.buffer, m.byteOffset).setUint32(p, nv);
        }
      } else if (CONTAINERS.has(c.type)) walk(c.body, c.end);
      else if (c.type === 'meta') {
        // meta 里有 iloc 时（图片序列等）位置写在别处，拿不准（MP4 的 meta 先有 4 字节的版本和标志，QuickTime 的没有，两种都看）
        if ([c.body, c.body + 4].some((s) => children(m, s, c.end).some((x) => x.type === 'iloc'))) { ok = false; return; }
      }
    }
  };
  const top = boxAt(m, 0);
  if (!top || top.type !== 'moov') return false;
  walk(top.body, top.end);
  return ok;
}

export async function faststart(input) {
  const same = { data: input, moved: false };
  try {
    const boxes = await topBoxes(input);
    if (!boxes) return same;
    if (boxes.some((b) => b.type === 'moof')) return same;                        // 已经分段的：本来就能边下边播
    const mi = boxes.findIndex((b) => b.type === 'moov'), di = boxes.findIndex((b) => b.type === 'mdat');
    if (mi < 0 || di < 0 || mi < di || boxes.filter((b) => b.type === 'moov').length !== 1) return same;
    const moov = boxes[mi];
    if (moov.size > MAX_MOOV) return same;
    const m = Uint8Array.from(await bytesAt(input, moov.start, moov.start + moov.size));
    // 原来是 [A][B…moov 之前][moov][C]，挪成 [A][moov][B][C]：B 里的位置都往后挪 moov 的大小，A、C 不动
    if (!patchMoov(m, boxes[di].start, moov.start, moov.size)) return same;
    const before = boxes.slice(0, di), middle = boxes.slice(di, mi), after = boxes.slice(mi + 1);
    const range = (list) => (list.length ? [list[0].start, list[list.length - 1].start + list[list.length - 1].size] : null);
    const parts = [];
    for (const r of [range(before), 'moov', range(middle), range(after)]) {
      if (r === 'moov') parts.push(m);
      else if (r) parts.push(isBlob(input) ? input.slice(r[0], r[1]) : input.subarray(r[0], r[1]));
    }
    if (isBlob(input)) return { data: new Blob(parts, { type: input.type }), moved: true };
    const out = new Uint8Array(input.length);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return { data: out, moved: true };
  } catch {
    return same;
  }
}
