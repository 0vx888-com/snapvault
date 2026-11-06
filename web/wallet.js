export const API_VERSION='view-ledger-v2';
export const VAULT_ADDRESS = "0xFd9b25442955C09007abB2D10dEcD24b4d2CF83f";
export const CHAIN_ID = 196;
export function assertTrustedVault(config){
 if(config?.apiVersion!==API_VERSION){wallet.securityError='前后端版本不一致，请刷新；未开放付款';throw Error(wallet.securityError);}
 if(config?.chainId!==CHAIN_ID||String(config?.vault||'').toLowerCase()!==VAULT_ADDRESS.toLowerCase()){
  const message='安全警告：服务器返回的合约地址或网络与固定的 X Layer 主网合约不一致，已禁止交易';
  wallet.securityError=message;throw Error(message);
 }
}
import {guardedTransaction} from './transaction-guard.js';
import {selectProvider} from './wallet-connect.js';
// Wallet mode is opt-in in development, the default for the deployable app build.
let settings={};
if(typeof location!=='undefined'){
 try{const r=await fetch(new URL('./app-config.json',import.meta.url),{signal:AbortSignal.timeout(10000)});if(r.ok)settings=await r.json();}catch{/* existing demo remains usable without a deployment config */}
}
export const wallet={enabled:typeof location!=='undefined'&&(settings.mode==='wallet'||new URLSearchParams(location.search).get('delivery')==='wallet'),preview:settings.mode==='preview',base:settings.apiBase||'',account:typeof sessionStorage!=='undefined'&&sessionStorage.getItem('sv:wallet-session')?sessionStorage.getItem('sv:wallet-account'):null,token:typeof sessionStorage!=='undefined'?sessionStorage.getItem('sv:wallet-session'):null,data:{contents:[],orders:[],profiles:{},convs:[],messages:[],friends:[]},config:null,ready:false,device:null};
export const apiURL=path=>new URL((wallet.base?wallet.base.replace(/\/$/,''):'')+path,location.href).href;
export async function call(action,body={}){
 if(!wallet.enabled)throw Error('钱包模式未启用');const r=await fetch(apiURL('/api/wallet/'+action),{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-SnapVault-Client':API_VERSION,...(wallet.token?{Authorization:'Bearer '+wallet.token}:{})},body:JSON.stringify(body)}),d=await r.json();
 if(r.headers.get('X-SnapVault-API')!==API_VERSION){wallet.ready=false;throw Error('前后端版本不一致，请刷新；未发送交易');}
 if(!r.ok){if(r.status===401)disconnect(false);throw Object.assign(Error(d.error||'服务暂不可用'),{status:r.status});}return d;
}
async function device(){
 if(wallet.device)return wallet.device;const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('snapvault-device',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const value=await new Promise((resolve,reject)=>{const r=db.transaction('keys').objectStore('keys').get('delivery');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 if(value){wallet.device=value;db.close();return value;}
 const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
 const result={privateKey:pair.privateKey,publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey)};
 await new Promise((resolve,reject)=>{const t=db.transaction('keys','readwrite');t.objectStore('keys').put(result,'delivery');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();wallet.device=result;return result;
}
async function ethersModule(){return import('./vendor/ethers.min.js');}
function provider(){const p=window.okxwallet||window.ethereum;if(!p?.request)throw Error('请用装有 OKX Wallet 或兼容钱包的浏览器打开');return p;}
let injected,subscriptions=false,revision=0,connecting=false;
const accountChanged=()=>disconnect();const networkChanged=()=>window.dispatchEvent(new Event('snapvault:network'));

export const SERVER_UNAVAILABLE='暂时连不上服务器，请检查网络或开启代理后刷新';
export async function connect(){
 if(!wallet.ready||!wallet.config)throw Error(SERVER_UNAVAILABLE);
 if(connecting)throw Error('正在等待钱包，请勿重复连接');connecting=true;try{
 if(injected&&subscriptions){injected.removeListener?.('accountsChanged',accountChanged);injected.removeListener?.('chainChanged',networkChanged);injected.removeListener?.('disconnect',accountChanged);subscriptions=false;}
 injected=await selectProvider(wallet.config);const accounts=await injected.request({method:'eth_requestAccounts'});if(!accounts[0])throw Error('钱包没有返回账户');
 const d=await device(),q=await call('challenge',{address:accounts[0],publicKey:d.publicKey});
 const text='0x'+[...new TextEncoder().encode(q.message)].map(x=>x.toString(16).padStart(2,'0')).join('');
 const signature=await injected.request({method:'personal_sign',params:[text,accounts[0]]}),result=await call('login',{nonce:q.nonce,signature});
 wallet.account=result.address;wallet.token=result.token;sessionStorage.setItem('sv:wallet-session',result.token);sessionStorage.setItem('sv:wallet-account',result.address);
 if(!subscriptions&&injected.on){injected.on('accountsChanged',accountChanged);injected.on('chainChanged',networkChanged);injected.on('disconnect',accountChanged);subscriptions=true;}
 window.dispatchEvent(new Event('snapvault:identity'));await refresh();
 }catch(e){if(injected?.remote){await injected.disconnect().catch(()=>{});injected=null;}throw e;}finally{connecting=false;}
}
export function disconnect(revoke=true){if(revoke&&wallet.token)call('logout').catch(()=>{});revision++;wallet.token=null;wallet.account=null;wallet.device=null;sessionStorage.removeItem('sv:wallet-session');sessionStorage.removeItem('sv:wallet-account');wallet.data={contents:[],orders:[],profiles:{},convs:[],messages:[],friends:[]};window.dispatchEvent(new Event('snapvault:identity'));}
export async function refresh(){const rev=++revision;const d=await call('state');if(rev!==revision)return;wallet.data=d;if(wallet.token)wallet.account=sessionStorage.getItem('sv:wallet-account');window.dispatchEvent(new Event('snapvault:change'));}
export async function initWallet(){
 wallet.ready=false;wallet.config=null;wallet.securityError=null;
 const r=await fetch(apiURL('/api/wallet/config'),{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(SERVER_UNAVAILABLE);
 const config=await r.json();assertTrustedVault(config);if(config.apiVersion!==API_VERSION)throw Error('前后端版本不一致，请刷新；未开放付款');const allowed=settings.allowedChainIds||[31337,1952];if(!allowed.includes(config.chainId))throw Error('后端链号不在本前端允许配置中');if(config.chainId===196&&(!settings.allowMainnet||!config.mainnet))throw Error('主网需前后端明确授权配置');
 wallet.config=config;await device();try{await refresh();}catch(e){
  // Expired login is cleared by call(); keep the page usable as a signed-out visitor.
  // Only retry public state after a 401. Network/server failures still stay visible.
  if(e.status!==401||wallet.token)throw e;await refresh();
 }wallet.ready=true;
}
async function transaction(method,args,value=0n){
 if(wallet.config?.testMode)throw Error("本地真机测试不支持钱包付款或链上操作");
 if(!wallet.ready||!wallet.config)throw Error(SERVER_UNAVAILABLE);
 assertTrustedVault(wallet.config);
 if(!wallet.account)throw Error('请先签名登录');const p=injected||await selectProvider(wallet.config);injected=p;
 const chain=Number(BigInt(await p.request({method:'eth_chainId'})));if(chain!==CHAIN_ID)throw Error('请切换到 X Layer 主网（196）；未发送交易');
 if(chain===196&&(!settings.allowMainnet||!wallet.config.mainnet))throw Error('主网配置尚未明确启用');
 const accounts=await p.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==wallet.account)throw Error('钱包账户已变化');
 const {Interface,JsonRpcProvider}=await ethersModule(),iface=new Interface(wallet.config.abi),data=iface.encodeFunctionData(method,args),rpc=new JsonRpcProvider(chain===31337?apiURL('/rpc'):chain===1952?'https://testrpc.xlayer.tech/terigon':'https://rpc.xlayer.tech',chain,{staticNetwork:true});
 const key=['sv:pending',chain,VAULT_ADDRESS.toLowerCase(),wallet.account,method,method.startsWith('purchase')?String(args[0]):''].join(':');
 try{const result=await guardedTransaction({key,send:async()=>{await verifyServerVersion();assertTrustedVault(wallet.config);if(Number(BigInt(await p.request({method:'eth_chainId'})))!==CHAIN_ID)throw Error('请切换到 X Layer 主网（196）；未发送交易');return p.request({method:'eth_sendTransaction',params:[{from:accounts[0],to:VAULT_ADDRESS,chainId:'0x'+CHAIN_ID.toString(16),data,value:'0x'+BigInt(value).toString(16)}]});},wait:hash=>rpc.waitForTransaction(hash,wallet.config.confirmations||1,180000)});return {...result,iface};}finally{rpc.destroy();}
}
export async function publishWallet({image,meta}){const upload=await call('upload',{image,mime:meta.mime,meta}),{hash,receipt,iface}=await transaction('listWithOptions',['0x0000000000000000000000000000000000000000',upload.price,upload.secs,upload.max,upload.hash,upload.uri,upload.burn]);const event=receipt.logs.map(l=>{try{return iface.parseLog(l)}catch{return null}}).find(e=>e?.name==='Listed');if(!event)throw Error('没有找到上架事件');const result=await call('register',{id:event.args.id.toString(),transactionHash:hash});await refresh();return result;}
export async function purchaseWallet(id){await verifyServerVersion();const q=await call('quote',{id});window.dispatchEvent(new CustomEvent('snapvault:delivery-route',{detail:q.notice||'本单将通过官方 TapeSend 自动交付'}));const {hash}=q.method==='purchaseDelivered'?await transaction('purchaseDelivered',[id,q.circuits,q.tokenId,q.key,q.deadline,q.signature],q.price):await transaction('purchaseDirect',[id,q.keyHash,q.deadline,q.signature],q.price);await refresh();return {purchaseTx:hash,route:q.route};}
export async function withdrawWallet(){await verifyServerVersion();assertTrustedVault(wallet.config);const e=await call('earnings');if(/^0(?:\.0*)?$/.test(e.amount)&&!localStorage.getItem(['sv:pending',wallet.config.chainId,VAULT_ADDRESS.toLowerCase(),wallet.account,'withdraw',''].join(':')))throw Error('当前可提现余额为 0，未发起钱包交易');const {hash}=await transaction('withdraw',['0x0000000000000000000000000000000000000000']);await refresh();return hash;}
export async function openWallet(id){const d=await call('open',{id});if(!d.preview){const receipt=wallet.data.orders.find(o=>String(o.contentId)===String(id)&&o.buyer===wallet.account);if(receipt){receipt.accessUntil=d.accessUntil;receipt.viewUntil=d.viewUntil;}}const privateKey=(await device()).privateKey;const raw=new Uint8Array(await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,Uint8Array.from(atob(d.encryptedKey),c=>c.charCodeAt(0))));return {...d,key:'0x'+[...raw].map(x=>x.toString(16).padStart(2,'0')).join(''),uri:apiURL(d.uri)};}
export async function walletAction(action,b){const d=await call(action,b);await refresh();return d;}

export async function setupNetwork(){
 if(!wallet.config||![31337,1952,196].includes(wallet.config.chainId)||(wallet.config.chainId===196&&(!settings.allowMainnet||!wallet.config.mainnet)))throw Error('网络授权配置未就绪');
 assertTrustedVault(wallet.config);const p=injected||provider(),chainId='0x'+CHAIN_ID.toString(16);
 try{await p.request({method:'wallet_switchEthereumChain',params:[{chainId}]});}
 catch(e){if(e.code!==4902)throw e;await p.request({method:'wallet_addEthereumChain',params:[{chainId,chainName:wallet.config.networkName||(wallet.config.chainId===31337?'SnapVault Local':'X Layer Testnet'),nativeCurrency:{name:wallet.config.chainId===196?'OKB':'Test OKB',symbol:'OKB',decimals:18},rpcUrls:[wallet.config.chainId===31337?apiURL('/rpc'):wallet.config.chainId===196?'https://rpc.xlayer.tech':'https://testrpc.xlayer.tech/terigon']}]});}
}

export async function refundWallet(id,buyer){const q=await call('refund-quote',{id,buyer});const {hash}=await transaction('refundDelivery',[q.id,q.buyer],q.valueWei);await call('refund-confirm',{id:q.id,buyer:q.buyer,hash});await refresh();return hash;}

export function fetchContent(uri){const url=new URL(uri,apiURL('/'));if(url.origin!==new URL(apiURL('/')).origin||!/^\/api\/wallet\/access\/[a-f0-9]{64}$/.test(url.pathname)||url.search||url.hash)throw Error('不可信的内容读取地址');return fetch(url.href,{headers:{Authorization:'Bearer '+wallet.token,'X-SnapVault-Client':API_VERSION,'X-SnapVault-Origin':location.origin},cache:'no-store'});}
export function finishContent(ref){if(!ref||!wallet.token)return;for(const order of wallet.data.orders||[])if(String(order.contentId)+':'+wallet.account===ref)order.viewUntil=Date.now();return fetch(apiURL('/api/wallet/view-finish'),{method:'POST',headers:{'Content-Type':'application/json','X-SnapVault-Client':API_VERSION,Authorization:'Bearer '+wallet.token},body:JSON.stringify({ref}),keepalive:true}).catch(()=>{});}

export async function verifyServerVersion(){const r=await fetch(apiURL('/api/wallet/config'),{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('服务维护或版本不可用，未发送交易');const config=await r.json();assertTrustedVault(config);return config;}
