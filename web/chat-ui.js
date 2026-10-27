import {identity,uidOf,escapeHtml as esc} from './store.js';

export function chatHeader({name,uid='',group=false,members=0,local=false,photo='',settings=''}){
 const infoIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.5v.5"/></svg>';
 const moreIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';
 const copyIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></svg>';
 const kind=group?'Group chat':'Direct message';
 const privacy=local?'Local demo · 本地演示':'Service chat · 服务同步';
 const explanation=local?'消息保存在当前浏览器。这是本地演示，不代表真实多人端到端加密。':'消息通过平台服务同步。平台服务可处理内容，当前不宣称端到端加密。';
 return `<div class="xc-head"><div class="xc-av chat-head-avatar ${photo?'photo-tile '+photo:''}" aria-hidden="true">${photo?'':group?'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5"/></svg>':esc(name.slice(0,1))}</div><div class="chat-heading"><div class="chat-name-row"><b>${esc(name)}</b><span class="chat-kind">${kind}</span></div><div class="chat-identity-row">${uid?`<button class="peer-uid" data-copy-uid="${esc(uid)}" title="Copy UID · 复制 UID" aria-label="Copy UID ${esc(uid)}">UID ${esc(uid)} ${copyIcon}</button>`:`<span class="chat-member-count">${members} members · ${members} 位成员</span>`}</div></div><div class="head-actions"><details class="head-info"><summary title="Chat info · 会话信息" aria-label="Chat info · 会话信息">${infoIcon}<span>Chat info</span></summary><div class="head-popover"><p class="popover-eyebrow">Conversation details</p><strong>${esc(name)}</strong><p>${kind}${group?' · '+members+' members':''}</p><div class="chat-privacy-label">${privacy}</div><p>${explanation}</p><small>限时展示无法阻止截图，网页也无法可靠检测系统截图。</small>${uid?`<button class="head-menu-button" data-copy-uid="${esc(uid)}">Copy UID <span>复制 UID</span></button>`:''}</div></details><details class="head-menu"><summary title="Chat options · 会话选项" aria-label="Chat options · 会话选项">${moreIcon}</summary><div class="head-popover"><p class="popover-eyebrow">Chat options <span>会话选项</span></p>${settings||'<button class="head-menu-button" data-add-friend>Contacts <span>好友与申请</span></button>'}</div></details></div></div>`;
}

export function expiryControl(times=[5,10,30]){
 return `<details class="expiry-control"><summary aria-label="Disappearing messages · 阅后即焚设置" title="Disappearing messages · 阅后即焚"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg><span class="expiry-state">Disappearing off</span><svg class="expiry-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3"/></svg></summary><div class="expiry-panel"><div class="expiry-title"><b>Disappearing messages</b><span>阅后即焚</span></div><label class="expiry-switch-row"><span>限时查看</span><span class="ios-switch"><input type="checkbox" id="chat-burn" aria-label="启用阅后即焚"><span class="switch-track" aria-hidden="true"></span></span></label><div class="expiry-section-label">查看时长 <span>View duration</span></div><div class="expiry-segments" role="radiogroup" aria-label="查看时长">${times.map(n=>`<button type="button" role="radio" aria-checked="false" data-expiry="${n}">${n}<span>s</span></button>`).join('')}</div><select id="chat-secs" class="sr-only" tabindex="-1" aria-hidden="true">${times.map(n=>`<option value="${n}" ${n===10?'selected':''}>${n}</option>`).join('')}</select><p>对方点开消息后开始计时。限时展示无法阻止截图。</p></div></details>`;
}
function updateExpiry(root){
 const control=root.querySelector('.expiry-control');if(!control)return;
 const enabled=control.querySelector('#chat-burn').checked,value=control.querySelector('#chat-secs').value,label=enabled?value+'s timer':'Disappearing off';
 const state=control.querySelector('.expiry-state');if(state.textContent!==label)state.textContent=label;
 control.classList.toggle('enabled',enabled);
 control.querySelectorAll('[data-expiry]').forEach(b=>{const selected=b.dataset.expiry===value;b.setAttribute('aria-checked',String(selected));b.tabIndex=selected?0:-1;});
}

