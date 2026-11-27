// TapeRelay 客户端库：服务器消息（TapeRelay §9.10，D-500、D-503、D-504）。2026-10-29 由主编写窗口编写（CHANGELOG 第 439 条）。
// 服务器（运营方）自己发的告警、关服通知、公告。不是通知（inbox.mjs）：不签名，客户端核对不了是谁写的，只能信给它的那台服务器
// （拉取时那条连接的网站证书证明是那台；转交来的由那台回头确认过，TapeRelay §9.10、TapeRelay Security Considerations）。
// - pullServerMessages：从自己发现文件里的每台服务器拉（翻页）；对方没有这个接口（回 not-found）的当作不提供、不算出错（TapeRelay §9.10：
//   features 里有 server-messages 的才拉，拉一次就知道，不另读 /v1/info）。按 from 加 id 合并：同一条几份内容不同时，用 from 那台自己给的
//   （拉的就是它），没有就用第一份，并标出 conflict。每一项另给出：ownServer（from 的主机在自己的名单里：「你在用的服务器」）、
//   relayed（不是从 from 那台拉到的：转交来的）、checkedBy（转交来的：经哪台核对，即拉到它的第一台）、via（从哪几台拉到的）、
//   displayKind（不认识的 kind 按 notice 显示）。
// - markServerMessagesRead：在拉到它的每台上标记已读（每台每次最多 100 个）。
// - openServerMessageFile：附的公开文件只从 from 那台读（本机、内网地址不连，TapeRelay §9.8 接收第 4 步），清单对象最多 16 KiB、必须是公开文件的清单，
//   再按 TapeRelay §7.2 逐块核对。
// 标题、正文是纯文字：界面必须当文字显示（textContent），不当 HTML、Markdown；不得因为一条服务器消息自动做任何事（付款、签名、删除、跳转）；
// 要醒目地写明「这是服务器运营方的话」，不得显示成哪枚电路发的（TapeRelay §9.10「客户端」、TapeRelay Security Considerations）。
// 2026-11-07（D-649，消息层设计稿第五节）：服务器消息一律加密：明着的只有 id、from、to、kind、createdAt（另加 receivedAt、read），
//   标题、正文、附的文件、nonce 在 sealed 里（给收件人加密公钥做的密封盒，内容是 JSON { nonce, title, body, file? }）。拉取要给自己的加密密钥对
//   （keyPairs：当前的和换钥后保留的旧的，逐把去试），打开以后照服务器的算法重算编号（serverMessageId）核对：转交时经手的服务器看不到内容、
//   核对不了编号，由收件人核对。打不开、编号对不上的不收，数进 unopened。
import { HEX64, utf8, sha256Hex } from './core.mjs';
import { openBody } from './sealedbody.mjs';
import { isLocalHost } from './hosts.mjs';
import { readObject, readFile } from './read.mjs';
import { checkManifest, MAX_MANIFEST } from './manifest.mjs';
import { TapeRelayError } from './client.mjs';
import { refusalEntry } from './devkey.mjs';

const ID32 = /^[0-9a-f]{32}$/;
const NAME = /^([a-z0-9]([a-z0-9.-]*[a-z0-9])?):([1-9][0-9]{0,4})$/;   // TapeRelay §4.3 的服务器名字（小写）
const KIND = /^[a-z][a-z0-9-]{0,31}$/;
const KINDS = ['alert', 'exit', 'notice'];
const CURSOR = /^[A-Za-z0-9_-]{1,256}$/;
const PAGE = 100;
const MAX_PAGES = 10;                                  // 每台给一枚电路最多留 60 条（50 条，另加外来的 10 条，D-504），一页就够；多了不再翻
const CONTENT = ['kind', 'displayKind', 'title', 'body', 'file', 'createdAt'];
const SEALED_KEYS = ['nonce', 'title', 'body', 'file'];
const SEALED_MAX = 24576;                              // 与服务器相同（server/src/servermsg.mjs 的 SEALED_MAX）
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const hostOf = (name) => name.replace(/:[0-9]+$/, '');
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

