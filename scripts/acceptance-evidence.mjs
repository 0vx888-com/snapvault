// Check saved public evidence against the current artifact. No live RPC or signing.
import{readFile}from'node:fs/promises';import{resolve}from'node:path';import{keccak256}from'ethers';
export async function publicTestnetEvidence(root){
 const source='deployment/xlayerTestnet-direct-v2-acceptance.json';
 try{const [e,d,a]=await Promise.all([source,'deployment/xlayerTestnet-direct-v2.json','artifacts/contracts/SnapVaultDirect.sol/SnapVaultDirect.json'].map(async f=>JSON.parse(await readFile(resolve(root,f)))));
 const hash=keccak256(a.bytecode),tx=x=>/^0x[0-9a-fA-F]{64}$/.test(x||''),verified=e.status==='PASS'&&e.chainId===1952&&d.chainId===1952&&d.version===2&&e.vault?.toLowerCase()===d.address?.toLowerCase()&&e.artifactHash===hash&&d.artifactHash===hash&&tx(e.purchaseTx)&&tx(e.withdrawTx)&&e.creator?.toLowerCase()!==e.buyer?.toLowerCase()&&e.originalSHA256===e.decryptedSHA256&&tx(e.originalSHA256)&&e.buyerBrowserViewVerified===true;
 return {verified,source,method:'Saved public testnet acceptance matched to current artifact; no fresh chain verification in this local run',publicTapeSendVerified:e.publicTestnetTapeSend===true};
 }catch(e){return {verified:null,source,method:'Saved evidence unavailable',reason:e.code||e.message};}
}
