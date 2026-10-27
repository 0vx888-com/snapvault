// Read-only: checks every frozen byte and every receipt using two independent RPCs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Interface,getBytes,sha256,formatEther} from 'ethers';
import {loadFrozenRelease} from './freeze-release.mjs';
import {REGISTRY_ABI} from './deweb-bundle-normalized.mjs';
import {XLAYER_REGISTRY,XLAYER_REGISTRY_IMPL,IMPL_SLOT} from './release-check.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const setup=JSON.parse(fs.readFileSync(path.join(root,'config/deweb-social-ui.prepared.json')));
const progress=JSON.parse(fs.readFileSync(path.join(root,'deployment/social-ui-'+setup.expectedManifestHash.slice(2)+'-upload-progress.json')));
const bundle=loadFrozenRelease(root,path.resolve(root,setup.frozenRelease));
if(progress.receipts.length!==11||progress.receipts.some(r=>!r.success)||progress.stopped)throw Error('All eleven successful uploads required');
const spent=progress.receipts.reduce((sum,r)=>sum+BigInt(r.feeWei),0n);
if(spent!==BigInt(progress.spentWei)||spent>1200000000000000n)throw Error('Fee reconciliation or budget failed');
const urls=['https://rpc.xlayer.tech','https://xlayer.drpc.org'];
const providers=urls.map(url=>new JsonRpcProvider(url,196,{staticNetwork:true,batchMaxCount:1}));
const abi=new Interface(REGISTRY_ABI);
async function retry(fn){for(let n=0;;n++){try{return await fn();}catch(e){if(n===4)throw e;await new Promise(r=>setTimeout(r,1500*(n+1)));}}}
try {
 const heads=await Promise.all(providers.map(p=>retry(()=>p.send('eth_blockNumber',[]))));
 const block=Math.min(...heads.map(h=>Number(BigInt(h))))-2;
 if(block<Math.max(...progress.receipts.map(r=>r.block)))throw Error('Wait for two more blocks');
 const tag='0x'+block.toString(16);
 for(const p of providers){
  if(BigInt(await retry(()=>p.send('eth_chainId',[])))!==196n)throw Error('Chain identity changed');
  const impl=await retry(()=>p.send('eth_getStorageAt',[XLAYER_REGISTRY,IMPL_SLOT,tag]));
  if(('0x'+impl.slice(-40)).toLowerCase()!==XLAYER_REGISTRY_IMPL)throw Error('Registry implementation changed');
  for(const receipt of progress.receipts){
   const r=await retry(()=>p.send('eth_getTransactionReceipt',[receipt.hash]));
   if(!r||BigInt(r.status)!==1n||Number(BigInt(r.blockNumber))!==receipt.block||BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice)!==BigInt(receipt.feeWei))throw Error('Receipt mismatch: '+receipt.hash);
  }
 }
 const files=[];
 for(const f of bundle.files){
  for(const p of providers){
   async function call(name,args){const result=await retry(()=>p.send('eth_call',[{to:XLAYER_REGISTRY,data:abi.encodeFunctionData(name,args)},tag]));return abi.decodeFunctionResult(name,result);}
   const info=await call('fileInfo',[setup.container,f.path]);
   if(Number(info[0])!==f.bytes.length||info[2]!==f.sha256)throw Error('File metadata mismatch: '+f.path);
   const parts=[];
   for(let offset=0;offset<f.bytes.length;offset+=96000){const data=await call('readRange',[setup.container,f.path,offset,Math.min(96000,f.bytes.length-offset)]);parts.push(Buffer.from(getBytes(data[0])));}
   if(sha256(Buffer.concat(parts))!==f.sha256)throw Error('File byte mismatch: '+f.path);
  }
  files.push({path:f.path,bytes:f.bytes.length,sha256:f.sha256});
  console.log('VERIFIED '+files.length+'/'+bundle.files.length+' '+f.path);
 }
 const proof={verifiedAt:new Date().toISOString(),chainId:196,registry:XLAYER_REGISTRY,container:setup.container,manifestHash:setup.expectedManifestHash,url:setup.publicURL,block,independentRPCs:2,rpcURLs:urls,files,receipts:progress.receipts,spentWei:spent.toString(),spentOKB:formatEther(spent),approvedBudgetOKB:'0.0012',remainingBudgetOKB:formatEther(1200000000000000n-spent)};
 fs.writeFileSync(path.join(root,'deployment/social-ui-published-proof.json'),JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify({verified:true,files:files.length,spentOKB:proof.spentOKB,remainingBudgetOKB:proof.remainingBudgetOKB}));
}finally{for(const p of providers)p.destroy();}
