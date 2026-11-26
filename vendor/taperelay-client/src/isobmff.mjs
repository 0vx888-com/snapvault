// TapeRelay 客户端库：MP4（ISO BMFF：MP4、MOV、M4V、M4A）边下边播用的拆和装（前端第 3 步，D-682；docs/FRONTENDS-DESIGN.md 第二节「默认播放器」）。
// 2026-11-08 由编写窗口照调查二的原型（本次任务 tmp/spike-player/www/mp4.mjs）改写成正式代码。只做盒子的记账和字节拷贝，不解码。
// 容器网站不能装自己的 Service Worker（/sw.js 归 TapeKit 网关），边下边播改用 MediaSource（mediasource.mjs），MediaSource 只收「分段」的 MP4：
// - 普通（没分段的）MP4：读 moov 的样本表（parseMoov），在视频关键帧处切成约 2 秒一段（planFragments），每段临时拼成 moof + mdat
//   （buildFragment：样本字节照抄、时间和标志照样本表），配一个「样本表是空的、另有 mvex」的初始化段（buildInit）。时间 → 位置是精确的
//   （查样本表，不用试探）；moov 在头、在尾都行；编辑列表（edts）原样留在初始化段里；带 B 帧的（ctts）照抄合成时间偏移（trun 第 1 版，有符号）。
// - 已分段的 MP4：初始化段 = 第一个 moof 之前的字节；时间 → 位置先查 sidx（parseSidx），再查文件尾的 mfra（parseMfra），都没有由调用方二分
//   （moofIn：在一段字节里找下一个 moof 和它的时间）。
// - 编码串（MediaSource.isTypeSupported 用，codecOf）：avc1/avc3、hvc1/hev1、vp09、av01、mp4a（AAC，MP4 里的 MP3 是 mp4a.6B / mp4a.69）、
//   Opus、fLaC、ac-3、ec-3；加了 DRM 的（encv、enca）、样本描述不止一种的不收（调用方退回别的办法）。
// 只认视频、音频轨，各取第一条（字幕、时间码等其余的轨扔掉）。读到的字节都是调用方核对、解密过的；这里对写坏的文件只会抛错（code 为 bad-media），
// 不会越界读、不会死循环：盒子的大小、样本数都按实际有的字节核对，样本数最多 MAX_SAMPLES。
// 只是函数，不碰网络、不碰页面。

export const MAX_SAMPLES = 20_000_000;                 // 一条轨最多这么多样本（约 3 天 60 帧的视频）：样本表大到这个程度的不收
const bad = (message) => { throw Object.assign(new Error(message), { code: 'bad-media' }); };

export const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const i32 = (b, p) => u32(b, p) | 0;
export const u64 = (b, p) => u32(b, p) * 2 ** 32 + u32(b, p + 4);
const i64 = (b, p) => Number(BigInt.asIntN(64, (BigInt(u32(b, p)) << 32n) | BigInt(u32(b, p + 4))));
export const fourcc = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);

/** p 处的盒子头（end：外层的结尾）；放不下、写法不对返回 null。size 为 0 是「到外层结尾」 */
export function boxAt(b, p, end = b.length) {
  if (p + 8 > end || p + 8 > b.length) return null;
  let size = u32(b, p), hdr = 8;
  const type = fourcc(b, p + 4);
  if (size === 1) { if (p + 16 > end || p + 16 > b.length) return null; size = u64(b, p + 8); hdr = 16; } else if (size === 0) size = end - p;
  if (size < hdr) return null;
  return { type, start: p, size, hdr, body: p + hdr, end: p + size };
}

/** [start, end) 里一个接一个的盒子（超出 end 的那个和之后的不要） */
export function children(b, start, end) {
  const out = [];
  for (let p = start; p + 8 <= end;) {
    const x = boxAt(b, p, end);
    if (!x || x.end > end) break;
    out.push(x);
    p = x.end;
  }
  return out;
}
const child = (b, box, type) => (box ? children(b, box.body, box.end).find((c) => c.type === type) ?? null : null);
const need = (x, what) => x ?? bad(`MP4 里少了 ${what}`);

