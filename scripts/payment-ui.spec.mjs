import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:1280,height:950}}),p=await context.newPage(),errors=[];context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));p.on('pageerror',e=>errors.push(e.message));
const base=process.env.UI_URL||'http://127.0.0.1:5180';
try{
 await p.goto(base+'/payment-test.html');await p.waitForFunction(()=>document.querySelector('#probe-roles').textContent.includes('A（部署'));
 for(const id of ['#probe-deploy','#probe-pay','#probe-withdraw'])assert.equal(await p.locator(id).isDisabled(),true);
 await p.locator('#probe-connect').click();await p.locator('#probe-log').filter({hasText:'当前浏览器没有钱包扩展'}).waitFor();
 const state=await (await p.request.get(base+'/api/payment-test')).json();assert.equal(state.chainId,1952);if(state.deployment)assert.match(state.deployment.address,/^0x[0-9a-fA-F]{40}$/);assert.equal(state.productionDeliveryReady,false);
 const invalid=await p.request.post(base+'/api/payment-test',{data:{transactionHash:'not-a-hash'}});assert.equal(invalid.status(),400);
 const foreign=await p.request.post(base+'/api/payment-test',{headers:{Origin:'https://example.com'},data:{}});assert.equal(foreign.status(),403);
 const privateFile=await p.request.get(base+'/config/payment-test.local.json');assert.notEqual(privateFile.status(),200);
 const rpc=await (await p.request.post(base+'/api/testnet-rpc',{data:{jsonrpc:'2.0',id:7,method:'eth_chainId',params:[]}})).json();assert.equal(rpc.result,'0x7a0');
 const rpcSigning=await p.request.post(base+'/api/testnet-rpc',{data:{jsonrpc:'2.0',id:8,method:'eth_sendRawTransaction',params:['0x']}});assert.equal(rpcSigning.status(),400);
 const artifact=await (await p.request.get(base+'/deployment/SnapVaultPaymentProbe.json')).json();assert.ok(artifact.abi.some(x=>x.name==='testBuyer'));assert.ok(artifact.bytecode.length>1000);
 const wrong=await context.newPage();await wrong.addInitScript(()=>{window.ethereum={on(){},async request({method}){if(method==='eth_chainId')return '0xc4';if(method==='eth_requestAccounts'||method==='eth_accounts')return ['0x1538ac2d29d03615d2336a2227900aab334d9402'];throw Error('unexpected test RPC '+method);}};});
 await wrong.goto(base+'/payment-test.html');await wrong.locator('#probe-connect').click();await wrong.locator('#probe-log').filter({hasText:'当前 chainId 196'}).waitFor();assert.equal(await wrong.locator('#probe-deploy').isDisabled(),true);
 const racing=await context.newPage();await racing.addInitScript(()=>{const listeners={};window.ethereum={on(event,fn){listeners[event]=fn;},async request({method}){if(method==='eth_requestAccounts'){listeners.accountsChanged?.(['0x1538ac2d29d03615d2336a2227900aab334d9402']);return ['0x1538ac2d29d03615d2336a2227900aab334d9402'];}if(method==='eth_accounts')return ['0x1538ac2d29d03615d2336a2227900aab334d9402'];if(method==='eth_chainId')return '0x7a0';if(method==='eth_getBalance')return '0x2c68af0bb140000';throw Error('unexpected test RPC '+method);}};});
 await racing.goto(base+'/payment-test.html');await racing.locator('#probe-connect').click();await racing.locator('#probe-log').filter({hasText:'已连接。按 A 部署'}).waitFor();assert.equal(await racing.locator('#probe-deploy').isDisabled(),!!state.deployment);assert.equal(await racing.locator('#probe-pay').isDisabled(),true);
 await p.reload();await p.waitForFunction(()=>document.querySelector('#probe-roles').textContent.includes('A（部署'));
 await p.screenshot({path:new URL('../screenshots/payment-test-ready.png',import.meta.url).pathname,fullPage:false});
 await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS: configured A/B, wallet missing handoff, no automatic signing, disabled transactions before connection, rejects mainnet, handles accountsChanged during connection, receipt import validation, foreign-origin rejection, private config isolation, deployment artifact, mobile width');
}finally{await browser.close();}
