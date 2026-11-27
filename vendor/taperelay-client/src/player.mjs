// TapeRelay 客户端库：播放器组件（前端第 3 步，D-681、D-682；docs/FRONTENDS-DESIGN.md 第二节「默认播放器」）。2026-11-08 由编写窗口编写，
// 把默认播放器（原来的打开页 entry/player/opener.mjs）的打开、播放、下载、出错说明挪进开发包：播放器页面和开发者自己的页面（普通网站、自己的容器网站）
// 用同一份，不写两份。
// mountPlayer(元素, 来源, 选项)：
// - 来源：{ link }（分享链接，整条网址，或 { path, hash }）、{ circuit, envelope, fileKey }、{ circuit, envelope, keyServer }（会员内容，D-666）；
// - 读电路的公开记录（发现文件）找存文件的节点（TapeKit 内核；本机、内网地址照规范跳过，allowLocal 只给本机测试用），也可以直接给 servers；
// - 取信封、用文件钥匙核对承诺值、解开清单（openEncryptedFileWithKey），之后按需读：每块核对哈希、解密（页面上显示的都是核对过的）；
// - 视频、音频：能边下边播的（MP4、MOV、M4V、M4A、WebM，mediasource.mjs）边下边播、能拖动；不能的，上限（memoryMax）以内整个读进内存再放，
//   再大的写「下载后用播放器看」；浏览器放不了的只留「放不了这种格式」一行（说明那行藏起来，G2 时补的规矩）；
//   图片、纯文字直接显示（文字一律当纯文字放进 <pre>）；别的只给「下载」；
// - 下载：savefile.mjs 的先后（「另存为」对话框 → 私有文件区 → 内存 → 提示换浏览器），边写边核对，核对不过不留文件；
// - 出错给一块写明原因的卡片（链接不对、拿不到钥匙、找不到节点、都取不到、核对不过、钥匙不对、解不开），不显示半截内容；原因代码和消息原文在卡片最后一行（.err-code）；
// - 中文、英文（lang：zh、en，D-688）；layout：compact（默认，开发者放在自己页面里的样子）或 cards（播放器页面：上面是内容卡片（文件名、状态、播放），
//   下面并排两张：保存和文件信息（大小、类型、状态、电路、指纹，默认收起；指纹中间省略、能复制）；类型写给人看的种类（typeLabel），原始类型在 title 上；2026-11-08 负责人定的样式：功能站参考 TapeOut 新官网）；
//   className：加在最外层上；样式由页面给（类名见下面 CLASS），这里只用 CSSOM 设几处尺寸，不写 style 属性（内容安全策略）。
// 返回 { done（打开结束：成功或出错）, close(), state, kind（stream 的 remux-mp4 / fmp4 / webm，或 memory、none）, media, stats }。
// 钥匙只在内存里：不写进本机存储、不打日志、不发给任何服务器（会员内容只把电路名和信封指纹发给发钥匙的地址）；close() 清掉。
import { createKernel } from '../vendor/tapekit-kernel/index.js';
import { createClient } from './client.mjs';
import { parseSharePath, parseFileKey, checkKeyServer } from './sharelink.mjs';
import { openEncryptedFileWithKey } from './encrypted.mjs';
import { readDiscovery } from './discovery.mjs';
import { chainOf, isAccount, normalizeCircuitInput } from './circuit.mjs';
import { isLocalHost } from './hosts.mjs';
import { ENCRYPTED_CHUNK } from './manifest.mjs';
import { streamMedia } from './mediasource.mjs';
import { saveFile, cleanupTempDownloads, SAVE_MEMORY_MAX } from './savefile.mjs';
import { sha256 } from '@noble/hashes/sha2.js';

export const PLAYER_MEMORY_MAX = 200 * 1048576;   // 不能边下边播的视频、音频，这么大以内整个读进内存再放
const TEXT_MAX = 262144;                          // 文字只显示前 256 KiB
const IMAGE_MAX = 50 * 1048576;                   // 图片超过 50 MiB 不在页面里显示
const PDF_MAX = 50 * 1048576;                     // 2026-11-17：PDF 超过 50 MiB 不在页面里显示（整份读进内存、核对完才交给浏览器的 PDF 阅读器）
const KEY_REPLY_MAX = 4096;
const KEY_TIMEOUT_MS = 20000;
const isText = (t) => /^text\/plain(;|$)/i.test(t);
const isImage = (t) => /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(t);   // SVG 不显示（里面能带脚本）
const isPdf = (t) => /^application\/pdf$/i.test(String(t ?? '').split(';')[0].trim());
const isVideo = (t) => /^video\//i.test(t), isAudio = (t) => /^audio\//i.test(t);
const coded = (code, message) => Object.assign(new Error(message), { code });
const READ_ERRORS = new Set(['hash-mismatch', 'too-large', 'unreachable', 'not-found', 'undecryptable', 'bad-length', 'bad-padding', 'file-hash-mismatch', 'closed']);

