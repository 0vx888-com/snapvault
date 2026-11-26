// TapeRelay 客户端库：不用 Service Worker 的边下边播（前端第 3 步，D-682；docs/FRONTENDS-DESIGN.md 第二节「默认播放器」）。
// 2026-11-08 由编写窗口照调查二的原型（本次任务 tmp/spike-player/www/player.mjs）改写。容器网站的 /sw.js 归 TapeKit 网关，页面装不了自己的
// Service Worker，所以改用 MediaSource（Safari 是 ManagedMediaSource）：页面自己按需读、核对、解密，一段一段喂给 <video>/<audio>。
// 三种来源（openSource 看文件开头认）：
// - remux-mp4：普通 MP4、MOV、M4V、M4A（moov 在头在尾都行）：播放时在页面里切成约 2 秒一段的分段 MP4（isobmff.mjs）；时间 → 位置查样本表，拖动不用试探；
// - fmp4：已分段的 MP4：原样喂；时间 → 位置先查 sidx、再查文件尾的 mfra，都没有就二分（在某个位置读一窗，找下一个 moof 和它的时间）；
// - webm：原样喂；先查 Cues，没有就二分（找下一个 Cluster）。
// 别的格式、浏览器的 MediaSource 不收的编码：openSource / streamMedia 抛错（code 为 not-streamable、unsupported、no-mse），调用方退回「整个读进内存再放」或「下载后看」。
// 喂的规矩：只缓冲当前位置往后 ahead 秒（默认 30），往前留 behind 秒（默认 10），别的清掉；存储超额（QuotaExceededError）先腾地方再喂；
// 拖动：seeking → 停下正在喂的（代数加一）→ abort 解析器 → 换位置（已经缓冲到的就从缓冲的末尾接着）→ 接着喂；缓冲之间的小缝（不到 0.5 秒）跳过去
// （调查二的原型里 HEVC 结尾留下一条约 0.1 秒的缝，ended 不触发）；全部喂完 endOfStream。ManagedMediaSource（iOS 17.1 起）：设 disableRemotePlayback，
// 只在它说可以（streaming 为真，startstreaming / endstreaming）时才取数据，它随时可能清掉缓冲，这里每次都照 video.buffered 重算。
// reader：{ size, read(a, b) → [a, b) 的明文 }（调用方的读法：按块取、核对哈希、解密；页面上显示的都是核对过的）。不存任何钥匙。
import { boxAt, parseMoov, mimeOf, buildInit, planFragments, fragmentAt, buildFragment, parseSidx, parseMfra, moofIn, lastMoofEnd, u32, fourcc } from './isobmff.mjs';
import { parseWebmHead, cuesSize, parseCues, clusterIn, lastTimeIn } from './webmindex.mjs';

