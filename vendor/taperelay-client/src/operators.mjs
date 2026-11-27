// TapeRelay 客户端库：运营方的价格说明和登记表（TapeStore §5.3、TapeRelay §10.3；D-151、D-154）。2026-10-13 由主编写窗口编写（CHANGELOG 第 196 条，负责人下线期间的临时授权 D-148）。
// - pricingView：把 /v1/info 的 pricing 整理成给界面显示的样子。不认识的 model 按「收费、价格不明」（TapeStore §5.3 的「应当」）；
//   url 不是 https:// 开头（或带用户名密码）就不给（界面不显示这个链接）；summary 只留纯文字、最多 200 个字符；perGiBMonth 写法不对就不给。
//   界面要把 summary 当作纯文字显示（textContent，不当作 HTML，TapeStore §5.3 的「必须」），打开 url 之前让用户看到完整的网址。
// - parseOperatorList：读登记表（TapeRelay §10.3）。version 不是 1 → 整个不用（抛 unsupported-list）；每一项的写法不对就去掉这一项（不整个不用）。
// - checkOperator：读这个运营方第一台服务器的 /v1/info，核对登记表里它的每个服务器名字都在 /v1/info 的 servers 里；对不上就不列出（TapeRelay §10.3 的「应当」）。
// 第 212 条（I-157 第 4 点）：「最多多少个字符」按 Unicode 字符数算（与 openapi.yaml 的 maxLength、服务器一致），原来按 .length，表情等算两个。
// 第 308 条（TapeRelay §10.3、TapeRelay §10.5；D-201、D-263）：登记表每一项可以写 operatorId；checkOperator 核对它与 /v1/info 的付款合约编号相同，另给出 exit；
//   exitView：/v1/info 的 exit（只是线索，注册表部署之后以注册表为准）。付款之前核对编号的 payableOperator 2026-10-29 挪到 payments.mjs（付款归存储一侧，D-518）。
// D-328：conformance 可以没有（运营方的服务器自己上报、发布网站核对后列出的条目没有这一项，给出 null）；有就要写对，不对去掉这一项。
// 2026-10-22（UTC+8，TapeStore §3「选哪几台」，D-336、D-342）：pickOperators 从核对过的运营方里随机挑 3 家不同运营方的服务器。
// 第 383 条（TapeRelay §10.3 第二版，D-423、D-431）：注册表部署之后名单从链上的运营方目录来（registry.mjs 的 readOnchainOperators），
//   checkOnchainOperator 两头核对（链上的服务器名单 ↔ 每台的 /v1/info 写的运营方编号，operatorIdOf）；pickOperators 把同一个质押钱包的几个编号算一家。
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const PLAIN = (s, max) => typeof s === 'string' && [...s].length <= max && !/[\u0000-\u001f\u007f]/.test(s);
const NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?:([1-9][0-9]{0,4})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** https 的网址（不带用户名、密码）原样返回；不是就返回 null */
function httpsUrl(u) {
  if (typeof u !== 'string' || u.length > 2048 || !u.startsWith('https://')) return null;
  try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password ? u : null; } catch { return null; }
}

/**
 * /v1/info 的 pricing → { paid（true/false）, known（model 认不认识）, url?, summary?, perGiBMonth? }。
 * 没有 pricing、写法不对 → 当作收费、价格不明（宁可提醒用户可能收费）。
 */
export function pricingView(pricing) {
  if (isObj(pricing) && pricing.model === 'free') return { paid: false, known: true };
  const out = { paid: true, known: isObj(pricing) && pricing.model === 'paid' };
  if (!out.known) return out;
  const url = httpsUrl(pricing.url);
  if (url) out.url = url;
  if (PLAIN(pricing.summary, 200)) out.summary = pricing.summary;
  const g = pricing.perGiBMonth;
  if (isObj(g) && typeof g.amount === 'string' && /^[0-9]{1,15}(\.[0-9]{1,15})?$/.test(g.amount) && typeof g.currency === 'string' && /^[A-Z]{3}$/.test(g.currency)) {
    out.perGiBMonth = { amount: g.amount, currency: g.currency };
  }
  return out;
}

const OPERATOR_ID = /^[1-9][0-9]{0,19}$/;
const U64 = (1n << 64n) - 1n;
const idOk = (x) => typeof x === 'string' && OPERATOR_ID.test(x) && BigInt(x) <= U64;
const BNB = 'eip155:56';
const CHAINS = ['eip155:56', 'eip155:196', 'eip155:8453'];          // TapeRelay §3.1 的三条链
/** /v1/info 的 pricing.payments → 列表（2026-10-30，D-523：每条链一项；2026-11-07 D-640 起只认列表）；没有或写法不对为 [] */
export const paymentsList = (pricing) => (Array.isArray(pricing?.payments) ? pricing.payments : []);

