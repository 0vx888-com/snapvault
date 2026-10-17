// Creates a NEW service quote signer, never imports a person's wallet.
// This key cannot withdraw creator revenue; it must never hold user funds.
import {Wallet} from 'ethers';
import {randomBytes} from 'node:crypto';
import {mkdirSync,existsSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
const dir=process.argv[2];if(!dir)throw Error('Specify a private directory outside the repository');
mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
const publicFile=resolve(dir,'public.json');
if(existsSync(publicFile)){console.log(readFileSync(publicFile,'utf8'));process.exit(0);}
for(const name of ['relayer.keystore','password'])if(existsSync(resolve(dir,name)))throw Error('Partial signer setup exists; refusing to replace it');
const wallet=Wallet.createRandom(),password=randomBytes(32).toString('base64url'),keystore=await wallet.encrypt(password);
writeFileSync(resolve(dir,'relayer.keystore'),keystore,{mode:0o600,flag:'wx'});
writeFileSync(resolve(dir,'password'),password,{mode:0o600,flag:'wx'});
const record={operator:wallet.address,chainId:1952,purpose:'SnapVault testnet direct-delivery quote signer; never funded',treasury:'0x1538ac2d29d03615d2336a2227900aab334d9402',feeBps:1000,hub:'0xe61a9c7213a6aa616c246a2b569e555b417b25ee'};
writeFileSync(publicFile,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(record,null,2));
