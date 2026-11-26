// TapeRelay 客户端库：加密私钥的备份与转移（Files §6.2～Files §6.4、TapeRelay §4.5；D-128、D-132）。2026-10-12 由主编写窗口编写（CHANGELOG 第 150 条；阶段 3 第 1 步）。
// 两种做法都转同一份「私钥包」（JSON，带当前的和全部保留的旧私钥）：
// - 备份文件：恢复码（或用户自设的口令）经 Argon2id 派生密钥，用 XChaCha20-Poly1305 加密私钥包；文件末尾的检查值分得清「文件坏了」和「口令不对」；
// - 两台设备扫码配对：新设备显示一次性公钥的二维码；旧设备扫码后才随机生成配对码，用户输进新设备；两边的 6 位数字一致、用户在旧设备上确认，
//   旧设备才把私钥包用 sealed box 包给一次性公钥（D-132：配对码在扫码之后才有，换二维码的人没法事先凑出相同的数字）。
// 第 158 条（审查 16 的 I-116）：扫码配对导入时私钥包的第一项必须是发现文件里的那一把（D-136，importPairedBundle）；私钥包缺了生成时间
// 不再写出恢复不了的备份；写完备份自己解开核对一遍；发现文件里没有公钥时另给状态；读到低于下限的参数时提示。
// 不用钱包签名派生任何密钥（D-005、D-020）。私钥只在内存里；这里只做协议的计算，私钥放在哪里（IndexedDB、不可导出的密钥）由调用方管。
// Argon2id 用 @noble/hashes（它的 argon2 没有经过外部审计，所以 client/test/test-crypto.mjs 用 RFC 9106 的官方向量核对，再与 Node.js 自带的对照）。
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { C, utf8, concat, isAccount, normalizeCircuitInput } from './core.mjs';
import { checkPublicKey, publicKeyOf, sealBox, openBox } from './sealedbox.mjs';
import { keyString, parseKeyString, eqBytes, u32be } from './encrypted.mjs';

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // 32 个字符：去掉 I、L、O、U
const MAGIC = utf8(C.keyBackupMagic);
const HEADER = 4 + 1 + 4 + 4 + 1 + 16 + 24;                   // 魔数、版本、内存、轮数、并行度、salt、nonce
export const BACKUP_MIN = Object.freeze({ memKiB: 65536, iterations: 3 });          // 写入方至少（Files §6.3）
export const BACKUP_MAX = Object.freeze({ memKiB: 1048576, iterations: 10 });       // 读的一方最多
const PAIR_MAX_SECONDS = 300;

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
const rand = (n, random) => (random ? random(n) : crypto.getRandomValues(new Uint8Array(n)));
const readU32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

// ---- 恢复码、配对码（Crockford Base32）----

/** 随机的 Crockford Base32 字符串（每个字符 5 位，用拒绝采样，没有偏差） */
function codeOf(len, random) {
  let s = '';
  while (s.length < len) for (const b of rand(len, random)) if (b < 256 - (256 % 32) && s.length < len) s += CROCKFORD[b % 32];
  return s;
}
/** 恢复码：24 个字符（约 120 位），每 4 个一组用 - 隔开 */
export const newRecoveryCode = ({ random } = {}) => codeOf(24, random).match(/.{4}/g).join('-');
/** 配对码：8 个字符（约 40 位），旧设备扫码之后才生成（D-132） */
export const newPairingCode = ({ random } = {}) => codeOf(8, random);
/** 输入的恢复码或配对码按 Files §6.3 规范化：去掉 - 和空白、转成大写，O 当作 0，I、L 当作 1；有别的字符或长度不对返回 null */
export function normalizeCode(s, length) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[-\s]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  return t.length === length && [...t].every((c) => CROCKFORD.includes(c)) ? t : null;
}
/** 恢复码 → 用作口令的字符串（规范化后的 24 个字符）；写法不对抛 bad-code */
export function passphraseFromRecoveryCode(code) {
  return normalizeCode(code, 24) ?? fail('bad-code', '恢复码的写法不对（24 个字符，0～9 和除 I、L、O、U 以外的字母）');
}
/** 用户自设的口令 → 用作口令的字符串（NFKC 规范化）。forWriting 时至少 12 个字符（Files §6.3），强度由界面另查 */
export function passphraseFromUser(s, { forWriting = false } = {}) {
  if (typeof s !== 'string') fail('bad-passphrase', '口令要是字符串');
  const t = s.normalize('NFKC');
  if (forWriting && [...t].length < 12) fail('bad-passphrase', '自设的口令至少 12 个字符（Files §6.3）');
  return t;
}