/** 没有落单的代理项（老一点的浏览器没有 String.prototype.isWellFormed） */
const wellFormed = (s) => (typeof s.isWellFormed === 'function' ? s.isWellFormed() : !/[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/.test(s));

/** 纯文字（与服务器的核对相同）：min～max 个字符（按码位算），不含控制字符和双向控制字符（U+202A～U+202E、U+2066～U+2069，I-400）；lines 为真时另许换行 */
function plainText(s, min, max, lines) {
  if (typeof s !== 'string' || !wellFormed(s)) return false;
  const n = [...s].length;
  return n >= min && n <= max && !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(lines ? s.replace(/[\r\n]/g, '') : s);
}

/**
 * 服务器消息的编号（TapeRelay §9.10，I-388、I-408；与服务器的 serverMessageId 相同）：把 taperelay-server-message-2、nonce、from、to、kind、
 * title、body、file（没有是空的）、createdAt（十进制）依次写成「UTF-8 字节数:字节,」接起来，取 SHA-256 的前 32 个十六进制字符
 */
export function serverMessageId({ nonce, from, to, kind, title, body = '', file, createdAt }) {
  const parts = [];
  for (const p of ['taperelay-server-message-2', nonce, from, to, kind, title, body, file ?? '', String(createdAt)]) {
    const b = utf8(String(p));
    parts.push(utf8(`${b.length}:`), b, utf8(','));
  }
  const all = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) { all.set(x, o); o += x.length; }
  return sha256Hex(all).slice(0, 32);
}

/** 明着的各项（id、from、to、kind、sealed、createdAt、receivedAt、read）合不合格式、是不是给 self 的 */
function shapeOk(it, self) {
  if (!isObj(it)) return false;
  const nm = typeof it.from === 'string' ? NAME.exec(it.from) : null;
  return typeof it.id === 'string' && ID32.test(it.id) && !!nm && Number(nm[3]) <= 65535 && it.to === self && typeof it.kind === 'string' && KIND.test(it.kind)
    && typeof it.sealed === 'string' && Number.isSafeInteger(it.createdAt) && it.createdAt >= 0 && Number.isSafeInteger(it.receivedAt) && it.receivedAt >= 0
    && typeof it.read === 'boolean';
}

/** 打开 sealed、核对里面的内容和编号；对返回 { nonce, title, body, file? }，不对返回 null */
function openSealed(it, keyPairs) {
  let plain = null;
  for (const kp of Array.isArray(keyPairs) ? keyPairs : [keyPairs]) { plain = openBody(it.sealed, kp, { max: SEALED_MAX }); if (plain) break; }
  if (!plain) return null;
  let c;
  try { c = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)); } catch { return null; }
  if (!isObj(c) || !Object.keys(c).every((k) => SEALED_KEYS.includes(k)) || typeof c.nonce !== 'string' || !ID32.test(c.nonce)
    || !plainText(c.title, 1, 100, false) || !plainText(c.body ?? '', 0, 2000, true) || (c.file !== undefined && !(typeof c.file === 'string' && HEX64.test(c.file)))) return null;
  const content = { nonce: c.nonce, title: c.title, body: c.body ?? '', ...(c.file !== undefined ? { file: c.file } : {}) };
  return serverMessageId({ ...content, from: it.from, to: it.to, kind: it.kind, createdAt: it.createdAt }) === it.id ? content : null;   // 编号要是明文内容的摘要
}

/**
 * 拉到的一项（TapeRelay §9.10 的格式，D-649 起内容在 sealed 里，另加 receivedAt、read）：对、是给 self 的、用 keyPairs（自己的加密密钥对，或几把）
 * 打得开、编号对得上，返回整理过的（只留规定的各项，另加 displayKind；sealed 换成打开的 title、body、file）；不对返回 null。
 * kind 只要是小写的一个词就收（以后可能加新的种类），不认识的 displayKind 为 notice
 */
export function checkPulledMessage(it, self, keyPairs) {
  if (!shapeOk(it, self)) return null;
  const c = openSealed(it, keyPairs);
  if (!c) return null;
  return { id: it.id, from: it.from, to: it.to, kind: it.kind, displayKind: KINDS.includes(it.kind) ? it.kind : 'notice', title: c.title, body: c.body,
    ...(c.file !== undefined ? { file: c.file } : {}), createdAt: it.createdAt, receivedAt: it.receivedAt, read: it.read };
}

const sameContent = (a, b) => CONTENT.every((k) => a[k] === b[k]);

/** 把 server 给的一份合进 byKey（按 from 加 id）：via、read、receivedAt 合并；内容不同时用 from 那台自己给的，标出 conflict */
function merge(byKey, m, server) {
  const key = `${m.from} ${m.id}`;
  const had = byKey.get(key);
  if (!had) { byKey.set(key, { ...m, via: [server], conflict: false }); return; }
  if (!had.via.includes(server)) had.via.push(server);
  had.read ||= m.read;
  if (m.receivedAt < had.receivedAt) had.receivedAt = m.receivedAt;
  if (sameContent(had, m)) return;
  had.conflict = true;
  if (hostOf(server) !== hostOf(m.from)) return;
  for (const k of CONTENT) { if (m[k] === undefined) delete had[k]; else had[k] = m[k]; }
}

