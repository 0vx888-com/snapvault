import {wallet,connect,disconnect,initWallet,refresh as walletRefresh,publishWallet,purchaseWallet,openWallet,walletAction,setupNetwork,withdrawWallet} from './wallet.js';
import {local,localCall,localRefresh} from './local-delivery.js';
import { initChat, Friends } from './chat.js';
import { PEOPLE, identity, setIdentity, profile, profiles, uidOf, saveProfile, follows, toggleFollow,
  contents, content, eligible, addContent, order, orderState, purchaseDemo, beginView, CREATOR, FAN, escapeHtml as esc } from './store.js';
const $ = s => document.querySelector(s);
const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
let tapeLink=null;const incoming=new URLSearchParams(location.hash.slice(1));if(incoming.has('key')||incoming.has('claim')){history.replaceState(null,'',location.pathname+location.search);if(/^[0-9]+$/.test(incoming.get('id')||'')&&/^0x[0-9a-fA-F]{64}$/.test(incoming.get('key')||'')&&/^0x[0-9a-fA-F]{64}$/.test(incoming.get('claim')||''))tapeLink={id:incoming.get('id'),key:incoming.get('key'),claim:incoming.get('claim')};}
let feed = 'creators', profileAddress = null, chat, pendingPurchase = null, purchasing = false, viewing = null, viewTask = 0, toastTimer;
const money = c => `${c.price} ${c.token}`;
function toast(text) { $('#toast').textContent = text; $('#toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 4000); }
function go(page) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== page));
  if (page === 'creator') renderTargets();
  document.body.dataset.page=page;
  window.scrollTo({top:0,behavior:'instant'});
}
function creatorPhoto(address){return !wallet.enabled && address===CREATOR?'photo-travel':!wallet.enabled && address==='0xFaN3000000000000000000000000000000000003'?'photo-maker':'photo-sea';}
function creatorCard(p) {
  const count = contents().filter(c => c.creator === p.address && c.scope === 'public').length, picture=creatorPhoto(p.address);
  return `<article class="card creator-card"><div class="creator-cover photo-tile ${picture}" role="img" aria-label="${wallet.enabled?'示例风景封面':'AI 生成的创作者示例封面'}"><span class="creator-tag">${esc(p.tag || '日常分享')}</span><span class="cover-label">${wallet.enabled?'示例封面':'界面示例'}</span></div><div class="creator-info"><div class="creator-identity"><span class="creator-avatar ${wallet.enabled?'':`photo-tile ${picture}`}">${wallet.enabled?p.av:''}</span><div><h3>${esc(p.name)}</h3><span class="creator-uid">${uidOf(p.address)}</span></div><span class="creator-flower" aria-hidden="true">✦</span></div><p>${esc(p.bio || '关于生活，关于我。')}</p><div class="creator-meta"><span>${count} 条公开作品</span><span>${wallet.enabled?'站内资料':'演示创作者'}</span></div><div class="creator-actions"><button class="secondary" data-profile="${p.address}">看看 TA 的日常</button>${identity() === p.address ? '<span class="pill">这是我</span>' : `<button class="${follows().includes(p.address) ? 'secondary' : 'primary'}" data-follow="${p.address}">${follows().includes(p.address) ? '已关注' : '＋ 关注'}</button>`}</div></div></article>`;
}
function renderStories(){
 const list=profiles().slice(0,8);
 $('#creator-stories').innerHTML=`<button class="story-item story-create" data-go-create><span class="story-avatar">＋</span><b>开始分享</b><small>你的创作空间</small></button>`+list.map(p=>`<button class="story-item" data-profile="${p.address}"><span class="story-avatar ${wallet.enabled?'':`photo-tile ${creatorPhoto(p.address)}`}">${wallet.enabled?esc(p.av):''}</span><b>${esc(p.name)}</b><small>${esc(p.tag||'看看新日常')}</small></button>`).join('')+`<div class="story-greeting"><span>YOUR PEOPLE.<br>YOUR MOMENTS.</span><i>✳</i></div>`;
}

