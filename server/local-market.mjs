// Deliberately unauthenticated role switching for loopback-only Hardhat demos.
// Never register these routes for public-chain or production deployments.
import {getBytes,ZeroAddress,sha256,formatEther,parseEther,keccak256} from 'ethers';
import {endpoint} from './delivery.mjs';
import {openPayload,decodeContent} from '../vendor/tapekit-send/index.js';
export function localMarket({service,vault,hub,fixture,roles,keys}) {
 const products=new Map(),pending=new Map();
 const role=who=>{const r=roles.get(who);if(!r)throw Error('仅支持本地测试身份');return r;};
 const serialize=(name,fn)=>{const task=(pending.get(name)||Promise.resolve()).catch(()=>{}).then(fn);pending.set(name,task);return task.finally(()=>{if(pending.get(name)===task)pending.delete(name);});};
 async function guard(){if(Number((await service.provider.getNetwork()).chainId)!==31337)throw Error('仅允许本地链 31337');await service.ready();}
 async function state(who){
  const r=role(who),items=[],orders=[];
  for(const [id,meta] of products){
   if(meta.creator!==who&&meta.scope!=='public'&&!meta.audience.includes(who))continue;
   const c=await vault.contents(id);items.push({...meta,id,sold:Number(c.sold),hash:c.blobHash,uri:c.blobURI,localChain:true});
   const access=Number(await vault.accessUntil(id,r.signer.address));if(!access)continue;
   const ref=keccak256(Buffer.from(`31337:${vault.target.toLowerCase()}:${id}:${r.signer.address.toLowerCase()}`)),job=service.state.jobs[ref];
   const receipt=job?.tx?await service.provider.getTransactionReceipt(job.tx):null;
   orders.push({contentId:id,buyer:who,creator:meta.creator,accessUntil:access*1000,viewUntil:job?.claimHash?service.state.opens[job.claimHash]||null:null,delivery:receipt?.status===1?'ready':'pending',deliveryTx:job?.tx||null,localChain:true});
  }
  return {ready:true,chainId:31337,scope:'local-only',vault:vault.target,contents:items,orders};
 }
 return async function handle(action,b){
  await guard();const r=role(b.who);
  if(action==='state')return state(b.who);
  if(action==='publish')return serialize('publish',async()=>{
   const m=b.meta;if(!m||!['public','dm','group'].includes(m.scope)||!Array.isArray(m.audience)||m.audience.length>100||m.audience.some(a=>!roles.has(a))||!Number.isInteger(m.secs)||m.secs<3||m.secs>3600||!Number.isInteger(m.max)||m.max<0||m.max>1000000||typeof m.burn!=='boolean'||!m.title?.trim()||m.title.length>40)throw Error('发布参数无效');
   if(m.scope!=='public'&&(!m.convId||!m.audience.includes(b.who)||m.audience.length<2))throw Error('缺少会话成员');
   const price=parseEther(String(m.price));if(price<=0n||price>parseEther('100'))throw Error('测试价格需大于 0 且不超过 100');
   const manifest={title:m.title,mime:m.mime,audience:m.scope==='public'?[]:m.audience.map(a=>role(a).signer.address)};
   const nonce=service.challenge(r.signer.address),bytes=Buffer.from(b.image||'','base64');
   const signature=await r.signer.signMessage(service.uploadMessage(r.signer.address,nonce,sha256(bytes),manifest));
   const upload=service.upload({address:r.signer.address,nonce,signature,image:b.image,manifest});
   const tx=await vault.connect(r.signer).listWithOptions(ZeroAddress,price,m.secs,m.max,upload.hash,upload.uri,m.burn),receipt=await tx.wait();
   const event=receipt.logs.map(l=>{try{return vault.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Listed');
   const id=event.args.id.toString(),meta={title:m.title,price:formatEther(price),token:'测试 OKB',creator:b.who,scope:m.scope,convId:m.convId||null,audience:m.scope==='public'?[]:m.audience,secs:m.secs,max:m.max,burn:m.burn,mime:m.mime,showPreview:false,thumb:'',createdAt:Date.now(),publishTx:tx.hash};products.set(id,meta);
   return {product:{...meta,id,hash:upload.hash,uri:upload.uri,sold:0,localChain:true},...(await state(b.who))};
  });
  const id=String(b.id),meta=products.get(id);if(!meta)throw Error('作品不存在');
  if(meta.creator!==b.who&&meta.scope!=='public'&&!meta.audience.includes(b.who))throw Error('此作品未向当前测试身份开放');
  if(action==='purchase')return serialize('purchase:'+id+':'+b.who,async()=>{
   if(meta.creator===b.who)throw Error('不能购买自己的作品');
   if(await vault.accessUntil(id,r.signer.address)!==0n)return state(b.who);
   const q=await service.quote({id,buyer:r.signer.address,circuits:fixture.target,tokenId:r.tokenId});
   const tx=await vault.connect(r.signer).purchaseDelivered(id,fixture.target,r.tokenId,q.key,q.deadline,q.signature,{value:q.price});await tx.wait();
   // No manual delivery call: the shared background scanner must deliver it.
   return {purchaseTx:tx.hash,...(await state(b.who))};
  });
  if(action==='open'){
   if(meta.creator===b.who){const c=await vault.contents(id),a=service.state.assets[c.blobHash.slice(2)];return {key:a.key,uri:c.blobURI,hash:c.blobHash,mime:a.mime,preview:true,accessUntil:Date.now()+86400000,viewUntil:meta.burn?Date.now()+meta.secs*1000:null};}
   const route=await vault.recipient(id,r.signer.address),sender=await hub.accountOf(fixture.target,1),ref=keccak256(Buffer.from(`31337:${vault.target.toLowerCase()}:${id}:${r.signer.address.toLowerCase()}`));
   const sent=(await hub.queryFilter(hub.filters.Sent(route,sender,ref))).at(-1);if(!sent)throw Error('密钥仍在自动交付，请稍后再试');
   const message=decodeContent(openPayload({payload:getBytes(sent.args.payload),secretKey:keys.get(b.who).secretKey,to:route,from:endpoint(31337,sender),hub:hub.target,ref,chainId:31337}).content);
   const link=new URL(message.body.split('\n').at(-1)),params=new URLSearchParams(link.hash.slice(1)),opened=await service.open(id,params.get('claim'));
   return {...opened,key:params.get('key'),accessUntil:Number(await vault.accessUntil(id,r.signer.address))*1000,viewUntil:opened.burn?opened.viewUntil:null,deliveryTx:sent.transactionHash};
  }
  throw Error('本地测试接口不存在');
 };
}
