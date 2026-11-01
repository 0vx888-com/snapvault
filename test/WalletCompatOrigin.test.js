const {expect}=require('chai');
const {ethers}=require('hardhat');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
describe('DeWEB 兼容域名精确授权（仅本地）',function(){
 const primary='https://10-2-6.tapekit.org',compat='https://10-2-6-open.tapekit.org';
 let service,server,dir,base,signer;
 beforeEach(async function(){
  const {WalletService}=await import('../server/wallet-service.mjs');const {walletHttp}=await import('../server/wallet-http.mjs');
  [signer]=await ethers.getSigners();const operator=ethers.Wallet.fromPhrase(require('hardhat').config.networks.hardhat.accounts.mnemonic);
  const vault=await ethers.deployContract('SnapVaultDirect',[signer.address,1000,signer.address,operator.address]);
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-compat-origin-'));service=new WalletService({allowLocalKeyFile:true,provider:ethers.provider,vault,operator,dir,origins:[primary],confirmations:1});
  const hosts=[];server=walletHttp({service,root:path.resolve(__dirname,'..'),port:0,allowedHosts:hosts});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const host='127.0.0.1:'+server.address().port;hosts.push(host);base='http://'+host;
 });
 afterEach(async function(){if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}if(dir)fs.rmSync(dir,{recursive:true,force:true});});
 async function request(origin,action,body,token){return fetch(base+'/api/wallet/'+action,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 it('新增精确兼容来源后预检和配置可读，陌生或相似域名仍拒绝',async function(){
  expect((await request(compat,'config')).status).to.equal(403);service.origins.push(compat);
  for(const origin of [primary,compat]){const pre=await fetch(base+'/api/wallet/login',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type, Authorization'}});expect(pre.status).to.equal(204);expect(pre.headers.get('access-control-allow-origin')).to.equal(origin);const config=await request(origin,'config');expect(config.status).to.equal(200);expect(config.headers.get('access-control-allow-origin')).to.equal(origin);}
  for(const origin of ['https://evil.test','https://10-2-6-open.tapekit.org.evil.test','https://11-2-6-open.tapekit.org']){const r=await request(origin,'config');expect(r.status).to.equal(403);expect(r.headers.get('access-control-allow-origin')).to.equal(null);}
  expect((await request(compat,'profile',{name:'unauthenticated'})).status).to.equal(401);
 });
 it('主网追加自定义域名并保留 tapekit；精确 CORS 和登录边界不变',async function(){
  const {mainnetAppOrigins}=await import('../server/wallet-origins.mjs');
  const custom=['https://www.snapvault.cc','https://snapvault.cc'];
  const existing=[...service.origins,compat,'https://existing.example'];
  service.origins=mainnetAppOrigins(existing);
  expect(service.origins).to.deep.equal([...existing,...custom]);
  expect(mainnetAppOrigins(service.origins)).to.deep.equal(service.origins);
  for(const origin of [primary,compat,...custom]){
   const pre=await fetch(base+'/api/wallet/login',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type, Authorization'}});
   expect(pre.status).to.equal(204);expect(pre.headers.get('access-control-allow-origin')).to.equal(origin);
   const config=await request(origin,'config');expect(config.status).to.equal(200);expect(config.headers.get('access-control-allow-origin')).to.equal(origin);
   expect((await request(origin,'profile',{name:'unauthenticated'})).status).to.equal(401);
  }
  for(const origin of ['http://snapvault.cc','https://snapvault.cc.evil.test','https://www.snapvault.cc.evil.test','https://other.snapvault.cc']){
   const config=await request(origin,'config');expect(config.status).to.equal(403);expect(config.headers.get('access-control-allow-origin')).to.equal(null);
  }
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=pair.publicKey.export({format:'jwk'});
  for(const origin of custom){
   const q=await(await request(origin,'challenge',{address:signer.address,publicKey})).json();expect(q.message).to.include('URI: '+origin);
   const session=await(await request(origin,'login',{nonce:q.nonce,signature:await signer.signMessage(q.message)})).json();expect(session.token).to.be.a('string');
   expect((await request(origin,'profile',{name:'custom acceptance'},session.token)).status).to.equal(200);
   expect((await request(primary,'profile',{name:'wrong origin'},session.token)).status).to.equal(401);
  }
 });
 it('兼容来源登录绑定自身域名；不能复用正式来源 nonce 或跨来源 token',async function(){
  service.origins.push(compat);const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=pair.publicKey.export({format:'jwk'});
  const primaryChallenge=await(await request(primary,'challenge',{address:signer.address,publicKey})).json();const wrong=await request(compat,'login',{nonce:primaryChallenge.nonce,signature:await signer.signMessage(primaryChallenge.message)});expect(wrong.status).to.equal(401);
  const q=await(await request(compat,'challenge',{address:signer.address,publicKey})).json();expect(q.message).to.include('URI: '+compat);const login=await request(compat,'login',{nonce:q.nonce,signature:await signer.signMessage(q.message)});expect(login.status).to.equal(200);const session=await login.json();
  expect((await request(compat,'profile',{name:'compat acceptance'},session.token)).status).to.equal(200);expect((await request(primary,'profile',{name:'must fail'},session.token)).status).to.equal(401);
 });
});
