// Versioned AES-256-GCM snapshots. BACKUP_KEY is separate from MASTER_KEY.
// An off-site PUT URL is required by production startup; local volume copies alone
// are never advertised as disaster recovery. No keys or signed URLs are logged.
import {backupGeneration} from './backup-policy.mjs';
import {randomBytes,createCipheriv,createDecipheriv,createHash,createHmac} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync,readFileSync,existsSync,readdirSync,unlinkSync,statfsSync} from 'node:fs';
import {resolve} from 'node:path';
export function secretKey(text,name){if(typeof text!=='string'||! /^(?:0x)?[0-9a-fA-F]{64}$/.test(text))throw Error(name+' must be a 32-byte hex secret');return Buffer.from(text.replace(/^0x/,''),'hex');}
export function encryptBackup({stateBytes,master,identity,viewRecovery},backupKey){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',backupKey,iv);const payload=Buffer.from(JSON.stringify({version:viewRecovery?2:1,viewRecovery,createdAt:new Date().toISOString(),identity,master:master.toString('hex'),state:Buffer.from(stateBytes).toString('base64')}));const ct=Buffer.concat([cipher.update(payload),cipher.final()]);return Buffer.from(JSON.stringify({version:1,algorithm:'AES-256-GCM',iv:iv.toString('base64'),ct:ct.toString('base64'),tag:cipher.getAuthTag().toString('base64')}));}
export function decryptBackup(bytes,key){const e=JSON.parse(bytes);if(e.version!==1||e.algorithm!=='AES-256-GCM')throw Error('Unsupported backup');const d=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));const p=JSON.parse(Buffer.concat([d.update(Buffer.from(e.ct,'base64')),d.final()]));if(![1,2].includes(p.version))throw Error('Invalid backup payload');return p;}
export function restoreBackup({bytes,key,dir,expectedIdentity,currentLedger,expectedLedgerHead,approvedLegacyDigest}){
 const p=decryptBackup(bytes,key);if(expectedIdentity&&p.identity!==expectedIdentity)throw Error('Backup network/contract mismatch');
 const master=secretKey(p.master,'Recovered master'),stateBytes=Buffer.from(p.state,'base64'),e=JSON.parse(stateBytes),d=createDecipheriv('aes-256-gcm',master,Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));const state=JSON.parse(Buffer.concat([d.update(Buffer.from(e.ct,'base64')),d.final()]));
 if(state.identity&&state.identity!==p.identity)throw Error('Inner state/backup identity mismatch');const guarded=p.version===2||state.viewLedgerRequired||p.identity.startsWith('196:');if(guarded){if(!currentLedger||!expectedLedgerHead||JSON.stringify(currentLedger.head())!==JSON.stringify(expectedLedgerHead))throw Error('Trusted current view ledger head required; no snapshot-only restore');if(currentLedger.identity!==p.identity||((p.viewRecovery?.head||state.viewLedgerHead)?!currentLedger.contains(p.viewRecovery?.head||state.viewLedgerHead):approvedLegacyDigest!==createHash('sha256').update(bytes).digest('hex')))throw Error('Current ledger cannot prove backup history');currentLedger.assertBusinessState(state);currentLedger.apply(state);}
 else if(p.identity.startsWith('196:'))throw Error('Legacy mainnet snapshot requires reviewed guarded migration, not direct restore');
 if(existsSync(resolve(dir,'state.enc')))throw Error('Refusing to overwrite existing state');mkdirSync(dir,{recursive:true,mode:0o700});
 const burnFiles=p.viewRecovery?.burnFiles||{},now=Date.now();for(const m of state.messages||[]){if(!m.burn)continue;const c=state.convs.find(c=>c.id===m.conv),recipients=c?.members.filter(w=>w!==m.from)||[];if(m.destroyedAt||(c?.type==='dm'&&recipients.some(w=>m.opens?.[w]&&m.opens[w]<=now))){delete m.payload;delete m.burnFile;m.destroyedAt||=now;continue;}
  if(m.burnFile){if(!/^[a-f0-9]{32}$/.test(m.id)||!burnFiles[m.id])throw Error('Unread burn payload missing; refuse incomplete restore');const body=burnFiles[m.id],check=createDecipheriv('aes-256-gcm',master,Buffer.from(body.iv,'base64'));check.setAuthTag(Buffer.from(body.tag,'base64'));JSON.parse(Buffer.concat([check.update(Buffer.from(body.ct,'base64')),check.final()]));}}
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',master,iv),ct=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(state))),cipher.final()]),envelope={iv:iv.toString('base64'),ct:ct.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
 for(const m of state.messages||[])if(m.burnFile){const folder=resolve(dir,'burn');mkdirSync(folder,{recursive:true,mode:0o700});writeFileSync(resolve(folder,m.id+'.enc'),JSON.stringify(burnFiles[m.id]),{flag:'wx',mode:0o600});}
 writeFileSync(resolve(dir,'state.enc'),guarded?JSON.stringify(envelope):stateBytes,{flag:'wx',mode:0o600});return {masterKey:p.master,identity:p.identity,guarded};
}
export class BackupManager{
 constructor({dir,key,putURL,fetcher=fetch,retention=12,store,prune=true,spaceAvailable,generation}){this.generation=backupGeneration(generation);if(this.generation)dir=resolve(dir,'generations',this.generation);if(!Number.isInteger(retention)||retention<2||retention>100)throw Error('Invalid local backup retention');this.spaceAvailable=spaceAvailable||(()=>{const s=statfsSync(dir,{bigint:true});return s.bavail*s.bsize;});this.prune=prune;this.dir=dir;this.key=key;this.putURL=putURL;this.store=store;this.fetcher=fetcher;this.retention=retention;this.lastRemoteAt=0;this.pending=null;mkdirSync(dir,{recursive:true,mode:0o700});if(putURL){const u=new URL(putURL);if(u.protocol!=='https:'||u.username||u.password)throw Error('Off-site backup PUT URL must be HTTPS');}}
 async write(args){if(this.pending)return this.pending.catch(()=>{}).then(()=>this.write(args));this.pending=this._write(args).finally(()=>{this.pending=null});return this.pending;}
 // Prune only after a new snapshot has been read back and authenticated. Remote
 // availability must not control local retention; never touch the live state file.
 pruneLocal(current){
  const files=readdirSync(this.dir).filter(x=>/^[0-9]+-[0-9a-f]+\.backup\.enc$/.test(x)).sort();
  const keep=new Set([current,...files.filter(f=>f!==current).slice(-(this.retention-1))]);
  for(const f of files)if(!keep.has(f))unlinkSync(resolve(this.dir,f));
  // Old releases used random temporary names, so interrupted writes could linger.
  for(const f of readdirSync(this.dir))if(/^[0-9]+-[0-9a-f]+\.backup\.enc\.tmp$/.test(f))unlinkSync(resolve(this.dir,f));
 }
 // HMAC metadata reveals no plaintext or keys. It is only a local cache, not a
 // replacement for the independent view ledger or remote backup authentication.
 receipt(file){try{const {mac,...record}=JSON.parse(readFileSync(resolve(this.dir,file)));if(this.mac(record)!==mac)return null;const bytes=readFileSync(resolve(this.dir,record.name));if(createHash('sha256').update(bytes).digest('hex')!==record.sha256)return null;if(decryptBackup(bytes,this.key).identity!==record.identity)return null;return {...record,body:bytes};}catch{return null;}}
 mac(record){return createHmac('sha256',this.key).update(JSON.stringify(record)).digest('hex');}
 record(file,record){const target=resolve(this.dir,file),temp=target+'.tmp';try{writeFileSync(temp,JSON.stringify({...record,mac:this.mac(record)}),{mode:0o600});renameSync(temp,target);}finally{if(existsSync(temp))unlinkSync(temp);}}
 async _write({file,master,identity,viewRecovery,stateBytes,fingerprint}){
  stateBytes=stateBytes||readFileSync(file);
  // Dedup is opt-in with a scoped generation. The caller's normalized plaintext
  // fingerprint includes all business data, view state and unread burn bodies.
  const digest=this.generation?createHmac('sha256',this.key).update(identity).update(master).update(fingerprint||stateBytes).update(JSON.stringify(viewRecovery||null)).digest('hex'):null;
  const prior=this.generation&&this.receipt('.completed.json');
  if(prior&&prior.identity===identity&&prior.digest===digest&&prior.remote===!!(this.putURL||this.store)&&!this.putURL){if(this.store?.verify){try{await this.store.verify(prior);}catch{throw Error('Off-site encrypted S3 backup verification failed');}}this.lastRemoteAt=prior.remote?prior.completedAt:0;return {sha256:prior.sha256,bytes:prior.bytes,remote:prior.remote,skipped:true};}
  const retry=this.generation&&this.receipt('.retry.json');
  const reuse=retry&&retry.identity===identity&&retry.digest===digest;
  const bytes=reuse?retry.body:encryptBackup({stateBytes,master,identity,viewRecovery},this.key);
  if(BigInt(this.spaceAvailable())<BigInt(bytes.length)*2n+67108864n)throw Error('Backup disk reserve insufficient; existing data and snapshots preserved');
  const hash=createHash('sha256').update(bytes).digest('hex');
  const name=reuse?retry.name:Date.now()+'-'+randomBytes(4).toString('hex')+'.backup.enc',target=resolve(this.dir,name);
  // A fixed temporary path bounds leftovers even if the process is interrupted.
  const temporary=resolve(this.dir,'.pending.backup.enc.tmp');
  try{
   if(!reuse){writeFileSync(temporary,bytes,{mode:0o600});
   decryptBackup(readFileSync(temporary),this.key);
   renameSync(temporary,target);}
   decryptBackup(readFileSync(target),this.key);
  }finally{if(existsSync(temporary))unlinkSync(temporary);}
  if(this.generation)this.record('.retry.json',{identity,digest,name,sha256:hash,bytes:bytes.length});
  if(this.prune)this.pruneLocal(name);
  if(this.store){try{await this.store.put({bytes,name,identity,sha256:hash});}catch{throw Error('Off-site encrypted S3 backup failed');}this.lastRemoteAt=Date.now();}
  if(this.putURL){let response;try{response=await this.fetcher(this.putURL,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(30000)});}catch{throw Error('Off-site encrypted backup upload failed');}if(!response.ok)throw Error('Off-site encrypted backup rejected');this.lastRemoteAt=Date.now();}
  const result={sha256:hash,bytes:bytes.length,remote:!!(this.putURL||this.store)};
  if(this.generation){this.record('.completed.json',{identity,digest,name,...result,completedAt:Date.now()});if(existsSync(resolve(this.dir,'.retry.json')))unlinkSync(resolve(this.dir,'.retry.json'));}
  return result;
 }
}
