const hre = require("hardhat");
async function main() {
  const treasury = process.env.TREASURY;
  if (!treasury) throw new Error("请设置 TREASURY 环境变量（平台收款地址）");
  const fee = Number(process.env.FEE_BPS || 1000);
  const v = await hre.ethers.deployContract("SnapVault", [treasury, fee]);
  await v.waitForDeployment();
  console.log("SnapVault deployed:", await v.getAddress());
}
main().catch((e) => { console.error(e); process.exit(1); });
