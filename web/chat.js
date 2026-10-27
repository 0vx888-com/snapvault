import {icon} from './ui-icons.js';
import {setupChatUI,openChatPane,filterConversations,chatHeader,expiryControl} from './chat-ui.js';
import {wallet,walletAction} from './wallet.js';
import {initWalletChat} from './wallet-chat.js';
// SnapVault 私聊（XChat 风格）：私信、群聊、创作者付费粉丝群，支持阅后即焚。目前是离线模拟。
// 结构：UI -> transport（适配器接口：convs/saveConv/send/list/markViewed）-> MockTapeSendTransport（localStorage）
// 加密模型（模拟 E2E）：
//   - 每个身份一对 ECDH P-256 密钥（模拟由钱包派生）。
//   - 每个会话（私信或群）一把随机 AES-GCM-256 会话密钥。建会话或成员加入时，管理员用 ECDH(管理员, 成员)
//     派生出的密钥把会话密钥「包裹」给每个成员。成员解包后再解密消息。
// TODO(TapeSend / TAP-10，目前还是草案):
//   - 身份密钥换成钱包签名派生的 X25519，消息加密换成 XChaCha20-Poly1305，用 TapeSend 投递到每个成员容器的 endpoint。
//   - 群聊：TapeSend 是一对一的。群消息要么逐个成员发（gas 随人数线性增长），要么链上只发指针，
//     密文放链下。单条消息的大小上限和 gas 还要确认。
//   - 成员变动时要轮换群密钥（新成员看不到历史消息，被移除的成员看不到新消息）。现在只做了加人，没做轮换。
//   - 付费群门控：真实版本读取 SnapVault 合约的 Purchase 事件或 hasAccess（现在读的是 localStorage 里的 purchases）。
//   - 元数据公开：谁发给谁、什么时间、消息多长，链上都看得到。陌生人可以往信箱塞消息。
//   - 阅后即焚是「每个查看者各自焚毁」：自己看过后本地丢掉明文，所有成员都看过后删掉密文。
//     链上的密文删不掉，客户端改一改就能绕过；也拦不住截图。
import { PEOPLE, CREATOR, identity, setIdentity, uidOf, profile, content, hasPurchased, escapeHtml as safeText } from './store.js';
export { PEOPLE, uidOf, hasPurchased } from './store.js';
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const LS = { get: (k, d) => JSON.parse(localStorage.getItem(k) || JSON.stringify(d)), set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };

const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const nm = (a) => profile(a).name || short(a);

// ---------- 付费门控（模拟：读取演示购买记录） ----------

// ---------- 好友（模拟）----------
// TODO(真实版本): UID 和地址的映射放在链上注册表，或者像 ENS 那样解析，最后解析到对方的 TapeSend 地址或容器 endpoint；
//   好友请求本身就是一条 TapeSend 消息，所以元数据公开，任何人都能发，需要防骚扰（付费请求、限频、黑名单）。
export const Friends = {
  all: () => wallet.enabled?(wallet.data.friends||[]):LS.get("chat:friends", []),
  resolve(q) { q = q.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(q)) return wallet.enabled?q.toLowerCase():q; return Object.keys(wallet.enabled?wallet.data.profiles:PEOPLE).find((a) => uidOf(a) === q.toUpperCase()) || null; },
  request(from, to) { if(wallet.enabled)return walletAction('friend',{to}); const a = this.all(); if (from === to) throw new Error("不能加自己"); if (a.some((f) => [f.from, f.to].includes(from) && [f.from, f.to].includes(to))) throw new Error("已经是好友，或者已有待处理的请求"); a.push({ from, to, status: "pending", ts: Date.now() }); LS.set("chat:friends", a); },
  accept(from, to) { if(wallet.enabled)return walletAction('friend',{to:from,accept:true}); const a = this.all(); const f = a.find((x) => x.from === from && x.to === to); if (f) f.status = "accepted"; LS.set("chat:friends", a); },
  isFriend(x, y) { return this.all().some((f) => f.status === "accepted" && [f.from, f.to].includes(x) && [f.from, f.to].includes(y)); },
};
// ---------- 截图策略 ----------
// allow=允许；forbid=禁止（尽力而为：模糊、水印，窗口失焦或切走时遮住内容）；notify=截图时通知发送者（类似 Snapchat）。
// 浏览器拿不到真正的截图事件，只能靠 PrintScreen 或 Cmd+Shift+3/4/5 这类按键、visibilitychange、窗口 blur 来猜。
// 手机系统截图、外接相机拍屏、开发者工具都拦不住，也检测不到。
const SHOT = { allow: "Standard · 默认显示", forbid: "Privacy blur · 模糊显示", notify: "Screenshot hints · 截图提示" };
const shotOf = (c, m) => (m && m.shot) || c.shot || "allow";

