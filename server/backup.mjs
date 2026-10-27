// Versioned AES-256-GCM snapshots. BACKUP_KEY is separate from MASTER_KEY.
// An off-site PUT URL is required by production startup; local volume copies alone
// are never advertised as disaster recovery. No keys or signed URLs are logged.
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync,readFileSync,existsSync,readdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
export function secretKey(text,name){if(typeof text!=='string'||! /^(?:0x)?[0-9a-fA-F]{64}$/.test(text))throw Error(name+' must be a 32-byte hex secret');return Buffer.from(text.replace(/^0x/,''),'hex');}
export function encryptBackup({stateBytes,master,identity},backupKey){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',backupKey,iv);const payload=Buffer.from(JSON.stringify({version:1,createdAt:new Date().toISOString(),identity,master:master.toString('hex'),state:Buffer.from(stateBytes).toString('base64')}));const ct=Buffer.concat([cipher.update(payload),cipher.final()]);return Buffer.from(JSON.stringify({version:1,algorithm:'AES-256-GCM',iv:iv.toString('base64'),ct:ct.toString('base64'),tag:cipher.getAuthTag().toString('base64')}));}
export function decryptBackup(bytes,key){const e=JSON.parse(bytes);if(e.version!==1||e.algorithm!=='AES-256-GCM')throw Error('Unsupported backup');const d=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));const p=JSON.parse(Buffer.concat([d.update(Buffer.from(e.ct,'base64')),d.final()]));if(p.version!==1)throw Error('Invalid backup payload');return p;}
export function restoreBackup({bytes,key,dir,expectedIdentity}){const p=decryptBackup(bytes,key);if(expectedIdentity&&p.identity!==expectedIdentity)throw Error('Backup network/contract mismatch');const master=secretKey(p.master,'Recovered master');const stateBytes=Buffer.from(p.state,'base64'),e=JSON.parse(stateBytes),d=createDecipheriv('aes-256-gcm',master,Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));JSON.parse(Buffer.concat([d.update(Buffer.from(e.ct,'base64')),d.final()]));mkdirSync(dir,{recursive:true,mode:0o700});if(existsSync(resolve(dir,'state.enc')))throw Error('Refusing to overwrite existing state');writeFileSync(resolve(dir,'state.enc'),stateBytes,{flag:'wx',mode:0o600});return {masterKey:p.master,identity:p.identity};}
export class BackupManager{
 constructor({dir,key,putURL,fetcher=fetch,retention=12,store}){if(!Number.isInteger(retention)||retention<2||retention>100)throw Error('Invalid local backup retention');this.dir=dir;this.key=key;this.putURL=putURL;this.store=store;this.fetcher=fetcher;this.retention=retention;this.lastRemoteAt=0;this.pending=null;mkdirSync(dir,{recursive:true,mode:0o700});if(putURL){const u=new URL(putURL);if(u.protocol!=='https:'||u.username||u.password)throw Error('Off-site backup PUT URL must be HTTPS');}}
 async write({file,master,identity}){if(this.pending)return this.pending.then(()=>this.write({file,master,identity}));this.pending=this._write({file,master,identity}).finally(()=>{this.pending=null});return this.pending;}
 // Prune only after a new snapshot has been read back and authenticated. Remote
 // availability must not control local retention; never touch the live state file.
 pruneLocal(current){
  const files=readdirSync(this.dir).filter(x=>/^[0-9]+-[0-9a-f]+\.backup\.enc$/.test(x)).sort();
  const keep=new Set([current,...files.filter(f=>f!==current).slice(-(this.retention-1))]);
  for(const f of files)if(!keep.has(f))unlinkSync(resolve(this.dir,f));
  // Old releases used random temporary names, so interrupted writes could linger.
  for(const f of readdirSync(this.dir))if(/^[0-9]+-[0-9a-f]+\.backup\.enc\.tmp$/.test(f))unlinkSync(resolve(this.dir,f));
 }
 async _write({file,master,identity}){
  const bytes=encryptBackup({stateBytes:readFileSync(file),master,identity},this.key);
  const hash=createHash('sha256').update(bytes).digest('hex');
  const name=Date.now()+'-'+randomBytes(4).toString('hex')+'.backup.enc',target=resolve(this.dir,name);
  // A fixed temporary path bounds leftovers even if the process is interrupted.
  const temporary=resolve(this.dir,'.pending.backup.enc.tmp');
  try{
   writeFileSync(temporary,bytes,{mode:0o600});
   decryptBackup(readFileSync(temporary),this.key);
   renameSync(temporary,target);
   decryptBackup(readFileSync(target),this.key);
  }finally{if(existsSync(temporary))unlinkSync(temporary);}
  this.pruneLocal(name);
  if(this.store){try{await this.store.put({bytes,name,identity,sha256:hash});}catch{throw Error('Off-site encrypted S3 backup failed');}this.lastRemoteAt=Date.now();}
  if(this.putURL){let response;try{response=await this.fetcher(this.putURL,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(30000)});}catch{throw Error('Off-site encrypted backup upload failed');}if(!response.ok)throw Error('Off-site encrypted backup rejected');this.lastRemoteAt=Date.now();}
  return {sha256:hash,bytes:bytes.length,remote:!!(this.putURL||this.store)};
 }
}
