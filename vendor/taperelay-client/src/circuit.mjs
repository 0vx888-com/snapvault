// TapeRelay：身份就是电路的链上名字（TapeRelay §3.2，D-634；TAP-10 §2.1 链表和地区码、§3.1 名字、§3.3 网关的主机标签、§3.4 输入）。
// 2026-11-07 由主编写窗口编写（笔记库第 533 条起，docs/CIRCUIT-IDENTITY.md 第十节「实现约定」）。
// 不依赖任何库（和 selfid.mjs 一样）：core.mjs 转出给客户端库和参考服务器用，manifest.mjs 直接引（网关的 Service Worker 也载它）。
// - 协议里只认规范的链上名字：BNB Smart Chain 上「<#ID>.<处理器编号>.tape」，其他链「<#ID>.<地区码>.<处理器编号>.tape」；
//   十进制、不带前导 0（0 本身除外）、全小写；1 ≤ #ID ≤ 10^18，0 ≤ 处理器编号 ≤ 10^9；地区码要在 TAP-10 §2.1 的表里。
// - 输入框（开发包、命令行、模板）才认别的写法（normalizeCircuitInput），在本机换成规范名字；容器地址的输入要读链反查（TAP-10 §4.3），不在这里。

/** 支持的链（TapeRelay §3.1，与 TapeKit 内核的 NETWORKS 相同） */
export const SUPPORTED_CHAINS = Object.freeze([56, 196, 8453]);
/** 各链的地区码（TAP-10 §2.1：BNB Smart Chain 没有，X Layer 2，Base 3）；TAP-10 加链时 CHAIN_AREA、AREA_CHAIN 一起改 */
export const CHAIN_AREA = Object.freeze({ 56: null, 196: 2, 8453: 3 });
export const AREA_CHAIN = Object.freeze({ 2: 196, 3: 8453 });

const MAX_ID = 10n ** 18n;
const MAX_PROCESSOR = 10n ** 9n;
const MAX_NAME = 64;                                      // 规范名字最长 19 + 1 + 1 + 1 + 10 + 5 = 37 个字符，先按长度挡掉过长的输入
const NAME_RE = /^([1-9][0-9]*)\.(?:([1-9][0-9]*)\.)?(0|[1-9][0-9]*)\.tape$/;
const LABEL_RE = /^([1-9][0-9]*)-(?:([1-9][0-9]*)-)?(0|[1-9][0-9]*)$/;

/** 三段数字（#ID、地区码或 null、处理器编号，都是不带前导 0 的十进制字符串）→ 解析结果；不在范围里、地区码不认识的返回 null */
function fromParts(id, area, processor) {
  if (BigInt(id) > MAX_ID || BigInt(processor) > MAX_PROCESSOR) return null;
  const chainId = area === undefined || area === null ? 56 : AREA_CHAIN[area];
  if (!chainId || !SUPPORTED_CHAINS.includes(chainId)) return null;
  return { chainId, area: area === undefined || area === null ? null : Number(area), processor: Number(processor), id };
}

/** 规范名字 → { chainId, area（没有地区码是 null）, processor（数）, id（十进制字符串） }；不是规范名字返回 null */
export function parseCircuit(name) {
  if (typeof name !== 'string' || name.length > MAX_NAME) return null;
  const m = NAME_RE.exec(name);
  return m ? fromParts(m[1], m[2], m[3]) : null;
}

/** TapeRelay §3.2：是不是规范的链上名字（协议里的身份） */
export const isAccount = (s) => parseCircuit(s) !== null;

/**
 * 名字所在的链（没有地区码是 56）；认不出的返回 NaN。
 * 2026-11-15（UX 审计第五轮）：先照 normalizeCircuitInput 补全，只写 1.2.0 也认（和 serversOf、confirmCircuit 一样）；签名域只认规范名字（core.mjs 的 domainFor）
 */
export const chainOf = (name) => (parseCircuit(name) ?? parseCircuit(normalizeCircuitInput(name)))?.chainId ?? NaN;

/** { chainId, processor, id } → 规范名字；processor、id 可以是数、BigInt 或十进制字符串；不合法抛错 */
export function circuitName({ chainId, processor, id }) {
  const area = CHAIN_AREA[chainId];
  const p = typeof processor === 'bigint' ? processor.toString() : String(processor);
  const i = typeof id === 'bigint' ? id.toString() : String(id);
  const name = area === undefined ? null : area === null ? `${i}.${p}.tape` : `${i}.${area}.${p}.tape`;
  if (!name || parseCircuit(name)?.chainId !== chainId) throw new Error('不是合法的电路（链、处理器编号、#ID）');
  return name;
}

/** 规范名字 → TAP-10 §3.3 的主机标签（「4246-0」「1-3-1」）；不是规范名字返回 null */
export function hostLabelOf(name) {
  const c = parseCircuit(name);
  if (!c) return null;
  return c.area === null ? `${c.id}-${c.processor}` : `${c.id}-${c.area}-${c.processor}`;
}

/** TAP-10 §3.3 的主机标签 → 规范名字；不合格（前导 0、地区码不认识、超出范围）返回 null */
export function circuitOfHostLabel(label) {
  if (typeof label !== 'string' || label.length > MAX_NAME) return null;
  const m = LABEL_RE.exec(label);
  if (!m || !fromParts(m[1], m[2], m[3])) return null;
  return m[2] ? `${m[1]}.${m[2]}.${m[3]}.tape` : `${m[1]}.${m[3]}.tape`;
}

/**
 * 输入框的写法（TAP-10 §3.4，只给开发包、命令行、模板的输入框用，协议里不用）→ 规范名字；认不出返回 null。
 * 认：规范名字、短名（4246.0、1.3.1）、显示标签（#4246@0、4246@0、#1@3.1）、tape:// 和 web+tape:// 网址（取主机，可以不带 .tape）；
 * tape://、web+tape://、.tape 不分大小写；前后的空白去掉。容器地址、「处理器合约#ID」要读链反查，这里返回 null，由调用方经 TapeKit 内核做。
 */
export function normalizeCircuitInput(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (s.length > 2048) return null;
  const url = /^(?:web\+)?tape:\/\/([^/?#]*)(?:[/?#].*)?$/.exec(s);
  if (url) s = url[1];
  const label = /^#?([1-9][0-9]*)@((?:[1-9][0-9]*\.)?(?:0|[1-9][0-9]*))$/.exec(s);
  if (label) s = `${label[1]}.${label[2]}`;
  if (!s.endsWith('.tape')) s = `${s}.tape`;
  return isAccount(s) ? s : null;
}

/**
 * TapeKit 内核 resolve 的结果（TAP-10 §4.2、§4.3：chainId、cpu＝处理器编号、tokenId＝#ID）→ 规范名字；拼不出合法名字返回 null。
 * 用链号、处理器编号、#ID 重新拼，不直接用内核给的 name（D-634：容器地址的输入在本机反查后，换成名字再进协议）。
 */
export function circuitOfResolved(res) {
  if (!res || res.cpu === undefined || res.cpu === null || res.tokenId === undefined || res.tokenId === null) return null;
  try { return circuitName({ chainId: Number(res.chainId), processor: res.cpu, id: res.tokenId }); } catch { return null; }
}