// ---------- 模拟 E2E ----------
const Crypto = {
  async identity(addr) {
    const k = "chat:id:" + addr; let s = localStorage.getItem(k);
    if (!s) {
      const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
      s = JSON.stringify({ pub: await crypto.subtle.exportKey("jwk", kp.publicKey), priv: await crypto.subtle.exportKey("jwk", kp.privateKey) });
      localStorage.setItem(k, s);
    }
    const j = JSON.parse(s);
    return { pub: j.pub, priv: await crypto.subtle.importKey("jwk", j.priv, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]) };
  },
  async kek(me, peer) { // 用 ECDH 派生「密钥加密密钥」
    const a = await this.identity(me), b = await this.identity(peer); // 模拟：从公钥注册处取对方公钥
    const pk = await crypto.subtle.importKey("jwk", b.pub, { name: "ECDH", namedCurve: "P-256" }, false, []);
    return crypto.subtle.deriveKey({ name: "ECDH", public: pk }, a.priv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  },
  async aes(key, data) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data)) }; },
  async unaes(key, e) { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(e.iv) }, key, unb64(e.ct))); },
  async wrap(admin, member, raw) { return this.aes(await this.kek(admin, member), raw); },
  async convKey(conv, me) { // 解包自己那份会话密钥
    const w = conv.keys[me]; if (!w) throw new Error("不是成员");
    const raw = await this.unaes(await this.kek(me, conv.admin), w);
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  },
};

// ---------- 传输适配器：模拟 TapeSend ----------
export const MockTapeSendTransport = {
  name: "模拟 TapeSend",
  convs: () => LS.get("chat:convs", []),
  saveConv(c) { const a = this.convs(); const i = a.findIndex((x) => x.id === c.id); i < 0 ? a.push(c) : (a[i] = c); LS.set("chat:convs", a); },
  list: (conv) => LS.get("chat:msgs", []).filter((m) => !conv || m.conv === conv),
  send(m) { const a = LS.get("chat:msgs", []); m.id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); a.push(m); LS.set("chat:msgs", a); },
  markViewed(id, who, members) { // 每个查看者各自焚毁；所有非发送者都看过后删掉密文
    const a = LS.get("chat:msgs", []); const m = a.find((x) => x.id === id); if (!m) return;
    m.viewed = [...new Set([...(m.viewed || []), who])];
    if (members.filter((x) => x !== m.from).every((x) => m.viewed.includes(x))) delete m.env;
    LS.set("chat:msgs", a);
  },
};
let T = MockTapeSendTransport; // TODO(TapeSend): 连接钱包后换成 TapeSendTransport

