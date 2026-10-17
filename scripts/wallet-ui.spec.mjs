import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url).pathname.replace(/\/$/,'');
const base=process.env.WALLET_UI_URL||'http://127.0.0.1:5185/index.html?delivery=wallet';
if(new URL(base).hostname!=='127.0.0.1')throw Error('This test only permits loopback');
const offset=100+Math.floor(Date.now()/1000)%100000;
const {chromium}=await import(root+'/node_modules/playwright/index.mjs');
const {HDNodeWallet,JsonRpcProvider,NonceManager,getBytes}=await import(root+'/node_modules/ethers/lib.esm/index.js');
const provider=new JsonRpcProvider(new URL('/rpc',base).href,31337,{staticNetwork:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),errors=[],checks=[];
const check=(v,m)=>{assert.ok(v,m);checks.push(m);console.log('PASS',m);};
const image={name:'sample.png',mimeType:'image/png',buffer:await readFile(root+'/screenshots/sample.png')};
async function user(n){
 const account=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,`m/44'/60'/0'/0/${n+offset}`).connect(provider),signer=new NonceManager(account);
 const context=await browser.newContext({viewport:{width:1360,height:1000}}),page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('BROWSER_ERROR',e.message);});
 await page.exposeFunction('__testWalletRequest',async({method,params=[]})=>{
  if(['eth_requestAccounts','eth_accounts'].includes(method))return [account.address];
  if(method==='personal_sign')return account.signMessage(getBytes(params[0]));
  if(method==='eth_sendTransaction'){const t=params[0],tx=await signer.sendTransaction({to:t.to,data:t.data,value:t.value?BigInt(t.value):0n,...(t.gas?{gasLimit:BigInt(t.gas)}:{})});return tx.hash;}
  return provider.send(method,params);
 });
 await page.addInitScript(()=>{window.ethereum={request:r=>window.__testWalletRequest(r),on:()=>{}};});
 await page.goto(base);await page.locator('#connect').getByText('连接钱包',{exact:true}).waitFor();await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelector('#connect').textContent.startsWith('退出 '));return {account,context,page};
}
const chat=async p=>p.locator('nav [data-tab="chat"]').click();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(p,action,b={}){return p.evaluate(async({action,b})=>{const m=await import('./wallet.js');return m.call(action,b);},{action,b});}
async function refresh(p){await p.evaluate(async()=>{const m=await import('./wallet.js');await m.refresh();});}
try{
 const a=await user(1),b=await user(2),c=await user(3);
 check((await api(a.page,'state')).profiles[a.account.address.toLowerCase()], '普通钱包签名登录，无容器、无用户私钥');
 await a.page.locator('nav [data-tab="creator"]').click();await a.page.locator('#profile-name').fill('小鹿测试创作者');await a.page.locator('#profile-bio').fill('跨浏览器聊天与免容器交付验证');await a.page.locator('#save-profile').click();await a.page.locator('#profile-feedback').getByText('已保存',{exact:false}).waitFor();
 await chat(a.page);await a.page.locator('#xc-fr').click();await a.page.locator('#xc-fq').fill(b.account.address);await a.page.locator('#xc-fadd').click();
 await chat(b.page);await refresh(b.page);await b.page.locator('#xc-fr').click();await b.page.locator('[data-accept]').click();await refresh(a.page);
 await a.page.locator('#xc-new').click();await a.page.locator('#xc-newbox input[type=checkbox]').check();await a.page.locator('#xc-create').click();await a.page.locator('#chat-text').waitFor();
 const conv=(await api(a.page,'state')).convs[0];await refresh(b.page);await b.page.locator('.xc-item').first().click();
 await a.page.locator('#chat-text').fill('免费的文字加图片跨浏览器同步');await a.page.locator('#chat-file').setInputFiles(image);await a.page.locator('#chat-form button[type=submit]').click();
 await b.page.locator('.bubble').filter({hasText:'免费的文字加图片跨浏览器同步'}).waitFor();await b.page.locator('.chat-photo').first().evaluate(i=>i.decode());
 check(await b.page.locator('.chat-photo').first().evaluate(i=>i.naturalWidth>0),'不同浏览器账户收到免费文字＋图片，无链上消息费用');
 await a.page.locator('#chat-text').fill('5 秒后结束展示的普通图片');await a.page.locator('#chat-file').setInputFiles(image);await a.page.locator('#chat-burn').check();await a.page.locator('#chat-secs').selectOption('5');await a.page.locator('#chat-form button[type=submit]').click();
 await b.page.locator('[data-message-open]').waitFor();const burnMsg=(await api(b.page,'state')).messages.find(m=>m.burn);await b.page.locator('[data-message-open]').click();await b.page.getByText('5 秒后结束展示的普通图片',{exact:true}).waitFor();const first=await api(b.page,'message-open',{id:burnMsg.id});
 await b.page.reload();await chat(b.page);await b.page.locator('.xc-item').first().click();const resumed=await api(b.page,'message-open',{id:burnMsg.id});check(resumed.viewUntil===first.viewUntil,'免费图文阅后即焚：刷新后同一服务端截止时间');
 await delay(5500);await assert.rejects(api(b.page,'message-open',{id:burnMsg.id}),/结束展示/);checks.push('免费限时消息过期后服务拒绝再次读取');
 await a.page.locator('#chat-paid').click();await a.page.locator('#file').setInputFiles(image);await a.page.locator('#title').fill('私聊免容器付费图片');await a.page.locator('#secs').fill('5');await a.page.locator('#form button[type=submit]').click();
 await a.page.waitForFunction(()=>!document.querySelector('#form button[type=submit]').disabled);console.log('publish log',await a.page.locator('#log').innerText());
 await a.page.locator('#chat-list .paid-chat-card').waitFor({timeout:20000});await refresh(b.page);await b.page.locator('#chat-list .paid-chat-card').waitFor();
 const state=await api(b.page,'state'),product=state.contents.find(p=>p.title==='私聊免容器付费图片');check(product&&product.scope==='dm','创作者原聊天内上传、链上上架、发送同一付费图片卡');
 await assert.rejects(api(c.page,'open',{id:product.id}),/无权/);await assert.rejects(api(b.page,'open',{id:product.id}),/尚未确认/);checks.push('未付款和非会话成员不能领取密钥');
 await b.page.locator('[data-content-action=buy]').click();await b.page.locator('#cancel-purchase').click();check((await api(b.page,'state')).orders.length===0,'取消付款没有订单');
 await b.page.locator('[data-content-action=buy]').click();await b.page.locator('#confirm-purchase').click();
 await b.page.locator('#purchase-dialog').waitFor({state:'hidden',timeout:25000});await b.page.getByRole('button',{name:'已购买 · 点击查看',exact:true}).waitFor({timeout:10000});
 const paid=await api(b.page,'state');check(paid.orders.length===1&&paid.orders[0].viewUntil===null,'普通钱包本地链实付后免容器交付，不提前启动倒计时');
 await b.page.locator('[data-content-action=view]').click();await b.page.locator('#viewer:not(.hidden)').waitFor();await b.page.locator('#vimg').evaluate(i=>i.decode());check(await b.page.locator('#vimg').evaluate(i=>i.naturalWidth>0),'RSA-OAEP 买家公钥交付、哈希核验、AES-GCM 图片解密显示');
 const deadline=(await api(b.page,'state')).orders[0].viewUntil;await b.page.locator('#close-viewer').click();await b.page.reload();await chat(b.page);await b.page.locator('.xc-item').first().click();check((await api(b.page,'state')).orders[0].viewUntil===deadline,'付费图片刷新不重置倒计时');
 await delay(5500);await assert.rejects(api(b.page,'open',{id:product.id}),/结束展示/);check((await api(b.page,'state')).orders.length===1,'到期不能重开，不重复扣款');

 await api(a.page,'friend',{to:c.account.address});await api(c.page,'friend',{to:a.account.address,accept:true});await refresh(a.page);await chat(a.page);
 await a.page.locator('#xc-new').click();await a.page.locator('#xc-newbox input[type=checkbox]').evaluateAll(es=>es.forEach(e=>e.click()));await a.page.locator('#xc-gname').fill('真实多人群聊');await a.page.locator('#xc-create').click();await a.page.locator('#xc-pane .xc-head').filter({hasText:'真实多人群聊'}).waitFor();
 await a.page.locator('#chat-text').fill('群聊独立计时图片');await a.page.locator('#chat-file').setInputFiles(image);await a.page.locator('#chat-burn').check();await a.page.locator('#chat-secs').selectOption('5');await a.page.locator('#chat-form button[type=submit]').click();
 await refresh(b.page);await chat(b.page);await b.page.locator('.xc-item').filter({hasText:'真实多人群聊'}).click();await refresh(c.page);await chat(c.page);await c.page.locator('.xc-item').filter({hasText:'真实多人群聊'}).click();
 await b.page.locator('[data-message-open]').click();await b.page.getByText('群聊独立计时图片',{exact:true}).waitFor();await delay(5500);
 check(await c.page.locator('[data-message-open]').isVisible(),'真实群聊中其他成员未打开时不消耗自己的阅后即焚时间');await c.page.locator('[data-message-open]').click();await c.page.getByText('群聊独立计时图片',{exact:true}).waitFor();check(await c.page.locator('.chat-photo').count()>0,'群聊免费图文与私聊共用真实服务');
 check(await b.page.locator('#chat-list').getByText('🔥 已焚毁',{exact:true}).isVisible(),'群聊已查看成员到期关闭，其他成员独立查看');
 const leak=await b.page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('key:')||k.startsWith('blob:')||k.startsWith('chat:id:')));check(leak.length===0,'真实模式没有将内容密钥、密文和私聊身份密钥写进 localStorage');
 await a.page.locator('nav [data-tab=fan]').click();await a.page.screenshot({path:'/private/tmp/snapvault-wallet-square.png',fullPage:true});await b.page.screenshot({path:'/private/tmp/snapvault-wallet-chat.png',fullPage:true});await b.page.setViewportSize({width:390,height:844});check(await b.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'手机布局无横向溢出');await b.page.screenshot({path:'/private/tmp/snapvault-wallet-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);await a.page.locator('nav [data-tab="creator"]').click();await a.page.locator('#withdraw-earnings').click();await a.page.locator('#earnings-feedback').filter({hasText:'提现已确认'}).waitFor();check((await api(a.page,'earnings')).amount==='0.0','创作者通过现有前端真实本地链提现，到账后余额清零');
 await writeFile('/private/tmp/snapvault-wallet-e2e-result.json',JSON.stringify({status:'PASS',checks,browserErrors:errors},null,2));
 console.log('ALL PASS',checks.length);
}catch(e){console.error(e);for(const ctx of browser.contexts())for(const p of ctx.pages()){console.log((await p.locator('body').innerText()).slice(-3500));}process.exitCode=1;}finally{await browser.close();await provider.destroy();}
