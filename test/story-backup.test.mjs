import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,unlinkSync,statSync,readdirSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {WalletService} from '../server/wallet-service.mjs';
import {decryptBackup,encryptBackup,restoreBackup} from '../server/backup.mjs';
import {collectStoryFiles,validateStoryFiles} from '../server/story-backup.mjs';
import {startWorkers} from '../server/workers.mjs';
const alice='0x'+'11'.repeat(20),bob='0x'+'22'.repeat(20),eve='0x'+'33'.repeat(20),image=readFileSync(new URL('../screenshots/sample.png',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'sv-story-backup-')),master=randomBytes(32),key=randomBytes(32),objects=new Map(),store={generation:'g-story-test',put:async({name,bytes})=>{objects.set(name,Buffer.from(bytes));objects.set('latest',Buffer.from(bytes));},verify:async({sha256})=>assert.equal(hash(objects.get('latest')),sha256)};
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const config={dir:join(root,'live'),ledgerDir:join(root,'ledger'),origins:['http://local.test'],allowLocalKeyFile:true,masterKey:master.toString('hex'),backupKey:key.toString('hex'),backupDir:join(root,'backups'),backupGeneration:store.generation,backupStore:store,operator:{address:alice},provider:{getNetwork:async()=>({chainId:31337})},vault:{target:'0x'+'44'.repeat(20)}};
 const s=new WalletService(config);s.state.friends=[{from:alice,to:bob,status:'accepted'}];s.save();
 const publish=()=>s.publishSocial({kind:'story',scope:'friends',title:'Temporary',mime:'image/png',image:image.toString('base64')},alice);
 const restore=(bytes=objects.get('latest'),dir=join(root,'restored'))=>{restoreBackup({bytes,key,dir,expectedIdentity:s.identity,currentLedger:s.viewLedger,expectedLedgerHead:s.viewLedger.head()});return dir;};
 return {root,master,key,objects,config,s,publish,restore,restart:dir=>new WalletService({...config,dir})};
}
function repack(f,mutate){const p=decryptBackup(f.objects.get('latest'),f.key);mutate(p);return encryptBackup({stateBytes:Buffer.from(p.state,'base64'),master:Buffer.from(p.master,'hex'),identity:p.identity,viewRecovery:p.viewRecovery,storyFiles:p.storyFiles},f.key);}
test('runtime backup restores exact live image, permissions and original expiry from fake remote ciphertext',async t=>{
 const f=fixture(t),p=f.publish();await f.s.flushBackup();const before=hash(readFileSync(f.s.file)),source=hash(readFileSync(f.s.storyPath(p.id))),bytes=f.objects.get('latest');assert(!bytes.includes(image));const payload=decryptBackup(bytes,f.key);assert(payload.storyFiles[p.id]);assert(!JSON.stringify(payload.storyFiles).includes(image.toString('base64')));
 const dir=f.restore(),s=f.restart(dir);assert.equal(s.openSocial({id:p.id},bob).image,image.toString('base64'));assert.throws(()=>s.openSocial({id:p.id},eve),/权限/);assert.equal(s.state.socialStories[p.id].expiresAt,p.expiresAt);assert.equal(statSync(s.storyPath(p.id)).mode&0o777,0o600);assert.equal(hash(readFileSync(f.s.file)),before);assert.equal(hash(readFileSync(f.s.storyPath(p.id))),source);
});
test('image expires while offline: restoration writes no expired file and startup removes metadata',async t=>{
 const f=fixture(t),p=f.publish();await f.s.flushBackup();const bytes=Buffer.from(f.objects.get('latest'));t.mock.method(Date,'now',()=>p.expiresAt+1);const dir=f.restore(bytes);assert(!existsSync(join(dir,'stories',p.id+'.enc')));const s=f.restart(dir);assert.equal(s.socialState(bob).stories.length,0);assert.throws(()=>s.openSocial({id:p.id},bob),/不存在|过期/);assert(!existsSync(s.storyPath(p.id)));assert.deepEqual(f.objects.get('latest'),bytes);
});
test('scheduled expiry physically deletes live file and new backup omits it; old snapshots stay untouched',async t=>{
 const f=fixture(t),p=f.publish();await f.s.flushBackup();const old=new Map(f.objects),errs=[];t.mock.method(Date,'now',()=>p.expiresAt+1);const stop=startWorkers(f.s,{deliveryEnabled:false,scanMs:100000,backupMs:100000,onError:k=>errs.push(k)});try{await new Promise(r=>setTimeout(r,1200));}finally{stop();}assert.deepEqual(errs,[]);assert(!existsSync(f.s.storyPath(p.id)));assert(!f.s.state.socialStories[p.id]);await f.s.flushBackup();assert.deepEqual(decryptBackup(f.objects.get('latest'),f.key).storyFiles,{});for(const[k,v]of old)if(k!=='latest')assert.deepEqual(f.objects.get(k),v);
});
test('missing live file fails backup and sweep without deleting metadata or replacing completed snapshot',async t=>{
 const f=fixture(t),p=f.publish();await f.s.flushBackup();const old=Buffer.from(f.objects.get('latest'));unlinkSync(f.s.storyPath(p.id));await assert.rejects(f.s.flushBackup(),/Story image missing/);assert.throws(()=>f.s.sweepSocial(),/文件缺失/);assert(f.s.state.socialStories[p.id]);assert.deepEqual(f.objects.get('latest'),old);const s=f.restart(f.restore(old));assert.equal(s.openSocial({id:p.id},bob).image,image.toString('base64'));
});
test('corrupt live ciphertext cannot be uploaded or accepted as complete',async t=>{
 const f=fixture(t),p=f.publish();await f.s.flushBackup();const old=Buffer.from(f.objects.get('latest'));const e=JSON.parse(readFileSync(f.s.storyPath(p.id)));e.tag=Buffer.alloc(16).toString('base64');writeFileSync(f.s.storyPath(p.id),JSON.stringify(e));await assert.rejects(f.s.flushBackup(),/authentication/);assert.deepEqual(f.objects.get('latest'),old);
});
test('missing, corrupt and wrong-MIME recovery media fail before creating recovery output',async t=>{
 const f=fixture(t),p=f.publish();await f.s.flushBackup();for(const[mode,mutate]of Object.entries({missing:p=>delete p.storyFiles,corrupt:p=>p.storyFiles[Object.keys(p.storyFiles)[0]].tag=Buffer.alloc(16).toString('base64'),wrongMime:p=>p.storyFiles[Object.keys(p.storyFiles)[0]]=f.s.seal(Buffer.from('<svg/>'))})){
  const bytes=repack(f,mutate),dir=join(f.root,mode);assert.throws(()=>f.restore(bytes,dir),/Story image/);assert(!existsSync(dir));
 }
});
test('old snapshots without Story files restore when there is no live Story, but do not revive expired images',async t=>{
 const f=fixture(t);await f.s.flushBackup();assert(existsSync(join(f.restore(repack(f,p=>delete p.storyFiles),join(f.root,'old-empty')),'state.enc')));const p=f.publish();await f.s.flushBackup();const bytes=repack(f,p=>delete p.storyFiles);t.mock.method(Date,'now',()=>p.expiresAt);const dir=f.restore(bytes,join(f.root,'old-expired'));assert(!existsSync(join(dir,'stories')));assert.equal(f.restart(dir).socialState(bob).stories.length,0);
});
test('same image deduplicates; changed ciphertext is included in dedup input and a fresh snapshot',async t=>{
 const f=fixture(t),p=f.publish();await f.s.flushBackup();assert.equal((await f.s.flushBackup()).skipped,true);const old=Buffer.from(f.objects.get('latest'));writeFileSync(f.s.storyPath(p.id),JSON.stringify(f.s.seal(image)));assert.notEqual((await f.s.flushBackup()).skipped,true);assert.notDeepEqual(f.objects.get('latest'),old);assert.equal(f.restart(f.restore()).openSocial({id:p.id},bob).image,image.toString('base64'));
});
test('a Story deleted since the snapshot cannot be revived against the current view ledger',async t=>{
 const f=fixture(t),p=f.publish();await f.s.flushBackup();const old=Buffer.from(f.objects.get('latest'));f.s.deleteSocial({id:p.id},alice);assert.throws(()=>f.restore(old),/newer business writes/);assert(!existsSync(f.s.storyPath(p.id)));
});
test('recovery refuses any occupied directory and rejects path traversal in Story metadata',async t=>{
 const f=fixture(t),p=f.publish();await f.s.flushBackup();const dir=join(f.root,'occupied');mkdirSync(dir);writeFileSync(join(dir,'keep'),'preserve');assert.throws(()=>f.restore(undefined,dir),/overwrite/);assert.equal(readFileSync(join(dir,'keep'),'utf8'),'preserve');assert.deepEqual(readdirSync(dir),['keep']);const bad={socialStories:{'../escape':{id:'../escape',expiresAt:Date.now()+1000,mime:'image/png'}}};assert.throws(()=>collectStoryFiles({state:bad,dir:f.s.dir,master:f.master}),/metadata/);assert.throws(()=>validateStoryFiles({state:bad,master:f.master}),/metadata/);
});
test('offline backup CLI also includes Story media and never changes its source or old backup files',async t=>{
 const f=fixture(t),p=f.publish(),before=readFileSync(f.s.file),oldFile=join(f.root,'old.backup.enc');writeFileSync(oldFile,'untouched');const out=join(f.root,'manual.backup.enc');execFileSync(process.execPath,['scripts/backup-state.mjs','create',f.s.dir,out],{cwd:process.cwd(),env:{...process.env,SNAPVAULT_MASTER_KEY:f.master.toString('hex'),SNAPVAULT_BACKUP_KEY:f.key.toString('hex'),SNAPVAULT_VIEW_LEDGER_KEY:f.master.toString('hex'),SNAPVAULT_CURRENT_LEDGER_DIR:f.config.ledgerDir}});const bytes=readFileSync(out);assert(decryptBackup(bytes,f.key).storyFiles[p.id]);assert.deepEqual(readFileSync(f.s.file),before);assert.equal(readFileSync(oldFile,'utf8'),'untouched');assert.equal(f.restart(f.restore(bytes)).openSocial({id:p.id},bob).image,image.toString('base64'));
});

test('a restored live Story is physically removed at its original deadline by the expiry worker',async t=>{
 const f=fixture(t),p=f.publish();await f.s.flushBackup();const dir=f.restore(),restored=f.restart(dir);assert(existsSync(restored.storyPath(p.id)));t.mock.method(Date,'now',()=>p.expiresAt+1);const errors=[],stop=startWorkers(restored,{deliveryEnabled:false,scanMs:100000,backupMs:100000,onError:k=>errors.push(k)});try{await new Promise(r=>setTimeout(r,1200));}finally{stop();}assert.deepEqual(errors,[]);assert(!existsSync(restored.storyPath(p.id)));assert.equal(restored.socialState(bob).stories.length,0);assert.throws(()=>restored.openSocial({id:p.id},bob),/不存在|过期/);
});
