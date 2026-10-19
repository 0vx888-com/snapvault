import test from 'node:test';
import assert from 'node:assert/strict';
let serial=0;
async function fixture({expired=false,stateStatus=200,configFails=false}={}){
 const originals=new Map(['location','window','sessionStorage','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const store=new Map(expired?[['sv:wallet-session','isolated-fixture-token'],['sv:wallet-account','0x0000000000000000000000000000000000000001']]:[]);
 let stateCalls=0,authenticatedCalls=0;
 globalThis.location=new URL('https://10-2-6.tapekit.org/');globalThis.window=new EventTarget();
 globalThis.sessionStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/app-config.json'))return Response.json({mode:'wallet',apiBase:'https://backend.example',allowedChainIds:[196],allowMainnet:true});
  if(path==='/api/wallet/config'){if(configFails)throw new TypeError('isolated offline fixture');return Response.json({chainId:196,mainnet:true});}
  if(path==='/api/wallet/state'){stateCalls++;if(options.headers?.Authorization){authenticatedCalls++;return Response.json({error:'请重新登录'},{status:401});}return Response.json(stateStatus===200?{contents:[],orders:[],profiles:{},convs:[],messages:[],friends:[],chainId:196}:{error:'fixture unavailable'},{status:stateStatus});}
  throw Error('Unexpected request; no signing or transaction API permitted: '+path);
 };
 try{const m=await import('../web/wallet.js?isolated-init='+serial++);m.wallet.device={existingDeviceKey:true};return {m,store,counts:()=>({stateCalls,authenticatedCalls}),restore(){for(const[k,d]of originals){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}};}
 catch(e){for(const[k,d]of originals){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}throw e;}
}
test('expired saved login recovers anonymous initialization without requesting a signature',async()=>{const f=await fixture({expired:true});try{await f.m.initWallet();assert.equal(f.m.wallet.ready,true);assert.equal(f.m.wallet.token,null);assert.equal(f.store.has('sv:wallet-session'),false);assert.deepEqual(f.counts(),{stateCalls:2,authenticatedCalls:1});}finally{f.restore();}});
test('ordinary visitor initializes once without clearing the existing device key',async()=>{const f=await fixture();try{const key=f.m.wallet.device;await f.m.initWallet();assert.equal(f.m.wallet.ready,true);assert.equal(f.m.wallet.device,key);assert.deepEqual(f.counts(),{stateCalls:1,authenticatedCalls:0});}finally{f.restore();}});
test('server and transport errors remain failures, not anonymous success',async()=>{const f=await fixture({stateStatus:503});try{await assert.rejects(f.m.initWallet(),e=>e.status===503);assert.equal(f.m.wallet.ready,false);assert.equal(f.counts().stateCalls,1);}finally{f.restore();}const offline=await fixture({configFails:true});try{await assert.rejects(offline.m.initWallet(),TypeError);assert.equal(offline.m.wallet.ready,false);assert.equal(offline.counts().stateCalls,0);}finally{offline.restore();}});
test('an unauthorized anonymous endpoint retries at most once and never reports ready',async()=>{const f=await fixture({stateStatus:401});try{await assert.rejects(f.m.initWallet(),e=>e.status===401);assert.equal(f.m.wallet.ready,false);assert.equal(f.counts().stateCalls,2);}finally{f.restore();}});
