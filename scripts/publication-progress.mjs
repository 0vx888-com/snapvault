// Pure preparation/resume guards. No RPC, wallet or writes.
import {sha256} from 'ethers';
export function planHash(plan){return sha256(Buffer.from(JSON.stringify(plan.map(({path,chunk,to,value,data})=>({path,chunk:chunk??null,to:to.toLowerCase(),value:String(value),data})))));}
export function publicationRecord(setup,manifestHash){
 if(!setup.releaseScopedProgress)return {name:'deweb-publish-public-progress.json',scoped:false};
 if(!/^0x[0-9a-f]{64}$/.test(manifestHash)||setup.expectedManifestHash!==manifestHash)throw Error('Prepared manifest mismatch; do not publish');
 return {name:'deweb-release-'+manifestHash.slice(2)+'-progress.json',scoped:true};
}
export function assertPublicationPlan(setup,manifestHash,plan){
 if(!setup.releaseScopedProgress)return;
 publicationRecord(setup,manifestHash);
 if(!setup.expectedPlanHash||planHash(plan)!==setup.expectedPlanHash)throw Error('Prepared transaction plan changed; re-review before signing');
 if(plan.some(x=>x.value!=='0x0'||x.path==='activation'))throw Error('Prepared free-value upload plan cannot add activation or payment');
}

// Public RPC pending counts may lag a transaction whose receipt is already confirmed.
export function nextPublicationNonce(pending,latest,confirmedNonce){
 const values=[BigInt(pending),BigInt(latest),confirmedNonce==null?0n:BigInt(confirmedNonce)+1n];
 if(values.some(x=>x<0n))throw Error("Invalid publication nonce");
 return "0x"+values.reduce((a,b)=>a>b?a:b,0n).toString(16);
}
