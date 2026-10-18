import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const require=createRequire(root+'/package.json');
const {JsonRpcProvider,Contract,Interface,formatEther,keccak256,ZeroHash,ZeroAddress,ContractFactory,parseEther}=require('ethers');
const A={factory:'0x1f09daefa827f02cbb40967cc91b259763760761',opener:'0x536add8f30f03b69f6fbf29d425a816a0dc50106',registry:'0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6',binding:'0x68809fd2fb343aa57d0aeb7f33defe477c9666f9',hub:'0xe61a9c7213a6aa616c246a2b569e555b417b25ee'};
const urls=['https://rpc.xlayer.tech','https://xlayer.drpc.org'];
const ps=urls.map(u=>new JsonRpcProvider(u,undefined,{batchMaxCount:3}));
const block=Math.min(...await Promise.all(ps.map(p=>p.getBlockNumber())))-2;
const out={checkedAt:new Date().toISOString(),scope:'READ ONLY; eth_call and eth_estimateGas only. No signers, no broadcast, no payment. Synthetic upload bytes only.',chainId:196,block,addresses:A,crossChecks:[],processors:[],estimates:[]};
const slot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
for(let n=0;n<ps.length;n++){
 const p=ps[n];if(Number((await p.getNetwork()).chainId)!==196)throw Error('wrong chain');
 const opener=new Contract(A.opener,['function FEE() view returns(uint256)'],p),binding=new Contract(A.binding,['function monthlyFee() view returns(uint256)'],p),factory=new Contract(A.factory,['function protocolFee() view returns(uint256)','function cpuCount() view returns(uint256)'],p);
 const [fee,monthly,protocol,count]=await Promise.all([opener.FEE({blockTag:block}),binding.monthlyFee({blockTag:block}),factory.protocolFee({blockTag:block}),factory.cpuCount({blockTag:block})]);
 const pins={};for(const k of ['registry','binding','hub']){const s=await p.getStorage(A[k],slot,block);const impl='0x'+s.slice(-40);pins[k]={implementation:impl,codeHash:keccak256(await p.getCode(impl,block))};}
 out.crossChecks.push({rpc:urls[n],openingOKB:formatEther(fee),monthlyOKB:formatEther(monthly),protocolMintOKB:formatEther(protocol),cpuCount:String(count),pins});
}
for(const check of out.crossChecks){for(const [key,expected] of Object.entries({registry:'0xa85c4143d1d4a77f54b8e4ecc9e6d1418afea45f',binding:'0x5ebf29b80789e548907c707530c3c7607c4347df',hub:'0xdcc57797089ebd9f26e686379a4323f353a3f9c6'})){if(check.pins[key].implementation.toLowerCase()!==expected)throw Error('Official implementation pin changed: '+key);}}
if(JSON.stringify({...out.crossChecks[0],rpc:null})!==JSON.stringify({...out.crossChecks[1],rpc:null}))throw Error('RPC fee/pin disagreement');
const p=ps[0],gp=BigInt(await p.send('eth_gasPrice',[]));out.gasPriceWei=String(gp);
const factory=new Contract(A.factory,['function cpuAt(uint256) view returns(address)'],p);
for(const index of [0,4,6]){
 const address=await factory.cpuAt(index,{blockTag:block});const cpu=new Contract(address,['function TAPEOUT_FEE() view returns(uint256)','function transistors() view returns(address)','function name() view returns(string)'],p);
 const transistor=await cpu.transistors({blockTag:block}),t=new Contract(transistor,['function mintPrice() view returns(uint256)','function protocolFee() view returns(uint256)','function supplyCap() view returns(uint256)','function minted() view returns(uint256)'],p);
 const [tapeoutFee,mintPrice,protocolFee,supplyCap,minted,name]=await Promise.all([cpu.TAPEOUT_FEE({blockTag:block}),t.mintPrice({blockTag:block}),t.protocolFee({blockTag:block}),t.supplyCap({blockTag:block}),t.minted({blockTag:block}),cpu.name({blockTag:block})]);
 out.processors.push({index,address,name,transistor,tapeoutOKB:formatEther(tapeoutFee),mintPriceOKB:formatEther(mintPrice),protocolMintOKB:formatEther(protocolFee),supplyCap:String(supplyCap),minted:String(minted)});
}
const holder='0x571d447f4f24688eC35Ccf07f1D6993655F6aF15',cpu0=out.processors[0].address;
const cpu=new Contract(cpu0,['function ownerOf(uint256) view returns(address)'],p),opener=new Contract(A.opener,['function accountOf(address,uint256) view returns(address)','function isOpened(address,uint256) view returns(bool)'],p);
if((await cpu.ownerOf(1)).toLowerCase()!==holder.toLowerCase()||!await opener.isOpened(cpu0,1))throw Error('Historical public simulation account changed');
const container=await opener.accountOf(cpu0,1),to=await opener.accountOf(cpu0,2);
out.simulationIdentity={holder,cpu:cpu0,tokenId:1,container,recipient:to,note:'Public third-party historical identity for unsigned simulation only; not a SnapVault-owned wallet.'};
const hub=new Contract(A.hub,['function send(address,uint256,bytes32,bytes32,bytes)','function publishKey(address,uint256,uint8,uint16,bytes32,uint64)','function MAX_PAYLOAD() view returns(uint256)'],p);
out.maxPayload=String(await hub.MAX_PAYLOAD());
const endpoint=a=>'0x00000000'+196n.toString(16).padStart(16,'0')+a.slice(2).toLowerCase();
for(const len of [500,1000]){const data=hub.interface.encodeFunctionData('send',[cpu0,1,endpoint(to),ZeroHash,'0x'+'ab'.repeat(len)]);const gas=await p.estimateGas({from:holder,to:A.hub,data});out.estimates.push({type:'TapeSend synthetic encrypted-size envelope',payloadBytes:len,gas:String(gas),executionOKB:formatEther(gas*gp)});}
for(const [type,toAddress,abi,fn,args,value] of [
 ['Container opening of public unopened circuit',A.opener,['function open(address,uint256) payable returns(address)'],'open',[cpu0,3],parseEther(out.crossChecks[0].openingOKB)],
 ['One NAND mint on available processor 4',out.processors[1].transistor,['function mint(uint256,uint256) payable'],'mint',[0,1],parseEther(out.processors[1].mintPriceOKB)+parseEther(out.processors[1].protocolMintOKB)],
 ['TapeSend public key publication',A.hub,hub.interface,'publishKey',[cpu0,1,1,0,'0x'+'42'.repeat(32),4],0n],
 ['Website binding activation',A.binding,['function bind(string,address,uint256) payable'],'bind',['1.2.0.tape',container,1],0n]
 ]){try{const iface=abi instanceof Interface?abi:new Interface(abi);const gas=await p.estimateGas({from:holder,to:toAddress,data:iface.encodeFunctionData(fn,args),value});out.estimates.push({type,gas:String(gas),executionOKB:formatEther(gas*gp),simulationValueOKB:formatEther(value)});}catch(e){out.estimates.push({type,error:e.shortMessage||e.message,note:'Not included as exact gas quote; reserve allowance required.'});}}