async function createConv({ type, name, members, admin, gated }) {
  const raw = crypto.getRandomValues(new Uint8Array(32)), keys = {};
  for (const m of members) keys[m] = await Crypto.wrap(admin, m, raw);
  const c = { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type, name, members, admin, gated: !!gated, keys, ts: Date.now() };
  // 演示时管理员的会话原始密钥保存在本机（用于以后给新成员包裹）；真实版本应留在管理员设备上
  localStorage.setItem("chat:raw:" + c.id, b64(raw)); T.saveConv(c); return c;
}
async function addMember(c, who) {
  const raw = unb64(localStorage.getItem("chat:raw:" + c.id)); // TODO: 成员变动时轮换密钥
  c.keys[who] = await Crypto.wrap(c.admin, who, raw); c.members.push(who); T.saveConv(c);
}
async function sendText(c, from, text, burn, secs, shot) {
  T.send({ conv: c.id, from, ts: Date.now(), burn, secs, shot: shot || undefined, env: await Crypto.aes(await Crypto.convKey(c, from), enc.encode(text)) });
}
async function seed() {
  if (T.convs().length) return;
  const [cr, f1, f2, f3] = Object.keys(PEOPLE);
  LS.set("chat:friends", [{ from: cr, to: f1, status: "accepted" }, { from: f3, to: cr, status: "accepted" }, { from: f1, to: f2, status: "accepted" }, { from: f3, to: f1, status: "pending" }]);
  const dm = await createConv({ type: "dm", members: [cr, f1], admin: cr });
  const g = await createConv({ type: "group", name: "小鹿的付费粉丝团 💛", members: [cr, f2], admin: cr, gated: true });
  g.shot = "notify"; T.saveConv(g);
  const g2 = await createConv({ type: "group", name: "粉丝闲聊", members: [f1, f2, f3], admin: f1 });
  const dm2 = await createConv({ type: "dm", members: [cr, f3], admin: cr });
  await sendText(dm, cr, "谢谢支持！今晚给你发一张独家花絮 ✨", false);
  await sendText(dm2, f3, "请问下一期什么时候上？", false);
  await sendText(g2, f2, "大家都解锁今天那张了吗？", false);
  await sendText(g, cr, "欢迎来到付费粉丝团！这里只有买过我内容的钱包才能进 🔐", false);
  await sendText(g, f2, "冲！", false);
  await sendText(g, cr, "群专属福利口令：DEER-2026（10 秒后焚毁）", true, 10);
}

// ---------- UI ----------
let me = identity(), cur = sessionStorage.getItem('sv:conversation'), opened = {}, R, hooks = {}, paneRevision = 0, listRevision = 0;
const drafts = new Map();
const readKey = () => "chat:read:" + me;
const title = (c) => c.type === "dm" ? nm(c.members.find((x) => x !== me) || me) : c.name;
const avatar = (c) => c.type === "dm" ? safeText(nm(c.members.find((x) => x !== me) || me).slice(0,1)) : "群";
const fmt = (ts) => { const d = new Date(ts); return Date.now() - ts < 864e5 ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : `${d.getMonth() + 1}/${d.getDate()}`; };
const visible = (c) => c.members.includes(me) || (c.gated && c.admin === CREATOR && me !== CREATOR);

