// Retired: prior approval is consumed. No RPC, wallet request or server startup.
throw new Error('Publisher retired after final wallet fee review failure; read-only audit only.');
// One approved file only. No signer/private key; global spending pause stays in place.
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Contract,Interface,sha256,formatEther} from 'ethers';
import {loadFrozenRelease} from './freeze-release.mjs';
import {REGISTRY_ABI} from './deweb-bundle.mjs';
import {XLAYER_REGISTRY,XLAYER_REGISTRY_IMPL,IMPL_SLOT} from './release-check.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),review=JSON.parse(fs.readFileSync(path.join(root,'deployment/remove-illustration-credit-cost.json')));
const approved=95000000000000n;
if(review.approvalGranted!==true||review.approvedBudgetWei!==String(approved)||review.chainId!==196||review.operations.length!==1||review.operations[0].path!=='index.html')throw Error('Explicit scoped approval for one index.html transaction required');
const bundle=loadFrozenRelease(root,review.release.directory),file=bundle.files.find(f=>f.path==='index.html'),op=review.operations[0],iface=new Interface(REGISTRY_ABI);
if(!file||file.bytes.length>=24000||review.owner.toLowerCase()!=='0xeb55b0f0a274a72b940c10078fb46b998b53b100'||review.container.toLowerCase()!=='0x618cbe9dc6ab45f7cfa0c404f3e8c9afcfedf06e'||op.to.toLowerCase()!==XLAYER_REGISTRY||op.value!=='0x0'||op.data!==iface.encodeFunctionData('putFile',[review.container,'index.html',file.contentType,file.sha256,file.bytes]))throw Error('Scoped transaction identity mismatch');
const baseline=JSON.parse(fs.readFileSync(path.join(root,'releases',review.baseRelease,'release.json'))),old=baseline.files.find(f=>f.path==='index.html');
const providers=['https://rpc.xlayer.tech','https://xlayer.drpc.org'].map(url=>new JsonRpcProvider(url,196,{staticNetwork:true,batchMaxCount:1}));
const progressFile=path.join(root,'deployment/remove-illustration-credit-upload-progress.json');
let progress=fs.existsSync(progressFile)?JSON.parse(fs.readFileSync(progressFile)):{identity:review.release.manifestHash,spentWei:'0',receipts:[],attempts:{}};
if(progress.identity!==review.release.manifestHash)throw Error('Progress identity mismatch');
function save(){fs.writeFileSync(progressFile+'.tmp',JSON.stringify(progress,null,2)+'\n');fs.renameSync(progressFile+'.tmp',progressFile);}
async function verify(expected,all=true){const results=[];for(const p of providers){const block=await p.getBlockNumber(),c=new Contract(XLAYER_REGISTRY,REGISTRY_ABI,p);for(const f of all?bundle.files:[file]){const want=f.path==='index.html'?expected:baseline.files.find(x=>x.path===f.path);if(!want)throw Error('Unexpected release file');const info=await c.fileInfo(review.container,f.path,{blockTag:block});const size=want.bytes?.length??want.bytes;if(Number(info[0])!==size||info[2]!==want.sha256||info[4]===0n)throw Error('File metadata mismatch: '+f.path);if(f.path==='index.html'){const bytes=await c.readRange(review.container,f.path,0,size,{blockTag:block});if(sha256(bytes)!==want.sha256)throw Error('index.html complete-byte mismatch');}}results.push({rpc:p._getConnection().url,block,homepageSHA256:expected.sha256,otherFilesMetadataVerified:all?20:0});}return results;}
for(const p of providers){if(Number(BigInt(await p.send('eth_chainId',[])))!==196||('0x'+(await p.getStorage(XLAYER_REGISTRY,IMPL_SLOT)).slice(-40)).toLowerCase()!==XLAYER_REGISTRY_IMPL)throw Error('Chain or registry implementation changed');}
const cpu=new Contract('0x90b3ba18C32E9E9e6EA5E2ccA3E68B86AFBE7cDB',['function ownerOf(uint256) view returns(address)'],providers[0]);if((await cpu.ownerOf(10)).toLowerCase()!==review.owner.toLowerCase())throw Error('Container holder changed');
const c=new Contract(XLAYER_REGISTRY,REGISTRY_ABI,providers[0]),current=await c.fileInfo(review.container,'index.html');
if(current[2]===file.sha256){progress.skippedAlreadyPresent=true;progress.proof=await verify(file);save();}else{await verify(old);}
const port=5266,origin='http://127.0.0.1:'+port;
let planning=false;
async function plan(){
 if(progress.receipts.length||progress.skippedAlreadyPresent)return{complete:true,total:1,spentOKB:formatEther(progress.spentWei),owner:review.owner};
 if(planning)throw Error('Preflight already running');planning=true;try{
 await verify(old,false);
 const counts=await Promise.all(providers.map(async p=>({pending:BigInt(await p.send('eth_getTransactionCount',[review.owner,'pending'])),latest:BigInt(await p.send('eth_getTransactionCount',[review.owner,'latest']))})));
 if(counts[0].pending!==counts[1].pending||counts[0].latest!==counts[1].latest)throw Error('Nonce readers disagree; stop, do not resend');
 let attempt=progress.attempts[0];if(!attempt){if(counts[0].pending!==counts[0].latest)throw Error('Wallet has pending transaction');attempt={nonce:'0x'+counts[0].latest.toString(16)};progress.attempts[0]=attempt;save();}
 if(counts[0].pending>BigInt(attempt.nonce))return{identity:progress.identity,recoveryRequired:true,index:0,total:1,owner:review.owner,chainId:196,path:'index.html',chunk:0,valueOKB:'0',maximumFeeOKB:'0.000095',spentOKB:formatEther(progress.spentWei)};
 if(counts[0].latest!==BigInt(attempt.nonce))throw Error('Reserved nonce unavailable');
 const estimates=await Promise.all(providers.map(async p=>({gas:await p.estimateGas({from:review.owner,to:op.to,data:op.data,value:0n}),price:BigInt(await p.send('eth_gasPrice',[]))})));
 const gas=(estimates.reduce((a,r)=>r.gas>a?r.gas:a,0n)*125n+99n)/100n,price=estimates.reduce((a,r)=>r.price>a?r.price:a,0n);
 if(gas>BigInt(review.gasLimit)||price>BigInt(review.gasPriceCapWei)||gas*price>approved)throw Error('Exact upload exceeds approved gas/price/total cap; stopped');
 attempt.gasLimit=String(gas);attempt.gasPrice=String(price);save();
 return{identity:progress.identity,index:0,total:1,owner:review.owner,chainId:196,path:'index.html',chunk:0,valueOKB:'0',maximumFeeOKB:formatEther(gas*price),spentOKB:formatEther(progress.spentWei),transaction:{from:review.owner,to:op.to,data:op.data,value:'0x0',nonce:attempt.nonce,gas:'0x'+gas.toString(16),type:'0x2',maxFeePerGas:'0x'+price.toString(16),maxPriorityFeePerGas:'0x1'}};
 }finally{planning=false;}
}
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const server=createServer(async(req,res)=>{try{
 if(req.headers.host!==`127.0.0.1:${port}`||(req.headers.origin&&req.headers.origin!==origin))return send(res,403,{error:'Local origin only'});
 if(req.method==='GET'&&req.url==='/api/plan')return send(res,200,await plan());
 if(req.method==='POST'&&['/api/receipt','/api/verify'].includes(req.url)){
 if(req.headers.origin!==origin)throw Error('Exact origin required');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000)throw Error('Body too large');}
 if(req.url==='/api/verify'){if(!progress.receipts.length&&!progress.skippedAlreadyPresent)throw Error('No successful upload');progress.proof=await verify(file);save();return send(res,200,{url:'https://10-2-6.tapekit.org/'});}
 const{hash,index}=JSON.parse(raw);if(index!==0||!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Invalid receipt input');
 if(progress.receipts.length){if(progress.receipts[0].hash!==hash)throw Error('Different transaction already recorded');return send(res,200,{verified:true});}
 const p=providers[0],[tx,r]=await Promise.all([p.getTransaction(hash),p.getTransactionReceipt(hash)]);if(!tx||!r)return send(res,202,{pending:true});const a=progress.attempts[0];
 if(!a||tx.chainId!==196n||tx.nonce!==Number(BigInt(a.nonce))||tx.from.toLowerCase()!==review.owner.toLowerCase()||tx.to?.toLowerCase()!==op.to.toLowerCase()||tx.data!==op.data||tx.value!==0n||(tx.maxFeePerGas??tx.gasPrice)>BigInt(review.gasPriceCapWei)||tx.gasLimit*(tx.maxFeePerGas??tx.gasPrice)>approved||r.fee>approved)throw Error('Receipt or approved transaction bounds mismatch');
 progress.broadcastHash=hash;save();if(r.status!==1){progress.failed=true;save();throw Error('Transaction reverted; stop without retry');}
 progress.receipts=[{hash,index:0,block:r.blockNumber,gasLimit:String(tx.gasLimit),requestedGasLimit:review.gasLimit,walletAdjustedGasLimit:tx.gasLimit>BigInt(review.gasLimit),maximumSignedFeeWei:String(tx.gasLimit*(tx.maxFeePerGas??tx.gasPrice)),gasUsed:String(r.gasUsed),gasPriceWei:String(r.gasPrice),feeWei:String(r.fee)}];progress.spentWei=String(r.fee);save();return send(res,200,{verified:true});
 }
 if(req.method!=='GET'||!['/','/publish-deweb.js'].includes(req.url))return send(res,404,{error:'Not found'});
 const html='<!doctype html><meta charset="utf-8"><title>SnapVault 单文件修复</title><style>body{font:18px/1.7 system-ui;max-width:850px;margin:40px auto;background:#171a17;color:#eee;padding:24px}button{padding:14px;background:#e5ed81;margin:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>仅删除首页插画说明</h1><p>X Layer 主网 · 10.2.6.tape · 仅 1 笔，最高 0.000095 OKB。其余文件不上传。</p><pre id="plan"></pre><button id="send">钱包预览这一笔</button><button id="verify">核对 index.html 和其余文件</button><pre id="log"></pre><script type="module" src="publish-deweb.js"></script>';
 const script=fs.readFileSync(path.join(root,'web/publish-deweb.js'),'utf8').replace('两家独立 RPC 已核验全部字节及哈希。','两家独立 RPC 已核验 index.html 完整字节和哈希、其余 20 文件元数据。');res.writeHead(200,{'Content-Type':req.url==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(req.url==='/'?html:script);
 }catch(e){send(res,400,{error:e.message});}});
server.listen(port,'127.0.0.1',()=>console.log('SCOPED index.html-only publisher ready '+origin+'; one human-confirmed transaction max 0.000095 OKB'));
for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>server.close(()=>{providers.forEach(p=>p.destroy());process.exit(0);}));
