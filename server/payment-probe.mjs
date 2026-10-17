// Public-address/receipt bookkeeping only. Never imports a wallet or signs transactions.
import {JsonRpcProvider,Contract,ContractFactory,ZeroAddress,formatEther,getAddress} from 'ethers';
import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const rpc='https://testrpc.xlayer.tech/terigon';let provider;
const logCache=new Map();
async function evidence(v,start){
 const tip=await rpcProvider().getBlockNumber(),key=v.target.toLowerCase(),old=logCache.get(key),from=Math.max(start,old?old.tip-12:start);
 const purchases=old?old.purchases.filter(e=>e.blockNumber<from):[],withdrawals=old?old.withdrawals.filter(e=>e.blockNumber<from):[];
 for(let block=from;block<=tip;block+=100){
  const end=Math.min(tip,block+99),[buys,outs]=await Promise.all([v.queryFilter(v.filters.Purchase(),block,end),v.queryFilter(v.filters.Withdraw(),block,end)]);
  purchases.push(...buys);withdrawals.push(...outs);
 }
 const result={tip,purchases,withdrawals};logCache.set(key,result);return result;
}
const rpcProvider=()=>provider ||= new JsonRpcProvider(rpc);
export async function paymentProbe(root,recordHash){
 const path=resolve(root,'config/payment-test.local.json');if(!existsSync(path))return {configured:false,reason:'尚未设置 A/B 测试账户'};
 const config=JSON.parse(readFileSync(path)),creator=getAddress(config.creator),buyer=getAddress(config.buyer),p=rpcProvider();
 if(Number((await p.getNetwork()).chainId)!==1952)throw new Error('RPC 不是 X Layer 测试网 1952');
 const art=JSON.parse(readFileSync(resolve(root,'deployment/SnapVaultPaymentProbe.json')));
 if(recordHash){
  if(!/^0x[0-9a-fA-F]{64}$/.test(recordHash))throw new Error('部署交易哈希格式不符');
  const [tx,r]=await Promise.all([p.getTransaction(recordHash),p.getTransactionReceipt(recordHash)]);
  const expected=await new ContractFactory(art.abi,art.bytecode).getDeployTransaction(creator,buyer);
  if(!tx||!r)throw new Error('部署交易未确认，请稍后重试');
  if(r.status!==1||!r.contractAddress||tx.to!==null||getAddress(tx.from)!==creator||tx.data.toLowerCase()!==expected.data.toLowerCase())throw new Error('不是约定 A 账户部署的付款演练合约，拒绝登记');
  if(config.deployment&&config.deployment.address!==r.contractAddress)throw new Error('已有不同部署记录，先核对，避免重复部署');
  config.deployment={address:r.contractAddress,transactionHash:r.hash,blockNumber:r.blockNumber,gasUsed:r.gasUsed.toString()};
  writeFileSync(path+'.tmp',JSON.stringify(config,null,2)+'\n');renameSync(path+'.tmp',path);
 }
 const base={configured:true,chainId:1952,creator,buyer,priceTestOKB:'0.00001',productionDeliveryReady:false,deployment:config.deployment||null};
 if(!config.deployment)return base;
 const v=new Contract(config.deployment.address,art.abi,p),[owner,actualBuyer,treasury,fee,price,c,balance,access]=await Promise.all([v.owner(),v.testBuyer(),v.treasury(),v.feeBps(),v.PROBE_PRICE(),v.contents(1),v.balances(creator,ZeroAddress),v.accessUntil(1,buyer)]);
 if(getAddress(owner)!==creator||getAddress(actualBuyer)!==buyer||getAddress(treasury)!==creator||fee!==1000n||price!==10000000000000n||c.creator!==creator||c.blobURI!=='urn:snapvault:testnet-payment-probe:no-content-delivery')throw new Error('链上合约参数变化或不符合演练约定，停止付款');
 const events=await evidence(v,config.deployment.blockNumber),purchases=events.purchases.filter(e=>e.args.id===1n&&getAddress(e.args.fan)===buyer),withdrawals=events.withdrawals.filter(e=>getAddress(e.args.creator)===creator&&e.args.token===ZeroAddress);
 return {...base,sold:Number(c.sold),active:c.active,feeBps:Number(fee),creatorWithdrawable:formatEther(balance),purchased:access!==0n,purchases:purchases.map(e=>({transactionHash:e.transactionHash,blockNumber:e.blockNumber,priceTestOKB:formatEther(e.args.price),feeTestOKB:formatEther(e.args.fee)})),withdrawals:withdrawals.map(e=>({transactionHash:e.transactionHash,blockNumber:e.blockNumber,amountTestOKB:formatEther(e.args.amount)}))};
}
