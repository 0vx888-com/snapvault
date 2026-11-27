// TapeRelay 客户端库：分享链接（D-665、D-666；docs/FRONTENDS-DESIGN.md 第三节）。2026-11-07 由编写窗口编写（网关入口 G1）。
// 公开分享：https://<主机>/f/<电路名>/<信封指纹>#k=<文件钥匙>        钥匙是 32 字节的 base64url（不补齐），在 # 后面：浏览器不把它发给任何服务器
// 会员内容：https://<主机>/f/<电路名>/<信封指纹>#ks=<发钥匙的地址>    地址是 https 的、按 encodeURIComponent 写；打开页向它要钥匙（D-666，发钥匙的后台由开发者自己写）
// 写法严格：链接里的电路名要是规范的链上名字（isAccount：不认短名、大写、前导 0；生成链接的 shareLink 可以只给 1.2.0，写进链接的是补全后的 1.2.0.tape）；信封指纹 64 位小写十六进制；钥匙正好 32 字节、写法唯一；没有 ?；
// # 后面先是 k= 或 ks= 其中一个，后面只能再跟两样、按这个先后：&s=<节点名字>（打开页先去哪几台取，见下面）、&lang=zh 或 &lang=en（打开页的语言，
// 只能是最后一段）。这两样只是给打开页的提示，不改是哪个文件、用哪把钥匙：同一个文件的链接最多差在这两段上，别的东西夹带不进来。
// 不依赖网络，不碰任何密钥以外的东西；钥匙只在返回值里，不写日志。
import { isAccount, base64url, HEX64, normalizeCircuitInput } from './core.mjs';

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
// 2026-11-13：# 后面可以再跟 &s=<节点名字>[,<节点名字>…]（最多 3 个，主机:端口）：打开页先直接到这几台取，省掉读链（取不到再读链）。
// 2026-11-14：最后还可以跟 &lang=zh 或 &lang=en（打开页的语言），解析时去掉；2026-11-15 起别的位置、别的值的 lang= 报 reason 为 lang 的错
// （打开页 entry/player/opener.mjs 的 splitLang 照同一条规矩认语言）。
// 只是提示：内容照样按信封指纹和钥匙逐块核对，写错了只会取不到。
const SERVER_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+:[1-9][0-9]{0,4}$/;
const MAX_HINTS = 3;
const okHint = (n) => typeof n === 'string' && SERVER_RE.test(n) && Number(n.slice(n.lastIndexOf(':') + 1)) <= 65535;
function parseHints(raw) {
  const list = raw.split(',');
  if (!list.length || list.length > MAX_HINTS || !list.every(okHint) || new Set(list).size !== list.length) bad('&s= 后面要是 1～3 个不重复的节点名字（主机:端口），用逗号隔开', 'servers');
  return list;
}
const KEY_SERVER_MAX = 1024;
/**
 * 链接哪里不对（2026-11-14）：错误对象除了 code（一律 bad-link）和 message（中文说明，照旧），另带 reason，给页面按它查中英文案：
 * url（整条链接：不是网址、带 ?、不是 https 或写法不唯一）、path（路径不是 /f/<电路名>/<信封指纹>）、circuit（电路名）、envelope（信封指纹）、
 * key（#k= 的钥匙）、keyserver（#ks= 发钥匙的地址）、no-key（# 后面没有 k= 也没有 ks=）、servers（&s= 的节点名字）、lang（lang= 不在最后或值不是 zh、en）、
 * base（生成链接时的 base）、args（生成链接时 fileKey、keyServer 没有正好给一个）
 */
export const BAD_LINK_REASONS = Object.freeze(['url', 'path', 'circuit', 'envelope', 'key', 'keyserver', 'no-key', 'servers', 'lang', 'base', 'args']);
function bad(message, reason) { const e = new Error(message); e.code = 'bad-link'; e.reason = reason; throw e; }

/** 链接里的钥匙（base64url，不补齐）→ 32 字节；写法不对、不是 32 字节、不是唯一写法（最后一个字符的低位不是 0）的返回 null */
export function parseFileKey(s) {
  if (typeof s !== 'string' || !KEY_RE.test(s)) return null;
  const bin = atob(`${s.replace(/-/g, '+').replace(/_/g, '/')}=`);
  const key = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return key.length === 32 && base64url(key) === s ? key : null;
}

/** 发钥匙的地址（D-666）：https、没有用户名和密码、没有 ? 和 #、最长 1024 个字符；返回规范的写法（URL 解析后的 href），不合格返回 null */
export function checkKeyServer(url) {
  if (typeof url !== 'string' || url.length > KEY_SERVER_MAX || /[?#\s]/.test(url)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !u.hostname) return null;
  return u.href.length > KEY_SERVER_MAX ? null : u.href;
}

/**
 * 链接的主机要是 https 的；只有本机（localhost、*.localhost）可以是 http（2026-11-08，前端第 2 步：本机预览、测试里播放器在本机的 TapeKit 网关上，
 * http://<编号>-2-0.localhost:端口；浏览器把 *.localhost 当安全来源，这种链接也只能在本机打开）
 */
const okProtocol = (u) => u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname.endsWith('.localhost')));

