// TapeRelay 客户端库：本协议自己的收件箱（TapeRelay §9.2～TapeRelay §9.8；D-225、D-238）。2026-10-16 由主编写窗口编写（CHANGELOG 第 286 条，收件箱改造，
// docs/INBOX-TASK.md）。取代原来的 TapeSend 通道（tapesend-channel.mjs，D-237 删掉）。与文件本身有关的（清单对象、读文件、保存到自己的空间）
// 照旧在 notices.mjs；这里只管通知：
// - 发（TapeRelay §9.8 发送第 3、4 步）：makeNotice 做一条通知（2026-11-07 D-649、D-654：envelope、body 恰好一项有内容——加密文件的信封，或直接带的密文；
//   公开文件不能再当通知发，manifest 去掉）；sealNoticeBody 把短消息给收件人的加密公钥做成密文；signNotice 用会话密钥（带授权声明）
//   或持有人钱包签（TapeRelay §9.2）；submitNotice 交给自己的服务器，有几台时按顺序交给第一台收下的，那台没收下换下一台；deliveryStatus 查投递结果。
// - 收（TapeRelay §9.8 接收第 1 步、TapeRelay §9.6、TapeRelay §9.7）：pullInbox 从自己的每台服务器拉取（翻页）、按编号去重；verifyNotice 自己核对每一条，不只信服务器：
//   编号等于 EIP-712 摘要、to 是自己、签名者是发件人的当前持有人，或者带着授权声明、按 TapeRelay §9.4 第 3 步核对通过的会话密钥（服务器名单那一条
//   客户端不知道、不核对）、envelope 和 body 恰好一项有内容；openNoticeBody 用自己的加密密钥对打开直接带的密文；markRead 在收到它的那几台上标记已读。
// 签名、核对都用 core.mjs 的 EIP-712（与服务器同一份实现）。读链（发件人的当前持有人）由调用方传 holderOf。
// 第 295 条：pullInbox 记下每台拉到哪里，以后只拉新的（I-222，D-254）；同一编号内容不同的几份都留着，verifyPulled 用第一份核对通过的（I-224）；
// mergePulled 把两次拉到的合在一起（把这台设备记下的和新拉到的合起来用）。
// 2026-10-22（D-349）：会话密钥签的通知，授权声明要有 send 范围；核对通过的另给出 app。
// 2026-11-16（UX 审计第六轮中 2）：节点回 delegation-invalid 时（开发者密钥没勾「发消息」「收消息」、被吊销、过期，或不是给这台的），
// submitNotice 抛的错、pullInbox 等 errors 里的 message 写成中文：缺哪项权限（控制台的叫法），或「节点不认这把开发者密钥（…）」；code 照旧是 delegation-invalid。
import { domainFor, digest, typedData, hex, utf8, isAccount, normalizeCircuitInput, sameAddr, signerOf, delegationSigner, HEX64, maxDelegationSeconds } from './core.mjs';
import { checkNoticeServers } from './notices.mjs';
import { inlineBodyOk, sealInline, openInline } from './sealedbody.mjs';
import { TapeRelayError } from './client.mjs';
import { explainRefusal, refusalEntry } from './devkey.mjs';

const ZERO = `0x${'0'.repeat(64)}`;
const B32 = /^0x[0-9a-f]{64}$/;
const NOTICE_KEYS = ['from', 'to', 'envelope', 'body', 'servers', 'createdAt'];   // D-649、D-654：manifest 去掉，body 是直接带的密文
const PAGE = 100;                                      // TapeRelay §9.6 一页最多 100 条（第 295 条：原来 50，翻页少一半）
const CURSOR = /^[A-Za-z0-9_-]{1,256}$/;               // 游标的写法（TapeStore §4.4）；不合的当作没有下一页，也不记下
const MAX_COPY = 16384;                                // 一份通知最多 16 KiB（client.mjs 的 inbox 那一条）；更大的不留（免得记在设备上的变大）
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

// ---- 发 ----

/**
 * 做一条通知（TapeRelay §9.2；2026-11-07 D-649、D-654：一律加密）。两种：
 * - kind 为 envelope：加密文件，hash 是信封的 SHA-256（64 位小写十六进制），servers 是存着它的服务器（https://主机:端口，1～8 项）；
 * - kind 为 body：短消息，body 是 sealNoticeBody 做的小信封（D-659：钥匙给收件人和发件人各包一份，base64url，最多 4,096 个字符），servers 不写。
 * 公开文件（原来的 manifest）不能再当通知发：kind 只认这两种。
 */