// ---------- 编码串 ----------
const hex2 = (n) => n.toString(16).padStart(2, '0');
const HEX2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();
/** esds 里的 MPEG-4 描述符 */
function descriptors(b, p, end) {
  const out = [];
  while (p + 2 <= end) {
    const tag = b[p++];
    let len = 0, k = 0;
    do { len = (len << 7) | (b[p] & 0x7f); } while (b[p++] & 0x80 && ++k < 4);
    if (p + len > end) break;
    out.push({ tag, start: p, end: p + len });
    p += len;
  }
  return out;
}
function mp4aString(b, entry) {
  const qtVersion = (b[entry.body + 8] << 8) | b[entry.body + 9];
  const kidsAt = entry.body + 28 + (qtVersion === 1 ? 16 : qtVersion === 2 ? 36 : 0);
  const esds = children(b, kidsAt, entry.end).find((c) => c.type === 'esds');
  const es = esds ? descriptors(b, esds.body + 4, esds.end).find((d) => d.tag === 3) : null;
  if (!es || es.end - es.start < 3) return 'mp4a.40.2';
  const flags = b[es.start + 2];
  let q = es.start + 3;
  if (flags & 0x80) q += 2;
  if (flags & 0x40) q += 1 + b[q];
  if (flags & 0x20) q += 2;
  const dc = descriptors(b, q, es.end).find((d) => d.tag === 4);
  if (!dc || dc.end - dc.start < 13) return 'mp4a.40.2';
  const oti = b[dc.start];
  if (oti !== 0x40) return `mp4a.${HEX2(oti)}`;                         // 例如 MP4 里的 MP3：mp4a.6B、mp4a.69
  const dsi = descriptors(b, dc.start + 13, dc.end).find((d) => d.tag === 5);
  let aot = dsi ? b[dsi.start] >> 3 : 2;
  if (dsi && aot === 31) aot = 32 + (((b[dsi.start] & 7) << 3) | (b[dsi.start + 1] >> 5));
  return `mp4a.40.${aot}`;
}
function hevcString(b, cfg, type) {
  const p = cfg.body, b1 = b[p + 1];
  const space = ['', 'A', 'B', 'C'][b1 >> 6], tier = (b1 >> 5) & 1 ? 'H' : 'L', profile = b1 & 31;
  let compat = u32(b, p + 2), rev = 0;
  for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
  const cons = Array.from(b.subarray(p + 6, p + 12));
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  return [type, `${space}${profile}`, (rev >>> 0).toString(16).toUpperCase(), `${tier}${b[p + 12]}`, ...cons.map((x) => x.toString(16).toUpperCase())].join('.');
}
function av1String(b, cfg) {
  const p = cfg.body;
  const profile = b[p + 1] >> 5, level = b[p + 1] & 31, tier = b[p + 2] >> 7 ? 'H' : 'M';
  const high = (b[p + 2] >> 6) & 1, twelve = (b[p + 2] >> 5) & 1;
  return `av01.${profile}.${String(level).padStart(2, '0')}${tier}.${high ? (twelve ? '12' : '10') : '08'}`;
}
/** 样本描述（stsd 的一项）→ 编码串；不认识的照原样给四个字母（isTypeSupported 会说不行） */
export function codecOf(b, entry) {
  const t = entry.type;
  const vkids = () => children(b, entry.body + 78, entry.end);
  if (t === 'avc1' || t === 'avc3') {
    const c = vkids().find((x) => x.type === 'avcC');
    return c && c.end - c.body >= 4 ? `${t}.${hex2(b[c.body + 1])}${hex2(b[c.body + 2])}${hex2(b[c.body + 3])}` : t;
  }
  if (t === 'hvc1' || t === 'hev1') { const c = vkids().find((x) => x.type === 'hvcC'); return c && c.end - c.body >= 13 ? hevcString(b, c, t) : t; }
  if (t === 'vp09') {
    const c = vkids().find((x) => x.type === 'vpcC');
    return c && c.end - c.body >= 7 ? `vp09.${String(b[c.body + 4]).padStart(2, '0')}.${String(b[c.body + 5]).padStart(2, '0')}.${String(b[c.body + 6] >> 4).padStart(2, '0')}` : 'vp09.00.10.08';
  }
  if (t === 'av01') { const c = vkids().find((x) => x.type === 'av1C'); return c && c.end - c.body >= 3 ? av1String(b, c) : 'av01.0.04M.08'; }
  if (t === 'mp4a') return mp4aString(b, entry);
  if (t === 'Opus') return 'opus';
  if (t === 'fLaC') return 'flac';
  if (t === 'ac-3' || t === 'ec-3') return t;
  return t;
}

