// TapeRelay 客户端库：模板 A「用开发者的电路」的浏览器直传（D-335、D-337、D-345）。2026-10-22（UTC+8）由编写窗口编写。
// 文件从终端用户的浏览器直接传到开发者的几台服务器，不经过开发者的后台；每个请求的签名由后台用开发者电路的钱包签（类似预签名），协议不改。
// - remoteAuth（浏览器）：用法同 sessionAuth（client.mjs、upload.mjs、replicas.mjs 都能用）。同一时刻要签的请求合成一批 POST 给后台
//   （认领的另带请求体，后台要数里面有几个对象），后台逐个签好交回。后台怎么认终端用户（登录令牌、cookie）由开发者定，经 headers 带上；
// - createRemoteSigner（后台）：check 核对一批：电路是自己的、服务器是自己的、只是上传或认领（POST /v1/objects、/v1/objects/claim，不带 query）、
//   时间与后台的时钟相差不超过 120 秒；认领的请求体要与 bodyHash 相符、是 1～1,000 个不重复的对象。返回每个请求可能新记入的对象
//   （上传的是请求体的哈希、认领的是列表），开发者按它扣这个终端用户的额度，再 sign。签名绑定服务器、路径、请求体的哈希和时间，
//   300 秒内只能用一次（TapeRelay §8.2）。释放、列出、查用量、通知、指针一律不签：这些由后台自己做。
// 不读、不存私钥：后台的钱包（wallet.mjs 的 keyWallet，D-337）由调用方给。
// 2026-11-08：后台也可以用开发者密钥签（auth 给 developerKeyAuth(…)，不用把持有人的私钥放在后台）：回复里另带授权声明 delegation，
// 浏览器的 remoteAuth 收到后放进 TR-Delegation 请求头，服务器照会话密钥的规矩核对。
import { HEX64, utf8, sha256Hex, domainFor, digest, typedData, normalizeSignature, normalizeCircuitInput } from './core.mjs';
import { walletAuth } from './session.mjs';

const MAX_BATCH = 100;                       // 一批最多签 100 个请求
const MAX_SKEW = 120;                        // 请求的时间与后台的时钟最多差 120 秒（D-345「时间在 2 分钟以内」）
const DELEGATION = /^[A-Za-z0-9_-]{1,16384}$/;   // 授权声明的请求头：base64url，不带 =
const KINDS = { '/v1/objects': 'upload', '/v1/objects/claim': 'claim' };
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const err = (code, message) => Object.assign(new Error(message ?? code), { code });

/**
 * 浏览器：签名交给后台。endpoint：后台签名的网址；headers：随请求带上的（例如登录令牌）；windowMs：多等几毫秒，把同时要签的合成一批。
 * 后台回 { signatures: [签名…], delegation? }（与请求一一对应；用开发者密钥签的另带授权声明）；回别的（4xx、5xx）时 code 取回复里的 error，
 * 连不上是 unreachable（uploadToServers 会重试）。
 */
export function remoteAuth({ account, endpoint, headers = {}, fetch = globalThis.fetch, windowMs = 10 }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  let queue = [], timer = null;
  async function flush() {
    const batch = queue;
    queue = [];
    clearTimeout(timer);
    timer = null;
    let res, json;
    try {
      res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ requests: batch.map((b) => b.item) }) });
      json = await res.json().catch(() => null);
    } catch {
      for (const b of batch) b.no(err('unreachable', '连不上签名的后台'));
      return;
    }
    if (!res.ok || !Array.isArray(json?.signatures) || json.signatures.length !== batch.length) {
      const e = err(typeof json?.error === 'string' ? json.error.slice(0, 64) : `http-${res.status}`, typeof json?.message === 'string' ? json.message.slice(0, 300) : '后台没有签');
      e.status = res.status;
      for (const b of batch) b.no(e);
      return;
    }
    if (json.delegation !== undefined && !(typeof json.delegation === 'string' && DELEGATION.test(json.delegation))) {
      for (const b of batch) b.no(err('bad-reply', '后台给的授权声明写法不对'));
      return;
    }
    auth.delegationHeader = json.delegation ?? null;  // 签名交出之前放好：signedHeaders 等签名回来以后才读它
    batch.forEach((b, i) => {
      const sig = normalizeSignature(json.signatures[i]);
      if (sig) b.ok(sig); else b.no(err('bad-reply', '后台给的签名写法不对'));
    });
  }
  const auth = {
    account,
    delegationHeader: null,
    sign(d, td, body) {
      return new Promise((ok, no) => {
        const item = { message: td.message };
        if (td.message.path === '/v1/objects/claim') item.body = new TextDecoder().decode(body);
        queue.push({ item, ok, no });
        if (queue.length >= MAX_BATCH) flush();
        else timer ??= setTimeout(flush, windowMs);
      });
    },
  };
  return auth;
}

