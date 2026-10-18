// Official OKX Connect. App launch is always a separate user gesture.
export async function selectProvider(config,{scope=window,load=()=>import('./vendor/okx-connect.min.js'),show=showConnection,showRequest=showAppConfirmation,timeoutMs=120000}={}){
 const injected=scope.okxwallet||scope.ethereum;if(injected?.request)return injected;
 if(!config||![196,1952,31337].includes(config.chainId))throw Error('请等待网络配置加载后重试');
 const {OKXUniversalProvider}=await load();
 const sdk=await OKXUniversalProvider.init({dappMetaData:{name:'SnapVault',icon:new URL('./assets/wallet-icon.png',import.meta.url).href}});
 const chain='eip155:'+config.chainId;let cancelled=false;
 const ui=show(()=>{cancelled=true;sdk.disconnect().catch(()=>{});});
 const display=uri=>ui.link(uri);sdk.on('display_uri',display);let timer;
 try{
  await Promise.race([sdk.connect({namespaces:{eip155:{chains:[chain],defaultChain:String(config.chainId),rpcMap:{[config.chainId]:config.chainId===196?'https://rpc.xlayer.tech':config.chainId===1952?'https://testrpc.xlayer.tech/terigon':new URL('/rpc',location.href).href}}},sessionConfig:{redirect:'none',openUniversalUrl:false}}),ui.cancelled,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('钱包连接超时，请重新连接；本站没有发起签名或交易。')),timeoutMs);})]);
  if(cancelled)throw Error('已取消钱包连接');
 }catch(e){await sdk.disconnect().catch(()=>{});throw e;}finally{clearTimeout(timer);sdk.off('display_uri',display);ui.close();}
 const listeners=new Map();return {
  request:args=>remoteRequest(sdk,args,chain,{show:showRequest,timeoutMs}),
  on:(name,fn)=>{const event=name==='accountsChanged'?'session_update':name==='disconnect'?'session_delete':name;const handler=name==='accountsChanged'?()=>fn([]):fn;listeners.set(fn,{event,handler});sdk.on(event,handler);},
  removeListener:(_name,fn)=>{const l=listeners.get(fn);if(l)sdk.off(l.event,l.handler);listeners.delete(fn);},
  disconnect:()=>sdk.disconnect(),openWallet:()=>sdk.openWallet(),remote:true
 };
}
export async function remoteRequest(sdk,args,chain,{show=showAppConfirmation,timeoutMs=120000}={}){
 if(!['personal_sign','eth_signTypedData_v4','eth_sendTransaction','wallet_switchEthereumChain','wallet_addEthereumChain'].includes(args.method))return sdk.request({...args,redirect:'none'},chain);
 const ui=show(()=>sdk.openWallet(),args.method);let timer;
 try{return await Promise.race([sdk.request({...args,redirect:'none'},chain),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(args.method==='eth_sendTransaction'?'钱包确认超时，交易结果尚不确定。请先检查 OKX 交易记录，不要重复提交。':'钱包确认超时，请回到 OKX App 检查请求后重新连接。'),{code:'REMOTE_TIMEOUT',pendingWalletRequest:args.method==='eth_sendTransaction'})),timeoutMs);})]);}
 catch(e){const rejected=['300','301','4001','5000','ACTION_REJECTED'].includes(String(e?.code));ui.fail(rejected?'你已拒绝 OKX 钱包请求，本站不会自动重试。':e.message||'OKX 钱包请求失败，请重新连接。');throw e;}
 finally{clearTimeout(timer);ui.close();}
}
function showConnection(cancel){
 const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&/Mac/.test(navigator.userAgent));
 const d=document.createElement('dialog');d.className='wallet-connect-dialog';const title=document.createElement('h2');title.textContent='连接 OKX 钱包';
 const note=document.createElement('p');note.textContent=mobile?'点下方按钮，在新窗口打开 OKX App 连接，批准后返回本页。也可以在 OKX App 的 Web3 浏览器里打开本站。':'电脑上请安装 OKX Wallet 浏览器插件后刷新。若使用手机，请在 OKX App 的 Web3 浏览器里打开本站。';
 const link=document.createElement('a');link.className='primary';link.textContent='正在准备连接…';link.rel='noopener noreferrer';link.target='_blank';
 const status=document.createElement('p');status.textContent='连接中不扣款；请勿分享连接链接。';
 const stop=document.createElement('button');stop.textContent='取消连接';let reject;const cancelled=new Promise((_,r)=>reject=r);const abort=()=>{cancel();reject(Error('已取消钱包连接'));};stop.onclick=abort;d.addEventListener('cancel',e=>{e.preventDefault();abort();});
 d.append(title,note,link,status,stop);document.body.append(d);d.showModal();return {cancelled,link:uri=>{const u=new URL(uri);if(u.protocol!=='https:'||!['www.okx.com','web3.okx.com','okx.com'].includes(u.hostname))throw Error('钱包返回了无法核验的连接地址');link.href=u.href;link.textContent='打开 OKX App 连接';},close:()=>{d.close();d.remove();}};
}
function showAppConfirmation(openWallet,method){
 let feedback=document.querySelector('#wallet-request-status');if(!feedback){feedback=document.createElement('p');feedback.id='wallet-request-status';feedback.className='service-status';feedback.setAttribute('role','alert');document.querySelector('header')?.after(feedback);}feedback.textContent='请到 OKX App 中确认';
 const d=document.createElement('dialog');d.className='wallet-connect-dialog';const title=document.createElement('h2');title.textContent='请到 OKX App 中确认';const note=document.createElement('p');note.textContent=method==='eth_sendTransaction'?'请核对钱包中的网络、金额与合约。当前请求未返回前，请勿重复提交。':'请核对 OKX App 中的登录签名或网络切换请求。登录和切换网络不花 gas。';
 const button=document.createElement('button');button.className='primary';button.textContent='打开 OKX App 确认';button.onclick=()=>{try{openWallet();}catch(e){feedback.textContent=e.message;}};
 d.addEventListener('cancel',e=>e.preventDefault());d.append(title,note,button);document.body.append(d);d.showModal();let failed=false;
 return {fail:text=>{failed=true;feedback.textContent=text;},close:()=>{d.close();d.remove();if(!failed)feedback.textContent='钱包请求已完成。';}};
}
