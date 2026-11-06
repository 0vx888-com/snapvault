import {launchOptions,tempPath} from './browser-test-config.cjs';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url).pathname.replace(/\/$/,'');
const base=process.env.WALLET_UI_URL||'http://127.0.0.1:5185/index.html?delivery=wallet';
if(new URL(base).hostname!=='127.0.0.1')throw Error('This test only permits loopback');
const offset=100+Math.floor(Date.now()/1000)%100000;
const {chromium}=await import(root+'/node_modules/playwright/index.mjs');
const {HDNodeWallet,JsonRpcProvider,NonceManager,getBytes}=await import(root+'/node_modules/ethers/lib.esm/index.js');
const provider=new JsonRpcProvider(new URL('/rpc',base).href,31337,{staticNetwork:true});
const browser=await chromium.launch(launchOptions()),errors=[],checks=[];
const check=(v,m)=>{assert.ok(v,m);checks.push(m);console.log('PASS',m);};
const image={name:'sample.png',mimeType:'image/png',buffer:await readFile(root+'/screenshots/sample.png')};
async function user(n,remote=false){
 const account=HDNodeWallet.fromPhrase((await import('hardhat')).default.config.networks.hardhat.accounts.mnemonic,undefined,`m/44'/60'/0'/0/${n+offset}`).connect(provider),signer=new NonceManager(account);
 const context=await browser.newContext({viewport:remote?{width:390,height:844}:{width:1360,height:1000},...(remote?{isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'}:{})}),page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('BROWSER_ERROR',e.message);});
 await page.exposeFunction('__testWalletRequest',async({method,params=[]})=>{
  if(['eth_requestAccounts','eth_accounts'].includes(method))return [account.address];
  if(method==='wallet_switchEthereumChain')return null;
  if(method==='personal_sign')return account.signMessage(getBytes(params[0]));
  if(method==='eth_sendTransaction'){const t=params[0],tx=await signer.sendTransaction({to:t.to,data:t.data,value:t.value?BigInt(t.value):0n,...(t.gas?{gasLimit:BigInt(t.gas)}:{})});return tx.hash;}
  return provider.send(method,params);
 });
 if(remote)await page.route('**/vendor/okx-connect.min.js',route=>route.fulfill({contentType:'text/javascript',body:`export const OKXUniversalProvider={init:async()=>({on(){},off(){},connect:async()=>({namespaces:{eip155:{}}}),request:async r=>{if(r.method==='personal_sign'&&!window.__remoteRejected){window.__remoteRejected=true;throw Object.assign(Error('拒绝登录'),{code:300})}return window.__testWalletRequest(r)},disconnect:async()=>{window.__remoteDisconnects=(window.__remoteDisconnects||0)+1}})};`}));
 else await page.addInitScript(()=>{window.ethereum={request:r=>window.__testWalletRequest(r),on:()=>{}};});
 const localConfig=await (await fetch(new URL('/api/wallet/config',base))).json();await (await import('./local-wallet-fixture.mjs')).localWalletFixture(page,{origin:new URL(base).origin,vault:localConfig.vault,provider});await page.goto(base);await page.locator('#wallet-network').waitFor({state:'attached'});await page.locator('#wallet-service-status').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#connect').textContent==='连接钱包');const login=async()=>{if(remote){await page.locator('[data-open-account]').click();await page.locator('#account-wallet').click();}else await page.locator('#connect').click();};await login();if(remote){await page.locator('#toast').filter({hasText:'取消钱包请求'}).waitFor();await login();}await page.waitForFunction(()=>document.querySelector('#connect').textContent.startsWith('退出 '));return {account,context,page};
}
const chat=async p=>p.locator('nav [data-tab="chat"]').click();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(p,action,b={}){return p.evaluate(async({action,b})=>{const m=await import('./wallet.js');return m.call(action,b);},{action,b});}
async function assertGone(p,action,b){const result=await p.evaluate(async({action,b})=>{const m=await import('./wallet.js');try{return {unexpected:await m.call(action,b)}}catch(e){return {status:e.status,error:e.message}};},{action,b});assert.equal(result.status,410);assert.equal(result.unexpected,undefined);assert.ok(result.error);}
async function refresh(p){await p.evaluate(async()=>{const m=await import('./wallet.js');await m.refresh();});}
try{
 const a=await user(1),b=await user(2),c=await user(3);
 const mobile=await user(4,true);check((await mobile.page.evaluate(()=>window.__remoteDisconnects))>=1,'远程登录拒绝后关闭旧会话，再次连接可成功');check(!!await mobile.page.evaluate(()=>sessionStorage.getItem('sv:wallet-session')),'普通手机浏览器仿真：无注入钱包，通过官方适配器 mock 会话完成登录（非真机）');await mobile.page.locator('[data-open-account]').click();await mobile.page.locator('#account-network').click();await mobile.context.close();
 check(await a.page.locator('#tapesend-inbox').getAttribute('href')===new URL('/tapesend/',base).href,'正式收件入口指向配置 API 的公开客户端，不携带钥匙');
 check((await api(a.page,'state')).profiles[a.account.address.toLowerCase()], '普通钱包签名登录，无容器、无用户私钥');
 await a.page.locator('#my-account').click();await a.page.locator('#account-edit').click();await a.page.locator('#profile-name').fill('小鹿测试创作者');await a.page.locator('#profile-bio').fill('跨浏览器聊天与免容器交付验证');await a.page.locator('#save-profile').click();await a.page.locator('#profile-feedback').getByText('已保存',{exact:false}).waitFor();
 await a.page.getByRole('button',{name:'关闭编辑资料',exact:true}).click();await chat(a.page);await a.page.locator('#xc-fr').click();await a.page.locator('#xc-fq').fill(b.account.address);await a.page.locator('#xc-fadd').click();
 await chat(b.page);await refresh(b.page);await b.page.locator('#xc-fr').click();await Promise.all([b.page.waitForResponse(r=>r.url().endsWith('/friend')&&r.request().method()==='POST'),b.page.locator('[data-accept]').click()]);await b.page.locator('#xc-fr').click();await refresh(a.page);
 await a.page.locator('#xc-new').click();await a.page.locator('#xc-newbox input[type=checkbox]').check();await a.page.locator('#xc-create').click();await a.page.locator('#chat-text').waitFor();
 const conv=(await api(a.page,'state')).convs[0];await refresh(b.page);await b.page.locator('.xc-item').first().click();
 await a.page.locator('#chat-text').fill('免费的文字加图片跨浏览器同步');await a.page.locator('#chat-file').setInputFiles(image);await a.page.locator('#chat-form button[type=submit]').click();
 await b.page.locator('.bubble').filter({hasText:'免费的文字加图片跨浏览器同步'}).waitFor();await b.page.locator('.chat-photo').first().evaluate(i=>i.decode());
 check(await b.page.locator('.chat-photo').first().evaluate(i=>i.naturalWidth>0),'不同浏览器账户收到免费文字＋图片，无链上消息费用');
 await a.page.locator('#chat-text').fill('5 秒后结束展示的普通图片');await a.page.locator('#chat-file').setInputFiles(image);await a.page.locator('.expiry-control summary').click();await a.page.locator('[data-expiry="5"]').click();await a.page.locator('.expiry-control summary').click();await a.page.locator('#chat-form button[type=submit]').click();
 await b.page.locator('[data-message-open]').waitFor();const burnMsg=(await api(b.page,'state')).messages.find(m=>m.burn);await b.page.locator('[data-message-open]').click();await b.page.getByText('5 秒后结束展示的普通图片',{exact:true}).waitFor();const first=(await api(b.page,'state')).messages.find(m=>m.id===burnMsg.id);
 await b.page.reload();await chat(b.page);await b.page.locator('.xc-item').first().click();await assertGone(b.page,'message-open',{id:burnMsg.id});const resumed=(await api(b.page,'state')).messages.find(m=>m.id===burnMsg.id);check(first.viewUntil>0&&resumed.viewUntil>0&&resumed.viewUntil<=first.viewUntil&&resumed.viewUntil<=Date.now(),'免费图文阅后即焚：刷新结束查看且不延长原截止时间');
 await delay(5500);await assertGone(b.page,'message-open',{id:burnMsg.id});checks.push('免费限时消息过期后服务拒绝再次读取');
 await a.page.locator('#chat-paid').click();await a.page.locator('#file').setInputFiles(image);await a.page.locator('#title').fill('私聊免容器付费图片');await a.page.locator('#secs').fill('5');await a.page.locator('#form button[type=submit]').click();
 await a.page.waitForFunction(()=>document.querySelector('#form').dataset.sending !== 'true');console.log('publish log',await a.page.locator('#log').innerText());
 await a.page.locator('#chat-list .paid-chat-card').waitFor({timeout:20000});await refresh(b.page);await b.page.locator('#chat-list .paid-chat-card').waitFor();
 const state=await api(b.page,'state'),product=state.contents.find(p=>p.title==='私聊免容器付费图片');check(product&&product.scope==='dm','创作者原聊天内上传、链上上架、发送同一付费图片卡');
 await assert.rejects(api(c.page,'open',{id:product.id}),/无权/);await assert.rejects(api(b.page,'open',{id:product.id}),/尚未确认/);checks.push('未付款和非会话成员不能领取密钥');
 await b.page.locator('[data-content-action=buy]').click();await b.page.locator('#cancel-purchase').click();check((await api(b.page,'state')).orders.length===0,'取消付款没有订单');
 await b.page.locator('[data-content-action=buy]').click();await b.page.locator('#confirm-purchase').click();
 await b.page.locator('#purchase-dialog').waitFor({state:'hidden',timeout:25000});await b.page.getByRole('button',{name:'打开图片',exact:true}).waitFor({timeout:10000});
 const paid=await api(b.page,'state');check(paid.orders.length===1&&paid.orders[0].viewUntil===null,'普通钱包本地链实付后免容器交付，不提前启动倒计时');
 await b.page.locator('[data-content-action=view]').click();await b.page.locator('#viewer:not(.hidden)').waitFor();await b.page.locator('#vimg').evaluate(i=>i.decode());check(await b.page.locator('#vimg').evaluate(i=>i.naturalWidth>0),'RSA-OAEP 买家公钥交付、哈希核验、AES-GCM 图片解密显示');
 const deadline=(await api(b.page,'state')).orders[0].viewUntil;await b.page.locator('#close-viewer').click();await b.page.reload();await chat(b.page);await b.page.locator('.xc-item').first().click();const ended=(await api(b.page,'state')).orders[0].viewUntil;check(deadline>0&&ended>0&&ended<=deadline&&ended<=Date.now(),'付费图片关闭并刷新后结束查看且不延长原截止时间');await assertGone(b.page,'open',{id:product.id});
 await delay(5500);await assertGone(b.page,'open',{id:product.id});check((await api(b.page,'state')).orders.length===1,'到期不能重开，不重复扣款');

 await api(a.page,'friend',{to:c.account.address});await api(c.page,'friend',{to:a.account.address,accept:true});await refresh(a.page);await chat(a.page);
 await a.page.locator('#xc-new').click();await a.page.locator('#xc-newbox input[type=checkbox]').evaluateAll(es=>es.forEach(e=>e.click()));await a.page.locator('#xc-gname').fill('真实多人群聊');await a.page.locator('#xc-create').click();await a.page.locator('#xc-pane .xc-head').filter({hasText:'真实多人群聊'}).waitFor();
 await a.page.locator('#chat-text').fill('群聊独立计时图片');await a.page.locator('#chat-file').setInputFiles(image);await a.page.locator('.expiry-control summary').click();await a.page.locator('[data-expiry="5"]').click();await a.page.locator('.expiry-control summary').click();await a.page.locator('#chat-form button[type=submit]').click();
 await refresh(b.page);await chat(b.page);await b.page.locator('.xc-item').filter({hasText:'真实多人群聊'}).click();await refresh(c.page);await chat(c.page);await c.page.locator('.xc-item').filter({hasText:'真实多人群聊'}).click();
 await b.page.locator('[data-message-open]').click();await b.page.getByText('群聊独立计时图片',{exact:true}).waitFor();await delay(5500);
 check(await c.page.locator('[data-message-open]').isVisible(),'真实群聊中其他成员未打开时不消耗自己的阅后即焚时间');await c.page.locator('[data-message-open]').click();await c.page.getByText('群聊独立计时图片',{exact:true}).waitFor();check(await c.page.locator('.chat-photo').count()>0,'群聊免费图文与私聊共用真实服务');
 check(await b.page.locator('#chat-list').getByText('🔥 已焚毁',{exact:true}).isVisible(),'群聊已查看成员到期关闭，其他成员独立查看');
 const leak=await b.page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('key:')||k.startsWith('blob:')||k.startsWith('chat:id:')));check(leak.length===0,'真实模式没有将内容密钥、密文和私聊身份密钥写进 localStorage');
 await a.page.locator('nav [data-tab=fan]').click();await a.page.screenshot({path:tempPath('snapvault-wallet-square.png'),fullPage:true});await b.page.screenshot({path:tempPath('snapvault-wallet-chat.png'),fullPage:true});await b.page.setViewportSize({width:390,height:844});check(await b.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'手机布局无横向溢出');await b.page.screenshot({path:tempPath('snapvault-wallet-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);await a.page.locator('nav [data-tab="creator"]').click();await a.page.locator('#creator-library > summary').click();
 await a.page.evaluate(()=>{window.__originalRequest=window.ethereum.request;window.ethereum.request=async r=>{if(r.method==='eth_sendTransaction')throw {code:4001,message:'Rejected'};return window.__originalRequest(r);};});
 await a.page.locator('#withdraw-earnings').click();await a.page.locator('#earnings-feedback').filter({hasText:'取消钱包请求'}).waitFor();check(await a.page.locator('#withdraw-earnings').isEnabled(),'网页提现：拒绝后提示清楚且按钮恢复');
 await a.page.evaluate(()=>{window.__withdrawSends=0;window.ethereum.request=async r=>{if(r.method==='eth_sendTransaction'){window.__withdrawSends++;await new Promise(r=>setTimeout(r,500));}return window.__originalRequest(r);};});
 await a.page.locator('#withdraw-earnings').click();await a.page.locator('#withdraw-earnings').evaluate(b=>b.click());
await a.page.locator('#earnings-feedback').filter({hasText:'提现已确认'}).waitFor();check((await api(a.page,'earnings')).amount==='0.0','创作者通过现有前端真实本地链提现，到账后余额清零');
 check(await a.page.evaluate(()=>window.__withdrawSends)===1,'网页提现：连续点击只广播一次');await a.page.locator('#withdraw-earnings').click();await a.page.locator('#earnings-feedback').filter({hasText:'余额为 0'}).waitFor();check(await a.page.evaluate(()=>window.__withdrawSends)===1,'网页提现：零余额不弹钱包、不发送交易');
 await writeFile(tempPath('snapvault-wallet-e2e-result.json'),JSON.stringify({status:'PASS',checks,browserErrors:errors},null,2));
 console.log('ALL PASS',checks.length);
}catch(e){console.error(e);for(const ctx of browser.contexts())for(const p of ctx.pages()){console.log((await p.locator('body').innerText()).slice(-3500));}process.exitCode=1;}finally{await browser.close();await provider.destroy();}
