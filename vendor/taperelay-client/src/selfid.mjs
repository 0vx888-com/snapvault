// 自主身份（第二档身份）。**这个模块不引用任何库**，所以服务器、客户端、工具都能直接用，也能单独测。
//
// 电路身份（链上名字，例如 1.2.0.tape，circuit.mjs；D-634）要上链、要花钱，换来的是可验证、可追责、可收费、可下架。
// 但有一类用处不需要这些：两个人之间收发纯消息，不存文件、不收费。为这一类加第二档：
//
//     key:0x<40 位小写十六进制>@<节点域名>
//
// 前半是一个以太坊地址（本机生成的密钥对算出来的）：**公钥就在身份里**，所以核对签名不用读链、不用查任何
// 服务器（电路身份要读链拿持有人才能验），这一档反而比电路档更快、更省。
//
// 后半是**替它背书的那个节点**，像邮件的 user@host。为什么必须有它：自主身份本机就能无限生成，而收件箱现有的
// 三层反垃圾——按发件人的令牌桶（inboxPerSenderPerMinute）、一个发件人最多占收件箱 inboxSenderSharePercent、
// 每天最多交出 noticesPerAccountPerDay 条——**全部是按发件人身份计的**，换一个密钥对就全部重置。带上节点之后
// 这个身份就有了来源和责任方：转交这条通知的必须是身份里写的那个节点（relay.mjs 第 3 步核对；而第 7 步的回头
// 确认经 HTTPS 证明了转交方真的是那个域名），所以一个节点放任自己的用户发垃圾，别的节点可以整家降权。
//
// 代价（要让用户知道）：**换节点就要换身份**，和邮件换服务商要换地址一样。电路身份没有这个问题（身份在链上、
// 服务器名单在发现文件里随时改）。所以要长期、要可迁移、要收费或存文件的，用电路身份。
//
// 域名部分允许带端口（协议里服务器的名字本来就可以写成 域名:4246）。一律小写：地址里的十六进制和域名都只收小写，
// 免得同一个身份有多种写法（收件箱按 account 精确查，大小写混写会变成两个人）。
// 2026-11-03（审查 46 的 I-457 第 1 点）：端口不带前导 0（与 TapeRelay §4.3 的服务器名字一样），:04246 这种写法原来收、却永远对不上服务器的名字
const SELF_RE = /^key:(0x[0-9a-f]{40})@([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[1-9][0-9]{0,4})?)$/;

/** 是不是自主身份。只认这一档；电路身份要用 core.mjs 的 isAccount（它的语义没有变） */
export function isSelfAccount(s) {
  const m = typeof s === 'string' ? SELF_RE.exec(s) : null;
  if (!m) return false;
  if (s.length > 128) return false;                      // 收件箱按 account 存，给个上限
  const port = m[6] ? Number(m[6].slice(1)) : null;
  return port === null || (port >= 1 && port <= 65535);
}

/** 自主身份里那个地址（= 公钥指纹）：核对签名时和恢复出来的签名者比。不是自主身份就返回 null */
export const selfKeyOf = (account) => (isSelfAccount(account) ? SELF_RE.exec(account)[1] : null);

/** 替它背书的节点名字（可能带端口）。不是自主身份就返回 null */
export const selfHostOf = (account) => (isSelfAccount(account) ? SELF_RE.exec(account)[2] : null);

/**
 * 身份里写的节点和实际转交来的那个名字是不是同一台。
 * 协议里同一台机器的 域名 和 域名:4246 算同一台（relay.mjs 的 D-333 也是「按主机算」），所以只比主机名；
 * 身份里写了端口的，端口也要一样。
 */
export function selfHostMatches(account, serverName) {
  const host = selfHostOf(account);
  if (host === null || typeof serverName !== 'string') return false;
  const low = serverName.toLowerCase();
  if (host === low) return true;
  if (host.includes(':')) return false;                  // 身份里写了端口：必须一模一样
  const i = low.indexOf(':');
  return i > 0 && low.slice(0, i) === host;              // 身份里没写端口：只比主机名
}
