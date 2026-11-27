import {setPrivacyContext} from './screen-privacy.js';
import {wallet,call} from './wallet.js';
import {identity,profile,escapeHtml as esc} from './store.js';
import {usesLargeMediaPath,uploadEncryptedMedia,playAuthorizedMedia,cancelActiveUpload} from './taperelay-media.js';
const KEY='sv:social-media:v1',DAY=86400000;
const types=new Set(['image/png','image/jpeg','image/webp','image/gif']);
let hooks={},state={posts:[],stories:[],profiles:{}},root,viewer,revision=0,viewerRevision=0,currentUser='',queue=[],index=0,started=0,paused=false,elapsed=0,clock;
const images=new Map();let postObserver;
export const socialEnabled=()=>!wallet.enabled||!!wallet.config?.socialMedia?.freeImages;
export const socialMode=()=>document.querySelector('#post-kind')?.value==='story'||document.querySelector('#post-access')?.value==='free';
const local=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{posts:[],stories:[]};}catch{return {posts:[],stories:[]};}};
const save=data=>{try{localStorage.setItem(KEY,JSON.stringify(data));}catch{throw Error('浏览器空间不足，未发布成功');}};
const sameAddr=(a,b)=>!!a&&String(a).toLowerCase()===String(b||'').toLowerCase();
const listHasAddr=(list,a)=>Array.isArray(list)&&list.some(x=>sameAddr(x,a));
const friends=(a,b)=>hooks.friends?.().some(f=>f.status==='accepted'&&listHasAddr([f.from,f.to],a)&&listHasAddr([f.from,f.to],b));
function visible(p,who){if(p.expiresAt&&p.expiresAt<=Date.now())return false;if(sameAddr(p.creator,who)||p.scope==='public')return true;if(p.scope==='friends')return friends(p.creator,who);return hooks.conversations?.().some(c=>c.id===p.convId&&listHasAddr(c.members,who));}
const label=address=>state.profiles[address]?.name||profile(address).name;
const avatar=address=>!wallet.enabled?(address==='0xCreAt0r00000000000000000000000000000001'?'photo-tile photo-travel':address==='0xFaN3000000000000000000000000000000000003'?'photo-tile photo-maker':''):'';
function sweepLocal(){const data=local(),stories=data.stories.filter(p=>p.expiresAt>Date.now());if(stories.length!==data.stories.length){data.stories=stories;save(data);}return data;}
export async function loadSocial(){
 const rev=++revision,who=identity();if(who!==currentUser){currentUser=who;for(const url of images.values())URL.revokeObjectURL(url);images.clear();viewer?.close();}
 if(wallet.enabled){
  if(!wallet.ready){renderSocial();return;}
  if(!socialEnabled()){state={posts:[],stories:[],profiles:{}};renderSocial();return;}
  try{const data=await call('social-state');if(rev!==revision||who!==identity())return;state=data;}
  catch(e){if(rev!==revision||who!==identity())return;throw e;}
 }
 else{const data=sweepLocal();state={posts:data.posts.filter(p=>visible(p,who)),stories:data.stories.filter(p=>visible(p,who)),profiles:{}};}
 renderSocial();
}
function toURL(data){if(!types.has(data.mime)||typeof data.image!=='string'||data.image.length>2800000)throw Error('图片格式无效');const binary=atob(data.image),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return URL.createObjectURL(new Blob([bytes],{type:data.mime}));}
async function open(id){if(wallet.enabled){if(!wallet.token)throw Error('请先连接钱包并签名登录');return call('social-open',{id});}const data=sweepLocal(),p=[...data.posts,...data.stories].find(p=>p.id===id);if(!p||!visible(p,identity()))throw Error('内容不存在、已过期或没有查看权限');return p;}
async function photo(id){const key=identity()+':'+id;if(!images.has(key)){const data=await open(id);if(data.mediaId)throw Error('media');images.set(key,toURL(data));}return images.get(key);}
function selectedFeed(){return document.querySelector('[data-feed].on')?.dataset.feed||'creators';}
export function renderSocial(){
 if(!root)return;
 const enabled=socialEnabled();root.querySelector('#story-strip').classList.toggle('hidden',!enabled);
 document.querySelector('#post-kind option[value=story]').disabled=!enabled;document.querySelector('#post-access option[value=free]').disabled=!enabled;
 const groups=[...new Set(state.stories.map(p=>p.creator))];
 root.querySelector('#story-strip').innerHTML=`<span class="story-strip-meta">24h Story · ${groups.length}</span><button class="story-person story-add" data-new-story><span class="story-avatar"><span>＋</span></span><b>添加 Story</b></button>`+groups.map(a=>`<button class="story-person ${a===identity()?'story-self':''}" data-story-user="${esc(a)}"><span class="story-avatar story-live ${avatar(a)}">${avatar(a)?'':esc(label(a).slice(0,1))}</span><b>${a===identity()?'我的 Story':esc(label(a))}</b></button>`).join('')+(groups.length?'':`<span class="story-empty">暂无好友 Story</span>`);
 const feed=selectedFeed(),show=feed==='latest'||feed==='following';
 const query=(document.querySelector('#search')?.value||'').trim().toLowerCase();const posts=state.posts.filter(p=>!query||(p.title+' '+label(p.creator)).toLowerCase().includes(query)).filter(p=>feed!=='following'||hooks.following?.().includes(p.creator)).sort((a,b)=>b.createdAt-a.createdAt);
 postObserver?.disconnect();const list=root.querySelector('#social-posts');list.classList.toggle('hidden',!show);list.innerHTML=show?posts.map(p=>`<article class="social-post" data-social-post="${esc(p.id)}"><header><span class="social-author-avatar ${avatar(p.creator)}">${avatar(p.creator)?'':esc(label(p.creator).slice(0,1))}</span><div><b class="social-author">${esc(label(p.creator))}</b><small>${p.scope==='public'?'公开作品':p.scope==='friends'?'好友可见':'会话专属'}</small></div><span class="free-label">${p.media?(String(p.mime||'').startsWith('video/')?'免费视频':'免费大文件'):'免费查看'}</span></header><button class="social-photo" data-social-open="${esc(p.id)}"${p.media?' data-media="1"':''} aria-label="查看免费内容"><img class="hidden" alt="" loading="lazy"><span>${p.media?(String(p.mime||'').startsWith('video/')?'视频 · 点击打开':'大文件 · 点击打开'):'加载图片…'}</span></button><p class="social-caption">${esc(p.title)}</p><footer><span>无需付款</span>${p.creator===identity()?`<button data-social-delete="${esc(p.id)}">删除</button>`:`<button data-message="${esc(p.creator)}">发消息</button>`}</footer></article>`).join(''):'';
 if(show&&posts.length){if(feed==='latest')document.querySelector('#discovery-summary').textContent=(posts.length+document.querySelectorAll('#grid .media-card').length)+' 条动态';const empty=document.querySelector('#grid>.empty-state');if(empty)empty.hidden=true;}
 const rev=revision,who=identity();postObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const button=entry.target,img=button.querySelector("img");postObserver.unobserve(button);photo(button.dataset.socialOpen).then(url=>{if(rev!==revision||who!==identity()||!img.isConnected)return;img.src=url;img.classList.remove('hidden');button.querySelector('span').hidden=true;}).catch(()=>{if(button.isConnected)button.querySelector('span').textContent='点击查看';});}},{root:document.querySelector('main'),rootMargin:'200px'});for(const button of list.querySelectorAll('.social-photo')){if(button.dataset.media)continue;postObserver.observe(button);}
}
export async function publishSocial({file,title,target}){
 if(!socialEnabled())throw Error('当前服务尚未启用免费图片与 Story');
 const story=document.querySelector('#post-kind').value==='story',who=identity();if(!who)throw Error('请先连接钱包并签名登录');
 const conv=!['public','friends'].includes(target)?hooks.conversations?.().find(c=>c.id===target):null;
 if(!['public','friends'].includes(target)&&!conv)throw Error('当前身份不在这个会话中');
 const scope=conv?conv.type:target,kind=story?'story':'post';
 if(usesLargeMediaPath(file)){
  if(!wallet.enabled)throw Error('大文件和视频需要连接钱包后的服务端签名上传');
  const ac=new AbortController();hooks.onMediaUploadStart?.(ac);const committed=await uploadEncryptedMedia({file,scene:kind,scope,convId:conv?.id||null,title,signal:ac.signal,onProgress:x=>hooks.onMediaProgress?.(x)});
  await call('social-publish',{kind,mediaId:committed.mediaId,title,scope,convId:conv?.id||null});
 }else{
  if(!file||!types.has(file.type)||file.size>2097152)throw Error('仅支持 2 MB 以内的图片；暂不支持视频');
  const bytes=new Uint8Array(await file.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const body={kind,image:btoa(text),mime:file.type,title,scope,convId:conv?.id||null};
  if(wallet.enabled)await call('social-publish',body);
  else{const data=sweepLocal(),p={...body,id:(kind==='story'?'story_':'post_')+crypto.randomUUID(),creator:who,createdAt:Date.now(),expiresAt:story?Date.now()+DAY:null,free:true};data[story?'stories':'posts'].push(p);save(data);}
 }
 if(identity()!==who)throw Error('身份已变化，请切回原账户查看');
 await loadSocial();return {story};
}
function stopView(){setPrivacyContext(null);viewerRevision++;clearInterval(clock);viewer.querySelector('img').removeAttribute('src');viewer.querySelector('video')?.removeAttribute('src');if(viewer._mediaClose){viewer._mediaClose();viewer._mediaClose=null;}if(viewer.dataset.url){URL.revokeObjectURL(viewer.dataset.url);delete viewer.dataset.url;}}
async function showItem(){
 const p=queue[index];if(!p){viewer.close();return;}stopView();const rev=viewerRevision,who=identity();viewer.querySelector('.story-caption').textContent=p.title;viewer.querySelector('.story-author').textContent=label(p.creator);viewer.querySelector('.story-age').textContent=new Date(p.createdAt).toLocaleTimeString(document.documentElement.lang==='en'?'en':'zh-CN',{hour:'2-digit',minute:'2-digit'});
 viewer.querySelector('.story-progress').innerHTML=queue.map((_,i)=>`<i class="${i<index?'complete':''}"><span></span></i>`).join('');
 const reply=viewer.querySelector('.story-reply');reply.hidden=p.creator===identity();reply.dataset.message=p.creator;
 viewer.querySelector('.story-remove').hidden=p.creator!==identity();viewer.classList.toggle('story-mode',!!p.expiresAt);
 try{const data=await open(p.id);if(rev!==viewerRevision||who!==identity()||!viewer.open)return;const img=viewer.querySelector('img'),vid=viewer.querySelector('video');let videoStory=false;if(data.mediaId){if(vid){img.classList.add('hidden');vid.classList.remove('hidden');const playback=await playAuthorizedMedia(vid,data.mediaId);if(rev!==viewerRevision||!viewer.open){playback.close();return;}viewer._mediaClose=playback.close;videoStory=!!p.expiresAt&&String(data.mime||p.mime||'').startsWith('video/');if(videoStory)vid.onended=()=>{if(rev!==viewerRevision||!viewer.open)return;index++;showItem();};}else{hooks.notify?.('当前页面还不能播放这段内容');viewer.close();return;}}else{if(vid){vid.classList.add('hidden');vid.removeAttribute('src');}img.classList.remove('hidden');const url=toURL(data);viewer.dataset.url=url;img.src=url;}setPrivacyContext({kind:p.expiresAt?'story':'post',id:p.id,enabled:p.creator!==identity()});started=performance.now();elapsed=0;paused=false;if(videoStory)vid.play().catch(()=>{});clock=setInterval(()=>{if(data.expiresAt&&Date.now()>=data.expiresAt){viewer.close();loadSocial().catch(hooks.notify);return;}if(!p.expiresAt||paused)return;if(videoStory){const dur=(vid.duration&&isFinite(vid.duration)?vid.duration*1000:0);const current=(vid.currentTime||0)*1000;viewer.querySelectorAll('.story-progress i')[index]?.querySelector('span').style.setProperty('width',dur?Math.min(100,current/dur*100)+'%':'0%');return;}const duration=elapsed+performance.now()-started;viewer.querySelectorAll('.story-progress i')[index]?.querySelector('span').style.setProperty('width',Math.min(100,duration/5000*100)+'%');if(duration>=5000){index++;showItem();}},70);}catch(e){viewer.close();hooks.notify?.(e.message||String(e));}
}
function show(items){queue=items;index=0;if(!viewer.open)viewer.showModal();showItem();}
async function remove(id){if(!confirm('确定删除这条内容？'))return;if(wallet.enabled)await call('social-delete',{id});else{const data=local();for(const key of ['posts','stories'])data[key]=data[key].filter(p=>p.id!==id||p.creator!==identity());save(data);}const key=identity()+':'+id;if(images.has(key)){URL.revokeObjectURL(images.get(key));images.delete(key);}viewer.close();await loadSocial();}
export function initSocial(options){
 hooks=options;root=document.querySelector('#fan');viewer=document.querySelector('#social-viewer');
 root.addEventListener('click',e=>{const user=e.target.closest('[data-story-user]'),post=e.target.closest('[data-social-open]'),del=e.target.closest('[data-social-delete]');if(e.target.closest('[data-new-story]')){document.querySelector('#post-kind').value='story';document.querySelector('#post-access').value='free';document.querySelector('[data-tab=creator]').click();hooks.targets?.('friends');hooks.composer?.();}if(user)show(state.stories.filter(p=>sameAddr(p.creator,user.dataset.storyUser)).sort((a,b)=>a.createdAt-b.createdAt));if(post){const p=state.posts.find(p=>p.id===post.dataset.socialOpen);if(p)show([p]);}if(del)remove(del.dataset.socialDelete).catch(e=>hooks.notify?.(e.message));});
 viewer.querySelector('.story-close').onclick=()=>viewer.close();viewer.addEventListener('close',stopView);viewer.querySelector('.story-prev').onclick=()=>{index=Math.max(0,index-1);showItem();};viewer.querySelector('.story-next').onclick=()=>{index++;showItem();};viewer.querySelector('.story-reply').onclick=()=>viewer.close();viewer.querySelector('.story-remove').onclick=()=>remove(queue[index].id).catch(e=>hooks.notify?.(e.message));
 const stage=viewer.querySelector('.story-stage');
 let heldVideo=null;
 stage.onpointerdown=e=>{
   if(e.target.closest('button,input,.tr-playback-controls'))return;
   const video=stage.querySelector('video');
   heldVideo=video&&!video.classList.contains('hidden')&&!video.paused?video:null;
   heldVideo?.pause();elapsed+=performance.now()-started;paused=true;
 };
 const resume=()=>{if(paused){paused=false;started=performance.now();if(viewer.open)heldVideo?.play().catch(()=>{});}heldVideo=null;};
 stage.onpointerup=stage.onpointercancel=stage.onpointerleave=resume;
 viewer.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();index++;showItem();}if(e.key==='ArrowLeft'){e.preventDefault();index=Math.max(0,index-1);showItem();}});
 document.querySelector('#post-kind').onchange=()=>{const story=document.querySelector('#post-kind').value==='story';if(story)document.querySelector('#post-access').value='free';hooks.targets?.(story?'friends':'public');hooks.composer?.();};document.querySelector('#post-access').onchange=()=>{hooks.targets?.('public');hooks.composer?.();};
 document.querySelector('#fan').addEventListener('click',e=>{if(e.target.closest('[data-feed]'))requestAnimationFrame(renderSocial);});
 window.addEventListener('snapvault:identity',()=>loadSocial().catch(e=>hooks.notify?.(e.message)));window.addEventListener('snapvault:change',()=>{if(wallet.ready)loadSocial().catch(e=>hooks.notify?.(e.message));else renderSocial();});
 const expiry=setInterval(()=>{if(state.stories.some(p=>p.expiresAt<=Date.now()))loadSocial().catch(()=>{});},1000);window.addEventListener('pagehide',()=>{clearInterval(expiry);stopView();for(const url of images.values())URL.revokeObjectURL(url);},{once:true});
 loadSocial().catch(e=>hooks.notify?.(e.message));
}
