// TapeRelay 客户端库：加密密钥对和加密文件（TapeRelay §4.4、Files §5.1～Files §5.6、Files §5.7）。2026-10-12 由主编写窗口编写（CHANGELOG 第 150 条；阶段 3 第 1 步）。
// 只用项目已有的 @noble 库（D-036）。加密私钥、文件密钥只在内存里，不写进任何文件和日志，也不交给网页代码（TapeRelay §4.5、TapeRelay Security Considerations）。
// - 加密密钥对：客户端随机生成（D-020），不由钱包签名派生；公钥连同持有人的签名写进发现文件的 encryptionKey（TapeRelay §4.4）。
// - 加密文件：每块、每个索引对象用文件密钥加 XChaCha20-Poly1305，nonce 随机，附加数据带标签、序号（Files §5.2、Files §5.3）；
//   清单写上发件电路 from（D-127），用文件密钥加密后装进信封：魔数 ‖ 版本 ‖ 份数 ‖ 承诺值 ‖ 各份 sealed box ‖ nonce ‖ 加密的清单（Files §5.6）。
// - 末块补齐、份数补齐按 Files §5.2、Files §5.6 的「应当」默认都做（I-111）；各份的顺序打乱，看不出哪一份是发件人自己的。
// - 大文件不整个放进内存：算计划时每块加密一次、只记下哈希和这块的 nonce；上传时用同一个 nonce 重新加密（结果与第一次相同），
//   先核对哈希再交出。原文件中途变了，哈希就对不上，这块不交出、停下：同一个 nonce 绝不会把两段不同的内容加密后发出去。
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { C, hex, fromHex, utf8, concat, sha256Hex, base64url, isAccount, normalizeCircuitInput, domainFor, typedData, signerOf, sameAddr } from './core.mjs';
import { ENCRYPTED_CHUNK, FANOUT, MAX_MANIFEST, contentTypeOf, layoutOf, checkManifest } from './manifest.mjs';
import { sourceOf } from './files.mjs';
import { readObject } from './read.mjs';
import { checkPublicKey, publicKeyOf, sealBox, openBox } from './sealedbox.mjs';

export { checkPublicKey, publicKeyOf, sealBox, openBox };
const OBJECT_MAX = 1048576;
const MAGIC = utf8(C.envelopeMagic);
const SLOT = 80;
const SLOT_STEPS = [2, 4, 8, 16];

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
const rand = (n, random) => (random ? random(n) : crypto.getRandomValues(new Uint8Array(n)));
// D-604：keybackup.mjs 也用这两个（原来各写一份）；不进公开的接口（taperelay.mjs 只导出列出的名字）
export const u32be = (n) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
export const eqBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- Files §6.1、TapeRelay §4.4、TapeRelay §4.5 加密密钥对 ----

/** 随机生成一对加密密钥（D-020）：{ secretKey, publicKey }，都是 32 字节。random 只给测试用 */
export function generateKeyPair({ random } = {}) {
  const secretKey = rand(32, random);
  return { secretKey, publicKey: publicKeyOf(secretKey) };
}
/** 发现文件里的写法：x25519: 加 base64url（不带 =） */
export const keyString = (publicKey) => `x25519:${base64url(publicKey)}`;
/** x25519:… → 32 字节；写法不对返回 null（必须是规范的 base64url，解出来正好 32 字节） */
export function parseKeyString(s) {
  if (typeof s !== 'string' || !/^x25519:[A-Za-z0-9_-]{43}$/.test(s)) return null;
  const b64 = s.slice(7).replace(/-/g, '+').replace(/_/g, '/') + '=';
  const bin = atob(b64);
  const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return out.length === 32 && keyString(out) === s ? out : null;
}

/**
 * 持有人用钱包给加密公钥签名（TapeRelay §4.4），得到发现文件 encryptionKey 的内容：{ key, holder, signature }。
 * wallet：{ address, signTypedData(td) }（wallet.mjs）。公钥不合格时不签。
 */
export async function signEncryptionKey({ wallet, account, publicKey }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  if (!isAccount(account)) fail('bad-address', 'account 要是电路名，例如 1.2.0（TapeRelay §3.2）');
  const why = checkPublicKey(publicKey);
  if (why !== 'ok') fail('bad-public-key', `加密公钥不合格（${why}，TapeRelay §4.4）`);
  const holder = String(wallet.address).toLowerCase();
  const message = { account, key: `0x${hex(publicKey)}`, holder };
  const signature = await wallet.signTypedData(typedData('EncryptionKey', domainFor(account), message));
  return { key: keyString(publicKey), holder, signature };
}

