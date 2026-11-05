// Explicit one-shot migration of a stopped legacy source into a NEW work directory.
// No wallet constructor, RPC provider, HTTP API, worker, backup uploader or delete API.
import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,existsSync,readdirSync,statfsSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {WalletService} from './wallet-service.mjs';
import {ViewLedger} from './view-ledger.mjs';
import {encryptBackup,decryptBackup,restoreBackup} from './backup.mjs';
import {requireMaintenance} from './maintenance-isolation.mjs';
import {lockWriter} from './release-policy.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
function noSymlinks(file){for(let p=resolve(file);;p=dirname(p)){if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Symlink path refused');if(dirname(p)===p)break;}}
function contained(base,target){const r=relative(base,target);return !r||(!r.startsWith('..')&&!isAbsolute(r));}
export function sourceManifest(source){
 noSymlinks(source);const dir=realpathSync(source),files=[];
 const add=p=>{noSymlinks(p);const s=lstatSync(p);if(!s.isFile()||s.nlink!==1)throw Error('Only regular, unlinked source files allowed');const bytes=readFileSync(p);files.push({path:relative(dir,p),bytes:bytes.length,sha256:digest(bytes)});};
 add(resolve(dir,'state.enc'));
 if(existsSync(resolve(dir,'burn'))){noSymlinks(resolve(dir,'burn'));for(const n of readdirSync(resolve(dir,'burn')).sort()){if(!/^[a-f0-9]{32}\.enc$/.test(n))throw Error('Unexpected burn filename');add(resolve(dir,'burn',n));}}
 return {dir,files,sha256:digest(JSON.stringify(files)),bytes:files.reduce((n,f)=>n+f.bytes,0)};
}
export function migrationPlan({source,work}){
 const m=sourceManifest(source),target=resolve(work);noSymlinks(target);
 if(existsSync(target)||contained(m.dir,target)||contained(target,m.dir))throw Error('Work directory must be new and outside source');
 noSymlinks(dirname(target));const fs=statfsSync(dirname(target),{bigint:true});
 // Allows expansion of base64 envelopes, a full rehearsal and safety reserve.
 const requiredBytes=BigInt(m.bytes)*12n+67108864n;
 return {source:m,work:target,requiredBytes:String(requiredBytes),availableBytes:String(fs.bavail*fs.bsize),spaceSufficient:fs.bavail*fs.bsize>=requiredBytes,remoteWrites:false};
}
export async function migrateViewsOnce({source,work,expectedSourceSHA256,b0File,b0SHA256,identity,master,backupKey,ledgerKey,remote,maintenanceSocket,stoppedSourceAcknowledgement}){
 if(stoppedSourceAcknowledgement!=='STOPPED_SOURCE_NEW_TARGET_ONLY')throw Error('Explicit stopped-source acknowledgement required');
 if(!/^196:0x[a-f0-9]{40}$/.test(identity))throw Error('Explicit mainnet identity required');
 for(const key of [master,backupKey,ledgerKey])if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Three explicit keys required');
 if(master.equals(backupKey)||master.equals(ledgerKey)||backupKey.equals(ledgerKey))throw Error('Independent keys required');
 if(!remote)throw Error('Conditional remote ledger store required');
 const proof=await requireMaintenance(maintenanceSocket),plan=migrationPlan({source,work});
 if(!/^[a-f0-9]{64}$/.test(expectedSourceSHA256)||plan.source.sha256!==expectedSourceSHA256)throw Error('Source manifest differs from approved checkpoint');
 if(!plan.spaceSufficient)throw Error('Migration disk reserve insufficient');
 const stateBytes=readFileSync(resolve(plan.source.dir,'state.enc'));
 if(!b0File||!isAbsolute(b0File)||! /^[a-f0-9]{64}$/.test(b0SHA256))throw Error('Reviewed encrypted B0 checkpoint required');
 noSymlinks(b0File);const b0Bytes=readFileSync(b0File);if(digest(b0Bytes)!==b0SHA256)throw Error('B0 checkpoint digest mismatch');
 const b0=decryptBackup(b0Bytes,backupKey);
 if(b0.identity!==identity||b0.master!==master.toString('hex')||!Buffer.from(b0.state,'base64').equals(stateBytes))throw Error('B0 checkpoint does not match source');
 for(const f of plan.source.files.filter(f=>f.path.startsWith('burn/'))){const id=f.path.slice(5,-4),body=b0.viewRecovery?.burnFiles?.[id];if(!body||digest(Buffer.from(JSON.stringify(body)))!==f.sha256)throw Error('B0 checkpoint missing source burn payload');}
 const service=Object.create(WalletService.prototype);service.master=master;service.identity=identity;
 const state=JSON.parse(service.unseal(JSON.parse(stateBytes)));
 if(state.identity!==identity||state.version!==2||state.viewLedgerRequired)throw Error('Only reviewed legacy v2 state allowed; never reinitialize a guarded ledger');
 if(!Array.isArray(state.messages)||!Array.isArray(state.convs)||!state.assets||!state.profiles)throw Error('Invalid legacy state schema');
 for(const m of state.messages)if(m.burn){if(!/^[a-f0-9]{32}$/.test(m.id))throw Error('Invalid message file identity');if(m.burnFile&&!m.destroyedAt&&!existsSync(resolve(plan.source.dir,'burn',m.id+'.enc')))throw Error('Unread source payload missing');if(m.payload)JSON.parse(service.unseal(m.payload));if(m.burnFile&&!m.destroyedAt)JSON.parse(service.unseal(JSON.parse(readFileSync(resolve(plan.source.dir,'burn',m.id+'.enc')))));}
 if(await remote.head())throw Error('Remote ledger already exists; inspect/recover instead of migrating again');await remote.assertEmpty();
 const assertStopped=async()=>{const p=await requireMaintenance(maintenanceSocket);if(p.pid!==proof.pid||sourceManifest(source).sha256!==expectedSourceSHA256)throw Error('Maintenance/source changed; keep public access blocked');};
 await assertStopped();
 mkdirSync(plan.work,{mode:0o700});
 const candidate=resolve(plan.work,'candidate'),ledger=resolve(plan.work,'ledger'),checkpoints=resolve(plan.work,'checkpoints');
 mkdirSync(candidate,{mode:0o700});mkdirSync(checkpoints,{mode:0o700});
 const release=lockWriter(ledger);
 try{
  // Retain exact stopped inputs in the new private work area; never overwrite originals.
  const original=resolve(plan.work,'original');mkdirSync(original,{mode:0o700});
  for(const f of plan.source.files){const bytes=readFileSync(resolve(plan.source.dir,f.path));if(digest(bytes)!==f.sha256)throw Error('Source changed while copying');for(const dest of [candidate,original]){if(f.path.startsWith('burn/'))mkdirSync(resolve(dest,'burn'),{recursive:true,mode:0o700});writeFileSync(resolve(dest,f.path),bytes,{flag:'wx',mode:0o600});}}
  service.dir=candidate;service.file=resolve(candidate,'state.enc');service.state=structuredClone(state);
  service.viewLedger=new ViewLedger({dir:ledger,key:ledgerKey,identity,create:true,remote,allowRemoteInitialize:true});
  service.initViews();service.save();
  const burnFiles={};for(const m of service.state.messages)if(m.burnFile&&!m.destroyedAt)burnFiles[m.id]=JSON.parse(readFileSync(resolve(candidate,'burn',m.id+'.enc')));
  const b1=encryptBackup({stateBytes:readFileSync(service.file),master,identity,viewRecovery:{head:service.viewLedger.head(),burnFiles}},backupKey);
  writeFileSync(resolve(checkpoints,'B1.backup.enc'),b1,{flag:'wx',mode:0o600});
  const rehearsal=resolve(plan.work,'rehearsal');restoreBackup({bytes:b1,key:backupKey,dir:rehearsal,expectedIdentity:identity,currentLedger:service.viewLedger,expectedLedgerHead:service.viewLedger.head()});
  const restored=JSON.parse(service.unseal(JSON.parse(readFileSync(resolve(rehearsal,'state.enc')))));
  if(JSON.stringify(restored.profiles)!==JSON.stringify(state.profiles)||JSON.stringify(restored.products)!==JSON.stringify(state.products)||JSON.stringify(restored.orderIndex)!==JSON.stringify(state.orderIndex))throw Error('Business data changed');
  await assertStopped();
  // Check maintenance and stopped source before EVERY remote write.
  const guarded=Object.create(remote);guarded.put=async row=>{await assertStopped();return remote.put(row)};guarded.advance=async(head,old)=>{await assertStopped();return remote.advance(head,old)};
  service.viewLedger.remote=guarded;await service.viewLedger.syncRemote();await assertStopped();
  const head=service.viewLedger.head(),confirmed=await remote.head();if(JSON.stringify(confirmed?.head)!==JSON.stringify(head))throw Error('Remote ledger head not confirmed');
  const receipt={status:'MIGRATED_NOT_PROMOTED',identity,sourceManifestSHA256:expectedSourceSHA256,b0SHA256,work:plan.work,head,checkpointSHA256:digest(b1),checkpointBytes:b1.length,sourceUnchanged:true,workerStarted:false,signatures:0,transactions:0,remoteCheckpointUploaded:false,publicAccess:'maintenance',remaining:'Upload/read back B0/B1 through a reviewed no-prune checkpoint workflow before promotion'};
  writeFileSync(resolve(plan.work,'migration-receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});return receipt;
 }finally{release();}
}