// ---------- moov → 样本表 ----------
function parseTrak(b, trak) {
  const tkhd = need(child(b, trak, 'tkhd'), 'tkhd'), mdia = need(child(b, trak, 'mdia'), 'mdia');
  const mdhd = need(child(b, mdia, 'mdhd'), 'mdhd'), hdlr = need(child(b, mdia, 'hdlr'), 'hdlr'), minf = need(child(b, mdia, 'minf'), 'minf');
  const handler = fourcc(b, hdlr.body + 8);
  if (handler !== 'vide' && handler !== 'soun') return null;
  const stbl = need(child(b, minf, 'stbl'), 'stbl'), stsd = need(child(b, stbl, 'stsd'), 'stsd');
  const id = b[tkhd.body] ? u32(b, tkhd.body + 20) : u32(b, tkhd.body + 12);
  const timescale = b[mdhd.body] ? u32(b, mdhd.body + 20) : u32(b, mdhd.body + 12);
  if (!timescale) bad('轨的时间单位是 0');
  const entries = u32(b, stsd.body + 4);
  const entry = boxAt(b, stsd.body + 8, stsd.end) ?? bad('样本描述写坏了');
  const edts = child(b, trak, 'edts'), elst = child(b, edts, 'elst');
  const edits = [];
  if (elst) {
    const v = b[elst.body], n = Math.min(u32(b, elst.body + 4), Math.floor((elst.end - elst.body - 8) / (v ? 20 : 12)));
    for (let i = 0, p = elst.body + 8; i < n; i++, p += v ? 20 : 12) edits.push(v ? { dur: u64(b, p), mediaTime: i64(b, p + 8) } : { dur: u32(b, p), mediaTime: i32(b, p + 4) });
  }
  // 样本表
  const stsz = child(b, stbl, 'stsz'), stz2 = child(b, stbl, 'stz2');
  let count = 0, sizes;
  if (stsz) {
    const fixed = u32(b, stsz.body + 4);
    count = u32(b, stsz.body + 8);
    if (count > MAX_SAMPLES || (!fixed && stsz.body + 12 + 4 * count > stsz.end)) bad('样本大小表写坏了');
    sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || u32(b, stsz.body + 12 + 4 * i);
  } else if (stz2) {
    const field = b[stz2.body + 7];
    count = u32(b, stz2.body + 8);
    if (![4, 8, 16].includes(field) || count > MAX_SAMPLES || stz2.body + 12 + Math.ceil((count * field) / 8) > stz2.end) bad('样本大小表（stz2）写坏了');
    sizes = new Uint32Array(count);
    for (let i = 0, p = stz2.body + 12; i < count; i++) {
      sizes[i] = field === 16 ? (b[p + 2 * i] << 8) | b[p + 2 * i + 1] : field === 8 ? b[p + i] : (b[p + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15;
    }
  } else sizes = new Uint32Array(0);
  const dts = new Float64Array(count), dur = new Uint32Array(count), cto = new Int32Array(count), sync = new Uint8Array(count), off = new Float64Array(count);
  const stts = child(b, stbl, 'stts');
  if (stts) {
    const n = Math.min(u32(b, stts.body + 4), Math.floor((stts.end - stts.body - 8) / 8));
    let s = 0, t = 0;
    for (let e = 0; e < n && s < count; e++) {
      const c = u32(b, stts.body + 8 + 8 * e), d = u32(b, stts.body + 12 + 8 * e);
      for (let k = 0; k < c && s < count; k++, s++) { dts[s] = t; dur[s] = d; t += d; }
    }
    if (s < count) bad('样本时间表比样本少');
  } else if (count) bad('没有样本时间表');
  const ctts = child(b, stbl, 'ctts');
  if (ctts) {
    const n = Math.min(u32(b, ctts.body + 4), Math.floor((ctts.end - ctts.body - 8) / 8));
    const signed = b[ctts.body] === 1;
    let s = 0;
    for (let e = 0; e < n && s < count; e++) {
      const c = u32(b, ctts.body + 8 + 8 * e), o = signed ? i32(b, ctts.body + 12 + 8 * e) : u32(b, ctts.body + 12 + 8 * e) | 0;
      for (let k = 0; k < c && s < count; k++) cto[s++] = o;
    }
  }
  const stss = child(b, stbl, 'stss');
  if (stss) {
    const n = Math.min(u32(b, stss.body + 4), Math.floor((stss.end - stss.body - 8) / 4));
    for (let e = 0; e < n; e++) { const k = u32(b, stss.body + 8 + 4 * e) - 1; if (k >= 0 && k < count) sync[k] = 1; }
  } else sync.fill(1);
  const stco = child(b, stbl, 'stco'), co64 = child(b, stbl, 'co64'), stsc = child(b, stbl, 'stsc');
  if (count) {
    if (!stsc || !(stco || co64)) bad('没有样本在文件里的位置');
    const co = stco ?? co64, wide = !stco;
    const nChunks = Math.min(u32(b, co.body + 4), Math.floor((co.end - co.body - 8) / (wide ? 8 : 4)));
    const chunkOff = (c) => (wide ? u64(b, co.body + 8 + 8 * c) : u32(b, co.body + 8 + 4 * c));
    const nRuns = Math.min(u32(b, stsc.body + 4), Math.floor((stsc.end - stsc.body - 8) / 12));
    const runs = Array.from({ length: nRuns }, (_, e) => ({ first: u32(b, stsc.body + 8 + 12 * e) - 1, per: u32(b, stsc.body + 12 + 12 * e) }));
    let s = 0;
    for (let r = 0; r < runs.length && s < count; r++) {
      const last = r + 1 < runs.length ? Math.min(runs[r + 1].first, nChunks) : nChunks;
      for (let c = Math.max(0, runs[r].first); c < last && s < count; c++) {
        let p = chunkOff(c);
        for (let k = 0; k < runs[r].per && s < count; k++, s++) { off[s] = p; p += sizes[s]; }
      }
    }
    if (s < count) bad('样本位置表比样本少');
  }
  return {
    id, timescale, handler, codec: codecOf(b, entry), entryType: entry.type, entries, edits, hasCtts: !!ctts,
    raw: { tkhd, edts, mdhd, hdlr, xmhd: children(b, minf.body, minf.end).find((c) => /^(vmhd|smhd|sthd|nmhd)$/.test(c.type)) ?? null, dinf: child(b, minf, 'dinf'), stsd },
    count, sizes, dts, dur, cto, sync, off,
  };
}

/**
 * bytes：从 moov 盒子开头起的字节（整个 moov）。返回 { b, moov, mvhd, timescale, duration（秒）, fragmented（moov 里有 mvex）, tracks }：
 * tracks 最多两条（第一条视频、第一条音频）。普通 MP4 里每条轨的样本表都在（count、sizes、dts、dur、cto、sync、off）；已分段的样本表是空的
 */
export function parseMoov(bytes) {
  const b = bytes;
  const moov = boxAt(b, 0);
  if (!moov || moov.type !== 'moov' || moov.end > b.length) bad('不是 moov');
  const mvhd = need(child(b, moov, 'mvhd'), 'mvhd');
  const v1 = b[mvhd.body];
  const timescale = v1 ? u32(b, mvhd.body + 20) : u32(b, mvhd.body + 12);
  const duration = v1 ? u64(b, mvhd.body + 24) : u32(b, mvhd.body + 16);
  const mvex = child(b, moov, 'mvex'), mehd = child(b, mvex, 'mehd');
  const fragDuration = mehd ? (b[mehd.body] ? u64(b, mehd.body + 4) : u32(b, mehd.body + 4)) : 0;
  const all = children(b, moov.body, moov.end).filter((x) => x.type === 'trak').map((t) => parseTrak(b, t)).filter(Boolean);
  const tracks = [all.find((t) => t.handler === 'vide'), all.find((t) => t.handler === 'soun')].filter(Boolean);
  if (!tracks.length) bad('MP4 里没有视频、音频轨');
  let seconds = timescale ? (duration || fragDuration) / timescale : 0;
  if (!seconds && !mvex) for (const t of tracks) if (t.count) seconds = Math.max(seconds, (t.dts[t.count - 1] + t.dur[t.count - 1]) / t.timescale);
  return { b, moov, mvhd, timescale, duration: seconds, fragmented: !!mvex, tracks };
}

/** MediaSource 的类型串，例如 video/mp4; codecs="avc1.42c01e,mp4a.40.2"；加了 DRM、样本描述不止一种的返回 null */
export function mimeOf(movie) {
  if (movie.tracks.some((t) => t.entries !== 1 || t.entryType === 'encv' || t.entryType === 'enca')) return null;
  const v = movie.tracks.some((t) => t.handler === 'vide');
  return `${v ? 'video' : 'audio'}/mp4; codecs="${movie.tracks.map((t) => t.codec).join(',')}"`;
}

// ---------- 写盒子 ----------
const enc4 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const be64 = (n) => { const hi = Math.floor(n / 2 ** 32); return Uint8Array.of(...be32(hi), ...be32(n >>> 0)); };
export function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function box(type, ...parts) { const body = concat(parts.filter(Boolean)); return concat([be32(8 + body.length), enc4(type), body]); }
const full = (type, version, flags, ...parts) => box(type, Uint8Array.of(version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255), ...parts);
const raw = (b, x) => (x ? b.subarray(x.start, x.end) : null);

/** MediaSource 的初始化段：ftyp + moov（原来的 mvhd、每条轨原来的 tkhd、edts、mdhd、hdlr、xmhd、dinf、stsd，样本表换成空的）+ mvex（mehd 写总长，每条轨一个 trex） */
/**
 * 2026-11-13：QuickTime（MOV）的样本描述有几处 MP4 没有的写法，Chrome 的 MediaSource 解析不了（CHUNK_DEMUXER_ERROR_APPEND_FAILED）：
 * - 条目末尾常有 4 个 0 字节的结束标记（在 MP4 里像一个坏盒子）；
 * - 音频条目常是第 1 版：比 MP4 的多 16 字节，AAC 的配置（esds）还包在 wave 盒子里。
 * 初始化段里把条目重新拼一遍：固定的头照抄（音频第 1 版去掉多的 16 字节、版本清零），后面只留完整的子盒子，wave 里的 esds 拿出来。
 * 拿不准的（不止一个条目、音频第 2 版、别的轨）照原样
 */
function mp4Stsd(b, stsd, handler) {
  if (!stsd || u32(b, stsd.body + 4) !== 1) return raw(b, stsd);
  const e = boxAt(b, stsd.body + 8, stsd.end);
  if (!e || e.end > stsd.end) return raw(b, stsd);
  let head, from;
  if (handler === 'vide') {
    if (e.size < e.hdr + 78) return raw(b, stsd);
    head = b.subarray(e.body, e.body + 78); from = e.body + 78;
  } else if (handler === 'soun') {
    if (e.size < e.hdr + 28) return raw(b, stsd);
    const ver = (b[e.body + 8] << 8) | b[e.body + 9];
    if (ver === 2 || (ver === 1 && e.size < e.hdr + 44)) return raw(b, stsd);
    head = Uint8Array.from(b.subarray(e.body, e.body + 28));
    head[8] = 0; head[9] = 0;                                  // 版本改成 0
    from = e.body + (ver === 1 ? 44 : 28);
  } else return raw(b, stsd);
  const kids = children(b, from, e.end).flatMap((c) => {
    if (c.type !== 'wave') return [raw(b, c)];
    const esds = children(b, c.body, c.end).find((x) => x.type === 'esds');
    return esds ? [raw(b, esds)] : [];
  });
  return full('stsd', 0, 0, be32(1), box(e.type, head, ...kids));
}

export function buildInit(movie) {
  const { b } = movie;
  const empty = (t) => full(t, 0, 0, be32(0));
  const traks = movie.tracks.map((t) => box('trak', raw(b, t.raw.tkhd), raw(b, t.raw.edts),
    box('mdia', raw(b, t.raw.mdhd), raw(b, t.raw.hdlr),
      box('minf', raw(b, t.raw.xmhd), raw(b, t.raw.dinf),
        box('stbl', mp4Stsd(b, t.raw.stsd, t.handler), empty('stts'), empty('stsc'), full('stsz', 0, 0, be32(0), be32(0)), empty('stco'))))));
  const mvex = box('mvex', full('mehd', 1, 0, be64(Math.round(movie.duration * movie.timescale))),
    ...movie.tracks.map((t) => full('trex', 0, 0, be32(t.id), be32(1), be32(0), be32(0), be32(0))));
  return concat([box('ftyp', enc4('iso6'), be32(0), enc4('iso6'), enc4('iso5'), enc4('mp41')), box('moov', raw(b, movie.mvhd), ...traks, mvex)]);
}

const lowerBound = (arr, n, x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; };

/**
 * 把普通 MP4 切成约 target 秒一段：每段从视频的关键帧开始（只有音频的每 target 秒一段）；音频轨按时间跟着切。
 * 返回 [{ t0, t1（秒，解码时间）, parts: [{ track, first, last（样本序号，不含 last） }] }]
 */
export function planFragments(movie, target = 2) {
  const lead = movie.tracks.find((t) => t.handler === 'vide') ?? movie.tracks[0];
  if (!lead.count) bad('轨里没有样本');
  const starts = [0];
  for (let i = 1, t0 = 0; i < lead.count; i++) {
    if (lead.sync[i] && (lead.dts[i] - lead.dts[t0]) / lead.timescale >= target) { starts.push(i); t0 = i; }
  }
  const times = starts.map((i) => lead.dts[i] / lead.timescale);
  return times.map((t0, k) => {
    const t1 = k + 1 < times.length ? times[k + 1] : Infinity;
    return {
      t0, t1,
      parts: movie.tracks.map((t) => (t === lead
        ? { track: t, first: starts[k], last: k + 1 < starts.length ? starts[k + 1] : t.count }
        : { track: t, first: k === 0 ? 0 : lowerBound(t.dts, t.count, t0 * t.timescale), last: t1 === Infinity ? t.count : lowerBound(t.dts, t.count, t1 * t.timescale) })),
    };
  });
}

/** 时间 t（秒）落在哪一段（t0 不大于 t 的最后一段） */
export function fragmentAt(frags, t) {
  let lo = 0, hi = frags.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frags[m].t0 <= t) lo = m; else hi = m - 1; }
  return lo;
}

