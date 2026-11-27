// Read-only DeWEB delta and conservative storage gas model. Never signs or sends.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Contract, Interface, JsonRpcProvider, formatEther} from 'ethers';
import {loadDewebBundle, REGISTRY_ABI} from './deweb-bundle-normalized.mjs';
import {deltaUploadPlan} from './deweb-delta.mjs';
import {XLAYER_REGISTRY} from './release-check.mjs';
const root=process.cwd(), output=resolve(process.env.SNAPVAULT_RELEASE_REPORT_DIR || resolve(root,'dist/release-review'));
const setup=JSON.parse(readFileSync(resolve(root,'config/deweb-publish-optimized.reviewed.json')));
if(setup.name!=='10.2.6.tape'||setup.chainId!==196)throw Error('Unexpected DeWEB target');
const provider=new JsonRpcProvider('https://rpc.xlayer.tech',196,{staticNetwork:true,batchMaxCount:1});
try{
  if(Number(BigInt(await provider.send('eth_chainId',[])))!==196)throw Error('RPC chain mismatch');
  const opener=new Contract('0x536add8f30f03b69f6fbf29d425a816a0dc50106',['function accountOf(address,uint256) view returns(address)','function isOpened(address,uint256) view returns(bool)'],provider);
  const cpu=new Contract(setup.circuits,['function ownerOf(uint256) view returns(address)'],provider);
  const container=await opener.accountOf(setup.circuits,setup.tokenId);
  if(container.toLowerCase()!==setup.container.toLowerCase()||!await opener.isOpened(setup.circuits,setup.tokenId)||(await cpu.ownerOf(setup.tokenId)).toLowerCase()!==setup.owner.toLowerCase())throw Error('Existing container/owner verification failed');
  const block=await provider.getBlockNumber(), gasPrice=await provider.send('eth_gasPrice',[]);
  const bundle=loadDewebBundle(root),delta=await deltaUploadPlan(bundle,container,XLAYER_REGISTRY,provider);
  const iface=new Interface(REGISTRY_ABI),rows=[];let gas=0n;
  for(const file of bundle.files){
    const ops=delta.plan.filter(op=>op.path===file.path);if(!ops.length)continue;
    let amount=0n;
    for(const op of ops){
      const bytes=file.bytes.subarray(op.chunk*24000,(op.chunk+1)*24000);
      const data=iface.encodeFunctionData('putFile',[container,file.path,file.contentType,file.sha256,bytes]);
      amount+=await provider.estimateGas({from:setup.owner,to:XLAYER_REGISTRY,data});
    }
    gas+=amount;rows.push({path:file.path,bytes:file.bytes.length,transactions:ops.length,storageModelGas:String(amount)});
  }
  const price=BigInt(gasPrice),model=gas*price,margin=gas*120n/100n*(price*120n/100n);
  const report={checkedAt:new Date().toISOString(),chainId:196,block,containerName:'10.2.6.tape',container,owner:setup.owner,ownerAndOpenedVerified:true,
    changedFiles:rows,reusedFiles:delta.reused.map(f=>f.path),pendingTransactions:delta.plan.length,storageModelGas:String(gas),gasPriceWei:String(price),
    storageModelOKB:formatEther(model),modelWith20PercentGasAndPriceMarginsOKB:formatEther(margin),
    caveat:'Read-only per-chunk putFile storage model; later append gas and delivery may differ. This is not an exact fee, guaranteed cap, or approval. Recheck wallet amounts before any transaction.',
    newContainers:0,newPaymentsOrTransfers:0,noSignatures:true,noTransactionsSent:true,spendingEnabled:false};
  mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'deweb-cost-model.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{provider.destroy();}
