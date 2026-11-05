// Explicit recovery into a NEW directory. No delete, deploy, signing or chain RPC.
import {s3BackupFromEnv} from '../server/s3-backup.mjs';
import {S3ViewLedgerStore} from '../server/s3-view-ledger.mjs';
import {recoverViewLedger} from '../server/view-ledger.mjs';
import {secretKey} from '../server/backup.mjs';
const [action,dir]=process.argv.slice(2),identity=process.env.SNAPVAULT_EXPECT_IDENTITY,key=secretKey(process.env.SNAPVAULT_VIEW_LEDGER_KEY,'SNAPVAULT_VIEW_LEDGER_KEY');if(!/^196:0x[a-f0-9]{40}$/.test(identity||''))throw Error('Explicit chain/contract identity required');const store=s3BackupFromEnv();if(!store)throw Error('S3 ledger store required');const remote=new S3ViewLedgerStore({client:store.client,bucket:store.bucket,key,identity});if(action==='inspect'){console.log(JSON.stringify((await remote.head())?.head||null));}else if(action==='recover'&&dir){const expectedHead=JSON.parse(process.env.SNAPVAULT_EXPECT_LEDGER_HEAD||'null');const journal=await recoverViewLedger({remote,key,identity,expectedHead,dir});console.log(JSON.stringify({recovered:true,head:journal.head()}));}else throw Error('Usage: recover-view-ledger.mjs inspect | recover NEW_EMPTY_DIR');
