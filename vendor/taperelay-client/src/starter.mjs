// TapeRelay 客户端库：一键开通一枚身份电路（2026-11-13）。
// 开发者没有电路时，在官方处理器上开通（tapeout）一枚最小的电路，再开通它的容器，一共两笔原生币交易：
//   1. tapeout：网表只有一条 REF 指令，引用官方处理器上已有的一个电路。REF 不烧晶体管（NetlistVM.analyze 只对 NAND、LATCH 烧），
//      所以不用铸晶体管、不用 BEM、不用授权，只付这台处理器的开通电路费（TAPEOUT_FEE）（原生币）；
//   2. open：在容器开通合约里开通这枚电路的容器，付开通费（原生币）。
// 之后电路的名字是 <编号>.<区号>.<处理器序号>.tape，由调用方经 TapeKit 内核算出。
// 只用 chain 的 call、send（send 由钱包发、等到回执）；不碰私钥。
import { encodeCall, decodeResult } from '../vendor/tapekit-kernel/abi.js';
import { selectorOf } from './core.mjs';

/** 各链的一键开通设置：在哪台处理器上开通电路、引用哪个已有电路（引脚要和它一样）、容器开通合约 */
export const STARTERS = Object.freeze({
  196: Object.freeze({
    cpu: '0x69f663931209096037474d7c20402232e5c762ca',                 // X Layer 官方处理器 TAPELIQUID
    cpuIndex: 265,                                                       // 它在工厂里的编号（电路名是 <编号>.2.265.tape；用之前照 cpuAt 核对）
    ref: Object.freeze({ cpu: '0x69f663931209096037474d7c20402232e5c762ca', id: 1, nIn: 2, nOut: 1 }),
    opener: '0x536add8f30f03b69f6fbf29d425a816a0dc50106',
  }),
});

const SEL = Object.freeze({
  tapeoutFee: selectorOf('TAPEOUT_FEE()'),
  tapeout: selectorOf('tapeout(bytes,uint32,uint32)'),
  openFee: selectorOf('FEE()'),
  open: selectorOf('open(address,uint256)'),
  accountOf: selectorOf('accountOf(address,uint256)'),
});
const TAPED_OUT = '0xc11215e417669c143c8a07aeb778034c0a0a85ebdf305d64a629b19a7a9ce031';   // TapedOut(uint256,address,uint32,uint32)
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const hexN = (n, bytes) => BigInt(n).toString(16).padStart(bytes * 2, '0');

/** 只有一条 REF 的网表：0x02、被引用处理器地址（20 字节）、电路编号（8 字节）、入脚数、出脚数，再逐个入脚接本电路的输入（信号 2、3…） */
export function refNetlist({ cpu, id, nIn, nOut }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(cpu)) fail('bad-config', '被引用的处理器地址写法不对');
  let h = `0x02${cpu.slice(2).toLowerCase()}${hexN(id, 8)}${hexN(nIn, 1)}${hexN(nOut, 1)}`;
  for (let k = 0; k < nIn; k++) h += hexN(2 + k, 3);
  return h;
}

/** 读两笔交易要付的钱：{ chainId, cpu, cpuIndex（工厂里的编号，没核对过）, opener, netlist, nIn, nOut, tapeoutFee, openFee, total }（都是原生币最小单位，BigInt） */
export async function starterPlan(chain, chainId) {
  const s = STARTERS[Number(chainId)];
  if (!s) fail('unsupported-chain', '这条链还没有一键开通');
  const [tf] = decodeResult(['uint'], await chain.call({ to: s.cpu, data: SEL.tapeoutFee }));
  const [of] = decodeResult(['uint'], await chain.call({ to: s.opener, data: SEL.openFee }));
  return { chainId: Number(chainId), cpu: s.cpu, cpuIndex: s.cpuIndex ?? null, opener: s.opener, netlist: refNetlist(s.ref), nIn: s.ref.nIn, nOut: s.ref.nOut, tapeoutFee: tf, openFee: of, total: tf + of };
}

