// Only live Story ciphertext belongs in a new snapshot. Never inspect backup roots.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createDecipheriv} from 'node:crypto';
import {checkedSocialImage} from './social-media.mjs';
function liveStories(state,now){
 return Object.entries(state.socialStories||{}).filter(([id,p])=>{
  if(!/^story_[a-f0-9]{32}$/.test(id)||p?.id!==id||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=0)throw Error('Invalid Story metadata');
  return p.expiresAt>now;
 });
}
export function validateStoryFiles({state,files={},master,now=Date.now()}){
 const selected={};
 for(const[id,p]of liveStories(state,now)){
  if(!Object.hasOwn(files,id))throw Error('Live Story image missing; refuse incomplete backup/restore');
  const body=files[id];
  try{
   const d=createDecipheriv('aes-256-gcm',master,Buffer.from(body.iv,'base64'));d.setAuthTag(Buffer.from(body.tag,'base64'));
   const bytes=Buffer.concat([d.update(Buffer.from(body.ct,'base64')),d.final()]);
   checkedSocialImage(bytes.toString('base64'),p.mime);
  }catch{throw Error('Story image authentication or format failed');}
  selected[id]=body;
 }
 return selected;
}
export function collectStoryFiles({state,dir,master,now=Date.now()}){
 const files={};
 for(const[id]of liveStories(state,now)){
  try{files[id]=JSON.parse(readFileSync(resolve(dir,'stories',id+'.enc'),'utf8'));}
  catch{throw Error('Live Story image missing or unreadable; refuse incomplete backup');}
 }
 return validateStoryFiles({state,files,master,now});
}