function paidCard(id, who = identity(), variant = 'grid') {
  const c = content(id); if (!c || !eligible(c, who)) return '<div class="muted">这张图片未向当前身份开放</div>';
  const state = orderState(c, who), p = profile(c.creator), soldout = !!c.max && c.sold >= c.max;
  const label = state === 'creator' ? '预览我的图片' : state === 'expired' ? '展示已结束' : state === 'delivering' ? '付款已确认 · 密钥交付中' : state === 'ready' ? '已购买 · 点击查看' : state === 'viewing' ? '继续查看' : soldout ? '已售罄' : `🔒 ${money(c)} 解锁`;
  const disabled = state === 'delivering' || state === 'expired' || (state === 'locked' && soldout);
  const image = c.thumb && c.showPreview ? `<img src="${c.thumb}" alt="创作者允许的模糊预览" class="ph">` : '<div class="ph placeholder-art"></div>';
  return `<article class="${variant === 'chat' ? 'paid-chat-card' : 'card content-card'}" data-product-id="${c.id}"><div class="thumb">${image}<div class="lock"><span class="lock-icon">${state === 'expired' ? '⌛' : '🔒'}</span><span>${c.burn ? `打开后展示 ${c.secs} 秒` : '购买后 24 小时内可看'}</span></div></div><div class="meta"><b>${esc(c.title)}</b><button class="creator-link" data-profile="${c.creator}">${p.av} ${esc(p.name)}</button><div class="muted">${c.scope === 'public' ? '公开作品' : '会话专属'} · 已售 ${c.sold || 0}${c.max ? '/' + c.max : ''}</div><button class="${disabled ? 'primary done' : 'primary'}" data-content-action="${state === 'locked' ? 'buy' : 'view'}" data-content-id="${c.id}" ${disabled ? 'disabled' : ''}>${label}</button>${who === c.creator ? `<button class="secondary" data-content-action="share" data-content-id="${c.id}">发送到聊天</button>` : ''}<small class="card-demo">${wallet.enabled ? (wallet.config?.chainId===31337?'本地链 · 免容器交付':(wallet.config?.mainnet?'X Layer 主网 · 自动交付':'X Layer 测试网 · 免容器交付')) : local.enabled ? '本地链 31337 · 测试付款 / 自动交付' : '本地演示 · 不扣款'}</small></div></article>`;
}
function renderProfile() {
  const panel = $('#creator-profile'); panel.classList.toggle('hidden', !profileAddress);
  if (!profileAddress) return;
  const p = profile(profileAddress), mine = profileAddress === identity();
  panel.innerHTML = `<button class="secondary" data-close-profile>← 返回广场</button><div class="profile-header"><div class="profile-avatar">${p.av}</div><div><h2>${esc(p.name)}</h2><div class="muted">${uidOf(profileAddress)}</div><p>${esc(p.bio)}</p></div><div class="profile-actions">${mine ? '<button class="secondary" data-go-create>编辑我的资料</button>' : `<button class="primary" data-follow="${profileAddress}">${follows().includes(profileAddress) ? '已关注' : '＋ 关注'}</button><button class="secondary" data-message="${profileAddress}">申请 / 打开私聊</button>`}</div></div><h3>公开作品</h3><div class="grid">${contents().filter(c => c.creator === profileAddress && c.scope === 'public').reverse().map(c => paidCard(c.id)).join('') || '<p class="empty-state">还没有发布公开作品。</p>'}</div>`;
}
function render() {
  renderStories();
  $('#identity').innerHTML = Object.keys(PEOPLE).map(a => `<option value="${a}">${profile(a).av} ${esc(profile(a).name)}</option>`).join(''); $('#identity').value = identity();
  const query = $('#search').value.trim().toLowerCase();
  const creators = profiles().filter(p => `${p.name} ${uidOf(p.address)} ${p.bio} ${p.tag||''}`.toLowerCase().includes(query) && (feed !== 'following' || follows().includes(p.address)));
  const items = contents().filter(c => eligible(c) && (feed === 'purchased' ? !!order(c.id) : c.scope === 'public' && (feed !== 'following' || follows().includes(c.creator))))
    .filter(c => `${c.title} ${profile(c.creator).name} ${uidOf(c.creator)}`.toLowerCase().includes(query)).reverse();
  $('#creators-grid').innerHTML = ['creators', 'following'].includes(feed) ? creators.map(creatorCard).join('') : '';
  $('#grid').innerHTML = feed === 'creators' ? '' : items.map(c => paidCard(c.id)).join('') || `<p class="empty-state">${feed === 'following' ? '关注创作者后，这里会出现他们的公开新作。' : feed === 'purchased' ? '还没有购买记录。可以在广场或私聊里体验解锁。' : '还没有公开作品，先去创作中心发布一张吧。'}</p>`;
  $('#discovery-summary').textContent = feed === 'creators' ? `${creators.length} 位创作者 · ${wallet.enabled?'站内资料':'当前展示演示资料'}` : feed === 'following' ? `已关注 ${follows().length} 位创作者` : feed === 'purchased' ? `${items.length} 笔${wallet.enabled?'测试链':local.enabled?'本地链':'本地演示'}购买` : `${items.length} 条公开作品 · 最新发布`;
  $('#my-contents').innerHTML = contents().filter(c => c.creator === identity()).reverse().map(c => paidCard(c.id)).join('') || '<p class="empty-state">你还没有发布内容。</p>';
  if (document.activeElement !== $('#profile-name')) $('#profile-name').value = profile(identity()).name;
  if (document.activeElement !== $('#profile-bio')) $('#profile-bio').value = profile(identity()).bio;
  renderProfile();
}
function renderTargets(selected) {
  const old = selected ?? $('#publish-target').value, convs = chat?.conversations() || [];
  $('#publish-target').innerHTML = '<option value="public">公开到创作者广场</option>' + convs.map(c => `<option value="${c.id}">仅当前${c.type === 'dm' ? '私聊' : '群聊'}：${esc(c.label)}</option>`).join('');
  if ([...$('#publish-target').options].some(o => o.value === old)) $('#publish-target').value = old;
  const conv = convs.find(c => c.id === $('#publish-target').value);
  $('#compose-context').classList.toggle('hidden', !conv);
  $('#compose-context').textContent = conv ? `正在给「${conv.label}」发布付费图片 · 仅发布时的会话成员可购买，不会上广场` : '';
}
async function publish(e) {
  e.preventDefault(); const submit = $('#form button[type="submit"]'); submit.disabled = true; $('#log').textContent = '';
  const creator = identity();
  try {
    if(wallet.enabled&&!creator)throw Error('请先连接钱包并签名登录');
    const file = $('#file').files[0]; if (!file) throw new Error('请选择图片');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片');
    if (file.size > 2 * 1024 * 1024) throw new Error('本地演示请使用 2 MB 以内的图片');
    const title = $('#title').value.trim(), price = Number($('#price').value), secs = Number($('#secs').value), max = Number($('#max').value);
    if (!title || !Number.isFinite(price) || price <= 0 || !Number.isInteger(secs) || secs < 3 || secs > 3600 || !Number.isInteger(max) || max < 0 || max > 1_000_000) throw new Error('请检查标题、价格、时长和限量');
    const target = $('#publish-target').value, conv = target === 'public' ? null : chat.conversations().find(c => c.id === target);
    if (target !== 'public' && !conv) throw new Error('当前身份不在这个会话中');
    if(wallet.enabled||local.enabled){
      $('#log').textContent='正在加密上传并提交本地链上架交易…';
      const result=await (wallet.enabled?publishWallet:body=>localCall('publish',body))({who:creator,image:b64(await file.arrayBuffer()),meta:{title,price,secs,max,mime:file.type,scope:conv?conv.type:'public',convId:conv?.id||null,audience:conv?[...conv.members]:[],burn:$('#content-burn').checked}});
      if(identity()!==creator)throw Error('身份已变化，上架已提交，请切回原身份查看');
      if(wallet.enabled)await walletRefresh();else await localRefresh(creator);const product=result.product;
      $('#log').textContent=(wallet.config?.mainnet?'上架成功 #':'测试上架成功 #')+product.id+'\n'+product.publishTx+'\n密文由测试服务保存，密钥按链上订单加密交付。未使用真钱。';
      $('#file').value='';$('#title').value='';
      if(conv){await chat.sendPaidCard(product.id,conv.id);go('chat');}else{feed='latest';document.querySelectorAll('[data-feed]').forEach(b=>b.classList.toggle('on',b.dataset.feed===feed));go('fan');}
      render();toast('已发布 · 本地链测试');return;
    }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12)), ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await file.arrayBuffer()));
    const blob = new Uint8Array(12 + ciphertext.length); blob.set(iv); blob.set(ciphertext, 12);
    const hash = '0x' + hex(await crypto.subtle.digest('SHA-256', blob)); let thumb = '';
    if ($('#show-preview').checked) {
      const bitmap = await createImageBitmap(file), canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = Math.max(1, Math.min(96, Math.round(24 * bitmap.height / bitmap.width))); canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); thumb = canvas.toDataURL('image/jpeg', .5); bitmap.close();
    }
    if (identity() !== creator) throw new Error('演示身份发生变化，请重新发布');
    const product = addContent({ title, price, token: $('#token').value, secs, max, hash, uri: 'mock-ipfs://' + hash.slice(2), creator,
      scope: conv ? conv.type : 'public', convId: conv?.id || null, audience: conv ? [...conv.members] : [], burn: $('#content-burn').checked,
      showPreview: $('#show-preview').checked, thumb, mime: file.type }, b64(blob), b64(await crypto.subtle.exportKey('raw', key)));
    $('#log').textContent = `✅ 图片已加密并保存到本浏览器，编号 #${product.id}\n✅ ${conv ? '已发送到「' + conv.label + '」' : '已发布到创作者广场'}\n本地演示：未上传 IPFS、未写链、未使用 TapeSend。`;
    $('#file').value = ''; $('#title').value = '';
    if (conv) { chat.sendPaidCard(product.id, conv.id); go('chat'); }
    else { feed = 'latest'; document.querySelectorAll('[data-feed]').forEach(b => b.classList.toggle('on', b.dataset.feed === feed)); go('fan'); }
    render(); toast('发布成功 · 本地演示');
  } catch (error) { $('#log').textContent = '❌ ' + error.message; }
  finally { submit.disabled = false; }
}
async function openPurchase(id) {
  const c = content(id); if (!eligible(c)) return toast('当前身份没有购买权限');
  if (c.creator === identity() || order(id)) return view(id).catch(e => toast(e.message));
  if(wallet.enabled){try{const route=await walletAction('delivery-route');$('#purchase-route').textContent=route.available?'本单付款后由平台 C 自动通过官方 TapeSend 发送查看链接。':route.reason;}catch(e){return toast(e.message);}}else $('#purchase-route').textContent='本地演示交付。';
  pendingPurchase = { id: c.id, buyer: identity() }; $('#purchase-error').textContent = '';
  $('#purchase-detail').innerHTML = `<h3>${esc(c.title)}</h3><p>创作者：${esc(profile(c.creator).name)}</p><strong class="purchase-price">${money(c)}</strong><p>${c.burn ? `首次打开后展示 ${c.secs} 秒` : '购买后 24 小时内重复查看'}，请在付款后 24 小时内打开。</p><p class="muted">平台费 ${wallet.enabled?((wallet.config?.feeBps??1000)/100)+'%':'10%（演示）'}。买家：${esc(profile(identity()).name)}</p>`;
  $('#confirm-purchase').disabled = false; $('#confirm-purchase').textContent = wallet.enabled?(wallet.config?.mainnet?'钱包确认付款（真实 OKB）':'钱包确认测试付款'):local.enabled?'确认本地测试付款':'模拟付款并解锁'; $('#purchase-dialog').showModal();
}
async function confirmPurchase() {
  if (purchasing || !pendingPurchase) return;
  purchasing = true; const request = pendingPurchase; $('#confirm-purchase').disabled = true; $('#confirm-purchase').textContent = wallet.enabled?'等待钱包与链上确认…':local.enabled?'本地链确认中…':'模拟确认中…';
  try {
    if (identity() !== request.buyer) throw new Error('身份已变化，请重新确认订单');
    if(wallet.enabled){await purchaseWallet(request.id);}else if(local.enabled){await localCall('purchase',{who:request.buyer,id:request.id});if(identity()!==request.buyer)throw Error('身份已变化；付款已提交，请切回原身份查看');await localRefresh(request.buyer);}else await purchaseDemo(request.id, request.buyer); $('#purchase-dialog').close(); pendingPurchase = null;
    toast((wallet.enabled||local.enabled)?(wallet.config?.mainnet?'链上付款已确认，正在自动交付；打开图片后开始计时。':'测试链付款已确认，正在自动交付密钥；可查看后点击图片开始计时。'):'演示购买成功，点击卡片查看图片；此时才开始倒计时。'); render();
  } catch (e) { $('#purchase-error').textContent = e.message; }
  finally { purchasing = false; $('#confirm-purchase').disabled = false; $('#confirm-purchase').textContent = wallet.enabled?(wallet.config?.mainnet?'钱包确认付款（真实 OKB）':'钱包确认测试付款'):local.enabled?'确认本地测试付款':'模拟付款并解锁'; }
}
function closeViewer() {
  viewTask++; if (viewing) { clearInterval(viewing.timer); URL.revokeObjectURL(viewing.url); viewing = null; }
  $('#vimg').removeAttribute('src'); $('#wm').textContent = ''; $('#viewer').classList.add('hidden'); window.dispatchEvent(new Event('snapvault:change')); render();
}
async function view(id) {
  const c = content(id), who = identity(), task = ++viewTask;
  if (!eligible(c, who)) throw new Error('当前身份没有查看权限');
  if (who !== c.creator && !order(id, who)) throw new Error('请先购买');
  if (orderState(c, who) === 'expired') throw new Error('本次查看权限已结束');
  let blob,keyBytes,opened;
  if(wallet.enabled||local.enabled){
    opened=wallet.enabled?await openWallet(id):await localCall('open',{who,id});
    const response=await fetch(opened.uri);if(!response.ok)throw Error('密文网关读取失败');
    blob=new Uint8Array(await response.arrayBuffer());
    keyBytes=Uint8Array.from(opened.key.slice(2).match(/../g),h=>parseInt(h,16));
  }else{
    const stored=localStorage.getItem('blob:'+c.hash.slice(2)),raw=localStorage.getItem('key:'+c.id);
    if(!stored||!raw)throw Error('本地演示的图片或密钥缺失，未开始查看计时');
    blob=unb64(stored);keyBytes=unb64(raw);
  }
  if('0x'+hex(await crypto.subtle.digest('SHA-256',blob))!==c.hash)throw Error('图片完整性核验失败');
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt']);
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:blob.slice(0,12)},key,blob.slice(12));
  if (task !== viewTask || identity() !== who) return;
  if (viewing) { clearInterval(viewing.timer); URL.revokeObjectURL(viewing.url); }
  const o = (wallet.enabled||local.enabled)?opened:beginView(c, who), url = URL.createObjectURL(new Blob([plaintext], { type: c.mime || 'image/png' }));
  viewing = { url, who, id }; $('#vimg').src = url; $('#view-title').textContent = c.title + (o.preview ? ' · 作者预览' : '');
  $('#wm').innerHTML = Array.from({ length: 20 }, () => `<span>${esc(profile(who).name)} · ${uidOf(who)}</span>`).join(''); $('#viewer').classList.remove('hidden');
  const tick = () => {
    const left = o.viewUntil ? Math.max(0, Math.ceil((o.viewUntil - Date.now()) / 1000)) : null;
    $('#count').textContent = left === null ? '已解锁 · 关闭即可返回聊天' : `${left} 秒后结束展示`;
    $('#prog').style.width = (left === null ? 100 : Math.min(100, left / c.secs * 100)) + '%';
    if (left === 0 || (!o.preview && Date.now() >= o.accessUntil)) closeViewer();
  };
  viewing.timer = setInterval(tick, 250); tick();
}
function openShare(id) {
  const c = content(id); if (!c || c.creator !== identity()) return toast('只能发送自己的作品');
  const convs = chat.conversations().filter(conv => c.scope === 'public' || conv.id === c.convId); $('#share-error').textContent = '';
  $('#share-list').innerHTML = convs.map(conv => `<button class="secondary" data-share-content="${c.id}" data-share-conv="${conv.id}">${conv.type === 'group' ? '👥' : '💬'} ${esc(conv.label)}</button>`).join('') || '<p>还没有可发送的会话，先去消息中添加好友或创建群聊。</p>'; $('#share-dialog').showModal();
}
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.tab) go(b.dataset.tab);
    else if (b.hasAttribute('data-go-create')) { go('creator'); $('#form').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (b.dataset.feed) { feed = b.dataset.feed; profileAddress = null; document.querySelectorAll('[data-feed]').forEach(x => x.classList.toggle('on', x === b)); render(); }
    else if (b.dataset.profile) { profileAddress = b.dataset.profile; go('fan'); render(); $('#creator-profile').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (b.hasAttribute('data-close-profile')) { profileAddress = null; render(); }
    else if (b.dataset.follow) toggleFollow(b.dataset.follow);
    else if (b.dataset.message) {
      const address = b.dataset.message;
      if (!Friends.isFriend(identity(), address)) { await Friends.request(identity(), address); toast('好友申请已发送，对方接受后可以私聊'); }
      else { await chat.openWith(address); go('chat'); }
    } else if (b.dataset.contentAction === 'buy') openPurchase(b.dataset.contentId);
    else if (b.dataset.contentAction === 'view') await view(b.dataset.contentId);
    else if (b.dataset.contentAction === 'share') openShare(b.dataset.contentId);
    else if (b.dataset.shareConv) { await chat.sendPaidCard(b.dataset.shareContent, b.dataset.shareConv); $('#share-dialog').close(); go('chat'); toast('已发送到会话'); }
  } catch (error) { toast(error.message); }
});
$('#try-demo').onclick = async () => {
  if(wallet.enabled){go('creator');return toast('钱包模式请发布一张测试图片，再请另一位测试账户购买。');}
  if(local.enabled){go('creator');return toast('本地链模式请上传一张测试图片体验完整交付。');}
  const button=$('#try-demo');button.disabled=true;
  try{
    if(identity()===CREATOR)setIdentity(FAN);
    let product=contents().find(c=>c.demoSample&&c.creator===CREATOR);
    if(!product){
      const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=660;
      const ctx=canvas.getContext('2d'),img=new Image();img.src=new URL('assets/studio.svg',import.meta.url).href;await img.decode();
      ctx.fillStyle='#e9e5d8';ctx.fillRect(0,0,1000,660);ctx.drawImage(img,0,0,1000,500);
      ctx.fillStyle='#243b31';ctx.font='36px Georgia';ctx.fillText('A moment, just for you.',50,565);ctx.font='20px sans-serif';ctx.fillText('SnapVault · 演示插画 / 不扣款',50,615);
      const data=await(await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer();
      const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
      const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data)),blob=new Uint8Array(12+ct.length);blob.set(iv);blob.set(ct,12);
      const hash='0x'+hex(await crypto.subtle.digest('SHA-256',blob));
      product=addContent({title:'演示作品 · 镜头之外',price:'0.01',token:'OKB',secs:10,max:0,hash,uri:'mock-ipfs://'+hash.slice(2),creator:CREATOR,scope:'public',audience:[],burn:true,mime:'image/png',demoSample:true,thumb:'',showPreview:false},b64(blob),b64(await crypto.subtle.exportKey('raw',key)));
    }
    feed='latest';document.querySelectorAll('[data-feed]').forEach(x=>x.classList.toggle('on',x.dataset.feed===feed));go('fan');render();
    if(order(product.id))await view(product.id);else openPurchase(product.id);
  }catch(error){toast(error.message);}finally{button.disabled=false;}
};
$('#open-chat').onclick=()=>go('chat');
$('#about-preview').onclick=$('#preview-details').onclick=()=>$('#preview-dialog').showModal();
// Local integration links are useful only on the developer's own machine.
if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))document.querySelector('.dev-tools')?.remove();
$('#identity').onchange = e => setIdentity(e.target.value);
$('#search').oninput = render; $('#publish-target').onchange = () => renderTargets();
$('#content-burn').onchange = () => { $('#secs').disabled = !$('#content-burn').checked; };
$('#form').onsubmit = publish; $('#confirm-purchase').onclick = confirmPurchase;
$('#cancel-purchase').onclick = () => $('#purchase-dialog').close(); $('#close-viewer').onclick = closeViewer;
$('#connect').onclick = () => toast('当前只演示前端流程，真实钱包付款与 TapeSend 交付尚未接入；不会发起交易。');
$('#save-profile').onclick = async () => {
 try {
  const name = $('#profile-name').value.trim(); if (!name) return toast('请填写昵称');
  await saveProfile(identity(), { name, bio: $('#profile-bio').value.trim() }); $('#profile-feedback').textContent = '已保存 · 资料会出现在创作者广场';
 }catch(error){toast(error.message);}
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && viewing) closeViewer(); });
document.addEventListener('visibilitychange', () => { $('#viewer').classList.toggle('viewer-obscured', document.hidden); });
window.addEventListener('snapvault:change', render);
window.addEventListener('snapvault:identity', () => {
  if(local.enabled)localRefresh(identity()).catch(e=>toast(e.message));
  closeViewer(); $('#purchase-dialog').close(); $('#share-dialog').close(); pendingPurchase = null; profileAddress = null; $('#profile-feedback').textContent = ''; renderTargets('public'); render();
});
window.addEventListener('storage', e => { if (['contents', 'sv:orders', 'sv:profiles'].includes(e.key) || e.key?.startsWith('sv:follows:')) render(); });
chat = await initChat($('#chat'), { renderPaidCard: paidCard, compose: conv => { go('creator'); renderTargets(conv.id); $('#title').focus(); }, notify: toast });
renderTargets(); render();