export function openChatPane(root){
 root.querySelector('.xchat')?.classList.add('conversation-open');
 for(const [box,button]of[['#xc-frbox','#xc-fr'],['#xc-newbox','#xc-new']])if(!root.querySelector(box)?.classList.contains('hidden'))root.querySelector(button)?.click();
}
export function filterConversations(root){
 const list=root.querySelector('#xc-list'),query=(root.querySelector('#conversation-search')?.value||'').trim().toLowerCase();
 const rows=[...list.querySelectorAll('[data-conv]')];
 for(const row of rows)row.classList.toggle('hidden',!!query&&!(row.dataset.search||row.textContent).toLowerCase().includes(query));
 let empty=list.querySelector('.conversation-empty');
 if(!empty){empty=document.createElement('p');empty.className='conversation-empty muted';list.append(empty);}
 const message=query?'没有匹配的会话。试试昵称或 UID。':'还没有会话，先添加一位好友。';if(empty.textContent!==message)empty.textContent=message;
 empty.classList.toggle('hidden',rows.some(row=>!row.classList.contains('hidden')));
}

export function setupChatUI(root){
 const layout=root.querySelector('.xchat'),pane=root.querySelector('#xc-pane');
 root.querySelector('#xc-fr').textContent='好友';root.querySelector('#xc-fr').setAttribute('aria-label','添加好友与查看申请');
 root.querySelector('#xc-new').textContent='＋';root.querySelector('#xc-new').setAttribute('aria-label','新建私聊或群聊');
 const self=document.createElement('div');self.className='xc-self';
 self.innerHTML='<span>我的 UID</span><code id="chat-self-uid"></code><button class="copy-icon" data-copy-self aria-label="复制我的 UID">⧉</button>';
 root.querySelector('.xc-me').after(self);
 const search=document.createElement('label');search.className='conversation-search';search.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" id="conversation-search" placeholder="搜索昵称或 UID" aria-label="搜索会话昵称或 UID">';
 root.querySelector('#xc-list').before(search);search.querySelector('input').oninput=()=>filterConversations(root);
 const update=()=>{const who=identity();self.querySelector('code').textContent=who?uidOf(who):'未连接钱包';self.querySelector('button').disabled=!who;};
 update();window.addEventListener('snapvault:identity',()=>{update();search.querySelector('input').value='';layout.classList.remove('conversation-open');});window.addEventListener('snapvault:change',update);
 root.addEventListener('click',e=>{
  if(e.target.closest('[data-conv]'))openChatPane(root);
  if(e.target.closest('.xc-back')){layout.classList.remove('conversation-open');root.querySelector('.xc-item.on')?.focus();window.dispatchEvent(new Event('snapvault:chat-view'));}
  const close=e.target.closest('[data-close-panel]');if(close){const id=close.dataset.closePanel;if(!root.querySelector(id).classList.contains('hidden'))root.querySelector(id==='#xc-frbox'?'#xc-fr':'#xc-new').click();}
  if(e.target.closest('[data-add-friend]')){layout.classList.remove('conversation-open');if(root.querySelector('#xc-frbox').classList.contains('hidden'))root.querySelector('#xc-fr').click();root.querySelector('#xc-fq')?.focus();}
 },true);
 root.addEventListener('keydown',e=>{const row=e.target.closest('[data-conv]');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();row.click();}});
 const enhance=()=>{
  const head=pane.querySelector('.xc-head');
  if(head&&!head.querySelector('.xc-back')){const b=document.createElement('button');b.type='button';b.className='xc-back';b.setAttribute('aria-label','返回消息列表');b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';head.prepend(b);}
  for(const [id,title]of[['#xc-frbox','好友与申请'],['#xc-newbox','新建会话']]){
   const box=root.querySelector(id);if(box.childElementCount&&!box.querySelector('.panel-header')){const h=document.createElement('div');h.className='panel-header';h.innerHTML=`<b>${title}</b><button type="button" data-close-panel="${id}" aria-label="关闭${title}">×</button>`;box.prepend(h);}
  }
  filterConversations(root);updateExpiry(root);
 };
 new MutationObserver(enhance).observe(root,{childList:true,subtree:true});enhance();
 root.addEventListener('change',e=>{if(e.target.matches('#chat-burn,#chat-secs'))updateExpiry(root);});
 root.addEventListener('click',e=>{const choice=e.target.closest('[data-expiry]');if(choice){const control=choice.closest('.expiry-control'),select=control.querySelector('#chat-secs'),toggle=control.querySelector('#chat-burn');select.value=choice.dataset.expiry;toggle.checked=true;select.dispatchEvent(new Event('change',{bubbles:true}));toggle.dispatchEvent(new Event('change',{bubbles:true}));updateExpiry(root);}});
 root.addEventListener('keydown',e=>{const choice=e.target.closest('[data-expiry]');if(choice&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...choice.parentElement.querySelectorAll('[data-expiry]')],index=buttons.indexOf(choice),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();}if(e.key==='Escape'){const control=root.querySelector('.expiry-control[open]');if(control){control.open=false;control.querySelector('summary').focus();}}});
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('.expiry-control')){const control=root.querySelector('.expiry-control');if(control)control.open=false;}});
 root.addEventListener('click',e=>{const summary=e.target.closest('.head-actions summary');if(summary)root.querySelectorAll('.head-actions details[open]').forEach(d=>{if(d!==summary.parentElement)d.open=false;});});
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('.head-actions'))root.querySelectorAll('.head-actions details[open]').forEach(d=>d.open=false);});
 root.addEventListener('keydown',e=>{if(e.key==='Escape')root.querySelectorAll('.head-actions details[open]').forEach(d=>{d.open=false;d.querySelector('summary').focus();});});
 const viewport=()=>{const h=window.visualViewport?.height||innerHeight;layout.style.setProperty('--chat-viewport',h+'px');};viewport();window.visualViewport?.addEventListener('resize',viewport);window.addEventListener('resize',viewport);
 setupBackGesture(layout,pane);
}