/**
 * 第 seq 个片段（moof + mdat）。read(a, b) 给原文件 [a, b) 的字节（核对、解密过的）。样本的字节按位置合成几次读（中间空隙小于 64 KiB 的连着读），
 * 再按轨的顺序拷进 mdat；trun 的数据偏移指向 mdat 里各轨的开头
 */
export async function buildFragment(frag, seq, read) {
  const spans = [];
  for (const p of frag.parts) for (let i = p.first; i < p.last; i++) spans.push([p.track.off[i], p.track.off[i] + p.track.sizes[i]]);
  spans.sort((x, y) => x[0] - y[0]);
  const runs = [];
  for (const s of spans) { const r = runs[runs.length - 1]; if (r && s[0] - r[1] < 65536) r[1] = Math.max(r[1], s[1]); else runs.push([s[0], s[1]]); }
  const got = await Promise.all(runs.map(([a, b]) => read(a, b)));
  const bytesAt = (o, n) => {
    let lo = 0, hi = runs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (runs[m][0] <= o) lo = m; else hi = m - 1; }
    if (!(o >= runs[lo][0] && o + n <= runs[lo][1])) bad('样本不在读到的字节里');
    return got[lo].subarray(o - runs[lo][0], o - runs[lo][0] + n);
  };
  const lens = frag.parts.map((p) => { let n = 0; for (let i = p.first; i < p.last; i++) n += p.track.sizes[i]; return n; });
  const total = lens.reduce((a, n) => a + n, 0);
  const moofWith = (offsets) => box('moof', full('mfhd', 0, 0, be32(seq)), ...frag.parts.map((p, k) => {
    const t = p.track, n = p.last - p.first, rows = new Uint8Array(16 * n);
    for (let i = 0; i < n; i++) {
      const s = p.first + i, o = 16 * i;
      rows.set(be32(t.dur[s]), o);
      rows.set(be32(t.sizes[s]), o + 4);
      rows.set(be32(t.sync[s] ? 0x02000000 : 0x01010000), o + 8);
      rows.set(be32(t.cto[s] >>> 0), o + 12);
    }
    return box('traf', full('tfhd', 0, 0x020000, be32(t.id)), full('tfdt', 1, 0, be64(n ? t.dts[p.first] : 0)), full('trun', 1, 0x000f01, be32(n), be32(offsets[k] >>> 0), rows));
  }));
  const moofSize = moofWith(frag.parts.map(() => 0)).length;
  let o = moofSize + 8;
  const offsets = lens.map((n) => { const x = o; o += n; return x; });
  const out = new Uint8Array(moofSize + 8 + total);
  out.set(moofWith(offsets), 0);
  out.set(be32(8 + total), moofSize);
  out.set(enc4('mdat'), moofSize + 4);
  let w = moofSize + 8;
  for (const p of frag.parts) for (let i = p.first; i < p.last; i++) { out.set(bytesAt(p.track.off[i], p.track.sizes[i]), w); w += p.track.sizes[i]; }
  return out;
}