export function makeNotice({ from, to, kind, hash, body, servers, createdAt }) {
  if (typeof from === 'string') from = normalizeCircuitInput(from) ?? from;   // 电路名可以只写 1.2.0
  if (typeof to === 'string') to = normalizeCircuitInput(to) ?? to;   // 电路名可以只写 1.2.0
  if (!isAccount(from) || !isAccount(to)) fail('bad-address', '发件人、收件人要是电路名，例如 1.2.0（TapeRelay §3.2）');
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) fail('bad-time', 'createdAt 要是 Unix 秒');
  if (kind === 'envelope') {
    if (typeof hash !== 'string' || !HEX64.test(hash)) fail('bad-kind', 'hash 要是信封的 SHA-256（64 位小写十六进制）');
    if (!checkNoticeServers(servers)) fail('bad-servers', '服务器要是 https://主机:端口，1～8 项（TapeRelay §9.2）');
    return { from, to, envelope: `0x${hash}`, body: '', servers: [...servers], createdAt };
  }
  if (kind === 'body') {
    if (!inlineBodyOk(body)) fail('bad-body', 'body 要是 sealNoticeBody 做的小信封（base64url，最多 4,096 个字符）');
    if (servers !== undefined && !(Array.isArray(servers) && servers.length === 0)) fail('bad-servers', '直接带密文的通知不写服务器');
    return { from, to, envelope: ZERO, body, servers: [], createdAt };
  }
  fail('bad-kind', 'kind 只能是 envelope（加密文件）或 body（直接带的密文）：公开文件不能当通知发（通知一律加密）');
}

/**
 * 把短消息（字符串或字节）做成小信封，作 makeNotice 的 body（D-654、D-659）：recipientKey 是收件人的加密公钥（notices.mjs 的
 * requireRecipientKey 得到的 32 字节），ownKey 是自己的加密公钥（或密钥对）——钥匙给两边各包一份，自己以后也打得开（pullSent 之后用 openNoticeBody 的 as: 'sender'）。
 * 没有收件人的公钥抛 no-encryption-key（「对方还没有开启加密收信，暂时不能给他发消息」，D-655）；没有自己的公钥抛 no-own-key；
 * 加密以后超过 4,096 个字符抛 too-large（原文约 2,870 字节以内，更长的要存成加密文件发）。
 */
export function sealNoticeBody(message, recipientKey, ownKey) {
  const bytes = typeof message === 'string' ? utf8(message) : message;
  return sealInline(bytes, recipientKey, ownKey);
}

/**
 * 打开一条直接带密文的通知（verifyNotice 核对通过、kind 为 body 的结果）：keyPairs 是自己的加密密钥对 { publicKey, secretKey }，
 * 或几把（当前的和换钥后保留的旧的，TapeRelay §4.5，与 openEnvelope 相同），逐把去试。as 为 recipient（默认，收到的）或 sender
 * （自己发出的，pullSent 拉回来的，D-659）：小信封里收件人那一份在前、发件人那一份在后，只试自己那一份。
 * 返回 { message（字节）, text（能按 UTF-8 读就给，不能就是 null） }；打不开（不是给这几把公钥的、被改过）返回 null。
 */
export function openNoticeBody(verified, keyPairs, { as = 'recipient' } = {}) {
  if (verified?.kind !== 'body') return null;
  let message = null;
  for (const kp of Array.isArray(keyPairs) ? keyPairs : [keyPairs]) { message = openInline(verified.body, kp, { as }); if (message) break; }
  if (!message) return null;
  let text = null;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(message); } catch { text = null; }
  return { message, text };
}

/** 通知的编号：Notice 的 EIP-712 摘要，小写十六进制，不带 0x（TapeRelay §9.2）；格式不对返回 null */
export function noticeIdOf(notice) {
  const d = isObj(notice) && isAccount(notice.from) ? digest('Notice', domainFor(notice.from), notice) : null;
  return d ? hex(d) : null;
}

