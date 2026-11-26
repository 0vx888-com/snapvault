// TapeRelay 客户端库：免费消息层（自主身份）。2026-11-01 加。
//
// 这一层是给「不要电路、只要互相发消息」的用法准备的：开一个身份不花钱、不上链、不要押金，
// 代价是不能用存储（通知里直接装内容，最多 4 KiB），而且收件人不批准就发不进去。
//
// 身份的写法：key:0x<40 位小写十六进制>@<背书这个身份的节点域名>[:端口]
// 公钥（地址）本身就写在身份里，所以核对签名根本不用读链——比电路那一层还快。代价是换节点就是换身份
// （跟换邮箱服务商要换邮箱地址一样），所以挑节点要挑长期在的。
//
// 跟电路那一层的关系：两层的签名互相顶用不了（域的 chainId 一个是真链号、一个是 0），
// 通知也是两种 EIP-712 类型（Notice / SelfNotice），服务器两边分开核对。目前只能同层互发（D-657）。
//
// 2026-11-07（D-652～D-656，消息层设计稿）：拿回来以后补上端到端加密：
//   - 每个身份把自己的加密公钥签一份（SelfEncryptionKey）放在背书节点上（publishSelfKey），别人取（fetchSelfKey）时核对签名；
//   - 消息内容一律是密文：小信封（D-659，sealedbody.mjs 的 sealInline：钥匙给收件人和发件人各包一份），写成 base64url 放进 body；
//     没有收件人的公钥就发不出去（no-encryption-key）；
//   - 收件人用自己的加密私钥打开（openSelfNotice）；发件人从自己的节点拉「已发送」（listSent），用 as: 'sender' 打开；
//   - 批准名单多一种「拉黑」（block / unblock）；开发者的后台给自己的用户签准入（updateAdmissions，要 admit 范围）。
import { domainFor, digest, typedData, hex, signDigest, addressOf, newPrivateKey, recover, base64url, utf8, fromHex,
  isSelfAccount, selfKeyOf, selfHostOf, sameAddr } from './core.mjs';
import { checkPublicKey } from './sealedbox.mjs';
import { signedHeaders, serverUrl } from './session.mjs';

// 2026-11-07（M2、D-659）：密文的写法在 sealedbody.mjs（电路之间的通知也用同一种小信封），这里照旧转出 NO_KEY_MESSAGE、sealedBodyOk，另转出 inlineBodyOk
import { NO_KEY_MESSAGE, sealedBodyOk, inlineBodyOk, sealInline, openInline } from './sealedbody.mjs';
export { NO_KEY_MESSAGE, sealedBodyOk, inlineBodyOk };
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
/**
 * 2026-11-16（UX 审计第六轮低 1）：对方的地址写错了（例如照抄的片段没改 to）时，发请求之前就报「收件人地址写法不对：…」，不等节点回 HTTP 400。
 * 报错里叫「用户身份」（文档的叫法），不叫内部的「自主身份」
 */
const ADDRESS_FORM = '要写成 key:0x…@主机:端口';
const shownAddress = (x) => { const t = typeof x === 'string' ? x : JSON.stringify(x) ?? String(x); return t.length > 80 ? `${t.slice(0, 80)}…` : t; };
const requireRecipient = (account) => { if (!isSelfAccount(account)) fail('bad-address', `收件人地址写法不对：${shownAddress(account)}（${ADDRESS_FORM}）`); };
/** 节点回的错误码（{ error }），读不到是 null */
async function errorCodeOf(res) {
  try { const j = res.json ? await res.json() : JSON.parse(await res.text()); return typeof j?.error === 'string' ? j.error.slice(0, 64) : null; } catch { return null; }
}

