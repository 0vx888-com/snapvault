// TapeRelay 客户端库：WebM（Matroska）边下边播用的读法（前端第 3 步，D-682；docs/FRONTENDS-DESIGN.md 第二节「默认播放器」）。
// 2026-11-08 由编写窗口照调查二的原型（本次任务 tmp/spike-player/www/webm.mjs）改写。WebM 本来就能直接喂给 MediaSource，这里只管：
// - 头（parseWebmHead）：到第一个 Cluster 为止的字节就是初始化段；编码（MediaSource 的类型串）、时间单位、总长、Cues（索引）在哪；
// - Cues（parseCues）：时间 → Cluster 的位置；有它就不用试探；
// - 没有 Cues 时调用方二分：clusterIn 在一段字节里找下一个 Cluster 和它的时间；lastTimeIn 从文件尾算总长（MediaRecorder 录的没写总长）。
// 读到的字节都是调用方核对、解密过的；写坏的文件只会抛错或返回 null，不越界读。只是函数，不碰网络、不碰页面。

const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPos: 0x53ac, Info: 0x1549a966, TimecodeScale: 0x2ad7b1,
  Duration: 0x4489, Tracks: 0x1654ae6b, TrackEntry: 0xae, CodecID: 0x86, Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueClusterPosition: 0xf1 };
// Matroska 的编码名 → MediaSource 的编码串（WebM 里 Chrome、Firefox 认这几种；MKV 里的 H.264 等 MediaSource 不收，调用方退回别的办法）
const CODECS = { V_VP9: 'vp9', V_VP8: 'vp8', V_AV1: 'av01.0.04M.08', A_OPUS: 'opus', A_VORBIS: 'vorbis' };
const bad = (message) => { throw Object.assign(new Error(message), { code: 'bad-media' }); };

