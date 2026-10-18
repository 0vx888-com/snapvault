// Isolated no-money runner. Never imports user keys or public-chain RPCs.
const hre=require('hardhat');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
async function main(){
 const {WalletService}=await import('../server/wallet-service.mjs'),{walletHttp}=await import('../server/wallet-http.mjs');
 const {ethers}=hre;if(Number((await ethers.provider.getNetwork()).chainId)!==31337)throw Error('Only local 31337 is permitted');
 const operator=ethers.Wallet.fromPhrase(require('hardhat').config.networks.hardhat.accounts.mnemonic).connect(ethers.provider);
 const vault=await ethers.deployContract('SnapVaultDirect',[operator.address,1000,operator.address,operator.address]);await vault.waitForDeployment();
 const port=Number(process.env.WALLET_PORT||5185),origin=`http://127.0.0.1:${port}`;
 const dir=process.env.WALLET_DATA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'snapvault-wallet-'));
 const service=new WalletService({allowLocalKeyFile:true,provider:ethers.provider,vault,operator,dir,origins:[origin,'http://127.0.0.1:5186'],confirmations:1});
 const original=service.login.bind(service);service.login=async(...args)=>{const result=await original(...args);await hre.network.provider.send('hardhat_setBalance',[result.address,'0x56bc75e2d63100000']);return result;};
 const server=walletHttp({service,root:path.resolve(__dirname,'..'),staticDir:process.env.PUBLIC_STATIC_DIR||null,port,rpc:(method,params)=>hre.network.provider.send(method,params)});
 await new Promise(r=>server.listen(port,'127.0.0.1',r));console.log(`WALLET_LOCAL_READY ${origin}/index.html?delivery=wallet`);console.log('Local 31337 only. Wallet login is a real signature. Test balance has no value. Persistent encrypted data:',dir);
 process.on('SIGINT',()=>server.close(()=>process.exit()));process.on('SIGTERM',()=>server.close(()=>process.exit()));await new Promise(()=>{});
}
main().catch(e=>{console.error(e);process.exitCode=1;});
