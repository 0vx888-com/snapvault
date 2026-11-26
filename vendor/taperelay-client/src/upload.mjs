// TapeRelay 客户端库：上传一个公开文件（TapeRelay §6.3「上传一个文件的步骤」、Files §3；用例 C6）。2026-10-11 由主编写窗口编写（CHANGELOG 第 90 条）。
// 1. 本地算出全部块和索引对象的哈希（files.mjs）；2. 每 1,000 个一批认领；3. 只上传 missing 里列出的；
// 4. 断了以后续传：再调一次就从第 2 步重来，已经传上去的会在认领时记到名下、不再上传。
// 不得只用 HEAD 查到对象已有就跳过上传（TapeRelay §6.3）：一律以认领的结果为准。
// 第 150 条（阶段 3 第 1 步）：也能传加密文件的计划（encrypted.mjs 的 planEncryptedFile）：块的字节由计划的 chunkBytes(i) 给
// （重新加密并核对哈希）；信封等 extraObjects 最后传，它在了，其余对象就都在了。公开文件的做法不变。
// 第 409 条（I-351，D-471 甲）：signal（AbortSignal）停下时，在下一次认领、上传之前报 aborted（不是暂时的错误，不再重试）；
// 正在传的那一个对象照常传完（最多 1 MiB）。
// 2026-10-29（D-518、D-519）：同时传到几台的 uploadToServers（原来在 replicas.mjs，D-343、第 409 条）挪到这里：上传、认领是 TapeRelay 的
// （发文件时附件也要这样交给自己的几台服务器）；核对、补副本要用列出，留在 replicas.mjs（TapeStore）。写法不变。
import { planPublicFile } from './files.mjs';
import { CHUNK } from './manifest.mjs';
import { refusedMessage } from './devkey.mjs';

const CLAIM_BATCH = 1000;
const MAX_SERVERS = 8;                       // 发现文件最多列 8 台（TapeRelay §4.3）
const NEED = 2;                              // 列了 2 台以上时，存好 2 台就算存好（TapeStore §3，D-343）
const RETRY_MS = [5000, 30000, 120000];      // 后台重试：隔 5 秒、30 秒、2 分钟各再试一次
const TRANSIENT = new Set(['unreachable', 'rate-limited', 'chain-unavailable', 'internal']);
const transient = (e) => TRANSIENT.has(e?.code) || e?.status >= 500;
/** 等 ms 毫秒；signal 停下时马上结束、清掉计时器（I-399 第 2 点：不然 --no-wait 的命令要等后台重试的计时器到点才退出） */
const sleep = (ms, signal = null) => new Promise((ok) => {
  if (signal?.aborted) return ok();
  const done = () => { clearTimeout(t); signal?.removeEventListener('abort', done); ok(); };
  const t = setTimeout(done, ms);
  signal?.addEventListener('abort', done, { once: true });
});

/**
 * 2026-11-16（UX 审计第六轮）：一台没传成的常见原因写成中文（不带服务器名字）；createTapeStore 没存够时的报错也用这几句。
 * 节点回 delegation-invalid 的另按签名方式说（devkey.mjs 的 refusedMessage：缺「存文件、读文件」权限、开发者密钥不认、会话授权不认）
 */
const FAILURE_TEXT = {
  unreachable: '连不上',
  'rate-limited': '请求太频繁，等一会儿再试',
  'quota-exceeded': '空间不够：到控制台「节点」页买套餐，或删掉不用的文件',
  'storage-full': '节点的硬盘快满了，暂时不收新的上传',
  'container-status': '电路的容器现在不能存文件（还没开通，或已经停用）',
  'operator-exiting': '节点的运营方已声明退出，不再收新的上传',
  'chain-unavailable': '节点暂时读不了链，等一会儿再试',
};
/** 一台没传成的原因（{ code, message }）→ 给人看的话，不带服务器名字：认得的写中文，别的写错误码 */
export function failureText(x, auth) {
  if (x.code === 'delegation-invalid') { const r = refusedMessage(auth, 'objects'); if (r) return r; }
  if ((x.code === 'developer-key-expired' || x.code === 'aborted') && x.message) return x.message;
  return FAILURE_TEXT[x.code] ?? x.code;
}

