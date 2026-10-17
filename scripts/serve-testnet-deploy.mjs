// Human-signed deployment bridge: only public transaction data and read-only RPC.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ContractFactory,Contract,JsonRpcProvider,ZeroAddress,formatEther} from 'ethers';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=process.argv[2];if(!dir)throw Error('Missing signer public metadata directory');
const setup=JSON.parse(readFileSync(resolve(dir,'public.json'),'utf8'));
if(setup.chainId!==1952)throw Error('Only X Layer testnet is allowed');
const artifact=JSON.parse(readFileSync(resolve(root,'artifacts/contracts/SnapVaultDirect.sol/SnapVaultDirect.json')));
const data=(await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(setup.treasury,setup.feeBps,setup.hub,setup.operator)).data;
const provider=new JsonRpcProvider('https://testrpc.xlayer.tech/terigon',1952,{staticNetwork:true});
if(Number(BigInt(await provider.send('eth_chainId',[])))!==1952)throw Error('Unexpected RPC chain');
const port=5188,origin=`http://127.0.0.1:${port}`;
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{try{
 if(req.headers.host!==`127.0.0.1:${port}`||(req.headers.origin&&req.headers.origin!==origin))return json(res,403,{error:'Only this local deployment page is allowed'});
 const url=new URL(req.url,origin);
 if(url.pathname==='/api/deploy'&&req.method==='GET'){
  const gas=await provider.estimateGas({from:setup.treasury,data,value:0n}),gasPrice=BigInt(await provider.send('eth_gasPrice',[]));
  return json(res,200,{...setup,contractName:'SnapVaultDirect',data,value:'0x0',gas:gas.toString(),gasPrice:gasPrice.toString(),estimatedTestOKB:formatEther(gas*gasPrice),balanceTestOKB:formatEther(await provider.getBalance(setup.treasury)),mainnetSpending:false});
 }
 if(url.pathname==='/api/deploy/receipt'&&req.method==='POST'){
  if(req.headers.origin!==origin)throw Error('Origin required');let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>1000)throw Error('Body too large');chunks.push(chunk);}
  const {hash}=JSON.parse(Buffer.concat(chunks));if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Invalid transaction hash');
  const [tx,receipt]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
  if(!tx||!receipt)return json(res,202,{pending:true});
  if(receipt.status!==1||!receipt.contractAddress||tx.to!==null||tx.from.toLowerCase()!==setup.treasury.toLowerCase()||tx.data!==data||tx.value!==0n||tx.chainId!==1952n)throw Error('Deployment receipt does not match the reviewed transaction');
  const c=new Contract(receipt.contractAddress,artifact.abi,provider);
  if((await c.owner()).toLowerCase()!==setup.treasury.toLowerCase()||(await c.treasury()).toLowerCase()!==setup.treasury.toLowerCase()||(await c.deliveryOperator()).toLowerCase()!==setup.operator.toLowerCase()||Number(await c.feeBps())!==setup.feeBps||(await c.deliveryHub()).toLowerCase()!==setup.hub.toLowerCase())throw Error('Deployed contract parameters do not match');
  const config={chainId:1952,rpc:'https://testrpc.xlayer.tech/terigon',vault:receipt.contractAddress,deploymentBlock:receipt.blockNumber,origins:[],hosts:[],confirmations:3,dataDir:'/data/snapvault'};
  const record={...setup,address:receipt.contractAddress,transactionHash:hash,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),publicTestnet:true,mainnetSpending:false};
  writeFileSync(resolve(root,'config/wallet.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});writeFileSync(resolve(root,'deployment/xlayerTestnet-direct.json'),JSON.stringify(record,null,2)+'\n');return json(res,200,{...record,verified:true});
 }
 const web=resolve(root,'web'),file=resolve(web,'.'+(url.pathname==='/'?'/deploy-testnet.html':decodeURIComponent(url.pathname)));
 if(req.method!=='GET'||!file.startsWith(web+sep))return json(res,404,{error:'Not found'});
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));
}catch(e){json(res,400,{error:e.message});}});
server.listen(port,'127.0.0.1',()=>console.log(`Reviewed X Layer TESTNET deployment: ${origin}/ — no transaction sent`));
process.once('SIGTERM',()=>server.close(()=>process.exit()));process.once('SIGINT',()=>server.close(()=>process.exit()));
