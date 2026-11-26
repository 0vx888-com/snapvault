// TapeRelay 客户端库：协议的共用核心（地址 TapeRelay §3.2、EIP-712 TapeRelay §8.1、TapeRelay §8.6、TapeRelay §15）。2026-10-11 由主编写窗口编写（CHANGELOG 第 90 条）。
// 客户端和参考服务器共用这一份（server/src/eip712.mjs 从这里取），免得两边各写一份、改一边漏一边。
// 2026-11-07（D-634）：身份是电路的链上名字，解析在 circuit.mjs（不依赖任何库），这里转出。
// 浏览器和 Node.js 都能用：只用项目已有的 @noble 库（D-036）和标准的 TextEncoder、crypto.getRandomValues；
// 随名称改变的常量直接取自 spec/constants.json（I-035、D-052）。
import C from './constants.json' with { type: 'json' };
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { isSelfAccount } from './selfid.mjs';
import { isAccount, parseCircuit as parseCircuitName } from './circuit.mjs';

export { C };
// 支持的链、各链的地区码（TAP-10 §2.1）和电路名字的解析（TapeRelay §3.2，D-634）：都在 circuit.mjs
export { SUPPORTED_CHAINS, CHAIN_AREA, AREA_CHAIN, isAccount, parseCircuit, circuitName, chainOf, hostLabelOf, circuitOfHostLabel, normalizeCircuitInput, circuitOfResolved } from './circuit.mjs';
export const HEX64 = /^[0-9a-f]{64}$/;

