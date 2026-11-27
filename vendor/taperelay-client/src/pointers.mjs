// TapeRelay 客户端库：签名指针（TapeRelay §7.3；D-252、D-265、D-283）。2026-10-17 由主编写窗口编写（CHANGELOG 第 312 条）。
// 「这枚电路的这个名字，现在指向这个对象」：名字不变，内容可以换新的版本（公开文件的清单对象，kind 为 manifest）。
// - 写：makePointer 做一条指针：版号取 max(现在的秒数, 上一个版号 + 1)，createdAt 取同一个数（D-283：版号不得大于 createdAt，
//   谁都签不出能长期压住别人的版号）；signPointer 用会话密钥（带上授权声明）或持有人钱包签（walletAuth，钱包弹一次；
//   开发者须知建议网站的指针只用钱包签）；publishPointer 写到自己的每台服务器（每台写一次，请求用 auth 签；指针的签名者可以是钱包，
//   请求照样用会话密钥签，服务器只看指针的签名者是不是持有人，TapeRelay §7.3 第 3 步）。
// - 读：readPointer 向这枚电路发现文件里的每台服务器都要（TapeRelay §7.3「读的人必须」第 1 条），逐条 verifyPointer：写法（包括版号不大于
//   createdAt）、account、name 是要的那个、签名者是此刻的持有人，或带着此刻的持有人签的合格授权声明的会话密钥（TapeRelay §8.3 除「没有被撤销」
//   以外的各条，createdAt 在有效期里；服务器名单那一条读的人不核对，同 inbox.mjs 的 verifyNotice）。在通过的里面取版号最大的（一台服务器
//   藏起最新的也没用）；同一版号内容不同的取 createdAt 晚的、再一样取 target 小的，并标明冲突；会话密钥签的标明（读的人查不到撤销）。
// 签名、核对都用 core.mjs 的 EIP-712（与服务器同一份实现）。此刻的持有人由调用方读链（TapeRelay §3.5）后传进来（holder）。
// 2026-10-22（D-349）：会话密钥签的指针，授权声明要有 pointers 范围；核对通过的另给出 app。
import { domainFor, digest, typedData, utf8, isAccount, normalizeCircuitInput, sameAddr, signerOf, delegationSigner, HEX64, maxDelegationSeconds } from './core.mjs';

/** 名字：1～21 个字符，小写字母、数字和「-」，不以「-」开头或结尾，不含「--」（TapeRelay §7.3，与服务器的相同） */
export const POINTER_NAME = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,19}[a-z0-9])?$/;
/** manifest：公开文件的清单对象；site：站点清单（留给以后的版本，这一版的客户端当作不认识、不打开） */
export const POINTER_KINDS = Object.freeze(['manifest', 'site']);
export const MARK_POINTER_SESSION = '这个名字现在的指针由会话密钥签发';
export const MARK_POINTER_CONFLICT = '这个名字有冲突的版本（同一个版号有两条不同的指针）';
const POINTER_KEYS = ['account', 'name', 'version', 'target', 'kind', 'createdAt'];
const B32 = /^0x[0-9a-f]{64}$/;
const SKEW = 300;                                      // 服务器只收 createdAt 与它的时间相差 300 秒以内的（TapeRelay §7.3 第 4 步）
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

// ---- 写 ----

/**
 * 做一条指针（TapeRelay §7.3）。target：64 位小写十六进制（指向的对象）；previous：这个名字上一个版号（读不到、没有就是 0）；now：Unix 秒。
 * 版号取 max(now, previous + 1)，createdAt 取同一个数（D-283）。上一个版号比现在晚 300 秒以上时，服务器不会收（createdAt 太晚），抛 too-soon。
 */
export function makePointer({ account, name, target, kind = 'manifest', previous = 0, now }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  if (!isAccount(account)) fail('bad-address', 'account 要是电路名，例如 1.2.0（TapeRelay §3.2）');
  if (typeof name !== 'string' || !POINTER_NAME.test(name)) fail('bad-name', '名字要是 1～21 个小写英文字母、数字和「-」，不以「-」开头或结尾，不含「--」（TapeRelay §7.3）');
  if (typeof target !== 'string' || !HEX64.test(target)) fail('bad-target', 'target 要是 64 位小写十六进制');
  if (!POINTER_KINDS.includes(kind)) fail('bad-kind', 'kind 只能是 manifest 或 site');
  if (!Number.isSafeInteger(now) || now < 1 || !Number.isSafeInteger(previous) || previous < 0) fail('bad-time', 'now 要是 Unix 秒，previous 要是不小于 0 的整数');
  const version = Math.max(now, previous + 1);
  if (version - now > SKEW) fail('too-soon', '这个名字上一个版号比现在晚 5 分钟以上（短时间里改了太多次，或者服务器存着别人签的版号）：过几分钟再发');
  return { account, name, version, target: `0x${target}`, kind, createdAt: version };
}

