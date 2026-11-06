// Free photo posts and 24h Stories are service features. They never send a transaction.
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {publicId,publicProfile} from './public-profiles.mjs';
const DAY=86400000,types=new Set(['image/png','image/jpeg','image/webp','image/gif']);
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function checkedSocialImage(encoded,mime){
 if(!types.has(mime)||typeof encoded!=='string'||encoded.length>2800000||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))fail('仅支持 2 MB 以内的图片；暂不支持视频');
 const bytes=Buffer.from(encoded,'base64');if(!bytes.length||bytes.length>2097152)fail('图片大小无效');
 const real=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':/^GIF8[79]a/.test(bytes.toString('ascii',0,6))?'image/gif':null;
 if(real!==mime)fail('图片内容与声明格式不符');return bytes;
}
const friends=(service,a,b)=>service.state.friends.some(f=>f.status==='accepted'&&[f.from,f.to].includes(a)&&[f.from,f.to].includes(b));
function visible(service,p,who){
 if(p.expiresAt&&p.expiresAt<=Date.now())return false;
 if(p.creator===who||p.scope==='public')return true;
 if(!who)return false;
 if(p.scope==='friends')return friends(service,p.creator,who);
 return service.state.convs.some(c=>c.id===p.convId&&c.members.includes(who)&&c.members.includes(p.creator));
}
export function installSocialMedia(Service){
 Object.assign(Service.prototype,{
  initSocial(){this.state.socialPosts||={};this.state.socialStories||={};this.socialDir=resolve(this.dir,'stories');mkdirSync(this.socialDir,{recursive:true,mode:0o700});this.sweepSocial();},
  storyPath(id){if(!/^story_[a-f0-9]{32}$/.test(id))fail('Story 编号无效');return resolve(this.socialDir,id+'.enc');},
  sweepSocial(){
   if(!this.state.socialStories)return;
   let dirty=false;for(const[id,p]of Object.entries(this.state.socialStories))if(p.expiresAt<=Date.now()||!existsSync(this.storyPath(id))){const file=this.storyPath(id);if(existsSync(file))unlinkSync(file);delete this.state.socialStories[id];dirty=true;}
   if(dirty)this.save();
  },
  socialState(who){
   if(!this.state.socialPosts)this.initSocial();this.sweepSocial();const profiles={};
   const metadata=p=>{const creator=who?p.creator:publicId(this,p.creator);profiles[creator]=publicProfile(this.state.profiles[p.creator]);return {id:p.id,creator,title:p.title,mime:p.mime,createdAt:p.createdAt,expiresAt:p.expiresAt||null,scope:p.scope,free:true,...(who===p.creator?{views:Object.keys(p.viewers||{}).length}:{})};};
   return {posts:Object.values(this.state.socialPosts).filter(p=>visible(this,p,who)).map(metadata),stories:Object.values(this.state.socialStories).filter(p=>visible(this,p,who)).map(metadata),profiles};
  },
  publishSocial(body,who){
   if(!this.state.socialPosts)this.initSocial();this.sweepSocial();this.limit('social-publish:'+who,8);
   const story=body.kind==='story';if(!['post','story'].includes(body.kind))fail('发布类型无效');
   const scope=body.scope||'public',allowed=story?['public','friends']:['public','friends','dm','group'];if(!allowed.includes(scope))fail('可见范围无效');
   let convId=null;if(['dm','group'].includes(scope)){const c=this.member(body.convId,who);if(c.type!==scope)fail('会话类型不一致');convId=c.id;}
   const title=String(body.title||'').trim();if(title.length>140||(!story&&!title))fail('请填写不超过 140 字的配文');
   const bytes=checkedSocialImage(body.image,body.mime),collection=story?this.state.socialStories:this.state.socialPosts;if(Object.keys(collection).length>=100)fail('当前存储已满，请先清理内容',507);
   const now=Date.now(),id=(story?'story_':'post_')+randomBytes(16).toString('hex'),p={id,creator:who,title,mime:body.mime,scope,convId,createdAt:now,expiresAt:story?now+DAY:null};
   if(story){writeFileSync(this.storyPath(id),JSON.stringify(this.seal(bytes)),{mode:0o600,flag:'wx'});p.viewers={};}
   else p.payload=this.seal(bytes);
   collection[id]=p;try{this.save();}catch(e){delete collection[id];if(story&&existsSync(this.storyPath(id)))unlinkSync(this.storyPath(id));throw e;}
   return {id,expiresAt:p.expiresAt,free:true};
  },
  openSocial(body,who){
   if(!this.state.socialPosts)this.initSocial();this.sweepSocial();const story=String(body.id).startsWith('story_'),p=(story?this.state.socialStories:this.state.socialPosts)[body.id];
   if(!p||!visible(this,p,who))fail('内容不存在、已过期或没有查看权限',404);
   const sealed=story?JSON.parse(readFileSync(this.storyPath(p.id),'utf8')):p.payload;
   const bytes=this.unseal(sealed);if(story&&who!==p.creator&&!p.viewers[who]){p.viewers[who]=Date.now();this.save();}
   return {id:p.id,image:bytes.toString('base64'),mime:p.mime,title:p.title,creator:p.creator,createdAt:p.createdAt,expiresAt:p.expiresAt};
  },
  deleteSocial(body,who){
   if(!this.state.socialPosts)this.initSocial();const story=String(body.id).startsWith('story_'),collection=story?this.state.socialStories:this.state.socialPosts,p=collection[body.id];
   if(!p||p.creator!==who)fail('只有发布者可以删除',403);if(story&&existsSync(this.storyPath(p.id)))unlinkSync(this.storyPath(p.id));delete collection[body.id];this.save();return {ok:true};
  }
 });
}
