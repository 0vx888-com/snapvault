// TapeRelay 客户端库：会话密钥（TapeRelay §8.3）、请求签名（TapeRelay §8.2）、撤销（TapeRelay §8.4）。2026-10-11 由主编写窗口编写（CHANGELOG 第 90 条）。
// - 持有人用钱包签一份授权声明，换来一把客户端随机生成的会话密钥；之后每个请求由会话密钥自动签，不再打扰钱包。
// - 会话密钥的私钥只在内存里，不写进任何地方，也不交给网页（TapeRelay Security Considerations：放在与网页内核分开的包里）。
// - 每次授权都生成新的一把，notBefore 就是现在、最长 24 小时（TapeRelay §8.3，I-021）。
// - 2026-10-22（D-339、D-349）：签带范围的 ScopedDelegation（app、scopes，默认只要 objects）。2026-11-07（D-620）：旧格式的 Delegation
//   和给还没升级的服务器另签一份的做法（legacyServers、splitByScopes）删了：服务还没上线，不用兼容。
// - 同日（D-345）：auth.sign 另收到请求体（第三个参数），模板 A 的 remoteAuth（remote.mjs）把认领的请求体交给后台核对。
import { C, domainFor, digest, typedData, signDigest, addressOf, newPrivateKey, base64url, utf8, sha256Hex, randomHex, isAccount, normalizeCircuitInput, scopesOf, SESSION_SCOPES } from './core.mjs';

const MAX_SECONDS = 86400;
const H = (name) => C.headerPrefix + name;

/**
 * 换一把会话密钥。wallet：{ signTypedData(td) → 签名 }（wallet.mjs）；servers：持有人发现文件列出的服务器名字
 * （TapeRelay §8.3「应当」全填，1～16 个）。
 * account、app：电路名（可以只写 1.2.0，签进去的是补全后的完整写法；app 也可以是 ''，即不限应用）；scopes：要的范围（TapeRelay §8.3 的表），只要用得到的。now：Unix 秒；seconds：有效期（最多 86,400）。
 * 返回的 session 里有私钥，调用方只在内存里保管；scopes 是拿到的范围。
 */
export async function authorizeSession({ wallet, account, servers, now, seconds = MAX_SECONDS, app = '', scopes = ['objects'] }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 2026-11-15（UX 审计第四轮）：可以只写 1.2.0
  if (typeof app === 'string' && app !== '') app = normalizeCircuitInput(app) ?? app;
  if (!isAccount(account)) throw new Error('account 要是电路名，例如 1.2.0（TapeRelay §3.2）');
  if (!Array.isArray(servers) || servers.length < 1 || servers.length > 16) throw new Error('servers 要有 1～16 个服务器名字');
  if (!Array.isArray(scopes) || !scopes.every((x) => SESSION_SCOPES.includes(x)) || !scopesOf({ app, scopes })) throw new Error('app 要是空字符串或电路名（例如 1.2.0），scopes 要有 1～5 项、取自 objects、send、inbox、pointers、admit（TapeRelay §8.3；admit 是给用户身份签准入的，D-656；删除用的 release 只能给开发者密钥，TapeStore §2）');
  const privateKey = newPrivateKey();
  const sessionKey = addressOf(privateKey);
  const notBefore = now, expires = now + Math.min(seconds, MAX_SECONDS);
  const signOne = async (type, message) => {
    const delegation = { delegation: message, signature: await wallet.signTypedData(typedData(type, domainFor(account), message)) };
    return { delegation, header: base64url(utf8(JSON.stringify(delegation))) };
  };
  const { delegation, header } = await signOne('ScopedDelegation', { account, sessionKey, servers: [...servers], notBefore, expires, app, scopes: [...scopes] });
  return { account, sessionKey, privateKey, delegation, header, app, scopes: [...scopes], notBefore, expires };
}

/** 会话密钥签请求；第 286 条（收件箱改造）：另带授权声明本身（delegation），会话密钥签的通知要附上它（TapeRelay §9.2，inbox.mjs） */
export const sessionAuth = (session) => ({
  account: session.account,
  sessionKey: session.sessionKey,
  async sign(d) { return signDigest(session.privateKey, d); },
  delegationHeader: session.header,
  delegation: session.delegation,
  scopes: session.scopes,
});
/** 持有人的钱包直接签请求（每个请求都要钱包签一次，一般只在换会话密钥、撤销、释放对象时用；释放另收带 release 范围的会话密钥，TapeStore §4.3，D-520） */
export const walletAuth = (wallet, account) => ({
  account: typeof account === 'string' ? normalizeCircuitInput(account) ?? account : account,   // 电路名可以只写 1.2.0
  async sign(d, td) { return wallet.signTypedData(td); },
  delegationHeader: null,
});

/** 服务器名字（TapeRelay §4.3）→ 请求的网址；端口是 443 时不写端口，与浏览器发出的 Host 一致 */
export function serverUrl(name) {
  const m = /^([a-z0-9.-]+):([1-9][0-9]{0,4})$/.exec(name);
  if (!m) throw new Error(`服务器名字的写法不对：${name}`);
  return m[2] === '443' ? `https://${m[1]}` : `https://${m[1]}:${m[2]}`;
}

/**
 * TapeRelay §8.2：组出 Request、签名，返回要加的请求头。server 是请求发往的服务器名字（主机:端口，与 Host 对应）；
 * upload 为 true 时另加 TR-Object（就是请求体的 SHA-256，TapeRelay §6.1）。
 */
export async function signedHeaders(auth, { server, method, path, query = '', body, now, nonce = randomHex(16), upload = false }) {
  const bodyHash = sha256Hex(body ?? new Uint8Array(0));
  const message = { account: auth.account, server, method, path, query, bodyHash: `0x${bodyHash}`, timestamp: now, nonce: `0x${nonce}` };
  const domain = domainFor(auth.account);
  const signature = await auth.sign(digest('Request', domain, message), typedData('Request', domain, message), body);
  const headers = { [H('Account')]: auth.account, [H('Timestamp')]: String(now), [H('Nonce')]: nonce, [H('Signature')]: signature };
  if (auth.delegationHeader) headers[H('Delegation')] = auth.delegationHeader;
  if (upload) headers[H('Object')] = bodyHash;
  return headers;
}

/** TapeRelay §8.4：持有人的钱包签一份撤销，返回请求体（JSON 文本）。同一份可以原样发给所有服务器 */
export async function signRevocation({ wallet, account, sessionKey, now }) {
  if (typeof account === 'string') account = normalizeCircuitInput(account) ?? account;   // 电路名可以只写 1.2.0
  const revocation = { account, sessionKey, revokedAt: now };
  const signature = await wallet.signTypedData(typedData('Revocation', domainFor(account), revocation));
  return JSON.stringify({ revocation, signature });
}