export async function initChat(root, options = {}) {
  if(wallet.enabled)return initWalletChat(root,options);
  hooks = options;
  R = root;
  root.innerHTML = `
  <div class="xchat card">
    <aside class="xc-side">
      <div class="xc-top"><b>消息</b><span><button class="xc-new" id="xc-fr" title="好友">👥</button> <button class="xc-new" id="xc-new" title="新建会话">✉️＋</button></span></div>
      <div class="xc-me"><span class="muted">演示身份</span><select id="xc-me">${Object.entries(PEOPLE).map(([a, p]) => `<option value="${a}">${safeText(profile(a).name)}（${p.role}）</option>`).join("")}</select></div>
      <div id="xc-frbox" class="xc-newbox hidden"></div><div id="xc-newbox" class="xc-newbox hidden"></div>
      <div id="xc-list" class="xc-list"></div>
      <div class="xc-foot pill">本地演示 · 尚未接入 TapeSend</div>
    </aside>
    <section class="xc-pane" id="xc-pane"></section>
  </div>`;
  setupChatUI(root);
  root.querySelector("#xc-me").value = me;
  root.querySelector("#xc-me").onchange = (e) => setIdentity(e.target.value);
  window.addEventListener('snapvault:identity', () => { me = identity(); cur = null; sessionStorage.removeItem('sv:conversation'); opened = {}; root.querySelector('#xc-me').value = me; R.querySelectorAll('.xc-newbox').forEach(x => x.classList.add('hidden')); render(); });
  window.addEventListener('snapvault:change', () => render());
  root.querySelector("#xc-new").onclick = toggleNew;
  root.querySelector("#xc-fr").onclick = () => { R.querySelector("#xc-frbox").classList.toggle("hidden"); renderFriends(); };
  setupShotDetect();
  root.querySelector("#xc-list").onclick = (e) => { const id = e.target.closest("[data-conv]")?.dataset.conv; if (id) { cur = id; sessionStorage.setItem('sv:conversation', id); render(); } };
  root.querySelector("#xc-pane").onclick = onPane;
  window.addEventListener("storage", (e) => { if (e.key?.startsWith("chat:") || e.key === "purchases") render(); });
  document.querySelector('[data-tab="chat"]')?.addEventListener("click", () => render());
  window.addEventListener('snapvault:chat-view',()=>render());
  await seed(); render();
  const conversations = () => T.convs().filter(c => c.members.includes(me)).map(c => ({ ...c, label: title(c) }));
  return {
    conversations,
    async openWith(address) {
      if (!Friends.isFriend(me, address)) throw new Error('请先添加好友并等待接受');
      const c = T.convs().find(c => c.type === 'dm' && c.members.includes(me) && c.members.includes(address)) || await createConv({ type: 'dm', members: [me, address], admin: me });
      openChatPane(R); cur = c.id; sessionStorage.setItem('sv:conversation', cur); await render();
    },
    sendPaidCard(id, convId) {
      const c = T.convs().find(c => c.id === convId), product = content(id);
      if (!c?.members.includes(me) || product?.creator !== me) throw new Error('你无权在这个会话发送该作品');
      if (product.scope !== 'public' && product.convId !== convId) throw new Error('会话专属作品不能转发到其他会话');
      T.send({ conv: c.id, from: me, ts: Date.now(), kind: 'paid-image', contentId: product.id });
      openChatPane(R); cur = c.id; sessionStorage.setItem('sv:conversation', cur); render();
    },
  };
}

function toggleNew() {
  const box = R.querySelector("#xc-newbox"); box.classList.toggle("hidden");
  const others = [...new Set([...Object.keys(PEOPLE), ...Friends.all().flatMap((f) => [f.from, f.to])])].filter((a) => a !== me && Friends.isFriend(me, a));
  box.innerHTML = `<div class="muted">从好友里选：选 1 人就是私信，选多人就是群聊${others.length ? "" : "（还没有好友，先点「添加好友」）"}</div>
    ${others.map((a) => `<label class="xc-chk"><input type="checkbox" value="${esc(a)}"> ${esc(nm(a))}</label>`).join("")}
    <input id="xc-gname" placeholder="群名（建群时填）" maxlength="30">
    ${me === CREATOR ? `<label class="xc-chk"><input type="checkbox" id="xc-gated"> 付费粉丝群（只有买过我内容的钱包能加入）</label>` : ""}
    <button class="primary" id="xc-create">创建</button><div id="xc-err" class="muted"></div>`;
  box.querySelector("#xc-create").onclick = async () => {
    const createButton=box.querySelector("#xc-create");if(createButton.disabled)return;createButton.disabled=true;createButton.textContent="正在创建…";try{
    const sel = [...box.querySelectorAll(".xc-chk input[value]:checked")].map((x) => x.value);
    const gated = box.querySelector("#xc-gated")?.checked;
    if (!sel.length) return (box.querySelector("#xc-err").textContent = "请至少选择 1 人");
    const bad = gated ? sel.filter((a) => !hasPurchased(a)) : [];
    if (bad.length) return (box.querySelector("#xc-err").textContent = `${bad.map(nm).join("、")} 没有购买记录，不能加入付费群`);
    const ex = sel.length === 1 && !gated && T.convs().find((c) => c.type === "dm" && c.members.includes(me) && c.members.includes(sel[0]));
    const c = ex || await createConv({ type: sel.length === 1 && !gated ? "dm" : "group", name: box.querySelector("#xc-gname").value.trim() || [me, ...sel].map(nm).join("、"), members: [me, ...sel], admin: me, gated });
    box.classList.add("hidden"); openChatPane(R); cur = c.id; render();
    }catch(error){box.querySelector("#xc-err").textContent=error.message;}finally{if(createButton.isConnected){createButton.disabled=false;createButton.textContent="创建";}}
  };
}