/**
 * 签名（TapeRelay §7.3）：auth 是 session.mjs 的 sessionAuth（会话密钥签，带上授权声明）或 walletAuth（持有人钱包直接签）。
 * 返回 { pointer, body（传输格式「签名的指针」的 JSON 文本，写给服务器的就是它） }。
 */
export async function signPointer(auth, pointer) {
  if (!auth || auth.account !== pointer?.account) fail('bad-pointer', '签名的电路要是指针的 account');
  const domain = domainFor(pointer.account);
  const d = digest('Pointer', domain, pointer);
  if (!d) fail('bad-pointer', '指针的格式不对（TapeRelay §7.3）');
  if (auth.sessionKey && !isObj(auth.delegation)) fail('bad-pointer', '会话密钥签的指针要带授权声明（TapeRelay §7.3）：sessionAuth 里没有');
  const signature = await auth.sign(d, typedData('Pointer', domain, pointer));
  return { pointer, body: JSON.stringify({ pointer, signature, ...(auth.sessionKey ? { delegation: auth.delegation } : {}) }) };
}

/**
 * 写到自己的每台服务器（TapeRelay §7.3 写）：servers 是自己发现文件里的服务器名字，一台一台写，请求用 auth 签。
 * 返回 { stored（存下了的几台）, newer（存着更大版号的几台：pointer-not-newer）, failed: [{ server, code }]（没写成的） }，都照 servers 的顺序。
 */
export async function publishPointer(client, servers, auth, signed) {
  const p = signed?.pointer;
  if (!isObj(p) || !isAccount(p.account) || !POINTER_NAME.test(String(p.name))) fail('bad-pointer', '指针的格式不对（TapeRelay §7.3）');
  const stored = [], newer = [], failed = [];
  for (const server of servers) {
    try {
      await client.putPointer(server, auth, p.account, p.name, utf8(signed.body));
      stored.push(server);
    } catch (e) {
      if (e?.code === 'pointer-not-newer') newer.push(server);
      else failed.push({ server, code: e?.code ?? 'error' });
    }
  }
  return { stored, newer, failed };
}

// ---- 读 ----

/** 一条签名的指针（服务器回的 { pointer, signature, delegation? }）的写法；不对返回 null */
function pointerOf(item) {
  const p = isObj(item) ? item.pointer : null;
  if (!isObj(p) || Object.keys(p).length !== POINTER_KEYS.length || !POINTER_KEYS.every((k) => k in p)) return null;
  if (typeof p.account !== 'string' || typeof p.name !== 'string' || !POINTER_NAME.test(p.name) || !Number.isSafeInteger(p.version) || p.version < 1
    || !Number.isSafeInteger(p.createdAt) || p.createdAt < 0 || p.version > p.createdAt || typeof p.target !== 'string' || !B32.test(p.target)
    || !POINTER_KINDS.includes(p.kind) || typeof item.signature !== 'string' || (item.delegation !== undefined && !isObj(item.delegation))) return null;
  return p;
}

/**
 * 核对一条签名的指针（TapeRelay §7.3「读的人必须」第 1 条）。account、name：要的那个；holder：这枚电路此刻的持有人（调用方读链得到；读不到就不要核对）。
 * 返回 { ok: true, pointer, signedBy: 'holder' | 'session', validity?: { notBefore, expires } }，
 * 或 { ok: false, reason }：bad-format（写法不对，包括版号大于 createdAt）、not-wanted（account 或 name 不是要的）、bad-signature（签名无效）、
 * unverifiable（签名者不是此刻的持有人，也没有此刻的持有人签的合格授权声明：例如持有人换了之后旧持有人签的）。
 */
