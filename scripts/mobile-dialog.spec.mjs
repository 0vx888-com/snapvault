import {launchOptions,tempPath} from './browser-test-config.cjs';
// Browser UI contract tests, explicitly NOT real iOS/Android hardware acceptance.
import {chromium,devices} from 'playwright';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';import{writeFile}from'node:fs/promises';
const server=spawn('python3',['-m','http.server','5261','--bind','127.0.0.1','--directory','web'],{stdio:'ignore'});const browser=await chromium.launch(launchOptions());const results=[];
try{for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:5261/wallet-connect.js')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
for(const name of ['iPhone 13','Pixel 7']){const c=await browser.newContext(devices[name]),p=await c.newPage();await p.goto('http://127.0.0.1:5261/');assert.equal(await p.evaluate(async()=>{const{OKXUniversalProvider}=await import('./vendor/okx-connect.min.js');const sdk=await OKXUniversalProvider.init({dappMetaData:{name:'SnapVault isolated initialization test',icon:new URL('/assets/wallet-icon.png',location.href).href}});const ok=!sdk.connected()&&typeof sdk.request==='function';await sdk.disconnect().catch(()=>{});return ok;}),true);
await p.evaluate(()=>{
 window.testResult=null;
 const load=async()=>({OKXUniversalProvider:{init:async()=>{
  let display;return {
   on:(e,fn)=>{if(e==='display_uri')display=fn;},off(){},
   connect:()=>{display('https://www.okx.com/ul/test-fixture-not-opened');return new Promise(()=>{});},disconnect:async()=>{}
  };
 }}});
 import('./wallet-connect.js').then(({selectProvider})=>selectProvider({chainId:196},{scope:{},load})).then(()=>window.testResult='connected',e=>window.testResult=e.message);
});
await p.getByRole('link',{name:'打开 OKX App 连接',exact:true}).waitFor();assert.equal(await p.locator('.wallet-connect-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);assert.equal(await p.getByRole('link',{name:'打开 OKX App 连接',exact:true}).getAttribute('target'),'_blank');assert.equal(p.url(),'http://127.0.0.1:5261/');await p.getByText('Web3 浏览器',{exact:false}).waitFor();await p.screenshot({path:tempPath(`mobile-wallet-${name.replaceAll(' ','-')}.png`)});await p.getByRole('button',{name:'取消连接',exact:true}).click();await p.waitForFunction(()=>window.testResult?.includes('取消'));assert.equal(await p.locator('.wallet-connect-dialog').count(),0);results.push({device:name,status:'PASS',scope:'Chromium device emulation; real SDK initialization, simulated session URI; no app launch/signature'});await c.close();}
await writeFile('deployment/mobile-dialog-tests.json',JSON.stringify({status:'PASS',realHardwareVerified:false,results},null,2)+'\n');console.log(JSON.stringify(results));}finally{await browser.close();server.kill();}
