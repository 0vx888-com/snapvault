const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SnapVault", () => {
  let v, usdt, owner, treasury, creator, fan, fan2;
  const H = ethers.id("ciphertext");
  beforeEach(async () => {
    [owner, treasury, creator, fan, fan2] = await ethers.getSigners();
    v = await ethers.deployContract("SnapVault", [treasury.address, 1000]);
    usdt = await ethers.deployContract("MockUSDT");
    await usdt.mint(fan.address, 1_000_000_000n);
  });

  it("原生 OKB：上架、购买、分账、访问过期", async () => {
    const price = ethers.parseEther("1");
    await expect(v.connect(creator).list(ethers.ZeroAddress, price, 60, 0, H, "ipfs://x")).to.emit(v, "Listed");
    await expect(v.connect(fan).purchase(1, { value: price })).to.emit(v, "Purchase");
    expect(await v.balances(creator.address, ethers.ZeroAddress)).to.equal(ethers.parseEther("0.9"));
    expect(await v.balances(treasury.address, ethers.ZeroAddress)).to.equal(ethers.parseEther("0.1"));
    expect(await v.hasAccess(1, fan.address)).to.equal(true);
    await time.increase(61);
    expect(await v.hasAccess(1, fan.address)).to.equal(false);
  });

  it("金额不对会回滚", async () => {
    await v.connect(creator).list(ethers.ZeroAddress, 100, 60, 0, H, "");
    await expect(v.connect(fan).purchase(1, { value: 99 })).to.be.revertedWithCustomError(v, "WrongValue");
  });

  it("ERC20 USDT 购买与创作者提现", async () => {
    await v.connect(creator).list(await usdt.getAddress(), 5_000_000, 10, 0, H, "tape://1.2.344/a");
    await usdt.connect(fan).approve(await v.getAddress(), 5_000_000);
    await v.connect(fan).purchase(1);
    await expect(v.connect(creator).withdraw(await usdt.getAddress()))
      .to.emit(v, "Withdraw").withArgs(creator.address, await usdt.getAddress(), 4_500_000);
    expect(await usdt.balanceOf(creator.address)).to.equal(4_500_000);
    await v.connect(treasury).withdraw(await usdt.getAddress());
    expect(await usdt.balanceOf(treasury.address)).to.equal(500_000);
  });

  it("限量售罄、下架、非创作者不能下架", async () => {
    await v.connect(creator).list(ethers.ZeroAddress, 1, 60, 1, H, "");
    await v.connect(fan).purchase(1, { value: 1 });
    await expect(v.connect(fan2).purchase(1, { value: 1 })).to.be.revertedWithCustomError(v, "SoldOut");
    await expect(v.connect(fan).delist(1)).to.be.revertedWithCustomError(v, "NotCreator");
    await v.connect(creator).delist(1);
    await expect(v.connect(fan2).purchase(1, { value: 1 })).to.be.revertedWithCustomError(v, "Inactive");
  });

  it("手续费上限与权限", async () => {
    await expect(v.setFee(3001, treasury.address)).to.be.revertedWithCustomError(v, "BadParams");
    await expect(v.connect(fan).setFee(500, fan.address)).to.be.reverted;
    await v.setFee(500, treasury.address);
    expect(await v.feeBps()).to.equal(500);
  });

  it("无余额提现回滚", async () => {
    await expect(v.connect(fan).withdraw(ethers.ZeroAddress)).to.be.revertedWithCustomError(v, "NothingToWithdraw");
  });
});
