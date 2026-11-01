// Public runtime. Explicit 196 enablement, independent keys and verified deployment.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Wallet,Contract,keccak256} from 'ethers';
import {WalletService} from './wallet-service.mjs';
import {walletHttp} from './wallet-http.mjs';
import {networkPolicy} from './network-policy.mjs';
import {startWorkers} from './workers.mjs';
import {s3BackupFromEnv} from './s3-backup.mjs';
import {mainnetAppOrigins} from './wallet-origins.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=process.env.SNAPVAULT_WALLET_CONFIG_JSON?JSON.parse(process.env.SNAPVAULT_WALLET_CONFIG_JSON):JSON.parse(readFileSync(process.env.SNAPVAULT_WALLET_CONFIG||resolve(root,'config/wallet.json'),'utf8'));
const policy=networkPolicy(config);
const publicHost=process.env.RAILWAY_PUBLIC_DOMAIN;
if(publicHost){if(!/^[a-z0-9.-]+$/.test(publicHost))throw Error('Invalid public host');config.hosts=[...new Set([...(config.hosts||[]),publicHost])];config.origins=[...new Set([...(config.origins||[]),'https://'+publicHost])];}
if(process.env.RAILWAY_ENVIRONMENT_ID){const mount=process.env.RAILWAY_VOLUME_MOUNT_PATH;if(!mount||!config.dataDir||(resolve(config.dataDir)!==resolve(mount)&&!resolve(config.dataDir).startsWith(resolve(mount)+'/')))throw Error('Persistent volume/dataDir required');}
if(!Number.isSafeInteger(config.deploymentBlock)||config.deploymentBlock<=0)throw Error('Real deploymentBlock required');
if(!Array.isArray(config.origins)||!config.origins.length||config.origins.some(o=>{try{const u=new URL(o);return u.protocol!=='https:'||u.origin!==o;}catch{return true;}}))throw Error('Exact HTTPS origins required; no wildcard CORS');
if(policy.mainnet)config.origins=mainnetAppOrigins(config.origins);
async function signingWallet(prefix){const encrypted=process.env[prefix+'_KEYSTORE_JSON']||(process.env[prefix+'_KEYSTORE']?readFileSync(process.env[prefix+'_KEYSTORE'],'utf8'):null),password=process.env[prefix+'_PASSWORD'];if(!encrypted||!password)throw Error(prefix+' encrypted keystore/password required');return Wallet.fromEncryptedJson(encrypted,password);}
const provider=new JsonRpcProvider(config.rpc,config.chainId,{staticNetwork:true});if(Number(BigInt(await provider.send('eth_chainId',[])))!==config.chainId)throw Error('RPC chain mismatch');
const operator=await signingWallet('RELAYER');if(config.operator&&operator.address.toLowerCase()!==config.operator.toLowerCase())throw Error('Configured operator mismatch');
const artifact=JSON.parse(readFileSync(resolve(root,'artifacts/contracts/SnapVaultDirect.sol/SnapVaultDirect.json'),'utf8')),vault=new Contract(config.vault,artifact.abi,provider);
if((await vault.deliveryOperator()).toLowerCase()!==operator.address.toLowerCase()||Number(await vault.MAX_FEE_BPS())!==1500||await vault.DIRECT_TYPEHASH()===null)throw Error('Expected hardened SnapVaultDirect/operator');
if(policy.mainnet){if(!config.vaultBytecodeHash||keccak256(await provider.getCode(config.vault))!==config.vaultBytecodeHash)throw Error('Mainnet bytecode hash mismatch');if((await vault.owner()).toLowerCase()!==config.owner.toLowerCase()||(await vault.treasury()).toLowerCase()!==config.treasury.toLowerCase())throw Error('Owner/treasury mismatch');if(!config.dewebURL||!config.origins.includes(new URL(config.dewebURL).origin)||config.tapeSend.publicBaseURL!==new URL(config.dewebURL).origin||!config.testnetEvidenceSHA256)throw Error('Verified DeWEB origin and new testnet acceptance evidence required before mainnet runtime');}
const sender=config.tapeSend?.enabled?(await signingWallet('TAPESEND')).connect(provider):undefined;
const port=Number(process.env.PORT||5185),service=new WalletService({...config,provider,vault,operator,sender,dir:config.dataDir,masterKey:process.env.SNAPVAULT_MASTER_KEY,backupKey:process.env.SNAPVAULT_BACKUP_KEY,backupDir:config.backupDir,backupPutURL:process.env.SNAPVAULT_BACKUP_PUT_URL,backupStore:s3BackupFromEnv()});
await service.flushBackup();await service.syncOrders(true);
const server=walletHttp({service,root,port,allowedHosts:config.hosts||[],trustedProxy:!!process.env.RAILWAY_ENVIRONMENT_ID});
const stopWorkers=startWorkers(service,{onError:kind=>console.error(kind+' worker unavailable; new checkout fails closed when readiness is missing')});
server.listen(port,process.env.BIND||'127.0.0.1',()=>console.log('SnapVault ready on X Layer '+config.chainId+'; '+(policy.mainnet?'explicit mainnet mode':'testnet only')));
const stop=()=>{stopWorkers();server.close(()=>{provider.destroy();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
