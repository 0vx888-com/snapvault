// TapeRelay 客户端库：直接放在消息里的密文（2026-11-07，D-649、D-653、D-654、D-655、D-659；消息层设计稿第五节）。
// 两种写法，都是 base64url（不带 =），服务器只核对写法和长度（看不懂、也不该看懂）：
//   - 服务器消息的 sealed：收件人的 X25519 加密公钥做的 libsodium 密封盒（crypto_box_seal，sealedbox.mjs）——sealBody、openBody；
//   - 电路之间的 Notice、免费层的 SelfNotice 的 body：「小信封」（D-659），钥匙给收件人和发件人各包一份，发件人自己也打得开——sealInline、openInline。
// 没有对方的公钥就发不出去（no-encryption-key，D-655）。
// 这个文件只引用 @noble/ciphers、sealedbox.mjs 和 core.mjs 的 base64url，服务器也直接用。
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { base64url } from './core.mjs';
import { sealBox, openBox } from './sealedbox.mjs';

/** 消息里的 body 最多多少个字符（加密、编码之后，D-654）：小信封的原文最多约 2,870 字节、约 950 个汉字（D-659） */
export const SEALED_BODY_MAX = 4096;
/** 密封盒最短：临时公钥 32 + 认证码 16 + 至少 1 字节密文 */
export const SEALED_MIN = 32 + 16 + 1;
/** D-655：对方没有公开加密公钥时给人看的说法 */
export const NO_KEY_MESSAGE = '对方还没有开启加密收信，暂时不能给他发消息';

