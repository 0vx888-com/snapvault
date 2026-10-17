import {readFileSync} from 'node:fs';import {startWalletDeploy} from './serve-wallet-deploy.mjs';
if(!process.argv[2])throw Error('Provide reviewed public mainnet setup JSON; owner/treasury must be YOUR addresses, never a private key');const setup=JSON.parse(readFileSync(process.argv[2]));await startWalletDeploy({setup,chainId:196,port:5199});
