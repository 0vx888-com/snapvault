// TapeRelay 客户端库：钱包。2026-10-11 由主编写窗口编写（CHANGELOG 第 90 条）。
// 钱包只做一件事：signTypedData(td) → 签名（0x 加 130 位十六进制）。拿到的签名一律按 TapeRelay §8.6 改成本协议的写法（用例 C10）：
// v 为 0、1 的加 27，高 s 换成低 s。核对的一方（服务器）不替客户端改。
import { addressOf, digest, signDigest, normalizeSignature } from './core.mjs';

/** 浏览器里的钱包（EIP-1193，例如 window.ethereum）；address 是持有人的地址。多数钱包要先切到电路所在的链才能签（TapeRelay §8.1） */
export function eip1193Wallet(provider, address) {
  return {
    address,
    async signTypedData(td) {
      const raw = await provider.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(td)] });
      const sig = normalizeSignature(raw);
      if (!sig) throw new Error('钱包给的签名写法不对');
      return sig;
    },
  };
}

/**
 * 用私钥直接签的「钱包」：测试用（私钥来自公开标签算出的测试材料），命令行用持有人的私钥建开发者密钥时也用它。
 * 模板 A 的后台原来也用它（D-337），2026-11-08 起改用开发者密钥（D-714）
 */
export function keyWallet(privateKey) {
  return {
    address: addressOf(privateKey),
    async signTypedData(td) {
      const d = digest(td.primaryType, td.domain, td.message);
      if (!d) throw new Error('typed data 的格式不对');
      return signDigest(privateKey, d);
    },
  };
}
