const {expect}=require('chai');
const {ethers}=require('hardhat');
const {mkdtempSync,rmSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');

describe('真实付款 → 官方 DeWebHub → TAP-10 密钥交付（本地 fixture）',function(){
 let s,hub,vault,fixture,buyer,creator,operator,treasury,dir,crypto,keys,delivery,id,blob,upload;
 beforeEach(async function(){
  [operator,buyer,creator,treasury]=await ethers.getSigners();
  s=await import('../server/delivery.mjs');crypto=await import('../vendor/tapekit-send/index.js');
  fixture=await ethers.deployContract('TapeOutFixture');await fixture.setOwner(1,operator.address);await fixture.setOwner(2,buyer.address);
  const boot=await ethers.deployContract('DeWebBoot');
  const proxy=await ethers.deployContract('DeWebProxy',[boot.target,boot.interface.encodeFunctionData('initialize',[operator.address])]);
  const impl=await ethers.deployContract('DeWebHub',[31337,fixture.target,fixture.target,fixture.target,fixture.target,fixture.target,fixture.target,ethers.keccak256(await ethers.provider.getCode(fixture.target))]);
  hub=await ethers.getContractAt('DeWebHub',proxy.target);await hub.upgradeToAndCall(impl.target,'0x');
  for (const n of [1,2]) await fixture.setPaid(await hub.accountOf(fixture.target,n),true);
  const params={tokenId:2,cpuIndex:0,container:await hub.accountOf(fixture.target,2),holder:buyer.address,hub:hub.target,chainId:31337};
  keys=crypto.deriveKeyPair({...params,signature:await buyer.signMessage(crypto.keyDerivationText(params))});
  await hub.connect(buyer).publishKey(fixture.target,2,1,0,keys.publicKey,1);
  vault=await ethers.deployContract('SnapVaultCheckout',[treasury.address,1000,hub.target,operator.address]);
  dir=mkdtempSync(path.join(tmpdir(),'snapvault-delivery-'));
  const signer=ethers.Wallet.fromPhrase(require('hardhat').config.networks.hardhat.accounts.mnemonic).connect(ethers.provider);
  delivery=new s.DeliveryService({provider:ethers.provider,signer,vault,hub:hub.target,implementation:impl.target,implementationHash:ethers.keccak256(await ethers.provider.getCode(impl.target)),circuits:fixture.target,tokenId:1,chainId:31337,dir,origin:'http://127.0.0.1:5180',confirmations:1});
  blob=readFileSync(path.join(__dirname,'../screenshots/sample.png'));
  const nonce=delivery.challenge(creator.address),manifest={title:'链上独家图片',mime:'image/png',audience:[buyer.address]};
  upload=delivery.upload({address:creator.address,nonce,image:blob.toString('base64'),manifest,signature:await creator.signMessage(delivery.uploadMessage(creator.address,nonce,ethers.sha256(blob),manifest))});
  await vault.connect(creator).listWithOptions(ethers.ZeroAddress,1000,10,0,upload.hash,upload.uri,true);id=1;
 });
 afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});
 const buy=async()=>{const q=await delivery.quote({id,buyer:buyer.address,circuits:fixture.target,tokenId:2});await vault.connect(buyer).purchaseDelivered(id,fixture.target,2,q.key,q.deadline,q.signature,{value:q.price});return q;};
 it('链上付款、分账、自动加密发送；官方解码器解密后可还原原图，重复扫描不重发',async()=>{
  await buy();expect(await vault.balances(creator.address,ethers.ZeroAddress)).eq(900);
  await Promise.all([delivery.deliver(id,buyer.address),delivery.deliver(id,buyer.address)]);await ethers.provider.send('evm_mine',[]);await delivery.scan();await delivery.scan();
  const sent=await hub.queryFilter(hub.filters.Sent());expect(sent).length(1);
  const event=sent[0],message=crypto.decodeContent(crypto.openPayload({payload:ethers.getBytes(event.args.payload),secretKey:keys.secretKey,to:event.args.to,from:s.endpoint(31337,event.args.from),hub:hub.target,ref:event.args.ref,chainId:31337}).content);
  const url=new URL(message.body.split('\n').at(-1)),p=new URLSearchParams(url.hash.slice(1));
  delivery=new s.DeliveryService({...delivery});
  const opened=await delivery.open(id,p.get('claim'));expect(opened.hash).eq(upload.hash);
  const encrypted=readFileSync(path.join(dir,upload.hash.slice(2)+'.bin'));
  expect(s.decryptImage(encrypted,p.get('key')).equals(blob)).eq(true);
  const again=await delivery.open(id,p.get('claim'));expect(again.viewUntil).eq(opened.viewUntil);
  expect(JSON.stringify(delivery.state.jobs)).not.include(p.get('key'));
  const claimHash=ethers.sha256(ethers.getBytes(p.get('claim')));delivery.state.opens[claimHash]=Date.now()-1;
  await expect(delivery.open(id,p.get('claim'))).rejectedWith('展示已结束');
 });
 it('没有交付凭证、错误买家或过期凭证不能扣款；重复购买回滚',async()=>{
  await expect(vault.connect(buyer).purchase(id,{value:1000})).revertedWithCustomError(vault,'DeliveryNotReady');
  const q=await buy();await expect(vault.connect(buyer).purchaseDelivered(id,fixture.target,2,q.key,q.deadline,q.signature,{value:1000})).revertedWithCustomError(vault,'AlreadyPurchased');
  await expect(vault.connect(creator).purchaseDelivered(id,fixture.target,2,q.key,q.deadline,q.signature,{value:1000})).revertedWithCustomError(vault,'DeliveryNotReady');
  await ethers.provider.send('evm_increaseTime',[121]);await ethers.provider.send('evm_mine',[]);
  await expect(vault.connect(buyer).purchaseDelivered(id,fixture.target,2,q.key,q.deadline,q.signature,{value:1000})).revertedWithCustomError(vault,'DeliveryNotReady');
 });
 it('私有范围、缺密文、买家换钥匙或容器换持有人时拒绝凭证／停止投递',async()=>{
  await expect(delivery.quote({id,buyer:treasury.address,circuits:fixture.target,tokenId:2})).rejectedWith('指定买家');
  await buy();await fixture.setOwner(2,creator.address);await expect(delivery.deliver(id,buyer.address)).rejectedWith('公钥或持有人变化');
  expect(await hub.inboxCount(s.endpoint(31337,await hub.accountOf(fixture.target,2)))).eq(0);
 });
 it('缺少密文时禁止付款凭证',async()=>{rmSync(path.join(dir,upload.hash.slice(2)+'.bin'));await expect(delivery.quote({id,buyer:buyer.address,circuits:fixture.target,tokenId:2})).rejected;});
 it('Hub 实现变化后禁止新付款凭证；错误上传签名与重放均被拒绝',async()=>{
  delivery.implementationHash=ethers.ZeroHash;await expect(delivery.quote({id,buyer:buyer.address,circuits:fixture.target,tokenId:2})).rejectedWith('钉住版本');
  const nonce=delivery.challenge(creator.address),manifest={title:'x',mime:'image/png',audience:[]};
  expect(()=>delivery.upload({address:creator.address,nonce,manifest,image:blob.toString('base64'),signature:'0x00'})).to.throw();
  const signed={address:creator.address,nonce,manifest,image:blob.toString('base64'),signature:await creator.signMessage(delivery.uploadMessage(creator.address,nonce,ethers.sha256(blob),manifest))};
  delivery.upload(signed);expect(()=>delivery.upload(signed)).to.throw('上传签名已过期');
 });
 (process.env.SNAPVAULT_BROWSER_TEST ? it : it.skip)('浏览器发布 → HTTP 网关 → 自动 TapeSend → 图片解密及到期关闭（仅本地链）',async function(){
  this.timeout(90000);
  const assert=require('node:assert/strict'),fs=require('node:fs/promises');
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
  const {createIntegrationServer}=await import('../server/http.mjs');
  const port=5182,origin=`http://127.0.0.1:${port}`;
  // All signing below uses ephemeral, unlocked Hardhat test accounts; no user wallet is read.
  const browserDelivery=new s.DeliveryService({...delivery,origin});
  const app=createIntegrationServer({root:path.resolve(__dirname,'..'),port,service:browserDelivery,config:{chainId:31337,vault:vault.target,hub:hub.target}});
  await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
  let browser;
  try{
   browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
   const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],requests=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),body:r.postData()||''}));
   let selected=creator;
   await page.exposeFunction('localTestWalletRequest',async({method,params=[]})=>{
    if(method==='eth_requestAccounts'||method==='eth_accounts')return [selected.address];
    if(method==='personal_sign')return selected.signMessage(ethers.getBytes(params[0]));
    if(method==='eth_sendTransaction'){
     assert.equal(params[0].from.toLowerCase(),selected.address.toLowerCase());
     return ethers.provider.send(method,params);
    }
    return ethers.provider.send(method,params);
   });
   await page.addInitScript(()=>{window.okxwallet={request:r=>window.localTestWalletRequest(r),on:()=>{}};});
   await page.goto(origin+'/live.html');await page.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('已就绪'));
   await page.locator('#live-connect').click();await page.waitForFunction(()=>document.querySelector('#live-wallet').textContent.includes('31337'));
   await page.locator('#live-file').setInputFiles(path.resolve(__dirname,'../screenshots/sample.png'));
   await page.locator('#live-title').fill('本地交付验收 · 自动密钥解密');await page.locator('#live-seconds').fill('10');
   await page.locator('#live-audience').fill(buyer.address);
   await page.locator('#live-publish-button').click();await page.waitForFunction(()=>document.querySelector('#live-log').textContent.includes('链上上架完成'));
   const contentId=await page.locator('#live-id').inputValue();assert.equal(contentId,'2');
   selected=buyer;await page.locator('#live-connect').click();await page.waitForFunction(a=>document.querySelector('#live-wallet').textContent.includes(a),buyer.address);
   await page.locator('#live-circuits').fill(fixture.target);await page.locator('#live-token-id').fill('2');
   const before=await hub.inboxCount(s.endpoint(31337,await hub.accountOf(fixture.target,2)));
   await page.locator('#live-buy').click();await page.waitForFunction(()=>document.querySelector('#live-log').textContent.includes('付款已确认'));
   // Wait for the real HTTP service's automatic scanner, without calling deliver manually.
   let sent=[];const deadline=Date.now()+15000;
   while(Date.now()<deadline){sent=await hub.queryFilter(hub.filters.Sent());if(sent.length)break;await new Promise(r=>setTimeout(r,200));}
   assert.equal(sent.length,1);assert.equal(await hub.inboxCount(s.endpoint(31337,await hub.accountOf(fixture.target,2))),before+1n);
   const event=sent[0],message=crypto.decodeContent(crypto.openPayload({payload:ethers.getBytes(event.args.payload),secretKey:keys.secretKey,to:event.args.to,from:s.endpoint(31337,event.args.from),hub:hub.target,ref:event.args.ref,chainId:31337}).content);
   const link=new URL(message.body.split('\n').at(-1)),fragment=new URLSearchParams(link.hash.slice(1));
   const bad=await page.request.post(origin+'/api/open',{data:{id:contentId,claim:ethers.hexlify(ethers.randomBytes(32))}});assert.equal(bad.status(),400);
   const wrongBuyer=await page.request.post(origin+'/api/quote',{data:{id:contentId,buyer:treasury.address,circuits:fixture.target,tokenId:2}});assert.equal(wrongBuyer.status(),400);
   await page.goto('about:blank');await page.goto(link.href);await page.waitForFunction(()=>location.hash==='');assert.equal(new URL(page.url()).hash,'');
   const originalRoute=async route=>{const res=await route.fetch(),b=Buffer.from(await res.body());b[15]^=1;await route.fulfill({response:res,body:b});};
   await page.route('**/api/blob/*',originalRoute);await page.locator('#live-open').click();await page.waitForFunction(()=>document.querySelector('#live-log').textContent.includes('密文哈希核验失败'));
   await page.unroute('**/api/blob/*',originalRoute);await page.locator('#live-open').click();await page.waitForFunction(()=>document.querySelector('#live-image').naturalWidth>0);
   assert.equal(await page.locator('#live-log').textContent(),'密文哈希核验与图片解密成功。');
   const plainHash=await page.locator('#live-image').evaluate(async el=>{const bytes=await (await fetch(el.src)).arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);return '0x'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');});assert.equal(plainHash,ethers.sha256(blob));
   await page.locator('#live-view').scrollIntoViewIfNeeded();
   const screenshot=path.resolve(__dirname,'../screenshots/local-delivery-decrypted.png');await page.screenshot({path:screenshot});
   await page.waitForFunction(()=>document.querySelector('#live-count').textContent==='展示资格已结束',{},{timeout:15000});assert.equal(await page.locator('#live-image').getAttribute('src'),null);
   await page.locator('#live-open').click();await page.waitForFunction(()=>document.querySelector('#live-log').textContent.includes('展示已结束'));
   await browserDelivery.scan();assert.equal((await hub.queryFilter(hub.filters.Sent())).length,1);
   assert.equal(requests.some(r=>r.url.includes(fragment.get('key'))||r.body.includes(fragment.get('key'))),false);
   assert.equal(requests.some(r=>r.url.includes(fragment.get('claim'))),false);assert.deepEqual(errors,[]);
   const listing=await vault.contents(contentId),purchases=await vault.queryFilter(vault.filters.DeliveryRequested(contentId,buyer.address));
   const report={verifiedAt:new Date().toISOString(),environment:'isolated local Hardhat chain 31337; TapeOut container fixture; official DeWebHub and TAP-10 source',publicTapeSendVerified:false,origin,contentId,priceWei:listing.price.toString(),purchaseTransaction:purchases[0].transactionHash,sentTransaction:event.transactionHash,plaintextSHA256:plainHash,ciphertextSHA256:listing.blobHash,checks:['browser signed upload and on-chain listing','browser payment with delivery quote','automatic server scanner sends one sealed message','official TAP-10 decoder recovers link','wrong claim and unauthorized buyer rejected','tampered gateway bytes rejected','browser AES-GCM plaintext matches original SHA256','key absent from HTTP requests; fragment cleared','10-second expiry clears image and rejects reopen','repeat scanner does not resend'],screenshot:'screenshots/local-delivery-decrypted.png'};
   await fs.writeFile(path.resolve(__dirname,'../deployment/local-delivery-browser.json'),JSON.stringify(report,null,2)+'\n');console.log('LOCAL DELIVERY BROWSER VERIFIED: '+JSON.stringify(report));
  }finally{if(browser)await browser.close();await app.stop();}
 });

});
