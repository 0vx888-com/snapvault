// Wallet mode is opt-in in development, the default for the deployable app build.
let settings={};
if(typeof location!=='undefined'){
 try{const r=await fetch(new URL('./app-config.json',import.meta.url));if(r.ok)settings=await r.json();}catch{/* existing demo remains usable without a deployment config */}
}
export const wallet={enabled:typeof location!=='undefined'&&(settings.mode==='wallet'||new URLSearchParams(location.search).get('delivery')==='wallet'),preview:settings.mode==='preview',base:settings.apiBase||'',account:typeof sessionStorage!=='undefined'&&sessionStorage.getItem('sv:wallet-session')?sessionStorage.getItem('sv:wallet-account'):null,token:typeof sessionStorage!=='undefined'?sessionStorage.getItem('sv:wallet-session'):null,data:{contents:[],orders:[],profiles:{},convs:[],messages:[],friends:[]},config:null,device:null};
export const apiURL=path=>new URL((wallet.base?wallet.base.replace(/\/$/,''):'')+path,location.href).href;
export async function call(action,body={}){
 if(!wallet.enabled)throw Error('钱包模式未启用');const r=await fetch(apiURL('/api/wallet/'+action),{method:'POST',headers:{'Content-Type':'application/json',...(wallet.token?{Authorization:'Bearer '+wallet.token}:{})},body:JSON.stringify(body)}),d=await r.json();
 if(!r.ok){if(r.status===401)disconnect(false);throw Error(d.error||'服务暂不可用');}return d;
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
let injected,subscriptions=false,revision=0;
export async function connect(){
 injected=provider();const accounts=await injected.request({method:'eth_requestAccounts'});if(!accounts[0])throw Error('钱包没有返回账户');
 const d=await device(),q=await call('challenge',{address:accounts[0],publicKey:d.publicKey});
 const text='0x'+[...new TextEncoder().encode(q.message)].map(x=>x.toString(16).padStart(2,'0')).join('');
 const signature=await injected.request({method:'personal_sign',params:[text,accounts[0]]}),result=await call('login',{nonce:q.nonce,signature});
 wallet.account=result.address;wallet.token=result.token;sessionStorage.setItem('sv:wallet-session',result.token);sessionStorage.setItem('sv:wallet-account',result.address);
 if(!subscriptions&&injected.on){injected.on('accountsChanged',()=>disconnect());injected.on('chainChanged',()=>window.dispatchEvent(new Event('snapvault:network')));subscriptions=true;}
 window.dispatchEvent(new Event('snapvault:identity'));await refresh();
}
export function disconnect(revoke=true){if(revoke&&wallet.token)call('logout').catch(()=>{});revision++;wallet.token=null;wallet.account=null;wallet.device=null;sessionStorage.removeItem('sv:wallet-session');sessionStorage.removeItem('sv:wallet-account');wallet.data={contents:[],orders:[],profiles:{},convs:[],messages:[],friends:[]};window.dispatchEvent(new Event('snapvault:identity'));}
export async function refresh(){const rev=++revision;const d=await call('state');if(rev!==revision)return;wallet.data=d;if(wallet.token)wallet.account=sessionStorage.getItem('sv:wallet-account');window.dispatchEvent(new Event('snapvault:change'));}
export async function initWallet(){const r=await fetch(apiURL('/api/wallet/config'));if(!r.ok)throw Error('服务未配置');wallet.config=await r.json();if(![31337,1952].includes(wallet.config.chainId))throw Error('当前版本不开放主网收款');await device();await refresh();}
async function signer(){if(!wallet.account)throw Error('请先连接钱包并签名登录');const p=injected||provider(),chain=Number(BigInt(await p.request({method:'eth_chainId'})));if(chain!==wallet.config.chainId)throw Error('请将钱包切换到'+(wallet.config.chainId===31337?'本地测试网络 31337（无真钱）':'X Layer 测试网 1952')+'，当前未提交交易');const {BrowserProvider,Contract}=await ethersModule(),s=await new BrowserProvider(p).getSigner();if((await s.getAddress()).toLowerCase()!==wallet.account)throw Error('钱包账户已改变，请重新登录');return new Contract(wallet.config.vault,wallet.config.abi,s);}
export async function publishWallet({image,meta}){const contract=await signer(),upload=await call('upload',{image,mime:meta.mime,meta});const tx=await contract.listWithOptions('0x0000000000000000000000000000000000000000',upload.price,upload.secs,upload.max,upload.hash,upload.uri,upload.burn),receipt=await tx.wait();const event=receipt.logs.map(l=>{try{return contract.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Listed');if(!event)throw Error('没有找到上架事件');const result=await call('register',{id:event.args.id.toString(),transactionHash:tx.hash});await refresh();return result;}
export async function purchaseWallet(id){const contract=await signer(),q=await call('quote',{id});const tx=await contract.purchaseDirect(id,q.keyHash,q.deadline,q.signature,{value:q.price});await tx.wait();await refresh();return {purchaseTx:tx.hash};}
export async function openWallet(id){const d=await call('open',{id}),privateKey=(await device()).privateKey;const raw=new Uint8Array(await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,Uint8Array.from(atob(d.encryptedKey),c=>c.charCodeAt(0))));return {...d,key:'0x'+[...raw].map(x=>x.toString(16).padStart(2,'0')).join(''),uri:apiURL(d.uri)};}
export async function walletAction(action,b){const d=await call(action,b);await refresh();return d;}

export async function setupNetwork(){
 if(!wallet.config||![31337,1952].includes(wallet.config.chainId))throw Error('测试网络未就绪');
 const p=provider(),chainId='0x'+wallet.config.chainId.toString(16);
 try{await p.request({method:'wallet_switchEthereumChain',params:[{chainId}]});}
 catch(e){if(e.code!==4902)throw e;await p.request({method:'wallet_addEthereumChain',params:[{chainId,chainName:wallet.config.chainId===31337?'SnapVault Local — 无真钱':'X Layer Testnet',nativeCurrency:{name:'Test OKB',symbol:'OKB',decimals:18},rpcUrls:[wallet.config.chainId===31337?apiURL('/rpc'):'https://testrpc.xlayer.tech/terigon']}]});}
}