/**
 * 发件人给这枚电路加密之前的核对（TapeRelay §4.4）。encryptionKey：对方发现文件里的那一项；currentHolder：这枚电路的当前持有人，
 * 调用方按 TapeRelay §3.5 读链，读到的结果最多用 60 秒（I-112 第 4 点）。
 * 返回 { ok: true, publicKey } 或 { ok: false, reason }：reason 为 missing、bad-format、bad-signature、holder-changed、non-canonical、small-order。
 * 不 ok 时按「这枚电路不收加密文件」处理，不得用这把公钥加密。
 */
export function checkRecipientKey(encryptionKey, account, currentHolder) {
  if (!encryptionKey) return { ok: false, reason: 'missing' };
  const k = encryptionKey;
  const publicKey = parseKeyString(k.key);
  if (!publicKey || typeof k.holder !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(k.holder) || typeof k.signature !== 'string' || !isAccount(account)) return { ok: false, reason: 'bad-format' };
  const signer = signerOf('EncryptionKey', account, { account, key: `0x${hex(publicKey)}`, holder: k.holder }, k.signature);
  if (!signer || !sameAddr(signer, k.holder)) return { ok: false, reason: 'bad-signature' };
  if (!sameAddr(k.holder, currentHolder)) return { ok: false, reason: 'holder-changed' };
  const why = checkPublicKey(publicKey);
  if (why !== 'ok') return { ok: false, reason: why };
  return { ok: true, publicKey };
}

const sameKey = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/**
 * 自己发现文件里的加密公钥与本机密钥的关系（TapeRelay §4.4、TapeStore §7；第 158 条，D-137）。discovery：{ encryptionKey, currentHolder }；
 * keyPairs：本机的密钥对，第一项是当前的那一把，其余是保留的旧的（TapeRelay §4.5）。返回：
 * ours（发现文件里的就是本机当前的那一把：那个密钥对，否则 null）、old（是本机保留的旧公钥之一）、onDevice（本机有它的私钥）、
 * signed（签名有效、holder 是当前持有人，不管本机有没有私钥）、valid（signed，而且是 ours）、holderIsCurrent（holder 字段写的是当前持有人，不看签名）
 */
export function ownKeyStatus(discovery, account, keyPairs) {
  const pk = parseKeyString(discovery?.encryptionKey?.key);
  const check = checkRecipientKey(discovery?.encryptionKey, account, discovery?.currentHolder);
  const holderIsCurrent = typeof discovery?.encryptionKey?.holder === 'string' && typeof discovery?.currentHolder === 'string' && sameAddr(discovery.encryptionKey.holder, discovery.currentHolder);
  const ours = pk && keyPairs.length && sameKey(keyPairs[0].publicKey, pk) ? keyPairs[0] : null;
  const old = !!pk && !ours && keyPairs.slice(1).some((kp) => sameKey(kp.publicKey, pk));
  return { ours, old, onDevice: !!ours || old, signed: check.ok, valid: check.ok && !!ours, holderIsCurrent };
}

/**
 * 加密文件包给自己的那一份用哪把公钥（Files §5.6、TapeStore §7；第 158 条，D-137）：只能是本机当前的那一把，而且自己发现文件里就是它、签名有效。
 * 返回这把公钥，作 planEncryptedFile 的 selfKey；否则抛：discovery-has-old-key（发现文件里是本机保留的旧公钥，提醒用户照 TapeRelay §4.4 核对发现文件）、
 * need-import（发现文件里的公钥本机没有私钥：从另一台设备或备份导入，TapeRelay §4.5）、need-key-setup（发现文件里没有合格的公钥：先按 TapeRelay §4.4 设好）。
 */
export function selfKeyOf(discovery, account, keyPairs) {
  const k = ownKeyStatus(discovery, account, keyPairs);
  if (k.valid) return k.ours.publicKey;
  if (k.old) fail('discovery-has-old-key', '发现文件里是本机保留的旧公钥：可能被链上操作员改回，或换钥没做完；照 TapeRelay §4.4 核对发现文件');
  if (k.signed) fail('need-import', '发现文件里的加密公钥本机没有私钥：从另一台设备或备份导入（TapeRelay §4.5）');
  return fail('need-key-setup', '发现文件里没有合格的加密公钥：先按 TapeRelay §4.4 设好');
}

// ---- Files §5.2、Files §5.3 逐块加密、加密的索引对象 ----