/**
 * 第 308 条（TapeRelay §10.1、TapeRelay §10.5，D-263）：/v1/info 的 exit → null（没有声明退出）或 { at（Unix 秒；写法不对时为 null，「时间不明」）, successor（接手方的服务器名字；没有为 null） }。
 * 这只是线索（TapeRelay §10.1）：注册表部署之后以注册表为准（registry.mjs 的 readStanding）。
 */
export function exitView(x) {
  if (x === undefined) return null;
  const okSucc = (s) => Array.isArray(s) && s.length >= 1 && s.length <= 8 && new Set(s).size === s.length && s.every((n) => typeof n === 'string' && NAME.test(n));
  if (!isObj(x) || !Number.isSafeInteger(x.at) || x.at <= 0 || (x.successor !== undefined && !okSucc(x.successor))) return { at: null, successor: null };
  return { at: x.at, successor: x.successor ? [...x.successor] : null };
}

/**
 * 运营方登记表（TapeRelay §10.3）→ { updatedAt, operators: [{ name, operatorId（第 308 条，D-201；BNB 上的编号，没有为 null）, operatorIds（2026-10-30，D-523：
 * 每条链的编号 { "eip155:56": "12", "eip155:196": "3" }，含 operatorId；都没有为 {}）, servers, contact, conformance（D-328：没有为 null） }], dropped（去掉了几项） }。
 * version 不是 1 → 抛错（code 为 unsupported-list）；不是 JSON 对象 → 抛错（code 为 bad-list）。operatorId、operatorIds 写法不对、两个写的 BNB 编号不同的那一项去掉。
 */
export function parseOperatorList(json) {
  let v = json;
  if (typeof json === 'string') { try { v = JSON.parse(json); } catch { v = null; } }
  if (!isObj(v) || !Array.isArray(v.operators)) throw Object.assign(new Error('运营方登记表的写法不对'), { code: 'bad-list' });
  if (v.version !== 1) throw Object.assign(new Error('运营方登记表的版本不认识，整个不用'), { code: 'unsupported-list' });
  const operators = [];
  let dropped = 0;
  for (const o of v.operators.slice(0, 1000)) {
    const c = o?.conformance;
    const ok = isObj(o) && PLAIN(o.name, 100) && o.name.length > 0 && PLAIN(o.contact ?? '', 200)
      && Array.isArray(o.servers) && o.servers.length >= 1 && o.servers.length <= 16 && o.servers.every((n) => typeof n === 'string' && NAME.test(n))
      && (c === undefined || (isObj(c) && PLAIN(c.suite, 32) && typeof c.testedAt === 'string' && DATE.test(c.testedAt) && typeof c.reportSha256 === 'string' && /^[0-9a-f]{64}$/.test(c.reportSha256)))
      && (o.operatorId === undefined || idOk(o.operatorId))
      && (o.operatorIds === undefined || (isObj(o.operatorIds) && Object.entries(o.operatorIds).every(([k, v]) => CHAINS.includes(k) && idOk(v))
        && (o.operatorId === undefined || o.operatorIds[BNB] === undefined || o.operatorIds[BNB] === o.operatorId)));
    if (!ok) { dropped++; continue; }
    const ids = { ...(o.operatorId !== undefined ? { [BNB]: o.operatorId } : {}), ...Object.fromEntries(CHAINS.filter((k) => o.operatorIds?.[k] !== undefined).map((k) => [k, o.operatorIds[k]])) };
    operators.push({ name: o.name, operatorId: ids[BNB] ?? null, operatorIds: ids, servers: [...o.servers], contact: o.contact ?? '',
      conformance: c === undefined ? null : { suite: c.suite, testedAt: c.testedAt, reportSha256: c.reportSha256 } });
  }
  dropped += Math.max(0, v.operators.length - 1000);
  return { updatedAt: typeof v.updatedAt === 'string' && DATE.test(v.updatedAt) ? v.updatedAt : null, operators, dropped };
}

/**
 * 核对登记表里的一个运营方（TapeRelay §10.3）：读它第一台服务器的 /v1/info，登记的每个服务器名字都要在 info.servers 里；
 * 第 308 条（D-201）：登记表写了运营方编号、/v1/info 又写了付款合约里的编号（pricing.payments.operator）时，两个要相同，不同就不列出。
 * 2026-10-30（D-523）：逐条链核对（登记表的 operatorIds 与 /v1/info 那条链的编号 operatorIdOf）。
 * client：client.mjs 的 createClient()。返回 { ok: true, info, pricing, exit（exitView） } 或 { ok: false, reason }。
 */
