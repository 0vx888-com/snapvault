// Only public transaction hashes are persisted. Never retry a broadcast automatically.
const active=new Set();
export async function guardedTransaction({key,send,wait,storage=localStorage}){
 if(active.has(key))throw Error('交易正在处理中，请勿重复点击');active.add(key);
 try{
  let hash=storage.getItem(key);
  if(!hash){hash=await send();storage.setItem(key,hash);}
  const receipt=await wait(hash);
  if(!receipt)throw Error('交易仍待确认：'+hash+'。请稍后重试查询，不要重复付款。');
  if(receipt.status!==1){storage.removeItem(key);throw Error('交易执行失败：'+hash);}
  storage.removeItem(key);return {hash,receipt};
 }finally{active.delete(key);}
}
export function walletError(e){return e?.code===4001||e?.code==='ACTION_REJECTED'||e?.code===5000?'你已取消钱包请求，未重新发送交易。':e?.message||'钱包请求失败，请稍后重试';}