export const chunkAad = (i, last) => concat(utf8(C.labels.chunk), u32be(i), Uint8Array.of(last ? 1 : 0));
export const indexAad = (level, position) => concat(utf8(C.labels.index), Uint8Array.of(level), u32be(position));
/** 对象 = nonce（24 字节） ‖ 密文和校验码。nonce 不传时随机生成 */
export function encryptObject(key, aad, plaintext, nonce = crypto.getRandomValues(new Uint8Array(24))) {
  return concat(nonce, xchacha20poly1305(key, nonce, aad).encrypt(plaintext));
}
/** 解开一个加密的对象；解不开抛 undecryptable */
export function decryptObject(key, aad, obj) {
  if (!(obj instanceof Uint8Array) || obj.length < 40) fail('undecryptable', '对象太短，解不开');
  try { return xchacha20poly1305(key, obj.subarray(0, 24), aad).decrypt(obj.subarray(24)); } catch { return fail('undecryptable', '解不开（密钥、附加数据不对，或对象被改过）'); }
}
/** Files §5.2 末块补齐：补到 4 KiB、8 KiB……中不小于它的最小一档，超过 chunkSize 的补到 chunkSize */
export function lastChunkPadTarget(len) {
  let t = 4096;
  while (t < len) t *= 2;
  return Math.min(t, ENCRYPTED_CHUNK);
}
/** Files §5.6 份数补齐：补到 2、4、8、16 中不小于 n 的最小一档 */
export const slotPadTarget = (n) => SLOT_STEPS.find((s) => s >= n) ?? fail('too-many-recipients', '收件人（连同自己）最多 16 个（Files §5.6）');

/** 解开第 i 块并按 Files §5.2 核对长度和补齐；lastLen 是最后一块应有的长度。抛 undecryptable、bad-length、bad-padding */
export function openChunk(obj, i, last, key, lastLen) {
  const pt = decryptObject(key, chunkAad(i, last), obj);
  if (!last) { if (pt.length !== ENCRYPTED_CHUNK) fail('bad-length', `第 ${i} 块的长度不对（Files §5.2）`); return pt; }
  if (!Number.isInteger(lastLen) || lastLen < 1 || pt.length < lastLen || pt.length > ENCRYPTED_CHUNK) fail('bad-length', '最后一块的长度不对（Files §5.2）');
  if (pt.subarray(lastLen).some((x) => x !== 0)) fail('bad-padding', '最后一块补的字节不全是零（Files §5.2）');
  return pt.subarray(0, lastLen);
}
/** 解开一个索引对象并核对长度等于「项数 × 32」（Files §5.3）。抛 undecryptable、bad-length */
export function openIndex(obj, level, position, entries, key) {
  const pt = decryptObject(key, indexAad(level, position), obj);
  if (pt.length !== entries * 32) fail('bad-length', '索引对象的长度不对（Files §5.3）');
  return pt;
}

// ---- Files §5.6 信封 ----

export const commitmentOf = (fileKey) => sha256(concat(utf8(C.labels.commit), fileKey));

/** 信封 = 魔数 ‖ 版本 ‖ 份数 ‖ 承诺值 ‖ 各份 ‖ nonce ‖ 加密的清单；清单加密的附加数据是从开头到 nonce 的全部字节（I-028） */
export function buildEnvelope({ fileKey, slots, manifestBytes, nonce = crypto.getRandomValues(new Uint8Array(24)) }) {
  if (slots.length < 1 || slots.length > 16 || slots.some((s) => s.length !== SLOT)) fail('bad-count', '份数要在 1～16 之间，每份 80 字节（Files §5.6）');
  const header = concat(MAGIC, Uint8Array.of(1, slots.length), commitmentOf(fileKey), ...slots, nonce);
  const env = concat(header, xchacha20poly1305(fileKey, nonce, header).encrypt(manifestBytes));
  if (env.length > OBJECT_MAX) fail('too-large', '信封超过 1 MiB');
  return env;
}

/**
 * 按 Files §5.6、Files §5.7 第 3～5 步打开信封。keyPairs：自己的密钥对（当前的和换钥后保留的旧的），逐份、逐把去试。
 * 返回 { fileKey, manifest, manifestJson }。抛（code）：too-large、bad-length、bad-magic、bad-version、bad-count、no-slot、
 * commitment-mismatch、manifest-undecryptable、bad-manifest。
 */
