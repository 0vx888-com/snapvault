// TapeRelay 客户端库：文件通知（TapeRelay §9.8；D-119、D-127）。2026-10-12 由主编写窗口编写（CHANGELOG 第 154 条；阶段 3 第 3 步）。
// 与通知怎样送达无关的那一层：通知本身（做、签、交出、拉取、核对）在 inbox.mjs（第 286 条，收件箱改造：D-225 起只经本协议自己的收件箱，
// 原来的 TapeSend 通道和只用于它的提示、标明——加密发送的两段提示、「中枢尚未封印」「不是持有人钱包直接发的」——都去掉了，D-237）。
// - 发（2026-11-07，D-649、D-655）：一律加密。发之前用 requireRecipientKey 核对对方发现文件里的加密公钥（TapeRelay §4.4）：没有合格的就发不出去
//   （no-encryption-key，「对方还没有开启加密收信，暂时不能给他发消息」）；原来的公开文件通知（清单对象，D-119）、「改选不加密要再提醒一次」
//   （PROMPT_UNENCRYPTED、sendAdvice，I-106）、manifestObjectOf 都去掉了。
// - 收：只有加密文件的通知（kind 为 envelope）要去读文件；直接带密文的（kind 为 body）用 inbox.mjs 的 openNoticeBody 打开。按写明的种类读，不猜（I-108）；跳过本机、内网地址的服务器；陌生发件人的文件，用户点开之前不连；会话密钥签的通知标明（TapeRelay §9.7 第 3 步）；
//   加密文件核对清单的 from（D-127）；清单对象超过 16 KiB 就停；「保存到自己的空间」（I-112 第 5 点）。
import { checkManifest, MAX_MANIFEST, FANOUT, layoutOf, ENCRYPTED_CHUNK, CHUNK, HEX64 } from './manifest.mjs';
import { isLocalHost } from './hosts.mjs';
import { readObject } from './read.mjs';
import { readEncryptedFile, openEnvelope, openIndex, checkRecipientKey } from './encrypted.mjs';
import { NO_KEY_MESSAGE } from './sealedbody.mjs';
import { hex, isAccount, normalizeCircuitInput } from './core.mjs';
import { TapeRelayError } from './client.mjs';

export const MARK_FROM_MISMATCH = '文件写的发件人与通知不符';
/** TapeRelay §9.7 第 3 步：会话密钥签的通知（界面另外显示授权的有效期） */
export const MARK_SESSION_SIGNED = '这条通知由会话密钥签发';
const SERVER_URL = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*):([1-9][0-9]{0,4})$/i;

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

// ---- 发 ----

/** 内核 resolve 的状态 → 电路不存在（TAP-10 §4.2） */
const NO_SUCH_CIRCUIT = Object.freeze(['no-such-token', 'no-such-cpu', 'not-tapeout']);
/** 内核 resolve 的其余不能用的状态 → 中文 */
const STATE_TEXT = Object.freeze({ blocked: '被封禁了', 'store-changed': '链上的容器合约换过实现，这里还不认' });

/**
 * 发之前核对对方的加密公钥（TapeRelay §4.4；2026-11-07 D-649、D-655：消息一律加密）。discovery：对方的发现文件（discovery.mjs 的 parseDiscovery、
 * readDiscovery 的结果，要有 encryptionKey；readDiscovery 给的 status 不是 ok 的当作没有）；account：对方电路的名字（可以只写 1.2.0）；
 * currentHolder：对方电路的当前持有人（读链，最多用 60 秒），也可以直接给 kernel.resolve 的结果（取它的 holder，并按 status 说清楚为什么发不了）。
 * 合格就返回 32 字节的公钥（sealNoticeBody、planEncryptedFile 的收件人都用它）。发不了时抛错，code 分开说（2026-11-15，UX 审计第四轮）：
 * - bad-circuit：电路名认不出（「电路名不对，例如 1.2.0」）；
 * - no-such-circuit：给了 resolve 的结果，状态是 no-such-token、no-such-cpu、not-tapeout（电路不存在）；
 * - not-opened：给了 resolve 的结果，状态是 not-opened（电路的容器还没开通）；
 * - recipient-state：给了 resolve 的结果，状态是别的不能用的（blocked、store-changed 等）；e.status 是原样的状态；
 * - no-encryption-key（NO_KEY_MESSAGE，对方还没有开启加密收信）：没有、签名不对、持有人换了、写法不对，具体原因放在 e.reason。
 */
