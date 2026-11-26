// TapeRelay 客户端库：读官方注册表（质押与退出合约 TapeRelayStake；TapeRelay §10.3、TapeRelay §10.4、TapeRelay §10.5；D-268、D-272、D-273）。
// 2026-10-17 由主编写窗口编写（CHANGELOG 第 308 条）。只读，不发交易。
// - 官方注册表的地址与付款合约一样由调用方传入（客户端钉住的配置；还没部署时为 null，这时照登记表，TapeRelay §10.3）；
// - readStanding：这家运营方在不在保（inGoodStanding）、状态、声明退出的时刻 T0、退出时间 E、冻结到哪一刻（getStake）。
// 第 383 条（D-423、D-431；docs/REGISTRY-DESIGN.md 13.2）：
// - getStake 的第 5 项从「冻没冻」改为「冻结到哪一刻」（冻结有期限）；
// - 读运营方目录（TapeRelayDirectory）：写过名单的编号（翻页）、每家的服务器名单；readOnchainOperators 只留在保的，带上质押钱包
//   （同一个质押钱包的几个编号算一家）。两头核对（每台服务器的 /v1/info 写的编号要是这一家）在 operators.mjs 的 checkOnchainOperator。
// 第 384 条（D-433）：readStanding 另读开着的强制截止（getCutoff）：公示期间这家照常运营、照常卖，提出之后付的钱先留在托管里。
// chain：{ call({ to, data }) → 返回数据（0x 开头的十六进制） }。
import { encodeCall, decodeResult, hexToBytes } from '../vendor/tapekit-kernel/abi.js';
import { hex, selectorOf } from './core.mjs';
import { callMany, batched } from './multicall.mjs';

const sel = selectorOf;
export const REGISTRY_SELECTORS = Object.freeze({
  inGoodStanding: sel('inGoodStanding(uint64)'),
  getStake: sel('getStake(uint64)'),
  stakedBy: sel('stakedBy(uint64)'),
  getCutoff: sel('getCutoff(uint64)'),
});
export const DIRECTORY_SELECTORS = Object.freeze({
  operators: sel('operators(uint256,uint256)'),
  serversOf: sel('serversOf(uint64)'),
});
/** getStake 的 status（合约的 enum Status） */
export const STAKE_STATUS = Object.freeze(['none', 'active', 'exiting', 'completed', 'defaulted']);
const U64 = (1n << 64n) - 1n;
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

/** 解 (uint256, uint64[]) 的返回值（这里的目录用，运营方名册 Worker 也用；2026-10-29 从 payments.mjs 挪来，D-518） */
export function decodeTotalAndIds(out) {
  const b = hexToBytes(out);
  const word = (off) => { if (off + 32 > b.length) fail('bad-reply', '合约返回的数据太短'); return BigInt(`0x${hex(b.subarray(off, off + 32))}`); };
  const total = word(0);
  const at = Number(word(32));
  const n = Number(word(at));
  if (n > 100) fail('bad-reply', '合约返回的套餐太多');
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(word(at + 32 + i * 32));
  return { total, ids };
}
const opId = (operatorId) => {
  if (!/^[1-9][0-9]{0,19}$/.test(String(operatorId)) || BigInt(operatorId) > U64) fail('bad-argument', '运营方编号不对');
  return BigInt(operatorId);
};

/** official：{ chain, contract }（官方公布的注册表合约）；不是这样的写法返回 null（当作没部署） */
export function officialRegistry(official) {
  if (!official || typeof official.chain !== 'string' || !/^eip155:[0-9]+$/.test(official.chain) || !/^0x[0-9a-fA-F]{40}$/.test(String(official.contract))) return null;
  return { chain: official.chain, contract: String(official.contract).toLowerCase() };
}
/**
 * 2026-10-30（D-523）：每条链各一整套合约（付款、注册表、目录），官方公布的是一张表 [{ chain, contract }, …]（2026-11-07 D-640 起只认列表）。
 * 取 chain（CAIP-2，例如 eip155:196）那一项（officialRegistry 的写法）；没有、写法不对 → null
 */
