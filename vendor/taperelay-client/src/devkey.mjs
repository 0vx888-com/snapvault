// TapeRelay 客户端库：开发者密钥（TapeRelay §8.7，D-511、D-520）。2026-10-29 由主编写窗口编写（CHANGELOG 第 456 条）。
// 开发者密钥就是一份有效期较长（最长 366 天）的授权声明，加上它的会话密钥的私钥，写成 trk1_ 开头的一串。2026-10-30（D-526，审查 38 的 I-398）起
// 授权声明是单独的 EIP-712 类型 DeveloperKey（多一项 note：用途，钱包里显示），钱包里一眼看得出是长期的；网页的 ScopedDelegation 照旧最长 24 小时、不能删除：
//   trk1_ + base64url（不带 =）( JSON { v: 1, key: 私钥（64 位小写十六进制）, delegation: 授权声明, signature, primary } 的 UTF-8 字节 )
//   primary：存文件用的服务器名字（发现文件每一项 url 的名字，一台一个）；授权声明的 servers 另含 443 的后备名字，单看它分不出哪几个是同一台。
// - createDeveloperKey：持有人的钱包签一次 DeveloperKey（有效期按天、最多 366 天），给出这串；
// - parseDeveloperKey：解开、核对写法（要是 DeveloperKey）和「私钥与授权里的 sessionKey 是一对」（持有人的签名由服务器读链核对）；developerKeyAuth 用它签请求；
// - describeDeveloperKey：只给公开的部分（电路、会话密钥的地址、服务器、范围、有效期），给界面、命令行显示。
// 这串就是密钥：这里的报错里不带它；调用方不得把它写进网页、日志、代码库（TapeRelay §8.7）。
import { domainFor, typedData, addressOf, newPrivateKey, base64url, utf8, hex, fromHex, isAccount, normalizeCircuitInput, scopesOf, delegationType, DEV_KEY_MAX_SECONDS, SCOPES } from './core.mjs';
import { sessionAuth } from './session.mjs';

export const DEV_KEY_PREFIX = 'trk1_';   // 上传前查密钥也认它（secretscan.mjs 的 taperelay-key）
const DAY = 86400;
const MAX_DAYS = DEV_KEY_MAX_SECONDS / DAY;  // 366
const NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?:([1-9][0-9]{0,4})$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const bad = (message) => { throw Object.assign(new Error(message), { code: 'bad-developer-key' }); };
/**
 * 2026-11-15（UX 审计第四轮）：钥匙是 undefined、null 或空串（多半是 process.env.TAPERELAY_KEY 没读到：直接 node 运行不读 .env）时的报错，
 * code 为 no-developer-key；createTapeStore 用同一句
 */
export const NO_DEVELOPER_KEY_MESSAGE = '没读到开发者密钥：检查环境变量 TAPERELAY_KEY（.env 里的要用 node --env-file=.env 运行才读得到，Node 20.6 起）';

/**
 * 2026-11-15（UX 审计第五轮中 1）：过期、节点不认时的报错。过期的 code 为 developer-key-expired（发请求之前就报，不去问节点）；
 * 节点回 delegation-invalid 时，createTapeStore 把它说成 DEVELOPER_KEY_REFUSED_MESSAGE（节点分不出是过期、吊销还是不是给它的）
 */
