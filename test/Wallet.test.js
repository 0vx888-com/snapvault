const {expect}=require('chai');
const {ethers}=require('hardhat');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
describe('免容器普通钱包交付',function(){
 let vault,creator,buyer,other,operator,service,dir,WalletService;
 const origin='https://snapvault.test';
 before(async()=>({WalletService}=await import('../server/wallet-service.mjs')));
 beforeEach(async()=>{
  [creator,buyer,other]=await ethers.getSigners();operator=ethers.Wallet.fromPhrase('test test test test test test test test test test test junk');
  vault=await ethers.deployContract('SnapVaultDirect',[creator.address,1000,creator.address,operator.address]);
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-wallet-test-'));
  service=new WalletService({allowLocalKeyFile:true,provider:ethers.provider,vault,operator,dir,origins:[origin],confirmations:1});
 });
 afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}));
 async function login(signer){const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=pair.publicKey.export({format:'jwk'});const q=await service.challenge({address:signer.address,publicKey},origin),signature=await signer.signMessage(q.message),s=await service.login({nonce:q.nonce,signature},origin);return {...s,pair,q,signature};}
 async function publish(a,burn=true,secs=5){const bytes=fs.readFileSync(path.resolve(__dirname,'../screenshots/sample.png'));
  const asset=await service.handle('upload',{image:bytes.toString('base64'),mime:'image/png',meta:{title:'免容器图片',price:'0.00001',secs,max:0,burn}},a.token,origin);
  const tx=await vault.connect(creator).listWithOptions(ethers.ZeroAddress,asset.price,secs,0,asset.hash,asset.uri,burn);await tx.wait();await service.handle('register',{id:'1',transactionHash:tx.hash},a.token,origin);return asset;
 }
 it('就绪凭证绑定买家、公钥、合约和期限；旧入口不能绕过检查',async()=>{
  await vault.listWithOptions(ethers.ZeroAddress,100,5,0,ethers.id('blob'),'test',true);
  const deadline=Number((await ethers.provider.getBlock('latest')).timestamp)+120,key=ethers.id('buyer-key');
  const signature=ethers.Signature.from(operator.signingKey.sign(await vault.directDigest(1,buyer.address,key,deadline))).serialized;
  await expect(vault.connect(other).purchaseDirect(1,key,deadline,signature,{value:100})).to.be.revertedWithCustomError(vault,'DeliveryNotReady');
  await expect(vault.connect(buyer).purchaseDirect(1,ethers.id('swapped-key'),deadline,signature,{value:100})).to.be.revertedWithCustomError(vault,'DeliveryNotReady');
  await expect(vault.connect(buyer).purchase(1,{value:100})).to.be.revertedWithCustomError(vault,'DeliveryNotReady');
  await expect(vault.connect(buyer).purchaseDirect(1,key,deadline,signature,{value:100})).to.emit(vault,'DirectRequested');
  await expect(vault.connect(buyer).purchaseDirect(1,key,deadline,signature,{value:100})).to.be.revertedWithCustomError(vault,'AlreadyPurchased');
  expect(await vault.balances(creator.address,ethers.ZeroAddress)).to.equal(100); // creator also treasury
 });
 it('登录拒绝错误来源、他人签名和 nonce 重放，身份不能由请求 who 冒充',async()=>{
  const a=await login(creator);await expect(service.login({nonce:a.q.nonce,signature:a.signature},origin)).to.be.rejectedWith('过期');
  await expect(service.handle('profile',{who:buyer.address,name:'创作者'},a.token,'https://evil.test')).to.be.rejectedWith('签名登录');
  await service.handle('profile',{who:buyer.address,name:'创作者'},a.token,origin);expect(service.state.profiles[creator.address.toLowerCase()].name).to.equal('创作者');expect(service.state.profiles[buyer.address.toLowerCase()]).to.equal(undefined);
  const q=await service.challenge({address:buyer.address,publicKey:a.pair.publicKey.export({format:'jwk'})},origin);
  await expect(service.login({nonce:q.nonce,signature:await creator.signMessage(q.message)},origin)).to.be.rejectedWith('不符');
  await expect(service.challenge({address:buyer.address,publicKey:a.pair.publicKey.export({format:'jwk'})},'https://evil.test')).to.be.rejectedWith('来源');
 });
 it('核验真实订单后 RSA 加密交付，持久化首次时间，重启/换浏览器不能重置',async()=>{
  const a=await login(creator),b=await login(buyer),c=await login(other),asset=await publish(a);
  await expect(service.handle('open',{id:1},b.token,origin)).to.be.rejectedWith('尚未确认');
  const quote=await service.handle('quote',{id:1},b.token,origin);await vault.connect(buyer).purchaseDirect(1,quote.keyHash,quote.deadline,quote.signature,{value:quote.price});
  await expect(service.handle('open',{id:1},c.token,origin)).to.be.rejectedWith('尚未确认');
  const result=await service.handle('open',{id:1},b.token,origin),key=crypto.privateDecrypt({key:b.pair.privateKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(result.encryptedKey,'base64'));
  expect(key.toString('hex')).to.equal(service.state.assets[asset.hash].key);expect(result).not.to.have.property('key');
  const replacement=new WalletService({allowLocalKeyFile:true,provider:ethers.provider,vault,operator,dir,origins:[origin],confirmations:1});service=replacement;const newDevice=await login(buyer);const reopened=await service.handle('open',{id:1},newDevice.token,origin);expect(reopened.viewUntil).to.equal(result.viewUntil);
  service.state.opens['1:'+buyer.address.toLowerCase()]=Date.now()-1;service.save();await expect(service.handle('open',{id:1},newDevice.token,origin)).to.be.rejectedWith('结束展示');
  const disk=fs.readFileSync(path.join(dir,'state.enc'),'utf8');expect(disk).not.to.include(key.toString('hex'));expect(disk).not.to.include('免容器图片');
 });
 it('缺失或篡改密文时付款凭证关闭；会话外无法读消息，群成员各自计时',async()=>{
  const a=await login(creator),b=await login(buyer),c=await login(other),asset=await publish(a);
  service.state.assets[asset.hash].blob=Buffer.from('tampered').toString('base64');await expect(service.handle('quote',{id:1},b.token,origin)).to.be.rejectedWith('未就绪');
  await service.handle('friend',{to:buyer.address},a.token,origin);await service.handle('friend',{to:creator.address,accept:true},b.token,origin);
  await service.handle('friend',{to:other.address},a.token,origin);await service.handle('friend',{to:creator.address,accept:true},c.token,origin);
  const conv=await service.handle('conversation',{members:[buyer.address,other.address],name:'群聊'},a.token,origin);
  const sent=await service.handle('send',{conv:conv.id,text:'阅后即焚',burn:true,secs:5},a.token,origin);
  const first=await service.handle('message-open',{id:sent.id},b.token,origin);expect(service.state.messages[0].opens[other.address.toLowerCase()]).to.equal(undefined);
  service.state.messages[0].opens[buyer.address.toLowerCase()]=Date.now()-1;await expect(service.handle('message-open',{id:sent.id},b.token,origin)).to.be.rejectedWith('结束展示');
  const second=await service.handle('message-open',{id:sent.id},c.token,origin);expect(second.text).to.equal('阅后即焚');expect(second.viewUntil).to.be.greaterThan(first.viewUntil-100);
  const outsider=await ethers.Wallet.createRandom().connect(ethers.provider),d=await login(outsider);await expect(service.handle('message-open',{id:sent.id},d.token,origin)).to.be.rejectedWith('无权');
 });
});