export function verifyPointer(item, { account, name, holder }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  const p = pointerOf(item);
  if (!p) return { ok: false, reason: 'bad-format' };
  if (p.account !== account || p.name !== name) return { ok: false, reason: 'not-wanted' };
  const signer = signerOf('Pointer', p.account, p, item.signature);
  if (!signer) return { ok: false, reason: 'bad-signature' };
  if (holder && sameAddr(signer, holder)) return { ok: true, pointer: p, signedBy: 'holder' };
  const sd = item.delegation;
  const dm = isObj(sd) ? sd.delegation : null;
  if (!isObj(dm) || typeof sd.signature !== 'string' || !holder) return { ok: false, reason: 'unverifiable' };
  const ok = sameAddr(delegationSigner(sd, p.account, 'pointers'), holder) && dm.account === p.account && sameAddr(dm.sessionKey, signer)
    && Array.isArray(dm.servers) && dm.servers.length >= 1 && dm.servers.length <= 16
    && Number.isSafeInteger(dm.notBefore) && Number.isSafeInteger(dm.expires) && dm.notBefore <= p.createdAt && p.createdAt <= dm.expires
    && dm.expires - dm.notBefore <= maxDelegationSeconds(dm);           // TapeRelay §8.7（D-520、D-526）：DeveloperKey 最长 366 天，别的 24 小时
  return ok ? { ok: true, pointer: p, signedBy: 'session', validity: { notBefore: dm.notBefore, expires: dm.expires }, app: dm.app ?? '' } : { ok: false, reason: 'unverifiable' };
}

const contentKey = (p) => JSON.stringify(POINTER_KEYS.map((k) => p[k]));

/**
 * 读一个名字（TapeRelay §7.3「读的人必须」第 1～3 条）：servers 是这枚电路发现文件里的服务器名字，每台都问（同时问）；holder：此刻的持有人。
 * 返回 { ok: true, pointer, signedBy, validity?, signature, delegation?, servers（给出这一条的几台）, behind（存着旧版本或没有这个名字的几台）,
 *        conflict, marks（要标明的：会话密钥签的、有冲突的版本）, missing（没有这个名字的几台）, errors: [{ server, code }]（没问成的），
 *        rejected: [{ server, reason }]（核对不过的，reason 同 verifyPointer）, replied（回了的台数） }；
 * 一条核对通过的都没有时 { ok: false, reason: unverifiable（有回的、都核对不过）| not-found（回了的都没有这个名字）| unreachable（一台都没问成）, …同上 }。
 */
export async function readPointer(client, servers, { account, name, holder }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  if (!isAccount(account)) fail('bad-address', 'account 要是电路名，例如 1.2.0（TapeRelay §3.2）');
  if (typeof name !== 'string' || !POINTER_NAME.test(name)) fail('bad-name', '名字的写法不对（TapeRelay §7.3）');
  const replies = await Promise.all(servers.map(async (server) => {
    try { return { server, item: await client.getPointer(server, account, name) }; } catch (e) { return { server, code: e?.code ?? 'error' }; }
  }));
  const missing = [], errors = [], rejected = [], good = [];
  for (const r of replies) {
    if (r.code === 'not-found') missing.push(r.server);
    else if (r.code) errors.push({ server: r.server, code: r.code });
    else {
      const v = verifyPointer(r.item, { account, name, holder });
      if (v.ok) good.push({ ...v, server: r.server, item: r.item });
      else rejected.push({ server: r.server, reason: v.reason });
    }
  }
  const replied = servers.length - errors.length;
  const base = { missing, errors, rejected, replied };
  if (!good.length) return { ok: false, reason: rejected.length ? 'unverifiable' : replied ? 'not-found' : 'unreachable', ...base };
  // 版号最大的；同一版号内容不同的，取 createdAt 晚的、再一样取 target 小的（TapeRelay §7.3 第 2 条）；内容相同的，持有人签的排前面
  const top = Math.max(...good.map((g) => g.pointer.version));
  const same = good.filter((g) => g.pointer.version === top).sort((a, b) => b.pointer.createdAt - a.pointer.createdAt
    || (a.pointer.target < b.pointer.target ? -1 : a.pointer.target > b.pointer.target ? 1 : 0)
    || (a.signedBy === b.signedBy ? 0 : a.signedBy === 'holder' ? -1 : 1));
  const best = same[0];
  const key = contentKey(best.pointer);
  const conflict = same.some((g) => contentKey(g.pointer) !== key);
  const marks = [...(best.signedBy === 'session' ? [MARK_POINTER_SESSION] : []), ...(conflict ? [MARK_POINTER_CONFLICT] : [])];
  return { ok: true, pointer: best.pointer, signedBy: best.signedBy, ...(best.validity ? { validity: best.validity } : {}), signature: best.item.signature,
    ...(isObj(best.item.delegation) ? { delegation: best.item.delegation } : {}),
    servers: good.filter((g) => contentKey(g.pointer) === key).map((g) => g.server),
    behind: [...good.filter((g) => g.pointer.version < top).map((g) => g.server), ...missing], conflict, marks, ...base };
}