export const DEVELOPER_KEY_REFUSED_MESSAGE = '节点不认这把开发者密钥（过期、被吊销，或不是给这台节点的）';
/** 节点回 delegation-invalid、用的是会话授权（控制台、网页签的，最长 24 小时）时给人看的话 */
export const SESSION_REFUSED_MESSAGE = '节点不认这份会话授权（过期、被撤销，或不是给这台节点的）';
/** 各项权限（范围）在控制台「密钥」页的叫法（entry/console/console.mjs 的 scopeLabel） */
export const SCOPE_TEXT = Object.freeze({ objects: '存文件、读文件', release: '删除文件', send: '发消息', inbox: '收消息', pointers: '指针', admit: '准入' });
/**
 * 2026-11-16（UX 审计第六轮中 2）：节点回 delegation-invalid 时给人看的话（不带服务器名字）。scope：这个请求要的范围（例如 send、inbox）：
 * 签名用的授权里没有这一项的，说成「这把开发者密钥没有「发消息」权限：…」（节点对缺范围、吊销、过期回的都是 delegation-invalid，钥匙里写着有哪几项，这里分得出来）；
 * 有这一项的，开发者密钥说成 DEVELOPER_KEY_REFUSED_MESSAGE，会话授权说成 SESSION_REFUSED_MESSAGE。持有人钱包签的（没有授权声明）返回 null
 */
