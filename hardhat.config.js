require("@nomicfoundation/hardhat-toolbox");
// 私钥只从环境变量读，仓库里不放任何密钥
const accounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];
module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    // 2026-10-16 用 eth_chainId 实测：主网 0xc4=196，测试网 0x7a0=1952
    xlayer: { url: process.env.XLAYER_RPC || "https://rpc.xlayer.tech", chainId: 196, accounts },
    xlayerTestnet: { url: process.env.XLAYER_TEST_RPC || "https://testrpc.xlayer.tech/terigon", chainId: 1952, accounts },
  },
};
