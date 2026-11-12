import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildApp} from '../scripts/build-app.mjs';
import {walletHttp} from '../server/wallet-http.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('GEO release serves only approved static files with correct MIME and hashes',async t=>{
 await mkdir(resolve(root,'dist'),{recursive:true});const out=await mkdtemp(resolve(root,'dist/geo-test-'));t.after(()=>rm(out,{recursive:true,force:true}));
 await buildApp({server:true,allowMainnet:true,out});
 const manifest=JSON.parse(await readFile(resolve(out,'deweb-manifest.json'),'utf8'));
 const expected={'about.html':'text/html','faq.html':'text/html','robots.txt':'text/plain','sitemap.xml':'application/xml','llms.txt':'text/plain','assets/og-image.png':'image/png'};
 const hosts=[],server=walletHttp({service:{origins:[],config:async()=>({chainId:196,mainnet:true})},root,port:0,allowedHosts:hosts,staticDir:out});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const origin='http://127.0.0.1:'+server.address().port;hosts.push(new URL(origin).host);
 for(const [name,mime]of Object.entries(expected)){
  const bytes=await readFile(resolve(out,name)),entry=manifest.files.find(f=>f.path==='/'+name);assert.ok(entry,name);assert.ok(entry.contentType.startsWith(mime));assert.equal(entry.sha256,'0x'+createHash('sha256').update(bytes).digest('hex'));
  const response=await fetch(origin+'/'+name);assert.equal(response.status,200,name);assert.ok(response.headers.get('content-type').startsWith(mime));assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 }
 for(const name of ['.env','state.enc','master.key','payment-test.html','live.html','deploy-testnet.html'])assert.equal((await fetch(origin+'/'+name)).status,404,name);
 for(const name of ['index.html','about.html','faq.html']){
  const html=await readFile(resolve(out,name),'utf8');assert.match(html,/<link rel="canonical" href="https:\/\/www.snapvault.cc\//);assert.match(html,/<meta property="og:image"/);
  for(const [,json]of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)){const schema=JSON.parse(json);if(schema['@type']==='FAQPage')for(const q of schema.mainEntity)assert.ok(html.includes('<p>'+q.acceptedAnswer.text+'</p>'),'FAQ visible answer must match JSON-LD: '+q.name);}
 }
});
test('GEO copy distinguishes free group chat, conditional TapeSend delivery and future subscriptions',async()=>{
 for(const name of ['about.html','faq.html','llms.txt']){
  const s=await readFile(resolve(root,'web',name),'utf8');assert.match(s,/group chats|group text\/photo chat/);assert.match(s,/platform service/);assert.match(s,/supported container and public key/);assert.match(s,/in-app delivery|receive them in the app/);assert.match(s,/not supported/);
  assert.doesNotMatch(s,/Message delivery uses TapeSend|Group chats and paid fan groups are on the roadmap|群聊和付费粉丝群在后续计划/);
 }
});