export async function checkOperator(client, op) {
  let info;
  try { info = await client.info(op.servers[0]); } catch (e) { return { ok: false, reason: `读不到 /v1/info（${e?.code ?? 'error'}）` }; }
  if (!isObj(info) || !Array.isArray(info.servers)) return { ok: false, reason: '/v1/info 的写法不对' };
  const missing = op.servers.filter((n) => !info.servers.includes(n));
  if (missing.length) return { ok: false, reason: `登记的服务器名字不在 /v1/info 里：${missing.join('、')}` };
  const listed = op.operatorIds ?? (op.operatorId ? { [BNB]: op.operatorId } : {});
  for (const chain of CHAINS) {
    const said = paymentsList(info.pricing).find((e) => e?.chain === chain)?.operator;
    if (listed[chain] && said !== undefined && String(said) !== listed[chain]) {
      return { ok: false, reason: `登记表在 ${chain} 上的运营方编号（${listed[chain]}）与 /v1/info 里付款合约的编号（${String(said).slice(0, 24)}）不同` };
    }
  }
  return { ok: true, info, pricing: pricingView(info.pricing), exit: exitView(info.exit) };
}

/**
 * 第 383 条（TapeStore §6、TapeRelay §10.3，D-431）：/v1/info 写的运营方编号：operator.id；没有时用付款合约那一项的 pricing.payments.operator。
 * 2026-10-30（D-523）：编号各链不同，chain（CAIP-2，默认 BNB）上的：operator.ids[chain]；BNB 另认 operator.id；都没有时用 pricing.payments 里那条链那一项的 operator。
 * 写法不对、都没有 → null。
 */
export function operatorIdOf(info, chain = BNB) {
  if (!isObj(info)) return null;
  const ids = info.operator?.ids;
  if (isObj(ids) && ids[chain] !== undefined) return idOk(ids[chain]) ? ids[chain] : null;
  if (chain === BNB && info.operator?.id !== undefined) return idOk(info.operator.id) ? info.operator.id : null;
  const p = paymentsList(info.pricing).find((e) => (e?.chain ?? BNB) === chain)?.operator;
  return idOk(p) ? p : null;
}

/**
 * 第 383 条（TapeRelay §10.3 第二版，D-423；docs/REGISTRY-DESIGN.md 13.2）：链上目录里的一家（registry.mjs 的 readOnchainOperators 给的一项）两头核对：
 * 每个服务器名字读它自己的 /v1/info：servers 里有这个名字，而且写的运营方编号（operatorIdOf）就是这一家的。冒充者在自己的 /v1/info 里写别人的编号：
 * 别人链上的名单里没有它；在链上登记别人的主机：别人的 /v1/info 写的是别人自己的编号。对不上的名字去掉；一个都没对上就不列出。
 * 返回 { ok: true, op（与 parseOperatorList 的一项同样的写法，servers 只留对上的，另带 stakedBy）, info（第一台对上的）, pricing, exit, certified: true, dropped }
 * 或 { ok: false, op, reason }。注册表、目录都是链上读的：调用方只把在保的给进来。
 * 2026-10-30（D-523）：chain 是这张目录所在的链（CAIP-2，默认 BNB），比的是 /v1/info 写的那条链上的编号。
 */
export async function checkOnchainOperator(client, entry, chain = BNB) {
  const base = { name: `运营方 #${entry.operatorId}`, operatorId: entry.operatorId, servers: [], contact: '', conformance: null, stakedBy: entry.stakedBy ?? null };
  const good = [], dropped = [];
  let first = null;
  for (const name of entry.servers) {
    if (typeof name !== 'string' || !NAME.test(name)) { dropped.push(`${String(name).slice(0, 80)}（写法不对）`); continue; }
    let info;
    try { info = await client.info(name); } catch (e) { dropped.push(`${name}（读不到 /v1/info：${e?.code ?? 'error'}）`); continue; }
    if (!isObj(info) || !Array.isArray(info.servers) || !info.servers.includes(name)) { dropped.push(`${name}（它的 /v1/info 里没有这个名字）`); continue; }
    const said = operatorIdOf(info, chain);
    if (said !== entry.operatorId) { dropped.push(`${name}（它的 /v1/info 写的运营方编号是 ${said ?? '（没写）'}）`); continue; }
    good.push(name);
    first ??= info;
  }
  if (!good.length) return { ok: false, op: base, reason: `链上登记的服务器都对不上：${dropped.join('、')}` };
  const nm = first.operator?.name;
  const op = { ...base, name: PLAIN(nm, 100) && nm.trim() ? nm : base.name, servers: good, contact: PLAIN(first.operator?.contact ?? '', 200) ? (first.operator?.contact ?? '') : '' };
  return { ok: true, op, info: first, pricing: pricingView(first.pricing), exit: exitView(first.exit), certified: true, dropped };
}