/**
 * 签名（TapeRelay §9.2）：auth 是 session.mjs 的 sessionAuth（会话密钥签，带上授权声明；D-238 网页用这种）或 walletAuth（持有人钱包直接签）。
 * 返回 { id, notice, body（传输格式「签名的通知」的 JSON 文本，交给服务器的就是它） }。
 */
export async function signNotice(auth, notice) {
  if (!auth || auth.account !== notice?.from) fail('bad-notice', '签名的电路要是通知的发件人');
  const domain = domainFor(notice.from);
  const d = digest('Notice', domain, notice);
  if (!d) fail('bad-notice', '通知的格式不对（TapeRelay §9.2）');
  const signature = await auth.sign(d, typedData('Notice', domain, notice));
  if (auth.sessionKey && !isObj(auth.delegation)) fail('bad-notice', '会话密钥签的通知要带授权声明（TapeRelay §9.2）：sessionAuth 里没有');
  const signed = { notice, signature, ...(auth.sessionKey ? { delegation: auth.delegation } : {}) };
  return { id: hex(d), notice, body: JSON.stringify(signed) };
}

/**
 * 交给自己的服务器（TapeRelay §9.3、TapeRelay §9.8 发送第 3 步）：servers 是自己发现文件里的服务器名字，按顺序交给第一台收下（202）的；
 * 那台没收下（连不上、出错）换下一台。返回 { id, server, tried（没收下的几台：[{ server, code }]） }；都没收下抛最后一台的错
 * （节点回 delegation-invalid 的，message 是中文：缺「发消息」权限，或节点不认这把开发者密钥）。
 */
export async function submitNotice(client, servers, auth, signed) {
  const tried = [];
  let last = null;
  for (const name of servers) {
    try {
      const r = await client.submitNotice(name, auth, utf8(signed.body));
      if (r?.id !== signed.id) throw new TapeRelayError('bad-reply', { server: name });
      return { id: signed.id, server: name, tried };
    } catch (e) {
      last = explainRefusal(e, auth, 'send');
      tried.push({ server: name, code: e?.code ?? 'error' });
    }
  }
  throw last ?? new TapeRelayError('no-servers');
}

/** 投递结果（TapeRelay §9.3）：{ id, status: pending | delivered | failed, error? }；不是那台收下的抛 not-found */
export const deliveryStatus = (client, server, id) => client.outboxStatus(server, id);

// ---- 收 ----

/** 签名的通知（拉取到的 notice、signature、delegation）的格式（只看各项的类型；envelope、body 恰好一项有内容、各自的写法由 verifyNotice 核对）；不对返回 null */
function noticeOf(item) {
  const n = item?.notice;
  if (!isObj(n) || Object.keys(n).length !== NOTICE_KEYS.length || !NOTICE_KEYS.every((k) => k in n)) return null;
  if (typeof n.from !== 'string' || typeof n.to !== 'string' || !B32.test(String(n.envelope)) || typeof n.body !== 'string'
    || !Array.isArray(n.servers) || n.servers.length > 8 || !n.servers.every((s) => typeof s === 'string')
    || !Number.isSafeInteger(n.createdAt) || n.createdAt < 0 || typeof item.signature !== 'string') return null;
  return n;
}

/** 一份通知的内容（notice、signature、delegation?）；不是对象、或超过 16 KiB 的返回 null */
function copyOf(it) {
  const c = { notice: it.notice, signature: it.signature, ...(isObj(it.delegation) ? { delegation: it.delegation } : {}) };
  let key;
  try { key = JSON.stringify(c); } catch { return null; }
  return typeof key === 'string' && key.length <= MAX_COPY ? { c, key } : null;
}

/**
 * 把一台服务器给的一份（或另一次拉到的一项）合进 byId（第 295 条，I-224）：同一编号只留一项，servers、read、receivedAt 照旧合并；
 * 内容不同的几份都留在 copies 里，每台服务器只留它给的第一份（免得一台服务器塞很多份）；notice、signature、delegation 是第一份的（旧的写法）。
 */
