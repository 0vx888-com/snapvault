// Loopback-only TEST integration server. Never expose this server to the public internet.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, Contract, Wallet } from 'ethers';
import { DeliveryService } from './delivery.mjs';
import {createIntegrationServer} from './http.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),port=Number(process.env.PORT||5180),origin=`http://127.0.0.1:${port}`;
const configPath=process.env.SNAPVAULT_CONFIG||resolve(root,'config/live.json');
const config=existsSync(configPath)?JSON.parse(readFileSync(configPath)):null;
let service=null,setupReason='尚未配置合约和自动发送账户。可先连接钱包、检查测试网并部署测试付款合约。';
if(config){
 try{
  if(!process.env.RELAYER_KEYSTORE||!process.env.RELAYER_PASSWORD)throw new Error('缺少本机服务钱包加密 keystore 或解锁环境变量；不要向聊天提供它们');
  const provider=new JsonRpcProvider(config.rpc);
  const wallet=(await Wallet.fromEncryptedJson(readFileSync(process.env.RELAYER_KEYSTORE,'utf8'),process.env.RELAYER_PASSWORD)).connect(provider);
  const artifact=JSON.parse(readFileSync(resolve(root,'deployment/SnapVaultCheckout.json')));
  service=new DeliveryService({...config,provider,signer:wallet,vault:new Contract(config.vault,artifact.abi,provider),dir:resolve(root,'.snapvault-local'),origin});
 }catch(error){setupReason=error.message;}
}
const {server,stop}=createIntegrationServer({root,port,service,config,setupReason});
server.listen(port,'127.0.0.1',()=>console.log(`SnapVault 本机链上联调：${origin}/live.html（未部署、未广播交易）`));
process.on('SIGINT',stop);process.on('SIGTERM',stop);