/** 开一个新身份：自己生成私钥，选一台节点背书。返回 { privateKey, account }——私钥丢了身份就没了，要自己存好 */
export function newSelfIdentity({ host, privateKey = newPrivateKey() } = {}) {
  if (typeof host !== 'string' || !host.length) fail('bad-host', '要写背书这个身份的节点域名');
  const account = `key:${addressOf(privateKey).toLowerCase()}@${host.toLowerCase()}`;
  if (!isSelfAccount(account)) fail('bad-host', `节点域名的写法不对：${host}（要像 relay.example.com 或 relay.example.com:4246）`);
  return { privateKey, account };
}

/** 自主身份的签名器，形状和 session.mjs 的 walletAuth 一样，所以 signedHeaders 等等能直接用 */
export function selfAuth(privateKey, host) {
  const { account } = newSelfIdentity({ host, privateKey });
  return { account, async sign(d) { return signDigest(privateKey, d); }, delegationHeader: null };
}

/** 这个身份该往哪台节点发请求（身份里就写着，不用读链） */
export const nodeOf = (account) => {
  const h = selfHostOf(account);
  if (h === null) fail('bad-address', `不是用户身份：${shownAddress(account)}（${ADDRESS_FORM}）`);
  return h.includes(':') ? h : `${h}:443`;
};

/**
 * 做一条免费层的通知（D-649、D-653、D-659）：message（字符串或字节）做成小信封放进 body：钥匙给收件人的加密公钥 recipientKey
 * （fetchSelfKey 取到的 32 字节）和自己的加密公钥 ownKey（或自己的密钥对）各包一份，自己以后也打得开。
 * 没有 recipientKey 就发不出去（no-encryption-key，D-655）；没有 ownKey 抛 no-own-key。
 * 加密、编码之后最多 4 KiB（原文约 2,870 字节、约 950 个汉字，D-654、D-659）；更长的要存成加密文件。
 */
export function makeSelfNotice({ from, to, message, recipientKey, ownKey, createdAt }) {
  if (!isSelfAccount(from)) fail('bad-address', `发件人要是用户身份：${shownAddress(from)}（${ADDRESS_FORM}）`);
  requireRecipient(to);
  if (!(recipientKey instanceof Uint8Array)) fail('no-encryption-key', NO_KEY_MESSAGE);
  const bytes = typeof message === 'string' ? utf8(message) : message;
  if (!(bytes instanceof Uint8Array) || !bytes.length) fail('bad-body', 'message 要是非空的字符串或字节');
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) fail('bad-time', 'createdAt 要是 Unix 秒');
  let body;
  try { body = sealInline(bytes, recipientKey, ownKey); } catch (e) {               // 公钥不合格时 sealBox 抛 bad-public-key
    if (e?.code === 'too-large') fail('bad-body', e.message);
    throw e;
  }
  return { from, to, body, createdAt };
}

/** 签一条免费层的通知，返回 { id, notice, body（交给服务器的 JSON 文本）} */
export async function signSelfNotice(auth, notice) {
  if (!auth || auth.account !== notice?.from) fail('bad-notice', '签名的身份要是通知的发件人');
  const domain = domainFor(notice.from);
  const d = digest('SelfNotice', domain, notice);
  if (!d) fail('bad-notice', '通知的格式不对');
  const signature = await auth.sign(d, typedData('SelfNotice', domain, notice));
  return { id: hex(d), notice, body: JSON.stringify({ notice, signature }) };
}

/**
 * 自己核对收到的一条（不只信服务器）：编号对不对、收件人是不是自己、签名者是不是发件人身份里写的那个公钥。
 * 免费层核对签名不用读链，所以这件事离线也能做。核对过的返回 { ok, id（这条的编号，与收件箱、推送给的 id 相同）, from, to, body, createdAt }。
 */
