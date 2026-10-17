// Shared loopback HTTP boundary for the integration app and isolated local verification.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {paymentProbe} from './payment-probe.mjs';
export function createIntegrationServer({root,port,service=null,config=null,setupReason='交付服务未配置',local=null}) {
 const origin=`http://127.0.0.1:${port}`;
const json=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(obj));};
async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>3_000_000)throw new Error('请求超过 3 MB');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}` || (req.headers.origin&&req.headers.origin!==origin)){json(res,403,{error:'只接受此本机页面的请求'});return;}
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/local/')){
   if(!local||req.method!=='POST')throw Error('完整本地交付模式未启用');
   json(res,200,await local(url.pathname.slice('/api/local/'.length),await body(req)));return;
  }
  if(url.pathname==='/api/testnet-rpc'){
   if(req.method!=='POST')throw new Error('仅支持 POST');
   const payload=await body(req),calls=Array.isArray(payload)?payload:[payload];
   const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionCount','eth_getBalance','eth_gasPrice','eth_maxPriorityFeePerGas','eth_estimateGas','eth_call','eth_getCode','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getLogs','eth_feeHistory']);
   if(!calls.length||calls.length>20||calls.some(c=>!c||c.jsonrpc!=='2.0'||!allowed.has(c.method)||!Array.isArray(c.params)))throw new Error('只读测试网 RPC：不允许签名或广播方法');
   const upstream=await fetch('https://testrpc.xlayer.tech/terigon',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
   if(!upstream.ok)throw new Error('官方测试网 RPC 返回 '+upstream.status);
   json(res,200,await upstream.json());return;
  }
  if(url.pathname==='/api/payment-test'){
   if(req.method!=='GET'&&req.method!=='POST')throw new Error('不支持此请求');
   const b=req.method==='POST'?await body(req):{};json(res,200,await paymentProbe(root,b.transactionHash));return;
  }
  if(url.pathname==='/api/status'){
   let ready=false,reason=setupReason; if(service){try{await service.ready();ready=true;reason='本地官方协议联调已就绪';}catch(error){reason=error.message;}}
   json(res,200,{ready,reason,chainId:config?.chainId||1952,vault:config?.vault||null,hub:config?.hub||'0xe61a9c7213a6aa616c246a2b569e555b417b25ee',operator:service?.signer.address||null,publicTestnetTapeSend:false});return;
  }
  if(url.pathname.startsWith('/api/')){
   if(!service)throw new Error(setupReason);
   if(req.method==='GET'&&/^\/api\/blob\/[a-f0-9]{64}$/.test(url.pathname)){const data=readFileSync(resolve(service.dir,url.pathname.split('/').at(-1)+'.bin'));res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'});res.end(data);return;}
   if(req.method!=='POST')throw new Error('不支持此请求');const b=await body(req);
   if(url.pathname==='/api/challenge'){if(!/^0x[0-9a-fA-F]{40}$/.test(b.address))throw new Error('地址无效');json(res,200,{nonce:service.challenge(b.address)});}
   else if(url.pathname==='/api/upload'){await service.ready();json(res,200,service.upload(b));}
   else if(url.pathname==='/api/quote')json(res,200,await service.quote(b));
   else if(url.pathname==='/api/open')json(res,200,await service.open(b.id,b.claim));
   else if(url.pathname==='/api/order'){
    // Poll a public event reference; never return raw transactions, keys or claim hashes.
    const result=await service.deliver(b.id,b.buyer);json(res,200,{status:result.status,transactionHash:result.tx});
   }else json(res,404,{error:'接口不存在'});return;
  }
  if(req.method!=='GET')throw new Error('不支持此请求');
  const web=resolve(root,'web'),pathname=decodeURIComponent(url.pathname==='/'?'/live.html':url.pathname),file=resolve(web,'.'+pathname);
  if(!file.startsWith(web+sep))throw new Error('路径无效');
  const data=readFileSync(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(data);
 }catch(error){json(res,400,{error:error.message});}
});
let scanning=false;
const timer=setInterval(async()=>{if(!service||scanning)return;scanning=true;try{await service.scan();}catch(error){/* readiness shown via /api/status; do not flood logs */}finally{scanning=false;}},5000);

return {server,stop:()=>{clearInterval(timer);return new Promise(resolve=>server.close(resolve));}};
}
