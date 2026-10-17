// Authenticated wallet/chat/direct-delivery core. No user private keys, NFT or
// container. Single-process persistent store; do not run multiple replicas.
import {randomBytes,createCipheriv,createDecipheriv,createHash,publicEncrypt,createPublicKey,constants} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {getAddress,verifyMessage,sha256,parseEther,formatEther,ZeroAddress,keccak256,Signature} from 'ethers';

const digest=x=>createHash('sha256').update(x).digest('hex');
const fail=(text,status=400)=>{throw Object.assign(Error(text),{status});};
const address=x=>{try{return getAddress(x).toLowerCase();}catch{fail('钱包地址无效');}};
const imageTypes=new Set(['image/png','image/jpeg','image/webp','image/gif']);
function checkedImage(image,mime){
 if(!imageTypes.has(mime)||typeof image!=='string'||image.length>2_800_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(image))fail('仅支持 2 MB 以内的 PNG、JPEG、WebP、GIF');
 const bytes=Buffer.from(image,'base64');if(!bytes.length||bytes.length>2*1024*1024)fail('图片大小无效');
 const real=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':/^GIF8[79]a/.test(bytes.toString('ascii',0,6))?'image/gif':null;
 if(real!==mime)fail('图片文件内容与格式不符');return bytes;
}
export class WalletService {
 constructor({provider,vault,operator,dir,origins,confirmations=1,deploymentBlock=0}){
  Object.assign(this,{provider,vault,operator,dir,origins,confirmations,deploymentBlock});mkdirSync(dir,{recursive:true,mode:0o700});
  const keyFile=resolve(dir,'master.key');if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32),{mode:0o600,flag:'wx'});
  this.master=readFileSync(keyFile);this.file=resolve(dir,'state.enc');this.state=existsSync(this.file)?JSON.parse(this.unseal(JSON.parse(readFileSync(this.file,'utf8')))): {version:1,profiles:{},friends:[],convs:[],messages:[],assets:{},products:{},opens:{},chain:null};
  this.nonces=new Map();this.sessions=new Map();this.pending=Promise.resolve();this.limits=new Map();
 }
 seal(data,key=this.master){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),ct=Buffer.concat([c.update(data),c.final()]);return {iv:iv.toString('base64'),ct:ct.toString('base64'),tag:c.getAuthTag().toString('base64')};}
 unseal(e,key=this.master){const d=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));return Buffer.concat([d.update(Buffer.from(e.ct,'base64')),d.final()]);}
 save(){writeFileSync(this.file+'.tmp',JSON.stringify(this.seal(Buffer.from(JSON.stringify(this.state)))),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
 serial(fn){const task=this.pending.catch(()=>{}).then(fn);this.pending=task;return task;}
 limit(key,max=90){const now=Date.now(),old=this.limits.get(key),v=old&&old.until>now?old:{n:0,until:now+60000};if(++v.n>max)fail('操作太频繁，请稍后再试',429);this.limits.set(key,v);if(this.limits.size>10000)for(const[k,r]of this.limits)if(r.until<now)this.limits.delete(k);}
 async config(){const chainId=Number((await this.provider.getNetwork()).chainId);if(![31337,1952].includes(chainId))fail('当前版本仅允许本地链和 X Layer 测试网，主网收款已禁用',503);return {chainId,vault:this.vault.target,abi:this.vault.interface.fragments.map(f=>f.format('full')),containerRequired:false,freeChat:true,storage:'encrypted-server-files',confirmations:this.confirmations,local:chainId===31337};}
 auth(token,origin){const s=this.sessions.get(token);if(!s||s.until<Date.now()||s.origin!==origin)fail('请连接钱包并签名登录',401);return s;}
 async challenge(b,origin){
  if(!this.origins.includes(origin))fail('网站来源不允许',403);this.limit('login:'+b.address,12);const account=address(b.address),{chainId,vault}=await this.config();
  let key;try{key=createPublicKey({key:b.publicKey,format:'jwk'});}catch{fail('浏览器交付公钥无效');}
  if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048||b.publicKey.d)fail('仅接受 RSA-2048 或以上的公开交付密钥');
  const publicKey=key.export({format:'jwk'}),keyHash='0x'+digest(JSON.stringify(publicKey)),nonce=randomBytes(24).toString('hex'),until=Date.now()+300000;
  const message=`${new URL(origin).host} wants you to sign in with your Ethereum account:\n${getAddress(account)}\n\nSign in to SnapVault and bind this browser delivery key. This is not a payment.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${new Date(until).toISOString()}\nContract: ${vault}\nDelivery Key SHA256: ${keyHash}`;
  for(const[k,v]of this.nonces)if(v.until<Date.now())this.nonces.delete(k);
  this.nonces.set(nonce,{account,origin,until,message,publicKey,keyHash});return {nonce,message,chainId,keyHash};
 }
 async login(b,origin){const n=this.nonces.get(b.nonce);if(!n||n.until<Date.now()||n.origin!==origin)fail('登录请求已过期或来源不符',401);
  this.nonces.delete(b.nonce);let recovered;try{recovered=address(verifyMessage(n.message,b.signature));}catch{fail('登录签名无效',401);}if(recovered!==n.account)fail('签名与钱包地址不符',401);
  const token=randomBytes(32).toString('hex'),s={...n,until:Date.now()+12*3600000};this.sessions.set(token,s);
  if(!this.state.profiles[n.account]){this.state.profiles[n.account]={name:n.account.slice(0,6)+'…'+n.account.slice(-4),bio:'',av:'👤',creator:false};this.save();}
  return {token,address:n.account,keyHash:n.keyHash,expires:s.until};
 }
 member(id,who){const c=this.state.convs.find(c=>c.id===id);if(!c||!c.members.includes(who))fail('无权访问此会话',403);return c;}
 visible(p,who){return p.scope==='public'||p.creator===who||p.audience.includes(who);}
 async product(id,who){const p=this.state.products[id];if(!p||!this.visible(p,who))fail('无权访问此作品',403);const c=await this.vault.contents(id);if(c.creator.toLowerCase()!==p.creator||c.blobHash!==p.hash||c.blobURI!==p.uri)fail('作品链上记录不一致',409);return {p,c};}
 async stateFor(who){
  const products=[],orders=[];for(const[id,p]of Object.entries(this.state.products)){
   if(!this.visible(p,who))continue;const {c}=await this.product(id,who);products.push({...p,id,sold:Number(c.sold)});
   if(!who)continue;const access=Number(await this.vault.accessUntil(id,who))*1000;if(access)orders.push({contentId:id,buyer:who,creator:p.creator,accessUntil:access,viewUntil:this.state.opens[`${id}:${who}`]||null,delivery:await this.confirmed(id,who)?'ready':'pending'});
  }
  const convs=this.state.convs.filter(c=>c.members.includes(who));
  return {contents:products,orders,profiles:this.state.profiles,friends:this.state.friends.filter(f=>[f.from,f.to].includes(who)),convs,messages:this.state.messages.filter(m=>convs.some(c=>c.id===m.conv)).map(({payload,...m})=>({...m,viewUntil:m.opens?.[who]||null,expired:!!(m.burn&&m.opens?.[who]&&m.opens[who]<=Date.now())})),chainId:(await this.config()).chainId};
 }
 async confirmed(id,who){
  const latest=await this.provider.getBlockNumber(),end=latest-this.confirmations+1;for(let from=this.deploymentBlock;from<=end;from+=100){const logs=await this.vault.queryFilter(this.vault.filters.DirectRequested(id,who),from,Math.min(from+99,end));if(logs.length)return true;}return false;
 }
 async handle(action,b,token,origin){
  await this.config();if(action==='challenge')return this.challenge(b,origin);if(action==='login')return this.login(b,origin);
  if(action==='state'&&!token)return this.stateFor(null);
  const s=this.auth(token,origin),who=s.account;this.limit(who);
  if(action==='logout'){this.sessions.delete(token);return {ok:true};}
  if(action==='state')return this.stateFor(who);
  if(action==='profile'){const name=String(b.name||'').trim(),bio=String(b.bio||'').trim();if(!name||name.length>20||bio.length>100)fail('昵称或简介长度无效');this.state.profiles[who]={...this.state.profiles[who],name,bio,creator:true};this.save();return {ok:true};}
  if(action==='friend'){
   const to=address(b.to);if(to===who||!this.state.profiles[to])fail('对方需要先登录 SnapVault');
   let f=this.state.friends.find(f=>[f.from,f.to].includes(who)&&[f.from,f.to].includes(to));
   if(b.accept){if(!f||f.to!==who||f.status!=='pending')fail('好友申请不存在');f.status='accepted';}
   else {if(f)fail('已是好友或申请处理中');this.state.friends.push({from:who,to,status:'pending',ts:Date.now()});}this.save();return {ok:true};
  }
  if(action==='conversation'){
   const members=[...new Set([who,...(Array.isArray(b.members)?b.members:[]).map(address)])];if(members.length<2||members.length>32)fail('请选择 1–31 位好友');
   for(const peer of members.filter(a=>a!==who))if(!this.state.friends.some(f=>f.status==='accepted'&&[f.from,f.to].includes(peer)&&[f.from,f.to].includes(who)))fail('只能邀请已接受的好友');
   if(b.gated)fail('付费群会员尚未开放');
   const existing=members.length===2&&this.state.convs.find(c=>c.type==='dm'&&c.members.length===2&&members.every(a=>c.members.includes(a)));if(existing)return existing;
   const c={id:randomBytes(16).toString('hex'),type:members.length===2?'dm':'group',name:String(b.name||'新群聊').slice(0,30),members,admin:who,ts:Date.now(),shot:'allow'};this.state.convs.push(c);this.save();return c;
  }
  if(action==='send'){
   const c=this.member(b.conv,who);this.limit('send:'+who,30);if(this.state.messages.length>=20000||this.state.messages.reduce((n,m)=>n+(m.payload?.ct.length||0),0)>64*1024*1024)fail('测试服务消息容量已满，请先扩容或清理');
   let payload,kind=b.kind==='paid-image'?'paid-image':'message';
   if(kind==='paid-image'){const {p}=await this.product(String(b.contentId),who);if(p.creator!==who||(p.scope!=='public'&&p.convId!==c.id))fail('不能向此会话发送该作品',403);}
   else {const text=String(b.text||'').trim();if(text.length>500)fail('文字超过 500 字');let image=null;if(b.image){checkedImage(b.image,b.mime);image={data:b.image,mime:b.mime};}if(!text&&!image)fail('请选择图片或输入文字');payload=this.seal(Buffer.from(JSON.stringify({text,image})));}
   const burn=kind==='message'&&!!b.burn,secs=Number(b.secs||10);if(burn&&(!Number.isInteger(secs)||secs<3||secs>3600))fail('展示时长应在 3–3600 秒');
   const m={id:randomBytes(16).toString('hex'),conv:c.id,from:who,ts:Date.now(),kind,burn,secs,shot:['allow','forbid','notify'].includes(b.shot)?b.shot:'allow',opens:{},...(kind==='paid-image'?{contentId:String(b.contentId)}:{payload})};this.state.messages.push(m);this.save();return {id:m.id};
  }
  if(action==='message-open'){
   const m=this.state.messages.find(m=>m.id===b.id);if(!m||!m.payload)fail('消息不存在');this.member(m.conv,who);
   let until=null;if(m.burn){if(who===m.from)fail('发送者不能打开限时消息');until=m.opens[who];if(until&&until<=Date.now())fail('此消息已结束展示',410);if(!until){until=Date.now()+m.secs*1000;m.opens[who]=until;this.save();}}
   return {...JSON.parse(this.unseal(m.payload)),viewUntil:until};
  }
  if(action==='upload'){
   this.limit('upload:'+who,8);if(Object.keys(this.state.assets).length>=300)fail('测试存储已满');const bytes=checkedImage(b.image,b.mime),m=b.meta||{},secs=Number(m.secs),max=Number(m.max),price=parseEther(String(m.price||'0'));
   if(!m.title?.trim()||m.title.length>40||price<=0n||price>parseEther('100')||!Number.isInteger(secs)||secs<3||secs>3600||!Number.isInteger(max)||max<0||max>1000000||typeof m.burn!=='boolean')fail('作品参数无效');
   const conv=m.convId?this.member(m.convId,who):null,key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),ct=Buffer.concat([cipher.update(bytes),cipher.final()]),blob=Buffer.concat([iv,ct,cipher.getAuthTag()]),hash=sha256(blob);
   const asset={creator:who,key:key.toString('hex'),blob:blob.toString('base64'),mime:b.mime,hash,uri:'svblob:'+hash.slice(2),meta:{title:m.title.trim(),price:formatEther(price),token:'测试 OKB',secs,max,burn:m.burn,scope:conv?.type||'public',convId:conv?.id||null,audience:conv?[...conv.members]:[],createdAt:Date.now()}};
   this.state.assets[hash]=asset;this.save();return {hash,uri:asset.uri,price:price.toString(),secs,max,burn:m.burn};
  }
  if(action==='register')return this.serial(async()=>{
   const id=String(b.id);const c=await this.vault.contents(id),a=this.state.assets[c.blobHash];if(!a||a.creator!==who||c.creator.toLowerCase()!==who||a.uri!==c.blobURI||c.price!==parseEther(a.meta.price)||Number(c.viewSeconds)!==a.meta.secs||Number(c.maxSupply)!==a.meta.max||await this.vault.ephemeral(id)!==a.meta.burn)fail('上架记录尚未确认或与上传不符',409);
   this.state.products[id]={...a.meta,creator:who,id,hash:a.hash,uri:a.uri,mime:a.mime,publishTx:b.transactionHash||null};this.save();return {product:this.state.products[id]};
  });
  if(action==='quote'){
   const {p,c}=await this.product(String(b.id),who);if(p.creator===who)fail('不能购买自己的作品');if(!c.active)fail('作品未上架');if(c.maxSupply&&c.sold>=c.maxSupply)fail('已售罄');
   if(await this.vault.accessUntil(b.id,who)!==0n)fail('已有订单，请直接查看');const a=this.state.assets[c.blobHash];if(!a?.key||sha256(Buffer.from(a.blob,'base64'))!==c.blobHash)fail('内容交付尚未就绪，不发起付款',503);
   const deadline=Number((await this.provider.getBlock('latest')).timestamp)+120,d=await this.vault.directDigest(b.id,who,s.keyHash,deadline),signature=Signature.from(this.operator.signingKey.sign(d)).serialized;
   return {id:String(b.id),keyHash:s.keyHash,deadline,signature,price:c.price.toString()};
  }
  if(action==='open')return this.serial(async()=>{
   const {p,c}=await this.product(String(b.id),who),preview=p.creator===who,accessUntil=preview?Date.now()+86400000:Number(await this.vault.accessUntil(b.id,who))*1000;
   if(!preview&&(!accessUntil||accessUntil<=Date.now()||!await this.confirmed(b.id,who)))fail('订单尚未确认或已过期',403);
   const ref=`${b.id}:${who}`;let viewUntil=null;if(p.burn){viewUntil=preview?Date.now()+p.secs*1000:this.state.opens[ref];if(viewUntil&&viewUntil<=Date.now())fail('此作品已结束展示',410);if(!viewUntil){viewUntil=Math.min(accessUntil,Date.now()+p.secs*1000);this.state.opens[ref]=viewUntil;this.save();}}
   const a=this.state.assets[c.blobHash],encryptedKey=publicEncrypt({key:createPublicKey({key:s.publicKey,format:'jwk'}),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(a.key,'hex')).toString('base64');
   return {encryptedKey,hash:p.hash,mime:a.mime,uri:'/api/wallet/blob/'+p.hash.slice(2),accessUntil,viewUntil,preview};
  });
  fail('接口不存在',404);
 }
 blob(hash){const a=this.state.assets['0x'+hash];if(!a)fail('密文不存在',404);return Buffer.from(a.blob,'base64');}
}
