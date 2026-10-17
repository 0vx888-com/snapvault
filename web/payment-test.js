import {JsonRpcProvider,ContractFactory,Contract,ZeroAddress,parseEther,formatEther,getAddress,toQuantity} from './vendor/ethers.min.js';
const $=s=>document.querySelector(s),log=s=>$('#probe-log').textContent=s;
let state,provider,walletSession,address,artifact,busy=false;
const api=async body=>{const r=await fetch('/api/payment-test',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),d=await r.json();if(!r.ok)throw new Error(d.error||'链上核验失败');return d;};
const safe=fn=>async e=>{e?.preventDefault();if(busy)return;busy=true;render();try{await fn();}catch(error){log(error.shortMessage||error.message);}finally{busy=false;render();}};
async function refresh(){state=await api();render();}
function render(){
 const cfg=state?.configured,role=address&&cfg?(address===state.creator?'A':address===state.buyer?'B':'未知账户'):null;
 $('#probe-roles').textContent=cfg?`网络：X Layer 测试网 1952\nA（部署／收款）：${state.creator}\nB（买家）：${state.buyer}`:state?.reason||'读取中';
 $('#probe-deploy').disabled=busy||role!=='A'||!!state?.deployment;
 $('#probe-pay').disabled=busy||role!=='B'||!state?.deployment||state.purchased||state.active===false;
 $('#probe-withdraw').disabled=busy||role!=='A'||!state?.deployment||!Number(state.creatorWithdrawable);
 if(state?.deployment)$('#probe-deployed').textContent=`合约：${state.deployment.address}\n部署交易：${state.deployment.transactionHash}\n区块：${state.deployment.blockNumber}`;
 $('#probe-paid').textContent=state?.purchased?`已从链上确认购买\n${JSON.stringify(state.purchases,null,2)}`:'尚未确认测试付款';
 $('#probe-withdrawn').textContent=`A 可提现：${state?.creatorWithdrawable||'0'} 测试 OKB\n${state?.withdrawals?.length?JSON.stringify(state.withdrawals,null,2):'尚无已确认提现记录'}`;
}
async function checked(role){
 if(!walletSession)throw new Error('请先连接当前测试账户');
 const chain=await walletSession.request({method:'eth_chainId'});if(Number(BigInt(chain))!==1952)throw new Error('必须切换到 X Layer 测试网 1952，禁止主网交易');
 await refresh();if(!state.configured)throw new Error('尚未配置 A/B');
 const accounts=await walletSession.request({method:'eth_accounts'});address=getAddress(accounts[0]);if(address!==state[role==='A'?'creator':'buyer'])throw new Error(`请在钱包切到 ${role}，重新点击连接钱包`);
 if(Number((await provider.getNetwork()).chainId)!==1952)throw new Error('只读 RPC 网络不符');
 artifact ||= await (await fetch('deployment/SnapVaultPaymentProbe.json')).json();
}
async function sendReview(request,label){
 log(label+'：正在用 X Layer 官方 RPC 核验 gas…');
 const gas=await provider.estimateGas({...request,from:address}),fees=await provider.getFeeData();
 log(`${label}\n网络：X Layer 测试网 1952\n发送账户：${address}\n预计执行 gas：${gas}\n按当前 maxFee 估算执行费用：${formatEther(gas*(fees.maxFeePerGas||fees.gasPrice))} 测试 OKB；最终以钱包为准。请在钱包确认。`);
 return {gas:toQuantity((gas*120n+99n)/100n),...(fees.maxFeePerGas?{maxFeePerGas:toQuantity(fees.maxFeePerGas),maxPriorityFeePerGas:toQuantity(fees.maxPriorityFeePerGas||0n)}:{gasPrice:toQuantity(fees.gasPrice)})};
}
async function submit(request,fee){
 const chain=await walletSession.request({method:'eth_chainId'});if(Number(BigInt(chain))!==1952)throw new Error('钱包网络变化，取消请求');
 return walletSession.request({method:'eth_sendTransaction',params:[{from:address,chainId:'0x7a0',...(request.to?{to:request.to}:{}),data:request.data||'0x',value:toQuantity(request.value||0n),...fee}]});
}
$('#probe-connect').onclick=safe(async()=>{
 const injected=window.okxwallet||window.ethereum;if(!injected)throw new Error('当前浏览器没有钱包扩展。请复制 http://127.0.0.1:5180/payment-test.html 到安装 OKX Wallet 的浏览器');
 // Wallet permission can emit accountsChanged before eth_requestAccounts resolves.
 // Keep the candidate local until all reads complete, then publish the session atomically.
 log('正在等待钱包连接授权…');
 const bounded=(promise,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+'等待超时，请检查钱包扩展')),15000);})]).finally(()=>clearTimeout(timer));};
 const accounts=await bounded(injected.request({method:'eth_requestAccounts'}),'连接授权');
 log('正在核验钱包网络…');const chainHex=await bounded(injected.request({method:'eth_chainId'}),'网络读取');
 if(Number(BigInt(chainHex))!==1952)throw new Error(`当前 chainId ${Number(BigInt(chainHex))}，请切换 X Layer 测试网 1952 后重新连接`);
 const nextAddress=getAddress(accounts[0]),nextProvider=new JsonRpcProvider(location.origin+'/api/testnet-rpc');
 await refresh();
 provider=nextProvider;walletSession=injected;address=nextAddress;
 $('#probe-wallet').textContent=`${address} · X Layer 测试网 · 余额以钱包显示为准`;
 log('已连接。按 A 部署 → B 付款 → A 提现的顺序确认。');
});
$('#probe-network').onclick=safe(async()=>{const p=window.okxwallet||window.ethereum;if(!p)throw new Error('请在安装钱包扩展的浏览器打开此页');try{await p.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x7a0'}]});}catch(e){if(e.code!==4902)throw e;await p.request({method:'wallet_addEthereumChain',params:[{chainId:'0x7a0',chainName:'X Layer Testnet',rpcUrls:['https://testrpc.xlayer.tech/terigon'],nativeCurrency:{name:'Test OKB',symbol:'OKB',decimals:18},blockExplorerUrls:['https://www.okx.com/web3/explorer/xlayer-test']}]});}log('请确认钱包中的网络为 1952，然后重新连接。');});
$('#probe-deploy').onclick=safe(async()=>{
 await checked('A');if(state.deployment)throw new Error('已有部署记录，不重复部署');
 const factory=new ContractFactory(artifact.abi,artifact.bytecode),request=await factory.getDeployTransaction(state.creator,state.buyer),fee=await sendReview(request,'部署测试币演练合约（自动建立一个无内容测试条目）');
 const hash=await submit(request,fee);localStorage.setItem('sv:probe-pending-deploy',hash);$('#probe-restore-hash').value=hash;log(`部署交易已广播：${hash}\n等待区块确认，勿重复部署。`);
 const receipt=await provider.waitForTransaction(hash,1,120000);if(!receipt||receipt.status!==1)throw new Error('部署未成功，请保留交易哈希核对');
 state=await api({transactionHash:hash});localStorage.removeItem('sv:probe-pending-deploy');log(`部署已确认，合约 ${state.deployment.address}。现在切到账户 B，重新连接后付款。`);
});
$('#probe-restore').onclick=safe(async()=>{state=await api({transactionHash:$('#probe-restore-hash').value.trim()});log('已从 X Layer 测试网核验并恢复部署记录。');});
$('#probe-pay').onclick=safe(async()=>{
 await checked('B');if(state.purchased)throw new Error('已购买，不重复扣款');const v=new Contract(state.deployment.address,artifact.abi,provider),request=await v.purchase.populateTransaction(1,{value:parseEther('0.00001')}),fee=await sendReview(request,'支付 0.00001 测试 OKB（不提供图片或 TapeSend 交付）');
 const hash=await submit(request,fee);log(`付款交易已广播：${hash}\n等待确认，勿重复付款。`);const receipt=await provider.waitForTransaction(hash,1,120000);if(!receipt||receipt.status!==1)throw new Error('付款未成功，请核对回执');await refresh();log(`付款已确认：${hash}。下一步切回 A，重新连接后提现。`);
});
$('#probe-withdraw').onclick=safe(async()=>{
 await checked('A');const v=new Contract(state.deployment.address,artifact.abi,provider),request=await v.withdraw.populateTransaction(ZeroAddress),fee=await sendReview(request,`提回 ${state.creatorWithdrawable} 测试 OKB 收入`);
 const hash=await submit(request,fee);log(`提现交易已广播：${hash}\n等待确认…`);const receipt=await provider.waitForTransaction(hash,1,120000);if(!receipt||receipt.status!==1)throw new Error('提现未成功，请核对回执');await refresh();log(`提现已确认：${hash}。本次仅完成测试币付款／记账／提现，TapeSend 生态集成仍须单独验收。`);
});
$('#probe-refresh').onclick=safe(async()=>{await refresh();log('已刷新 X Layer 测试网的部署、付款和提现回执。');});
for(const e of ['accountsChanged','chainChanged'])(window.okxwallet||window.ethereum)?.on?.(e,()=>{provider=null;walletSession=null;address=null;$('#probe-wallet').textContent='账户或网络已变化，请重新连接';render();});
$('#probe-restore-hash').value=localStorage.getItem('sv:probe-pending-deploy')||'';
refresh().catch(e=>log(e.message));