const hostOf = (name) => name.slice(0, name.lastIndexOf(':'));
/** 用 crypto.getRandomValues 打乱（Fisher–Yates）；取模的偏差在几百家以内可以不计 */
function shuffle(list) {
  const a = [...list];
  const r = crypto.getRandomValues(new Uint32Array(a.length));
  for (let i = a.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** 价格不超过 maxPrice（{ amount, currency }，每 GiB 每月）：免费的行；收费的要写明价格、币种相同、不更贵 */
function cheapEnough(pricing, maxPrice) {
  const v = pricingView(pricing);
  if (!v.paid || !maxPrice) return true;
  return !!v.perGiBMonth && v.perGiBMonth.currency === maxPrice.currency && Number(v.perGiBMonth.amount) <= Number(maxPrice.amount);
}

/**
 * 运营方信息里用来认「同一家」的几样：运营方编号、质押钱包（第 383 条，链上目录来的才有）、名字（登记表的和 /v1/info 的，不分大小写）、主机。
 * 第 389 条（D-437，I-294）：链上目录来的（带质押钱包）不按名字连：名字是它自己的 /v1/info 报的，在保的运营方把名字写成别家的，
 * 就能让那家被随机挑中的机会减半；链上来的已经有经过押金核对的编号和质押钱包。登记表来的照旧按名字连。
 */
const keysOf = (c) => [
  ...(c.op.operatorId ? [`id:${c.op.operatorId}`] : []),
  ...(c.op.stakedBy ? [`staker:${String(c.op.stakedBy).toLowerCase()}`] : []),
  ...(c.op.stakedBy ? [] : [c.op.name, c.info.operator?.name].filter((n) => typeof n === 'string' && n.trim()).map((n) => `name:${n.trim().toLowerCase()}`)),
  ...c.op.servers.map((n) => `host:${hostOf(n)}`),
];

/**
 * D-336、D-342（TapeStore §3「选哪几台」）：从核对过的运营方里随机挑 count 家、每家一台，给电路第一次写发现文件用；换掉一家时 count 为 1、
 * exclude 写上在用的服务器名字（它们所在的那几家都不再选）。
 * checked：[{ op（parseOperatorList 的一项）, ok, info, exiting?, certified? }]，即 checkOperator 的结果加上 op；exiting 不给时按 /v1/info 的 exit；
 * 注册表部署了的，调用方读好 certified（D-273），不是 true 的不选。第 384 条：调用方另有不推荐的（例如官方提出了强制截止，D-433），
 * 给 recommended: false 就不选（不给照旧）。
 * 同一家：核对通过的各项之间，运营方编号、名字（不分大小写）、主机有一样相同就连在一起，连着的都算一家（TapeRelay §4.3：同一主机的几个名字算一台）。
 * 只选：核对通过、/v1/info 是本协议、没有声明退出、默认配额不小于 minQuota（字节）、features 包括 features 里的每一项、价格不超过 maxPrice。
 * 返回服务器名字（主机:端口；同一主机优先 4246 端口的名字，写发现文件用 serverEntryOf）；够不上 count 家时有几家给几家，由调用方决定。
 */
export function pickOperators(checked, { count = 3, minQuota = 0, maxPrice = null, features = [], exclude = [] } = {}) {
  const ok = checked.filter((c) => c.ok && isObj(c.info));
  const root = ok.map((_, i) => i);
  const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
  const owner = new Map();
  ok.forEach((c, i) => { for (const k of keysOf(c)) if (owner.has(k)) root[find(i)] = find(owner.get(k)); else owner.set(k, i); });
  const banned = new Set(exclude.map((n) => owner.get(`host:${hostOf(n)}`)).filter((i) => i !== undefined).map(find));
  const fit = ({ info, certified, exiting, recommended }) => info.protocol === 'taperelay' && certified !== false && recommended !== false && !(exiting ?? exitView(info.exit) !== null)
    && Number.isSafeInteger(info.quota?.storageBytes) && info.quota.storageBytes >= minQuota
    && features.every((f) => Array.isArray(info.features) && info.features.includes(f)) && cheapEnough(info.pricing, maxPrice);
  const groups = new Map();
  ok.forEach((c, i) => {
    const g = find(i);
    if (banned.has(g) || !fit(c)) return;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  });
  return shuffle([...groups.values()]).slice(0, count).map((g) => {
    const c = shuffle(g)[0];
    const host = shuffle([...new Set(c.op.servers.map(hostOf))])[0];
    const names = c.op.servers.filter((n) => hostOf(n) === host);
    return names.find((n) => n.endsWith(':4246')) ?? names.find((n) => n.endsWith(':443')) ?? names[0];
  });
}