async function onPane(e) {
  const t = e.target;
  if (t.id === "xc-join") { const c = T.convs().find((x) => x.id === cur); if (c && hasPurchased(me, c.admin)) { await addMember(c, me); render(); } return; }
  if (t.dataset.open) return openBurn(t.dataset.open);
}

function viewingConversation(){return document.body.dataset.page==='chat'&&(matchMedia('(min-width:761px)').matches||R.querySelector('.xchat').classList.contains('conversation-open'));}
async function render() {
 if(!R)return;const revision=++listRevision,who=me,read=LS.get(readKey(),{});
 const current=T.convs().find(c=>c.id===cur&&c.members.includes(me));
 if(current&&viewingConversation()){const latest=Math.max(current.ts||0,...T.list(cur).map(m=>m.ts));if((read[cur]||0)<latest){read[cur]=latest;LS.set(readKey(),read);}}
 const convs=T.convs().filter(visible).map(c=>{const ms=T.list(c.id),last=ms.at(-1);return{c,last,unread:c.members.includes(me)?ms.filter(m=>m.from!==me&&m.ts>(read[c.id]||0)).length:0,ts:last?.ts||c.ts};}).sort((a,b)=>b.ts-a.ts);
 const rows=await Promise.all(convs.map(async({c,last,unread,ts})=>{
  let prev='还没有消息';
  if(!c.members.includes(who))prev='购买内容后可加入';
  else if(last?.sys)prev=last.sys;
  else if(last?.kind==='paid-image')prev='[付费图片]';
  else if(last?.burn)prev='[限时消息]';
  else if(last?.env){try{prev=dec.decode(await Crypto.unaes(await Crypto.convKey(c,who),last.env));}catch{prev='消息暂时无法显示';}}
  if(last&&c.type==='group'&&!last.sys)prev=nm(last.from)+'：'+prev;
  const peer=c.type==='dm'?c.members.find(a=>a!==who):null,search=title(c)+' '+(peer?uidOf(peer):'');
  return `<div class="xc-item ${c.id===cur?'on':''}" role="button" tabindex="0" data-conv="${c.id}" data-search="${esc(search)}" aria-label="${esc(title(c))}${unread?'，'+unread+' 条未读':''}"><div class="xc-av">${avatar(c)}</div><div class="xc-mid"><div class="xc-row"><b>${esc(title(c))}</b><small>${fmt(ts)}</small></div><div class="xc-row"><span class="xc-prev">${esc(prev)}</span>${unread?`<span class="xc-badge">${unread}</span>`:''}</div></div></div>`;
 }));
 if(revision!==listRevision||who!==me)return;
 R.querySelector('#xc-list').innerHTML=rows.join('');filterConversations(R);await renderPane();
}

