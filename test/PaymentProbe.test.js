const {expect}=require('chai');const {ethers}=require('hardhat');
describe('隔离的测试币付款演练（不提供内容交付）',()=>{
 it('部署即创建测试条目；B 付款、事件费率、同址余额与 A 提现完整闭环',async()=>{
  const [a,b]=await ethers.getSigners(),v=await ethers.deployContract('SnapVaultPaymentProbe',[a.address,b.address]),price=ethers.parseEther('0.00001');
  expect((await v.contents(1)).blobURI).eq('urn:snapvault:testnet-payment-probe:no-content-delivery');
  const receipt=await (await v.connect(b).purchase(1,{value:price})).wait(),event=receipt.logs.map(l=>{try{return v.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='Purchase');
  expect(event.args.price).eq(price);expect(event.args.fee).eq(price/10n);expect(event.args.fan).eq(b.address);expect(event.args.accessUntil).eq(BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp)+86400n);
  expect(await v.balances(a.address,ethers.ZeroAddress)).eq(price);expect((await v.contents(1)).sold).eq(1);
  await expect(v.withdraw(ethers.ZeroAddress)).changeEtherBalances([a,v],[price,-price]);expect(await v.balances(a.address,ethers.ZeroAddress)).eq(0);
 });
 it('错误买家、金额、条目、重复付款会回滚，错误部署参数会回滚',async()=>{
  const [a,b,c]=await ethers.getSigners(),v=await ethers.deployContract('SnapVaultPaymentProbe',[a.address,b.address]),price=await v.PROBE_PRICE();
  await expect(v.purchase(1,{value:price})).revertedWithCustomError(v,'BadParams');
  await expect(v.connect(c).purchase(1,{value:price})).revertedWithCustomError(v,'BadParams');
  await expect(v.connect(b).purchase(2,{value:price})).revertedWithCustomError(v,'BadParams');
  await expect(v.connect(b).purchase(1,{value:1})).revertedWithCustomError(v,'WrongValue');
  await v.connect(b).purchase(1,{value:price});await expect(v.connect(b).purchase(1,{value:price})).revertedWithCustomError(v,'AlreadyPurchased');
  await expect(ethers.deployContract('SnapVaultPaymentProbe',[b.address,c.address])).revertedWithCustomError(v,'BadParams');
  await expect(ethers.deployContract('SnapVaultPaymentProbe',[a.address,a.address])).revertedWithCustomError(v,'BadParams');
 });
});