if(local.enabled){
 $('.preview-note span:nth-child(2)').textContent='本地链联调：付款和密钥交付使用公开测试账户；普通文字聊天仍为本机演示。不花真钱。';
 $('#mode').textContent='本地链 31337 · 无真钱';
 $('.identity-label').firstChild.textContent='本地测试角色';
 $('#connect').textContent='本地交付说明';
 $('#connect').onclick=()=>toast('仅本地 Hardhat 测试账户；付款与自动密钥消息走本地链。普通聊天仍为本机演示。无需连接钱包。');
 $('#creator > .sub').textContent='沿用现有广场、私聊和群聊。本地链付款后自动交付密钥，本机网关保存密文；重启测试服务会清空作品与订单。';
 $('#purchase-dialog .demo-notice').textContent='仅使用本地链 31337 的公开测试账户，不连接你的钱包、不花真钱。自动交付使用本地容器与官方协议源码，尚未接入官方公共收件箱。';
 $('#token').innerHTML='<option value="OKB">测试 OKB（本地）</option>';$('#price').min='0.000001';$('#price').step='0.000001';$('#price').value='0.00001';
 $('#show-preview').disabled=true;
 document.querySelector('.xc-foot').textContent='付费图片：本地链自动交付 · 文字聊天：本机演示';
 const sync=async()=>{try{await localRefresh(identity());$('#mode').textContent='本地链 31337 · 无真钱';}catch(e){$('#mode').textContent='本地交付服务不可用';}};
 await sync();setInterval(sync,2000);
}

