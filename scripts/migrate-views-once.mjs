// Default plan is read-only. Execute is NEVER called by normal server startup.
import {migrationPlan,migrateViewsOnce} from '../server/offline-view-migration.mjs';
import {secretKey} from '../server/backup.mjs';
import {s3BackupFromEnv} from '../server/s3-backup.mjs';
import {S3ViewLedgerStore} from '../server/s3-view-ledger.mjs';
const [action,source,work]=process.argv.slice(2);
try{
 if(!source||!work||!['plan','execute'].includes(action))throw Error('Usage: migrate-views-once.mjs plan|execute SOURCE NEW_WORK_DIR');
 if(action==='plan')console.log(JSON.stringify(migrationPlan({source,work}),null,2));
 else{
  if(process.env.SNAPVAULT_MAINTENANCE!=='true')throw Error('Maintenance mode required');
  const identity=process.env.SNAPVAULT_EXPECT_IDENTITY,ledgerKey=secretKey(process.env.SNAPVAULT_VIEW_LEDGER_KEY,'SNAPVAULT_VIEW_LEDGER_KEY'),store=s3BackupFromEnv();if(!store)throw Error('S3 configuration required');
  const remote=new S3ViewLedgerStore({client:store.client,bucket:store.bucket,key:ledgerKey,identity});
  try{console.log(JSON.stringify(await migrateViewsOnce({source,work,identity,ledgerKey,remote,master:secretKey(process.env.SNAPVAULT_MASTER_KEY,'SNAPVAULT_MASTER_KEY'),backupKey:secretKey(process.env.SNAPVAULT_BACKUP_KEY,'SNAPVAULT_BACKUP_KEY'),expectedSourceSHA256:process.env.SNAPVAULT_APPROVED_SOURCE_SHA256,b0File:process.env.SNAPVAULT_MIGRATION_B0_FILE,b0SHA256:process.env.SNAPVAULT_MIGRATION_B0_SHA256,maintenanceSocket:process.env.SNAPVAULT_MAINTENANCE_SOCKET,stoppedSourceAcknowledgement:process.env.SNAPVAULT_MIGRATION_ACK}),null,2));}finally{store.client.destroy();}
 }
}catch(e){console.error(JSON.stringify({status:'STOPPED',errorType:e.name,sourceWritten:false,promoted:false,note:'Keep maintenance. Inspect the private work area; do not retry into another directory or reinitialize the remote ledger.'}));process.exitCode=1;}