/**
 * 拉取（TapeRelay §9.10「拉取」）：servers 是自己发现文件里的服务器名字，auth 是自己的（会话密钥要有 inbox 范围，或持有人钱包）。每台翻页拉完（最多 10 页）。
 * keyPairs（D-649）：自己的加密密钥对 { publicKey, secretKey }，或几把（当前的和保留的旧的），用来打开每一条；不给抛 no-key-pair。
 * 返回 { items: [{ id, from, to, kind, displayKind, title, body, file?, createdAt, receivedAt（最早的那台的）, read（有一台标了已读就算）,
 *                  via, conflict, ownServer, relayed, checkedBy }]（新的在前），
 *        errors: [{ server, code, message? }]（拉不成的几台；节点回 delegation-invalid 的带中文 message）, skipped: [服务器名字]（没有这个接口的几台）,
 *        unopened（给自己的、但打不开或编号对不上的份数：不是给这几把公钥的，或经手的服务器改过） }
 */
export async function pullServerMessages(client, servers, auth, { keyPairs } = {}) {
  const list = (Array.isArray(keyPairs) ? keyPairs : [keyPairs]).filter((kp) => kp?.publicKey && kp?.secretKey);
  if (!list.length) fail('no-key-pair', '要用自己的加密密钥对打开服务器消息（服务器消息一律加密）');
  const byKey = new Map();
  const errors = [], skipped = [];
  let unopened = 0;
  for (const name of servers) {
    try {
      let cursor;
      const seen = new Set();
      for (let pages = 1; ; pages++) {
        const page = await client.serverMessages(name, auth, { cursor, limit: PAGE });
        if (!Array.isArray(page?.items)) throw new TapeRelayError('bad-reply', { server: name });
        for (const raw of page.items) {
          if (!shapeOk(raw, auth.account)) continue;
          const m = checkPulledMessage(raw, auth.account, list);
          if (m) merge(byKey, m, name); else unopened++;
        }
        const next = typeof page.next === 'string' && CURSOR.test(page.next) && !seen.has(page.next) ? page.next : undefined;
        if (!next || pages >= MAX_PAGES) break;
        seen.add(next);
        cursor = next;
      }
    } catch (e) {
      if (e?.code === 'not-found') skipped.push(name); else errors.push(refusalEntry(name, e, auth, 'inbox'));   // 2026-11-16：delegation-invalid 的带中文 message（缺「收消息」权限，或节点不认这把密钥）
    }
  }
  const own = new Set(servers.map(hostOf));
  const items = [...byKey.values()].map((x) => {
    const relayed = !x.via.some((v) => hostOf(v) === hostOf(x.from));
    return { ...x, ownServer: own.has(hostOf(x.from)), relayed, checkedBy: relayed ? x.via[0] : null };
  });
  return { items: items.sort((a, b) => b.receivedAt - a.receivedAt), errors, skipped, unopened };
}

/** 标记已读（TapeRelay §9.10）：items 是 pullServerMessages 的结果里要标的几条，在拉到它的每台上标；返回 [{ server, code }]（没标成的） */
export async function markServerMessagesRead(client, auth, items) {
  const per = new Map();
  for (const it of items) for (const s of it.via ?? []) { if (!per.has(s)) per.set(s, []); if (!per.get(s).includes(it.id)) per.get(s).push(it.id); }
  const errors = [];
  for (const [server, ids] of per) {
    for (let i = 0; i < ids.length; i += 100) {
      try { await client.markServerMessagesRead(server, auth, ids.slice(i, i + 100)); } catch (e) { errors.push(refusalEntry(server, e, auth, 'inbox')); break; }
    }
  }
  return errors;
}

/**
 * 读服务器消息附的公开文件（TapeRelay §9.10「客户端」）：只从 from 那台读；from 是本机、内网地址的不连。清单对象最多 16 KiB、必须是公开文件的清单（Files §3），
 * 再按 TapeRelay §7.2 逐块核对。返回 { bytes, manifest }
 */
export async function openServerMessageFile(client, msg, { start, end } = {}) {
  if (typeof msg?.file !== 'string' || !HEX64.test(msg.file)) fail('no-file', '这条服务器消息没有附文件');
  const nm = typeof msg.from === 'string' ? NAME.exec(msg.from) : null;
  if (!nm || isLocalHost(nm[1])) fail('no-servers', '发出这条消息的服务器是本机或内网地址，不连（TapeRelay §9.10、TapeRelay §9.8）');
  const obj = await readObject(client, [msg.from], msg.file, { maxBytes: MAX_MANIFEST });
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(obj); } catch { fail('bad-attachment', '附的不是清单对象（TapeRelay §9.10）'); }
  const { manifest, error } = checkManifest(text);
  if (error || manifest.type !== 'public') fail('bad-attachment', '附的不是公开文件的清单（TapeRelay §9.10、Files §3）');
  return { bytes: await readFile(client, [msg.from], manifest, { start, end }), manifest };
}
