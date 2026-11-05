import {messagePayload,hydrateSafeImages} from './safe-dom.js';
import {icon} from './ui-icons.js';
import {setupChatUI,openChatPane,filterConversations,chatHeader,expiryControl} from './chat-ui.js';
import {wallet,call,walletAction,fetchContent,finishContent} from './wallet.js';
import {identity,profile,uidOf,escapeHtml as esc} from './store.js';
export async function initWalletChat(root,hooks){
 let cur=sessionStorage.getItem('sv:wallet-conv'),me=identity(),revision=0,friendOpen=false,newOpen=false;
 const drafts=new Map(),opened=new Map(),deadlines=new Map();
 const tell=e=>hooks.notify?.(e.message||String(e));
 const label=c=>c.type==='dm'?profile(c.members.find(a=>a!==identity())||identity()).name:c.name;
 const convs=()=>wallet.data.convs||[],messages=()=>wallet.data.messages||[];
 root.innerHTML=`<div class="xchat card"><aside class="xc-side"><div class="xc-top"><b>消息</b><span><button class="xc-new" id="xc-fr" title="好友">👥</button><button class="xc-new" id="xc-new" title="新建会话">✉️＋</button></span></div><div class="xc-me"><span class="muted" id="wallet-chat-me"></span></div><div id="xc-frbox" class="xc-newbox hidden"></div><div id="xc-newbox" class="xc-newbox hidden"></div><div id="xc-list" class="xc-list"></div><div class="xc-foot pill">免费聊天发图 · 不逐条上链<br>测试服务可读取内容，尚非端到端加密</div></aside><section class="xc-pane" id="xc-pane"></section></div>`;
 setupChatUI(root);
 root.querySelector('#xc-fr').onclick=()=>{newOpen=false;renderNew();friendOpen=!friendOpen;renderFriends();};root.querySelector('#xc-new').onclick=()=>{friendOpen=false;renderFriends();newOpen=!newOpen;renderNew();};
 root.querySelector('#xc-list').onclick=e=>{const id=e.target.closest('[data-conv]')?.dataset.conv;if(id){openChatPane(root);cur=id;sessionStorage.setItem('sv:wallet-conv',id);render();}};
 function renderFriends(){
  const box=root.querySelector('#xc-frbox');box.classList.toggle('hidden',!friendOpen);if(!friendOpen)return;
  const who=identity(),friends=wallet.data.friends||[],incoming=friends.filter(f=>f.to===who&&f.status==='pending'),outgoing=friends.filter(f=>f.from===who&&f.status==='pending'),mine=friends.filter(f=>f.status==='accepted'&&[f.from,f.to].includes(who)).map(f=>f.from===who?f.to:f.from);
  const person=(address,action)=>`<div class="friend-row"><span class="friend-avatar">${esc(profile(address).name.slice(0,1))}</span><div><b>${esc(profile(address).name)}</b><button class="peer-uid" data-copy-uid="${uidOf(address)}">${uidOf(address)} ⧉</button></div>${action}</div>`;
  box.innerHTML=`<label class="friend-search-label">UID 或钱包地址<input id="xc-fq" placeholder="输入对方的 UID 或钱包地址" autocomplete="off" aria-label="输入好友 UID 或钱包地址"></label><button id="xc-fadd" class="primary">发送好友申请</button><p id="xc-fmsg" role="status" class="friend-feedback"></p><h4>收到的申请 <span>${incoming.length}</span></h4>${incoming.map(f=>person(f.from,`<button class="secondary" data-accept="${esc(f.from)}">接受</button>`)).join('')||'<p class="muted">没有待处理的申请。</p>'}${outgoing.length?'<h4>等待对方接受</h4>'+outgoing.map(f=>person(f.to,'<span class="pending-label">已申请</span>')).join(''):''}<h4>我的好友 <span>${mine.length}</span></h4>${mine.map(address=>person(address,`<button class="text-button" data-message="${address}">聊天 ↗</button>`)).join('')||'<p class="muted">输入对方的 UID 或地址添加好友。</p>'}`;
  const submit=async()=>{const button=box.querySelector('#xc-fadd');button.disabled=true;button.textContent='发送中…';try{if(!who)throw Error('请先连接钱包');const q=box.querySelector('#xc-fq').value.trim();if(!q)throw Error('先输入对方的 UID 或钱包地址');const found=await call('profile-lookup',{query:q});const to=found.address;wallet.data.profiles[to]={name:found.name,av:found.av};await walletAction('friend',{to});renderFriends();box.querySelector('#xc-fmsg').textContent='好友申请已发送';}catch(e){box.querySelector('#xc-fmsg').textContent=e.message;}finally{if(button.isConnected){button.disabled=false;button.textContent='发送好友申请';}}};
  box.querySelector('#xc-fadd').onclick=submit;box.querySelector('#xc-fq').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submit();}};
  box.querySelectorAll('[data-accept]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await walletAction('friend',{to:b.dataset.accept,accept:true});renderFriends();}catch(e){box.querySelector('#xc-fmsg').textContent=e.message;if(b.isConnected)b.disabled=false;}});
 }

 function renderNew(){
  const box=root.querySelector('#xc-newbox');box.classList.toggle('hidden',!newOpen);if(!newOpen)return;const who=identity(),others=(wallet.data.friends||[]).filter(f=>f.status==='accepted').map(f=>f.from===who?f.to:f.from);
  box.innerHTML=`<div class="muted">选一位好友开始私聊，选多位创建群聊。</div>${others.map(a=>`<label class="xc-chk"><input type="checkbox" value="${esc(a)}">${esc(profile(a).name)}</label>`).join('')||'<p class="muted">先添加好友，等待对方接受。</p>'}<input id="xc-gname" placeholder="群聊名称" maxlength="30"><button id="xc-create" class="primary">创建会话</button><div id="xc-err" role="status" class="muted"></div>`;
  box.querySelector('#xc-create').onclick=async()=>{const button=box.querySelector('#xc-create');if(button.disabled)return;button.disabled=true;button.textContent='正在创建…';try{const members=[...box.querySelectorAll('input[type=checkbox]:checked')].map(e=>e.value);if(!members.length)throw Error('请至少选择 1 位好友');const c=await walletAction('conversation',{members,name:box.querySelector('#xc-gname').value});openChatPane(root);cur=c.id;sessionStorage.setItem('sv:wallet-conv',cur);newOpen=false;renderNew();await render();}catch(e){box.querySelector('#xc-err').textContent=e.message;}finally{if(button.isConnected){button.disabled=false;button.textContent='创建会话';}}};
 }
 async function openMessage(id){
  const who=identity(),data=await call('message-open',{id});if(data.uri){const response=await fetchContent(data.uri);if(!response.ok)throw Error('图片已过期');Object.assign(data,await response.json());}if(identity()!==who)return;
  opened.set(id,data);if(data.viewUntil)deadlines.set(id,data.viewUntil);await render();
 }
 async function render(){
  const rev=++revision,who=identity();if(me!==who){me=who;cur=null;opened.clear();deadlines.clear();drafts.clear();root.querySelector('#xc-frbox').classList.add('hidden');root.querySelector('#xc-newbox').classList.add('hidden');friendOpen=newOpen=false;}
  root.querySelector('#wallet-chat-me').textContent=who?`${profile(who).name} · ${who.slice(0,6)}…${who.slice(-4)}`:'连接钱包后开始聊天';
  root.querySelector('#xc-list').innerHTML=convs().map(c=>{const m=messages().filter(m=>m.conv===c.id).at(-1);return `<div class="xc-item ${c.id===cur?'on':''}" role="button" tabindex="0" data-conv="${esc(c.id)}" data-search="${esc(label(c)+' '+(c.type==='dm'?uidOf(c.members.find(a=>a!==who)||who):''))}"><div class="xc-av">${c.type==='dm'?esc(label(c).slice(0,1)):'群'}</div><div class="xc-mid"><div class="xc-row"><b>${esc(label(c))}</b></div><div class="xc-prev">${m?(m.kind==='paid-image'?'付费图片':m.burn?'阅后即焚消息':'新消息 / 图片'):'打个招呼吧'}</div></div></div>`;}).join('');
  filterConversations(root);
  const pane=root.querySelector('#xc-pane'),c=convs().find(c=>c.id===cur);
  if(!c){pane.innerHTML=`<div class="xc-empty"><div class="empty-tape" aria-hidden="true">◉—◉</div><b>${who?'还没打开会话':'连接钱包后开始聊天'}</b><p class="muted">免费私聊、群聊，支持文字、图片和自设阅后即焚。<br>${who?'点击「添加好友」，输入对方的 UID 或钱包地址。':'点击右上角连接钱包。登录签名不会支付费用。'}</p></div>`;return;}
  const old=pane.querySelector('#chat-text'),draft=drafts.get(c.id)||{text:'',burn:false,secs:'10',shot:'allow',file:null};
  const active=old&&document.activeElement===old,selection=active?old.selectionStart:null;
  const rows=[];
  for(const m of messages().filter(m=>m.conv===c.id)){
   const mine=m.from===who;if(m.kind==='paid-image'){const paid=document.createElement('div');paid.className='msg paid-message'+(mine?' me':'');paid.innerHTML=hooks.renderPaidCard(m.contentId,who,'chat');hydrateSafeImages(paid);rows.push(paid);continue;}
   let p=opened.get(m.id);if(p?.viewUntil&&p.viewUntil<=Date.now()){finishContent(p.viewRef);opened.delete(m.id);p=null;}
   const row=document.createElement('div');row.className='msg'+(mine?' me':'');
   if(c.type==='group'){const name=document.createElement('small');name.className='muted';name.textContent=profile(m.from).name;row.append(name);}
   const bubble=document.createElement('div');bubble.className='bubble'+(m.shot==='forbid'?' noshot':'');
   const note=text=>{const el=document.createElement('i');el.className='muted';el.textContent=text;bubble.append(el);};
   if(m.burn){
    if(mine)note(`阅后即焚 · ${m.secs} 秒`);
    else if(m.expired||(deadlines.has(m.id)&&deadlines.get(m.id)<=Date.now())||(m.viewUntil&&m.viewUntil<=Date.now()))note('🔥 已焚毁');
    else if(p){bubble.append(messagePayload(p));const count=document.createElement('small');count.className='count';count.textContent=`${Math.max(0,Math.ceil((p.viewUntil-Date.now())/1000))} 秒后结束展示`;bubble.append(count);}
    else {const button=document.createElement('button');button.className='tapburn';button.dataset.messageOpen=m.id;button.textContent=`🔥 ${m.viewUntil?'继续查看':'点击查看'}（${m.secs} 秒）`;bubble.append(button);}
   }else{if(!p){try{p=await call('message-open',{id:m.id});if(identity()!==who)return;opened.set(m.id,p);}catch{p={text:'消息暂时不可用，稍后重试'};}}bubble.append(messagePayload(p));}
   const time=document.createElement('small');time.className='muted';time.textContent=new Date(m.ts).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});row.append(bubble,time);rows.push(row);
  }
  if(rev!==revision)return;
  const expiryOpen=pane.dataset.conv===c.id&&pane.querySelector('.expiry-control')?.open;pane.dataset.conv=c.id;
  pane.innerHTML=chatHeader({name:label(c),uid:c.type==='dm'?uidOf(c.members.find(a=>a!==who)||who):'',group:c.type==='group',members:c.members.length,local:false})+`<div id="chat-list" class="chat-list"></div><form id="chat-form" class="chat-input"><input id="chat-text" maxlength="500" placeholder="发送消息…" autocomplete="off"><label class="secondary free-image-button" for="chat-file">${icon('plus')}<span>图片</span></label><input class="sr-only" type="file" id="chat-file" accept="image/png,image/jpeg,image/webp,image/gif">${expiryControl([5,10,30,60])}<button id="chat-paid" type="button" class="secondary chat-paid">${icon('lock')}<span>付费图片</span></button><button type="submit" class="primary">发送</button><span class="draft-image-name muted">${esc(draft.file?.name||'')}</span><button class="text-button ${draft.file?'':'hidden'}" id="remove-chat-file" type="button">移除图片</button><span id="chat-error" class="error" role="alert"></span></form>`;
  pane.querySelector('#chat-list').replaceChildren(...rows);
  const text=pane.querySelector('#chat-text'),burn=pane.querySelector('#chat-burn'),secs=pane.querySelector('#chat-secs');text.value=draft.text;burn.checked=draft.burn;secs.value=draft.secs;pane.querySelector('.expiry-control').open=!!expiryOpen;
  const save=()=>{draft.text=text.value;draft.burn=burn.checked;draft.secs=secs.value;drafts.set(c.id,draft);};text.oninput=burn.onchange=secs.onchange=save;
  pane.querySelector('#chat-file').onchange=e=>{draft.file=e.target.files[0];save();render();};pane.querySelector('#remove-chat-file').onclick=()=>{draft.file=null;save();render();};
  pane.querySelector('#chat-paid').onclick=()=>hooks.compose({...c,label:label(c)});
  pane.querySelectorAll('[data-message-open]').forEach(b=>b.onclick=()=>openMessage(b.dataset.messageOpen).catch(tell));
  pane.querySelector('#chat-form').onsubmit=async e=>{e.preventDefault();save();const submit=pane.querySelector('button[type=submit]');submit.disabled=true;
   try{let image,mime;if(draft.file){if(draft.file.size>2*1024*1024)throw Error('请选择 2 MB 以内的图片');mime=draft.file.type;image=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(draft.file);});}
    await walletAction('send',{conv:c.id,text:draft.text,image,mime,burn:draft.burn,secs:Number(draft.secs),shot:draft.shot});draft.text='';draft.file=null;drafts.set(c.id,draft);await render();
   }catch(e){if(pane.querySelector('#chat-error'))pane.querySelector('#chat-error').textContent=e.message;}finally{if(submit.isConnected)submit.disabled=false;}
  };
  if(active){text.focus();text.setSelectionRange(selection,selection);}const list=pane.querySelector('#chat-list');list.scrollTop=list.scrollHeight;
 }
 window.addEventListener('snapvault:change',()=>{render().catch(tell);if(friendOpen&&!root.querySelector('#xc-frbox').contains(document.activeElement))renderFriends();});window.addEventListener('snapvault:identity',()=>render().catch(tell));
 const expiry=setInterval(()=>{let expired=false;for(const[id,p]of opened)if(p.viewUntil&&p.viewUntil<=Date.now()){finishContent(p.viewRef);opened.delete(id);expired=true;}if(expired||[...opened.values()].some(p=>p.viewUntil))render().catch(tell);},500);window.addEventListener('pagehide',()=>{for(const p of opened.values())finishContent(p.viewRef);clearInterval(expiry);},{once:true});
 await render();return {conversations:()=>convs().map(c=>({...c,label:label(c)})),openWith:async address=>{let c=convs().find(c=>c.type==='dm'&&c.members.includes(address));if(!c)c=await walletAction('conversation',{members:[address]});openChatPane(root);cur=c.id;sessionStorage.setItem('sv:wallet-conv',cur);await render();},sendPaidCard:async(id,conv)=>{await walletAction('send',{conv,kind:'paid-image',contentId:String(id)});cur=conv;sessionStorage.setItem('sv:wallet-conv',cur);await render();}};
}