// ---- 私钥包 ----

/** keyPairs：[{ secretKey, publicKey }]，第一项是当前的，其余是保留的旧私钥（从新到旧，必须全部带上）。createdAt：Unix 秒，不给就用现在 */
export function makeKeyBundle({ account, keyPairs, createdAt = Math.floor(Date.now() / 1000) }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  if (!isAccount(account)) fail('bad-address', 'account 要是电路名，例如 1.2.0（TapeRelay §3.2）');
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) fail('bad-bundle', 'createdAt 要是 Unix 秒（非负整数）');
  if (!Array.isArray(keyPairs) || !keyPairs.length) fail('bad-bundle', '私钥包至少有当前的一对密钥');
  for (const kp of keyPairs) if (!eqBytes(publicKeyOf(kp.secretKey), kp.publicKey)) fail('bad-bundle', '私钥算出的公钥与写的不同');
  return JSON.stringify({ version: 1, account, keys: keyPairs.map((kp) => ({ privateKey: keyString(kp.secretKey), publicKey: keyString(kp.publicKey) })), createdAt });
}

/**
 * 导入前的核对（TapeRelay §4.5）。discoveryKey：发现文件里加密公钥的 32 字节（没有时为 null）。
 * 返回 { keyPairs, status }：status 为 current（第一项就是发现文件里的）、discovery-has-old-key（发现文件里是包里的旧公钥：
 * 可能换钥后发现文件没改成，或者被链上操作员改回了旧的）、predates-key-change（发现文件里的不在包里：这份备份是换钥之前的）、
 * no-discovery-key（发现文件里没有加密公钥，第 158 条）。current 以外的，恢复备份时要用户确认后才导入，客户端不得自动改写发现文件；
 * 扫码配对只收 current（D-136，importPairedBundle）。不合格抛 bad-bundle、wrong-account。
 */
export function checkKeyBundle(json, { account, discoveryKey = null }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  let b;
  try { b = JSON.parse(json); } catch { fail('bad-bundle', '私钥包不是合法的 JSON'); }
  if (!b || b.version !== 1 || !Array.isArray(b.keys) || !b.keys.length || !Number.isSafeInteger(b.createdAt)) fail('bad-bundle', '私钥包的格式不对（Files §6.2）');
  if (b.account !== account) fail('wrong-account', '私钥包不是这枚电路的');
  const keyPairs = b.keys.map((k) => {
    const secretKey = parseKeyString(k?.privateKey), publicKey = parseKeyString(k?.publicKey);
    if (!secretKey || !publicKey || !eqBytes(publicKeyOf(secretKey), publicKey) || checkPublicKey(publicKey) !== 'ok') fail('bad-bundle', '私钥包里有一对密钥对不上（Files §6.2）');
    return { secretKey, publicKey };
  });
  let status = discoveryKey ? 'predates-key-change' : 'no-discovery-key';
  if (discoveryKey && eqBytes(keyPairs[0].publicKey, discoveryKey)) status = 'current';
  else if (discoveryKey && keyPairs.some((kp) => eqBytes(kp.publicKey, discoveryKey))) status = 'discovery-has-old-key';
  return { keyPairs, status, createdAt: b.createdAt };
}

// ---- 备份文件 ----

