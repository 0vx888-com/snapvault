// Pure offline review. Does not access a wallet, sign, broadcast, or authorize spending.
import {createHash} from 'node:crypto';
const amount=(v,name)=>{if(typeof v!=='string'||! /^(0x[0-9a-f]+|[0-9]+)$/i.test(v))throw Error('Missing or invalid '+name);return BigInt(v)};
export function reviewFinalWalletFee({expected,displayed,budgetWei,spentWei='0',evidence,reviewedAt,now=Date.now()}){
 if(!evidence||typeof evidence!=='string'||!evidence.trim())throw Error('Final wallet screenshot/reference required');
 if(!Number.isFinite(reviewedAt)||reviewedAt>now||now-reviewedAt>60000)throw Error('Wallet review stale or missing');
 for(const key of ['chainId','from','to','data','value','nonce']){
  if(typeof expected?.[key]!=='string'||typeof displayed?.[key]!=='string')throw Error('Missing identity '+key);
  const numeric=['chainId','value','nonce'].includes(key);
  if(numeric?amount(expected[key],key)!==amount(displayed[key],key):expected[key].toLowerCase()!==displayed[key].toLowerCase())throw Error('Transaction changed: '+key);
 }
 if(amount(displayed.chainId,'chainId')!==196n)throw Error('Only X Layer mainnet 196');
 const gas=amount(displayed.gasLimit,'gasLimit');if(gas===0n)throw Error('Zero gas limit');
 const type=amount(displayed.type,'type');let rate;
 if(type===2n){rate=amount(displayed.maxFeePerGas,'maxFeePerGas');if(amount(displayed.maxPriorityFeePerGas,'maxPriorityFeePerGas')>rate)throw Error('Invalid priority fee');}
 else if(type===0n)rate=amount(displayed.gasPrice,'gasPrice');else throw Error('Unsupported fee model');
 const maximumFeeWei=gas*rate,totalMaximumWei=amount(spentWei,'spentWei')+amount(displayed.value,'value')+maximumFeeWei;
 if(totalMaximumWei>amount(budgetWei,'budgetWei'))throw Error('Final wallet maximum exceeds approved total budget');
 return {maximumFeeWei:String(maximumFeeWei),totalMaximumWei:String(totalMaximumWei),fingerprint:createHash('sha256').update(JSON.stringify(displayed)).digest('hex'),evidence,reviewedAt,authorization:false};
}