/**
 * 后台：签名用 auth（开发者密钥：developerKeyAuth(密钥)，电路取钥匙里的），或者 wallet 加 account（开发者电路持有人的钱包，keyWallet）；
 * servers：存文件用的服务器名字（主机:端口；用开发者密钥时就是钥匙里的那几台）。now：Unix 秒（测试用）。
 */
export function createRemoteSigner({ wallet, auth, account, servers, now = () => Math.floor(Date.now() / 1000) }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  if (auth && account !== undefined && account !== auth.account) throw err('bad-argument', 'account 与 auth 不是同一枚电路');
  const by = auth ?? walletAuth(wallet, account);
  account = by.account;
  const domain = domainFor(account);
  /**
   * 核对浏览器交来的 { requests }：有一个不合格就整批不签，抛错（code 是 remote-refused，message 写明第几个、为什么）。
   * 返回 [{ server, kind（upload 或 claim）, objects（可能新记入的对象的哈希：上传的就是请求体的哈希）, message }]
   */
  function check(input) {
    const list = input?.requests;
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_BATCH) throw err('remote-refused', `requests 要有 1～${MAX_BATCH} 个`);
    const t = now();
    return list.map((r, i) => {
      const no = (why) => { throw err('remote-refused', `第 ${i + 1} 个请求不签：${why}`); };
      const m = r?.message;
      if (!isObj(r) || !isObj(m) || !digest('Request', domain, m)) no('不是 Request 的写法（TapeRelay §15）');
      if (m.account !== account) no('不是这个应用的电路');
      if (!servers.includes(m.server)) no(`服务器 ${String(m.server).slice(0, 80)} 不在这枚电路的发现文件里`);
      const kind = m.method === 'POST' && m.query === '' ? KINDS[m.path] : undefined;
      if (!kind) no('只签上传和认领');
      if (Math.abs(m.timestamp - t) > MAX_SKEW) no(`时间与后台相差超过 ${MAX_SKEW} 秒`);
      if (kind === 'upload') return { server: m.server, kind, objects: [m.bodyHash.slice(2)], message: m };
      if (typeof r.body !== 'string' || `0x${sha256Hex(utf8(r.body))}` !== m.bodyHash) no('认领的请求体与 bodyHash 不符');
      let objects;
      try { objects = JSON.parse(r.body).objects; } catch { no('认领的请求体不是 JSON'); }
      if (!Array.isArray(objects) || objects.length < 1 || objects.length > 1000 || new Set(objects).size !== objects.length || !objects.every((h) => typeof h === 'string' && HEX64.test(h))) {
        no('认领的对象要是 1～1,000 个不重复的哈希（TapeRelay §6.3）');
      }
      return { server: m.server, kind, objects, message: m };
    });
  }
  /** 签 check 过的，返回 { signatures }；用开发者密钥签的另带 delegation（授权声明，浏览器放进请求头） */
  async function sign(checked) {
    const signatures = await Promise.all(checked.map((c) => by.sign(digest('Request', domain, c.message), typedData('Request', domain, c.message))));
    return by.delegationHeader ? { signatures, delegation: by.delegationHeader } : { signatures };
  }
  return { check, sign };
}