export function verifySelfNotice(item, { me = null, as = 'recipient' } = {}) {
  if (!isObj(item) || !isObj(item.notice) || typeof item.signature !== 'string') return { ok: false, reason: 'bad-item' };
  const n = item.notice;
  const keys = Object.keys(n);
  if (keys.length !== 4 || !['from', 'to', 'body', 'createdAt'].every((k) => keys.includes(k))) return { ok: false, reason: 'bad-notice' };
  if (!isSelfAccount(n.from) || !isSelfAccount(n.to)) return { ok: false, reason: 'bad-address' };
  if (me !== null && (as === 'sender' ? n.from : n.to) !== me) return { ok: false, reason: 'not-mine' };   // D-659：as 为 sender 时核对自己发出的
  if (!inlineBodyOk(n.body)) return { ok: false, reason: 'not-sealed' };                   // D-649、D-659：内容必须是小信封
  const d = digest('SelfNotice', domainFor(n.from), n);
  if (!d) return { ok: false, reason: 'bad-notice' };
  if (typeof item.id === 'string' && item.id !== hex(d)) return { ok: false, reason: 'bad-id' };
  // 签名者就是地址里写的那个公钥——这一层核对签名不读链，就是因为这一句
  let signer = null;
  try { signer = recover(d, item.signature); } catch { signer = null; }
  if (!signer || !sameAddr(signer, selfKeyOf(n.from))) return { ok: false, reason: 'bad-signature' };
  return { ok: true, id: hex(d), from: n.from, to: n.to, body: n.body, createdAt: n.createdAt };
}

/** 交给自己的节点（免费层只有一台：身份里写着哪一台）。收下返回 { id, server } */
export async function submitSelfNotice(http, auth, signed, { now }) {
  const server = nodeOf(auth.account);
  const bodyBytes = new TextEncoder().encode(signed.body);
  const headers = await signedHeaders(auth, { server, method: 'POST', path: '/v1/outbox', body: bodyBytes, now });
  const res = await http(`${serverUrl(server)}/v1/outbox`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: signed.body });
  if (res.status !== 202 && res.status !== 200) fail('submit-failed', `节点没收下：HTTP ${res.status}`);
  return { id: signed.id, server };
}

/**
 * 打开一条（D-649、D-659）：先照 verifySelfNotice 核对，再用自己的加密密钥对 keyPair（{ publicKey, secretKey }）打开小信封。
 * as 为 recipient（默认，收到的）或 sender（自己发出的，listSent 拉回来的）：只试自己那一份。
 * 返回 { ok, id, from, to, createdAt, message（字节）, text（能按 UTF-8 读就给，不能就是 null） }，打不开的 reason 为 cannot-open。
 * 2026-11-15（UX 审计第五轮）：结果带 id（这条的编号），拉收件箱拉到的和推送推来的一样，可以按 id 去重、标已读。
 */
export function openSelfNotice(item, keyPair, { me = null, as = 'recipient' } = {}) {
  const v = verifySelfNotice(item, { me, as });
  if (!v.ok) return v;
  const plain = openInline(v.body, keyPair, { as });
  if (!plain) return { ok: false, reason: 'cannot-open' };
  let text = null;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(plain); } catch { text = null; }
  return { ok: true, id: v.id, from: v.from, to: v.to, createdAt: v.createdAt, message: plain, text };
}

// ---- 加密公钥（D-652、D-655，消息层设计稿第四节）----

/**
 * 把自己的加密公钥公开到背书节点上：身份的签名密钥签一份 SelfEncryptionKey（账户、公钥、签署时间），PUT /v1/keys/{身份}。
 * 换钥匙就用新的再发一次（签署时间要比上一次晚）。返回 { createdAt }
 */