async function renderPane() {
  const revision = ++paneRevision;
  const pane = R.querySelector("#xc-pane"); const c = T.convs().find((x) => x.id === cur);
  if (!c) { pane.innerHTML = `<div class="xc-empty"><div class="empty-tape" aria-hidden="true">◉—◉</div><b>还没打开会话</b><p class="muted">从左边选一个人，或者用 UID 添加朋友。</p><button class="secondary" data-add-friend>添加好友</button><small>本地演示 · 消息只保存在本浏览器</small></div>`; return; }
  const draftKey = me + ':' + c.id;
  const expiryOpen=pane.dataset.conv===draftKey&&pane.querySelector('.expiry-control')?.open;
  const oldInput=pane.querySelector('#chat-text'),keepFocus=pane.dataset.conv===draftKey&&document.activeElement===oldInput,selection=keepFocus?[oldInput.selectionStart,oldInput.selectionEnd]:null;
  if (pane.dataset.conv === draftKey && pane.querySelector('#chat-text')) drafts.set(draftKey, { text: pane.querySelector('#chat-text').value, burn: pane.querySelector('#chat-burn').checked, secs: pane.querySelector('#chat-secs').value, shot: pane.querySelector('#chat-shot').value });
  const draft = drafts.get(draftKey) || { text: '', burn: false, secs: '10', shot: '' };
  const peer=c.type==='dm'?(c.members.find(x=>x!==me)||me):null;
  const settings=c.members.includes(me)?`<label class="display-mode-label">Display mode <span>显示模式</span><select id="xc-cshot" aria-label="Display mode · 会话显示模式">${Object.entries(SHOT).map(([key,value])=>`<option value="${key}" ${shotOf(c)===key?'selected':''}>${value}</option>`).join('')}</select></label><p class="display-mode-note">仅影响网页显示。模糊显示不等于防截图；截图提示仅基于可识别的按键和切屏行为。</p>`:'';
  const head=chatHeader({name:title(c),uid:peer?uidOf(peer):'',group:c.type==='group',members:c.members.length,local:true,photo:peer===CREATOR?'photo-travel':peer==='0xFaN3000000000000000000000000000000000003'?'photo-maker':'',settings});

  if (!c.members.includes(me)) {
    const ok = hasPurchased(me, c.admin);
    pane.innerHTML = head + `<div class="xc-empty"><div class="ghost-gate-icon">${icon('lock')}</div><b>${esc(c.name)}</b><p class="muted">购买过 ${esc(nm(c.admin))} 的内容后，即可加入。<br>本地演示按当前浏览器的模拟购买记录判断。</p>
      ${ok ? `<button class="primary" id="xc-join">加入群聊</button>` : `<span class="pill">尚无购买记录</span><button class="secondary" data-profile="${c.admin}">查看 TA 的作品</button>`}</div>`;
    return;
  }
  const key = await Crypto.convKey(c, me);
  const rows = await Promise.all(T.list(c.id).map(async (m) => {
    if (m.sys) return `<div class="xc-sys">${esc(m.sys)}</div>`;
    const mine = m.from === me, o = opened[m.id], sp = shotOf(c, m); let body;
    if (m.kind === 'paid-image') return `<div class="msg ${mine ? 'me' : ''} paid-message">${c.type === 'group' ? `<small class="muted">${esc(nm(m.from))}</small>` : ''}${hooks.renderPaidCard?.(m.contentId, me, 'chat') || ''}<small class="muted">${fmt(m.ts)}</small></div>`;
    if (o) { const left = Math.max(0, Math.ceil((o.until - Date.now()) / 1000)); body = `${esc(o.text)}<div class="bar"><div class="cprog" style="width:${left / m.secs * 100}%"></div></div><small class="count">${left} 秒后结束展示</small>`; }
    else if (m.burn && mine) { const n = (m.viewed || []).length, tot = c.members.length - 1; body = `<i class="muted">限时消息 · ${m.secs} 秒（${n}/${tot} 已查看${m.env ? "" : "，密文已删除"}）</i>`; }
    else if (m.burn && ((m.viewed || []).includes(me) || !m.env)) body = `<i class="muted">已结束查看</i>`;
    else if (m.burn) body = `<button class="tapburn" data-open="${m.id}">${icon('clock')} 查看限时消息 · ${m.secs}s</button>`;
    else body = esc(dec.decode(await Crypto.unaes(key, m.env).catch(() => enc.encode("（解密失败）"))));
    return `<div class="msg ${mine ? "me" : ""}">${c.type === "group" && !mine ? `<small class="muted">${PEOPLE[m.from]?.av || ""} ${esc(nm(m.from))}</small>` : ""}<div class="bubble ${sp === "forbid" && !mine ? "noshot" : ""}" data-wm="${esc(nm(me) + " " + uidOf(me))}">${body}</div><small class="muted">${fmt(m.ts)}${m.shot ? " · " + SHOT[m.shot] : ""}</small></div>`;
  }));
  if (revision !== paneRevision) return;
  pane.dataset.conv = draftKey;
  pane.innerHTML = head + `<div id="chat-list" class="chat-list">${rows.join("") || `<p class="muted" style="text-align:center">还没有消息，打个招呼吧 👋</p>`}</div>
    <form id="chat-form" class="chat-input"><input id="chat-text" maxlength="500" placeholder="发送消息…" autocomplete="off">
      ${expiryControl()}
      <details class="chat-settings"><summary aria-label="Message settings · 更多消息设置" title="Message settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></svg></summary><div><label>显示保护<select id="chat-shot" title="这条消息的显示设置"><option value="">跟随会话</option>${Object.entries(SHOT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label><small>浏览器无法阻止或可靠识别系统截图。</small></div></details>
      <button type="button" class="secondary chat-paid" id="chat-paid">${icon('lock')}<span>付费图片</span></button><button class="primary">发送</button></form>`;
  pane.querySelector('#chat-paid').onclick = () => hooks.compose?.({ ...c, label: title(c) });
  pane.querySelector("#xc-cshot").onchange = (e) => { c.shot = e.target.value; T.saveConv(c); T.send({ conv: c.id, from: me, ts: Date.now(), sys: `${nm(me)} 将显示模式设为「${SHOT[c.shot]}」` }); render(); };
  pane.querySelector("#chat-text").value = draft.text;
  pane.querySelector('.expiry-control').open=!!expiryOpen;
  pane.querySelector('#chat-burn').checked = draft.burn; pane.querySelector('#chat-secs').value = draft.secs; pane.querySelector('#chat-shot').value = draft.shot;
  const saveDraft=()=>drafts.set(draftKey,{text:pane.querySelector('#chat-text').value,burn:pane.querySelector('#chat-burn').checked,secs:pane.querySelector('#chat-secs').value,shot:pane.querySelector('#chat-shot').value});
  pane.querySelector('#chat-text').oninput=saveDraft;
  for(const id of ['#chat-burn','#chat-secs','#chat-shot'])pane.querySelector(id).onchange=saveDraft;
  if(keepFocus){const input=pane.querySelector('#chat-text');input.focus({preventScroll:true});input.setSelectionRange(...selection);}
  const l = pane.querySelector("#chat-list"); l.scrollTop = l.scrollHeight;
  pane.querySelector("#chat-form").onsubmit = async (e) => {
    e.preventDefault(); const text = pane.querySelector("#chat-text").value.trim(); if (!text) return;
    pane.querySelector("#chat-text").value = "";
    await sendText(c, me, text, pane.querySelector("#chat-burn").checked, +pane.querySelector("#chat-secs").value, pane.querySelector("#chat-shot").value); render();
  };
}
async function openBurn(id) {
  const m = T.list().find((x) => x.id === id); const c = T.convs().find((x) => x.id === m?.conv);
  if (!m?.env || opened[id]) return;
  const text = dec.decode(await Crypto.unaes(await Crypto.convKey(c, me), m.env));
  T.markViewed(id, me, c.members); // 先记录已看，并按需删除密文，确保每人只能看一次
  opened[id] = { text, until: Date.now() + m.secs * 1000 }; renderPane();
  const t = setInterval(() => { if (!opened[id]) return clearInterval(t); if (Date.now() >= opened[id].until) { clearInterval(t); delete opened[id]; } renderPane(); }, 500);
}
function renderFriends() {
 const box=R.querySelector('#xc-frbox');if(box.classList.contains('hidden'))return;
 const fs=Friends.all(),incoming=fs.filter(f=>f.to===me&&f.status==='pending'),outgoing=fs.filter(f=>f.from===me&&f.status==='pending'),mine=fs.filter(f=>f.status==='accepted'&&[f.from,f.to].includes(me)).map(f=>f.from===me?f.to:f.from);
 const person=(address,action)=>`<div class="friend-row"><span class="friend-avatar">${esc(nm(address).slice(0,1))}</span><div><b>${esc(nm(address))}</b><button class="peer-uid" data-copy-uid="${uidOf(address)}">${uidOf(address)} ⧉</button></div>${action}</div>`;
 box.innerHTML=`<label class="friend-search-label">UID 或钱包地址<input id="xc-fq" placeholder="例如 ${uidOf(Object.keys(PEOPLE)[3])}" autocomplete="off" aria-label="输入好友 UID 或钱包地址"></label><button class="primary" id="xc-fadd">发送好友申请</button><p id="xc-fmsg" class="friend-feedback" role="status"></p><h4>收到的申请 <span>${incoming.length}</span></h4>${incoming.map(f=>person(f.from,`<button class="secondary" data-acc="${f.from}">接受</button>`)).join('')||'<p class="muted">没有待处理的申请。</p>'}${outgoing.length?'<h4>等待对方接受</h4>'+outgoing.map(f=>person(f.to,'<span class="pending-label">已申请</span>')).join(''):''}<h4>我的好友 <span>${mine.length}</span></h4>${mine.map(address=>person(address,`<button class="text-button" data-message="${address}">聊天 ↗</button>`)).join('')||'<p class="muted">还没有好友。输入对方的 UID 开始添加。</p>'}`;
 const submit=()=>{const input=box.querySelector('#xc-fq'),address=Friends.resolve(input.value);try{if(!input.value.trim())throw Error('先输入对方的 UID 或钱包地址');if(!address)throw Error('没有找到这个 UID，请检查拼写');Friends.request(me,address);renderFriends();box.querySelector('#xc-fmsg').textContent='已向 '+nm(address)+' 发送好友申请';}catch(e){box.querySelector('#xc-fmsg').textContent=e.message;}};
 box.querySelector('#xc-fadd').onclick=submit;box.querySelector('#xc-fq').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submit();}};
 box.querySelectorAll('[data-acc]').forEach(b=>b.onclick=()=>{Friends.accept(b.dataset.acc,me);renderFriends();});
}

