// TapeRelay 客户端库：一次读很多条链（Multicall3 的 aggregate3；D-563）。2026-10-31 由主编写窗口编写（CHANGELOG 第 490 条）。
// - Multicall3 是各链通用的公共合约（各链地址相同，没有管理员、不能改）：一次 eth_call 里替我们调很多个只读函数，各自的结果一起回来。
//   原来托管的各段、目录里的运营方一个一个读（300 段约 600 次请求），现在每次请求最多 BATCH 个。
// - 只用来读（eth_call）；交易照旧直接发给我们的合约，不经它。各项的结果与原来一样是节点给的、不可信：调用方照原来的解法逐项核对。
// - 哪条链上没有它（第一次的回复是空的「0x」或解不开），就照原来一个一个读；读不到链（请求出错）照样抛错，
//   不改成一个一个再试（不重试，安全规则）。某一项被合约拒绝（例如编号不存在），与一个一个读时一样抛错。
// chain：{ call({ to, data }) → 返回数据（0x 开头的十六进制） }。
import { hexToBytes, bytesToHex } from '../vendor/tapekit-kernel/abi.js';
import { hex, selectorOf } from './core.mjs';

const sel = selectorOf;
/** Multicall3 在各链上的地址（BNB Smart Chain、X Layer、Base 相同；小写） */
export const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';
/**
 * 那个地址上的代码（3,808 字节）的 keccak256（审查 42 之后编写窗口记的 I-437，2026-10-31 18:58（UTC+4）负责人同意后读链核对：
 * BNB Smart Chain、X Layer、Base 和以太坊主网（Multicall3 最早部署的那条链）上逐字节相同）。读链只能 eth_call，客户端不在运行时核对；
 * 以后加新链时先用 eth_getCode 读那条链上的代码，核对哈希与此相同再用
 */
export const MULTICALL3_CODEHASH = '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891';
export const MULTICALL_SELECTORS = Object.freeze({ aggregate3: sel('aggregate3((address,bool,bytes)[])') });
/** 一次请求里最多几项（每项是读几个存储格的小函数，200 项远在节点给 eth_call 的燃料上限之内） */
export const BATCH = 200;
/**
 * 2026-11-01（审查 44 的 I-442）：一个一个读时一次最多几项。没有 Multicall3 时，各处一次要读的最多就是这么多
 * （托管的一页 300 段 × 2 项、链上名单 300 家 × 2 项）；多了（例如经 Multicall3 看到 3,000 段、领的时候换了没有它的读链对象，
 * 或者第一次的回复解不开）报 no-multicall，不一个一个发几千次请求
 */
export const MAX_ONE_BY_ONE = 600;
const MAX_DATA = 64 * 1024;                                         // 一项的调用数据最多多长（我们的读函数只有几十字节）
const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };
const word = (n) => BigInt(n).toString(16).padStart(64, '0');

/** aggregate3(calls) 的调用数据：每项 { to, data }，allowFailure 都为真（某一项被拒绝时整次照样回来，由 callMany 报出是哪一类） */
export function encodeAggregate3(calls) {
  const items = calls.map(({ to, data }) => {
    const t = String(to ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(t)) fail('bad-argument', '要读的合约地址不对');
    const d = String(data ?? '');
    if (!/^0x([0-9a-fA-F]{2})*$/.test(d) || d.length - 2 > MAX_DATA * 2) fail('bad-argument', '要读的调用数据不对');
    const len = (d.length - 2) / 2;
    // 一项（address, bool, bytes）：地址、allowFailure、bytes 的偏移（从这一项开头算，0x60），再是 bytes 的长度和内容（补到 32 字节）
    return `${t.slice(2).padStart(64, '0')}${word(1)}${word(0x60)}${word(len)}${d.slice(2).padEnd(Math.ceil(len / 32) * 64, '0')}`;
  });
  // 头：数组的偏移 0x20；数组：个数，各项的偏移（从各项偏移这一格的开头算），各项
  let at = items.length * 32;
  const offsets = items.map((it) => { const o = at; at += it.length / 2; return word(o); });
  return `${MULTICALL_SELECTORS.aggregate3}${word(0x20)}${word(items.length)}${offsets.join('')}${items.join('')}`;
}

