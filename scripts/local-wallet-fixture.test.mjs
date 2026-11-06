import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localWalletFixture} from './local-wallet-fixture.mjs';
import {APP_FILES} from './app-files.mjs';
const vault='0x'+'11'.repeat(20), origin='http://127.0.0.1:5999';
test('fixture refuses remote origins, mainnet RPC and invalid vaults before installing routes',async()=>{
 let routes=0;const page={route:async()=>{routes++;}}, provider={send:async(method,args)=>{assert.equal(method,'eth_chainId');assert.deepEqual(args,[]);return '0x7a69';}};
 for(const bad of ['https://www.snapvault.cc','http://example.com','https://127.0.0.1'])await assert.rejects(localWalletFixture(page,{origin:bad,vault,provider}));
 await assert.rejects(localWalletFixture(page,{origin,vault,provider:{send:async()=> '0xc4',getNetwork:async()=>({chainId:31337n})}}));
 await assert.rejects(localWalletFixture(page,{origin,vault:'invalid',provider}));assert.equal(routes,0);
});
test('fixture changes only two constants in memory, retains every production check, and is excluded from release',async()=>{
 const original=await readFile(new URL('../web/wallet.js',import.meta.url),'utf8');let match,handle;
 await localWalletFixture({route:async(m,h)=>{match=m;handle=h;}},{origin,vault,provider:{send:async()=> '0x7a69'}});
 assert.equal(match(new URL(origin+'/wallet.js')),true);assert.equal(match(new URL('https://www.snapvault.cc/wallet.js')),false);assert.equal(match(new URL(origin+'/app.js')),false);
 let body;await handle({fulfill:async response=>{body=response.body;}});
 assert.equal(body,original.replace('"0xFd9b25442955C09007abB2D10dEcD24b4d2CF83f"',JSON.stringify(vault)).replace('export const CHAIN_ID = 196;','export const CHAIN_ID = 31337;'));
 assert.equal(await readFile(new URL('../web/wallet.js',import.meta.url),'utf8'),original);
 assert.ok(!APP_FILES.some(f=>f.includes('fixture')));
 const docker=await readFile(new URL('../Dockerfile',import.meta.url),'utf8');assert.ok(!docker.includes('local-wallet-fixture'));
});