// ---------- 已分段的 MP4 ----------
/**
 * sidx 盒子（b 里从 at 起）→ 段的表 [{ time（秒）, offset（文件里的位置） }]（只要指向媒体的那几项）；fileAt：这个 sidx 在文件里的位置。
 * 写法不对返回 null
 */
export function parseSidx(b, at, fileAt) {
  const x = boxAt(b, at);
  if (!x || x.type !== 'sidx' || x.end > b.length) return null;
  const v = b[x.body];
  const timescale = u32(b, x.body + 8);                              // 前面是 version、flags、reference_ID
  let p = x.body + 12;
  if (!timescale) return null;
  let time = v ? u64(b, p) : u32(b, p);
  let offset = fileAt + x.size + (v ? u64(b, p + 8) : u32(b, p + 4));
  p += v ? 16 : 8;
  const count = (b[p + 2] << 8) | b[p + 3];
  p += 4;
  if (p + 12 * count > x.end) return null;
  const out = [];
  for (let i = 0; i < count; i++, p += 12) {
    const ref = u32(b, p), size = ref & 0x7fffffff, d = u32(b, p + 4);
    if (ref >>> 31) return null;                                      // 指向下一层 sidx 的不认（少见）：退回二分
    out.push({ time: time / timescale, offset });
    time += d;
    offset += size;
  }
  return out.length ? out : null;
}