export function officialOn(official, chain) {
  const list = Array.isArray(official) ? official : [];
  const hit = list.find((x) => x?.chain === chain);
  return hit ? officialRegistry(hit) : null;
}

/**
 * 一家运营方在注册表里的情况：{ inGoodStanding, status（none | active | exiting | completed | defaulted）, declaredAt, exitAt（Unix 秒，没有为 0）,
 * stake（BigInt）, frozenUntil（Unix 秒；第 383 条：冻结有期限，过了这一刻就是没冻着；没冻过为 0）,
 * cutoff（第 384 条：开着的强制截止 { proposedAt, executableAt（Unix 秒）, evidence（证据的哈希） }，没有为 null） }。
 * registry：officialRegistry 的结果；operatorId：十进制字符串。
 */
export async function readStanding(chain, registry, operatorId) {
  const id = opId(operatorId);
  const call = (selector) => chain.call({ to: registry.contract, data: encodeCall(selector, ['uint256'], [id]) });
  const [good] = decodeResult(['bool'], await call(REGISTRY_SELECTORS.inGoodStanding));
  const r = decodeResult(['uint', 'uint', 'uint', 'bool', 'uint', 'uint', 'uint', 'address', 'address'], await call(REGISTRY_SELECTORS.getStake));
  const status = STAKE_STATUS[Number(r[2])];
  if (!status) fail('bad-reply', '注册表返回的状态不认识');
  return { inGoodStanding: good === true, status, declaredAt: Number(r[5]), exitAt: Number(r[6]), stake: r[0], frozenUntil: Number(r[4]), cutoff: await readCutoff(chain, registry, operatorId) };
}

/** 第 384 条（D-433）：这家开着的强制截止 { proposedAt, executableAt（Unix 秒）, evidence（证据的哈希） }；没有开着的为 null */
export async function readCutoff(chain, registry, operatorId) {
  const c = decodeResult(['uint', 'uint', 'bool', 'bytes32'], await chain.call({ to: registry.contract, data: encodeCall(REGISTRY_SELECTORS.getCutoff, ['uint256'], [opId(operatorId)]) }));
  return c[2] ? { proposedAt: Number(c[0]), executableAt: Number(c[1]), evidence: c[3] } : null;
}

/** 解 (string[], uint64) 的返回值（serversOf）：最多 16 个名字，每个不超过 300 字节（发布网站的 Worker 批量读链时也用它） */
export function decodeServersOf(out) {
  const b = hexToBytes(out);
  const num = (off) => { if (!(off >= 0) || off + 32 > b.length) fail('bad-reply', '目录合约返回的数据太短'); return BigInt(`0x${hex(b.subarray(off, off + 32))}`); };
  const small = (v) => { if (v > 1n << 32n) fail('bad-reply', '目录合约返回的数据不对'); return Number(v); };
  const base = small(num(0));
  const updatedAt = Number(num(32) & U64);
  const n = small(num(base));
  if (n > 16) fail('bad-reply', '目录合约返回的服务器太多');
  const start = base + 32;
  const names = [];
  for (let i = 0; i < n; i++) {
    const off = start + small(num(start + i * 32));
    const len = small(num(off));
    if (len > 300 || off + 32 + len > b.length) fail('bad-reply', '目录合约返回的服务器名字不对');
    names.push(new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(off + 32, off + 32 + len)));
  }
  return { servers: names, updatedAt };
}

/** 目录里这家的服务器名单和最后一次写的时刻：{ servers, updatedAt（Unix 秒，没写过为 0） } */
export async function readServersOf(chain, directory, operatorId) {
  return decodeServersOf(await chain.call({ to: directory.contract, data: encodeCall(DIRECTORY_SELECTORS.serversOf, ['uint256'], [opId(operatorId)]) }));
}

/** readDirectoryIds 的那一次调用 { to, data } */
const directoryIdsCall = (directory, offset, limit) => ({ to: directory.contract, data: encodeCall(DIRECTORY_SELECTORS.operators, ['uint256', 'uint256'], [BigInt(offset), BigInt(limit)]) });

