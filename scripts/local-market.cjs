// Ephemeral local Hardhat test chain. Uses only standard public test accounts.
const hre=require('hardhat');
const {ethers}=hre;
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
async function main(){
 const {DeliveryService}=await import('../server/delivery.mjs');
 const crypto=await import('../vendor/tapekit-send/index.js');
 const {createIntegrationServer}=await import('../server/http.mjs');const {localMarket}=await import('../server/local-market.mjs');
 if(Number((await ethers.provider.getNetwork()).chainId)!==31337)throw Error('This runner only permits local chain 31337');
 const signers=await ethers.getSigners(),[operator]=signers;
 const ids=['0xCreAt0r00000000000000000000000000000001','0xDem0FaN000000000000000000000000000000001','0xFaN2000000000000000000000000000000000002','0xFaN3000000000000000000000000000000000003'];
 const fixture=await ethers.deployContract('TapeOutFixture');await fixture.setOwner(1,operator.address);
 const boot=await ethers.deployContract('DeWebBoot');const proxy=await ethers.deployContract('DeWebProxy',[boot.target,boot.interface.encodeFunctionData('initialize',[operator.address])]);
 const impl=await ethers.deployContract('DeWebHub',[31337,fixture.target,fixture.target,fixture.target,fixture.target,fixture.target,fixture.target,ethers.keccak256(await ethers.provider.getCode(fixture.target))]);
 const hub=await ethers.getContractAt('DeWebHub',proxy.target);await hub.upgradeToAndCall(impl.target,'0x');await fixture.setPaid(await hub.accountOf(fixture.target,1),true);
 const roles=new Map(),keys=new Map();
 for(let n=0;n<ids.length;n++){const signer=signers[n+1],tokenId=n+2;roles.set(ids[n],{signer,tokenId});await fixture.setOwner(tokenId,signer.address);const container=await hub.accountOf(fixture.target,tokenId);await fixture.setPaid(container,true);const params={tokenId,cpuIndex:0,container,holder:signer.address,hub:hub.target,chainId:31337};const key=crypto.deriveKeyPair({...params,signature:await signer.signMessage(crypto.keyDerivationText(params))});keys.set(ids[n],key);await hub.connect(signer).publishKey(fixture.target,tokenId,1,0,key.publicKey,1);}
 const vault=await ethers.deployContract('SnapVaultCheckout',[operator.address,1000,hub.target,operator.address]);
 const port=Number(process.env.LOCAL_MARKET_PORT||5184),origin=`http://127.0.0.1:${port}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'snapvault-market-'));
 const signer=ethers.Wallet.fromPhrase(require('hardhat').config.networks.hardhat.accounts.mnemonic).connect(ethers.provider);
 const service=new DeliveryService({provider:ethers.provider,signer,vault,hub:hub.target,implementation:impl.target,implementationHash:ethers.keccak256(await ethers.provider.getCode(impl.target)),circuits:fixture.target,tokenId:1,chainId:31337,dir,origin,confirmations:1});
 const local=localMarket({service,vault,hub,fixture,roles,keys});
 const app=createIntegrationServer({root:path.resolve(__dirname,'..'),port,service,config:{chainId:31337,vault:vault.target,hub:hub.target},local});
 await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));console.log(`LOCAL_MARKET_READY ${origin}/index.html?delivery=local`);
 console.log('仅本地 Hardhat 31337；测试角色不代表钱包身份；容器为本地替身；普通聊天为本机演示；进程重启清空链上作品与订单。');
 const stop=async()=>{await app.stop();fs.rmSync(dir,{recursive:true,force:true});process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 await new Promise(()=>{});
}
main().catch(e=>{console.error(e);process.exitCode=1;});