const {seal,encodeContent}=await import(root+'/vendor/tapekit-send/index.js');
const {x25519}=await import(root+'/node_modules/@noble/curves/ed25519.js');
const key=x25519.getPublicKey(new Uint8Array(32).fill(13));
const link='https://1-2-6.tapeout.net/#'+new URLSearchParams({id:'1',claim:'0x'+'12'.repeat(32),key:'0x'+'34'.repeat(32)});
const payload=seal({content:encodeContent({subject:'SnapVault 已购图片',body:'付款已确认。此链接含查看密钥，请勿转发：\n'+link,ts:Math.floor(Date.now()/1000)}),recipients:[key],to:endpoint(to),from:endpoint(container),hub:A.hub,ref:ZeroHash,chainId:196});
const sendData=hub.interface.encodeFunctionData('send',[cpu0,1,endpoint(to),ZeroHash,payload]);
const sendGas=await p.estimateGas({from:holder,to:A.hub,data:sendData});out.estimates.push({type:'Actual production-format TAP-10 sealed dummy link',payloadBytes:payload.length,gas:String(sendGas),executionOKB:formatEther(sendGas*gp),note:'Dummy keys and illustrative URL; no customer data. URL validity not asserted.'});
try{const {Transaction}=require('ethers');const tx=Transaction.from({chainId:196,to:A.hub,data:sendData,gasLimit:sendGas,gasPrice:gp,type:0,nonce:0});const oracle=new Contract('0x420000000000000000000000000000000000000F',['function getL1Fee(bytes) view returns(uint256)'],p);out.dataFeeSample={oracle:oracle.target,unsignedDummySendL1FeeWei:String(await oracle.getL1Fee(tx.unsignedSerialized)),note:'Unsigned dummy sample only; not a guarantee for signed actual transaction or all publication transactions.'};}catch(e){out.dataFeeSample={error:e.shortMessage||e.message};}
const {loadDewebBundle}=await import(root+'/scripts/deweb-bundle.mjs');
const manifest=loadDewebBundle(root).manifest;
const ri=new Interface(['function putFile(address,string,string,bytes32,bytes)','function setFallback(address,string)']);
const cache=new Map();let total=0n;const files=[];
for(const f of manifest.files){let gas=0n;for(let offset=0;offset<f.bytes;offset+=24000){const size=Math.min(24000,f.bytes-offset);const key=size+':'+f.contentType;let g=cache.get(key);if(!g){const path='/budget-'+Date.now()+'-'+size;const data=ri.encodeFunctionData('putFile',[container,path,f.contentType,'0x'+'ab'.repeat(32),'0x'+'61'.repeat(size)]);g=await p.estimateGas({from:holder,to:A.registry,data});cache.set(key,g);}gas+=g;}total+=gas;files.push({path:f.path,bytes:f.bytes,chunks:f.chunks,gas:String(gas)});}
const fallback=await p.estimateGas({from:holder,to:A.registry,data:ri.encodeFunctionData('setFallback',[container,'/index.html'])});total+=fallback;
out.frontend={manifestSHA256:require('ethers').sha256(Buffer.from(readFileSync(root+'/dist/wallet/deweb-manifest.json'))),files,totalBytes:manifest.files.reduce((n,f)=>n+f.bytes,0),dataChunks:manifest.files.reduce((n,f)=>n+f.chunks,0),fallbackGas:String(fallback),estimatedGas:String(total),executionOKB:formatEther(total*gp),model:'Every chunk modeled as a fresh putFile with synthetic nonzero bytes and new path. Actual appendChunk has different overhead. Not an invoice; calldata source files never transmitted. eth_estimateGas uses latest, fee reads pinned to block.'};
const art=JSON.parse(readFileSync(root+'/artifacts/contracts/SnapVaultDirect.sol/SnapVaultDirect.json'));
const identity=JSON.parse(readFileSync(root+'/deployment/mainnet-service-identities.json'));
const cf=new ContractFactory(art.abi,art.bytecode);const tx=await cf.getDeployTransaction(holder,1000,A.hub,identity.operator);const dg=await p.estimateGas({...tx,from:holder});out.estimates.push({type:'Hardened SnapVaultDirect deployment',gas:String(dg),executionOKB:formatEther(dg*gp),constructorNote:'Public simulation holder as hypothetical treasury/deployer; actual owner/treasury not chosen, never test A.'});
out.budget={approvedSpend:false,roles:['Website container controlled by user','TapeSend sender C separate from operator','Demo recipient container controlled by test buyer'],freshContainers:3,assumption:'Existing processor, one NAND per newly created minimal circuit, one separate mint per circuit. Processor availability and circuit validity must be revalidated before payment. No custom processor deployment.',protocolSubtotalOKB:Object.fromEntries(out.processors.filter(c=>[4,6].includes(c.index)).map(c=>['processor'+c.index,formatEther(3n*(parseEther(out.crossChecks[0].openingOKB)+parseEther(c.tapeoutOKB)+parseEther(c.mintPriceOKB)+parseEther(c.protocolMintOKB)))])),suggestedReserveOKB:'0.30',reserveIsNotAnInvoice:true,exclusions:['Backend and independent encrypted backup storage bills','Content purchase principal (transfer to creator)','Exchange withdrawal or bridge fees','Unbounded future gas-price or protocol-fee increases'],stillUnquoted:['Actual newly minted circuit tapeout gas','Final chosen accounts and actual signed transaction data fees','Actual gallery listing, purchase and withdrawal on future mainnet contract'],ordinaryUserContainersRequired:false,tapeSendMandatory:true};
writeFileSync(root+'/deployment/deweb-tapesend-mainnet-budget.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));ps.forEach(p=>p.destroy());
