// Dedicated encrypted snapshots only. Keys never leave the server environment.
import {backupGeneration} from './backup-policy.mjs';
import {S3Client,PutObjectCommand,ListObjectsV2Command,DeleteObjectsCommand,HeadObjectCommand} from '@aws-sdk/client-s3';
export class S3BackupStore{
 constructor({endpoint,region,bucket,accessKeyId,secretAccessKey,forcePathStyle=false,retention=12,client,prune=true,generation}){
  const u=new URL(endpoint);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Backup S3 endpoint must be a plain HTTPS origin');
  if(!bucket||!region||!accessKeyId||!secretAccessKey)throw Error('Complete S3 backup credentials required');
  if(!Number.isInteger(retention)||retention<2||retention>100)throw Error('Invalid backup retention');
  this.generation=backupGeneration(generation);this.prune=prune;this.bucket=bucket;this.retention=retention;
  this.client=client||new S3Client({endpoint:u.origin,region,forcePathStyle,credentials:{accessKeyId,secretAccessKey},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 }
 prefix(identity){if(!/^196:0x[0-9a-f]{40}$/.test(identity))throw Error('Invalid encrypted backup identity');return 'snapvault/'+identity+'/'+(this.generation?'generations/'+this.generation+'/':'');}
 async verify({identity,sha256,bytes}){
  const head=await this.client.send(new HeadObjectCommand({Bucket:this.bucket,Key:this.prefix(identity)+'latest.backup.enc'}));
  if(head.ContentLength!==bytes||head.Metadata?.sha256!==sha256)throw Error('Remote backup missing or changed');
 }
 async trim(prefix,current){
  const folder=prefix+'snapshots/',keys=[];let cursor;
  for(let page=0;;page++){
   if(page>=100)throw Error('Backup listing limit exceeded; no new upload');
   const listed=await this.client.send(new ListObjectsV2Command({Bucket:this.bucket,Prefix:folder,...(cursor?{ContinuationToken:cursor}:{})}));
   for(const o of listed.Contents||[])if(o.Key?.startsWith(folder)&&/^\d+-[0-9a-f]+\.backup\.enc$/.test(o.Key.slice(folder.length)))keys.push(o.Key);
   if(!listed.IsTruncated)break;
   if(!listed.NextContinuationToken||listed.NextContinuationToken===cursor)throw Error('Backup listing truncated without progress');
   cursor=listed.NextContinuationToken;
  }
  // Reserve a slot before PUT: failures at either PUT cannot grow the prefix.
  // latest.backup.enc is a full encrypted copy and is never pruned here.
  const candidates=[...new Set(keys)].filter(k=>k!==current).sort();
  const remove=candidates.slice(0,Math.max(0,candidates.length-(this.retention-1)));
  for(let i=0;i<remove.length;i+=1000){const result=await this.client.send(new DeleteObjectsCommand({Bucket:this.bucket,Delete:{Objects:remove.slice(i,i+1000).map(Key=>({Key})),Quiet:true}}));if(result.Errors?.length)throw Error('Backup retention deletion failed');}
 }
 async put({bytes,name,identity,sha256}){
  if(!Buffer.isBuffer(bytes)||!/^\d+-[0-9a-f]+\.backup\.enc$/.test(name))throw Error('Invalid encrypted backup identity');
  const prefix=this.prefix(identity),snapshot=prefix+'snapshots/'+name;
  if(this.prune)await this.trim(prefix,snapshot);
  await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:snapshot,Body:bytes,ContentType:'application/octet-stream',Metadata:{sha256}}));
  await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:prefix+'latest.backup.enc',Body:bytes,ContentType:'application/octet-stream',Metadata:{sha256}}));
  return {remote:true};
 }
}
export function s3BackupFromEnv(env=process.env){
 const names=['ENDPOINT','REGION','BUCKET','ACCESS_KEY_ID','SECRET_ACCESS_KEY'];const v=Object.fromEntries(names.map(k=>[k,env['SNAPVAULT_BACKUP_S3_'+k]]));
 if(names.every(k=>!v[k]))return null;if(names.some(k=>!v[k]))throw Error('Partial S3 backup configuration');
 if(env.SNAPVAULT_BACKUP_PRUNING_PAUSED==='false'&&!backupGeneration(env.SNAPVAULT_BACKUP_GENERATION))throw Error('S3 pruning requires an isolated backup generation');
 return new S3BackupStore({endpoint:v.ENDPOINT,region:v.REGION,bucket:v.BUCKET,accessKeyId:v.ACCESS_KEY_ID,secretAccessKey:v.SECRET_ACCESS_KEY,prune:env.SNAPVAULT_BACKUP_PRUNING_PAUSED==='false',generation:env.SNAPVAULT_BACKUP_GENERATION,forcePathStyle:env.SNAPVAULT_BACKUP_S3_PATH_STYLE==='true'});
}