/** 目录里写过名单的编号（按第一次写的先后），从第 offset 个起最多 limit 个（最多 100）：{ total, ids（十进制字符串） } */
export async function readDirectoryIds(chain, directory, { offset = 0, limit = 100 } = {}) {
  const { total, ids } = decodeTotalAndIds(await chain.call(directoryIdsCall(directory, offset, limit)));
  return { total: Number(total), ids: ids.map(String) };
}

/** 2026-10-31（D-563）：readOnchainOperators 最多看目录里的几家：链上有 Multicall3 时 3,000 家（约 20 次请求），没有时与 max 相同（每家至少 1 次请求） */
export const DIRECTORY_SCAN_MAX = 3000;

/**
 * 链上的运营方名单（TapeRelay §10.3 第二版，D-423）：目录里写过名单的编号，只留注册表里在保的；每家带上服务器名单和质押钱包（小写）。
 * 返回 { total（目录里一共几家）, truncated（没看完：有没看的，或在保的多于 max 家）, operators: [{ operatorId, servers, stakedBy, updatedAt }] }，
 * 最多列 max 家在保的（按第一次写名单的先后倒着：最近登记的在前；以后再写名单位置不变）。
 * 只读链，不读各家的 /v1/info（两头核对在 operators.mjs 的 checkOnchainOperator）。
 */
export async function readOnchainOperators(chain, { directory, registry }, { max = 300 } = {}) {
  // 2026-10-30（审查 30 的 I-292）：按第一次写名单的先后倒着读（目录合约只在第一次写名单时记下位置，审查 41 的 I-421 更正）。
  // 2026-10-31（审查 41 的 I-421 余下的，D-563）：经 callMany 一次读一批（Multicall3；没有时一个一个读）：先看最多 DIRECTORY_SCAN_MAX 家
  // 在不在保，max 只限在保的家数（原来看了 max 家就停，其中不在保的也占名额，更早登记、一直在保的老运营方看不到）。
  // 先读一次总数（这一次也就知道这条链上有没有 Multicall3），再一页一页往前
  const [first] = await callMany(chain, [directoryIdsCall(directory, 0, 1)]);
  const total = Number(decodeTotalAndIds(first).total);
  const cap = batched(chain) ? Math.max(max, DIRECTORY_SCAN_MAX) : max;
  const bottom = Math.max(0, total - cap);
  const pages = [];
  for (let end = total; end > bottom; end -= 100) { const offset = Math.max(bottom, end - 100); pages.push(directoryIdsCall(directory, offset, end - offset)); }
  const ids = [];
  for (const out of await callMany(chain, pages)) ids.push(...decodeTotalAndIds(out).ids.map(String).reverse());
  // 审查 43 的 I-438：定 cap 时这个 chain 已经定了有没有 Multicall3，之后不再变（multicall.mjs 的 callMany）
  const seen = ids.slice(0, cap);
  const standing = await callMany(chain, seen.map((id) => ({ to: registry.contract, data: encodeCall(REGISTRY_SELECTORS.inGoodStanding, ['uint256'], [BigInt(id)]) })));
  const good = seen.filter((id, i) => decodeResult(['bool'], standing[i])[0] === true);
  const shown = good.slice(0, max);
  const details = await callMany(chain, shown.flatMap((id) => [
    { to: registry.contract, data: encodeCall(REGISTRY_SELECTORS.stakedBy, ['uint256'], [BigInt(id)]) },
    { to: directory.contract, data: encodeCall(DIRECTORY_SELECTORS.serversOf, ['uint256'], [opId(id)]) },
  ]));
  const operators = shown.map((id, i) => {
    const [stakedBy] = decodeResult(['address'], details[2 * i]);
    const { servers, updatedAt } = decodeServersOf(details[2 * i + 1]);
    return { operatorId: id, servers, stakedBy: String(stakedBy).toLowerCase(), updatedAt };
  });
  return { total, truncated: seen.length < total || good.length > max, operators };
}