const enc = new TextEncoder();
export const utf8 = (s) => enc.encode(s);
export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
/** 合约函数的选择器：函数签名（例如 'quotaOf(uint64,string)'）的 keccak256 的前 4 个字节，0x 开头（D-604 从五个模块各自的一份并到这里） */
export const selectorOf = (sig) => `0x${hex(keccak_256(utf8(sig)).subarray(0, 4))}`;
export function fromHex(h) {
  if (typeof h !== 'string' || h.length % 2 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('不是十六进制');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** SHA-256，64 位小写十六进制 */
export const sha256Hex = (bytes) => hex(sha256(bytes));
/** base64url，不带 =（TapeRelay §8.6） */
export function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

// ---- 钱包地址（签名者、持有人）的比较：不分大小写 ----
export const sameAddr = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// ---- 自主身份（第二档身份）：解析在 selfid.mjs（那个模块不引用任何库，服务器也直接用、能单独测）----
export { isSelfAccount, selfKeyOf, selfHostOf, selfHostMatches } from './selfid.mjs';
/** 电路身份或自主身份 —— 只在两档都该收的地方用（通知的 from/to、收件箱的路径）；别处照旧用 isAccount，语义没变 */
export const isAnyAccount = (s) => isAccount(s) || isSelfAccount(s);

// EIP-712 的域名：电路身份按它所在的链（由地区码算出，circuit.mjs 的 chainOf）；自主身份不在任何链上，chainId 写 0 —— 与任何真实链都不同，所以两档的
// 签名不会互相重放，而自主身份的 from 本身含完整身份（含背书的节点），同一档之间也不会串。
export const domainFor = (account) => ({ name: C.eip712DomainName, version: '1', chainId: isSelfAccount(account) ? 0 : parseCircuitName(account)?.chainId ?? NaN });   // 只认规范名字（chainOf 认输入框的写法）

// ---- EIP-712（TapeRelay §15）----
export const TYPE_DEFS = Object.freeze({
  EIP712Domain: 'string name,string version,uint256 chainId',
  Request: 'string account,string server,string method,string path,string query,bytes32 bodyHash,uint64 timestamp,bytes16 nonce',
  // 2026-11-07（D-620）：旧格式的 Delegation（没有 app、scopes）删了；授权声明只有 ScopedDelegation 和 DeveloperKey 两种
  ScopedDelegation: 'string account,address sessionKey,string[] servers,uint64 notBefore,uint64 expires,string app,string[] scopes',   // 2026-10-22（TapeRelay §8.3，D-339、D-349）
  // 2026-10-30（TapeRelay §8.7，D-526，审查 38 的 I-398）：长期的授权（开发者密钥）单独一种类型，钱包里一眼看得出；note 是持有人写的用途（钱包里显示）
  DeveloperKey: 'string account,address sessionKey,string[] servers,uint64 notBefore,uint64 expires,string app,string[] scopes,string note',
  Revocation: 'string account,address sessionKey,uint64 revokedAt',
  Notice: 'string from,string to,bytes32 envelope,string body,string[] servers,uint64 createdAt',   // 2026-11-07（D-649、D-654）：manifest（公开文件）去掉；body 是直接带的密文（sealedbody.mjs）
  // 2026-11-01（免费消息层）：自主身份之间的消息。和 Notice 是两种类型、各自算摘要，所以加这一项不动任何已有的签名。
  // 跟 Notice 的三处不同：① body 直接装内容（客户端自己加密，服务器不看），不指向存储对象，所以不要钱；
  // ② 没有 servers：收件人的节点就写在它的身份里（key:0x…@节点域名），不必读发现文件；③ 域的 chainId 为 0（domainFor），
  // 两层的签名因此不能互相顶用。
  SelfNotice: 'string from,string to,string body,uint64 createdAt',
  // 2026-11-07（D-652、D-655，消息层设计稿第四节）：自主身份公开自己的加密公钥：身份的签名密钥签这一份，放在背书服务器上
  // （PUT /v1/keys/{身份}），谁都能取；服务器改不了内容，最多不给或给旧的。域的 chainId 为 0（domainFor），和 SelfNotice 一样
  SelfEncryptionKey: 'string account,bytes32 key,uint64 createdAt',
  EncryptionKey: 'string account,bytes32 key,address holder',
  Pointer: 'string account,string name,uint64 version,bytes32 target,string kind,uint64 createdAt',     // 第 312 条（TapeRelay §7.3，D-252、D-265）
});
const FIELDS = Object.fromEntries(Object.entries(TYPE_DEFS).map(([n, d]) => [n, d.split(',').map((f) => { const [type, name] = f.split(' '); return { type, name }; })]));
class BadMessage extends Error {}
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
function uintWord(v, bits) {
  if (!Number.isSafeInteger(v) || v < 0 || BigInt(v) >= 1n << BigInt(bits)) throw new BadMessage();
  return fromHex(v.toString(16).padStart(64, '0'));
}
function word(type, v) {
  switch (type) {
    case 'string': if (typeof v !== 'string') throw new BadMessage(); return keccak_256(utf8(v));
    case 'string[]': if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new BadMessage(); return keccak_256(concat(...v.map((s) => keccak_256(utf8(s)))));
    case 'address': if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new BadMessage(); return concat(new Uint8Array(12), fromHex(v.slice(2)));
    case 'bytes32': if (typeof v !== 'string' || !/^0x[0-9a-f]{64}$/.test(v)) throw new BadMessage(); return fromHex(v.slice(2));
    case 'bytes16': if (typeof v !== 'string' || !/^0x[0-9a-f]{32}$/.test(v)) throw new BadMessage(); return concat(fromHex(v.slice(2)), new Uint8Array(16));
    case 'uint64': return uintWord(v, 64);
    case 'uint256': return uintWord(v, 256);
    default: throw new BadMessage();
  }
}
function hashStruct(name, msg) {
  const fields = FIELDS[name];
  if (!fields || !isObj(msg) || Object.keys(msg).length !== fields.length || !fields.every((f) => Object.hasOwn(msg, f.name))) throw new BadMessage();
  return keccak_256(concat(keccak_256(utf8(`${name}(${TYPE_DEFS[name]})`)), ...fields.map((f) => word(f.type, msg[f.name]))));
}
// ---- TapeRelay §8.3 授权声明的范围（D-339、D-349）----
// 2026-10-29（TapeStore §4.3、TapeRelay §8.7，D-520）：加 release（释放对象，用它释放的进回收站；只在 features 写 dev-keys 的服务器上认）。
// 2026-10-30（D-526，审查 38 的 I-398）：release 只在长期的 DeveloperKey 里认；网页的 ScopedDelegation 只有前四种、最长 24 小时：
// 网页被骗签了也删不了文件、最多 24 小时
// 2026-10-30（D-537，I-404 的扩展口）：范围由定义它的标准登记；不认的范围忽略、其余照用（签名照样覆盖它们）；写法、个数、不重复照样核对；
// 登记时写明能不能放进网页的授权：release（TapeStore 登记）只能放进 DeveloperKey，认得它的见到 ScopedDelegation 里有它，整份不收
// 2026-11-07（D-656）：加 admit（替本服务器的免费层身份签「准入」、收回准入，POST /v1/self-admissions），网页的授权和开发者密钥都能给
export const SCOPES = Object.freeze(['objects', 'send', 'inbox', 'pointers', 'release', 'admit']);
/** ScopedDelegation（网页的 24 小时授权）能给的范围：除 release 以外的几种 */
export const SESSION_SCOPES = Object.freeze(['objects', 'send', 'inbox', 'pointers', 'admit']);
/** 只能放进开发者密钥（DeveloperKey）的范围 */
export const DEV_KEY_ONLY_SCOPES = Object.freeze(['release']);
/** 范围的写法（D-537）：小写字母开头，小写字母、数字、-，最多 32 个字符；一份授权 1～16 项 */
export const SCOPE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_SCOPES = 16;
/** 授权声明（delegation 那一项）的 EIP-712 类型：有 note 的是 DeveloperKey（D-526），有 scopes 的是 ScopedDelegation；两项都没有的不合格，返回 null（D-620：旧格式的 Delegation 删了） */
export const delegationType = (dm) => (!isObj(dm) ? null : Object.hasOwn(dm, 'note') ? 'DeveloperKey' : Object.hasOwn(dm, 'scopes') ? 'ScopedDelegation' : null);
// 授权声明的有效期上限（TapeRelay §8.3、TapeRelay §8.7）：ScopedDelegation 24 小时；DeveloperKey 最长 366 天（D-520、D-526）。
// 服务器核对请求（server/src/auth.mjs）、收件人的服务器核对转交来的通知、读的人核对通知（inbox.mjs）和指针（pointers.mjs）都用它
export const SESSION_MAX_SECONDS = 86400;
export const DEV_KEY_MAX_SECONDS = 31622400;
export const maxDelegationSeconds = (dm) => (delegationType(dm) === 'DeveloperKey' ? DEV_KEY_MAX_SECONDS : SESSION_MAX_SECONDS);
/** 开发者密钥的 note（备注）：0～60 个字符（按码位算），没有控制字符、格式字符（如 U+202E）和落单的代理项（钱包里照样显示，不会被倒着排、藏起来） */
const noteOk = (n) => typeof n === 'string' && [...n].length <= 60 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(n);
/**
 * 授权声明给的、known 里认得的范围（D-537：不认的忽略）：ScopedDelegation、DeveloperKey 的 scopes 要 1～16 项、
 * 不重复、写法对（SCOPE_NAME）；ScopedDelegation 里有认得的 DEV_KEY_ONLY_SCOPES（release）整份不合格；DeveloperKey 的 note 要合格；app 要是空字符串
 * 或电路的名字；两项都没有的（原来的旧格式 Delegation，D-620 删了）也不合格。不合 TapeRelay §8.3、TapeRelay §8.7 的返回 null。known 默认是本实现认得的几种（SCOPES）
 */
export function scopesOf(dm, known = SCOPES) {
  const type = delegationType(dm);
  if (!type) return null;
  const s = dm.scopes;
  if (!Array.isArray(s) || s.length < 1 || s.length > MAX_SCOPES || new Set(s).size !== s.length || !s.every((x) => typeof x === 'string' && SCOPE_NAME.test(x))) return null;
  if (type === 'ScopedDelegation' && s.some((x) => DEV_KEY_ONLY_SCOPES.includes(x) && known.includes(x))) return null;
  if (type === 'DeveloperKey' && !noteOk(dm.note)) return null;
  if (!(dm.app === '' || isAccount(dm.app))) return null;
  return s.filter((x) => known.includes(x));
}
/** 签授权声明的持有人（小写地址）；范围里没有 scope、写法不对或签名不对时返回 null */
export function delegationSigner(sd, account, scope) {
  if (!isObj(sd) || !isObj(sd.delegation) || typeof sd.signature !== 'string' || !scopesOf(sd.delegation)?.includes(scope)) return null;
  return signerOf(delegationType(sd.delegation), account, sd.delegation, sd.signature);
}

/** EIP-712 摘要（32 字节）；消息的字段或取值不合格式时返回 null */
export function digest(primaryType, domain, message) {
  try { return keccak_256(concat(Uint8Array.of(0x19, 0x01), hashStruct('EIP712Domain', domain), hashStruct(primaryType, message))); } catch (e) { if (e instanceof BadMessage) return null; throw e; }
}
/** 给钱包 eth_signTypedData_v4 用的 typed data */
export function typedData(primaryType, domain, message) {
  return { types: { EIP712Domain: FIELDS.EIP712Domain, [primaryType]: FIELDS[primaryType] }, primaryType, domain, message };
}

const N = secp256k1.Point.Fn.ORDER;
const SIG_RE = /^0x[0-9a-f]{130}$/;
/** 恢复签名者的地址（小写）。TapeRelay §8.6：v 只能是 27、28，s 必须是低 s；不合格或恢复不出返回 null */
export function recover(digestBytes, sigHex) {
  if (!digestBytes || typeof sigHex !== 'string' || !SIG_RE.test(sigHex)) return null;
  const b = fromHex(sigHex.slice(2));
  const v = b[64];
  if (v !== 27 && v !== 28) return null;
  const s = BigInt(`0x${hex(b.subarray(32, 64))}`);
  if (s === 0n || s > N / 2n) return null;
  try {
    const pub = secp256k1.recoverPublicKey(concat(Uint8Array.of(v - 27), b.subarray(0, 64)), digestBytes, { prehash: false });
    return addressOfPublicKey(secp256k1.Point.fromBytes(pub).toBytes(false));
  } catch { return null; }
}
export const signerOf = (primaryType, account, message, sig) => recover(digest(primaryType, domainFor(account), message), sig);

const addressOfPublicKey = (pub65) => `0x${hex(keccak_256(pub65.subarray(1)).subarray(12))}`;
/** 私钥对应的以太坊地址（小写） */
export const addressOf = (privateKey) => addressOfPublicKey(secp256k1.getPublicKey(privateKey, false));
/** 用私钥签一个摘要：r ‖ s ‖ v，v 为 27 或 28，低 s（TapeRelay §8.6） */
export function signDigest(privateKey, digestBytes) {
  const s = secp256k1.sign(digestBytes, privateKey, { prehash: false, format: 'recovered' });
  return `0x${hex(s.subarray(1))}${(27 + s[0]).toString(16)}`;
}
export const newPrivateKey = () => secp256k1.utils.randomSecretKey();

/**
 * 钱包给的签名按 TapeRelay §8.6 改成本协议的写法（用例 C10）：v 为 0、1 的加 27；高 s 换成低 s（s 换成 n − s，v 在 27、28 之间互换）。
 * 写法不对（不是 65 字节的十六进制、v 不是 0、1、27、28）返回 null。
 */
export function normalizeSignature(sig) {
  if (typeof sig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return null;
  const b = fromHex(sig.slice(2));
  let v = b[64];
  if (v === 0 || v === 1) v += 27;
  if (v !== 27 && v !== 28) return null;
  let s = BigInt(`0x${hex(b.subarray(32, 64))}`);
  if (s === 0n || s >= N) return null;
  if (s > N / 2n) { s = N - s; v = v === 27 ? 28 : 27; }
  return `0x${hex(b.subarray(0, 32))}${s.toString(16).padStart(64, '0')}${v.toString(16)}`;
}
