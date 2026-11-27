// TapeRelay 客户端库：sealed box 和加密公钥的检查（TapeRelay §4.4、Files §5.1、Files §5.6）。2026-10-12 由主编写窗口编写（CHANGELOG 第 150 条；阶段 3 第 1 步）。
// 单独放在这个小文件里，方便核对（审查 15 的建议）。只用项目已有的 @noble 库（D-036）；和 libsodium 的 crypto_box_seal 逐字节相同，
// 由 client/test/test-crypto.mjs 对照测试向量和 libsodium（libsodium 只在测试里用，D-037）。
// - sealed box = 临时公钥（32 字节） ‖ XSalsa20-Poly1305 的校验码和密文；
//   密钥 = HSalsa20（X25519 共享密钥，16 个零字节），nonce = BLAKE2b-192（临时公钥 ‖ 收件人公钥）。
// - 收件人的公钥先按 TapeRelay §4.4 检查（规范写法、不是小阶点）；算出的共享密钥是全零也拒绝（Files §5.6，I-107）。
// - 字节序（第 158 条，I-115 第 1 点）：@noble/ciphers 的 hsalsa 要的是「字节数组原样的内存」（Uint32Array 视图），大端机器上由它自己换算。
//   第 150 条原来自己按小端逐字节换算，与这个约定相反，在大端机器上会算错（小端机器上结果相同，所以测试测不出），改为照约定交视图。
// - 用完的密钥尽量清零（第 158 条，I-115 第 2 点）：自己生成的临时私钥、算出的 crypto_box 密钥、共享密钥。JavaScript 不保证没有别的副本。
import { x25519 } from '@noble/curves/ed25519.js';
import { xsalsa20poly1305, hsalsa } from '@noble/ciphers/salsa.js';
import { blake2b } from '@noble/hashes/blake2.js';

const P = (1n << 255n) - 19n;
const SIGMA = view32(new TextEncoder().encode('expand 32-byte k'));      // 照 noble 的约定：16 个字节的视图
const PROBE = Uint8Array.from({ length: 32 }, (_, i) => (i * 29 + 7) & 255);   // 任意一个固定的私钥，只用来判断小阶点

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
const isZero = (b) => b.every((x) => x === 0);
/** 字节数组 → 同一段内存的 Uint32Array 视图（先复制一份，保证对齐） */
function view32(bytes) { const copy = Uint8Array.from(bytes); return new Uint32Array(copy.buffer, 0, copy.length / 4); }

/**
 * TapeRelay §4.4：加密公钥是否合格。'ok'；'non-canonical'（按小端读出的整数不小于 2²⁵⁵ − 19，包括最高位为 1）；'small-order'（小阶点：与任何私钥做 X25519 都得全零）。
 * 先判规范写法。不是 32 字节的 Uint8Array 也算 'non-canonical'。
 */
export function checkPublicKey(pk) {
  if (!(pk instanceof Uint8Array) || pk.length !== 32) return 'non-canonical';
  let n = 0n;
  for (let i = 31; i >= 0; i--) n = (n << 8n) | BigInt(pk[i]);
  if (n >= P) return 'non-canonical';
  // 小阶点：私钥经「钳位」后是 8 的倍数，任何私钥与它相乘都得 0。noble 遇到全零的结果会抛错
  try { if (isZero(x25519.getSharedSecret(PROBE, pk))) return 'small-order'; } catch { return 'small-order'; }
  return 'ok';
}

/** X25519 共享密钥 → crypto_box 的密钥（HSalsa20）。共享密钥是全零就拒绝 */
function boxKey(secretKey, publicKey) {
  let shared;
  try { shared = x25519.getSharedSecret(secretKey, publicKey); } catch { fail('bad-public-key', '共享密钥是全零（对方的公钥是小阶点，Files §5.6）'); }
  if (isZero(shared)) fail('bad-public-key', '共享密钥是全零（对方的公钥是小阶点，Files §5.6）');
  const k = view32(shared);
  shared.fill(0);
  const out = new Uint32Array(8);
  hsalsa(SIGMA, k, new Uint32Array(4), out);
  k.fill(0);
  return new Uint8Array(out.buffer);                                           // 输出也照约定按字节视图读
}

/** 一对 X25519 密钥对应的公钥 */
export const publicKeyOf = (secretKey) => x25519.getPublicKey(secretKey);

/**
 * 把 message 封给 recipientPublicKey（libsodium 的 crypto_box_seal）。收件人的公钥不合格抛 bad-public-key。
 * ephemeralSecret：临时私钥，只给测试用（复现测试向量）；平时不传，每次随机生成，用完就丢。
 */
export function sealBox(message, recipientPublicKey, { ephemeralSecret } = {}) {
  const why = checkPublicKey(recipientPublicKey);
  if (why !== 'ok') fail('bad-public-key', `收件人的加密公钥不合格（${why}，TapeRelay §4.4）`);
  const esk = ephemeralSecret ?? crypto.getRandomValues(new Uint8Array(32));
  let key;
  try {
    const epk = x25519.getPublicKey(esk);
    const nonce = blake2b(concat(epk, recipientPublicKey), { dkLen: 24 });
    key = boxKey(esk, recipientPublicKey);
    return concat(epk, xsalsa20poly1305(key, nonce).encrypt(message));
  } finally {
    key?.fill(0);
    if (!ephemeralSecret) esk.fill(0);                                         // 调用方传入的不动
  }
}

/** 用自己的密钥对打开 sealed box（libsodium 的 crypto_box_seal_open）；不是给自己的、被改过的、格式不对的都返回 null */
export function openBox(sealed, publicKey, secretKey) {
  if (!(sealed instanceof Uint8Array) || sealed.length < 48) return null;
  let key;
  try {
    const epk = sealed.subarray(0, 32);
    const nonce = blake2b(concat(epk, publicKey), { dkLen: 24 });
    key = boxKey(secretKey, epk);
    return xsalsa20poly1305(key, nonce).decrypt(sealed.subarray(32));
  } catch { return null; } finally { key?.fill(0); }
}