export function requireRecipientKey(discovery, account, currentHolder) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;
  const stop = (code, message, extra = {}) => { throw Object.assign(new Error(message), { code, ...extra }); };
  if (!isAccount(account)) stop('bad-circuit', '电路名不对，例如 1.2.0');
  let holder = currentHolder;
  if (currentHolder && typeof currentHolder === 'object') {
    const status = String(currentHolder.status ?? '');
    // 2026-11-15（UX 审计第五轮）：报错里的电路名照用户的写法（去掉 .tape，例如 1.2.0）；not-opened 是容器没开通；别的状态写成中文
    const shown = account.replace(/\.tape$/, '');
    if (NO_SUCH_CIRCUIT.includes(status)) stop('no-such-circuit', `电路 ${shown} 不存在：检查电路名有没有写错`, { status });
    if (status === 'not-opened') stop('not-opened', `电路 ${shown} 的容器还没开通，暂时不能给它发消息`, { status });
    if (status && status !== 'ok' && status !== 'unpaid') stop('recipient-state', `电路 ${shown} 现在收不了消息（${STATE_TEXT[status] ?? `链上读到的状态是 ${status}`}）`, { status });
    holder = currentHolder.holder;
  }
  const d = discovery && typeof discovery === 'object' && typeof discovery.status === 'string' && discovery.status !== 'ok' ? null : discovery;
  const r = checkRecipientKey(d?.encryptionKey ?? null, account, holder);
  if (r.ok) return r.publicKey;
  return stop('no-encryption-key', NO_KEY_MESSAGE, { reason: r.reason });
}

/** 通知里的服务器写法（TapeRelay §9.2）：https://主机:端口，1～8 项 */
export function checkNoticeServers(servers) {
  return Array.isArray(servers) && servers.length >= 1 && servers.length <= 8 && servers.every((u) => typeof u === 'string' && SERVER_URL.test(u) && Number(SERVER_URL.exec(u)[2]) <= 65535);
}

// ---- 收 ----

/** https://主机:端口 → 服务器名字「主机:端口」（主机小写）；写法不对返回 null */
export function serverNameOf(url) {
  const m = typeof url === 'string' ? SERVER_URL.exec(url) : null;
  return m && Number(m[2]) <= 65535 ? `${m[1].toLowerCase()}:${m[2]}` : null;
}

/**
 * 收到的文件通知先整理（TapeRelay §9.8 接收第 3、4 步）。notice：inbox.mjs 的 verifyNotice 核对通过、kind 为 envelope 的结果
 * { from, to, kind: envelope, hash, servers, createdAt, signedBy?, validity? }（直接带密文的 kind 为 body，不用读文件：用 openNoticeBody）。
 * knownSender：用户和这个发件人有过往来；fallbackServers：发件人发现文件里的服务器名字（可以作后备）。
 * 会话密钥签的（signedBy 为 session）标明 MARK_SESSION_SIGNED（TapeRelay §9.7 第 3 步）。第 286 条：原来 TapeSend 的「中枢尚未封印」「不是直接发的」两种标明去掉了。
 * 返回 { notice, servers（按顺序要问的服务器名字，本机、内网地址已跳过）, skipped（跳过了几台）, needsUserOpen（陌生发件人：用户点开之前不连）, marks（要向用户标明的） }。
 */
export function prepareReceived(notice, { knownSender = false, fallbackServers = [] } = {}) {
  if (!notice || notice.kind !== 'envelope' || typeof notice.hash !== 'string' || !HEX64.test(notice.hash)
    || !isAccount(notice.from) || !isAccount(notice.to) || !checkNoticeServers(notice.servers)) fail('bad-attachment', '文件通知的格式不对（TapeRelay §9.8）');
  const names = [];
  let skipped = 0;
  for (const n of [...notice.servers.map(serverNameOf), ...fallbackServers]) {
    if (!n || names.includes(n)) continue;
    if (isLocalHost(n.slice(0, n.lastIndexOf(':')))) { skipped++; continue; }
    names.push(n);
  }
  const marks = notice.signedBy === 'session' ? [MARK_SESSION_SIGNED] : [];
  return { notice, servers: names, skipped, needsUserOpen: !knownSender, marks };
}

/**
 * 用户点开之后读文件（TapeRelay §9.8 接收第 2 步）。prepared：prepareReceived 的结果。陌生发件人的通知要传 userOpened: true（用户确实点开了）。
 * 信封：按 Files §5.7 读，核对清单的 from 与通知的发件人（D-649 起通知只附加密文件）。读出来不是信封，抛 bad-attachment。返回 { bytes, manifest, marks }。
 */
