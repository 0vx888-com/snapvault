import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const base=process.env.UI_URL||'http://127.0.0.1:5180';
const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base+'/live.html');await page.locator('#live-status').getByText('尚未配置合约',{exact:false}).count();
 await page.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('尚未配置'));
 assert.equal(await page.locator('#live-buy').isDisabled(),true);assert.equal(await page.locator('#live-publish-button').isDisabled(),true);
 await page.locator('#live-connect').click();await page.locator('#live-log').getByText('当前浏览器没有钱包扩展',{exact:false}).waitFor();
 const status=await (await page.request.get(base+'/api/status')).json();assert.equal(status.ready,false);assert.equal(status.publicTestnetTapeSend,false);
 const artifact=await (await page.request.get(base+'/deployment/SnapVaultCheckout.json')).json();assert.ok(artifact.bytecode.startsWith('0x'));assert.ok(artifact.abi.some(x=>x.name==='purchaseDelivered'));
 const forbidden=await page.request.post(base+'/api/quote',{headers:{Origin:'https://example.com'},data:{id:1}});assert.equal(forbidden.status(),403);
 const secret=await page.request.get(base+'/server/delivery.mjs');assert.notEqual(secret.status(),200);
 const notready=await page.request.post(base+'/api/quote',{data:{id:1}});assert.equal(notready.status(),400);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#live-status').textContent.includes('尚未配置'));
 await mkdir(new URL('../screenshots/',import.meta.url),{recursive:true});await page.screenshot({path:new URL('../screenshots/live-integration.png',import.meta.url).pathname,fullPage:false});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS: wallet handoff, disabled payment/upload, deployment artifact, status honesty, foreign-origin rejection, private-file isolation, missing-service refusal, mobile width, zero browser errors');
}finally{await browser.close();}
