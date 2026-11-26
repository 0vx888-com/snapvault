// TapeRelay 客户端库：上传公开文件之前，查文件里有没有像密钥、密码的东西（D-249；CHANGELOG 第 291 条）。
// 公开文件谁都能读（TapeRelay §6.2、TapeRelay Security Considerations），一旦传上去就收不回来。这里只做提醒：查到了由调用方问用户，用户确认不是密钥照样可以传。
// - 只认几种写法很明确的（私钥文件的开头、各家服务的密钥前缀、带「key」「secret」「password」名字的赋值、带密钥的节点网址），
//   宁可漏掉也不乱报；助记词（12、24 个英文单词）只在名字写明 mnemonic（或 .env 的名字带 MNEMONIC、SEED）时查，不另带整份词表。
// - 按文件名另认几种密钥类文件（.env、id_rsa、*.pem、*.key 等），不看内容。
// - 只查像文本的文件（开头 8 KiB 里没有 0 字节），最多查前 16 MiB（再大的标明「只查了一部分」）。
// - 结果只给种类和第几行，**不给密钥本身**（不显示、不记录密钥，安全规则）。
// 第 295 条（I-225）：JWT 改为先按「字母、数字、_、-、点」整段取下、再逐段看（原来的正则遇到「eyJ-eyJ-…」按长度的平方去试）；
// 另认 Web3 开发里常见的几种写法（Hardhat 的 accounts、ethers 的 Wallet、viem 的 privateKeyToAccount 后面紧跟的 64 位十六进制）、
// NodeReal 和 Ankr 带密钥的节点网址、PGP、SSH2、PuTTY 私钥文件的开头、名字带 PASS、MNEMONIC、SEED 的配置项、.ini 里小写的 password 等；
// 开头是 UTF-16 的 BOM 时先转码再查。私钥文件开头的写法在正则里写成 -{5} 等，免得本文件被提交前的扫描、出包的核对当成私钥文件。
// 浏览器和 Node.js 都能用；只用标准的 Uint8Array、Blob、TextDecoder。

const SAMPLE = 8192;
const MAX_SCAN = 16 * 1024 * 1024;
const MAX_FINDINGS = 20;

/**
 * 内容里的几种写法：kind（给程序看）、label（给人看）、re（全局匹配）、keep（可选：匹配之后再看一眼，不算就跳过）。
 * 第 291 条自查：每个「任意多个」后面若还要再对上别的，就给它定上限，免得一长行特殊的文字（一行重复的 KEY、连着的 http://）
 * 让正则按行长的平方去试，页面卡住（test-secretscan.mjs 有这一项）。
 */
const ENV_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|MNEMONIC/;
// 第 295 条（I-225）：名字里单独的一节（按 _ . - 分）是这几个也算；只认单独的一节，免得 COMPASS、BYPASS 之类的误报
const ENV_PART = new Set(['PASS', 'PWD', 'SEED', 'PHRASE']);
const secretName = (name) => { const n = name.toUpperCase(); return ENV_NAME.test(n) || n.split(/[_.-]/).some((p) => ENV_PART.has(p)); };

/**
 * JWT（第 295 条，I-225）：先把「字母、数字、_、-、点」连着的一整段取下来（每段一次取完，不回头试），再逐段看有没有
 * 「…eyJ…（13 个字符以上）. eyJ…（13 个字符以上）. …（10 个字符以上）」；第一段的 eyJ 要在开头或 - 之后（与原来正则的 \b 相同）。
 * 原来的正则遇到「eyJ-eyJ-…」时每个 eyJ 都把后面整串吃下再一个个退回去找点，按长度的平方去试。返回第一段 eyJ 的位置。
 */
const JWT_HEAD = /(?:^|-)eyJ[A-Za-z0-9_-]{10,}$/;
function* jwtHits(_rule, text) {
  const span = /[A-Za-z0-9_.-]+/g;
  let m;
  while ((m = span.exec(text))) {
    const s = m[0];
    if (s.length < 38 || !s.includes('.eyJ')) continue;
    let a = -1, b = -1, i = 0;                                   // 前两段、这一段的起点：[a, b-1)、[b, i-1)、[i, end)
    for (;;) {
      const dot = s.indexOf('.', i);
      const end = dot === -1 ? s.length : dot;
      if (a >= 0 && end - i >= 10 && i - 1 - b >= 13 && s.startsWith('eyJ', b)) {
        const h = JWT_HEAD.exec(s.slice(a, b - 1));
        if (h) { yield m.index + a + h.index + (h[0][0] === '-' ? 1 : 0); break; }
      }
      a = b; b = i;
      if (dot === -1) break;
      i = dot + 1;
    }
  }
}

