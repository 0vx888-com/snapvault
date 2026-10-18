import {Contract,getBytes,sha256} from 'ethers';
import {uploadPlan,REGISTRY_ABI} from './deweb-bundle-normalized.mjs';
export async function deltaUploadPlan(bundle,container,registry,provider){
 const store=new Contract(registry,REGISTRY_ABI,provider),full=uploadPlan(bundle,container,registry),pending=[],reused=[];
 for(const f of bundle.files){const info=await store.fileInfo(container,f.path);const size=Number(info[0]),chunks=Number(info[4]);let reusable=false;
 if(chunks>0&&size<=f.bytes.length&&info[2]===f.sha256){const parts=[];for(let offset=0;offset<size;offset+=24000)parts.push(Buffer.from(getBytes(await store.readRange(container,f.path,offset,Math.min(24000,size-offset)))));reusable=Buffer.concat(parts).equals(f.bytes.subarray(0,size));}
 const operations=full.filter(t=>t.path===f.path);if(reusable&&size===f.bytes.length){reused.push({path:f.path,bytes:size,sha256:sha256(f.bytes)});continue;}
 if(reusable&&size===chunks*24000)pending.push(...operations.filter(t=>t.chunk>=chunks));else pending.push(...operations);
 }
 const fallback=new Contract(registry,['function fallbackPath(address) view returns(string)'],provider);if(await fallback.fallbackPath(container)!=='index.html')pending.push(full.at(-1));return {plan:pending,reused};
}