/** 解 aggregate3 的回复（(bool success, bytes returnData)[]）：一定要正好 n 项，每个偏移、长度都不越界；不对就抛错 */
export function decodeAggregate3(reply, n) {
  const b = hexToBytes(reply);
  const num = (off) => {
    if (!Number.isSafeInteger(off) || off < 0 || off + 32 > b.length) fail('bad-reply', 'Multicall3 的回复太短');
    const v = BigInt(`0x${hex(b.subarray(off, off + 32))}`);
    if (v > BigInt(b.length)) fail('bad-reply', 'Multicall3 的回复里的数不对');
    return Number(v);
  };
  const base = num(0);
  if (num(base) !== n) fail('bad-reply', 'Multicall3 回复的项数不对');
  const head = base + 32;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = head + num(head + i * 32);
    const ok = num(p);
    if (ok > 1) fail('bad-reply', 'Multicall3 的回复不对');
    const q = p + num(p + 32);
    const len = num(q);
    if (q + 32 + len > b.length) fail('bad-reply', 'Multicall3 的回复太短');
    out.push({ ok: ok === 1, data: bytesToHex(b.subarray(q + 32, q + 32 + len)) });
  }
  return out;
}

const support = new WeakMap();                                       // chain → true（这条链上有 Multicall3）/ false（没有）

/** 这个 chain 上有没有 Multicall3：true、false，还没试过为 undefined（一个 chain 对象只定一次，定了不改） */
export const batched = (chain) => support.get(chain);

/**
 * 读 calls（[{ to, data }]）各一次，按原来的顺序返回各项的结果（十六进制）。这个 chain 上有 Multicall3 时每 BATCH 项一次请求，
 * 没有时一个一个读（与原来相同）。
 * 2026-10-31（审查 43 的 I-438）：只有这个 chain 对象还没试过时，第一次请求的回复解不开才当作没有它（记下，之后直接一个一个读）；
 * 已经记成「有」的（或者别的一次已经读成了的），再解不开就报 bad-reply，不改成一个一个读：原来读到一半才退回时，一页还按 3,000 段算，
 * 一次要发几千次请求。一个 chain 对象只对应一条链：换链时调用方要新建一个（换链的不会碰上「记着有、换到的链上没有」）。
 * 退回一个一个读时用新的数组：同一个 chain 对象上两次同时读，各自返回自己的、项数不会多出来。
 * 一个一个读一次最多 MAX_ONE_BY_ONE 项（审查 44 的 I-442），多了报 no-multicall
 */
export async function callMany(chain, calls) {
  if (!calls.length) return [];
  if (support.get(chain) !== false) {
    const out = [];
    let fellBack = false;
    for (let i = 0; i < calls.length; i += BATCH) {
      const part = calls.slice(i, i + BATCH);
      const reply = await chain.call({ to: MULTICALL3, data: encodeAggregate3(part) });
      let rs;
      try { rs = decodeAggregate3(reply, part.length); } catch (e) {
        if (i === 0 && support.get(chain) === undefined) { support.set(chain, false); fellBack = true; break; }
        throw e;
      }
      for (const r of rs) {
        if (!r.ok) fail('call-failed', '链上的一次读取被合约拒绝了（例如编号不存在）');
        out.push(r.data);
      }
    }
    if (!fellBack) {
      if (support.get(chain) === undefined) support.set(chain, true);
      return out;
    }
  }
  if (calls.length > MAX_ONE_BY_ONE) fail('no-multicall', `这次要读 ${calls.length} 项，这条链上又读不了 Multicall3：一个一个读太多（最多 ${MAX_ONE_BY_ONE} 项），不读了`);
  const one = [];
  for (const c of calls) one.push(await chain.call(c));
  return one;
}
