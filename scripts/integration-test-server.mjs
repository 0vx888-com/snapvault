// Hermetic legacy UI boundary checks; no wallet, transactions or live RPC.
// These fixtures do not count as public-chain acceptance evidence.
import {getAddress} from 'ethers';
import {fileURLToPath} from 'node:url';
import {createIntegrationServer} from '../server/http.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),port=Number(process.env.PORT||5213);
const {server,stop}=createIntegrationServer({root,port,setupReason:'尚未配置合约和自动发送账户',paymentHandler:async(_root,hash)=>{if(hash)throw Error('部署交易哈希格式不符');return {configured:true,chainId:1952,creator:getAddress('0x1538ac2d29d03615d2336a2227900aab334d9402'),buyer:getAddress('0x6e87af3cc0907207505e3c45a1037385329009c9'),priceTestOKB:'0.00001',productionDeliveryReady:false,deployment:null};},readonlyRPC:async payload=>{const call=c=>{if(c.method!=='eth_chainId')throw Error('Only fixture chain identity is available');return {jsonrpc:'2.0',id:c.id,result:'0x7a0'};};return Array.isArray(payload)?payload.map(call):call(payload);}});
server.listen(port,'127.0.0.1');process.once('SIGTERM',stop);process.once('SIGINT',stop);