/** mfra 盒子（整个在 b 里）→ 这条轨的 [{ time（秒）, offset（moof 在文件里的位置） }]；timescale：这条轨的时间单位。没有返回 null */
export function parseMfra(b, trackId, timescale) {
  const x = boxAt(b, 0);
  if (!x || x.type !== 'mfra' || x.end > b.length) return null;
  for (const t of children(b, x.body, x.end).filter((c) => c.type === 'tfra')) {
    if (u32(b, t.body + 4) !== trackId) continue;
    const v = b[t.body], lens = u32(b, t.body + 8), n = u32(b, t.body + 12);
    const extra = ((lens >> 4) & 3) + 1 + ((lens >> 2) & 3) + 1 + (lens & 3) + 1;
    const row = (v ? 16 : 8) + extra;
    if (t.body + 16 + row * n > t.end) return null;
    const out = [];
    for (let i = 0, p = t.body + 16; i < n; i++, p += row) out.push({ time: (v ? u64(b, p) : u32(b, p)) / timescale, offset: v ? u64(b, p + 8) : u32(b, p + 4) });
    return out.length ? out : null;
  }
  return null;
}

/** 在一段字节 w（文件里从 base 起）里找下一个 moof：返回 { start（文件里的位置）, time（这条轨的解码时间，单位是它的时间单位） }；没有返回 null */
export function moofIn(w, base, trackId) {
  for (let i = 4; i + 12 <= w.length; i++) {
    if (w[i] !== 0x6d || w[i + 1] !== 0x6f || w[i + 2] !== 0x6f || w[i + 3] !== 0x66) continue;          // 'moof'
    if (fourcc(w, i + 8) !== 'mfhd') continue;
    const moof = boxAt(w, i - 4, Infinity);
    if (!moof) continue;
    const end = Math.min(moof.end, w.length);
    for (const traf of children(w, moof.body, end).filter((c) => c.type === 'traf')) {
      const tfhd = child(w, traf, 'tfhd'), tfdt = child(w, traf, 'tfdt');
      if (!tfhd || !tfdt || u32(w, tfhd.body + 4) !== trackId) continue;
      return { start: base + i - 4, time: w[tfdt.body] ? u64(w, tfdt.body + 4) : u32(w, tfdt.body + 4) };
    }
  }
  return null;
}