function mergeCopy(byId, id, { c, key }, servers, receivedAt, read) {
  let had = byId.get(id);
  if (!had) {
    had = { id, ...c, copies: [], receivedAt: Number.isSafeInteger(receivedAt) ? receivedAt : 0, read: read === true, servers: [] };
    byId.set(id, had);
  } else {
    had.read ||= read === true;
    if (Number.isSafeInteger(receivedAt) && receivedAt < had.receivedAt) had.receivedAt = receivedAt;
  }
  const fresh = servers.filter((s) => !had.copies.some((x) => x.servers.includes(s)));
  for (const s of servers) if (!had.servers.includes(s)) had.servers.push(s);
  if (!fresh.length) return;
  const same = had.copies.find((x) => x.key === key);
  if (same) same.servers.push(...fresh);
  else had.copies.push({ ...c, key, servers: fresh });
}

/** 一台服务器从 start（游标；undefined 是从头）拉到没有下一页、或拉够 max 条；返回 { cursor（下次从哪里拉）, more（还没拉完） } */
async function pullFrom(client, name, auth, start, max, byId) {
  let cursor = start, n = 0;
  const seen = new Set();
  for (;;) {
    const page = await client.inbox(name, auth, { cursor, limit: PAGE });
    if (!Array.isArray(page?.items)) throw new TapeRelayError('bad-reply', { server: name });
    for (const it of page.items) {
      if (!isObj(it) || typeof it.id !== 'string' || !HEX64.test(it.id)) continue;
      const copy = copyOf(it);
      if (copy) mergeCopy(byId, it.id, copy, [name], it.receivedAt, it.read);
    }
    n += page.items.length;
    const next = typeof page.next === 'string' && CURSOR.test(page.next) && !seen.has(page.next) ? page.next : undefined;
    // 没有下一页：记下产生这一页的游标，下次从这一页重拉（这一页之后新到的也在里面；已有的按编号合并）
    if (!next) return { cursor: cursor ?? null, more: false };
    seen.add(next);
    if (n >= max) return { cursor: next, more: true };
    cursor = next;
  }
}

/**
 * 拉取（TapeRelay §9.6、TapeRelay §9.8 接收第 1 步）：从自己的每台服务器拉（翻页），按编号合并。auth 是自己的（会话密钥或钱包）。
 * 第 295 条（I-222，D-254）：服务器按收到的先后列出（最旧的在前）、通知又不删，所以每台记下拉到哪里：cursors 是上一次返回的 cursors
 * （{ 服务器名字: 游标或 null }，调用方存起来、下次原样传回），从那里接着拉，只拉新的；没传的从头拉。记下的游标被拒（bad-request，例如
 * 服务器换了实现）就从头拉一次。每台每次最多 maxPerServer 条，没拉完的记在 more 里，下次接着拉（越往后越新）。
 * 返回 { items: [{ id, notice, signature, delegation?（第一份的）, copies: [{ notice, signature, delegation?, key, servers }]（内容不同的几份，I-224）,
 *                  receivedAt（最早的那台的）, read（有一台标了已读就算）, servers（收到它的几台） }]（新的在前），
 *        errors: [{ server, code, message? }]（拉不成的几台，它们的游标不变；节点回 delegation-invalid 的带中文 message）, cursors（传进来的另加这次拉成的几台）, more: [还没拉完的几台] }。
 * 拉到的内容还没核对：显示之前要逐条 verifyPulled。
 */
export async function pullInbox(client, servers, auth, { cursors = {}, maxPerServer = 10000 } = {}) {
  const byId = new Map();
  const errors = [], more = [];
  const next = {};
  for (const [k, v] of Object.entries(isObj(cursors) ? cursors : {})) if (v === null || (typeof v === 'string' && CURSOR.test(v))) next[k] = v;
  for (const name of servers) {
    const saved = typeof next[name] === 'string' ? next[name] : undefined;
    try {
      let r;
      try { r = await pullFrom(client, name, auth, saved, maxPerServer, byId); } catch (e) {
        if (saved === undefined || e?.code !== 'bad-request') throw e;
        r = await pullFrom(client, name, auth, undefined, maxPerServer, byId);
      }
      next[name] = r.cursor;
      if (r.more) more.push(name);
    } catch (e) {
      errors.push(refusalEntry(name, e, auth, 'inbox'));
    }
  }
  return { items: [...byId.values()].sort((a, b) => b.receivedAt - a.receivedAt), errors, cursors: next, more };
}

/**
 * 把几次拉到的（pullInbox 的 items，或这台设备记下的）合在一起（第 295 条）：同一编号的合成一项，规则同 pullInbox；
 * 没有 copies 的旧写法（只有 notice、signature、delegation）当作一份。返回新的在前的列表。
 */