/** 错误码可能是服务器回的字符串，截短再交给调用方显示（replicas.mjs 也用） */
export const errOf = (e) => ({ code: String(e?.code ?? 'error').slice(0, 64), message: String(e?.message ?? e).slice(0, 200) });
/** 服务器名字的列表：1～8 台、不重复（replicas.mjs 也用） */
export const checkServers = (servers) => {
  if (!Array.isArray(servers) || servers.length < 1 || servers.length > MAX_SERVERS || new Set(servers).size !== servers.length) throw new Error(`servers 要有 1～${MAX_SERVERS} 台、不得重复`);
};

/** signal 停下了就报 aborted（第 409 条） */
export function checkAborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error('上传停下了'), { code: 'aborted' });
}

/**
 * 把文件上传到一台服务器（要上传到几台就调几次）。返回 { manifest, manifestJson, fileId, uploaded, claimed }。
 * plan：可以传入 planPublicFile 的结果（几台服务器共用一份，不必重算哈希）。onProgress({ done, total })：每传完一个对象调用一次。
 * signal：AbortSignal，停下时报 aborted（第 409 条）。
 */
// 2026-11-14：claim 为假时不先认领，全部对象直接上传（节点上已有的照样收、按内容去重）。给只肯签上传、不签认领的后台用（模板 A 的演示站）
export async function uploadFile(client, name, auth, input, { plan, fileName, contentType, onProgress, signal, claim = true } = {}) {
  const p = plan ?? await planPublicFile(input, { name: fileName, contentType });
  const extra = p.extraObjects ?? [];
  const objects = [...p.indexObjects.map((o) => o.sha256), ...p.chunkHashes, ...extra.map((o) => o.sha256)];
  const missing = new Set();
  let claimed = 0;
  if (!claim) for (const sha of objects) missing.add(sha);
  for (let i = 0; claim && i < objects.length; i += CLAIM_BATCH) {
    checkAborted(signal);
    const batch = [...new Set(objects.slice(i, i + CLAIM_BATCH))];      // 同一个文件里可能有内容相同的块，认领的列表不得重复（TapeRelay §6.3）
    const r = await client.claim(name, auth, batch);
    claimed += r.claimed.length;
    for (const sha of r.missing) missing.add(sha);
  }
  let done = 0;
  const total = missing.size;
  for (const o of p.indexObjects) {
    if (!missing.has(o.sha256)) continue;
    checkAborted(signal);
    await client.upload(name, auth, o.bytes);
    missing.delete(o.sha256);
    done++;                                // 不能写在 onProgress?.(…) 的参数里：没有回调时参数不会计算
    onProgress?.({ done, total });
  }
  for (let i = 0; i < p.chunkHashes.length && missing.size; i++) {
    const sha = p.chunkHashes[i];
    if (!missing.has(sha)) continue;
    checkAborted(signal);
    const bytes = p.chunkBytes ? await p.chunkBytes(i) : await p.source.read(i * CHUNK, Math.min(p.source.size, (i + 1) * CHUNK));
    const r = await client.upload(name, auth, bytes);
    if (r.sha256 !== sha) throw new Error(`第 ${i} 块在上传期间变了`);
    missing.delete(sha);
    done++;
    onProgress?.({ done, total });
  }
  for (const o of extra) {
    if (!missing.has(o.sha256)) continue;
    checkAborted(signal);
    await client.upload(name, auth, o.bytes);
    missing.delete(o.sha256);
    done++;
    onProgress?.({ done, total });
  }
  return { manifest: p.manifest, manifestJson: p.manifestJson, fileId: p.fileId, uploaded: done, claimed, ...(p.envelope ? { envelope: p.envelope.sha256 } : {}) };
}