async function deriveKey(passphrase, salt, memKiB, iterations) {
  return argon2idAsync(utf8(passphrase), salt, { t: iterations, m: memKiB, p: 1, dkLen: 32, maxmem: (BACKUP_MAX.memKiB + 1) * 1024 });
}
/** Argon2id（p = 1、32 字节）派生密钥；只导出给测试和 Node.js 自带的实现对照 */
export const deriveBackupKey = deriveKey;

/**
 * 写备份文件（Files §6.3）：passphrase 来自 passphraseFromRecoveryCode 或 passphraseFromUser。参数低于下限就不写。
 * 第 158 条：先按 checkKeyBundle 核对私钥包导入得了，写完用同一把密钥解开核对一遍，都通过才交出（不交出恢复不了的备份）
 */
export async function writeBackup(bundleJson, passphrase, { memKiB = BACKUP_MIN.memKiB, iterations = BACKUP_MIN.iterations, random } = {}) {
  let parsed;
  try { parsed = JSON.parse(bundleJson); } catch { fail('bad-bundle', '私钥包不是合法的 JSON'); }
  checkKeyBundle(bundleJson, { account: parsed?.account });
  if (!Number.isSafeInteger(memKiB) || !Number.isSafeInteger(iterations) || memKiB < BACKUP_MIN.memKiB || iterations < BACKUP_MIN.iterations
    || memKiB > BACKUP_MAX.memKiB || iterations > BACKUP_MAX.iterations) fail('bad-params', '备份文件的参数要在 64 MiB、3 轮到 1 GiB、10 轮之间（Files §6.3）');
  if (typeof passphrase !== 'string' || !passphrase) fail('bad-passphrase', '没有口令');
  const salt = rand(16, random), nonce = rand(24, random);
  const header = concat(MAGIC, Uint8Array.of(1), u32be(memKiB), u32be(iterations), Uint8Array.of(1), salt, nonce);
  const key = await deriveKey(passphrase, salt, memKiB, iterations);
  try {
    const ct = xchacha20poly1305(key, nonce, header).encrypt(utf8(bundleJson));
    const back = new TextDecoder().decode(xchacha20poly1305(key, nonce, header).decrypt(ct));
    if (back !== bundleJson) fail('self-check', '备份文件写完解不回原来的私钥包，不交出');
    const body = concat(header, ct);
    return concat(body, sha256(body));
  } finally { key.fill(0); }
}

/**
 * 读备份文件，返回 { bundle（私钥包的 JSON，再交给 checkKeyBundle）, weak }。weak 为 true：参数低于写入方的下限（64 MiB、3 轮），
 * 只能是不合规的客户端写的，界面应当提示「这份备份的保护比规范要求的弱，恢复后建议重新备份」（第 158 条，I-116 第 4 点）。
 * 抛（code）：bad-format（不是本协议的备份文件）、damaged（检查值不对：文件坏了）、bad-params（参数超过上限，没有去算）、
 * wrong-passphrase（检查值对、解不开：口令或恢复码不对）。
 */
export async function readBackup(bytes, passphrase) {
  if (!(bytes instanceof Uint8Array) || bytes.length < HEADER + 16 + 32 || !eqBytes(bytes.subarray(0, 4), MAGIC) || bytes[4] !== 1) fail('bad-format', '不是本协议的备份文件（Files §6.3）');
  const body = bytes.subarray(0, bytes.length - 32);
  if (!eqBytes(sha256(body), bytes.subarray(bytes.length - 32))) fail('damaged', '备份文件已损坏');
  const memKiB = readU32(bytes, 5), iterations = readU32(bytes, 9), parallelism = bytes[13];
  if (memKiB > BACKUP_MAX.memKiB || iterations > BACKUP_MAX.iterations || iterations < 1 || memKiB < 8 || parallelism !== 1) fail('bad-params', '备份文件要的内存或轮数超过上限，不去算（Files §6.3）');
  const salt = bytes.subarray(14, 30), nonce = bytes.subarray(30, 54), header = bytes.subarray(0, HEADER);
  const key = await deriveKey(passphrase, salt, memKiB, iterations);
  try {
    const bundle = new TextDecoder('utf-8', { fatal: true }).decode(xchacha20poly1305(key, nonce, header).decrypt(body.subarray(HEADER)));
    return { bundle, weak: memKiB < BACKUP_MIN.memKiB || iterations < BACKUP_MIN.iterations };
  } catch { return fail('wrong-passphrase', '口令或恢复码不对'); } finally { key.fill(0); }
}