// A short edge swipe follows the pointer. Release carries velocity into a damped spring.
function setupBackGesture(layout,pane){
 let x=0,velocity=0,target=0,frame=0,lastFrame=0,tracking=false,dragging=false,startX=0,startY=0,lastX=0,lastTime=0,pointer=null;
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 const paint=()=>{pane.style.transform=x?`translate3d(${Math.max(0,x)}px,0,0)`:'';};
 const finish=()=>{if(target>0){layout.classList.remove('conversation-open');window.dispatchEvent(new Event('snapvault:chat-view'));}layout.classList.remove('gesture-back');x=0;velocity=0;pane.style.transform='';frame=0;};
 const spring=time=>{const dt=Math.min((time-lastFrame)/1000||.016,.032);lastFrame=time;const omega=24;velocity+=(-omega*omega*(x-target)-2*omega*velocity)*dt;x+=velocity*dt;paint();if(Math.abs(x-target)<.5&&Math.abs(velocity)<4)finish();else frame=requestAnimationFrame(spring);};
 const settle=(to,v)=>{target=to;velocity=v;if(reduced()){finish();return;}cancelAnimationFrame(frame);lastFrame=performance.now();frame=requestAnimationFrame(spring);};
 pane.addEventListener('pointerdown',e=>{
  if(!matchMedia('(max-width:760px)').matches||!layout.classList.contains('conversation-open')||(e.clientX>28&&!frame)||e.button!==0)return;
  if(e.target.closest('button,input,select,textarea'))return;
  const moving=!!frame;cancelAnimationFrame(frame);frame=0;tracking=true;dragging=moving;pointer=e.pointerId;if(moving)pane.setPointerCapture(e.pointerId);startX=e.clientX-x;startY=e.clientY;lastX=e.clientX;lastTime=performance.now();
 });
 pane.addEventListener('pointermove',e=>{
  if(!tracking||e.pointerId!==pointer)return;const dx=e.clientX-startX,dy=e.clientY-startY;
  if(!dragging){if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){tracking=false;return;}if(dx<10)return;dragging=true;layout.classList.add('gesture-back');pane.setPointerCapture(e.pointerId);}
  e.preventDefault();const now=performance.now();velocity=(e.clientX-lastX)/Math.max(now-lastTime,1)*1000;lastX=e.clientX;lastTime=now;x=Math.max(0,Math.min(dx,innerWidth));paint();
 },{passive:false});
 const release=e=>{if(!tracking||e.pointerId!==pointer)return;tracking=false;if(!dragging)return;dragging=false;const v=performance.now()-lastTime>90?0:velocity,projected=x+v*.15;settle(e.type!=='pointercancel'&&projected>innerWidth*.38?innerWidth:0,v);};
 pane.addEventListener('pointerup',release);pane.addEventListener('pointercancel',release);
 window.addEventListener('pagehide',()=>cancelAnimationFrame(frame),{once:true});
}