/** 大小（去掉长度标记）；所有值位都是 1 是「不知道多长」 */
function vint(b, p) {
  const first = b[p];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (!(first & (0x80 >> (len - 1)))) len++;
  if (p + len > b.length) return null;
  let v = first & (0xff >> len);
  for (let i = 1; i < len; i++) v = v * 256 + b[p + i];
  return { v, len, unknown: v === 2 ** (7 * len) - 1 };
}
/** 元素的编号（留着长度标记） */
function id(b, p) {
  const first = b[p];
  if (first === undefined || first < 0x10) return null;
  let len = 1;
  while (!(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || p + len > b.length) return null;
  let v = first;
  for (let i = 1; i < len; i++) v = v * 256 + b[p + i];
  return { v, len };
}
function el(b, p) {
  const i = id(b, p);
  if (!i) return null;
  const s = vint(b, p + i.len);
  if (!s) return null;
  const body = p + i.len + s.len;
  return { id: i.v, start: p, body, end: s.unknown ? Infinity : body + s.v, unknown: s.unknown };
}
const uint = (b, x) => { let v = 0; for (let p = x.body; p < x.end && p < x.body + 8; p++) v = v * 256 + b[p]; return v; };
const float = (b, x) => { const n = x.end - x.body; if (n !== 4 && n !== 8) return null; const dv = new DataView(b.buffer, b.byteOffset + x.body, n); return n === 4 ? dv.getFloat32(0) : dv.getFloat64(0); };
function kids(b, start, end) {
  const out = [];
  for (let p = start; p < Math.min(end, b.length);) { const x = el(b, p); if (!x || x.end > b.length) break; out.push(x); p = x.end; }
  return out;
}

/**
 * b：文件开头的一段字节（够到第一个 Cluster）。返回 { initEnd, segmentBody, mime, timecodeScale, duration（秒，没写是 null）, cuesAt（文件里的位置，没有是 null） }；
 * b 不够长时返回 { need（至少要多少字节） }。不是 WebM 抛错（bad-media）
 */
export function parseWebmHead(b) {
  const ebml = el(b, 0);
  if (!ebml || ebml.id !== ID.EBML) bad('不是 WebM');
  if (ebml.end > b.length) return { need: ebml.end + 64 };
  const seg = el(b, ebml.end);
  if (!seg) return { need: ebml.end + 64 };
  if (seg.id !== ID.Segment) bad('WebM 里没有 Segment');
  let scale = 1e6, duration = null, hasVideo = false, cuesAt = null;
  const codecs = [];
  for (let p = seg.body; ;) {
    const x = el(b, p);
    if (!x) return { need: p + 64 };
    if (x.id === ID.Cluster) {
      const mime = codecs.length && codecs.every((c) => Object.values(CODECS).includes(c)) ? `${hasVideo ? 'video' : 'audio'}/webm; codecs="${codecs.join(',')}"` : null;
      return { initEnd: p, segmentBody: seg.body, mime, timecodeScale: scale, duration: duration === null ? null : (duration * scale) / 1e9, cuesAt };
    }
    if (x.unknown) bad('WebM 的头里有不知道多长的元素');
    if (x.end > b.length) return { need: x.end + 64 };
    if (x.id === ID.Info) for (const k of kids(b, x.body, x.end)) { if (k.id === ID.TimecodeScale) scale = uint(b, k) || 1e6; if (k.id === ID.Duration) duration = float(b, k); }
    if (x.id === ID.Tracks) for (const t of kids(b, x.body, x.end).filter((k) => k.id === ID.TrackEntry)) {
      const c = kids(b, t.body, t.end).find((k) => k.id === ID.CodecID);
      const name = c ? new TextDecoder().decode(b.subarray(c.body, c.end)) : '';
      if (name.startsWith('V_')) hasVideo = true;
      codecs.push(CODECS[name] ?? name);
    }
    if (x.id === ID.SeekHead) for (const s of kids(b, x.body, x.end).filter((k) => k.id === ID.Seek)) {
      const ks = kids(b, s.body, s.end), sid = ks.find((k) => k.id === ID.SeekID), pos = ks.find((k) => k.id === ID.SeekPos);
      if (sid && pos && uint(b, sid) === ID.Cues) cuesAt = seg.body + uint(b, pos);
    }
    p = x.end;
  }
}

/** Cues 元素头（b 从 Cues 的开头起，至少 16 字节）→ 整个元素要多少字节；不是 Cues 返回 null */
export function cuesSize(b) {
  const x = el(b, 0);
  return x && x.id === ID.Cues && !x.unknown ? x.end : null;
}

/** 整个 Cues 元素（b 从它的开头起）→ [{ time（秒）, offset（Cluster 在文件里的位置） }]，按时间排好；segmentBody：Segment 内容的开头 */
export function parseCues(b, segmentBody, scale = 1e6) {
  const x = el(b, 0);
  if (!x || x.id !== ID.Cues || x.end > b.length) return null;
  const out = [];
  for (const cp of kids(b, x.body, x.end).filter((k) => k.id === ID.CuePoint)) {
    const ks = kids(b, cp.body, cp.end), t = ks.find((k) => k.id === ID.CueTime), pos = ks.find((k) => k.id === ID.CueTrackPositions);
    const cl = pos ? kids(b, pos.body, pos.end).find((k) => k.id === ID.CueClusterPosition) : null;
    if (t && cl) out.push({ time: (uint(b, t) * scale) / 1e9, offset: segmentBody + uint(b, cl) });
  }
  out.sort((a, c) => a.time - c.time);
  return out.length ? out : null;
}

/** 一段字节 w（文件里从 base 起）里的下一个 Cluster：{ start（文件里的位置）, time（秒） }；没有返回 null */
export function clusterIn(w, base, scale = 1e6) {
  for (let i = 0; i + 8 < w.length; i++) {
    if (w[i] !== 0x1f || w[i + 1] !== 0x43 || w[i + 2] !== 0xb6 || w[i + 3] !== 0x75) continue;
    const s = vint(w, i + 4);
    if (!s) continue;
    const tc = el(w, i + 4 + s.len);
    if (!tc || tc.id !== ID.Timecode || tc.end > w.length) continue;
    return { start: base + i, time: (uint(w, tc) * scale) / 1e9 };
  }
  return null;
}

/** 文件尾的一段字节 w：最后一个 Cluster 的时间 + 它里面最大的块偏移（秒）；找不到返回 null */
export function lastTimeIn(w, scale = 1e6) {
  let last = null;
  for (let i = 0; i + 8 < w.length;) { const c = clusterIn(w.subarray(i), i, scale); if (!c) break; last = c; i = c.start + 4; }
  if (!last) return null;
  const ci = el(w, last.start);
  let maxRel = 0;
  for (const x of kids(w, ci.body, ci.unknown ? w.length : Math.min(ci.end, w.length))) {
    if (x.id === ID.Cluster) break;
    const blk = x.id === ID.SimpleBlock ? x : x.id === ID.BlockGroup ? kids(w, x.body, x.end).find((k) => k.id === ID.Block) : null;
    if (!blk || blk.end > w.length) continue;
    const tn = vint(w, blk.body);
    if (!tn) continue;
    const rel = (((w[blk.body + tn.len] << 8) | w[blk.body + tn.len + 1]) << 16) >> 16;
    maxRel = Math.max(maxRel, rel);
  }
  return last.time + (maxRel * scale) / 1e9;
}
