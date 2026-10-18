import {cleanPublicBuild} from './public-build.mjs';
import {optimizePublic} from './optimize-public.mjs';
// Static build only. Never uploads, signs or publishes.
import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {APP_FILES} from './app-files.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildApp({preview=false,local=false,server=false,api='',allowMainnet=false,out}={}){
 if(!preview&&!server){if(!api)throw Error('Explicit HTTPS --api required');const u=new URL(api);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('API must be a plain origin');if(!(u.protocol==='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))&&!(local&&u.protocol==='http:'&&u.hostname==='127.0.0.1'))throw Error('Public API must be HTTPS');}
 if(local&&allowMainnet)throw Error('wallet-local must never enable mainnet');out ||= resolve(root,'dist',preview?'preview':server?'server':local?'wallet-local':'wallet');
 if(!out.startsWith(resolve(root,'dist')+'/'))throw Error('Build output must be inside dist');await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
 const files=[...APP_FILES];for(const f of files){await mkdir(dirname(resolve(out,f)),{recursive:true});await copyFile(resolve(root,'web',f),resolve(out,f));}
 let html=await readFile(resolve(out,'index.html'),'utf8');html=html.replace(/<details class="dev-tools">[\s\S]*?<\/details>/,'');if(!preview)html=html.replace('产品预览 · 不扣款','正在连接 X Layer');await writeFile(resolve(out,'index.html'),html);
 await writeFile(resolve(out,'app-config.json'),JSON.stringify({mode:preview?'preview':'wallet',apiBase:preview||server?'':new URL(api).origin,allowedChainIds:local?[31337]:allowMainnet?[1952,196]:[1952],allowMainnet},null,2)+'\n');files.push('app-config.json');
 if(!preview&&!local){await cleanPublicBuild(out);await optimizePublic(out);}
 const types={html:'text/html; charset=utf-8',css:'text/css',js:'text/javascript',json:'application/json',jpg:'image/jpeg',svg:'image/svg+xml',md:'text/markdown'};
 const manifest={version:2,mode:preview?'preview':local?'wallet-local':server?'server':'wallet',target:'X Layer DeWEB SiteRegistry',published:false,mainnetEnabled:allowMainnet,externalData:preview||server?[]:[new URL(api).origin],files:[]};for(const file of files){const data=await readFile(resolve(out,file));manifest.files.push({path:'/'+file,contentType:types[file.split('.').at(-1)],bytes:data.length,sha256:'0x'+createHash('sha256').update(data).digest('hex'),chunks:Math.ceil(data.length/24000)});}await writeFile(resolve(out,'deweb-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return {out,files:files.length,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),chunks:manifest.files.reduce((n,f)=>n+f.chunks,0),published:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const a=process.argv.slice(2),i=a.indexOf('--api');console.log(JSON.stringify(await buildApp({preview:a.includes('--preview'),local:a.includes('--local'),server:a.includes('--server'),api:i>=0?a[i+1]:process.env.SNAPVAULT_API_BASE,allowMainnet:a.includes('--allow-mainnet')}),null,2));}
