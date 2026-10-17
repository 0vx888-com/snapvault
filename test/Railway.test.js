const {expect}=require('chai');
const path=require('node:path');
const http=require('node:http');
const request=(url,options={})=>new Promise((resolve,reject)=>{const req=http.request(url,options,res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(data),headers:{get:name=>res.headers[name.toLowerCase()]}}));});req.on('error',reject);req.end(options.body);});
describe('公开测试托管 HTTP 边界',function(){
 let server,base;
 before(async()=>{
  const {walletHttp}=await import('../server/wallet-http.mjs');
  const service={origins:['https://frontend.example.test'],config:async()=>({chainId:1952}),handle:async()=>{throw Error('不应调用未授权接口');}};
  server=walletHttp({service,root:path.resolve(__dirname,'..'),port:0,allowedHosts:['api.example.test']});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 });
 after(async()=>{await new Promise(r=>server.close(r));});
 it('允许 Railway 健康检查 Host，但不向它开放应用与写入接口',async()=>{
  const r=await request(base+'/healthz',{headers:{Host:'healthcheck.railway.app'}});expect(r.status).to.equal(200);expect(await r.json()).to.deep.equal({status:'ok',chainId:1952,testnetOnly:true});
  expect((await request(base+'/api/wallet/config',{headers:{Host:'healthcheck.railway.app'}})).status).to.equal(403);
  expect((await request(base+'/healthz',{headers:{Host:'evil.example.test'}})).status).to.equal(403);
 });
 it('确切 Origin 可预检，陌生网站与本地测试 RPC 在公开模式下拒绝',async()=>{
  const origin='https://frontend.example.test',headers={Host:'api.example.test',Origin:origin,'Content-Type':'application/json'};
  const ok=await request(base+'/api/wallet/state',{method:'OPTIONS',headers});expect(ok.status).to.equal(204);expect(ok.headers.get('access-control-allow-origin')).to.equal(origin);
  expect((await request(base+'/api/wallet/state',{method:'POST',headers:{...headers,Origin:'https://evil.example.test'},body:'{}'})).status).to.equal(403);
  expect((await request(base+'/rpc',{method:'POST',headers,body:'{}'})).status).to.equal(403);
  expect((await request(base+'/api/local/purchase',{method:'POST',headers,body:'{}'})).status).to.equal(404);
 });
});
