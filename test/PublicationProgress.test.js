const{expect}=require('chai');
describe('冻结发布计划和独立续传记录',function(){
 let m,manifest,plan,setup;
 before(async()=>{m=await import('../scripts/publication-progress.mjs');manifest='0x'+'ab'.repeat(32);plan=[{path:'index.html',chunk:0,to:'0x'+'12'.repeat(20),value:'0x0',data:'0x1234'}];setup={releaseScopedProgress:true,expectedManifestHash:manifest,expectedPlanHash:m.planHash(plan)};});
 it('新版本单独进度文件，不复用旧修复预算记录',()=>{const r=m.publicationRecord(setup,manifest);expect(r.scoped).eq(true);expect(r.name).eq('deweb-release-'+manifest.slice(2)+'-progress.json');expect(r.name).not.eq(m.publicationRecord({},manifest).name);});
 it('冻结文件版本变化则拒绝',()=>expect(()=>m.publicationRecord(setup,'0x'+'cd'.repeat(32))).throws('manifest mismatch'));
 it('相同冻结交易计划可继续核对',()=>expect(()=>m.assertPublicationPlan(setup,manifest,plan)).not.throws());
 it('更换路径、字节、顺序或金额均拒绝',()=>{for(const field of ['path','data','value']){const bad=plan.map(x=>({...x,[field]:field==='path'?'other.js':field==='data'?'0x5678':'0x1'}));expect(()=>m.assertPublicationPlan(setup,manifest,bad)).throws('plan changed');}});
 it('即便重新计算哈希也不能偷偷加激活付款',()=>{const bad=[{...plan[0],path:'activation',value:'0x1'}];expect(()=>m.assertPublicationPlan({...setup,expectedPlanHash:m.planHash(bad)},manifest,bad)).throws('cannot add activation');});
 it('交易顺序变化不能沿用原批准计划',()=>{const two=[...plan,{...plan[0],path:'style.css',data:'0x5678'}];expect(()=>m.assertPublicationPlan({...setup,expectedPlanHash:m.planHash(two)},manifest,[...two].reverse())).throws('plan changed');});
 it('缺少明确计划哈希则拒绝新发布',()=>expect(()=>m.assertPublicationPlan({...setup,expectedPlanHash:null},manifest,plan)).throws('plan changed'));
});

describe('上传页中断恢复不会重复弹钱包',function(){this.timeout(30000);
 (process.env.SNAPVAULT_BROWSER_TEST?it:it.skip)('nonce 已占用则阻止重发；已有哈希只查回执；不同版本不复用旧哈希',async()=>{
  const fs=require('node:fs'),path=require('node:path'),http=require('node:http');const{launchOptions}=require('../scripts/browser-test-config.cjs');const{chromium}=await import('playwright');
  const owner='0x'+'12'.repeat(20),hash='0x'+'34'.repeat(32);let done=false,receipts=0,expectedHash=hash;
  const plan={identity:'release-B',recoveryRequired:true,index:0,total:1,owner,chainId:196,path:'index.html',chunk:0,valueOKB:'0',maximumFeeOKB:'0.0001',spentOKB:'0',transaction:{from:owner,to:owner,data:'0x1234',value:'0x0',nonce:'0x4'}};
  const script=fs.readFileSync(path.join(__dirname,'../web/publish-deweb.js'),'utf8');
  const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/plan')return res.end(JSON.stringify(done?{...plan,complete:true}:plan));if(req.url==='/api/receipt'){let raw='';for await(const b of req)raw+=b;const d=JSON.parse(raw);expect(d.hash).eq(expectedHash);receipts++;done=true;return res.end(JSON.stringify({verified:true}));}if(req.url==='/publish.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(script);}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<meta charset="utf-8"><pre id="plan"></pre><button id="send">send</button><button id="verify">verify</button><pre id="log"></pre><script src="/publish.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch(launchOptions());try{
   async function make(pendingIdentity){const page=await browser.newPage();page.setDefaultTimeout(5000);await page.addInitScript(({owner,hash,pendingIdentity})=>{window.__sends=0;window.ethereum={request:async r=>{if(r.method==='eth_requestAccounts')return[owner];if(r.method==='eth_chainId')return'0xc4';if(r.method==='eth_sendTransaction'){window.__sends++;throw Error('Fixture must never send');}}};if(pendingIdentity)sessionStorage.setItem('snapvault-deweb-pending:'+location.origin+':'+pendingIdentity,JSON.stringify({index:0,hash}));},{owner,hash,pendingIdentity});await page.goto(base);await page.locator('#plan').filter({hasText:'第 1/1'}).waitFor();return page;}
   const noHash=await make();await noHash.locator('#send').click();await noHash.locator('#log').filter({hasText:'禁止重复发送'}).waitFor();expect(await noHash.evaluate(()=>window.__sends)).eq(0);expect(receipts).eq(0);await noHash.close();
   const old=await make('release-A');await old.locator('#send').click();await old.locator('#log').filter({hasText:'禁止重复发送'}).waitFor();expect(await old.evaluate(()=>window.__sends)).eq(0);expect(receipts).eq(0);await old.close();
   const resumed=await make('release-B');await resumed.locator('#send').click();await resumed.locator('#plan').filter({hasText:'全部交易已确认'}).waitFor();expect(await resumed.evaluate(()=>window.__sends)).eq(0);expect(receipts).eq(1);await resumed.close();
  }finally{await browser.close();await new Promise(r=>server.close(r));}
 });
});