export async function publishSelfKey(http, auth, publicKey, { now }) {
  if (!(publicKey instanceof Uint8Array) || checkPublicKey(publicKey) !== 'ok') fail('bad-public-key', '加密公钥不合格（Files §5.6）');
  const record = { account: auth.account, key: `0x${hex(publicKey)}`, createdAt: now };
  const domain = domainFor(auth.account);
  const d = digest('SelfEncryptionKey', domain, record);
  if (!d) fail('bad-key', '加密公钥的记录写法不对');
  const signature = await auth.sign(d, typedData('SelfEncryptionKey', domain, record));
  const server = nodeOf(auth.account);
  const path = `/v1/keys/${auth.account}`;
  const text = JSON.stringify({ record, signature });
  const headers = await signedHeaders(auth, { server, method: 'PUT', path, body: new TextEncoder().encode(text), now });
  const res = await http(`${serverUrl(server)}${path}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: text });
  if (res.status !== 200) {
    // 2026-11-15（UX 审计第五轮）：节点回 not-admitted（selfAdmission 不是 open）时说清楚要准入；code 照旧是 publish-failed，e.reason 是节点回的错误码
    let reason = null;
    try { const j = res.json ? await res.json() : JSON.parse(await res.text()); reason = typeof j?.error === 'string' ? j.error.slice(0, 64) : null; } catch { reason = null; }
    if (reason === 'not-admitted') throw Object.assign(new Error('这台节点要求准入：要开发者后台先 updateAdmissions'), { code: 'publish-failed', reason, status: res.status });
    throw Object.assign(new Error(`加密公钥没存上：HTTP ${res.status}`), { code: 'publish-failed', reason, status: res.status });
  }
  return { createdAt: now };
}

/**
 * 取一个身份公开的加密公钥（不要签名）：到它身份里写的背书节点去取，核对「是这个身份自己签的」、公钥合格，才返回 { key（32 字节）, createdAt }。
 * 没有公开的（404）抛 no-encryption-key（D-655）；记录核对不过抛 bad-key-record（节点给了假的或坏的）。
 */
export async function fetchSelfKey(http, account) {
  requireRecipient(account);
  const server = nodeOf(account);
  const res = await http(`${serverUrl(server)}/v1/keys/${account}`, { method: 'GET', headers: {} });
  if (res.status === 404) fail('no-encryption-key', NO_KEY_MESSAGE);
  if (res.status !== 200) fail('fetch-failed', `取不到加密公钥：HTTP ${res.status}`);
  const j = res.json ? await res.json() : JSON.parse(await res.text());
  const r = j?.record;
  const bad = () => fail('bad-key-record', '节点给的加密公钥记录核对不过（不是这个身份签的，或写法不对）');
  if (!r || typeof r !== 'object' || Object.keys(r).length !== 3 || r.account !== account || typeof r.key !== 'string' || !/^0x[0-9a-f]{64}$/.test(r.key)
    || !Number.isSafeInteger(r.createdAt) || r.createdAt < 0 || typeof j.signature !== 'string') bad();
  let signer = null;
  try { signer = recover(digest('SelfEncryptionKey', domainFor(account), r), j.signature); } catch { signer = null; }
  if (!signer || !sameAddr(signer, selfKeyOf(account))) bad();
  const key = fromHex(r.key.slice(2));
  if (checkPublicKey(key) !== 'ok') bad();
  return { key, createdAt: r.createdAt };
}

// ---- 「已发送」（D-659）：自己的节点留着自己发出的消息（和收件箱一样久） ----

/**
 * 从自己的节点拉一页自己发出的消息（GET /v1/outbox，新的在前）：{ cursor, limit（1～100） }。逐条核对是自己签的（verifySelfNotice 的 as: 'sender'），
 * 返回 { items: [{ id, notice, signature, status, error?, submittedAt }], rejected: [{ id, reason }], next? }；
 * 打开用 openSelfNotice(item, keyPair, { me, as: 'sender' })。
 */
export async function listSent(http, auth, { cursor = '', limit = 50, now }) {
  const server = nodeOf(auth.account);
  const query = `${cursor ? `cursor=${encodeURIComponent(cursor)}&` : ''}limit=${limit}`;
  const headers = await signedHeaders(auth, { server, method: 'GET', path: '/v1/outbox', query, now });
  const res = await http(`${serverUrl(server)}/v1/outbox?${query}`, { method: 'GET', headers });
  if (res.status !== 200) fail('list-failed', `列不出来：HTTP ${res.status}`);
  const j = res.json ? await res.json() : JSON.parse(await res.text());
  const items = [], rejected = [];
  for (const it of Array.isArray(j?.items) ? j.items : []) {
    const v = verifySelfNotice(it, { me: auth.account, as: 'sender' });
    if (v.ok) items.push(it); else rejected.push({ id: it?.id ?? null, reason: v.reason });
  }
  return { items, rejected, ...(typeof j?.next === 'string' ? { next: j.next } : {}) };
}

// ---- 准入（D-656）：开发者的后台给自己的用户签，要 admit 范围 ----

/**
 * 在 server（节点的名字，主机:端口）上替一批自主身份签准入或收回：{ admit, revoke }（各最多 100 个，都要是这台节点背书的身份）。
 * auth 是开发者电路的签名器（钱包，或带 admit 范围的会话密钥、开发者密钥：session.mjs 的 walletAuth、sessionAuth）。
 * 返回 { admitted, already, revoked }；别人签的准入收不回（not-admitter）。
 */
export async function updateAdmissions(http, auth, server, { admit = [], revoke = [], now }) {
  const path = '/v1/self-admissions';
  const text = JSON.stringify({ ...(admit.length ? { admit } : {}), ...(revoke.length ? { revoke } : {}) });
  const headers = await signedHeaders(auth, { server, method: 'POST', path, body: new TextEncoder().encode(text), now });
  const res = await http(`${serverUrl(server)}${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: text });
  if (res.status !== 200) fail('admit-failed', `准入没改成：HTTP ${res.status}`);
  return res.json ? await res.json() : JSON.parse(await res.text());
}

