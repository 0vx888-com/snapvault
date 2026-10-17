import {wallet,call,walletAction} from './wallet.js';
import {identity,profile,uidOf,escapeHtml as esc} from './store.js';
export async function initWalletChat(root,hooks){
 let cur=sessionStorage.getItem('sv:wallet-conv'),me=identity(),revision=0,friendOpen=false,newOpen=false;
 const drafts=new Map(),opened=new Map();
 const tell=e=>hooks.notify?.(e.message||String(e));
 const label=c=>c.type==='dm'?profile(c.members.find(a=>a!==identity())||identity()).name:c.name;
 const convs=()=>wallet.data.convs||[],messages=()=>wallet.data.messages||[];
 root.innerHTML=`<div class="xchat card"><aside class="xc-side"><div class="xc-top"><b>消息</b><span><button class="xc-new" id="xc-fr" title="好友">👥</button><button class="xc-new" id="xc-new" title="新建会话">✉️＋</button></span></div><div class="xc-me"><span class="muted" id="wallet-chat-me"></span></div><div id="xc-frbox" class="xc-newbox hidden"></div><div id="xc-newbox" class="xc-newbox hidden"></div><div id="xc-list" class="xc-list"></div><div class="xc-foot pill">免费聊天发图 · 不逐条上链<br>测试服务可读取内容，尚非端到端加密</div></aside><section class="xc-pane" id="xc-pane"></section></div>`;
 root.querySelector('#xc-fr').onclick=()=>{friendOpen=!friendOpen;renderFriends();};root.querySelector('#xc-new').onclick=()=>{newOpen=!newOpen;renderNew();};
 root.querySelector('#xc-list').onclick=e=>{const id=e.target.closest('[data-conv]')?.dataset.conv;if(id){cur=id;sessionStorage.setItem('sv:wallet-conv',id);render();}};
 function renderFriends(){
  const box=root.querySelector('#xc-frbox');box.classList.toggle('hidden',!friendOpen);if(!friendOpen)return;
  const who=identity(),friends=wallet.data.friends||[];
  box.innerHTML=`<div class="muted">我的地址：<span class="wallet-address">${esc(who||'请先登录')}</span><br>UID：${who?uidOf(who):'—'}</div><input id="xc-fq" placeholder="输入对方已登录的钱包地址"><button id="xc-fadd" class="primary">发送好友申请</button><div id="xc-fmsg" role="status" class="muted"></div>${friends.map(f=>`<div class="muted">${esc(profile(f.from===who?f.to:f.from).name)} · ${f.status==='accepted'?'已是好友':f.to===who?`<button class="secondary" data-accept="${f.from}">接受</button>`:'等待接受'}</div>`).join('')}`;
  box.querySelector('#xc-fadd').onclick=async()=>{try{await walletAction('friend',{to:box.querySelector('#xc-fq').value.trim()});renderFriends();}catch(e){box.querySelector('#xc-fmsg').textContent=e.message;}};
  box.querySelectorAll('[data-accept]').forEach(b=>b.onclick=async()=>{try{await walletAction('friend',{to:b.dataset.accept,accept:true});renderFriends();}catch(e){tell(e);}});
 }
 function renderNew(){
  const box=root.querySelector('#xc-newbox');box.classList.toggle('hidden',!newOpen);if(!newOpen)return;const who=identity(),others=(wallet.data.friends||[]).filter(f=>f.status==='accepted').map(f=>f.from===who?f.to:f.from);
  box.innerHTML=`<div class="muted">选一位好友开始私聊，选多位创建群聊。</div>${others.map(a=>`<label class="xc-chk"><input type="checkbox" value="${a}">${esc(profile(a).name)}</label>`).join('')||'<p class="muted">先添加好友，等待对方接受。</p>'}<input id="xc-gname" placeholder="群聊名称" maxlength="30"><button id="xc-create" class="primary">创建会话</button><div id="xc-err" role="status" class="muted"></div>`;
  box.querySelector('#xc-create').onclick=async()=>{try{const members=[...box.querySelectorAll('input[type=checkbox]:checked')].map(e=>e.value),c=await walletAction('conversation',{members,name:box.querySelector('#xc-gname').value});cur=c.id;sessionStorage.setItem('sv:wallet-conv',cur);newOpen=false;renderNew();await render();}catch(e){box.querySelector('#xc-err').textContent=e.message;}};
 }
 function payloadHTML(p){return `${p.text?`<div>${esc(p.text)}</div>`:''}${p.image?`<img class="chat-photo" src="data:${p.image.mime};base64,${p.image.data}" alt="聊天图片">`:''}`;}
 async function openMessage(id){
  const who=identity(),data=await call('message-open',{id});if(identity()!==who)return;
  opened.set(id,data);await render();
 }
 async function render(){
  const rev=++revision,who=identity();if(me!==who){me=who;cur=null;opened.clear();drafts.clear();root.querySelector('#xc-frbox').classList.add('hidden');root.querySelector('#xc-newbox').classList.add('hidden');friendOpen=newOpen=false;}
  root.querySelector('#wallet-chat-me').textContent=who?`${profile(who).name} · ${who.slice(0,6)}…${who.slice(-4)}`:'连接钱包后开始聊天';
  root.querySelector('#xc-list').innerHTML=convs().map(c=>{const m=messages().filter(m=>m.conv===c.id).at(-1);return `<div class="xc-item ${c.id===cur?'on':''}" data-conv="${c.id}"><div class="xc-av">${c.type==='dm'?'💬':'👥'}</div><div class="xc-mid"><div class="xc-row"><b>${esc(label(c))}</b></div><div class="xc-prev">${m?(m.kind==='paid-image'?'付费图片':m.burn?'阅后即焚消息':'新消息 / 图片'):'打个招呼吧'}</div></div></div>`;}).join('');
  const pane=root.querySelector('#xc-pane'),c=convs().find(c=>c.id===cur);
  if(!c){pane.innerHTML=`<div class="xc-empty"><p style="font-size:42px">💬</p><b>${who?'从一句你好开始':'连接钱包，认识彼此'}</b><p class="muted">免费私聊、群聊，支持文字、图片和自设阅后即焚。<br>${who?'先点好友按钮添加另一个已登录的钱包。':'点击右上角连接钱包。登录签名不会支付费用。'}</p></div>`;return;}
  const old=pane.querySelector('#chat-text'),draft=drafts.get(c.id)||{text:'',burn:false,secs:'10',shot:'allow',file:null};
  const active=old&&document.activeElement===old,selection=active?old.selectionStart:null;
  const rows=[];
  for(const m of messages().filter(m=>m.conv===c.id)){
   const mine=m.from===who;if(m.kind==='paid-image'){rows.push(`<div class="msg ${mine?'me':''} paid-message">${hooks.renderPaidCard(m.contentId,who,'chat')}</div>`);continue;}
   let p=opened.get(m.id),body='';if(p?.viewUntil&&p.viewUntil<=Date.now()){opened.delete(m.id);p=null;}
   if(m.burn){if(mine)body=`<i class="muted">阅后即焚 · ${m.secs} 秒</i>`;else if(m.expired||(m.viewUntil&&m.viewUntil<=Date.now()))body='<i class="muted">🔥 已焚毁</i>';else if(p)body=payloadHTML(p)+`<small class="count">${Math.max(0,Math.ceil((p.viewUntil-Date.now())/1000))} 秒后结束展示</small>`;else body=`<button class="tapburn" data-message-open="${m.id}">🔥 ${m.viewUntil?'继续查看':'点击查看'}（${m.secs} 秒）</button>`;}
   else {if(!p){try{p=await call('message-open',{id:m.id});if(identity()!==who)return;opened.set(m.id,p);}catch{p={text:'消息暂时不可用，稍后重试'};}}body=payloadHTML(p);}
   rows.push(`<div class="msg ${mine?'me':''}">${c.type==='group'?`<small class="muted">${esc(profile(m.from).name)}</small>`:''}<div class="bubble ${m.shot==='forbid'?'noshot':''}">${body}</div><small class="muted">${new Date(m.ts).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</small></div>`);
  }
  if(rev!==revision)return;
  pane.innerHTML=`<div class="xc-head"><div class="xc-av">${c.type==='dm'?'💬':'👥'}</div><div><b>${esc(label(c))}</b><div class="muted">${c.type==='group'?`${c.members.length} 位成员`:'免费私聊'} · 文字与图片</div></div></div><div id="chat-list" class="chat-list">${rows.join('')||'<p class="muted">还没有消息，打个招呼吧。</p>'}</div><form id="chat-form" class="chat-input"><input id="chat-text" maxlength="500" placeholder="写一句话，也可以附上图片…" autocomplete="off"><label class="secondary free-image-button" for="chat-file">＋ 图片</label><input class="sr-only" type="file" id="chat-file" accept="image/png,image/jpeg,image/webp,image/gif"><label class="burn"><input type="checkbox" id="chat-burn"> 🔥 阅后即焚</label><select id="chat-secs" aria-label="查看秒数"><option value="5">5 秒</option><option value="10">10 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select><button id="chat-paid" type="button" class="secondary chat-paid">🔒 付费图片</button><button type="submit" class="primary">发送</button><span class="draft-image-name muted">${esc(draft.file?.name||'')}</span><button class="text-button ${draft.file?'':'hidden'}" id="remove-chat-file" type="button">移除图片</button><span id="chat-error" class="error" role="alert"></span></form>`;
  const text=pane.querySelector('#chat-text'),burn=pane.querySelector('#chat-burn'),secs=pane.querySelector('#chat-secs');text.value=draft.text;burn.checked=draft.burn;secs.value=draft.secs;
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
 const expiry=setInterval(()=>{if([...opened.values()].some(p=>p.viewUntil))render().catch(tell);},500);window.addEventListener('pagehide',()=>clearInterval(expiry),{once:true});
 await render();return {conversations:()=>convs().map(c=>({...c,label:label(c)})),openWith:async address=>{let c=convs().find(c=>c.type==='dm'&&c.members.includes(address));if(!c)c=await walletAction('conversation',{members:[address]});cur=c.id;sessionStorage.setItem('sv:wallet-conv',cur);await render();},sendPaidCard:async(id,conv)=>{await walletAction('send',{conv,kind:'paid-image',contentId:String(id)});cur=conv;sessionStorage.setItem('sv:wallet-conv',cur);await render();}};
}