/** base：https://主机[:端口]（结尾的 / 可有可无，不带路径；本机的可以是 http）→ 规范的 origin */
function originOf(base) {
  let u;
  try { u = new URL(String(base)); } catch { bad('base 要是 https://主机', 'base'); }
  if (!okProtocol(u) || u.username || u.password || u.pathname !== '/' || u.search || u.hash || String(base).includes('?') || String(base).includes('#')) bad('base 要是 https://主机（不带路径、? 和 #）', 'base');
  return u.origin;
}

/**
 * 生成分享链接。base：入口的 https://主机（开发者绑定的域名，或某台服务器自己的域名）；circuit：电路名（可以只写 1.2.0，链接里写补全后的 1.2.0.tape）；
 * envelope：信封的 SHA-256（64 位小写十六进制）；fileKey（32 字节，公开分享）和 keyServer（发钥匙的 https 地址，会员内容）给其中一个。不合格抛 code 为 bad-link 的错误
 */
export function shareLink({ base, circuit, envelope, fileKey = null, keyServer = null, servers = null }) {
  const origin = originOf(base);
  if (typeof circuit === 'string') circuit = normalizeCircuitInput(circuit) ?? circuit;   // 2026-11-15（UX 审计第四轮）：可以只写 1.2.0
  if (!isAccount(circuit)) bad('电路名不对，例如 1.2.0', 'circuit');
  if (typeof envelope !== 'string' || !HEX64.test(envelope)) bad('信封指纹要是 64 位小写十六进制', 'envelope');
  if ((fileKey === null) === (keyServer === null)) bad('fileKey 和 keyServer 要给其中一个', 'args');
  let frag;
  if (fileKey !== null) {
    if (!(fileKey instanceof Uint8Array) || fileKey.length !== 32) bad('文件钥匙要是 32 字节', 'key');
    frag = `k=${base64url(fileKey)}`;
  } else frag = `ks=${encodeURIComponent(checkKeyServer(keyServer) ?? bad('发钥匙的地址要是 https://…（不带 ?、#，最长 1024 个字符）', 'keyserver'))}`;
  if (servers !== null) {
    const list = [...new Set(servers)].filter(okHint).slice(0, MAX_HINTS);
    if (list.length) frag += `&s=${list.join(',')}`;
  }
  return `${origin}/f/${circuit}/${envelope}#${frag}`;
}

/**
 * 打开页用：地址栏的路径（location.pathname）和 # 后面（location.hash，带 #）→ { circuit, envelope, fileKey（Uint8Array 或 null）, keyServer（字符串或 null） }。
 * 不看主机和协议（打开页由哪个主机给出都一样）。不合格抛 code 为 bad-link 的错误
 */
export function parseSharePath(pathname, hash) {
  const m = /^\/f\/([^/]*)\/([^/]*)$/.exec(String(pathname));
  if (!m) bad('路径要是 /f/<电路名>/<信封指纹>', 'path');
  if (!isAccount(m[1])) bad('链接里的电路名不对（例如 1.2.0；链接里写的是带 .tape 的完整写法）', 'circuit');   // 链接的写法唯一，这里不补全
  if (!HEX64.test(m[2])) bad('信封指纹要是 64 位小写十六进制', 'envelope');
  let h = String(hash ?? '');
  // 2026-11-14：末尾可以带 &lang=zh 或 &lang=en（打开页用哪种语言），这里只认这两个值、去掉再解析，不影响钥匙和节点
  h = h.replace(/&lang=(zh|en)$/, '');
  if (/(^#|&)lang=/.test(h)) bad('lang= 只能是 # 后面的最后一段，写 &lang=zh 或 &lang=en', 'lang');
  let servers = null;
  const at = h.indexOf('&s=');
  if (at >= 0) { servers = parseHints(h.slice(at + 3)); h = h.slice(0, at); }
  if (h.startsWith('#k=')) return { circuit: m[1], envelope: m[2], fileKey: parseFileKey(h.slice(3)) ?? bad('钥匙不对：要是 32 字节的 base64url（不补齐）', 'key'), keyServer: null, servers };
  if (h.startsWith('#ks=')) {
    const raw = h.slice(4);
    let url;
    try { url = decodeURIComponent(raw); } catch { bad('发钥匙的地址写法不对', 'keyserver'); }
    const ks = checkKeyServer(url);
    if (!ks || encodeURIComponent(ks) !== raw) bad('发钥匙的地址要是 https://…（不带 ?、#，按 encodeURIComponent 写）', 'keyserver');
    return { circuit: m[1], envelope: m[2], fileKey: null, keyServer: ks, servers };
  }
  return bad('链接里没有钥匙：# 后面要是 k=<钥匙> 或 ks=<发钥匙的地址>', 'no-key');
}

/** 整条分享链接 → { origin, host, circuit, envelope, fileKey, keyServer }。要是 https、写法唯一（与 URL 解析后的相同）、没有 ?。不合格抛 code 为 bad-link 的错误 */
export function parseShareLink(url) {
  if (typeof url !== 'string' || url.includes('?')) bad('分享链接要是 https://<主机>/f/<电路名>/<信封指纹>#k=… 或 #ks=…（没有 ?）', 'url');
  let u;
  try { u = new URL(url); } catch { bad('不是网址', 'url'); }
  if (!okProtocol(u) || u.username || u.password || u.href !== url) bad('分享链接要是 https 的、写法唯一（主机小写、不写 443 端口、前后没有空白）', 'url');
  return { origin: u.origin, host: u.host, ...parseSharePath(u.pathname, u.hash) };
}
