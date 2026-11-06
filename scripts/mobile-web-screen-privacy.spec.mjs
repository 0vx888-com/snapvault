// Mobile viewport/touch emulation only. Never counts as an iOS/Android physical screenshot.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,devices} from 'playwright';
import {launchOptions} from './browser-test-config.cjs';
const browser=await chromium.launch(launchOptions()),results=[];
await mkdir('screenshots/mobile-web-protection',{recursive:true});
try {
 for(const [device,label]of [['iPhone 13','iphone-view'],['Pixel 7','android-view']]){
  const {defaultBrowserType,...options}=devices[device];const context=await browser.newContext(options),p=await context.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:5192/?view=messages');await p.waitForFunction(()=>document.body.dataset.uiReady==='true');
  await p.locator('.xc-item').filter({has:p.locator('.xc-row b').filter({hasText:/^小鹿$/})}).click();
  if(await p.locator('.chat-screen-cover').isVisible())await p.locator('.chat-screen-cover').tap();
  await p.locator('.head-menu>summary').tap();
  if(await p.locator('[data-privacy-shield]').getAttribute('aria-pressed')!=='true')await p.locator('[data-privacy-shield]').tap();
  if(await p.locator('.head-menu').getAttribute('open')!==null)await p.locator('.head-menu>summary').tap();
  await p.locator('#chat-text').fill('手机网页测试草稿');
  const text=await p.locator('.bubble').first().innerText();assert(text.length>0);assert(await p.locator('.bubble').first().isVisible());
  assert(!await p.locator('body').evaluate(el=>el.classList.contains('privacy-covered')));
  await p.screenshot({path:`screenshots/mobile-web-protection/${label}-capture-without-web-signal.png`,fullPage:false});
  const screenshotBypasses=await p.locator('.bubble').first().isVisible()&&!await p.locator('body').evaluate(el=>el.classList.contains('privacy-covered'));
  assert(screenshotBypasses,'An automation screenshot should not be mislabeled as a hardware capture callback');
  // Explicit synthetic blur fixture, not a real device switching apps.
  await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await p.locator('.chat-screen-cover').waitFor({state:'visible'});
  assert.equal(await p.locator('#chat-text').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  assert.equal(await p.locator('.bubble').first().evaluate(el=>getComputedStyle(el).visibility),'hidden');
  const box=await p.locator('.chat-screen-cover').boundingBox(),viewport=p.viewportSize();
  assert(box.x>=0&&box.x+box.width<=viewport.width+1);assert(box.y>=0&&box.y+box.height<=viewport.height+1);
  await p.screenshot({path:`screenshots/mobile-web-protection/${label}-simulated-blur-covered.png`,fullPage:false});
  await p.locator('.chat-screen-cover').tap();assert.equal(await p.locator('#chat-text').inputValue(),'手机网页测试草稿');assert(await p.locator('.bubble').first().isVisible());
  await p.locator('.head-menu>summary').tap();await p.locator('[data-privacy-shield]').tap();
  await p.evaluate(()=>window.dispatchEvent(new Event('blur')));assert(!await p.locator('.chat-screen-cover').isVisible());
  assert.deepEqual(errors,[]);
  results.push({deviceProfile:device,browserEngine:'desktop Chromium with mobile viewport/UA/touch emulation',physicalDevice:false,physicalHardwareScreenshotTest:false,enabledControl:true,layoutFits:true,syntheticBlurMasksMessagesAndComposer:true,tapRestoresDraft:true,disabledDoesNotMask:true,captureWithoutObservableWebEvent:'content remains visible in automation screenshot; protection is not universal',pageErrors:errors});
  await context.close();
 }
 const report={checkedAt:new Date().toISOString(),status:'EMULATED_WEB_CHECKS_PASS_PHYSICAL_SCREENSHOTS_UNVERIFIED',results,appWork:false,installedSDK:false,productionChanged:false,feesPaid:0,conclusion:'Cannot claim mobile hardware screenshot blocking. Current code masks only on delivered keyboard/blur/visibility signals; screenshots without those signals bypass masking.'};
 await writeFile('deployment/mobile-web-screen-privacy-checks.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
