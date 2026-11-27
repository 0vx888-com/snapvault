// TapeRelay 客户端库：发现文件（TapeRelay §4）。2026-10-13 由主编写窗口编写（CHANGELOG 第 199 条，阶段 5，负责人下线期间的临时授权 D-148）。
// 原来只有参考适配器（conformance/offline/reference-adapter.mjs，测试代码）和主网检查脚本各自解析；客户端都要用，放进客户端库。
// - parseDiscovery(内容, 电路名)：照 TapeRelay §4.2、TapeRelay §4.3 核对，不合格抛 code 为 bad-discovery 的错误；
//   返回 { servers（原样的 [{ url, fallback? }]）, serverNames（TapeRelay §4.3 的名字列表：主机小写）, encryptionKey（原样的对象，没有为 null） }。
//   第 268 条（I-206）：另给 primaryNames（每一项 url 的名字，一台一个、不重复：存、核对、删除按它算）和 fallbackOf（主名字 → 443 的后备名字，
//   只在读的时候用）。
//   encryptionKey 只核对写法；签名者是不是当前持有人由调用方按 TapeRelay §4.4 用 checkRecipientKey、ownKeyStatus 核对（要当前持有人）。
// - discoveryJson：写发现文件用，字段顺序固定，同样的输入每次得到同样的字节。
// 读链（TapeKit SPEC §5：多家节点一致、核对声明的 SHA-256；没有声明的不得采用）由调用方交来的 TapeKit 内核做（readDiscovery）。
// 2026-10-29（CHANGELOG 第 455 条）：readDiscovery 放进客户端库：开发包、命令行也要读发现文件。
import { C, utf8, isAccount, normalizeCircuitInput, sha256Hex } from './core.mjs';
import { parseKeyString } from './encrypted.mjs';

export const DISCOVERY_PATH = C.discoveryPath;
export const DISCOVERY_MAX = 16384;
const HOST = '[a-z0-9-]+(?:\\.[a-z0-9-]+)*';
const URL_RE = new RegExp(`^https://(${HOST}):([1-9][0-9]{0,4})$`, 'i');
const FALLBACK_RE = new RegExp(`^https://(${HOST})$`, 'i');
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
function bad(message) { const e = new Error(message); e.code = 'bad-discovery'; throw e; }

/** text：字符串或 UTF-8 字节；account：这枚电路的链上名字（TapeRelay §3.2，D-634） */
export function parseDiscovery(text, account) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  let s = text;
  if (s instanceof Uint8Array) {
    if (s.length > DISCOVERY_MAX) bad('发现文件超过 16 KiB（TapeRelay §4.2）');
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(s); } catch { bad('发现文件不是 UTF-8'); }
  }
  if (typeof s !== 'string' || utf8(s).length > DISCOVERY_MAX) bad('发现文件超过 16 KiB（TapeRelay §4.2）');
  let d;
  try { d = JSON.parse(s); } catch { bad('发现文件不是 JSON'); }
  if (!isObj(d) || d.version !== 1) bad('发现文件的 version 不是 1');
  if (!isAccount(account) || d.account !== account) bad('发现文件的 account 不是这枚电路的名字（TapeRelay §4.3）');
  if (!Array.isArray(d.servers) || d.servers.length < 1 || d.servers.length > 8) bad('发现文件的 servers 要有 1～8 项');
  const servers = [], serverNames = [], primaryNames = [], fallbackOf = {};
  for (const x of d.servers) {
    const u = isObj(x) && typeof x.url === 'string' ? URL_RE.exec(x.url) : null;
    if (!u || Number(u[2]) > 65535) bad('servers 的 url 要是 https://主机:端口');
    const name = `${u[1].toLowerCase()}:${u[2]}`;
    serverNames.push(name);
    if (!primaryNames.includes(name)) primaryNames.push(name);
    const one = { url: x.url };
    if (x.fallback !== undefined) {
      const f = typeof x.fallback === 'string' ? FALLBACK_RE.exec(x.fallback) : null;
      if (!f) bad('servers 的 fallback 要是 https://主机（443 端口）');
      const fb = `${f[1].toLowerCase()}:443`;
      serverNames.push(fb);
      if (fb !== name) fallbackOf[name] ??= fb;
      one.fallback = x.fallback;
    }
    servers.push(one);
  }
  let encryptionKey = null;
  if (d.encryptionKey !== undefined) {
    const k = d.encryptionKey;
    if (!isObj(k) || !parseKeyString(k.key) || typeof k.holder !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(k.holder)
      || typeof k.signature !== 'string' || !/^0x[0-9a-f]{130}$/.test(k.signature)) bad('encryptionKey 的写法不对（TapeRelay §4.3、TapeRelay §4.4）');
    encryptionKey = { key: k.key, holder: k.holder, signature: k.signature };
  }
  return { servers, serverNames, primaryNames, fallbackOf, encryptionKey };
}