// ---- 批准名单（反垃圾：收件人自己说了算收谁的消息）----

/** 列出批准过的（state 为 'allowed'）、在等批准的陌生人（'pending'）或拉黑的（'blocked'，D-652） */
export async function listSenders(http, auth, { state = 'allowed', after = '', limit = 50, now }) {
  const server = nodeOf(auth.account);
  const query = `state=${state}${after ? `&after=${encodeURIComponent(after)}` : ''}&limit=${limit}`;
  const path = `/v1/inbox/${auth.account}/senders`;
  const headers = await signedHeaders(auth, { server, method: 'GET', path, query, now });
  const res = await http(`${serverUrl(server)}${path}?${query}`, { method: 'GET', headers });
  if (res.status !== 200) fail('list-failed', `列不出来：HTTP ${res.status}`);
  return res.json ? await res.json() : JSON.parse(await res.text());
}

/**
 * 改批准名单：{ allow, deny, block, unblock }（D-652）。先做 deny（忘掉批准的、待批准的，拉黑的不动）和 unblock（取消拉黑），
 * 再做 allow、最后做 block：同时写在 deny 和 allow 里结果是「批准」，写在 allow 和 block 里结果是「拉黑」
 */
export async function updateSenders(http, auth, { allow = [], deny = [], block = [], unblock = [], now }) {
  for (const x of [...allow, ...deny, ...block, ...unblock]) requireRecipient(x);
  const server = nodeOf(auth.account);
  const path = `/v1/inbox/${auth.account}/senders`;
  const text = JSON.stringify({ ...(allow.length ? { allow } : {}), ...(deny.length ? { deny } : {}), ...(block.length ? { block } : {}), ...(unblock.length ? { unblock } : {}) });
  const headers = await signedHeaders(auth, { server, method: 'POST', path, body: new TextEncoder().encode(text), now });
  const res = await http(`${serverUrl(server)}${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: text });
  if (res.status !== 200) {
    const reason = await errorCodeOf(res);
    throw Object.assign(new Error(`批准名单没改成：HTTP ${res.status}${reason ? `（${reason}）` : ''}`), { code: 'update-failed', reason, status: res.status });
  }
  return res.json ? await res.json() : JSON.parse(await res.text());
}

// ---- 实时推送（SSE）----
//
// ⚠ 为什么不用浏览器自带的 EventSource：它发不出自定义请求头，而这个请求要用 TR-* 头认证（TapeRelay §8.2）。
// 所以这里用 fetch 读流，自己做 EventSource 本来会做的那三件事：攒行、断线重连、重连时带上 Last-Event-ID。
//
// 服务器每小时主动断开一次（释放内存、重新核对授权），所以「断开」是正常的，不是错误；
// 每次重连都带上收到的最后一条的 seq，断开期间来的消息下一次连上就补齐，不会漏。

/** 把 SSE 的字节流拆成一条条事件：{ id, event, data } */
async function* chunksOf(body) {
  // Safari 的 ReadableStream 不能 for await，改用 getReader 读
  if (body?.[Symbol.asyncIterator]) { yield* body; return; }
  const reader = body.getReader();
  try { for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; } } finally { reader.releaseLock(); }
}
async function* readEvents(body) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of chunksOf(body)) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = { id: null, event: 'message', data: '' };
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;                                  // 心跳，没有内容
        const c = line.indexOf(':');
        const k = c < 0 ? line : line.slice(0, c);
        const v = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
        if (k === 'id') ev.id = v; else if (k === 'event') ev.event = v; else if (k === 'data') ev.data += (ev.data ? '\n' : '') + v;
      }
      if (ev.data || ev.id !== null) yield ev;                              // 只有 id 的也给：服务器第一块用它告诉起点
    }
    if (buf.length > 65536) throw new Error('推送的一块超过 64 KiB：断开重连');   // 节点一直不发空行时，别把内存攒满
  }
}

/**
 * 订阅自己的收件箱，一直接着（服务器每小时断一次就自动重连）。
 * onNotice 收到的是一条条已经自己核对过的消息；核对不过的不给（reason 走 onError）。
 * 给了 keyPair（自己的加密密钥对）就顺手打开（openSelfNotice），onNotice 收到的带 message、text；打不开的也走 onError（cannot-open）。
 * 返回一个 stop()：调用它就不再重连、并中断当前这条连接。
 */
export function subscribeNotices(http, auth, { onNotice, onError = () => {}, now, lastSeq = null, retryMs = 2000, keyPair = null } = {}) {
  const server = nodeOf(auth.account);
  const path = `/v1/inbox/${auth.account}/events`;
  let stopped = false, ctrl = null, seq = lastSeq;
  (async () => {
    let wait = retryMs;
    while (!stopped) {
      ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      try {
        const at = typeof now === 'function' ? now() : Math.floor(Date.now() / 1000);
        const headers = await signedHeaders(auth, { server, method: 'GET', path, query: '', now: at });
        if (seq !== null) headers['Last-Event-ID'] = String(seq);
        const res = await http(`${serverUrl(server)}${path}`, { method: 'GET', headers, signal: ctrl?.signal });
        // status：429 是同一个出口 IP 挂的推送连接太多了（官方节点每个 IP 同时最多 16 条），调用方可以先改成定时拉取
        if (res.status !== 200) throw Object.assign(new Error(`订阅不上：HTTP ${res.status}`), { code: 'subscribe-failed', status: res.status });
        wait = retryMs;                                                      // 连上了就把重试间隔收回来
        for await (const ev of readEvents(res.body)) {
          if (stopped) break;
          if (ev.id !== null && /^[0-9]{1,15}$/.test(ev.id)) seq = Number(ev.id);
          if (!ev.data) continue;
          let item = null;
          try { item = JSON.parse(ev.data); } catch { onError(new Error('推来的不是 JSON')); continue; }
          const v = keyPair ? openSelfNotice(item, keyPair, { me: auth.account }) : verifySelfNotice(item, { me: auth.account });
          if (v.ok) onNotice({ ...v, id: item.id ?? v.id, seq, receivedAt: item.receivedAt });
          else onError(Object.assign(new Error(`这一条核对不过：${v.reason}`), { code: v.reason, item }));
        }
      } catch (e) {
        if (!stopped) onError(e);
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60000);                                      // 连不上就越等越久，最多 1 分钟
    }
  })();
  return () => { stopped = true; try { ctrl?.abort(); } catch { /* 已经断了 */ } };
}
