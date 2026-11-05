// Read-only preflight. Does NOT switch deployments or rewrite databases.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {assertSafeRecoveryTarget} from '../server/release-policy.mjs';
const target=process.argv[2];if(!target)throw Error('Provide extracted rollback artifact root');
const manifest=JSON.parse(readFileSync(resolve(target,'server/safe-release.json')));assertSafeRecoveryTarget(manifest);
for(const [file,marker]of [['server/wallet-start.mjs',"SNAPVAULT_MAINTENANCE"],['server/wallet-http.mjs','requireVersion'],['server/view-ledger.mjs','ViewLedger']])if(!readFileSync(resolve(target,file),'utf8').includes(marker))throw Error('Rollback artifact lacks '+file);
console.log('Safe-capability preflight passed; no deployment executed. Keep current data and current independent ledger.');