export function openEnvelope(bytes, keyPairs) {
  const n = envelopeSlots(bytes);
  let fileKey = null;
  for (let i = 0; i < n && !fileKey; i++) {
    const slot = bytes.subarray(38 + 80 * i, 118 + 80 * i);
    for (const kp of keyPairs) { const k = openBox(slot, kp.publicKey, kp.secretKey); if (k && k.length === 32) { fileKey = k; break; } }
  }
  if (!fileKey) fail('no-slot', '没有一份是给自己的');
  try {
    return { fileKey, ...manifestOfEnvelope(bytes, n, fileKey) };
  } catch (e) {
    fileKey.fill(0);                                       // 出错的路径也清掉文件密钥（第 158 条，I-115 第 2 点）
    throw e;
  }
}

/**
 * 2026-11-07（网关入口 G1，D-650、D-665）：用文件钥匙直接打开信封（分享链接带的就是它），不用自己的密钥对。
 * 照 Files §5.6 先核对承诺值（钥匙不对、或者信封被换成别的钥匙做的，都在这一步拒绝），再解开清单。fileKey 不清掉（是调用方的）。
 * 返回 { manifest, manifestJson }。抛（code）：bad-key（不是 32 字节），以及 openEnvelope 的 too-large、bad-length、bad-magic、bad-version、bad-count、
 * commitment-mismatch、manifest-undecryptable、bad-manifest。
 */
export function openEnvelopeWithKey(bytes, fileKey) {
  if (!(fileKey instanceof Uint8Array) || fileKey.length !== 32) fail('bad-key', '文件钥匙要是 32 字节');
  return manifestOfEnvelope(bytes, envelopeSlots(bytes), fileKey);
}

/** 信封开头的核对（Files §5.6，openEnvelope 原来的前半段）：返回份数。抛 too-large、bad-length、bad-magic、bad-version、bad-count */
function envelopeSlots(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('bad-length', '信封不是字节');
  if (bytes.length > OBJECT_MAX) fail('too-large', '信封超过 1 MiB');
  if (bytes.length < 6) fail('bad-length', '信封太短');
  if (!eqBytes(bytes.subarray(0, 4), MAGIC)) fail('bad-magic', '魔数不对（Files §5.6）');
  if (bytes[4] !== 1) fail('bad-version', '信封的版本不认识（Files §5.6）');
  const n = bytes[5];
  if (n < 1 || n > 16) fail('bad-count', '份数不在 1～16 之间（Files §5.6）');
  if (bytes.length < 78 + 80 * n) fail('bad-length', '信封的长度对不上（Files §5.6）');
  return n;
}

/** 有了文件密钥之后（Files §5.6，openEnvelope 原来的后半段）：核对承诺值、解开清单。抛 commitment-mismatch、manifest-undecryptable、bad-manifest */
function manifestOfEnvelope(bytes, n, fileKey) {
  if (!eqBytes(commitmentOf(fileKey), bytes.subarray(6, 38))) fail('commitment-mismatch', '文件密钥与承诺值不符，整个信封拒绝（Files §5.6）');
  const end = 62 + 80 * n;
  let plain, manifestJson;
  try { plain = xchacha20poly1305(fileKey, bytes.subarray(end - 24, end), bytes.subarray(0, end)).decrypt(bytes.subarray(end)); } catch { fail('manifest-undecryptable', '清单解不开（Files §5.6）'); }
  try { manifestJson = new TextDecoder('utf-8', { fatal: true }).decode(plain); } catch { fail('bad-manifest', '清单不是合法的 UTF-8（Files §3）'); }
  const { manifest, error } = checkManifest(manifestJson);
  if (error || manifest.type !== 'encrypted') fail('bad-manifest', error ?? '信封里的清单不是加密文件的（Files §5.6）');
  return { manifest, manifestJson };
}

// ---- 加密一个文件（Files §5.2、Files §5.6）----

/**
 * 算出一个加密文件要上传的全部对象。input：Uint8Array 或 Blob。
 * from：做这个信封的电路（自己的电路名，D-127）；selfKey：自己的加密公钥（必须包一份给自己，Files §5.6）；
 * to：收件人的加密公钥（已经按 checkRecipientKey 核对过），只存给自己时为空。
 * 返回计划：{ source, fileKey, chunkHashes, chunkBytes(i), indexObjects, manifest, manifestJson, envelope: { bytes, sha256 }, fileId, extraObjects, dispose() }。
 * 文件密钥只在计划里，用完调用 dispose()。random(n) 只给测试用。
 */
