require("@nomicfoundation/hardhat-toolbox");
// Pinned local solc-js: compile/test without downloading an executable compiler.
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion !== '0.8.28') return runSuper();
  const solc = require('solc');
  return { compilerPath: require.resolve('solc/soljson.js'), isSolcJs: true, version: solcVersion, longVersion: solc.version() };
});
// 私钥只从环境变量读，仓库里不放任何密钥
const accounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];
module.exports = {
  solidity: { version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' } },
  networks: {
    // 2026-10-16 用 eth_chainId 实测：主网 0xc4=196，测试网 0x7a0=1952
    xlayer: { url: process.env.XLAYER_RPC || "https://rpc.xlayer.tech", chainId: 196, accounts },
    xlayerTestnet: { url: process.env.XLAYER_TEST_RPC || "https://testrpc.xlayer.tech/terigon", chainId: 1952, accounts },
  },
};