/** 文件尾的一段字节 w（文件里从 base 起）：最后一个 moof 的结束时间（秒）= 它的解码时间 + 这条轨各样本时长之和（trun 里有时长的才算）；找不到返回 null */
export function lastMoofEnd(w, base, track) {
  let last = null;
  for (let i = 0; ;) { const m = moofIn(w.subarray(i), base + i, track.id); if (!m) break; last = m; i = m.start - base + 8; }
  if (!last) return null;
  const b = w.subarray(last.start - base), moof = boxAt(b, 0, Infinity);
  let sum = 0;
  for (const traf of children(b, moof.body, Math.min(moof.end, b.length)).filter((c) => c.type === 'traf')) {
    const tfhd = child(b, traf, 'tfhd'), trun = child(b, traf, 'trun');
    if (!tfhd || !trun || u32(b, tfhd.body + 4) !== track.id) continue;
    const tflags = (b[tfhd.body + 1] << 16) | (b[tfhd.body + 2] << 8) | b[tfhd.body + 3];
    let q = tfhd.body + 8 + (tflags & 1 ? 8 : 0) + (tflags & 2 ? 4 : 0);
    const defDur = tflags & 8 ? u32(b, q) : 0;
    const flags = (b[trun.body + 1] << 16) | (b[trun.body + 2] << 8) | b[trun.body + 3], cnt = u32(b, trun.body + 4);
    let r = trun.body + 8 + (flags & 1 ? 4 : 0) + (flags & 4 ? 4 : 0);
    const per = [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length * 4;
    if (r + per * cnt > trun.end) continue;
    if (flags & 0x100) for (let k = 0; k < cnt; k++, r += per) sum += u32(b, r);
    else sum += defDur * cnt;
  }
  return (last.time + sum) / track.timescale;
}