export async function planEncryptedFile(input, { name = '', contentType = 'application/octet-stream', from, selfKey, to = [], wholeSha256 = false, padLast = true, padSlots = true, random } = {}) {
  if (typeof from === 'string') from = normalizeCircuitInput(from) ?? from;   // 电路名可以只写 1.2.0
  if (!isAccount(from)) fail('bad-address', 'from 要是电路名，例如 1.2.0（TapeRelay §3.2、Files §5.5）');
  const recipients = [];
  for (const pk of [selfKey, ...to]) {
    const why = checkPublicKey(pk);
    if (why !== 'ok') fail('bad-public-key', `加密公钥不合格（${why}，TapeRelay §4.4）`);
    if (!recipients.some((r) => eqBytes(r, pk))) recipients.push(pk);
  }
  if (recipients.length > 16) fail('too-many-recipients', '收件人（连同自己）最多 16 个（Files §5.6）');
  const source = sourceOf(input);
  const l = layoutOf(source.size, ENCRYPTED_CHUNK);
  if (!l) fail('bad-size', '文件大小要在 1 字节到两层索引的上限之间（Files §3、Files §5.2；v0.1 不支持空文件）');
  const { n, levels, lower } = l;
  const lastLen = source.size - (n - 1) * ENCRYPTED_CHUNK;
  const fileKey = rand(32, random);
  const nonces = [];
  const chunkHashes = [];
  const whole = wholeSha256 ? sha256.create() : null;
  const plainChunk = plainChunkOf(source, n, padLast);
  for (let i = 0; i < n; i++) {
    const pt = await plainChunk(i);
    whole?.update(i === n - 1 ? pt.subarray(0, lastLen) : pt);
    const nonce = rand(24, random);
    nonces.push(nonce);
    chunkHashes.push(sha256Hex(encryptObject(fileKey, chunkAad(i, i === n - 1), pt, nonce)));
  }
  // 索引对象：两层时先加密各下层，顶层列的是加密后的下层的哈希（Files §5.3）
  const enc = (level, position, plain) => { const bytes = encryptObject(fileKey, indexAad(level, position), plain, rand(24, random)); return { bytes, sha256: sha256Hex(bytes), level, position }; };
  let indexObjects;
  if (levels === 1) indexObjects = [enc(0, 0, concat(...chunkHashes.map(fromHex)))];
  else {
    const lowers = Array.from({ length: lower }, (_, j) => enc(1, j, concat(...chunkHashes.slice(j * FANOUT, (j + 1) * FANOUT).map(fromHex))));
    indexObjects = [enc(0, 0, concat(...lowers.map((o) => fromHex(o.sha256)))), ...lowers];
  }
  const fileId = indexObjects[0].sha256;
  const manifest = { version: 1, type: 'encrypted', name: String(name), contentType: contentTypeOf(contentType), size: source.size, chunkSize: ENCRYPTED_CHUNK, index: fileId };
  if (whole) manifest.sha256 = hex(whole.digest());
  manifest.from = from;
  const manifestJson = JSON.stringify(manifest);
  if (utf8(manifestJson).length > MAX_MANIFEST) fail('bad-manifest', '清单超过 16 KiB（文件名太长？）');
  // 各份：每个收件人一份，补空份到档位（随机的 80 字节），再打乱顺序
  const slots = recipients.map((pk) => sealBox(fileKey, pk, random ? { ephemeralSecret: random(32) } : {}));
  const target = padSlots ? slotPadTarget(slots.length) : slots.length;
  while (slots.length < target) slots.push(rand(SLOT, random));
  for (let i = slots.length - 1; i > 0; i--) {
    const j = rand(1, random)[0] % (i + 1);   // 打乱顺序；份数最多 16，取模的偏差无关紧要（只为不让自己那份总在第一个）
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const envBytes = buildEnvelope({ fileKey, slots, manifestBytes: utf8(manifestJson), nonce: rand(24, random) });
  const envelope = { bytes: envBytes, sha256: sha256Hex(envBytes) };
  return planOf({ source, fileKey, chunkHashes, indexObjects, manifest, manifestJson, envelope, nonces, n, plainChunk });
}

/** 读第 i 块的明文；最后一块照 Files §5.2 补齐（padLast） */
function plainChunkOf(source, n, padLast) {
  return async (i) => {
    const pt = await source.read(i * ENCRYPTED_CHUNK, Math.min(source.size, (i + 1) * ENCRYPTED_CHUNK));
    if (i < n - 1 || !padLast) return pt;
    const padded = new Uint8Array(lastChunkPadTarget(pt.length));
    padded.set(pt);
    return padded;
  };
}

/** planEncryptedFile、planEncryptedResume 共用：组出计划（第 409 条从 planEncryptedFile 挪出来，内容不变，另带 nonces） */
function planOf({ source, fileKey, chunkHashes, indexObjects, manifest, manifestJson, envelope, nonces, n, plainChunk }) {
  return {
    source, fileKey, chunkHashes, indexObjects, manifest, manifestJson, envelope, fileId: indexObjects[0].sha256,
    extraObjects: [envelope],                    // 上传时最后传（uploadFile）：信封在了，其余对象就都在了
    nonces,                                      // 第 409 条：每块的 nonce（不是秘密，本来就在每块的开头），接着传时要用（resumableOf）
    /** 第 i 块加密后的字节：用同一个 nonce 重新加密，核对哈希与计划相同才交出（原文件变了就抛错，不交出） */
    async chunkBytes(i) {
      if (fileKey.every((x) => x === 0)) fail('disposed', '计划已经 dispose，文件密钥已清掉');
      const obj = encryptObject(fileKey, chunkAad(i, i === n - 1), await plainChunk(i), nonces[i]);
      if (sha256Hex(obj) !== chunkHashes[i]) fail('source-changed', `第 ${i} 块的原文在计划之后变了，这块不上传`);
      return obj;
    },
    /** 用完清掉内存里的文件密钥（JavaScript 不保证没有别的副本，尽量而为） */
    dispose() { fileKey.fill(0); },
  };
}

/**
 * 第 409 条（I-351，D-471 乙）：一个加密计划里接着传要存下的东西：{ envelope（信封的字节）, index（各索引对象的字节，顶层在前）,
 * nonces（每块的 nonce 连在一起，块数 × 24 字节）}。都不是秘密：信封里的文件密钥封给了各收件人（自己的那份要自己的私钥才打得开），
 * 索引对象是用文件密钥加密的，nonce 本来就写在每块的开头。不含文件密钥。
 */
export function resumableOf(plan) {
  return { envelope: plan.envelope.bytes, index: plan.indexObjects.map((o) => o.bytes), nonces: concat(...plan.nonces) };
}

/**
 * 第 409 条（I-351，D-471 乙）：接着传一个没传完的加密文件。saved 是上次 resumableOf(计划) 存下的；keyPairs 是自己的密钥对（当前的和保留的旧的）。
 * 用自己的私钥打开信封拿回文件密钥，核对存下的索引对象（顶层的哈希就是清单里的 index，下层的哈希就是顶层列的），再把 input 每一块用上次的
 * nonce 重新加密、核对与索引里的哈希相同：都对上才给出计划，与上次的一模一样（每个对象的哈希都相同，已经传上去的认领一下就行，不再传）。
 * 有一块对不上（不是同一个文件），整份不用、报 resume-mismatch：同一个 nonce 绝不会把两段不同的内容加密后发出去。核对要把文件读一遍、
 * 加密一遍，花费与重新计划一次相同。padLast 要与上次相同（默认都补齐）。
 * 返回与 planEncryptedFile 相同的计划（用完 dispose）。报（code）：resume-mismatch（信封打不开、记录对不上、文件不同）。
 */
export async function planEncryptedResume(input, { saved, keyPairs, padLast = true }) {
  const mismatch = (why) => fail('resume-mismatch', `接不上上次没传完的这个加密文件：${why}`);
  if (!(saved?.envelope instanceof Uint8Array) || !Array.isArray(saved.index) || !saved.index.length || !saved.index.every((b) => b instanceof Uint8Array)
    || !(saved.nonces instanceof Uint8Array)) mismatch('存下的记录格式不对');
  let opened;
  try { opened = openEnvelope(saved.envelope, keyPairs); } catch (e) { mismatch(`信封打不开（${e?.code ?? e?.message}）`); }
  const { fileKey, manifest, manifestJson } = opened;
  try {
    const source = sourceOf(input);
    if (manifest.size !== source.size || manifest.chunkSize !== ENCRYPTED_CHUNK) mismatch('文件大小与上次不同');
    const { n, levels, lower } = layoutOf(source.size, ENCRYPTED_CHUNK);
    if (saved.nonces.length !== n * 24 || saved.index.length !== (levels === 1 ? 1 : 1 + lower)) mismatch('存下的索引、nonce 个数对不上');
    const indexObjects = saved.index.map((bytes, k) => ({ bytes, sha256: sha256Hex(bytes), level: k === 0 ? 0 : 1, position: k === 0 ? 0 : k - 1 }));
    if (indexObjects[0].sha256 !== manifest.index) mismatch('顶层索引与清单不符');
    const hashesIn = (b) => Array.from({ length: b.length / 32 }, (_, i) => hex(b.subarray(i * 32, i * 32 + 32)));
    let chunkHashes;
    try {
      const top = hashesIn(openIndex(indexObjects[0].bytes, 0, 0, levels === 1 ? n : lower, fileKey));
      if (levels === 1) chunkHashes = top;
      else {
        chunkHashes = [];
        for (let j = 0; j < lower; j++) {
          if (indexObjects[j + 1].sha256 !== top[j]) mismatch(`第 ${j} 个下层索引与顶层列的不符`);
          chunkHashes.push(...hashesIn(openIndex(indexObjects[j + 1].bytes, 1, j, Math.min(FANOUT, n - j * FANOUT), fileKey)));
        }
      }
    } catch (e) { if (e?.code === 'resume-mismatch') throw e; mismatch(`索引解不开（${e?.code ?? e?.message}）`); }
    const nonces = Array.from({ length: n }, (_, i) => saved.nonces.slice(i * 24, i * 24 + 24));
    const plainChunk = plainChunkOf(source, n, padLast);
    const lastLen = source.size - (n - 1) * ENCRYPTED_CHUNK;
    const whole = manifest.sha256 ? sha256.create() : null;
    for (let i = 0; i < n; i++) {
      const pt = await plainChunk(i);
      whole?.update(i === n - 1 ? pt.subarray(0, lastLen) : pt);
      if (sha256Hex(encryptObject(fileKey, chunkAad(i, i === n - 1), pt, nonces[i])) !== chunkHashes[i]) mismatch(`第 ${i} 块与上次的不同（不是同一个文件）`);
    }
    if (whole && hex(whole.digest()) !== manifest.sha256) mismatch('整个文件的 SHA-256 与上次不同');
    const envelope = { bytes: saved.envelope, sha256: sha256Hex(saved.envelope) };
    return planOf({ source, fileKey, chunkHashes, indexObjects, manifest, manifestJson, envelope, nonces, n, plainChunk });
  } catch (e) {
    fileKey.fill(0);                                       // 出错的路径也清掉文件密钥（与 openEnvelope 相同）
    throw e;
  }
}

// ---- Files §5.7 读加密文件 ----

/**
 * 读一个加密文件的 [start, end) 字节（默认整个）。envelopeSha：信封的哈希（来自通知或自己的目录）；servers：服务器名字，按偏好排序；
 * keyPairs：自己的密钥对（当前的和保留的旧的）。expectFrom：来自通知时，通知的发件人（Files §5.7 第 5 步）。
 * 返回 { bytes, manifest, fromMatches }：fromMatches 为 false 时，调用方必须向用户标明「文件写的发件人与通知不符」；不来自通知时为 null。
 */
export async function readEncryptedFile(client, servers, envelopeSha, keyPairs, { start = 0, end, expectFrom } = {}) {
  const envBytes = await readObject(client, servers, envelopeSha);
  const { fileKey, manifest } = openEnvelope(envBytes, keyPairs);
  try {
    const bytes = await chunkReader(client, servers, manifest, fileKey, 0)(start, end ?? manifest.size);
    return { bytes, manifest, fromMatches: expectFrom === undefined ? null : manifest.from === expectFrom };
  } finally {
    fileKey.fill(0);
  }
}

/**
 * 按清单读 [start, end) 字节：逐块取、核对哈希（readObject）、解开并核对长度和补齐（openChunk）；读的是整个文件、清单里有 sha256 时再核对整个文件。
 * readEncryptedFile 原来的后半段（2026-11-07 网关入口 G1 挪出来，行为不变），按文件钥匙读的也用它。
 * 返回 read(start, end)。索引只读一次；cacheChunks：记住最近解开的几块明文（打开页拖动进度条、播放器反复要同一段时少取几次），0 是不记
 */
function chunkReader(client, servers, manifest, fileKey, cacheChunks) {
  const { n, levels, lower } = layoutOf(manifest.size, ENCRYPTED_CHUNK);
  const lastLen = manifest.size - (n - 1) * ENCRYPTED_CHUNK;
  const hashesIn = (b) => Array.from({ length: b.length / 32 }, (_, i) => hex(b.subarray(i * 32, i * 32 + 32)));
  let top = null;
  const lowerCache = new Map(), recent = new Map();
  async function chunkHash(i) {
    top ??= hashesIn(openIndex(await readObject(client, servers, manifest.index), 0, 0, levels === 1 ? n : lower, fileKey));
    if (levels === 1) return top[i];
    const j = Math.floor(i / FANOUT);
    if (!lowerCache.has(j)) lowerCache.set(j, hashesIn(openIndex(await readObject(client, servers, top[j]), 1, j, Math.min(FANOUT, n - j * FANOUT), fileKey)));
    return lowerCache.get(j)[i - j * FANOUT];
  }
  async function chunk(i) {
    if (recent.has(i)) { const pt = recent.get(i); recent.delete(i); recent.set(i, pt); return pt; }
    const pt = openChunk(await readObject(client, servers, await chunkHash(i)), i, i === n - 1, fileKey, lastLen);
    if (cacheChunks > 0) { recent.set(i, pt); if (recent.size > cacheChunks) recent.delete(recent.keys().next().value); }
    return pt;
  }
  return async function read(start, stop) {
    if (!(Number.isSafeInteger(start) && Number.isSafeInteger(stop) && start >= 0 && stop <= manifest.size && start < stop)) fail('bad-range', '读取的范围不对');
    const first = Math.floor(start / ENCRYPTED_CHUNK), last = Math.floor((stop - 1) / ENCRYPTED_CHUNK);
    const out = new Uint8Array(stop - start);
    let o = 0;
    for (let i = first; i <= last; i++) {
      const pt = await chunk(i);
      const part = pt.subarray(i === first ? start - i * ENCRYPTED_CHUNK : 0, i === last ? stop - i * ENCRYPTED_CHUNK : pt.length);
      out.set(part, o);
      o += part.length;
    }
    if (start === 0 && stop === manifest.size && manifest.sha256 && sha256Hex(out) !== manifest.sha256) fail('file-hash-mismatch', '整个文件的 SHA-256 与清单不符（Files §5.7 第 7 步）');
    return out;
  };
}

/**
 * 2026-11-07（网关入口 G1，D-650、D-665）：按文件钥匙打开一个加密文件（分享链接的打开页用；不用自己的密钥对）。
 * 读信封、用文件钥匙核对承诺值并解开清单（openEnvelopeWithKey），之后按需读任意一段。fileKey：32 字节；这里另存一份，调用方的不动。
 * 返回 { manifest, read(start, end), close() }：read 返回 [start, end) 的明文（每块核对哈希、解开，读整个文件时再核对清单的 sha256）；
 * 用完 close()：清掉这里存的钥匙。cacheChunks：记住最近解开的几块（默认 4 块，约 4 MiB）。
 * 报错（code）：bad-key、openEnvelopeWithKey 的那些（钥匙不对是 commitment-mismatch）、读对象的（not-found、unreachable、hash-mismatch 等，
 * 都是读不到或核对不过）、undecryptable、bad-length、bad-padding（索引、块解不开或不合规矩）、bad-range、file-hash-mismatch、closed。
 */
export async function openEncryptedFileWithKey(client, servers, envelopeSha, fileKey, { cacheChunks = 4 } = {}) {
  if (!(fileKey instanceof Uint8Array) || fileKey.length !== 32) fail('bad-key', '文件钥匙要是 32 字节');
  const key = Uint8Array.from(fileKey);
  try {
    const { manifest } = openEnvelopeWithKey(await readObject(client, servers, envelopeSha), key);
    const read = chunkReader(client, servers, manifest, key, cacheChunks);
    let closed = false;
    return {
      manifest,
      read(start = 0, end = manifest.size) { if (closed) fail('closed', '已经关掉了'); return read(start, end); },
      close() { closed = true; key.fill(0); },
    };
  } catch (e) {
    key.fill(0);
    throw e;
  }
}

/**
 * 2026-11-07（网关入口 G1，D-650 说的「直接用文件钥匙打开」）：按文件钥匙读一个加密文件的 [start, end) 字节（默认整个），与 readEncryptedFile 相同的核对。
 * 返回 { bytes, manifest }。报错同 openEncryptedFileWithKey。
 */
export async function readEncryptedFileWithKey(client, servers, envelopeSha, fileKey, { start = 0, end } = {}) {
  const f = await openEncryptedFileWithKey(client, servers, envelopeSha, fileKey, { cacheChunks: 0 });
  try {
    return { bytes: await f.read(start, end ?? f.manifest.size), manifest: f.manifest };
  } finally {
    f.close();
  }
}
