// Static bundle shared by DeWEB and optional IPFS preview. No upload/broadcast.
import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),preview=args.includes('--preview'),local=args.includes('--local');
const index=args.indexOf('--api'),api=index>=0?args[index+1]:process.env.SNAPVAULT_API_BASE;
if(!preview){
 if(!api)throw Error('钱包应用需要明确的 --api HTTPS 后端地址；仅本地测试可加 --local');
 const u=new URL(api);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('API 必须为无账号、参数和路径的 origin');
 if(!(u.protocol==='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))&&!(local&&u.protocol==='http:'&&u.hostname==='127.0.0.1'))throw Error('正式 API 必须为 HTTPS，本机 API 仅限 --local');
}
const out=resolve(root,'dist',preview?'preview':local?'wallet-local':'wallet');
// Only generated output is replaced, never source/config/runtime directories.
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const files=['index.html','style.css','app.js','chat.js','store.js','local-delivery.js','wallet.js','wallet-chat.js','vendor/ethers.min.js','vendor/ethers-LICENSE.md','assets/mark.svg','assets/mark-social.svg','assets/mark-tape.svg','assets/social-photos.jpg','assets/studio.svg','assets/sketch.svg'];
for(const file of files){await mkdir(dirname(resolve(out,file)),{recursive:true});await copyFile(resolve(root,'web',file),resolve(out,file));}
let html=await readFile(resolve(out,'index.html'),'utf8');html=html.replace(/<details class="dev-tools">[\s\S]*?<\/details>/,'');
if(!preview){html=html.replace('产品预览 · 不扣款','测试版 · 未开放主网');html=html.replace('产品预览：人物与聊天为演示数据，购买不扣款。正式钱包、多人同步与内容交付仍在接入。','钱包与多人聊天测试版；付费内容仅支持测试币，尚未开放主网。');}
await writeFile(resolve(out,'index.html'),html);
await writeFile(resolve(out,'app-config.json'),JSON.stringify({mode:preview?'preview':'wallet',apiBase:preview?'':new URL(api).origin},null,2)+'\n');files.push('app-config.json');
const types={html:'text/html; charset=utf-8',css:'text/css',js:'text/javascript',json:'application/json',jpg:'image/jpeg',svg:'image/svg+xml',md:'text/markdown'};
const manifest={version:1,mode:preview?'preview':'wallet-test',target:'X Layer DeWEB SiteRegistry',published:false,externalData:preview?[]:[new URL(api).origin],files:[]};
for(const file of files){const data=await readFile(resolve(out,file)),hash=createHash('sha256').update(data).digest('hex');manifest.files.push({path:'/'+file,contentType:types[file.split('.').at(-1)],bytes:data.length,sha256:'0x'+hash,chunks:Math.ceil(data.length/24000)});}
await writeFile(resolve(out,'deweb-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({out,files:files.length,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),chunks:manifest.files.reduce((n,f)=>n+f.chunks,0),published:false},null,2));