export function refusedMessage(auth, scope = null) {
  if (!auth?.delegationHeader) return null;
  const dev = delegationType(auth.delegation?.delegation) === 'DeveloperKey';
  if (scope && Array.isArray(auth.scopes) && !auth.scopes.includes(scope)) {
    const label = SCOPE_TEXT[scope] ?? scope;
    const pair = scope === 'send' || scope === 'inbox' ? '（收发电路消息要勾「发消息」「收消息」两项）' : '';
    return dev ? `这把开发者密钥没有「${label}」权限${pair}：到控制台「密钥」另生成一把勾上的，换掉 TAPERELAY_KEY`
      : `这份会话授权没有「${label}」权限${pair}：重新授权时要勾上`;
  }
  return dev ? DEVELOPER_KEY_REFUSED_MESSAGE : SESSION_REFUSED_MESSAGE;
}
/** 节点回 delegation-invalid 的错误（TapeRelayError）：message 换成 refusedMessage 那句、带服务器名字，code 不变；别的错误原样返回 */
export function explainRefusal(e, auth, scope) {
  const text = e?.code === 'delegation-invalid' ? refusedMessage(auth, scope) : null;
  if (text) { try { e.message = `${text}${e.server ? `（${e.server}）` : ''}`; } catch { /* 改不了就照旧 */ } }
  return e;
}
/** 拉取、标已读等「每台各自记一条错误」的：{ server, code, message? }，节点回 delegation-invalid 的带上 refusedMessage 那句 */
export function refusalEntry(server, e, auth, scope) {
  const code = e?.code ?? 'error';
  const text = code === 'delegation-invalid' ? refusedMessage(auth, scope) : null;
  return { server, code, ...(text ? { message: `${text}（${server}）` } : {}) };
}
/** Unix 秒 → 本机时区的 YYYY-MM-DD */
const ymd = (t) => { const d = new Date(t * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** name：放钥匙的环境变量名（模板 A 兼容旧名 TEMPLATE_A_DEV_KEY 时按实际的写） */
export const developerKeyExpiredMessage = (expires, name = 'TAPERELAY_KEY') => `开发者密钥 ${ymd(expires)} 已过期：到控制台「密钥」生成新的，换掉 ${name}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);
/** 钥匙（或 describeDeveloperKey 的结果）过期了就抛 developer-key-expired；now：Unix 秒 */
export function checkDeveloperKeyExpiry(key, now = nowSeconds()) {
  const expires = typeof key === 'object' && key !== null && Number.isSafeInteger(key.expires) ? key.expires : describeDeveloperKey(key).expires;
  if (expires <= now) throw Object.assign(new Error(developerKeyExpiredMessage(expires)), { code: 'developer-key-expired', expires });
  return expires;
}

/**
 * 生成一把开发者密钥。wallet：持有人的钱包（wallet.mjs）；account：电路名（可以只写 1.2.0，签进去的是补全后的完整写法）；servers：存文件用的服务器名字（发现文件的 primaryNames，1～8 个）；
 * fallbacks：另外也要能用的名字（发现文件的 443 后备名字，serverNames 里其余的；TapeRelay §8.3「应当」全填，撤销也能全部送到），合起来最多 16 个；
 * now：Unix 秒；days：有效期的天数（1～366，默认 90）；scopes：范围（默认只有 objects；release 要持有人另外勾选）；app：'' 或开发者的电路名；
 * note：用途（0～60 个字符的纯文字，钱包签名时显示，例如「我的后台」）。
 * 返回 { key（trk1_ 那一串，只在这一次给出）, ...describeDeveloperKey 的那几项 }
 */
export async function createDeveloperKey({ wallet, account, servers, fallbacks = [], now, days = 90, scopes = ['objects'], app = '', note = '' }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 可以只写 1.2.0
  if (typeof app === 'string' && app !== '') app = normalizeCircuitInput(app) ?? app;
  if (!isAccount(account)) throw new Error('account 要是电路名，例如 1.2.0（TapeRelay §3.2）');
  if (!Array.isArray(servers) || servers.length < 1 || servers.length > 8 || !servers.every((n) => NAME.test(n)) || new Set(servers).size !== servers.length) {
    throw new Error('servers 要有 1～8 个服务器名字（主机:端口），不重复');
  }
  if (!Array.isArray(fallbacks) || !fallbacks.every((n) => NAME.test(n))) throw new Error('fallbacks 要是服务器名字（主机:端口）');
  const names = [...new Set([...servers, ...fallbacks])];
  if (names.length > 16) throw new Error('servers 和 fallbacks 合起来最多 16 个名字');
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`有效期要是 1～${MAX_DAYS} 天`);
  if (!Array.isArray(scopes) || !scopes.every((x) => SCOPES.includes(x)) || !scopesOf({ app, scopes, note })) throw new Error('app 要是空字符串或电路名（例如 1.2.0），scopes 要有 1～6 项、取自 objects、send、inbox、pointers、release、admit；note 最多 60 个字，不能有换行之类看不见的字符（TapeRelay §8.7）');
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('now 要是 Unix 秒');
  const privateKey = newPrivateKey();
  const delegation = { account, sessionKey: addressOf(privateKey), servers: names, notBefore: now, expires: now + days * DAY, app, scopes: [...scopes], note };
  const signature = await wallet.signTypedData(typedData('DeveloperKey', domainFor(account), delegation));
  const key = `${DEV_KEY_PREFIX}${base64url(utf8(JSON.stringify({ v: 1, key: hex(privateKey), delegation, signature, primary: [...servers] })))}`;
  privateKey.fill(0);
  return { key, ...describeDeveloperKey(key) };
}

/** base64url（不带 =）→ 字节；写法不对返回 null */
function fromBase64url(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return base64url(out) === s ? out : null;
  } catch { return null; }
}

/**
 * 解开一把开发者密钥：核对写法、私钥与 sessionKey 是一对、授权声明是 DeveloperKey（D-526）、有效期不超过 366 天。不核对持有人的签名（要读链，服务器做）。
 * 返回 { privateKey, session（与 authorizeSession 的结果同样的写法，sessionAuth 用）, primary（存文件用的名字；钥匙里没写时是授权声明的 servers）}。
 * 写法不对抛 code 为 bad-developer-key 的错误（不带这串本身）；没给（undefined、null、空串）抛 code 为 no-developer-key 的错误（NO_DEVELOPER_KEY_MESSAGE）。
 * developerKeyAuth、describeDeveloperKey、serversOfKey 都经过这里
 */
export function parseDeveloperKey(text) {
  if (text === undefined || text === null || (typeof text === 'string' && !text.trim())) throw Object.assign(new Error(NO_DEVELOPER_KEY_MESSAGE), { code: 'no-developer-key' });
  const s = String(text ?? '').trim();
  if (!s.startsWith(DEV_KEY_PREFIX)) bad('不是开发者密钥（要以 trk1_ 开头）');
  const bytes = fromBase64url(s.slice(DEV_KEY_PREFIX.length));
  let v;
  try { v = bytes && JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { v = null; }
  const FIELDS = ['v', 'key', 'delegation', 'signature', 'primary'];
  if (!isObj(v) || !Object.keys(v).every((k) => FIELDS.includes(k)) || v.v !== 1 || typeof v.key !== 'string' || !/^[0-9a-f]{64}$/.test(v.key) || !isObj(v.delegation) || typeof v.signature !== 'string' || !/^0x[0-9a-f]{130}$/.test(v.signature)) {
    bad('开发者密钥的写法不对（复制得不完整？）');
  }
  const dm = v.delegation;
  const keys = ['account', 'sessionKey', 'servers', 'notBefore', 'expires', 'app', 'scopes', 'note'];
  if (Object.keys(dm).length !== keys.length || !keys.every((k) => Object.hasOwn(dm, k)) || delegationType(dm) !== 'DeveloperKey' || !isAccount(dm.account) || !scopesOf(dm)?.length   // D-537：不认的范围忽略，一个认得的都没有就没用
    || !Array.isArray(dm.servers) || dm.servers.length < 1 || dm.servers.length > 16 || !dm.servers.every((n) => typeof n === 'string' && NAME.test(n))
    || !Number.isSafeInteger(dm.notBefore) || !Number.isSafeInteger(dm.expires) || dm.expires <= dm.notBefore || dm.expires - dm.notBefore > DEV_KEY_MAX_SECONDS) {
    bad('开发者密钥里的授权声明不对');
  }
  const p = v.primary;
  if (p !== undefined && (!Array.isArray(p) || p.length < 1 || p.length > 8 || new Set(p).size !== p.length || !p.every((n) => typeof n === 'string' && dm.servers.includes(n)))) {
    bad('开发者密钥里的 primary 不对');
  }
  const privateKey = fromHex(v.key);
  let pair = false;
  try { pair = addressOf(privateKey) === String(dm.sessionKey).toLowerCase(); } catch { pair = false; }
  if (!pair) bad('开发者密钥里的私钥与授权声明不是一对');
  const delegation = { delegation: dm, signature: v.signature };
  const session = { account: dm.account, sessionKey: dm.sessionKey, privateKey, delegation, header: base64url(utf8(JSON.stringify(delegation))),
    app: dm.app, scopes: [...dm.scopes], notBefore: dm.notBefore, expires: dm.expires };
  return { privateKey, session, primary: p ? [...p] : [...dm.servers] };
}

/**
 * 用开发者密钥签请求（sessionAuth 的写法）；另带 expires（Unix 秒）。
 * 2026-11-15（UX 审计第五轮）：每次签之前看有效期，过期了不签、抛 developer-key-expired（「开发者密钥 YYYY-MM-DD 已过期…」），不再让节点回 delegation-invalid
 */
export function developerKeyAuth(text) {
  const { session } = parseDeveloperKey(text);
  const a = sessionAuth(session);
  const sign = a.sign;
  return { ...a, expires: session.expires, async sign(d, td, body) { checkDeveloperKeyExpiry(session); return sign(d, td, body); } };
}

/** 开发者密钥的公开部分：{ account, sessionKey, servers（授权声明里的全部名字）, primary（存文件用的）, scopes, app, note, notBefore, expires }（不含私钥） */
export function describeDeveloperKey(text) {
  const { session, primary } = parseDeveloperKey(text);
  const dm = session.delegation.delegation;
  session.privateKey.fill(0);
  return { account: dm.account, sessionKey: String(dm.sessionKey).toLowerCase(), servers: [...dm.servers], primary, scopes: [...dm.scopes], app: dm.app, note: dm.note, notBefore: dm.notBefore, expires: dm.expires };
}

/** 存文件用的服务器名字（一台一个，最多 8 个）：钥匙里的 primary；没写时取授权声明 servers 的前 8 个 */
export const serversOfKey = (text) => describeDeveloperKey(text).primary.slice(0, 8);
