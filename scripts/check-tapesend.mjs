// Read-only. Never creates a signer or sends a transaction.
import {JsonRpcProvider,keccak256} from 'ethers';
import {writeFile,mkdir} from 'node:fs/promises';
const hub='0xe61a9c7213a6aa616c246a2b569e555b417b25ee',factory='0x1f09daefa827f02cbb40967cc91b259763760761',slot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const checks=[];
for(const [network,rpc,expected] of [['xlayerTestnet','https://testrpc.xlayer.tech/terigon',1952],['xlayer','https://rpc.xlayer.tech',196]]){
 const p=new JsonRpcProvider(rpc);try{
  const chainId=Number((await p.getNetwork()).chainId);if(chainId!==expected)throw new Error('chainId mismatch');
  const block=await p.getBlockNumber(),hubCode=await p.getCode(hub,block),factoryCode=await p.getCode(factory,block),storage=await p.getStorage(hub,slot,block),implementation='0x'+storage.slice(-40);
  const implementationCode=await p.getCode(implementation,block);
  checks.push({network,rpc,chainId,block,hub,hubHasCode:hubCode!=='0x',factory,factoryHasCode:factoryCode!=='0x',implementation,implementationHash:implementationCode==='0x'?null:keccak256(implementationCode)});
 }catch(error){checks.push({network,rpc,error:error.shortMessage||error.message});}finally{p.destroy();}
}
const report={checkedAt:new Date().toISOString(),source:'TapeOutProtocol/TapeKit@40994bd65baedbda4df72cb0985031a5f082f606',sdkEnabledChainIds:[56,8453,196],checks,note:'No code at known testnet addresses does not prove absence at every possible address. No official 1952 deployment was found in the pinned SDK. No transaction broadcast.'};
await mkdir(new URL('../deployment/',import.meta.url),{recursive:true});await writeFile(new URL('../deployment/tapesend-preflight.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
