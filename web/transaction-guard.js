// Only public transaction hashes are persisted. Never retry a broadcast automatically.
const active=new Set();
export async function guardedTransaction({key,send,wait,storage=localStorage}){
 if(active.has(key))throw Error('交易正在处理中，请勿重复点击');active.add(key);
 try{
  if(storage.getItem(key+':uncertain'))throw Error('上次钱包交易请求结果尚不确定，请先检查 OKX 交易记录，暂不重复提交。');
  let hash=storage.getItem(key);
  if(!hash){try{hash=await send();}catch(e){if(e.pendingWalletRequest)storage.setItem(key+':uncertain','true');throw e;}storage.setItem(key,hash);}
  const receipt=await wait(hash);
  if(!receipt)throw Error('交易仍待确认：'+hash+'。请稍后重试查询，不要重复付款。');
  if(receipt.status!==1){storage.removeItem(key);throw Error('交易执行失败：'+hash);}
  storage.removeItem(key);return {hash,receipt};
 }finally{active.delete(key);}
}
export function walletError(e){return ['300','301','4001','5000','ACTION_REJECTED'].includes(String(e?.code))?'你已取消钱包请求，未重新发送交易。':e?.message||'钱包请求失败，请稍后重试';}