const RULES = [
  // 第 295 条（I-225）：另认 PGP、SSH2、PuTTY 私钥文件的开头（与本项目提交前的扫描相同的几种）；写成 -{5}、-{4}、[0-9]，见文件开头
  { kind: 'private-key-file', label: '私钥文件的开头（PEM、PGP、SSH2、PuTTY 格式）',
    re: /-{5}BEGIN (?:[A-Z0-9]{1,20} ){0,4}PRIVATE KEY-{5}|-{5}BEGIN PGP PRIVATE KEY BLOCK-{5}|-{4} BEGIN SSH2 (?:[A-Z0-9]{1,20} ){0,3}PRIVATE KEY -{4}|PuTTY-User-Key-File-[0-9]{1,2}:/g },
  { kind: 'hex-private-key', label: '十六进制的私钥（名字里带 private key）', re: /(?:private|priv)[_\- ]?key["'\s:=]{1,6}(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/gi },
  // 第 295 条（I-225）：Web3 开发里最常见的几种：Hardhat 配置的 accounts: ["0x…"]、ethers 的 new Wallet("0x…")、viem 的 privateKeyToAccount("0x…")
  { kind: 'web3-private-key', label: '代码里的私钥（Hardhat 的 accounts、ethers 的 Wallet、viem 的 privateKeyToAccount）',
    re: /\b(?:accounts["']?[ \t]{0,5}:[ \t]{0,5}\[[ \t\r\n]{0,40}|Wallet\([ \t]{0,5}|privateKeyToAccount\([ \t]{0,5})["'`](?:0x)?[0-9a-fA-F]{64}["'`]/g },
  { kind: 'mnemonic', label: '助记词（名字写明 mnemonic）', re: /\bmnemonic["']?[ \t]{0,5}[:=][ \t]{0,5}["'`](?:[a-z]{3,8}[ \t]{1,3}){11,23}[a-z]{3,8}["'`]/gi },
  // 名字先整个取下来（最多 80 个字符），再看名字里有没有 KEY、SECRET 等：不在正则里一边找名字一边找关键词。
  // 第 295 条（I-225）：值可以带引号、引号里可以有空格（例如 MNEMONIC="… … …"）；名字另认 PASS、PWD、SEED、PHRASE、MNEMONIC
  { kind: 'env-secret', label: '名字带 KEY、SECRET、TOKEN、PASS、MNEMONIC、SEED 等的配置项',
    re: /^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]{0,79})[ \t]*=[ \t]*(?:"[^"\n]{8,1024}"|'[^'\n]{8,1024}'|[^\s"'#]{8})/gm, keep: (m) => secretName(m[1]) },
  // 第 295 条（I-225）：.ini、YAML 等里名字带小写字母的（password = …、db_pass: …）；值后面只能是行尾或注释，免得把代码（token = getToken()）当成配置。
  // 值最长 1,024 个字符（任意多个的话，一行 16 MiB 没有空白的文字会让正则的回溯栈溢出）
  { kind: 'ini-secret', label: '配置文件里名字带 password、secret、token、key 等的一行',
    re: /^[ \t]*([A-Za-z][A-Za-z0-9_.-]{0,79})[ \t]*[=:][ \t]*["']?[^\s"'#;()]{8,1024}["']?[ \t]*(?:[#;][^\n]{0,1024})?$/gm, keep: (m) => /[a-z]/.test(m[1]) && secretName(m[1]) },
  { kind: 'config-secret', label: '配置里的 apiKey、secret、token、password', re: /["']?(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|password)["']?[ \t]*[:=][ \t]*["'][^"'\s]{12,512}["']/gi },
  { kind: 'aws-key', label: 'AWS 的访问密钥', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'github-token', label: 'GitHub 的令牌', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { kind: 'sk-key', label: 'sk- 开头的 API 密钥（OpenAI、Anthropic 等）', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'google-key', label: 'Google 的 API 密钥', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'slack-token', label: 'Slack 的令牌', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g },
  { kind: 'stripe-key', label: 'Stripe 的正式密钥', re: /\b[rs]k_live_[0-9A-Za-z]{20,}/g },
  // 2026-10-29（TapeRelay §8.7，D-520）：本协议自己的开发者密钥（trk1_ 开头，后面是几百个 base64url 字符；devkey.mjs）
  { kind: 'taperelay-key', label: 'TapeRelay 的开发者密钥（trk1_ 开头）', re: /\btrk1_[A-Za-z0-9_-]{100,}/g },
  // 第 295 条（I-225）：另认 NodeReal、Ankr（BNB Smart Chain 上最常用的两家）带密钥的网址；Ankr 不带密钥的公共网址（rpc.ankr.com/bsc）不报
  { kind: 'rpc-url-key', label: '带密钥的区块链节点网址',
    re: /https?:\/\/[^\s"'<>]{0,200}?(?:infura\.io\/v3\/[0-9a-f]{32}|alchemy\.com\/v2\/[A-Za-z0-9_-]{20,}|quiknode\.pro\/[0-9a-f]{20,}|nodereal\.io\/(?:v1\/)?[0-9a-f]{32}|rpc\.ankr\.com\/[a-z0-9_]{1,40}\/[0-9a-f]{32,})/gi },
  { kind: 'jwt', label: '登录凭证（JWT）', find: jwtHits },
];

/** 一条正则规则查到的位置（keep 不算的跳过） */
function* regexHits(rule, text) {
  const re = new RegExp(rule.re.source, rule.re.flags);           // 每次用新的，不共用 lastIndex
  let m;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) re.lastIndex++;
    if (!rule.keep || rule.keep(m)) yield m.index;
  }
}

/** 按文件名认出的密钥类文件（不看内容） */
const SECRET_NAME = /(?:^|[\\/])(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)|[^\\/]*\.(?:pem|key|p12|pfx|keystore|jks)|credentials(?:\.json)?|secrets?\.(?:json|ya?ml|toml))$/i;

async function bytesOf(src, end) {
  if (src instanceof Uint8Array) return src.subarray(0, Math.min(end, src.length));
  if (typeof Blob !== 'undefined' && src instanceof Blob) return new Uint8Array(await src.slice(0, end).arrayBuffer());
  throw new Error('scanForSecrets：要 Uint8Array 或 Blob');
}

/**
 * 查一个要公开上传的文件。src：Uint8Array 或 Blob（浏览器的 File）；name：文件名。
 * 返回 { textLike（像文本、查了内容）, partial（只查了前 16 MiB）, findings: [{ kind, label, line? }] }（最多 20 条，没有密钥本身）。
 */
export async function scanForSecrets(src, { name = '' } = {}) {
  const findings = [];
  if (SECRET_NAME.test(String(name))) findings.push({ kind: 'secret-file-name', label: '文件名像密钥类文件（.env、私钥、证书等）' });
  const size = src instanceof Uint8Array ? src.length : src.size;
  const head = await bytesOf(src, SAMPLE);
  // 第 295 条（I-225）：开头是 UTF-16 的 BOM（Windows 的记事本等存的）先转码再查；别的有 0 字节的当作二进制，不查
  const utf16 = head.length >= 2 && head[0] === 0xff && head[1] === 0xfe ? 'utf-16le' : head.length >= 2 && head[0] === 0xfe && head[1] === 0xff ? 'utf-16be' : null;
  if (!utf16 && head.includes(0)) return { textLike: false, partial: false, findings };
  const body = size <= SAMPLE ? head : await bytesOf(src, MAX_SCAN);
  // 一个字节一个字符：行号、位置都按字节算，不受编码影响（UTF-16 的按转码后的字算）
  const text = new TextDecoder(utf16 ?? 'latin1').decode(body);
  let newlines = null;                                           // 第一次查到时才记下各个换行的位置，之后按位置二分查行号
  const lineOf = (index) => {
    if (!newlines) { newlines = []; for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) newlines.push(i); }
    let lo = 0, hi = newlines.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (newlines[mid] < index) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };
  for (const r of RULES) {
    for (const index of (r.find ?? regexHits)(r, text)) {
      findings.push({ kind: r.kind, label: r.label, line: lineOf(index) });
      if (findings.length >= MAX_FINDINGS) break;
    }
    if (findings.length >= MAX_FINDINGS) break;
  }
  return { textLike: true, partial: size > MAX_SCAN, findings };
}