// 截图检测（尽力而为）
function setupShotDetect() {
  const hit = (why) => {
    const c = T.convs().find((x) => x.id === cur); if (!c || !c.members.includes(me) || !document.querySelector("#xc-pane")?.offsetParent) return;
    const ms = T.list(c.id).filter((m) => !m.sys && m.from !== me);
    const notify = shotOf(c) === "notify" || ms.some((m) => m.shot === "notify" && opened[m.id]);
    if (notify) { T.send({ conv: c.id, from: me, ts: Date.now(), sys: `📸 ${nm(me)} 可能截了屏（${why}）` }); render(); }
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "PrintScreen" || (e.metaKey && e.shiftKey && ["3", "4", "5", "#", "$", "%"].includes(e.key)) || (e.key.toLowerCase() === "s" && e.metaKey && e.shiftKey)) hit("检测到截图快捷键");
  });
  const hide = (on) => document.body.classList.toggle("xc-hide", on);
  document.addEventListener("visibilitychange", () => { hide(document.hidden); if (document.hidden && Object.keys(opened).length) hit("查看阅后即焚时切走了页面"); });
  window.addEventListener("blur", () => hide(true)); window.addEventListener("focus", () => hide(false));
  document.addEventListener("contextmenu", (e) => { if (e.target.closest(".noshot")) e.preventDefault(); });
  window.__simulateScreenshot = () => hit("模拟");
}
window.__snapchat = { Friends, uidOf, MockTapeSendTransport, Crypto, hasPurchased };
