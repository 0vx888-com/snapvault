// TapeRelay 客户端库：把一个网站（一组文件）发布到容器网站（前端第 2 步，D-682、D-685、D-690、D-695；docs/FRONTENDS-DESIGN.md 第五节）。
// 2026-11-08 由编写窗口编写。官方控制台（开发者发布自己的发布站、自己那份播放器）、官方运营商站（运营商发布自己的发布站）、本机预览都用它。
// 一律用钱包发：这里不碰私钥，交易由调用方给的 chain.send 发（浏览器里是钱包，本机测试是假链）。
// 两步走，页面先给用户看「要发几笔」再让用户确认：
// 1. planSitePublish：读链上已有的（每个文件的 fileInfo、单页回退），算出每个文件要发几笔：
//    - 链上已有同一份（大小、声明的 SHA-256、内容类型、块数都对）→ 0 笔；
//    - 链上有同一份的前几块（写到一半断了）→ 剩下的块数（writeSiteFile 会接着写）；
//    - 别的 → ⌈大小 ÷ 24,000⌉ 笔（第一块 putFile，之后 appendChunk）；
//    单页回退和要的不同 → 再 1 笔 setFallback。链上有、这次没有的文件只列出来（stale），不删。
// 2. executeSitePublish：照计划逐个文件 writeSiteFile（写完读回核对），再 setFallback；每发一笔回调一次 onStep。
//    计划之后链上变了（别处写了）也不要紧：writeSiteFile 每个文件开写前会重新看链上的。
// chain：{ call({ to, data }), send({ to, data }) }（同 siteregistry.mjs）。
import { SITE_CHUNK, SITE_MAX_CHUNKS, fileInfo, writeSiteFile, fallbackPath, setFallback } from './siteregistry.mjs';
import { sha256Hex } from './core.mjs';

const PATH = /^[A-Za-z0-9._~!$&'()*+,;=:@-]+(\/[A-Za-z0-9._~!$&'()*+,;=:@-]+)*$/;
const bad = (message) => { throw Object.assign(new Error(message), { code: 'bad-site' }); };

/** 一个文件要几笔（链上已有的 info 和要写的比） */
function txsFor(info, bytes, sha, contentType) {
  const total = Math.ceil(bytes.length / SITE_CHUNK);
  const sameHead = info.chunkCount > 0 && info.sha256 === sha && info.contentType === contentType && info.chunkCount <= total
    && info.size === Math.min(bytes.length, info.chunkCount * SITE_CHUNK);
  return { total, txs: sameHead ? total - info.chunkCount : total, reason: !sameHead ? (info.chunkCount ? 'changed' : 'new') : info.chunkCount === total ? 'same' : 'resume' };
}

/**
 * files：[{ path（网站里的路径，不以 / 开头）, contentType, bytes（Uint8Array） }]；fallback：单页回退的路径（'' 或 null 是不管）；
 * known：可选，网站里已有的路径列表（例如内核读出的清单），用来列出这次没有的旧文件。
 * 返回 { registry, container, files: [{ path, size, sha256, contentType, chunks, txs, reason: new|changed|resume|same }],
 *        fallback: { want, now, txs }, stale: [路径], txs（合计笔数）, bytes（要写的字节数） }
 */
export async function planSitePublish({ chain, registry, container, files, fallback = 'index.html', known = [] }) {
  if (!Array.isArray(files) || !files.length) bad('网站里没有文件');
  const seen = new Set();
  const out = [];
  for (const f of files) {
    if (typeof f?.path !== 'string' || !PATH.test(f.path) || f.path.split('/').some((x) => x === '.' || x === '..')) bad(`路径不对：${String(f?.path)}`);
    if (seen.has(f.path)) bad(`路径重复：${f.path}`);
    seen.add(f.path);
    if (!(f.bytes instanceof Uint8Array) || f.bytes.length < 1 || f.bytes.length > SITE_CHUNK * SITE_MAX_CHUNKS) bad(`${f.path} 的大小要在 1～8,400,000 字节之间`);
    if (typeof f.contentType !== 'string' || !f.contentType) bad(`${f.path} 没有内容类型`);
    const sha = sha256Hex(f.bytes);
    const info = await fileInfo(chain, registry, container, f.path);
    const t = txsFor(info, f.bytes, sha, f.contentType);
    out.push({ path: f.path, size: f.bytes.length, sha256: sha, contentType: f.contentType, chunks: t.total, txs: t.txs, reason: t.reason });
  }
  if (fallback && !seen.has(fallback)) bad(`单页回退的 ${fallback} 不在这次的文件里`);
  const now = fallback ? await fallbackPath(chain, registry, container) : '';
  const fb = { want: fallback || '', now, txs: fallback && now !== fallback ? 1 : 0 };
  const stale = [...new Set(known)].filter((p) => !seen.has(p)).sort();
  return { registry, container, files: out, fallback: fb, stale, txs: out.reduce((a, f) => a + f.txs, 0) + fb.txs,
    bytes: out.filter((f) => f.txs).reduce((a, f) => a + f.size, 0) };
}

/**
 * 照计划发布。files：和计划时同一份（按路径对上；内容变了就停下，免得发的和用户确认的不是一回事）。
 * onStep({ path, done, total, sent })：每发完一笔调用一次（sent：这次一共发了几笔）。返回 { sent（实际发的笔数） }。
 */
export async function executeSitePublish({ chain, plan, files, onStep }) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  let sent = 0;
  for (const p of plan.files) {
    const f = byPath.get(p.path);
    if (!f || sha256Hex(f.bytes) !== p.sha256 || f.contentType !== p.contentType) bad(`${p.path} 和计划时的不一样了：重新算一遍再发`);
    if (!p.txs) continue;
    const before = sent;
    const r = await writeSiteFile({ chain, registry: plan.registry, container: plan.container, path: p.path, contentType: p.contentType, bytes: f.bytes,
      onProgress: ({ done, total }) => { sent++; onStep?.({ path: p.path, done, total, sent }); } });
    sent = before + r.written;
  }
  if (plan.fallback.txs) {
    await setFallback({ chain, registry: plan.registry, container: plan.container, path: plan.fallback.want });
    sent++;
    onStep?.({ path: '（单页回退）', done: 1, total: 1, sent });
  }
  return { sent };
}