export function mergePulled(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const it of Array.isArray(list) ? list : []) {
      if (!isObj(it) || typeof it.id !== 'string' || !HEX64.test(it.id)) continue;
      const servers = Array.isArray(it.servers) ? it.servers.filter((s) => typeof s === 'string') : [];
      const copies = Array.isArray(it.copies) ? it.copies : [{ ...it, servers }];
      for (const x of copies) {
        if (!isObj(x)) continue;
        const copy = copyOf(x);
        if (copy) mergeCopy(byId, it.id, copy, Array.isArray(x.servers) ? x.servers.filter((s) => typeof s === 'string') : [], it.receivedAt, it.read);
      }
      const had = byId.get(it.id);
      if (had) for (const s of servers) if (!had.servers.includes(s)) had.servers.push(s);
    }
  }
  return [...byId.values()].sort((a, b) => b.receivedAt - a.receivedAt);
}

/** 标记已读（TapeRelay §9.6）：items 是 pullInbox 的结果里要标的几条，在收到它的每台上标（每台每次最多 100 个）；返回 [{ server, code }]（没标成的） */
export async function markRead(client, auth, items) {
  const per = new Map();
  for (const it of items) for (const s of it.servers ?? []) { if (!per.has(s)) per.set(s, []); per.get(s).push(it.id); }
  const errors = [];
  for (const [server, ids] of per) {
    for (let i = 0; i < ids.length; i += 100) {
      try { await client.markRead(server, auth, ids.slice(i, i + 100)); } catch (e) { errors.push(refusalEntry(server, e, auth, 'inbox')); break; }
    }
  }
  return errors;
}

/**
 * 「已发送」（D-659）：从自己交过通知的几台服务器拉自己发出的通知（GET /v1/outbox，新的在前、翻页），按编号合并，并逐条核对
 * 是自己签的（verifyNotice 的 as: 'sender'；holderOf 同 verifyNotice）。每台最多拉 maxPerServer 条。
 * 返回 { items: [{ ...verifyNotice 的结果, status（pending | delivered | failed）, error?, submittedAt, server }]（新的在前；核对不过的不给）,
 *        rejected: [{ id, reason }], errors: [{ server, code }] }。直接带密文的用 openNoticeBody(item, keyPairs, { as: 'sender' }) 打开。
 */
export async function pullSent(client, servers, auth, { holderOf, maxPerServer = 1000 } = {}) {
  const byId = new Map(), rejected = [], errors = [];
  for (const name of servers) {
    try {
      let cursor, n = 0;
      const seen = new Set();
      for (;;) {
        const page = await client.sent(name, auth, { cursor, limit: PAGE });
        if (!Array.isArray(page?.items)) throw new TapeRelayError('bad-reply', { server: name });
        for (const it of page.items) {
          if (!isObj(it) || typeof it.id !== 'string' || !HEX64.test(it.id) || byId.has(it.id)) continue;
          const v = await verifyNotice({ id: it.id, notice: it.notice, signature: it.signature, delegation: it.delegation }, { self: auth.account, holderOf, as: 'sender' });
          if (!v.ok) { rejected.push({ id: it.id, reason: v.reason }); continue; }
          byId.set(it.id, { ...v, status: it.status, ...(typeof it.error === 'string' ? { error: it.error } : {}),
            submittedAt: Number.isSafeInteger(it.submittedAt) ? it.submittedAt : 0, server: name });
        }
        n += page.items.length;
        const next = typeof page.next === 'string' && CURSOR.test(page.next) && !seen.has(page.next) ? page.next : undefined;
        if (!next || n >= maxPerServer) break;
        seen.add(next);
        cursor = next;
      }
    } catch (e) {
      errors.push(refusalEntry(name, e, auth, 'inbox'));
    }
  }
  return { items: [...byId.values()].sort((a, b) => b.submittedAt - a.submittedAt), rejected, errors };
}