export const PIECE = 512 * 1024;            // 原样喂的来源每次喂多少字节
const PROBE = 256 * 1024;                   // 二分时一窗读多少
const HEAD = 64 * 1024;                     // 认格式先读多少
const MAX_TOP_BOXES = 4096;                 // 找 moov、第一个 moof 时最多走多少个顶层盒子
const MAX_INDEX = 16 * 1048576;             // moov、Cues、mfra 最多读多大
const coded = (code, message) => Object.assign(new Error(message), { code });
const once = (t, ev) => new Promise((ok) => t.addEventListener(ev, ok, { once: true }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MP4_TOP = new Set(['ftyp', 'styp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'uuid', 'sidx', 'moof', 'meta', 'pdin', 'prft']);

/** 这个浏览器的 MediaSource（Safari 的 ManagedMediaSource 优先）；没有返回 null */
export const mediaSourceClass = () => globalThis.ManagedMediaSource ?? globalThis.MediaSource ?? null;

/** 第一个「段的开头」（moof、Cluster）在 off 及之后：一窗一窗往后读，窗口之间重叠 16 KiB（免得段头正好被窗口切开） */
async function scan(reader, off, find) {
  for (let a = off; a < reader.size; a += PROBE - 16384) {
    const m = find(await reader.read(a, Math.min(reader.size, a + PROBE)), a);
    if (m) return m;
  }
  return null;
}

/** 文件尾往前读，窗口每次翻倍，直到 find 给出结果或读到 from */
async function fromTail(reader, from, find) {
  for (let back = 4 * PROBE; ; back *= 2) {
    const off = Math.max(from, reader.size - back);
    const v = find(await reader.read(off, reader.size), off);
    if (v !== null && v !== undefined) return v;
    if (off === from) return null;
  }
}

/** 有索引（[{ time, offset }]，按时间排好）时：时间 → 不晚于它的那一项 */
const indexAt = (index, t) => { let lo = 0, hi = index.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (index[m].time <= t) lo = m; else hi = m - 1; } return index[lo]; };

/** 原样喂的来源：位置是文件里的字节；时间 → 位置查索引，没有索引就二分（probe(off) 找 off 之后的下一个段） */
function rawCursor(src, reader, stats) {
  return {
    async positionFor(t) {
      if (t <= 0) return { pos: src.startAt, at: 0 };
      if (src.index) { const e = indexAt(src.index, t); return { pos: Math.max(src.startAt, e.offset), at: e.time }; }
      let lo = src.startAt, hi = reader.size, best = src.startAt, bestT = 0;
      while (hi - lo > PROBE) {
        const mid = Math.floor((lo + hi) / 2);
        const m = await src.probe(mid);
        stats.seekProbes++;
        if (!m || m.time > t) hi = mid; else { best = m.start; bestT = m.time; lo = m.start + 1; }
      }
      for (let off = lo; off < hi;) {                                 // 最后一窗：往后走到不晚于 t 的最后一个段
        const m = await src.probe(off);
        stats.seekProbes++;
        if (!m || m.time > t || m.start >= hi) break;
        best = m.start; bestT = m.time; off = m.start + 1;
      }
      return { pos: best, at: bestT };
    },
    async next(pos) {
      if (pos >= reader.size) return null;
      const end = Math.min(reader.size, pos + PIECE);
      return { bytes: await reader.read(pos, end), pos: end };
    },
  };
}

async function mp4Source(reader) {
  const size = reader.size;
  let p = 0, moov = null, firstMoof = null, sidx = null;
  for (let n = 0; p + 8 <= size && n < MAX_TOP_BOXES; n++) {
    const h = await reader.read(p, Math.min(size, p + 16));
    const x = boxAt(h, 0, size - p);
    if (!x || (n === 0 && !MP4_TOP.has(x.type))) throw coded('not-streamable', n === 0 ? '不是 MP4' : 'MP4 的顶层盒子写坏了');
    if (x.end > size && (x.type === 'moov' || x.type === 'sidx')) throw coded('not-streamable', `MP4 的 ${x.type} 超出了文件`);
    if (x.type === 'moov') {
      if (x.size > MAX_INDEX) throw coded('not-streamable', 'moov 太大');
      moov = parseMoov(await reader.read(p, p + x.size));
      if (!moov.fragmented) break;
    }
    if (x.type === 'sidx' && !sidx && x.size <= MAX_INDEX) sidx = parseSidx(await reader.read(p, p + x.size), 0, p);
    if (x.type === 'moof') { firstMoof = p; break; }
    p += x.size;
  }
  if (!moov) throw coded('not-streamable', 'MP4 里找不到 moov');
  const mime = mimeOf(moov);
  if (!mime) throw coded('unsupported', '加了 DRM 或样本描述不止一种的 MP4');
  if (!moov.fragmented) {
    const frags = planFragments(moov, 2);
    const cursor = {
      async positionFor(t) { const k = fragmentAt(frags, Math.max(0, t - 0.5)); return { pos: k, at: frags[k].t0 }; },   // 早半秒：编辑列表让显示时间比解码时间晚一点
      async next(k) { return k >= frags.length ? null : { bytes: await buildFragment(frags[k], k + 1, (a, b) => reader.read(a, b)), pos: k + 1 }; },
    };
    return { kind: 'remux-mp4', mime, duration: moov.duration, init: async () => buildInit(moov), cursor, fragments: frags.length };
  }
  if (firstMoof === null) throw coded('not-streamable', '分段的 MP4 里没有 moof');
  const lead = moov.tracks.find((t) => t.handler === 'vide') ?? moov.tracks[0];
  let index = sidx;
  if (!index && size >= 16) {                                          // 文件尾的 mfro 写着 mfra 多大
    const tail = await reader.read(size - 16, size);
    if (fourcc(tail, 4) === 'mfro') {
      const n = u32(tail, 12);
      if (n > 16 && n <= Math.min(size, MAX_INDEX)) index = parseMfra(await reader.read(size - n, size), lead.id, lead.timescale);
    }
  }
  let duration = moov.duration || null;
  if (!duration) duration = await fromTail(reader, firstMoof, (w, off) => lastMoofEnd(w, off, lead));
  const src = { kind: 'fmp4', mime, duration, startAt: firstMoof, index, init: () => reader.read(0, firstMoof),
    probe: (off) => scan(reader, off, (w, a) => { const m = moofIn(w, a, lead.id); return m && { start: m.start, time: m.time / lead.timescale }; }) };
  return src;
}

async function webmSource(reader) {
  const size = reader.size;
  let n = Math.min(size, HEAD), h;
  for (;;) {
    h = parseWebmHead(await reader.read(0, n));
    if (!h.need) break;
    if (n >= size || h.need > MAX_INDEX) throw coded('not-streamable', 'WebM 的头太长或不完整');
    n = Math.min(size, Math.max(h.need, n * 2));
  }
  if (!h.mime) throw coded('unsupported', 'WebM 里的编码不是 VP8、VP9、AV1、Opus、Vorbis');
  let index = null;
  if (h.cuesAt !== null && h.cuesAt + 16 <= size) {
    const total = cuesSize(await reader.read(h.cuesAt, Math.min(size, h.cuesAt + 16)));
    if (total && total <= MAX_INDEX && h.cuesAt + total <= size) index = parseCues(await reader.read(h.cuesAt, h.cuesAt + total), h.segmentBody, h.timecodeScale);
  }
  let duration = h.duration;
  if (!duration) duration = await fromTail(reader, h.initEnd, (w) => lastTimeIn(w, h.timecodeScale));
  return { kind: 'webm', mime: h.mime, duration, startAt: h.initEnd, index, init: () => reader.read(0, h.initEnd),
    probe: (off) => scan(reader, off, (w, a) => clusterIn(w, a, h.timecodeScale)) };
}

/**
 * 看文件开头认来源：{ kind（remux-mp4 | fmp4 | webm）, mime, duration（秒或 null）, init() → 初始化段, cursor：{ positionFor(t) → { pos, at }, next(pos) → { bytes, pos } 或 null } }。
 * 不是 MP4、WebM 抛 not-streamable；编码不认的抛 unsupported
 */
export async function openSource(reader, stats = { seekProbes: 0 }) {
  if (!reader.size) throw coded('not-streamable', '空文件');
  const head = await reader.read(0, Math.min(reader.size, 16));
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    const s = await webmSource(reader);
    return { ...s, cursor: rawCursor(s, reader, stats) };
  }
  if (head.length >= 8 && MP4_TOP.has(fourcc(head, 4))) {
    const s = await mp4Source(reader);
    return s.cursor ? s : { ...s, cursor: rawCursor(s, reader, stats) };
  }
  throw coded('not-streamable', '不是 MP4、WebM');
}

/**
 * 把 reader 的内容边下边播到 media（<video> 或 <audio>）。返回 { kind, mime, duration, stats, close() }；不能边下边播的抛错（见文件开头），media 不动。
 * 之后的错误（解析不了、读不到、核对不过）经 onError(e) 报给调用方（只报一次）。ahead、behind：往后缓冲、往前保留几秒
 */
export async function streamMedia(media, reader, { ahead = 30, behind = 10, onError = () => {} } = {}) {
  const MS = mediaSourceClass();
  if (!MS) throw coded('no-mse', '这个浏览器没有 MediaSource');
  const stats = { seekProbes: 0, appends: 0, appended: 0, evictions: 0, gapsSkipped: 0 };
  const src = await openSource(reader, stats);
  if (!MS.isTypeSupported(src.mime)) throw coded('unsupported', `这个浏览器的 MediaSource 不收 ${src.mime}`);
  const managed = MS === globalThis.ManagedMediaSource;
  const ms = new MS();
  media.disableRemotePlayback = true;                                // ManagedMediaSource 要它（或给一个 AirPlay 用的备选地址）
  let url = null;
  if (managed && 'srcObject' in media) media.srcObject = ms;
  else { url = URL.createObjectURL(ms); media.src = url; }
  await once(ms, 'sourceopen');
  const sb = ms.addSourceBuffer(src.mime);
  let closed = false, failed = false, gen = 0, pos = null;
  const fail = (e) => { if (closed || failed) return; failed = true; onError(e); };
  const settle = async () => { while (sb.updating) await once(sb, 'updateend'); };
  const append = async (bytes) => { await settle(); sb.appendBuffer(bytes); await once(sb, 'updateend'); stats.appends++; stats.appended += bytes.length; };
  const remove = async (a, b) => { if (b - a < 0.5) return; await settle(); sb.remove(a, b); await once(sb, 'updateend'); stats.evictions++; };
  const rangeAt = (t) => { const b = media.buffered; for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.2 && b.end(i) > t) return [b.start(i), b.end(i)]; return null; };
  /** 往前超过 behind 秒、往后超过 2×ahead 秒的缓冲清掉；hard 时只留当前位置附近 */
  async function evict(hard = false) {
    const t = media.currentTime, b = media.buffered, keepBack = hard ? 2 : behind, keepAhead = hard ? ahead : 2 * ahead;
    for (let i = b.length - 1; i >= 0; i--) {
      const s = b.start(i), e = b.end(i);
      if (e < t - keepBack) await remove(s, e);
      else if (s < t - keepBack) await remove(s, t - keepBack);
      if (s > t + keepAhead) await remove(s, e);
      else if (e > t + keepAhead && s <= t + keepAhead) await remove(t + keepAhead, e);
    }
  }
  async function feed(my) {
    let quota = 0;
    while (my === gen && !closed) {
      if (managed && !ms.streaming) { await sleep(250); continue; }                      // ManagedMediaSource 说现在别取
      const r0 = rangeAt(media.currentTime);
      if (r0 && r0[1] - media.currentTime > ahead) { await sleep(250); continue; }
      const r = await src.cursor.next(pos);
      if (my !== gen || closed) return;
      if (!r) { await settle(); if (ms.readyState === 'open' && my === gen) ms.endOfStream(); return; }
      try { await append(r.bytes); } catch (e) {
        if (e?.name !== 'QuotaExceededError') throw e;
        await evict(true);                                                                // 腾地方再喂同一段；腾不出来就等播放往前走
        if (++quota > 3) await sleep(1000);
        continue;
      }
      quota = 0;
      pos = r.pos;
      if (stats.appends % 8 === 0) await evict();
    }
  }
  const run = (my) => feed(my).catch(fail);
  async function onSeeking() {
    const my = ++gen, t = media.currentTime;
    try {
      await settle();
      if (my !== gen || closed) return;
      if (ms.readyState === 'open') sb.abort();                     // 解析器可能停在一个盒子、一个 Cluster 的中间
      const r = rangeAt(t);
      if (r && Number.isFinite(ms.duration) && r[1] >= ms.duration - 0.05) {          // 已经缓冲到结尾了，不用再取；被打断的那一轮可能还没 endOfStream
        await settle();
        if (my === gen && !closed && ms.readyState === 'open') ms.endOfStream();
        return;
      }
      const p = await src.cursor.positionFor(Math.max(0, (r ? r[1] : t) - 0.01));
      if (my !== gen || closed) return;
      pos = p.pos;
      run(my);
    } catch (e) { fail(e); }
  }
  // 缓冲之间的小缝：正在放、卡住、前面不到 0.5 秒有一段缓冲 → 跳过去；放到最后一段缓冲的末尾、已经 endOfStream → 跳到结尾（触发 ended）
  const watch = setInterval(() => {
    if (closed || media.paused || media.seeking || media.ended || media.readyState >= 3) return;
    const t = media.currentTime, b = media.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) > t && b.start(i) - t < 0.5) { media.currentTime = b.start(i) + 0.001; stats.gapsSkipped++; return; }
    if (ms.readyState === 'ended' && b.length && t >= b.end(b.length - 1) - 0.3 && Number.isFinite(media.duration) && media.duration - t < 0.5) { media.currentTime = media.duration; stats.gapsSkipped++; }
  }, 250);
  media.addEventListener('seeking', onSeeking);
  try {
    await append(await src.init());
    if (src.duration && ms.readyState === 'open') { await settle(); ms.duration = src.duration; }
    pos = (await src.cursor.positionFor(0)).pos;
  } catch (e) {
    clearInterval(watch);
    media.removeEventListener('seeking', onSeeking);
    if (url) URL.revokeObjectURL(url);
    try { if (managed) media.srcObject = null; else media.removeAttribute('src'); } catch { /* 拆不掉不要紧，调用方会换来源 */ }
    throw coded(e?.code ?? 'unsupported', `喂不进 MediaSource：${String(e?.message ?? e)}`);
  }
  run(gen);
  return {
    kind: src.kind, mime: src.mime, duration: src.duration, stats,
    close() {
      if (closed) return;
      closed = true;
      gen++;
      clearInterval(watch);
      media.removeEventListener('seeking', onSeeking);
      try { if (ms.readyState === 'open' && !sb.updating) ms.endOfStream(); } catch { /* 关的时候出错不要紧 */ }
      if (url) URL.revokeObjectURL(url);
    },
  };
}