/** 显示用的文字：去掉控制字符和格式控制字符（例如从右到左的 U+202E），最多 max 个字符 */
export const plainName = (name, max = 200) => [...String(name ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '')].slice(0, max).join('');
/** 大小：按 1024 进位写 KiB、MiB、GiB、TiB（KiB、MiB 留 1 位小数，GiB 起留 2 位），整数不带 .0（2026-11-15，UX 审计第二轮） */
export function fmtBytes(n) {
  const v0 = Number(n);
  if (!(v0 >= 1024)) return `${Number.isFinite(v0) ? v0 : 0} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0, v = v0 / 1024;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  let r = Number(v.toFixed(i >= 2 ? 2 : 1));                       // Number(...) 去掉末尾的 0：256.0 → 256、2.50 → 2.5
  if (r >= 1024 && i < units.length - 1) { i++; r = Number((r / 1024).toFixed(i >= 2 ? 2 : 1)); }   // 1023.96 KiB 四舍五入成 1024 的，进一位写 1 MiB
  return `${r} ${units[i]}`;
}

/** 组件里各块的类名（页面的样式照它写） */
export const CLASS = Object.freeze({ root: 'trp', info: 'trp-info', body: 'trp-body', actions: 'trp-actions', error: 'trp-error', progress: 'progress', media: 'media' });

// ---- 文字（中文、英文） ----
// 2026-11-15（UX 审计第二轮 docs/AUDIT-2026-11-15-ux-round2.md）：文案在这里一次写好，页面不再在外面改字：存文件的一律叫「节点」（英文 node，单复数分开写；
// 发钥匙的地址是开发者自己的后台，英文照旧叫 key server）；给收链接的人看的写大白话（电路、指纹收进「文件信息」里）；
// 链接写法不对按 sharelink.mjs 给的 reason 查中英文说明（不把 sharelink 的中文消息放进英文说明）；各种错误的消息原文只放在原因那一行。
/** 节点名字（主机:端口）→ 不重复的主机：同一台节点的几个端口算一台 */
const hostsOf = (names) => [...new Set([...(names ?? [])].map((n) => { const s = String(n); const i = s.lastIndexOf(':'); return i > 0 ? s.slice(0, i) : s; }))];
export const PLAYER_TEXT = Object.freeze({
  zh: {
    open: '打开', opening: '正在打开分享的文件', file: '文件信息', content: '内容', save: '保存', error: '出错',
    size: '大小', type: '类型', circuit: '链接里写的电路（不证明是它发的）', fingerprint: '指纹', check: '状态', copyFingerprint: '复制指纹',
    askKey: (h) => `正在向 ${h} 要钥匙`, readChain: () => '正在查找存放这个文件的节点', readInfo: () => '正在取文件信息、核对钥匙',
    verified: '已加密，逐块核对通过', noType: '（没有写类型）', noName: '（没有名字）',
    types: { text: '文本', image: '图片', video: '视频', audio: '音频', pdf: 'PDF 文档', archive: '压缩包', file: '文件' },
    download: '下载', copyLink: '复制链接', copied: '已复制', cantCopy: '复制不了',
    saveNote: '下载时同样逐块核对、解密；核对不过就停下，不存半个文件。',
    saving: (d, t) => `下载：已核对、解密 ${fmtBytes(d)} / ${fmtBytes(t)}`, saved: '已存好。', handed: '已交给浏览器下载。', cancelled: '没有下载（取消了）。',
    tooBigToSave: '这个浏览器存不了这么大的文件：换电脑上的 Chrome 或 Edge 再下载。',
    streaming: '边下边播：拖动进度条只取那一段。', preparing: '正在准备边下边播…',
    memory: '这种格式不能边下边播：先整个核对、解密，再播放。', reading: (d, t) => `读进内存：已核对、解密 ${fmtBytes(d)} / ${fmtBytes(t)}`,
    tooBigToPlay: '这种格式不能边下边播，文件又太大：下载后用播放器看。', cannot: '这个浏览器放不了这种格式：下载后用播放器看。',
    imageTooBig: '图片太大，不在页面里显示：下载后看。', pdfTooBig: 'PDF 太大，不在页面里显示：下载后看。', readingPdf: '读 PDF', pdfNewTab: '在新标签页打开', readingText: '正在读文字', readingImage: '读图片',
    textCut: (n) => `只显示前 ${fmtBytes(n)}，完整的请下载。`, other: '这种文件不在页面里打开：下载后用别的程序打开。',
    reason: (c, d) => (d ? `原因：${c}（${d}）` : `原因：${c}`),
    badLink: {
      url: '这不是一条完整的分享链接。', path: '链接的路径不对，应该是 /f/<电路名>/<指纹> 这样。', circuit: '链接里的电路名不对。',
      envelope: '链接里的文件指纹不对。', key: '链接里的钥匙不完整或被改过。', 'no-key': '链接里没有钥匙（# 后面那一段），可能复制时漏了后半截。',
      keyserver: '链接里发钥匙的地址不对。', servers: '链接里指定的节点（&s= 后面那一段）写法不对。', lang: '链接里的语言（&lang=）写法不对：只能写在最后，是 &lang=zh 或 &lang=en。',
    },
    badLinkAny: '这条链接的写法不对。', badLinkTail: '请向发链接的人要一条完整的链接。',
    e: {
      'bad-link': ['链接不对', () => ''],
      'no-key': ['拿不到钥匙', (m, x) => `向 ${x.keyHost ?? '发钥匙的网站'} 要钥匙没有成功。这是会员内容：可能要先登录那个网站，或者没有看的权限。`],
      chain: ['暂时查不到存放这个文件的节点', () => '读链上的公开记录没有成功。稍后刷新再试。'],
      'no-servers': ['找不到存放这个文件的节点', (m) => m],
      'wrong-key': ['钥匙不对', () => '链接里的钥匙打不开这个文件：链接可能不完整、被改过，或者发错了。'],
      'hash-mismatch': ['内容核对不过', () => '节点给的内容和链接对不上，已经停下、没有显示。可能被人改过：换个时间再试，或者告诉发链接的人。'],
      'all-failed': ['取不到这个文件', (m, x) => {
        const n = x.servers.length, hs = hostsOf(x.servers);
        if (!hs.length) return '没有可以试的节点。';
        const tried = hs.length > 1 ? `试过 ${hs.length} 个节点，都没有给出这个文件` : n > 1 ? `试过 ${hs[0]} 的 ${n} 个地址，都没有给出这个文件` : `试过节点 ${hs[0]}，没有给出这个文件`;
        return `${tried}：可能已经删了，或者节点暂时连不上。`;
      }],
      undecryptable: ['文件解不开', () => '内容都核对过了，但解不开或不合规矩：这个文件可能做坏了，或者不是 TapeRelay 的加密文件。'],
      other: ['出错了', () => '打开时出了没想到的错。'],
    },
    noServersText: {
      // 2026-11-15（UX 审计第五轮）：读链的状态写成中文；电路不存在时不说「现在用不了」
      status: (c, s) => (['no-such-token', 'no-such-cpu', 'not-tapeout'].includes(s) ? `电路 ${c} 不存在：检查分享链接或电路名。`
        : s === 'not-opened' ? `电路 ${c} 的容器还没开通，没有可用的节点。` : s === 'blocked' ? `电路 ${c} 被封禁了，没有可用的节点。`
          : s === 'store-changed' ? `电路 ${c} 的容器合约换过实现，这里还不认，暂时用不了。` : `存放这个文件的电路 ${c} 现在用不了（链上读到的状态是 ${s}），没有可用的节点。`), missing: (c) => `电路 ${c} 的公开记录里还没有写存放文件的节点。`,
      bad: (c, s) => `电路 ${c} 的公开记录不合规矩（${s}），不能用。`, local: (c) => `电路 ${c} 的公开记录里没有能连的节点（本机、内网地址都跳过了）。`,
    },
  },
  en: {
    open: 'Open', opening: 'Opening the shared file', file: 'File details', content: 'Content', save: 'Save', error: 'Error',
    size: 'Size', type: 'Type', circuit: 'Circuit named in the link (not proof of sender)', fingerprint: 'Fingerprint', check: 'Status', copyFingerprint: 'Copy fingerprint',
    askKey: (h) => `Asking ${h} for the key`, readChain: () => 'Looking for the nodes that store this file', readInfo: () => 'Fetching the file details and checking the key',
    verified: 'Encrypted, verified chunk by chunk', noType: '(no type given)', noName: '(no name)',
    types: { text: 'Text', image: 'Image', video: 'Video', audio: 'Audio', pdf: 'PDF document', archive: 'Archive', file: 'File' },
    download: 'Download', copyLink: 'Copy link', copied: 'Copied', cantCopy: 'Could not copy',
    saveNote: 'Downloads are verified and decrypted chunk by chunk too; if a chunk fails the check, the download stops and no partial file is kept.',
    saving: (d, t) => `Downloading: ${fmtBytes(d)} / ${fmtBytes(t)} verified and decrypted`, saved: 'Saved.', handed: 'Handed to the browser to download.', cancelled: 'Not downloaded (cancelled).',
    tooBigToSave: 'This browser cannot save a file this large: download it with Chrome or Edge on a computer.',
    streaming: 'Streaming: seeking only fetches that part.', preparing: 'Preparing to stream…',
    memory: 'This format cannot be streamed: the whole file is verified and decrypted first, then played.', reading: (d, t) => `Reading into memory: ${fmtBytes(d)} / ${fmtBytes(t)} verified and decrypted`,
    tooBigToPlay: 'This format cannot be streamed and the file is too large: download it and use a media player.', cannot: 'This browser cannot play this format: download it and use a media player.',
    imageTooBig: 'The image is too large to show here: download it to view.', pdfTooBig: 'The PDF is too large to show here: download it to view.', readingPdf: 'Reading the PDF', pdfNewTab: 'Open in a new tab', readingText: 'Reading the text', readingImage: 'Reading the image',
    textCut: (n) => `Only the first ${fmtBytes(n)} is shown; download for the full text.`, other: 'This kind of file is not opened in the page: download it and open it with another program.',
    reason: (c, d) => (d ? `Reason: ${c} (${d})` : `Reason: ${c}`),
    badLink: {
      url: 'This is not a complete share link.', path: 'The path of the link is wrong. It should look like /f/<circuit>/<fingerprint>.', circuit: 'The circuit name in the link is not valid.',
      envelope: 'The file fingerprint in the link is not valid.', key: 'The key in the link is incomplete or has been changed.', 'no-key': 'The link has no key (the part after #). It may have been cut off when it was copied.',
      keyserver: 'The key server address in the link is not valid.', servers: 'The nodes listed in the link (the part after &s=) are not valid.', lang: 'The language in the link (&lang=) is not valid: it must come last and be &lang=zh or &lang=en.',
    },
    badLinkAny: 'This link is malformed.', badLinkTail: 'Ask the sender for the complete link.',
    e: {
      'bad-link': ['The link is not valid', () => ''],
      'no-key': ['Could not get the key', (m, x) => `Asking ${x.keyHost ?? 'the key server'} for the key failed. This is members-only content: you may need to sign in to that site first, or you are not allowed to view it.`],
      chain: ['Could not look up the nodes for this file', () => 'Reading the on-chain public record failed. Refresh and try again later.'],
      'no-servers': ['No node holds this file', (m) => m],
      'wrong-key': ['Wrong key', () => 'The key in the link does not open this file: the link may be incomplete, altered, or the wrong one.'],
      'hash-mismatch': ['Content check failed', () => 'What the node sent does not match the link, so nothing was shown. It may have been tampered with: try again later or tell the sender.'],
      'all-failed': ['Could not get this file', (m, x) => {
        const n = x.servers.length, hs = hostsOf(x.servers);
        if (!hs.length) return 'There was no node to try.';
        if (hs.length > 1) return `Tried ${hs.length} nodes; none returned this file. It may have been deleted, or the nodes are unreachable for now.`;
        return `${n > 1 ? `Tried ${n} addresses of ${hs[0]}; none returned this file.` : `Tried the node ${hs[0]}; it did not return this file.`} It may have been deleted, or the node is unreachable for now.`;
      }],
      undecryptable: ['The file cannot be decrypted', () => 'Everything was verified, but it cannot be decrypted or breaks the format rules: the file may be damaged, or it is not a TapeRelay encrypted file.'],
      other: ['Something went wrong', () => 'An unexpected error happened while opening the file.'],
    },
    noServersText: {
      status: (c, s) => (['no-such-token', 'no-such-cpu', 'not-tapeout'].includes(s) ? `Circuit ${c} does not exist: check the share link or the circuit name.`
        : s === 'not-opened' ? `The container of circuit ${c} is not opened yet; it has no usable node.` : s === 'blocked' ? `Circuit ${c} is blocked; it has no usable node.`
          : s === 'store-changed' ? `The container contract of circuit ${c} was upgraded to an implementation not accepted here; it cannot be used for now.` : `Circuit ${c}, which stores this file, cannot be used right now (state: ${s}); it has no usable node.`), missing: (c) => `Circuit ${c}’s public record does not list any storage node yet.`,
      bad: (c, s) => `Circuit ${c}’s public record breaks the rules (${s}) and cannot be used.`, local: (c) => `Circuit ${c}’s public record has no reachable node (local and private addresses are skipped).`,
    },
  },
});

/**
 * 内容类型（manifest 的 contentType，例如 video/mp4）→ 给人看的种类（文本、图片、视频、音频、PDF 文档、压缩包、文件；英文同）。
 * 2026-11-15（UX 审计第三轮 docs/AUDIT-2026-11-15-ux-round3.md）：从官网播放器 entry/player/opener.mjs 挪进组件，开发者自己页面里嵌的播放器（演示站）也写一样的；
 * 原始类型由组件放在 title 上。没写类型的返回空字符串
 */
export function typeLabel(type, lang = 'zh') {
  const K = (PLAYER_TEXT[lang] ?? PLAYER_TEXT.zh).types;
  const t = String(type ?? '').toLowerCase().split(';')[0].trim();
  if (!t) return '';
  if (t.startsWith('text/') || /^application\/(json|xml|javascript)$/.test(t)) return K.text;
  if (t.startsWith('image/')) return K.image;
  if (t.startsWith('video/')) return K.video;
  if (t.startsWith('audio/')) return K.audio;
  if (t === 'application/pdf') return K.pdf;
  if (/^application\/(zip|x-zip-compressed|gzip|x-gzip|x-tar|x-7z-compressed|x-rar-compressed|vnd\.rar|x-bzip2|x-xz|zstd)$/.test(t)) return K.archive;
  return K.file;
}

/** 用哪种语言：给了 saved（zh / en）就用它；否则浏览器的语言里有中文用中文，没有用英文 */
export function pickLang(saved, languages = globalThis.navigator?.languages ?? []) {
  if (saved === 'zh' || saved === 'en') return saved;
  return [...languages].some((l) => /^zh\b/i.test(String(l))) ? 'zh' : 'en';
}

/**
 * 错误 → { kind, title, text, code, detail }。kind 决定样子和测试里的 data-error；code 是给人报问题用的原因代码（链接不对的带 sharelink 的 reason，例如 bad-link (key)）；
 * detail 是消息原文（只有拿不到钥匙、读不到链、都取不到、没想到的错才给；英文页面上是中文的消息不给）。ctx：keyHost（发钥匙的主机）、servers（试过的节点名字）
 */
export function explainError(e, ctx = {}, lang = 'zh') {
  const T = PLAYER_TEXT[lang] ?? PLAYER_TEXT.zh;
  const code = String(e?.code ?? '');
  const msg = String(e?.message ?? e).slice(0, 300);
  const x = { keyHost: ctx.keyHost ?? null, servers: Array.isArray(ctx.servers) ? ctx.servers : [] };
  const raw = lang === 'en' && /[一-鿿]/.test(msg) ? null : msg;
  const pick = (kind, detail = null) => ({ kind, title: T.e[kind][0], text: T.e[kind][1](msg, x), code: code || null, detail: detail && detail !== code ? detail : null });
  if (code === 'bad-link') {
    const reason = typeof e?.reason === 'string' && e.reason ? e.reason : null;
    const known = reason && Object.hasOwn(T.badLink, reason) ? T.badLink[reason] : T.badLinkAny;
    return { kind: 'bad-link', title: T.e['bad-link'][0], text: `${known}${lang === 'zh' ? '' : ' '}${T.badLinkTail}`, code: reason ? `bad-link (${reason})` : 'bad-link', detail: reason ? null : raw };
  }
  if (code === 'no-key') return pick('no-key', raw);
  if (code === 'chain') return { ...pick('chain', raw), kind: 'no-servers' };
  if (code === 'no-servers') return pick('no-servers');
  if (code === 'commitment-mismatch' || code === 'bad-key') return pick('wrong-key');
  if (code === 'hash-mismatch' || code === 'too-large' || code === 'file-hash-mismatch') return pick('hash-mismatch');
  if (code === 'unreachable' || code === 'not-found' || Number.isInteger(e?.status)) return pick('all-failed', raw);
  if (['undecryptable', 'bad-length', 'bad-padding', 'manifest-undecryptable', 'bad-manifest', 'bad-magic', 'bad-version', 'bad-count'].includes(code)) return pick('undecryptable');
  return pick('other', raw);
}

/** 造 DOM（外来的文字一律 textContent，不用 innerHTML）：属性里 on 是 { 事件: 函数 }；值为 true 写成空属性，false、null、undefined 不写 */
function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === 'on') { for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); continue; }
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') e.className = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
const fill = (node, ...children) => node.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));

/** 线条图标（内联 SVG，1.5 像素线宽，跟着文字的颜色）：download、link、copy、alert、spin */
const ICONS = {
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 19h14'],
  link: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  alert: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17v.01'],
  spin: ['M12 3a9 9 0 1 0 9 9'],
};
function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '18'], ['height', '18'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.5'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true'], ['class', `icon icon-${name}`]]) svg.setAttribute(k, v);
  for (const d of ICONS[name]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}

/**
 * 读法：按块（1 MiB 左右）读、记住最近 cache 块、同一块同时只取一次（边下边播的几段读、下载可能同时要同一块）。
 * f：openEncryptedFileWithKey 给的（每块核对哈希、解开）。返回 { size, read(a, b), fetched（取过几块） }
 */
// 2026-11-13：读第 i 块时顺手在后台取后面 ahead 块（同时下载几块，远距离、往返慢的线路上快一倍多）；cache 要比 ahead 大
export function chunkedReader(f, { cache = 16, ahead = 6 } = {}) {
  const size = f.manifest.size;
  const recent = new Map(), inflight = new Map();
  let fetched = 0, lastEnd = -1;   // 第一次读（认格式）不预取：目录在文件末尾的，免得和取末尾那一段抢带宽
  const load = (i) => {
    if (recent.has(i)) { const v = recent.get(i); recent.delete(i); recent.set(i, v); return Promise.resolve(v); }
    if (inflight.has(i)) return inflight.get(i);
    fetched++;
    const p = f.read(i * ENCRYPTED_CHUNK, Math.min(size, (i + 1) * ENCRYPTED_CHUNK)).then((pt) => {
      recent.set(i, pt);
      if (recent.size > cache) recent.delete(recent.keys().next().value);
      return pt;
    }).finally(() => inflight.delete(i));
    inflight.set(i, p);
    return p;
  };
  return {
    size,
    get fetched() { return fetched; },
    /** 清掉记住的明文（播放器关掉时） */
    clear() { for (const pt of recent.values()) pt.fill(0); recent.clear(); },
    async read(a, b) {
      if (!(Number.isSafeInteger(a) && Number.isSafeInteger(b) && a >= 0 && b <= size && a < b)) throw coded('bad-range', '读取的范围不对');
      const first = Math.floor(a / ENCRYPTED_CHUNK), last = Math.floor((b - 1) / ENCRYPTED_CHUNK);
      // 预取只在顺着往下读的时候做（正好接着上一次读完的位置）；拖动、找位置那种跳着读的不预取，免得白取
      const total = Math.ceil(size / ENCRYPTED_CHUNK);
      const sequential = a === lastEnd;                                      // 正好接着上一次读完的位置
      lastEnd = b;
      if (sequential) for (let i = last + 1; i <= Math.min(total - 1, last + ahead); i++) if (!recent.has(i) && !inflight.has(i)) load(i).catch(() => {});   // 出错的等真要读时再报
      if (first === last) { const pt = await load(first); return pt.subarray(a - first * ENCRYPTED_CHUNK, b - first * ENCRYPTED_CHUNK); }
      const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, k) => load(first + k)));
      const out = new Uint8Array(b - a);
      let o = 0;
      parts.forEach((pt, k) => {
        const i = first + k, part = pt.subarray(i === first ? a - i * ENCRYPTED_CHUNK : 0, i === last ? b - i * ENCRYPTED_CHUNK : pt.length);
        out.set(part, o);
        o += part.length;
      });
      return out;
    },
  };
}

/**
 * 读电路的公开记录（发现文件）里的服务器名字；allowLocal 为假时跳过本机、内网地址。
 * circuit：电路名，可以只写 1.2.0（补成链上的完整写法 1.2.0.tape）；认不出的抛 code 为 bad-circuit 的错误（不去读链）
 */
export async function serversOf(kernel, circuit, { allowLocal = false, lang = 'zh' } = {}) {
  if (typeof circuit === 'string') circuit = normalizeCircuitInput(circuit) ?? circuit;   // 2026-11-15（UX 审计第四轮）：可以只写 1.2.0
  if (!isAccount(circuit)) throw coded('bad-circuit', lang === 'en' ? 'Not a valid circuit name, e.g. 1.2.0' : '电路名不对，例如 1.2.0');
  const N = (PLAYER_TEXT[lang] ?? PLAYER_TEXT.zh).noServersText;
  const shown = circuit.replace(/\.tape$/, '');                   // 报错里的电路名照用户的写法（1.2.0）
  let d;
  try {
    const res = await kernel.resolve(circuit, { chainId: chainOf(circuit) });
    if (res?.status !== 'ok' && res?.status !== 'unpaid') throw Object.assign(coded('no-servers', N.status(shown, String(res?.status ?? '?'))), { status: String(res?.status ?? '') });   // 2026-11-12：容器付没付费（TapeKit 的网站托管费）与本协议无关，unpaid 与 ok 同等对待；仍要求容器已开通
    d = await readDiscovery(kernel, res, circuit);
  } catch (e) {
    if (e?.code === 'no-servers') throw e;
    throw coded('chain', String(e?.message ?? e).slice(0, 200));
  }
  if (d.status !== 'ok') throw coded('no-servers', d.status === 'missing' ? N.missing(shown) : N.bad(shown, d.status));
  const names = d.serverNames.filter((n) => allowLocal || !isLocalHost(n.slice(0, n.lastIndexOf(':'))));
  if (!names.length) throw coded('no-servers', N.local(shown));
  return names;
}

/** 会员内容（D-666）：GET <ks>?circuit=…&envelope=…（带那个网站的 cookie），回 { "k": "<base64url>" } */
async function keyFromServer(doFetch, ks, circuit, envelope) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), KEY_TIMEOUT_MS);
  try {
    let r;
    try {
      r = await doFetch(`${ks}?circuit=${encodeURIComponent(circuit)}&envelope=${envelope}`, { credentials: 'include', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: ac.signal, headers: { accept: 'application/json' } });
    } catch { throw coded('no-key', 'unreachable'); }
    if (!r.ok) { await r.body?.cancel().catch(() => {}); throw coded('no-key', `HTTP ${r.status}`); }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > KEY_REPLY_MAX) throw coded('no-key', 'reply too long');
    let j;
    try { j = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf)); } catch { throw coded('no-key', 'not JSON'); }
    return parseFileKey(j?.k) ?? (() => { throw coded('no-key', 'not a 32-byte key'); })();
  } finally { clearTimeout(timer); }
}

/** 来源 → { circuit, envelope, fileKey 或 keyServer, link（整条网址，复制用） } */
function sourceOf(source) {
  if (source?.link !== undefined) {
    const raw = String(source.link);
    const u = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? new URL(raw) : null;
    const parsed = parseSharePath(u ? u.pathname : (source.path ?? raw.split('#')[0]), u ? u.hash : (source.hash ?? (raw.includes('#') ? raw.slice(raw.indexOf('#')) : '')));
    return { ...parsed, link: u ? u.href : null };
  }
  if (source && typeof source === 'object' && source.path !== undefined) return { ...parseSharePath(source.path, source.hash ?? ''), link: null };
  // 直接给的：和分享链接同一套规矩（电路名、64 位小写十六进制的指纹、32 字节的钥匙或 https 的发钥匙地址）；
  // 2026-11-15（UX 审计第四轮）：直接给的电路名可以只写 1.2.0，补成完整写法（链接里的照旧只认完整写法）
  if (source && typeof source === 'object' && typeof source.circuit === 'string') source = { ...source, circuit: normalizeCircuitInput(source.circuit) ?? source.circuit };
  if (!isAccount(String(source?.circuit ?? '')) || !/^[0-9a-f]{64}$/.test(String(source?.envelope ?? ''))) throw coded('bad-link', 'bad circuit or envelope');
  if (source.fileKey) {
    if (!(source.fileKey instanceof Uint8Array) || source.fileKey.length !== 32) throw coded('bad-link', 'the file key must be 32 bytes');
    return { circuit: source.circuit, envelope: source.envelope, fileKey: Uint8Array.from(source.fileKey), keyServer: null, link: null };
  }
  const keyServer = checkKeyServer(source.keyServer);
  if (!keyServer) throw coded('bad-link', 'the key server must be an https address without query or fragment');
  return { circuit: source.circuit, envelope: source.envelope, fileKey: null, keyServer, link: null };
}

/**
 * 在 target 里放一个播放器。source、选项见文件开头；选项：kernel（TapeKit 内核，默认 createKernel()）、client（默认 createClient({ fetch })）、
 * servers（直接给服务器名字，就不读公开记录）、allowLocal、fetch（要会员钥匙用，默认全局的）、lang（zh、en，默认照浏览器的语言）、layout（compact、cards）、
 * className、download（默认 true）、copyLink（默认 false；给字符串就复制它，给 true 复制来源里的整条链接）、memoryMax、streamAhead（边下边播往后缓冲几秒，默认 30）、
 * saveTiers（测试用）、
 * onState({ state: loading | ready | error, error, kind })。返回见文件开头
 */
export function mountPlayer(target, source, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : opts.lang === 'zh' ? 'zh' : pickLang(null);
  const T = PLAYER_TEXT[lang];
  const layout = opts.layout === 'cards' ? 'cards' : 'compact';
  const memoryMax = opts.memoryMax ?? PLAYER_MEMORY_MAX;
  const doFetch = opts.fetch ?? ((u, i) => globalThis.fetch(u, i));
  const root = h('div', { class: [CLASS.root, layout === 'cards' ? 'trp-cards' : 'trp-compact', opts.className].filter(Boolean).join(' '), lang: lang === 'zh' ? 'zh-CN' : 'en' });
  fill(target, root);
  let file = null, stream = null, reader = null, failed = false, closed = false, lastServers = [], kind = 'none', state = 'loading';
  const urls = [];
  const setState = (s, extra = {}) => { state = s; root.dataset.state = s; if (extra.error) root.dataset.error = extra.error; else delete root.dataset.error; opts.onState?.({ state: s, error: extra.error ?? null, kind }); };
  /** 一块：cards 布局是一张带编号的卡片，compact 是一个 div */
  const block = (cls, eyebrow, ...kids) => (layout === 'cards'
    ? h('section', { class: `card ${cls}` }, eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null, ...kids)
    : h('div', { class: cls }, ...kids));

  const progress = h('div', { class: CLASS.progress, hidden: true }, h('div', { class: 'bar' }, h('span')), h('p', { class: 'muted small' }));
  function setProgress(text, done = null, total = null) {
    progress.hidden = !text;
    progress.querySelector('p').textContent = text ?? '';
    progress.querySelector('.bar span').style.width = total ? `${Math.min(100, Math.round((done / total) * 100))}%` : '100%';
    progress.classList.toggle('busy', !total);
  }
  function loading(step) {
    fill(root, block(`${CLASS.body} loading`, null, layout === 'cards' ? h('div', { class: 'load-head' }, icon('spin'), h('h1', { class: 'title' }, T.opening)) : null, progress));
    setProgress(step);
  }
  function showError(e, ctx = {}) {
    if (failed || closed) return;
    failed = true;
    const x = explainError(e, { ...ctx, servers: ctx.servers ?? lastServers }, lang);
    for (const v of root.querySelectorAll('video, audio')) { v.pause?.(); v.removeAttribute('src'); try { v.srcObject = null; } catch { /* 没有 srcObject */ } }
    stream?.close();
    fill(root, block(`${CLASS.error} error`, null, h('div', { class: 'err-head' }, icon('alert'), h('span', { class: 'eyebrow' }, T.error)),
      h(layout === 'cards' ? 'h1' : 'p', { class: 'title' }, x.title), h('p', {}, x.text), x.code ? h('p', { class: 'muted small mono err-code' }, T.reason(x.code, x.detail)) : null));
    root.querySelector(`.${CLASS.error}`)?.setAttribute('role', 'alert');
    setState('error', { error: x.kind });
    file?.close();
  }

  async function readAll(label) {
    const total = file.manifest.size;
    const whole = file.manifest.sha256 ? sha256.create() : null;
    const parts = [];
    for (let a = 0; a < total; a = Math.min(total, a + ENCRYPTED_CHUNK)) {
      const b = Math.min(total, a + ENCRYPTED_CHUNK);
      setProgress(label(b, total), b, total);
      const part = await reader.read(a, b);
      whole?.update(part);
      parts.push(part);
    }
    if (whole && Array.from(whole.digest(), (x) => x.toString(16).padStart(2, '0')).join('') !== file.manifest.sha256) throw coded('file-hash-mismatch', 'whole-file SHA-256 does not match the manifest');
    setProgress(null);
    return parts;
  }
  const blobUrl = (parts, type) => { const u = URL.createObjectURL(new Blob(parts, { type })); urls.push(u); return u; };

  async function playMedia(box, type, size) {
    const video = isVideo(type);
    const player = h(video ? 'video' : 'audio', { controls: true, preload: 'metadata', playsinline: true });
    player.style.width = '100%';
    const status = h('p', { class: 'muted small' }, T.preparing);
    const cannot = h('p', { class: 'muted small', hidden: true }, T.cannot);
    fill(box, h('div', { class: `${CLASS.media} ${video ? 'video' : 'audio'}` }, player), status, cannot, progress);
    let triedMemory = false;
    const toMemory = async () => {
      triedMemory = true;
      stream?.close();
      stream = null;
      if (size > memoryMax) { kind = 'none'; status.textContent = T.tooBigToPlay; player.hidden = true; return; }
      kind = 'memory';
      status.textContent = T.memory;
      const u = blobUrl(await readAll(T.reading), type);
      try { player.srcObject = null; } catch { /* 没有 srcObject */ }
      player.src = u;
    };
    player.addEventListener('error', () => {
      if (failed || closed || !player.error) return;                // 换了来源以后才到的旧来源的错误：不算
      if (!triedMemory && kind !== 'memory' && size <= memoryMax) { toMemory().catch((e) => showError(e)); return; }   // 边下边播喂不进去：退回整个读进内存
      cannot.hidden = false;
      status.hidden = true;
    });
    try {
      stream = await streamMedia(player, reader, { ahead: opts.streamAhead ?? 30, onError: (e) => {
        if (READ_ERRORS.has(String(e?.code)) || Number.isInteger(e?.status)) showError(e);    // 读不到、核对不过：出错卡片，不显示半截内容
        else if (!triedMemory) toMemory().catch((x) => showError(x));
      } });
      kind = stream.kind;
      status.textContent = T.streaming;
    } catch (e) {
      if (READ_ERRORS.has(String(e?.code)) || Number.isInteger(e?.status)) throw e;
      await toMemory();
    }
  }

  async function showContent(box, name, type) {
    const size = file.manifest.size;
    const note = (t) => fill(box, h('p', { class: 'muted' }, t));
    if (isVideo(type) || isAudio(type)) return playMedia(box, type, size);
    if (isImage(type)) {
      if (size > IMAGE_MAX) { note(T.imageTooBig); return; }
      const img = h('img', { alt: name });
      img.src = blobUrl(await readAll((d, t) => `${T.readingImage}: ${fmtBytes(d)} / ${fmtBytes(t)}`), type);
      fill(box, h('div', { class: `${CLASS.media} image` }, img));
      return;
    }
    // 2026-11-17：PDF 在页面里显示：整份读完、逐块和整份核对过，开头是 %PDF- 才交给浏览器自带的阅读器（Blob 的类型由这里定成 application/pdf，
    // 内容不是 PDF 的不显示，免得把别的内容当网页打开）；另给「在新标签页打开」，页面的 CSP 不许内嵌框架时（例如嵌在别的站里）照样能看
    if (isPdf(type)) {
      if (size > PDF_MAX) { note(T.pdfTooBig); return; }
      const parts = await readAll((d, t) => `${T.readingPdf}: ${fmtBytes(d)} / ${fmtBytes(t)}`);
      const head = new Uint8Array(await new Blob(parts).slice(0, 5).arrayBuffer());
      if (String.fromCharCode(...head) !== '%PDF-') { note(T.other); return; }
      const u = blobUrl(parts, 'application/pdf');
      const frame = h('iframe', { src: u, title: name });
      const open = h('a', { href: u, target: '_blank', rel: 'noopener', class: 'small' }, T.pdfNewTab);
      fill(box, h('div', { class: `${CLASS.media} pdf` }, frame), h('p', { class: 'muted small' }, open));
      return;
    }
    if (isText(type)) {
      setProgress(T.readingText);
      const bytes = await reader.read(0, Math.min(size, TEXT_MAX));
      setProgress(null);
      const pre = h('pre', { class: 'text' });
      pre.textContent = new TextDecoder().decode(bytes);
      fill(box, pre, size > TEXT_MAX ? h('p', { class: 'muted small' }, T.textCut(TEXT_MAX)) : null);
      return;
    }
    note(T.other);
  }

  function download(saveState) {
    if (!file || failed) return;
    const name = file.manifest.name;
    let p;
    try {
      p = saveFile({ manifest: file.manifest, read: reader.read }, { name, memoryMax: opts.saveMemoryMax ?? SAVE_MEMORY_MAX, tiers: opts.saveTiers,
        onProgress: (d, t) => { saveState.textContent = T.saving(d, t); } });                    // 同步调用：先开「另存为」对话框
    } catch (e) { showError(e); return; }
    p.then((r) => { saveState.textContent = r.how === 'cancelled' ? T.cancelled : r.how === 'picker' ? T.saved : T.handed; root.dataset.saved = r.how; })
      .catch((e) => { if (e?.code === 'too-large-to-save') saveState.textContent = T.tooBigToSave; else showError(e); });
  }
  /** 复制 text；label 为 null 时（只有图标的按钮）在 title 上提示 */
  async function copy(el, text, label) {
    let ok = true;
    try { await navigator.clipboard.writeText(text); } catch { ok = false; }
    if (label === null) { el.title = ok ? T.copied : T.cantCopy; el.classList.toggle('done', ok); setTimeout(() => { el.title = T.copyFingerprint; el.classList.remove('done'); }, 2000); return; }
    el.textContent = ok ? T.copied : T.cantCopy;
    setTimeout(() => { el.textContent = label; }, 2000);
  }

  async function render(src) {
    setProgress(null);
    const m = file.manifest;
    const name = plainName(m.name, 200) || T.noName;
    const type = plainName(m.contentType, 100);
    const body = h('div', { class: 'preview' });
    const saveState = h('p', { class: 'muted small save-state' });
    const linkText = typeof opts.copyLink === 'string' ? opts.copyLink : opts.copyLink === true ? src.link : null;
    const buttons = [
      opts.download === false ? null : h('button', { class: 'btn primary', type: 'button', on: { click: () => download(saveState) } }, icon('download'), h('span', {}, T.download)),
      linkText ? h('button', { class: 'btn', type: 'button', on: { click: (ev) => copy(ev.currentTarget.querySelector('span'), linkText, T.copyLink) } }, icon('link'), h('span', {}, T.copyLink)) : null,
    ].filter(Boolean);
    // 类型写给人看的种类（文本、视频……），原始类型放在 title 上（2026-11-15，UX 审计第三轮）
    const typeAttrs = type ? { title: type, 'data-raw-type': type } : {};
    const typeText = typeLabel(type, lang) || T.noType;
    const meta = h('p', { class: 'meta' }, h('span', {}, fmtBytes(m.size)), h('span', { class: 'dot', ...typeAttrs }, typeText), h('span', { class: 'dot ok' }, h('i', { class: 'state-dot' }), T.verified));
    const actions = buttons.length ? block(`${CLASS.actions} actions`, T.save, h('div', { class: 'row' }, buttons), saveState, h('p', { class: 'muted small' }, T.saveNote)) : null;
    if (layout === 'cards') {
      const fp = h('span', { class: 'mono fp', title: src.envelope }, `${src.envelope.slice(0, 10)}…${src.envelope.slice(-8)}`);
      const fpCopy = h('button', { class: 'icon-btn', type: 'button', title: T.copyFingerprint, 'aria-label': T.copyFingerprint, on: { click: (ev) => copy(ev.currentTarget, src.envelope, null) } }, icon('copy'));
      // 2026-11-15：收链接的人先看到内容和保存；电路、指纹这些收进「文件信息」（默认收起，点开才看）
      fill(root,
        h('section', { class: `card ${CLASS.body} content` }, h('div', { class: 'content-head' }, h('h1', { class: 'title name' }, name), meta), body),
        h('div', { class: 'below' },
          actions,
          h('details', { class: `card ${CLASS.info} file` }, h('summary', { class: 'eyebrow' }, T.file),
            h('dl', { class: 'facts' },
              h('dt', {}, T.size), h('dd', {}, fmtBytes(m.size)),
              h('dt', {}, T.type), h('dd', typeAttrs, typeText),
              h('dt', {}, T.check), h('dd', { class: 'ok' }, h('i', { class: 'state-dot' }), T.verified),
              h('dt', {}, T.circuit), h('dd', { class: 'mono' }, src.circuit),
              h('dt', {}, T.fingerprint), h('dd', { class: 'fp-row' }, fp, fpCopy)))));
    } else {
      fill(root, block(`${CLASS.info} file`, null, h('p', { class: 'title name' }, name), meta), block(CLASS.body, null, body), actions);
    }
    await showContent(body, name, type);
    if (!failed && !closed) setState('ready');
  }

  async function open() {
    setState('loading');
    cleanupTempDownloads().catch(() => {});
    let src, key = null, keyHost = null;
    try {
      src = sourceOf(source);
      keyHost = src.keyServer ? new URL(src.keyServer).host : null;
      key = src.fileKey;
      // 发钥匙的地址与服务器同一个规矩：本机、内网地址不连（链接谁都能写，免得借播放器去碰用户自己网络里的东西）
      if (!key && !opts.allowLocal && isLocalHost(new URL(src.keyServer).hostname)) throw coded('no-key', 'local or private address');
      if (!key) { loading(T.askKey(keyHost)); key = await keyFromServer(doFetch, src.keyServer, src.circuit, src.envelope); }
      // 2026-11-13：链接 # 后面带了服务器名字（&s=）的，先直接到那几台取，省掉读链；取不到再读链上的公开记录重来
      const viaChain = async () => { loading(T.readChain(src.circuit)); return serversOf(opts.kernel ?? createKernel(), src.circuit, { allowLocal: !!opts.allowLocal, lang }); };
      const hinted = !opts.servers && Array.isArray(src.servers) ? src.servers.filter((n) => opts.allowLocal || !isLocalHost(n.slice(0, n.lastIndexOf(':')))) : [];
      if (opts.servers) lastServers = [...opts.servers];
      else lastServers = hinted.length ? hinted : await viaChain();
      loading(T.readInfo(lastServers.length));
      const client = opts.client ?? createClient({ fetch: (u, i) => globalThis.fetch(u, i), mirrors: 'auto' });   // 节点声明了镜像就从镜像读
      try {
        file = await openEncryptedFileWithKey(client, lastServers, src.envelope, key, { cacheChunks: 0 });   // 开发包另存一份钥匙，close() 时清掉
      } catch (e) {
        if (!hinted.length || lastServers !== hinted || e?.code === 'commitment-mismatch' || e?.code === 'bad-key') throw e;   // 钥匙不对换服务器也没用
        lastServers = await viaChain();
        loading(T.readInfo(lastServers.length));
        file = await openEncryptedFileWithKey(client, lastServers, src.envelope, key, { cacheChunks: 0 });
      }
      reader = chunkedReader(file, { ahead: (opts.streamAhead ?? 30) < 10 ? 1 : 6 });   // 只往后缓冲几秒时少预取，别超过要缓冲的量
      if (closed) { file.close(); return; }
      await render(src);
    } catch (e) {
      showError(e, { keyHost });
    } finally {
      key?.fill(0);
    }
  }

  const done = open();
  return {
    done, media: () => root.querySelector('video, audio'),
    get state() { return state; }, get kind() { return kind; },
    get stats() { return { ...(stream?.stats ?? {}), chunksFetched: reader?.fetched ?? 0 }; },
    close() {
      if (closed) return;
      closed = true;
      stream?.close();
      for (const v of root.querySelectorAll('video, audio')) { v.pause?.(); v.removeAttribute('src'); }
      for (const u of urls) URL.revokeObjectURL(u);
      reader?.clear();
      file?.close();
    },
  };
}