// ---- 两台设备扫码配对 ----

/** 新设备：生成一次性密钥对和二维码的内容（JSON）。返回 { qr, secretKey, publicKey }；一次性私钥用完或过期就删掉 */
export function pairingRequest({ account, now, seconds = PAIR_MAX_SECONDS, random }) {
  if (!isAccount(account)) fail('bad-address', 'account 要是电路名，例如 1.2.0（TapeRelay §3.2）');
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > PAIR_MAX_SECONDS) fail('bad-params', '二维码最多 5 分钟有效');
  const secretKey = rand(32, random), publicKey = publicKeyOf(secretKey);
  return { qr: JSON.stringify({ v: 1, account, key: keyString(publicKey), expires: now + seconds }), secretKey, publicKey };
}

/** 旧设备：扫到的二维码 → 一次性公钥。抛 bad-qr、wrong-account、expired、bad-key */
export function parsePairingRequest(qr, { account, now }) {
  let q;
  try { q = JSON.parse(qr); } catch { fail('bad-qr', '二维码的内容不是本协议的配对请求'); }
  if (!q || q.v !== 1 || typeof q.account !== 'string' || typeof q.key !== 'string' || !Number.isSafeInteger(q.expires)) fail('bad-qr', '二维码的内容不是本协议的配对请求');
  if (q.account !== account) fail('wrong-account', '二维码是另一枚电路的');
  if (!(now <= q.expires && q.expires - now <= PAIR_MAX_SECONDS)) fail('expired', '二维码已过期（或有效期超过 5 分钟）');
  const publicKey = parseKeyString(q.key);
  if (!publicKey || checkPublicKey(publicKey) !== 'ok') fail('bad-key', '二维码里的一次性公钥不合格（TapeRelay §4.4）');
  return { publicKey };
}

/** 两台设备各显示的 6 位数字：SHA-256（"TapeRelay/v1/pair" ‖ 一次性公钥 ‖ 配对码的 8 个字符）前 4 字节（大端）除以 1,000,000 的余数 */
export function pairingNumber(publicKey, pairingCode) {
  const code = normalizeCode(pairingCode, 8) ?? fail('bad-code', '配对码的写法不对（8 个字符）');
  const h = sha256(concat(utf8(C.labels.pair), publicKey, utf8(code)));
  return String(readU32(h, 0) % 1000000).padStart(6, '0');
}

/** 旧设备（用户核对 6 位数字、确认之后）：把私钥包封给一次性公钥 */
export const sealKeyBundle = (bundleJson, oneTimePublicKey) => sealBox(utf8(bundleJson), oneTimePublicKey);
/** 新设备：解开私钥包（再交给 checkKeyBundle）；解不开抛 undecryptable */
export function openKeyBundle(sealed, oneTime) {
  const b = openBox(sealed, oneTime.publicKey, oneTime.secretKey);
  if (!b) fail('undecryptable', '解不开：不是封给这台设备的，或者被改过');
  return new TextDecoder('utf-8', { fatal: true }).decode(b);
}
/**
 * 新设备：扫码配对收到的私钥包，解开并核对（TapeRelay §4.5 扫码配对第 6 步，D-136）：第一项必须是发现文件里的那一把（status 为 current），
 * 否则抛 not-current、不问用户（sealed box 不认证是谁封的，看得到二维码的旁人也能封一份）。返回 checkKeyBundle 的结果。
 */
export function importPairedBundle(sealed, oneTime, { account, discoveryKey }) {
  const r = checkKeyBundle(openKeyBundle(sealed, oneTime), { account, discoveryKey });
  if (r.status !== 'current') fail('not-current', '配对收到的私钥包，第一项不是发现文件里的那把公钥，不导入（TapeRelay §4.5）');
  return r;
}