if(wallet.enabled){
 const networkButton=document.createElement('button');networkButton.className='secondary';networkButton.id='wallet-network';networkButton.textContent='切换测试网络';networkButton.onclick=()=>setupNetwork().catch(e=>toast(e.message));$('#connect').after(networkButton);
 $('.identity-label').classList.add('hidden');document.querySelector('.dev-tools')?.classList.add('hidden');
 $('#try-demo').textContent='发布测试图片 ↗';
 $('#connect').textContent=wallet.token?'退出登录':'连接钱包';
 $('#connect').onclick=async()=>{try{if(wallet.token)disconnect();else await connect();$('#connect').textContent=wallet.token?'退出 '+identity().slice(0,6)+'…':'连接钱包';}catch(e){toast(e.message);}};
 $('#creator > .sub').textContent='普通钱包即可发布，无需个人容器。当前只允许本地链或 X Layer 测试网。';
 $('#purchase-dialog .demo-notice').textContent='请检查钱包网络、收款合约和金额。此版本只开放本地链 / X Layer 测试网，不花真钱。普通订单无需容器。';
 $('#token').innerHTML='<option value="OKB">测试 OKB</option>';$('#price').min='0.000001';$('#price').step='0.000001';$('#price').value='0.00001';$('#show-preview').disabled=true;
 $('.preview-note span:nth-child(2)').textContent='测试版本：钱包签名登录，免费聊天发图；付费图片使用测试币并按订单交付。未开放主网。';
 $('#preview-dialog h2').textContent='钱包与多人聊天测试版';
 $('#preview-dialog').querySelectorAll('p:not(.eyebrow):not(.field-note)').forEach((p,i)=>p.textContent=[
 '本模式使用真实钱包签名登录，聊天与图片通过站内服务同步。普通用户和创作者均无需开通容器。',
 '付费图片需在本地链或 X Layer 测试网确认交易，随后将内容密钥加密给已登录浏览器。当前不开放主网收款。',
 '测试服务会接触消息和内容密钥，不宣称平台无法读取。生产服务、正式 DeWEB 和公共内容存储尚未上线。'][i]||'');
 try{await initWallet();const mainnet=wallet.config.mainnet;$('#mode').textContent=wallet.config.networkName||(wallet.config.chainId===31337?'本地链 · 无真钱':'X Layer 测试网');$('#wallet-network').textContent='切换'+(mainnet?'主网':'测试网络');$('#token').innerHTML='<option value="OKB">'+(wallet.config.symbol||'测试 OKB')+'</option>';if(mainnet){$('#try-demo').textContent='发布图片 ↗';$('#creator > .sub').textContent='普通钱包发布内容，付款使用 X Layer 主网 OKB。';$('.preview-note span:nth-child(2)').textContent='X Layer 主网：聊天发图免费，付费图片与提现会产生真实 OKB 交易。已有可用容器时优先 TapeSend，无容器走普通交付。';$('#purchase-dialog .demo-notice').textContent='本单使用真实 OKB。请核对金额、合约和当前交付方式；付款、提现均由你在钱包确认。';$('#preview-dialog h2').textContent='SnapVault · X Layer';}$('#wallet-earnings').classList.remove('hidden');$('#delivery-settings').classList.remove('hidden');$('#connect').textContent=wallet.token?'退出 '+identity().slice(0,6)+'…':'连接钱包';}catch(e){$('#mode').textContent='服务未就绪';toast(e.message);}
 setInterval(()=>{if(!document.hidden)walletRefresh().catch(e=>{$('#mode').textContent=e.message;});},10000);
 window.addEventListener('snapvault:delivery-route',e=>toast(e.detail));
 $('#save-delivery').onclick=async()=>{try{await walletAction('delivery-settings',{circuits:$('#delivery-circuits').value.trim(),tokenId:$('#delivery-token').value.trim()});const route=await walletAction('delivery-route');$('#delivery-feedback').textContent=route.available?'已核对，付款后通过官方 TapeSend 交付。':route.reason;}catch(e){$('#delivery-feedback').textContent=e.message;}};
 $('#refresh-earnings').onclick=async()=>{try{const e=await walletAction('earnings');$('#earnings-amount').textContent='可提现 '+e.amount+' '+(wallet.config.symbol||'OKB');}catch(e){$('#earnings-feedback').textContent=e.message;}};
 $('#withdraw-earnings').onclick=async()=>{try{const tx=await withdrawWallet();$('#earnings-feedback').textContent='提现已确认：'+tx;$('#refresh-earnings').click();}catch(e){$('#earnings-feedback').textContent=e.message;}};
 window.addEventListener('snapvault:identity',()=>{closeViewer();$('#connect').textContent=wallet.token?'退出 '+identity().slice(0,6)+'…':'连接钱包';});
}

