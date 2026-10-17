// Public TESTNET service entry. HTTPS is provided by the hosting reverse proxy.
// No unlocked wallets, local funding helpers or RPC write proxy are registered.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Wallet,Contract} from 'ethers';
import {WalletService} from './wallet-service.mjs';
import {walletHttp} from './wallet-http.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=process.env.SNAPVAULT_WALLET_CONFIG_JSON?JSON.parse(process.env.SNAPVAULT_WALLET_CONFIG_JSON):JSON.parse(readFileSync(process.env.SNAPVAULT_WALLET_CONFIG||resolve(root,'config/wallet.json'),'utf8'));
const publicHost=process.env.RAILWAY_PUBLIC_DOMAIN;
if(publicHost){if(!/^[a-z0-9.-]+$/.test(publicHost))throw Error('公开域名格式无效');config.hosts=[...new Set([...(config.hosts||[]),publicHost])];config.origins=[...new Set([...(config.origins||[]),'https://'+publicHost])];}
if(process.env.RAILWAY_ENVIRONMENT_ID){const mount=process.env.RAILWAY_VOLUME_MOUNT_PATH;if(!mount||!config.dataDir||(resolve(config.dataDir)!==resolve(mount)&&!resolve(config.dataDir).startsWith(resolve(mount)+'/')))throw Error('公开服务必须挂载持久卷，并把 dataDir 放在卷内');}
if(!Number.isSafeInteger(config.deploymentBlock)||config.deploymentBlock<=0)throw Error('需要新合约的真实部署区块，不得从区块 0 扫描测试网');
if(config.chainId!==1952)throw Error('仅允许 X Layer 测试网 1952，正式主网上线需单独审核与授权');
if(!Array.isArray(config.origins)||!config.origins.length||config.origins.some(o=>{try{const u=new URL(o);return u.protocol!=='https:'||u.origin!==o;}catch{return true;}}))throw Error('明确配置实际 DeWEB HTTPS 来源，不接受通配 CORS');
if((!process.env.RELAYER_KEYSTORE&&!process.env.RELAYER_KEYSTORE_JSON)||!process.env.RELAYER_PASSWORD)throw Error('需在托管环境配置服务签名钱包的加密 keystore 与密码，不要发到聊天');
const provider=new JsonRpcProvider(config.rpc,1952,{staticNetwork:true});if(Number(BigInt(await provider.send('eth_chainId',[])))!==1952)throw Error('RPC chainId 不符');
const operator=await Wallet.fromEncryptedJson(process.env.RELAYER_KEYSTORE_JSON||readFileSync(process.env.RELAYER_KEYSTORE,'utf8'),process.env.RELAYER_PASSWORD);
const artifact=JSON.parse(readFileSync(resolve(root,'artifacts/contracts/SnapVaultDirect.sol/SnapVaultDirect.json'),'utf8')),vault=new Contract(config.vault,artifact.abi,provider);
if((await vault.deliveryOperator()).toLowerCase()!==operator.address.toLowerCase())throw Error('服务签名地址与合约不符');
const port=Number(process.env.PORT||5185),service=new WalletService({provider,vault,operator,dir:config.dataDir||resolve(root,'.snapvault-wallet'),origins:config.origins,confirmations:config.confirmations||3,deploymentBlock:config.deploymentBlock||0});
const server=walletHttp({service,root,port,allowedHosts:config.hosts||[]});
server.listen(port,process.env.BIND||'127.0.0.1',()=>console.log('SnapVault authenticated X Layer testnet service ready; mainnet disabled.'));

const stop=()=>{server.close(()=>{provider.destroy();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