/**
 * 2026-11-14（控制台审计 9）：只开通一枚已有电路的容器（不开通新电路）。chain 只要 call（控制台用 TapeKit 内核读，不经钱包）；
 * cpu：电路所在处理器的合约地址；id：电路编号。返回 { chainId, opener, cpu, id（字符串）, openFee（原生币最小单位，BigInt） }。这条链没有开通合约的抛 unsupported-chain
 */
export async function openPlan(chain, chainId, { cpu, id }) {
  const s = STARTERS[Number(chainId)];
  if (!s) fail('unsupported-chain', '这条链还不能在控制台里开通容器');
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(cpu))) fail('bad-config', '处理器地址写法不对');
  const [of] = decodeResult(['uint'], await chain.call({ to: s.opener, data: SEL.openFee }));
  return { chainId: Number(chainId), opener: s.opener, cpu: String(cpu).toLowerCase(), id: BigInt(id).toString(), openFee: of };
}

/**
 * 照 openPlan 的结果发一笔开通（chain 要有 send，由钱包发、等到回执）；返回容器地址（小写）。
 * onSent(交易哈希)：钱包交出这一笔的哈希时（还没等到回执；2026-11-15 控制台审计第三轮 4：调用方记进本机，下次先查回执，不再发一笔）
 */
export async function openContainer({ chain, plan, onSent = null }) {
  await chain.send({ to: plan.opener, data: encodeCall(SEL.open, ['address', 'uint256'], [plan.cpu, BigInt(plan.id)]), value: plan.openFee, ...(onSent ? { onSent } : {}) });
  const [container] = decodeResult(['address'], await chain.call({ to: plan.opener, data: encodeCall(SEL.accountOf, ['address', 'uint256'], [plan.cpu, BigInt(plan.id)]) }));
  return String(container).toLowerCase();
}

/**
 * 2026-11-15（控制台审计第二轮）：从开通电路那笔交易的回执里取新电路的编号（TapedOut 事件的第一个 topic）。cpu：处理器合约地址。
 * 回执失败（status 不是 0x1）抛 tx-failed；没有这条事件抛 no-circuit。返回编号（字符串）
 */
export function circuitIdFromReceipt(rc, cpu) {
  if (rc?.status !== undefined && rc.status !== '0x1' && rc.status !== 1 && rc.status !== '1') fail('tx-failed', 'tapeout transaction failed');
  const log = (rc?.logs ?? []).find((l) => String(l.address).toLowerCase() === String(cpu).toLowerCase() && String(l.topics?.[0]).toLowerCase() === TAPED_OUT);
  if (!log) fail('no-circuit', 'no TapedOut event in the receipt');
  return BigInt(log.topics[1]).toString();
}

/**
 * 照计划发两笔：开通电路（tapeout）、开通容器。onStep('tapeout' | 'open')；onSent(交易哈希)：开通电路那一笔钱包交出哈希时（还没等到回执，
 * 调用方记进本机：刷新或等太久时下次先查这笔的回执，不再开通一枚）；onCircuit(编号)：回执里读到新电路的编号时；
 * onOpenSent(交易哈希, 编号)：开通容器那一笔钱包交出哈希时（审计第三轮 4，同样记进本机）。返回 { circuitId（字符串）, container }
 */
export async function starterRun({ chain, plan, onStep = () => {}, onSent = () => {}, onCircuit = () => {}, onOpenSent = () => {}, circuitId = null }) {
  // circuitId：上一次已经开通了电路（开通容器那一笔没发成）时给出，这次只补开通容器，不再开通一枚新的电路
  if (!circuitId) {
    onStep('tapeout');
    const rc = await chain.send({ to: plan.cpu, data: encodeCall(SEL.tapeout, ['bytes', 'uint256', 'uint256'], [plan.netlist, BigInt(plan.nIn), BigInt(plan.nOut)]), value: plan.tapeoutFee, onSent });
    circuitId = circuitIdFromReceipt(rc, plan.cpu);
    onCircuit(circuitId);
  }
  onStep('open');
  const id = circuitId;
  const container = await openContainer({ chain, plan: { opener: plan.opener, cpu: plan.cpu, id, openFee: plan.openFee }, onSent: (hash) => { try { onOpenSent(hash, id); } catch { /* 记不下不影响等回执 */ } } });
  return { circuitId, container };
}