/** base64url（不带 =）解回字节；写法不对抛错 */
export function fromBase64url(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('不是 base64url');
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** 解得开、编回去一字不差的 base64url（不带 =），不超过 max 个字符；不是返回 null */
function canonicalBytes(body, max) {
  if (typeof body !== 'string' || !/^[A-Za-z0-9_-]+$/.test(body) || body.length > max) return null;
  let bytes;
  try { bytes = fromBase64url(body); } catch { return null; }
  return base64url(bytes) === body ? bytes : null;
}

/** 是不是规范写法的密封盒：base64url 不带 =、解出来再编回去一字不差、至少 49 字节、编码后不超过 max 个字符（服务器消息的 sealed） */
export function sealedBodyOk(body, max = SEALED_BODY_MAX) {
  const bytes = canonicalBytes(body, max);
  return !!bytes && bytes.length >= SEALED_MIN;
}

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

/** 把原文（字节）给 recipientKey（32 字节的 X25519 公钥）做成密封盒，写成 base64url；没有公钥抛 no-encryption-key（D-655）。服务器消息用 */
export function sealBody(plain, recipientKey, { max = SEALED_BODY_MAX } = {}) {
  if (!(recipientKey instanceof Uint8Array)) fail('no-encryption-key', NO_KEY_MESSAGE);
  if (!(plain instanceof Uint8Array) || !plain.length) fail('bad-body', '内容要是非空的字节');
  const body = base64url(sealBox(plain, recipientKey));                 // 公钥不合格时 sealBox 抛 bad-public-key
  if (body.length > max) fail('too-large', `加密以后超过 ${max} 个字符；更长的要存成加密文件`);
  return body;
}

/** 用自己的加密密钥对（{ publicKey, secretKey }）打开密封盒；写法不对、打不开都返回 null */
export function openBody(body, keyPair, { max = SEALED_BODY_MAX } = {}) {
  if (!sealedBodyOk(body, max) || !keyPair?.publicKey || !keyPair?.secretKey) return null;
  return openBox(fromBase64url(body), keyPair.publicKey, keyPair.secretKey);
}

// ---- 2026-11-07（D-659）：消息里直接带的内容用「小信封」，发件人自己也打得开 ----
//   字节 0        INLINE_MAGIC（0xE1：小信封，第 1 版）
//   字节 1        份数，固定 2
//   字节 2～81    第 1 份：一次性钥匙给收件人的公钥做的密封盒（32 + 32 + 16 = 80 字节）
//   字节 82～161  第 2 份：同一把钥匙给发件人自己的公钥做的密封盒
//   字节 162～185 nonce（24 字节，随机）
//   字节 186～    原文用一次性钥匙加 XChaCha20-Poly1305 的密文和校验码（原文至少 1 字节）
// 附加数据 = "TapeRelay/v1/inline" ‖ 字节 0～185：份数、两份钥匙、nonce 都被校验码管着，换掉任何一份都解不开。
// 份数的顺序固定：先收件人、后发件人；打开时按身份只试自己那一份（openInline 的 as）。服务器只核对写法（inlineBodyOk），没有钥匙、解不开。
export const INLINE_MAGIC = 0xe1;
export const INLINE_SLOTS = 2;
const INLINE_SLOT = 80;
const INLINE_HEAD = 2 + INLINE_SLOTS * INLINE_SLOT + 24;
/** 小信封最短：头 186 字节 + 校验码 16 + 至少 1 字节密文 */
export const INLINE_MIN = INLINE_HEAD + 16 + 1;
/** 附加数据的标签（与加密文件各块的标签不同，块和小信封不能互相冒充） */
export const INLINE_LABEL = 'TapeRelay/v1/inline';
const aadOf = (head) => { const l = new TextEncoder().encode(INLINE_LABEL), a = new Uint8Array(l.length + head.length); a.set(l); a.set(head, l.length); return a; };

/** 是不是规范写法的小信封：base64url 不带 =、编回去一字不差、魔数和份数对、至少 203 字节、编码后不超过 max 个字符（服务器、客户端同一份） */
export function inlineBodyOk(body, max = SEALED_BODY_MAX) {
  const bytes = canonicalBytes(body, max);
  return !!bytes && bytes.length >= INLINE_MIN && bytes[0] === INLINE_MAGIC && bytes[1] === INLINE_SLOTS;
}

/**
 * 做小信封（D-659）：plain（非空字节）用随机的一次性钥匙加密一次，钥匙给 recipientKey（收件人的 32 字节公钥）、ownKey（自己的公钥，
 * 或自己的密钥对）各包一份。没有收件人的公钥抛 no-encryption-key（D-655）；没有自己的公钥抛 no-own-key；加密以后超过 max 个字符抛 too-large。
 * fixed 只给测试向量用：{ oneTimeKey, nonce, ephemeral: [收件人那一份的临时私钥, 发件人那一份的临时私钥] }。
 */
export function sealInline(plain, recipientKey, ownKey, { max = SEALED_BODY_MAX, fixed = null } = {}) {
  if (!(recipientKey instanceof Uint8Array)) fail('no-encryption-key', NO_KEY_MESSAGE);
  const own = ownKey instanceof Uint8Array ? ownKey : ownKey?.publicKey;
  if (!(own instanceof Uint8Array)) fail('no-own-key', '要有自己的加密公钥：小信封给发件人自己也包一份钥匙，以后自己能打开（D-659）');
  if (!(plain instanceof Uint8Array) || !plain.length) fail('bad-body', '内容要是非空的字节');
  const key = fixed?.oneTimeKey ?? crypto.getRandomValues(new Uint8Array(32));
  const nonce = fixed?.nonce ?? crypto.getRandomValues(new Uint8Array(24));
  // 公钥不合格（长度不对、小阶点）时 sealBox 抛 bad-public-key
  const slots = [recipientKey, own].map((pk, i) => sealBox(key, pk, fixed?.ephemeral ? { ephemeralSecret: fixed.ephemeral[i] } : {}));
  const head = new Uint8Array(INLINE_HEAD);
  head[0] = INLINE_MAGIC; head[1] = INLINE_SLOTS;
  head.set(slots[0], 2); head.set(slots[1], 2 + INLINE_SLOT); head.set(nonce, 2 + 2 * INLINE_SLOT);
  const ct = xchacha20poly1305(key, nonce, aadOf(head)).encrypt(plain);
  const all = new Uint8Array(head.length + ct.length);
  all.set(head); all.set(ct, head.length);
  const body = base64url(all);
  if (body.length > max) fail('too-large', `加密以后超过 ${max} 个字符（原文约 2,870 字节以内）；更长的要存成加密文件`);
  return body;
}

/**
 * 打开小信封：as 为 recipient（默认）只试第 1 份、sender 只试第 2 份；keyPair 是自己的加密密钥对 { publicKey, secretKey }。
 * 写法不对、不是给这把公钥的、被改过都返回 null。
 */
export function openInline(body, keyPair, { as = 'recipient', max = SEALED_BODY_MAX } = {}) {
  const slot = as === 'recipient' ? 0 : as === 'sender' ? 1 : -1;
  if (slot < 0 || !inlineBodyOk(body, max) || !keyPair?.publicKey || !keyPair?.secretKey) return null;
  const bytes = fromBase64url(body);
  const head = bytes.subarray(0, INLINE_HEAD);
  const key = openBox(bytes.subarray(2 + slot * INLINE_SLOT, 2 + (slot + 1) * INLINE_SLOT), keyPair.publicKey, keyPair.secretKey);
  if (!key || key.length !== 32) return null;
  try { return xchacha20poly1305(key, head.subarray(2 + 2 * INLINE_SLOT), aadOf(head)).decrypt(bytes.subarray(INLINE_HEAD)); } catch { return null; }
}
