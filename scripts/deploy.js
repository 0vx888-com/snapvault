const hre = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const local = ['hardhat', 'localhost'].includes(hre.network.name);
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error('没有部署签名账户；请在本机配置 DEPLOYER_KEY，不要发送给他人。');
  const treasury = process.env.TREASURY || (local ? deployer.address : '');
  const fee = Number(process.env.FEE_BPS ?? 1000);
  if (!hre.ethers.isAddress(treasury) || treasury === hre.ethers.ZeroAddress) throw new Error('TREASURY 必须是有效非零收款地址');
  if (!Number.isInteger(fee) || fee < 0 || fee > 3000) throw new Error('FEE_BPS 必须是 0–3000 的整数');
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const expected = { xlayer: 196, xlayerTestnet: 1952 }[hre.network.name];
  if (!local && (!expected || expected !== chainId)) throw new Error('网络与预期 chainId 不符，已停止部署');
  if (!local && process.env.CONFIRM_LIVE_DEPLOY !== hre.network.name) throw new Error(`真实链部署需要在本机显式设置 CONFIRM_LIVE_DEPLOY=${hre.network.name}`);
  const vault = await hre.ethers.deployContract('SnapVault', [treasury, fee]);
  await vault.waitForDeployment();
  const receipt = await vault.deploymentTransaction().wait();
  const record = { network: hre.network.name, chainId, address: await vault.getAddress(), transactionHash: receipt.hash, blockNumber: receipt.blockNumber, deployer: deployer.address, owner: await vault.owner(), treasury: await vault.treasury(), feeBps: Number(await vault.feeBps()), gasUsed: receipt.gasUsed.toString(), localOnly: local };
  fs.mkdirSync(path.join(__dirname, '../deployments'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, `../deployments/${hre.network.name}.json`), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
  console.log(local ? '本地临时链部署完成；这不是 X Layer 合约地址。' : '合约已部署。前端仍为演示模式，需另行接入真实付款与密钥交付服务。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
