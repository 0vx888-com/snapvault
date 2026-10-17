import { Contract, Interface, Wallet, keccak256, getBytes, hexlify, ZeroHash, ZeroAddress, verifyMessage, sha256, randomBytes } from 'ethers';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { seal, encodeContent, assertValidPublicKey } from '../vendor/tapekit-send/index.js';
export const HUB_ABI = [
 'function keyFor(address,uint256) view returns (tuple(address container,bytes32 endpoint,bool opened,address current,uint8 suite,uint16 keyIndex,bytes32 key,bool usable,uint32 version,uint64 chains))',
 'function accountOf(address,uint256) view returns(address)',
 'function send(address,uint256,bytes32,bytes32,bytes) returns(uint256)',
 'event Sent(bytes32 indexed to,address indexed from,bytes32 indexed ref,uint256 inboxIndex,uint256 outboxIndex,bytes payload)'
];
export const QUOTE_TYPES = { DeliveryQuote: [ {name:'id',type:'uint256'}, {name:'buyer',type:'address'}, {name:'circuits',type:'address'}, {name:'tokenId',type:'uint256'}, {name:'key',type:'bytes32'}, {name:'deadline',type:'uint256'} ] };
export const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
export function endpoint(chain,container) { return '0x00000000' + BigInt(chain).toString(16).padStart(16,'0') + container.slice(2).toLowerCase(); }
export function encryptImage(bytes) {
 const key=randomBytes(32), iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
 const blob=Buffer.concat([iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
 return {key:hexlify(key),blob,hash:sha256(blob)};
}
export function decryptImage(blob,key) { const b=Buffer.from(blob), decipher=createDecipheriv('aes-256-gcm',getBytes(key),b.subarray(0,12));decipher.setAuthTag(b.subarray(-16));return Buffer.concat([decipher.update(b.subarray(12,-16)),decipher.final()]); }
export class DeliveryService {
 constructor({provider,signer,vault,hub,implementation,implementationHash,circuits,tokenId,chainId,dir,origin,confirmations=2,fromBlock=0}) {
  Object.assign(this,{provider,signer,vault,hub,implementation,implementationHash,circuits,tokenId,chainId,dir,origin,confirmations,fromBlock});
  if (![1952,31337].includes(Number(chainId))) throw new Error('此联调服务只允许 X Layer 测试网 1952 或本地链 31337');
  if (!Number.isInteger(confirmations)||confirmations<1) throw new Error('confirmations must be positive');
  this.locks=new Map();this.hubContract=new Contract(hub,HUB_ABI,signer); mkdirSync(dir,{recursive:true,mode:0o700});
  try {this.state=JSON.parse(readFileSync(join(dir,'state.json')));} catch(e){if(e.code!=='ENOENT') throw e;this.state={assets:{},jobs:{},nonces:{},opens:{}};}
 }
 save(){const p=join(this.dir,'state.json');writeFileSync(p+'.tmp',JSON.stringify(this.state),{mode:0o600});renameSync(p+'.tmp',p);}
 async ready(){
  if (Number((await this.provider.getNetwork()).chainId)!==Number(this.chainId)) throw new Error('RPC chainId 不符');
  if (Number(this.chainId)===1952) throw new Error('官方 TapeSend 收信链表尚未登记 1952，当前禁止启用自动收款；先完成本地联调');
  const impl='0x'+(await this.provider.getStorage(this.hub,IMPL_SLOT)).slice(-40);
  if (!same(impl,this.implementation)||keccak256(await this.provider.getCode(impl))!==this.implementationHash) throw new Error('TapeSend Hub 不存在或实现与钉住版本不符，禁止收款');
  if (!same(await this.vault.deliveryHub(),this.hub)||!same(await this.vault.deliveryOperator(),this.signer.address)) throw new Error('合约与交付服务配置不符');
  const cpu=new Contract(this.circuits,['function ownerOf(uint256) view returns(address)'],this.provider);
  if (!same(await cpu.ownerOf(this.tokenId),this.signer.address)) throw new Error('自动发送账户不是发件容器 NFT 持有人');
  if (await this.provider.getBalance(this.signer.address)===0n) throw new Error('自动发送账户没有测试 gas');
 }
 challenge(address){const nonce=hexlify(randomBytes(16));this.state.nonces[address.toLowerCase()]={nonce,expires:Date.now()+300_000};this.save();return nonce;}
 uploadMessage(address,nonce,hash,manifest){return `SnapVault test upload\nOrigin: ${this.origin}\nChain: ${this.chainId}\nVault: ${this.vault.target}\nCreator: ${address}\nNonce: ${nonce}\nImage SHA256: ${hash}\nManifest SHA256: ${sha256(Buffer.from(JSON.stringify(manifest)))}`;}
 upload({address,nonce,signature,image,manifest}){
  const n=this.state.nonces[address.toLowerCase()];if (!n||n.nonce!==nonce||n.expires<Date.now()) throw new Error('上传签名已过期');
  if (!['image/png','image/jpeg','image/webp','image/gif'].includes(manifest.mime)||!manifest.title?.trim()||manifest.title.length>80||!Array.isArray(manifest.audience)||manifest.audience.length>100||manifest.audience.some(a=>!/^0x[0-9a-fA-F]{40}$/.test(a))) throw new Error('作品信息无效');
  const bytes=Buffer.from(image,'base64');if (!bytes.length||bytes.length>2*1024*1024) throw new Error('图片限 2 MB');
  if (!same(verifyMessage(this.uploadMessage(address,nonce,sha256(bytes),manifest),signature),address)) throw new Error('上传签名不符');
  const encrypted=encryptImage(bytes), assetId=encrypted.hash.slice(2);
  writeFileSync(join(this.dir,assetId+'.bin'),encrypted.blob,{mode:0o600});
  this.state.assets[assetId]={...manifest,creator:address,key:encrypted.key,hash:encrypted.hash};delete this.state.nonces[address.toLowerCase()];this.save();
  return {hash:encrypted.hash,uri:`${this.origin}/api/blob/${assetId}`};
 }
 async asset(id){const c=await this.vault.contents(id),a=this.state.assets[c.blobHash.slice(2)];if (!a||!same(c.creator,a.creator)||c.blobURI!==`${this.origin}/api/blob/${c.blobHash.slice(2)}`||c.token!==ZeroAddress) throw new Error('作品未接入本交付服务或不是原生测试 OKB 定价');const blob=readFileSync(join(this.dir,c.blobHash.slice(2)+'.bin'));if(sha256(blob)!==c.blobHash)throw new Error('密文缺失或损坏，禁止付款');return {c,a};}
 async quote({id,buyer,circuits,tokenId}){
  await this.ready();const {c,a}=await this.asset(id);
  if(same(buyer,c.creator))throw new Error('创作者不能购买自己的作品');
  if (!c.active||(c.maxSupply!==0n&&c.sold>=c.maxSupply)||await this.vault.accessUntil(id,buyer)!==0n) throw new Error('已购买、已下架或售罄');
  if (a.audience.length&&!a.audience.some(x=>same(x,buyer))) throw new Error('不是此作品的指定买家');
  const r=await this.hubContract.keyFor(circuits,tokenId);
  if (!r.opened||!r.usable||r.suite!==1n||!same(r.current,buyer)||r.endpoint!==endpoint(this.chainId,r.container)) throw new Error('买家需要持有同链已开通容器，并在官方 TapeSend 发布可用公钥');
  // X Layer's receiving-chain bit is index 2. Local fixture uses bit 0 only for tests.
  if (!(r.chains & (this.chainId===1952?4n:1n))) throw new Error('收件方没有启用此发送链；官方 SDK 尚未登记 1952');
  assertValidPublicKey(getBytes(r.key));
  const from=endpoint(this.chainId,await this.hubContract.accountOf(this.circuits,this.tokenId));
  const probe=seal({content:encodeContent({body:'SnapVault readiness probe'}),recipients:[getBytes(r.key)],to:r.endpoint,from,hub:this.hub,chainId:this.chainId});
  await this.hubContract.send.staticCall(this.circuits,this.tokenId,r.endpoint,ZeroHash,probe);
  const gas=await this.hubContract.send.estimateGas(this.circuits,this.tokenId,r.endpoint,ZeroHash,probe), fees=await this.provider.getFeeData();
  if(await this.provider.getBalance(this.signer.address)<gas*(fees.maxFeePerGas||fees.gasPrice||1n)*2n)throw new Error('自动交付账户测试 gas 余量不足');
  const deadline=Number((await this.provider.getBlock('latest')).timestamp)+120;
  const value={id:String(id),buyer,circuits,tokenId:String(tokenId),key:r.key,deadline};
  const signature=await this.signer.signTypedData({name:'SnapVaultCheckout',version:'1',chainId:this.chainId,verifyingContract:this.vault.target},QUOTE_TYPES,value);
  return {...value,signature,price:c.price.toString(),hub:this.hub};
 }
 serialize(name,fn){const previous=this.locks.get(name)||Promise.resolve();const current=previous.catch(()=>{}).then(fn);this.locks.set(name,current);return current.finally(()=>{if(this.locks.get(name)===current)this.locks.delete(name);});}
 deliver(id,buyer){return this.serialize('delivery',()=>this._deliver(id,buyer));}
 async _deliver(id,buyer){
  await this.ready();const route=await this.vault.recipient(id,buyer);if(route===ZeroHash)throw new Error('没有链上购买路由');
  const {c,a}=await this.asset(id), ref=keccak256(Buffer.from(`${this.chainId}:${this.vault.target.toLowerCase()}:${id}:${buyer.toLowerCase()}`));
  const request=(await this.vault.queryFilter(this.vault.filters.DeliveryRequested(id,buyer),this.fromBlock)).at(-1);
  if(!request)throw new Error('没有已确认购买事件');
  const tip=await this.provider.getBlockNumber();if(tip-request.blockNumber+1<this.confirmations)throw new Error('等待付款确认');
  const access=await this.vault.accessUntil(id,buyer),block=await this.provider.getBlock('latest');if(BigInt(block.timestamp)>=access)throw new Error('购买资格已过期，停止首次投递');
  const sender=await this.hubContract.accountOf(this.circuits,this.tokenId);
  const sent=(await this.hubContract.queryFilter(this.hubContract.filters.Sent(route,sender,ref),this.fromBlock)).at(-1);
  if(sent){this.state.jobs[ref]={...this.state.jobs[ref],id:String(id),buyer,status:'sent',tx:sent.transactionHash};this.save();return this.state.jobs[ref];}
  const job=this.state.jobs[ref];if(job?.raw){const tx=await this.provider.getTransactionReceipt(job.tx);if(tx?.status===0)throw new Error('交付交易失败，需人工处理');if(!tx)await this.provider.broadcastTransaction(job.raw);return {...job,status:tx?'sent':'pending'};}
  const r=await this.hubContract.keyFor(request.args.circuits,request.args.tokenId);
  if(!r.opened||!r.usable||!same(r.current,buyer)||r.key!==request.args.key||r.endpoint!==route)throw new Error('收件公钥或持有人变化；停止投递，需人工处理');
  const claim=hexlify(randomBytes(32)), key=a.key;
  // Fragment never sent in an HTTP request. It is delivered only inside sealed TapeSend content.
  const url=`${this.origin}/live.html#id=${id}&claim=${claim}&key=${key}`;
  const payload=seal({content:encodeContent({subject:'SnapVault 已购图片',body:`付款已确认。打开此链接查看图片（链接含查看密钥，请勿转发）：\n${url}`,ts:Math.floor(Date.now()/1000)}),recipients:[getBytes(r.key)],to:route,from:endpoint(this.chainId,sender),hub:this.hub,ref,chainId:this.chainId});
  const nonce=Number(BigInt(await this.provider.send('eth_getTransactionCount',[this.signer.address,'pending'])));
  const tx=await this.signer.populateTransaction({...await this.hubContract.send.populateTransaction(this.circuits,this.tokenId,route,ref,payload),nonce});
  const raw=await this.signer.signTransaction(tx);this.state.jobs[ref]={id:String(id),buyer,status:'pending',raw,tx:keccak256(raw),claimHash:sha256(getBytes(claim)),accessUntil:Number(access)};this.save();
  await this.provider.broadcastTransaction(raw);return this.state.jobs[ref];
 }
 async scan(){await this.ready();const events=await this.vault.queryFilter(this.vault.filters.DeliveryRequested(),this.fromBlock);for(const e of events){try{await this.deliver(e.args.id,e.args.buyer);}catch(error){console.error(`交付 ${e.args.id}: ${error.message}`);}}}
 open(id,claim){return this.serialize('open:'+claim,()=>this._open(id,claim));}
 async _open(id,claim){
  const hash=sha256(getBytes(claim)),job=Object.values(this.state.jobs).find(j=>j.id===String(id)&&j.claimHash===hash);
  if(!job)throw new Error('查看凭证不符');
  const receipt=await this.provider.getTransactionReceipt(job.tx);if(!receipt||receipt.status!==1)throw new Error('交付尚未确认');
  const {c,a}=await this.asset(id), now=Date.now(),accessUntil=job.accessUntil*1000;
  if(now>=accessUntil)throw new Error('购买资格已过期');
  const until=this.state.opens[hash]||Math.min(accessUntil,now+Number(c.viewSeconds)*1000);
  const burn=await this.vault.ephemeral(id);if(burn&&now>=until)throw new Error('展示已结束');
  if(!this.state.opens[hash]){this.state.opens[hash]=until;this.save();}
  return {uri:c.blobURI,hash:c.blobHash,mime:a.mime,viewUntil:burn?until:accessUntil,burn,title:a.title};
 }
}