export async function openNoticedFile(client, prepared, { keyPairs = [], start, end, userOpened = false } = {}) {
  if (prepared.needsUserOpen && !userOpened) fail('needs-user-open', '陌生发件人的文件，用户点开之前不连接通知里的服务器（TapeRelay §9.8、TapeRelay Security Considerations）');
  if (!prepared.servers.length) fail('no-servers', '通知里没有能连的服务器（本机、内网地址都跳过了）');
  const { notice } = prepared;
  const marks = [...prepared.marks];
  if (notice.kind !== 'envelope') fail('bad-attachment', '这条通知没有附文件（通知只附加密文件）');
  let r;
  try {
    r = await readEncryptedFile(client, prepared.servers, notice.hash, keyPairs, { start, end, expectFrom: notice.from });
  } catch (e) {
    if (!(e instanceof TapeRelayError) && ['bad-magic', 'bad-version', 'bad-count', 'bad-length'].includes(e?.code)) fail('bad-attachment', '写明是信封，读出来不是信封（TapeRelay §9.8）');
    throw e;
  }
  if (r.fromMatches === false) marks.push(MARK_FROM_MISMATCH);
  return { bytes: r.bytes, manifest: r.manifest, marks };
}

/**
 * 一个文件用到的全部对象的哈希（第 225 条，D-166：删除从加密文件目录找回的文件时要知道释放哪些）。servers：服务器名字；
 * kind：envelope（加密文件，要能解开信封：keyPairs）或 manifest（公开文件的清单对象）；hash：信封或清单对象的 SHA-256。信封或清单对象在最后。
 */
export async function fileObjects(client, servers, kind, hash, keyPairs = []) {
  if ((kind !== 'envelope' && kind !== 'manifest') || !HEX64.test(String(hash))) fail('bad-argument', 'kind 只能是 envelope 或 manifest，hash 要是 64 位十六进制');
  return (await objectsOf(client, { notice: { kind, hash }, servers }, keyPairs)).objects;
}

/** 这个文件的全部对象的哈希（读索引得到）：信封或清单对象在最后 */
async function objectsOf(client, prepared, keyPairs) {
  const { notice, servers } = prepared;
  const hashesIn = (b) => Array.from({ length: b.length / 32 }, (_, i) => hex(b.subarray(i * 32, i * 32 + 32)));
  if (notice.kind === 'envelope') {
    const { fileKey, manifest } = openEnvelope(await readObject(client, servers, notice.hash), keyPairs);
    try {
      const { n, levels, lower } = layoutOf(manifest.size, ENCRYPTED_CHUNK);
      const topObj = await readObject(client, servers, manifest.index);
      const top = hashesIn(openIndex(topObj, 0, 0, levels === 1 ? n : lower, fileKey));
      const chunks = [];
      if (levels === 1) chunks.push(...top);
      else for (let j = 0; j < lower; j++) chunks.push(...hashesIn(openIndex(await readObject(client, servers, top[j]), 1, j, Math.min(FANOUT, n - j * FANOUT), fileKey)));
      return { manifest, objects: [manifest.index, ...(levels === 2 ? top : []), ...chunks, notice.hash] };
    } finally { fileKey.fill(0); }
  }
  const { manifest, error } = checkManifest(new TextDecoder().decode(await readObject(client, servers, notice.hash, { maxBytes: MAX_MANIFEST })));
  if (error || manifest.type !== 'public') fail('bad-attachment', '写明是清单对象，读出来不是公开文件的清单（TapeRelay §9.8）');
  const { n, levels } = layoutOf(manifest.size, CHUNK);
  const top = hashesIn(await readObject(client, servers, manifest.index));
  const chunks = [];
  if (levels === 1) chunks.push(...top);
  else for (const h of top) chunks.push(...hashesIn(await readObject(client, servers, h)));
  if (chunks.length !== n) fail('bad-length', '索引的项数与清单的大小对不上（Files §3）');
  return { manifest, objects: [manifest.index, ...(levels === 2 ? top : []), ...chunks, notice.hash] };
}

/**
 * 保存到自己的空间（TapeRelay §9.8 接收第 5 步；D-225 之前是第 7 步）：把这个文件的全部对象认领或原样上传到自己的服务器 ownServer（对象按哈希，原样复制即可）。
 * 返回 { manifest, objects, claimed, uploaded }。加密文件之后由调用方把信封放进自己的目录（directory.mjs 的「放入」，servers 写自己的服务器）。
 */
export async function saveToOwnSpace(client, prepared, { keyPairs = [], ownServer, auth, userOpened = false }) {
  if (prepared.needsUserOpen && !userOpened) fail('needs-user-open', '陌生发件人的文件，用户点开之前不连接通知里的服务器（TapeRelay §9.8、TapeRelay Security Considerations）');
  const { manifest, objects } = await objectsOf(client, prepared, keyPairs);
  const unique = [...new Set(objects)];
  let claimed = 0, uploaded = 0;
  for (let i = 0; i < unique.length; i += 1000) {
    const r = await client.claim(ownServer, auth, unique.slice(i, i + 1000));
    claimed += r.claimed.length;
    for (const sha of r.missing) {
      const bytes = await readObject(client, prepared.servers, sha);
      await client.upload(ownServer, auth, bytes);
      uploaded++;
    }
  }
  return { manifest, objects: unique, claimed, uploaded };
}