// TAP-10 link contains key ONLY in its fragment; never send it over HTTP/storage.
if(tapeLink&&wallet.enabled){const section=document.createElement('section');section.className='card profile-editor';const title=document.createElement('h3');title.textContent='TapeSend 已购内容';const note=document.createElement('p');note.className='field-note';note.textContent='查看链接请勿转发。点击打开后开始计时，无法阻止截图或保存。';const button=document.createElement('button');button.className='primary';button.textContent='打开已购图片';const status=document.createElement('p');status.className='error';section.append(title,note,button,status);document.querySelector('main').prepend(section);button.onclick=async()=>{button.disabled=true;try{const opened=await (await import('./wallet.js')).call('claim-open',{id:tapeLink.id,claim:tapeLink.claim});const res=await fetch(new URL((wallet.base||'')+opened.uri,location.href));if(!res.ok)throw Error('密文读取失败');const bytes=new Uint8Array(await res.arrayBuffer());if('0x'+hex(await crypto.subtle.digest('SHA-256',bytes))!==opened.hash)throw Error('图片完整性核验失败');const key=await crypto.subtle.importKey('raw',Uint8Array.from(tapeLink.key.slice(2).match(/../g),x=>parseInt(x,16)),'AES-GCM',false,['decrypt']);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12));closeViewer();const until=opened.viewUntil||opened.accessUntil,url=URL.createObjectURL(new Blob([plain],{type:opened.mime}));viewing={url,timer:null};$('#view-title').textContent=opened.title;$('#vimg').src=url;$('#wm').textContent='SnapVault · 已购内容';$('#viewer').classList.remove('hidden');const duration=Math.max(1,until-Date.now());viewing.timer=setInterval(()=>{const left=until-Date.now();$('#count').textContent=Math.max(0,Math.ceil(left/1000))+' 秒';$('#prog').style.width=Math.max(0,left/duration*100)+'%';if(left<=0)closeViewer();},200);status.textContent='图片解密成功。';}catch(e){status.textContent=e.message;}finally{button.disabled=false;}};}
