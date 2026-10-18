import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {isIP} from 'node:net';
import {APP_FILES} from '../scripts/app-files.mjs';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
export function walletHttp({service,root,port,rpc=null,allowedHosts=[],trustedProxy=false,staticDir=null}){
 const origin=`http://127.0.0.1:${port}`;
 const tapeRoot=resolve(root,'public/tapesend'),tapeManifestPath=resolve(tapeRoot,'manifest.json'),tapeFiles=existsSync(tapeManifestPath)?JSON.parse(readFileSync(tapeManifestPath,'utf8')):{};
 const server=createServer(async(req,res)=>{
  const suppliedOrigin=req.headers.origin;
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};
  const send=(code,d)=>{const body=JSON.stringify(d,(_key,value)=>typeof value==='bigint'?value.toString():value);res.writeHead(code,{...headers,'Content-Type':'application/json'});res.end(body);};
  try{
   if(req.method==='GET'&&req.url==='/healthz'&&(req.headers.host==='healthcheck.railway.app'||req.headers.host===`127.0.0.1:${port}`||allowedHosts.includes(req.headers.host))){const config=await service.config();return send(200,{status:'ok',chainId:config.chainId,testnetOnly:config.chainId!==196});}
   if(req.headers.host!==`127.0.0.1:${port}`&&!allowedHosts.includes(req.headers.host))throw Object.assign(Error('Host 不允许'),{status:403});
   if(suppliedOrigin&&!service.origins.includes(suppliedOrigin))throw Object.assign(Error('网站来源不允许'),{status:403});
   if(suppliedOrigin){headers['Access-Control-Allow-Origin']=suppliedOrigin;headers['Access-Control-Allow-Headers']='Content-Type, Authorization';headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';}
   if(req.method==='OPTIONS'){res.writeHead(204,headers);return res.end();}
   const url=new URL(req.url,origin);
   if(url.pathname==='/tapesend'||url.pathname.startsWith('/tapesend/')){
    if(req.method!=='GET')return send(405,{error:'仅支持 GET'});
    if(url.pathname==='/tapesend'){res.writeHead(302,{...headers,Location:'/tapesend/'});return res.end();}
    const name=decodeURIComponent(url.pathname.slice('/tapesend/'.length))||'index.html';
    if(!Object.hasOwn(tapeFiles,name))return send(404,{error:'文件不存在'});
    const file=resolve(tapeRoot,name);if(!file.startsWith(tapeRoot+sep))return send(404,{error:'文件不存在'});
    const bytes=readFileSync(file);res.writeHead(200,{...headers,'Content-Type':mime[extname(file)]||'text/plain; charset=utf-8'});return res.end(bytes);
   }
   if(url.pathname==='/app-config.json'&&req.method==='GET'){const c=await service.config();return send(200,{mode:'wallet',apiBase:'',allowedChainIds:[c.chainId],allowMainnet:c.chainId===196&&c.mainnet===true});}
   if(url.pathname==='/api/wallet/config'&&req.method==='GET')return send(200,await service.config());
   if(url.pathname.startsWith('/api/wallet/blob/')&&req.method==='GET'){
    const hash=url.pathname.split('/').at(-1);if(!/^[a-f0-9]{64}$/.test(hash))throw Error('密文路径无效');const blob=service.blob(hash);res.writeHead(200,{...headers,'Content-Type':'application/octet-stream'});return res.end(blob);
   }
   if(url.pathname.startsWith('/api/')||url.pathname==='/rpc'){
    if(req.method!=='POST')return send(405,{error:'仅支持 POST'});
    // Wallet extensions omit Origin on local RPC; authenticated app endpoints require one.
    if(url.pathname!=='/rpc'&&!suppliedOrigin)return send(403,{error:'缺少网站来源'});
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>3_500_000)throw Error('请求超过 3.5 MB');chunks.push(chunk);}
    const b=JSON.parse(Buffer.concat(chunks).toString()||'{}');
    if(url.pathname==='/rpc'){
     if(!rpc||(await service.config()).chainId!==31337)return send(403,{error:'本地测试 RPC 未启用'});
     service.limit('rpc:'+req.socket.remoteAddress,600);
     const allowed=new Set(['eth_chainId','net_version','eth_blockNumber','eth_getBalance','eth_getCode','eth_call','eth_estimateGas','eth_gasPrice','eth_feeHistory','eth_maxPriorityFeePerGas','eth_getTransactionCount','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber','eth_getBlockByHash','eth_getLogs','eth_sendRawTransaction']);
     const calls=Array.isArray(b)?b:[b];if(!calls.length||calls.length>20)throw Error('RPC 批量请求无效');
     const results=[];for(const c of calls){if(!allowed.has(c.method))throw Error('不允许此 RPC 方法');try{results.push({jsonrpc:'2.0',id:c.id,result:await rpc(c.method,c.params||[])});}catch(e){results.push({jsonrpc:'2.0',id:c.id,error:{code:-32000,message:e.message}});}}
     return send(200,Array.isArray(b)?results:results[0]);
    }
    const forwarded=trustedProxy?String(req.headers['x-forwarded-for']||'').split(',').at(-1)?.trim():null;const client=isIP(forwarded||'')?forwarded:req.socket.remoteAddress;
    if(!req.headers.authorization&&['/api/wallet/state','/api/wallet/challenge','/api/wallet/login','/api/wallet/claim-open'].includes(url.pathname))service.limit('public:'+client,120);
    const action=url.pathname.slice('/api/wallet/'.length);if(!url.pathname.startsWith('/api/wallet/'))return send(404,{error:'接口不存在'});
    return send(200,await service.handle(action,b,req.headers.authorization?.replace(/^Bearer /,''),suppliedOrigin));
   }
   if(req.method!=='GET')return send(405,{error:'仅支持 GET'});
   const requested=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);if(!APP_FILES.includes(requested.slice(1))&&!['/app-config.json','/deweb-manifest.json'].includes(requested))return send(404,{error:'页面不存在'});
   const web=resolve(staticDir||resolve(root,'web')),file=resolve(web,'.'+requested);if(!file.startsWith(web+sep))throw Error('路径无效');
   const bytes=readFileSync(file);res.writeHead(200,{...headers,'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(bytes);
  }catch(e){if(res.headersSent){res.destroy();return;}send(e.status||400,{error:e.message});}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;
 return server;
}
