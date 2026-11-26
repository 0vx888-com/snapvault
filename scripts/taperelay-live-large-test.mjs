// Real-node test using synthetic bytes only. Credentials and resumable private
// material stay in the user's private directory, never the repository or logs.
import {readFileSync,writeFileSync,mkdirSync,existsSync,statSync,lstatSync,openSync,closeSync,writeSync,renameSync,openAsBlob} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createClient,developerKeyAuth,describeDeveloperKey,serversOfKey,publicKeyOf,generateKeyPair,planEncryptedFile,planEncryptedResume,resumableOf,uploadToServers,openEnvelope,openEncryptedFileWithKey} from '../vendor/taperelay-client/src/taperelay.mjs';
const SIZE=200*1048576-8192,STEP=1048576;
const folder=join(homedir(),'Library','Application Support','SnapVault','secrets');
const dir=join(folder,'large-check-20261126-v1'),journal=join(dir,'resume.json'),sourceFile=join(dir,'synthetic.bin');
const log=(x)=>console.log(JSON.stringify(x));
const codeOf=(e)=>/^[a-z0-9-]{1,64}$/.test(e?.code)?e.code:'test-failed';
const b64=(x)=>Buffer.from(x).toString('base64');
const un64=(x)=>new Uint8Array(Buffer.from(x,'base64'));
let stage='setup',plan,timer;
try{
  if(!['--prepare-interrupt','--resume'].some(a=>process.argv.includes(a)))throw Error('explicit-mode-required');
  if(lstatSync(folder).isSymbolicLink()||(statSync(folder).mode&0o777)!==0o700)throw Error('private-directory-permissions');
  for(const file of ['taperelay.env','taperelay-self-secret'])if((statSync(join(folder,file)).mode&0o777)!==0o600)throw Error('credential-file-permissions');
  const devKey=/^TAPERELAY_KEY=(trk1_[A-Za-z0-9_-]+)\s*$/m.exec(readFileSync(join(folder,'taperelay.env'),'utf8'))?.[1];
  const auth=developerKeyAuth(devKey),description=describeDeveloperKey(devKey),servers=serversOfKey(devKey);
  if(description.account!=='1408.2.265.tape'||servers.length!==3||['relay1.taperelay.com:4246','relay4.taperelay.com:4246','relay5.taperelay.com:4246'].some(s=>!servers.includes(s)))throw Error('unexpected-circuit-or-nodes');
  const secret=readFileSync(join(folder,'taperelay-self-secret'),'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(secret))throw Error('persistent-secret-format');
  const self={secretKey:Buffer.from(secret,'hex')};self.publicKey=publicKeyOf(self.secretKey);
  const client=createClient({timeoutMs:60000});
  const usage=await Promise.all(servers.map(async server=>({server,...(await client.request(server,{path:'/v1/usage/'+auth.account,auth})).json})));
  for(const u of usage)if(u.quota?.storageBytes-u.storedBytes<SIZE*2+STEP)throw Error('insufficient-existing-quota');
  log({stage:'existing-free-quota-checked',bytes:SIZE,productionEnabled:false,paymentTransactions:0,usage:usage.map(u=>({server:u.server,storedBytes:u.storedBytes,quotaBytes:u.quota.storageBytes}))});
  if(!existsSync(dir))mkdirSync(dir,{mode:0o700});
  if(lstatSync(dir).isSymbolicLink()||(statSync(dir).mode&0o777)!==0o700)throw Error('test-directory-permissions');
  const save=(data)=>{const tmp=journal+'.tmp';writeFileSync(tmp,JSON.stringify(data),{mode:0o600});renameSync(tmp,journal);};
  let record;
  if(existsSync(journal)){
    if((statSync(journal).mode&0o777)!==0o600||lstatSync(journal).isSymbolicLink())throw Error('resume-file-permissions');
    record=JSON.parse(readFileSync(journal,'utf8'));
    if(record.size!==SIZE||record.circuit!==auth.account||record.servers.join(',')!==servers.join(','))throw Error('resume-context-mismatch');
  }else{
    if(!process.argv.includes('--prepare-interrupt')||existsSync(sourceFile))throw Error('prepare-mode-or-clean-directory-required');
    stage='generate-synthetic-file';const fd=openSync(sourceFile,'wx',0o600);
    try{for(let at=0;at<SIZE;at+=STEP)writeSync(fd,randomBytes(Math.min(STEP,SIZE-at)));}finally{closeSync(fd);}
  }
  const blob=await openAsBlob(sourceFile,{type:'application/octet-stream'});
  if(blob.size!==SIZE)throw Error('source-size-mismatch');
  stage='check-full-file-hash';const original=createHash('sha256');
  for(let at=0;at<SIZE;at+=STEP)original.update(new Uint8Array(await blob.slice(at,Math.min(SIZE,at+STEP)).arrayBuffer()));
  const sourceSha=original.digest('hex');
  if(record){
    if(record.sourceSha!==sourceSha)throw Error('source-hash-mismatch');
    stage='restore-saved-plan';
    plan=await planEncryptedResume(blob,{saved:{envelope:un64(record.envelope),index:record.index.map(un64),nonces:un64(record.nonces)},keyPairs:[{secretKey:un64(record.ephemeralSecret),publicKey:un64(record.ephemeralPublic)}]});
    if(plan.envelope.sha256!==record.envelopeSha)throw Error('restored-envelope-mismatch');
    log({stage:'saved-plan-restored-in-new-process',bytes:SIZE,sourceHashMatched:true,sameEnvelope:true,priorInterruption:record.interruptionObserved===true});
  }else{
    stage='create-encrypted-plan';const ephemeral=generateKeyPair();
    plan=await planEncryptedFile(blob,{name:'SnapVault retained large transport test.bin',contentType:blob.type,from:auth.account,selfKey:self.publicKey,to:[ephemeral.publicKey]});
    const saved=resumableOf(plan);
    record={version:1,size:SIZE,circuit:auth.account,servers,sourceSha,envelopeSha:plan.envelope.sha256,envelope:b64(saved.envelope),index:saved.index.map(b64),nonces:b64(saved.nonces),ephemeralSecret:b64(ephemeral.secretKey),ephemeralPublic:b64(ephemeral.publicKey),interruptionObserved:false,verifiedNodes:[],createdAt:new Date().toISOString()};
    save(record);ephemeral.secretKey.fill(0);
    log({stage:'resume-state-persisted-privately',bytes:SIZE,permissions:'600',containsDeveloperKey:false});
  }
  const progress=new Map(),start=Date.now();
  timer=setInterval(()=>log({stage,elapsedSeconds:Math.round((Date.now()-start)/1000),progress:[...progress.values()]}),20000);
  if(process.argv.includes('--prepare-interrupt')){
    if(record.interruptionObserved)throw Error('interruption-already-tested-use-resume');
    stage='intentional-interruption';const abort=new AbortController();
    const partial=await uploadToServers(client,servers,auth,null,{plan,signal:abort.signal,retryMs:[],onProgress:x=>{progress.set(x.server,x);if(x.done>=3)abort.abort();}});
    const final=await partial.settled;
    if(partial.stored||!abort.signal.aborted)throw Error('interruption-not-observed');
    record.interruptionObserved=true;record.interruptedAt=new Date().toISOString();save(record);
    log({stage:'interrupted-and-saved',bytes:SIZE,stored:false,nextStep:'Run --resume in a new process',failed:final.failed.map(x=>({server:x.server,code:x.code}))});
  }else{
    if(!record.interruptionObserved)throw Error('interruption-must-be-verified-first');
    stage='resuming-real-nodes';
    const result=await uploadToServers(client,servers,auth,null,{plan,retryMs:[1000,5000],onProgress:x=>{progress.set(x.server,x);if(x.done%25===0||x.done===x.total)log({stage:'upload-progress',...x});}});
    const final=await result.settled;
    record.uploadedNodes=final.ok;record.lastFailures=final.failed.map(x=>({server:x.server,code:x.code}));save(record);
    log({stage:'upload-result',stored:final.ok.length>=2,replicas:final.ok.length,ok:final.ok,failed:record.lastFailures});
    const opened=openEnvelope(plan.envelope.bytes,[self]);
    for(const server of final.ok){
      if(record.verifiedNodes.includes(server))continue;
      stage='decrypt-and-hash-'+server;const reader=await openEncryptedFileWithKey(client,[server],plan.envelope.sha256,opened.fileKey);
      const hash=createHash('sha256');
      try{for(let at=0;at<SIZE;at+=STEP){hash.update(await reader.read(at,Math.min(SIZE,at+STEP)));progress.set(server,{server,readBytes:Math.min(SIZE,at+STEP),totalBytes:SIZE});}}finally{reader.close();}
      if(hash.digest('hex')!==record.sourceSha)throw Error('decrypted-hash-mismatch');
      record.verifiedNodes.push(server);save(record);log({stage:'node-decryption-verified',server,bytes:SIZE,sha256Matched:true});
    }
    opened.fileKey.fill(0);self.secretKey.fill(0);
    const passed=record.verifiedNodes.length===3&&final.ok.length===3;
    if(passed){record.completedAt=new Date().toISOString();save(record);}
    log({stage:'large-transfer-test-result',passed,bytes:SIZE,realNodesVerified:record.verifiedNodes,interruptionObserved:true,processRestartResume:true,browserTested:false,phoneTested:false});
    if(!passed)process.exitCode=1;
  }
}catch(e){log({stage:'test-stopped',during:stage,code:codeOf(e),assertionName:e?.name==='AssertionError'?'AssertionError':undefined,resumeStatePreserved:existsSync(journal)});process.exitCode=1;}
finally{clearInterval(timer);plan?.dispose();}
