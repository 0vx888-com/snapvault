import {ZeroAddress,formatEther} from 'ethers';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const idOf=b=>{const id=String(b.id||'');if(!/^[1-9][0-9]{0,76}$/.test(id))fail('订单编号无效');return id};
export async function refundAction(s,action,b,who){
 const owner=(await s.vault.owner()).toLowerCase(),isOwner=owner===who;s.state.refunds||={};
 if(action==='refund-list'){
  await s.syncOrders(true);const rows=[];
  for(const [key,order]of Object.entries(s.state.orderIndex.orders)){
   if(!order.id||(!isOwner&&order.buyer!==who))continue;const product=s.state.products[order.id];if(!product)continue;
   const request=s.state.refunds[key],payment=await s.vault.payments(order.id,order.buyer);if(payment.amount===0n)continue;
   if(isOwner&&!request)continue;
   rows.push({id:order.id,buyer:order.buyer,title:product.title,amount:formatEther(payment.amount),valueWei:payment.amount.toString(),token:payment.token,status:payment.refunded?'refunded':request?.status||'none',reason:request?.reason||'',response:request?.response||'',transactionHash:order.refundTx||request?.transactionHash||null});
  }return {owner,isOwner,requests:rows,policy:'平台审核，全额退款由 owner 另外出资；不会自动追回创作者已提现收入。退款不能收回已保存图片。'};
 }
 if(action==='refund-request')return s.serial(async()=>{
  const id=idOf(b),reason=String(b.reason||'').trim();if(reason.length<2||reason.length>500)fail('请填写 2–500 字退款原因');
  if(!await s.confirmed(id,who))fail('没有可申请退款的已确认订单',403);const key=id+':'+who,payment=await s.vault.payments(id,who);if(payment.amount===0n||payment.refunded)fail('订单不可退款');
  const old=s.state.refunds[key];if(old)return {ok:true,status:old.status};s.state.refunds[key]={id,buyer:who,reason,status:'requested',createdAt:Date.now()};s.save();await s.flushBackup();return {ok:true,status:'requested'};
 });
 if(!isOwner)fail('仅平台 owner 可以处理退款',403);
 const id=idOf(b),buyer=String(b.buyer||'').toLowerCase(),key=id+':'+buyer,request=s.state.refunds[key];if(!request)fail('退款申请不存在',404);
 const payment=await s.vault.payments(id,buyer);if(payment.refunded&&action!=='refund-confirm')fail('订单已退款',409);if(payment.amount===0n)fail('订单不存在');
 if(action==='refund-review')return s.serial(async()=>{const response=String(b.response||'').trim();if(response.length<2||response.length>500)fail('请填写 2–500 字处理说明');request.status='rejected';request.response=response;request.reviewedAt=Date.now();s.save();await s.flushBackup();return {ok:true};});
 if(action==='refund-quote'){
  if(payment.token!==ZeroAddress)fail('当前界面只处理 OKB 全额退款，代币退款需单独审核');return {id,buyer,title:s.state.products[id]?.title||'订单 '+id,amount:formatEther(payment.amount),token:payment.token,valueWei:payment.amount.toString(),method:'refundDelivery',notice:'owner 将另付全额退款本金与 gas，买家收到全额购买款；原创作者收入不会自动扣回。'};
 }
 if(action==='refund-confirm')return s.serial(async()=>{
  if(!/^0x[0-9a-fA-F]{64}$/.test(b.hash||''))fail('交易哈希无效');const [tx,r]=await Promise.all([s.provider.getTransaction(b.hash),s.provider.getTransactionReceipt(b.hash)]);
  if(!tx||!r||r.status!==1)fail('退款交易尚未成功',409);if((await s.provider.getBlockNumber())-r.blockNumber+1<s.confirmations)fail('退款交易确认数不足',409);
  const expected=s.vault.interface.encodeFunctionData('refundDelivery',[id,buyer]);if(tx.chainId!==BigInt(s.chainId)||tx.from.toLowerCase()!==owner||tx.to?.toLowerCase()!==s.vault.target.toLowerCase()||tx.data!==expected||tx.value!==(payment.token===ZeroAddress?payment.amount:0n))fail('交易不是这笔订单的 owner 退款',403);
  if(!r.logs.some(l=>{try{const e=s.vault.interface.parseLog(l);return l.address.toLowerCase()===s.vault.target.toLowerCase()&&e?.name==='DeliveryRefunded'&&String(e.args.id)===id&&e.args.buyer.toLowerCase()===buyer&&e.args.amount===payment.amount}catch{return false}}))fail('缺少退款事件');
  request.status='refunded';request.transactionHash=b.hash;request.refundedAt=Date.now();s.save();await s.syncOrders(true);await s.flushBackup();return {ok:true,transactionHash:b.hash};
 });
 fail('退款操作不存在',404);
}
