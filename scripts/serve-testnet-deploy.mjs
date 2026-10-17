import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {startWalletDeploy} from './serve-wallet-deploy.mjs';
if(!process.argv[2])throw Error('Provide testnet public setup directory');const s=JSON.parse(readFileSync(resolve(process.argv[2],'public.json')));await startWalletDeploy({setup:{...s,owner:s.owner||s.treasury},chainId:1952,port:5188});
