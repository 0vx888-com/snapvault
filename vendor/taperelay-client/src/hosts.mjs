// TapeRelay：服务器的主机是不是本机、内网、链路本地地址（TapeRelay §9.8、TapeRelay §12.2，D-099）。2026-10-12 由主编写窗口从网关里挪出来（CHANGELOG 第 154 条），
// 网关（kernel-ext/src/relay-gateway.mjs）和收文件通知（client/src/notices.mjs）共用这一份，不写两份。不依赖任何库。
/**
 * TapeRelay §12.2（I-093，D-099）：主机是 localhost、*.localhost，或本机、内网、链路本地的 IPv4 地址时为 true。
 * 先按浏览器的规则把主机名规范化（127.1、0x7f000001 这类写法都会变成 127.0.0.1）；Service Worker 看不到名字解析出的地址，只看名字本身。
 */
export function isLocalHost(host) {
  let h;
  try { h = new URL(`https://${host}/`).hostname.replace(/\.$/, ''); } catch { return true; }   // 浏览器都认不出的主机，当作不能连
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 0 || a === 10 || a === 127 || a >= 224                 // 「这台机器」、内网、本机、组播和保留
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) // 运营商内网、链路本地
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);  // 内网
}
