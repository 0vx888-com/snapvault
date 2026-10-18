const {expect}=require('chai');
const path=require('node:path');
const http=require('node:http');
const request=(url,options={})=>new Promise((resolve,reject)=>{const req=http.request(url,options,res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(data),headers:{get:name=>res.headers[name.toLowerCase()]}}));});req.on('error',reject);req.end(options.body);});
describe('公开测试托管 HTTP 边界',function(){
 let server,base;
 before(async()=>{
  const {walletHttp}=await import('../server/wallet-http.mjs');
  const service={origins:['https://frontend.example.test'],config:async()=>({chainId:1952}),blob:()=>{throw Error('密文不存在');},handle:async(action)=>{if(action==='delivery-route')return {available:true,suite:1n,chains:7n};throw Error('不应调用未授权接口');}};
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
 it('缺失密文返回 JSON 错误，服务保持在线且不会重复写响应头',async()=>{
  const headers={Host:'api.example.test',Origin:'https://frontend.example.test'};
  const bad=await request(base+'/api/wallet/blob/'+'a'.repeat(64),{headers});
  expect(bad.status).eq(400);expect(await bad.json()).deep.eq({error:'密文不存在'});
  expect(bad.headers.get('access-control-allow-origin')).eq(headers.Origin);
  expect((await request(base+'/healthz',{headers:{Host:'healthcheck.railway.app'}})).status).eq(200);
 });
 it('缺失静态文件返回受控错误而不会导致后端退出',async()=>{
  const {walletHttp}=await import('../server/wallet-http.mjs');
  const temp=walletHttp({service:{origins:[],config:async()=>({chainId:196})},root:path.resolve(__dirname,'..'),staticDir:path.join(__dirname,'nonexistent-static-root'),port:0,allowedHosts:['api.example.test']});
  await new Promise(r=>temp.listen(0,'127.0.0.1',r));
  try{const url='http://127.0.0.1:'+temp.address().port;expect((await request(url+'/',{headers:{Host:'api.example.test'}})).status).eq(400);expect((await request(url+'/api/wallet/config',{headers:{Host:'api.example.test'}})).status).eq(200);}finally{await new Promise(r=>temp.close(r));}
 });

 it('HTTP 容器通路返回大整数时保持合法 JSON 和 CORS，不断开连接',async()=>{
  const r=await request(base+'/api/wallet/delivery-route',{method:'POST',headers:{Host:'api.example.test',Origin:'https://frontend.example.test',Authorization:'Bearer fixture','Content-Type':'application/json'},body:'{}'});
  expect(r.status).eq(200);expect(await r.json()).deep.eq({available:true,suite:'1',chains:'7'});expect(r.headers.get('access-control-allow-origin')).eq('https://frontend.example.test');
 });

 it('公开收信客户端只提供清单内文件，不暴露服务数据或测试页面',async()=>{
  const headers={Host:'api.example.test'};
  expect((await request(base+'/tapesend',{headers})).status).eq(302);
  expect((await request(base+'/tapesend/',{headers})).status).eq(200);
  expect((await request(base+'/tapesend/LICENSE.txt',{headers})).status).eq(200);
  for(const file of ['manifest.json','master.key','state.enc','payment-test.html','assets/unknown.js'])expect((await request(base+'/tapesend/'+file,{headers})).status).eq(404);
  expect((await request(base+'/tapesend/',{method:'POST',headers,body:'{}'})).status).eq(405);
 });

});