/**
 * 核对一条通知（TapeRelay §9.7）。item：pullInbox 的一项（id、notice、signature、delegation?）；self：自己的地址；
 * holderOf(account) → 那枚电路的当前持有人地址（TapeRelay §3.5 读链，调用方给；读不到抛错）。
 * 返回 { ok: true, id, from, to, kind: envelope | body, hash（envelope 的）, body（body 的密文，用 openNoticeBody 打开）, servers, createdAt,
 *          signedBy: 'holder' | 'session', validity?: { notBefore, expires } }，
 * 或 { ok: false, reason }：bad-format（格式不对：信封没写服务器、密文的写法不对、带密文的又写了服务器）、bad-id（编号不是摘要）、not-mine（to 不是自己）、
 * bad-kind（envelope、body 不是恰好一项有内容）、
 * bad-signature（签名无效）、unverifiable（签名者既不是当前持有人、也没有合格的授权声明；例如发件人的电路转手了，TapeRelay §9.7 第 2 步）。
 */
export async function verifyNotice(item, { self, holderOf, as = 'recipient' }) {
  const n = noticeOf(item);
  if (!n || !isAccount(n.from) || !isAccount(n.to)) return { ok: false, reason: 'bad-format' };
  if (noticeIdOf(n) !== item.id) return { ok: false, reason: 'bad-id' };
  if ((as === 'sender' ? n.from : n.to) !== self) return { ok: false, reason: 'not-mine' };   // D-659：as 为 sender 时核对自己发出的（pullSent）
  if ((n.envelope === ZERO) === (n.body === '')) return { ok: false, reason: 'bad-kind' };          // D-649：恰好一项有内容
  if (n.envelope !== ZERO ? !checkNoticeServers(n.servers) : (!inlineBodyOk(n.body) || n.servers.length !== 0)) return { ok: false, reason: 'bad-format' };
  const signer = signerOf('Notice', n.from, n, item.signature);
  if (!signer) return { ok: false, reason: 'bad-signature' };
  const holder = await holderOf(n.from);
  const base = { ok: true, id: item.id, from: n.from, to: n.to, ...(n.envelope !== ZERO ? { kind: 'envelope', hash: n.envelope.slice(2) } : { kind: 'body', body: n.body }),
    servers: [...n.servers], createdAt: n.createdAt };
  if (holder && sameAddr(signer, holder)) return { ...base, signedBy: 'holder' };
  const sd = item.delegation;
  const dm = isObj(sd) ? sd.delegation : null;
  if (!dm || typeof sd.signature !== 'string' || !holder) return { ok: false, reason: 'unverifiable' };
  const ok = sameAddr(delegationSigner(sd, n.from, 'send'), holder) && dm.account === n.from && sameAddr(dm.sessionKey, signer)
    && Array.isArray(dm.servers) && dm.servers.length >= 1 && dm.servers.length <= 16
    && Number.isSafeInteger(dm.notBefore) && Number.isSafeInteger(dm.expires) && dm.notBefore <= n.createdAt && n.createdAt <= dm.expires
    && dm.expires - dm.notBefore <= maxDelegationSeconds(dm);           // TapeRelay §8.7（D-520、D-526）：DeveloperKey 最长 366 天，别的 24 小时
  return ok ? { ...base, signedBy: 'session', validity: { notBefore: dm.notBefore, expires: dm.expires }, app: dm.app ?? '' } : { ok: false, reason: 'unverifiable' };
}

/**
 * 核对 pullInbox（或 mergePulled）的一项（第 295 条，I-224）：内容不同的几份逐份 verifyNotice，用第一份核对通过的（另加 copyServers：给出这一份的几台）；
 * 都不通过时：有一份是 unverifiable 就回它（格式、编号、签名都对，只是签名者认不出），否则回第一份的原因；
 * 有一份读链出错、又没有一份通过时抛那个错（调用方按「这次没核对成」算）。
 */
export async function verifyPulled(item, opts) {
  const copies = Array.isArray(item?.copies) && item.copies.length ? item.copies : [item];
  let first = null, unverifiable = null, err = null;
  for (const c of copies) {
    let v;
    try { v = await verifyNotice({ id: item?.id, notice: c?.notice, signature: c?.signature, delegation: c?.delegation }, opts); } catch (e) { err ??= e; continue; }
    if (v.ok) return { ...v, copyServers: Array.isArray(c?.servers) ? [...c.servers] : [] };
    first ??= v;
    if (v.reason === 'unverifiable') unverifiable ??= v;
  }
  if (err) throw err;
  return unverifiable ?? first;
}