/**
 * 把同一个文件同时存到各台（D-343）。input、plan、fileName、contentType 同 uploadFile（公开文件可以只给原文，在这里算一次 plan、各台共用；
 * 加密文件给 null 和 plan）。onProgress：({ server, done, total })。retryMs：暂时的错误隔多久再试，[] 是不重试。
 * 存好 need 台（列了 2 台以上的是 2，只有 1 台的是 1）就返回；各台都试过一次还不够 need 台也返回（stored 为 false），不抛错：
 * 调用方要先看 stored，为 false 时不要接着去读、去分享。
 * 返回 { stored, need, ok: [服务器名字…], failed: [{ server, code, message }]（不再重试的）, pending: [{ server, code?, message? }]
 * （还在传、或者在后台等着重试的；试过的带上次的错误）, message, settled, manifest, manifestJson, fileId, envelope? }。
 * 2026-11-16（UX 审计第六轮中 1）：message：没存够时是一句中文，例如「只存好 0 台，要 1 台；节点不认这把开发者密钥（…）：a.example:4246」
 * （和 createTapeStore 没存够时的报错同一句），存够了是 null；failed、pending 里认得的原因（连不上、节点不认这把开发者密钥、缺权限等）message 也写成中文。
 * settled：各台都有了结果时给出 { ok, failed, pending: [] }（不会出错）。plan 要等 settled 之后才能 dispose：后台重试还要用它。
 * 第 409 条：retry：async ({ server, attempt（这一台第几次失败，从 0 数）, error: { code, message } }) → true 再试（要等就在里面等）、
 * false 不再试；抛错当作 false。给了 retry 就不看 retryMs。signal：AbortSignal；停下后各台在下一个对象之前报 aborted、不再重试。
 */
export async function uploadToServers(client, servers, auth, input, { plan, fileName, contentType, onProgress, retryMs = RETRY_MS, retry = null, signal = null, claim = true } = {}) {
  checkServers(servers);
  const p = plan ?? await planPublicFile(input, { name: fileName, contentType });
  const need = Math.min(NEED, servers.length);
  const status = new Map();                  // 服务器名字 → { ok: true } 或 { error, final }
  const waiters = new Set();
  const update = (server, v) => { status.set(server, v); for (const w of [...waiters]) w(); };
  const again = retry ?? (async ({ attempt }) => { await sleep(retryMs[attempt], signal); return true; });
  const stopped = { code: 'aborted', message: '上传停下了' };
  const one = async (server) => {
    for (let i = 0; ; i++) {
      let err;
      try {
        await uploadFile(client, server, auth, input, { plan: p, signal, claim, onProgress: onProgress && ((x) => onProgress({ server, ...x })) });
        return update(server, { ok: true });
      } catch (e) { err = e; }
      const final = !transient(err) || (!retry && i >= retryMs.length) || !!signal?.aborted;
      update(server, { error: signal?.aborted ? stopped : errOf(err), final });
      if (final) return;
      let go = false;
      try { go = await again({ server, attempt: i, error: errOf(err) }); } catch { go = false; }
      if (!go || signal?.aborted) return update(server, { error: signal?.aborted ? stopped : errOf(err), final: true });
    }
  };
  // 认得的原因把 message 换成中文（带服务器名字），代号照旧在 code
  const told = (x) => {
    if (!x.code) return x;
    const text = failureText(x, auth);
    return text === x.code || text === x.message ? x : { ...x, message: `${text}（${x.server}）` };
  };
  const snapshot = () => ({
    ok: servers.filter((s) => status.get(s)?.ok),
    failed: servers.filter((s) => status.get(s)?.final).map((s) => told({ server: s, ...status.get(s).error })),
    pending: servers.filter((s) => !status.get(s)?.ok && !status.get(s)?.final).map((s) => told({ server: s, ...status.get(s)?.error })),
  });
  const settled = Promise.all(servers.map(one)).then(snapshot);
  await new Promise((resolve) => {
    const check = () => {
      if (servers.filter((s) => status.get(s)?.ok).length >= need || servers.every((s) => status.has(s))) { waiters.delete(check); resolve(); }
    };
    waiters.add(check);
    check();
  });
  const now = snapshot();
  const stored = now.ok.length >= need;
  let message = null;
  if (!stored) {
    // 没存够：按原因分开写哪几台没存上（同一个原因的写在一起），例如「只存好 0 台，要 1 台；节点不认这把开发者密钥（…）：a.example:4246」
    const groups = new Map();
    for (const x of [...now.failed, ...now.pending.filter((y) => y.code)]) { const k = failureText(x, auth); groups.set(k, [...(groups.get(k) ?? []), x.server]); }
    const why = [...groups].map(([reason, names]) => `${reason}：${names.join('、')}`).join('；');
    message = `只存好 ${now.ok.length} 台，要 ${need} 台${why ? `；${why}` : ''}`;
  }
  return { stored, need, ...now, message, settled, manifest: p.manifest, manifestJson: p.manifestJson, fileId: p.fileId, ...(p.envelope ? { envelope: p.envelope.sha256 } : {}) };
}