/**
 * 写发现文件的内容（TapeRelay §4.3）：servers 是 [{ url, fallback? }]（1～8 项），encryptionKey 是 signEncryptionKey 的结果或 null。
 * 字段顺序固定；写之前用 parseDiscovery 核对一遍，不合格就抛错，不写出去。
 */
export function discoveryJson({ account, servers, encryptionKey = null }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  const text = JSON.stringify({ version: 1, account, servers: servers.map((x) => (x.fallback ? { url: x.url, fallback: x.fallback } : { url: x.url })), ...(encryptionKey ? { encryptionKey: { key: encryptionKey.key, holder: encryptionKey.holder, signature: encryptionKey.signature } } : {}) });
  parseDiscovery(text, account);
  return text;
}

/** 服务器名字（主机:端口）→ 发现文件的一项：4246 端口的另带 443 的 fallback（TapeRelay §4.3：服务器之间只连 4246 和 443） */
export function serverEntryOf(name) {
  const m = /^([a-z0-9-]+(?:\.[a-z0-9-]+)*):([1-9][0-9]{0,4})$/.exec(String(name));
  if (!m) bad('服务器名字要是「主机:端口」（小写）');
  if (m[2] === '443') return { url: `https://${m[1]}:443` };
  return m[2] === '4246' ? { url: `https://${m[1]}:4246`, fallback: `https://${m[1]}` } : { url: `https://${m[1]}:${m[2]}` };
}

/**
 * 读一枚电路的发现文件（TapeRelay §4.2）。kernel：TapeKit 内核；res：kernel.resolve 的结果（状态 ok）；account：这枚电路的链上名字（TapeRelay §3.2，D-634）；文件仍在它的容器网站里（res.container）。
 * 只读网站里确实有的这个路径（不走网站的 fallback）；没有声明 SHA-256、超过 16 KiB、内容不合 TapeRelay §4.3 的都不采用。
 * 返回 { status: ok | missing | no-hash | too-large | bad, servers, serverNames, encryptionKey, reason, sha256（读到的字节的，status 不是 missing 时有） }。
 */
export async function readDiscovery(kernel, res, account) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  const man = await kernel.manifest(res);
  if (!man.pathSet?.has(DISCOVERY_PATH)) return { status: 'missing', sha256: null };
  const f = await kernel.getFile(res, man, DISCOVERY_PATH);
  if (!f) return { status: 'missing', sha256: null };
  if (f.status === 'no-hash') return { status: 'no-hash', sha256: null };
  if (f.status !== 'ok' || !f.verified) return { status: 'bad', reason: `链上的文件没核对通过（${f.status}）`, sha256: null };
  const sha256 = sha256Hex(f.bytes);
  if (f.bytes.length > DISCOVERY_MAX) return { status: 'too-large', sha256 };
  try { return { status: 'ok', ...parseDiscovery(f.bytes, account), sha256 }; } catch (e) { return { status: 'bad', reason: e.message, sha256 }; }
}
