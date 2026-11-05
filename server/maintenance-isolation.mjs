// Local-only maintenance proof. Never exposes a migration endpoint on the public API.
import {createServer,request} from 'node:http';
import {lstatSync,chmodSync,unlinkSync,existsSync} from 'node:fs';
import {isAbsolute} from 'node:path';
export function maintenanceControl(publicServer,socketPath){
 if(!isAbsolute(socketPath)||existsSync(socketPath))throw Error('Maintenance socket must be a new absolute path');
 let owned;
 const control=createServer((req,res)=>{
  const active=publicServer.listening;
  res.writeHead(active&&req.method==='GET'&&req.url==='/status'?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify({protocol:'snapvault-maintenance-v1',maintenance:active,ready:false,writerEnabled:false,deliveryEnabled:false,pid:process.pid}));
 });
 control.on('error',()=>{publicServer.close();});
 control.listen(socketPath,()=>{chmodSync(socketPath,0o600);owned=lstatSync(socketPath).ino;});
 publicServer.once('close',()=>control.close(()=>{if(owned&&existsSync(socketPath)&&lstatSync(socketPath).ino===owned)unlinkSync(socketPath);}));
 return control;
}
export async function requireMaintenance(socketPath){
 if(!socketPath||!isAbsolute(socketPath))throw Error('Local maintenance socket required');
 const st=lstatSync(socketPath);
 if(!st.isSocket()||(st.mode&0o077)!==0||(process.getuid&&st.uid!==process.getuid()))throw Error('Maintenance socket ownership/mode invalid');
 return new Promise((resolve,reject)=>{
  const req=request({socketPath,path:'/status',method:'GET'},res=>{let body='';res.on('data',b=>{body+=b;if(body.length>4096)req.destroy(Error('Invalid maintenance proof'));});res.on('end',()=>{try{const p=JSON.parse(body);if(res.statusCode!==200||p.protocol!=='snapvault-maintenance-v1'||p.maintenance!==true||p.ready!==false||p.writerEnabled!==false||p.deliveryEnabled!==false||!Number.isSafeInteger(p.pid))throw Error('Maintenance is not active');resolve(p);}catch(e){reject(e);}});});
  req.setTimeout(2000,()=>req.destroy(Error('Maintenance proof timed out')));req.on('error',reject);req.end();
 });
}
