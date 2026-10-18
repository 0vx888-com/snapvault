// Official OKX Connect for Safari/Chrome; injected wallets remain supported.
export async function selectProvider(config,{scope=window,load=()=>import('./vendor/okx-connect.min.js'),show=showConnection}={}){
 const injected=scope.okxwallet||scope.ethereum;if(injected?.request)return injected;
 if(!config||![196,1952,31337].includes(config.chainId))throw Error('请等待网络配置加载后重试');
 const {OKXUniversalProvider}=await load();
 const sdk=await OKXUniversalProvider.init({dappMetaData:{name:'SnapVault',icon:new URL('./assets/wallet-icon.png',import.meta.url).href}});
 const chain='eip155:'+config.chainId;let cancelled=false;
 const ui=show(()=>{cancelled=true;sdk.disconnect().catch(()=>{});});
 const display=uri=>ui.link(uri);sdk.on('display_uri',display);
 try{
  await Promise.race([sdk.connect({namespaces:{eip155:{chains:[chain],defaultChain:String(config.chainId),rpcMap:{[config.chainId]:config.chainId===196?'https://rpc.xlayer.tech':config.chainId===1952?'https://testrpc.xlayer.tech/terigon':new URL('/rpc',location.href).href}}},sessionConfig:{redirect:'none',openUniversalUrl:true}}),ui.cancelled]);
  if(cancelled)throw Error('已取消钱包连接');
 }catch(e){await sdk.disconnect().catch(()=>{});throw e;}finally{sdk.off('display_uri',display);ui.close();}
 const listeners=new Map();return {
  request:args=>sdk.request({...args,redirect:'none'},chain),
  on:(name,fn)=>{const event=name==='accountsChanged'?'session_update':name==='disconnect'?'session_delete':name;const handler=name==='accountsChanged'?()=>fn([]):fn;listeners.set(fn,{event,handler});sdk.on(event,handler);},
  removeListener:(_name,fn)=>{const l=listeners.get(fn);if(l)sdk.off(l.event,l.handler);listeners.delete(fn);},
  disconnect:()=>sdk.disconnect(),openWallet:()=>sdk.openWallet(),remote:true
 };
}
function showConnection(cancel){
 const d=document.createElement('dialog');d.className='wallet-connect-dialog';const title=document.createElement('h2');title.textContent='连接 OKX 钱包';
 const note=document.createElement('p');note.textContent='普通手机浏览器：点下方按钮跳转 OKX App，批准连接后返回本页。随后登录签名不花 gas。请使用最新版 OKX App。';
 const link=document.createElement('a');link.className='primary';link.textContent='正在准备连接…';link.rel='noopener noreferrer';link.target='_blank';
 const status=document.createElement('p');status.textContent='连接中不扣款；请勿分享连接链接。';
 const stop=document.createElement('button');stop.textContent='取消连接';let reject;const cancelled=new Promise((_,r)=>reject=r);const abort=()=>{cancel();reject(Error('已取消钱包连接'));};stop.onclick=abort;d.addEventListener('cancel',e=>{e.preventDefault();abort();});
 d.append(title,note,link,status,stop);document.body.append(d);d.showModal();return {cancelled,link:uri=>{const u=new URL(uri);if(u.protocol!=='https:'||!['www.okx.com','web3.okx.com','okx.com'].includes(u.hostname))throw Error('钱包返回了无法核验的连接地址');link.href=u.href;link.textContent='打开 OKX App 连接';},close:()=>{d.close();d.remove();}};
}
