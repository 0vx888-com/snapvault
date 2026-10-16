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
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const LS = { get: (k, d) => JSON.parse(localStorage.getItem(k) || JSON.stringify(d)), set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };

export const PEOPLE = {
  "0xCreAt0r00000000000000000000000000000001": { name: "小鹿", role: "创作者", av: "🦌" },
  "0xDem0FaN000000000000000000000000000000001": { name: "演示粉丝", role: "粉丝", av: "🙂" },
  "0xFaN2000000000000000000000000000000000002": { name: "阿杰", role: "粉丝", av: "😎" },
  "0xFaN3000000000000000000000000000000000003": { name: "Mia", role: "粉丝", av: "🐱" },
};
export const uidOf = (a) => "SV" + (parseInt(a.slice(2, 10), 16) % 1e6).toString().padStart(6, "0"); // 模拟短 UID
const CREATOR = "0xCreAt0r00000000000000000000000000000001";
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const nm = (a) => PEOPLE[a]?.name || short(a);

// ---------- 付费门控（模拟：读取演示购买记录） ----------
export function hasPurchased(fan, creator = CREATOR) {
  // 演示里所有上架内容都算这个创作者的。阿杰预置为已购买（模拟另一台设备的购买）。
  if (fan === creator || fan === "0xFaN2000000000000000000000000000000000002") return true;
  return LS.get("purchases", []).some((p) => p.fan === fan);
}

// ---------- 好友（模拟）----------
// TODO(真实版本): UID 和地址的映射放在链上注册表，或者像 ENS 那样解析，最后解析到对方的 TapeSend 地址或容器 endpoint；
//   好友请求本身就是一条 TapeSend 消息，所以元数据公开，任何人都能发，需要防骚扰（付费请求、限频、黑名单）。
export const Friends = {
  all: () => LS.get("chat:friends", []),
  resolve(q) { q = q.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(q)) return q; return Object.keys(PEOPLE).find((a) => uidOf(a) === q.toUpperCase()) || null; },
  request(from, to) { const a = this.all(); if (from === to) throw new Error("不能加自己"); if (a.some((f) => [f.from, f.to].includes(from) && [f.from, f.to].includes(to))) throw new Error("已经是好友，或者已有待处理的请求"); a.push({ from, to, status: "pending", ts: Date.now() }); LS.set("chat:friends", a); },
  accept(from, to) { const a = this.all(); const f = a.find((x) => x.from === from && x.to === to); if (f) f.status = "accepted"; LS.set("chat:friends", a); },
  isFriend(x, y) { return this.all().some((f) => f.status === "accepted" && [f.from, f.to].includes(x) && [f.from, f.to].includes(y)); },
};
// ---------- 截图策略 ----------
// allow=允许；forbid=禁止（尽力而为：模糊、水印，窗口失焦或切走时遮住内容）；notify=截图时通知发送者（类似 Snapchat）。
// 浏览器拿不到真正的截图事件，只能靠 PrintScreen 或 Cmd+Shift+3/4/5 这类按键、visibilitychange、窗口 blur 来猜。
// 手机系统截图、外接相机拍屏、开发者工具都拦不住，也检测不到。
const SHOT = { allow: "📷 允许截图", forbid: "🚫 禁止截图", notify: "🔔 截图通知" };
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
let me = "0xDem0FaN000000000000000000000000000000001", cur = null, opened = {}, R;
const readKey = () => "chat:read:" + me;
const title = (c) => c.type === "dm" ? nm(c.members.find((x) => x !== me) || me) : c.name;
const avatar = (c) => c.type === "dm" ? PEOPLE[c.members.find((x) => x !== me)]?.av || "👤" : (c.gated ? "🔐" : "👥");
const fmt = (ts) => { const d = new Date(ts); return Date.now() - ts < 864e5 ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : `${d.getMonth() + 1}/${d.getDate()}`; };
const visible = (c) => c.members.includes(me) || (c.gated && c.admin === CREATOR && me !== CREATOR);

export async function initChat(root) {
  R = root;
  root.innerHTML = `
  <div class="xchat card">
    <aside class="xc-side">
      <div class="xc-top"><b>消息</b><span><button class="xc-new" id="xc-fr" title="好友">👥</button> <button class="xc-new" id="xc-new" title="新建会话">✉️＋</button></span></div>
      <div class="xc-me"><span class="muted">当前身份</span><select id="xc-me">${Object.entries(PEOPLE).map(([a, p]) => `<option value="${a}">${p.av} ${p.name}（${p.role}）</option>`).join("")}</select></div>
      <div id="xc-frbox" class="xc-newbox hidden"></div><div id="xc-newbox" class="xc-newbox hidden"></div>
      <div id="xc-list" class="xc-list"></div>
      <div class="xc-foot pill">${T.name} · 模拟端到端加密</div>
    </aside>
    <section class="xc-pane" id="xc-pane"></section>
  </div>`;
  root.querySelector("#xc-me").value = me;
  root.querySelector("#xc-me").onchange = (e) => { me = e.target.value; cur = null; opened = {}; R.querySelectorAll(".xc-newbox").forEach((x) => x.classList.add("hidden")); render(); };
  root.querySelector("#xc-new").onclick = toggleNew;
  root.querySelector("#xc-fr").onclick = () => { R.querySelector("#xc-frbox").classList.toggle("hidden"); renderFriends(); };
  setupShotDetect();
  root.querySelector("#xc-list").onclick = (e) => { const id = e.target.closest("[data-conv]")?.dataset.conv; if (id) { cur = id; render(); } };
  root.querySelector("#xc-pane").onclick = onPane;
  window.addEventListener("storage", (e) => { if (e.key?.startsWith("chat:") || e.key === "purchases") render(); });
  document.querySelector('[data-tab="chat"]')?.addEventListener("click", () => render());
  await seed(); render();
}

function toggleNew() {
  const box = R.querySelector("#xc-newbox"); box.classList.toggle("hidden");
  const others = [...new Set([...Object.keys(PEOPLE), ...Friends.all().flatMap((f) => [f.from, f.to])])].filter((a) => a !== me && Friends.isFriend(me, a));
  box.innerHTML = `<div class="muted">从好友里选：选 1 人就是私信，选多人就是群聊${others.length ? "" : "（还没有好友，先点 👥 添加）"}</div>
    ${others.map((a) => `<label class="xc-chk"><input type="checkbox" value="${a}"> ${PEOPLE[a].av} ${PEOPLE[a].name}</label>`).join("")}
    <input id="xc-gname" placeholder="群名（建群时填）" maxlength="30">
    ${me === CREATOR ? `<label class="xc-chk"><input type="checkbox" id="xc-gated"> 🔐 付费粉丝群（只有买过我内容的钱包能加入）</label>` : ""}
    <button class="primary" id="xc-create">创建</button><div id="xc-err" class="muted"></div>`;
  box.querySelector("#xc-create").onclick = async () => {
    const sel = [...box.querySelectorAll(".xc-chk input[value]:checked")].map((x) => x.value);
    const gated = box.querySelector("#xc-gated")?.checked;
    if (!sel.length) return (box.querySelector("#xc-err").textContent = "请至少选择 1 人");
    const bad = gated ? sel.filter((a) => !hasPurchased(a)) : [];
    if (bad.length) return (box.querySelector("#xc-err").textContent = `❌ ${bad.map(nm).join("、")} 没有购买记录，不能加入付费群`);
    const ex = sel.length === 1 && !gated && T.convs().find((c) => c.type === "dm" && c.members.includes(me) && c.members.includes(sel[0]));
    const c = ex || await createConv({ type: sel.length === 1 && !gated ? "dm" : "group", name: box.querySelector("#xc-gname").value.trim() || [me, ...sel].map(nm).join("、"), members: [me, ...sel], admin: me, gated });
    box.classList.add("hidden"); cur = c.id; render();
  };
}

async function onPane(e) {
  const t = e.target;
  if (t.id === "xc-join") { const c = T.convs().find((x) => x.id === cur); if (hasPurchased(me)) { await addMember(c, me); render(); } return; }
  if (t.dataset.open) return openBurn(t.dataset.open);
}

async function render() {
  if (!R) return;
  const read = LS.get(readKey(), {});
  const convs = T.convs().filter(visible).map((c) => {
    const ms = T.list(c.id); const last = ms[ms.length - 1];
    return { c, last, unread: c.members.includes(me) ? ms.filter((m) => m.from !== me && m.ts > (read[c.id] || 0)).length : 0, ts: last?.ts || c.ts };
  }).sort((a, b) => b.ts - a.ts);
  R.querySelector("#xc-list").innerHTML = convs.map(({ c, last, unread, ts }) => {
    const prev = !c.members.includes(me) ? "🔒 付费粉丝群 · 购买后可加入" : !last ? "还没有消息" : (c.type === "group" ? nm(last.from) + "：" : "") + (last.burn ? "🔥 阅后即焚消息" : "🔒 加密消息");
    return `<div class="xc-item ${c.id === cur ? "on" : ""}" data-conv="${c.id}"><div class="xc-av">${avatar(c)}</div>
      <div class="xc-mid"><div class="xc-row"><b>${esc(title(c))}</b><small class="muted">${fmt(ts)}</small></div>
      <div class="xc-row"><span class="xc-prev">${esc(prev)}</span>${unread ? `<span class="xc-badge">${unread}</span>` : ""}</div></div></div>`;
  }).join("");
  await renderPane();
}
async function renderPane() {
  const pane = R.querySelector("#xc-pane"); const c = T.convs().find((x) => x.id === cur);
  if (!c) { pane.innerHTML = `<div class="xc-empty"><div style="font-size:46px">💬</div><b>选择一个会话</b><p class="muted">私信和群聊都是端到端加密（模拟），🔥 消息看过一次就会焚毁。</p></div>`; return; }
  const head = `<div class="xc-head"><div class="xc-av">${avatar(c)}</div><div><b>${esc(title(c))}</b><div class="muted">${c.type === "group" ? `${c.members.length} 位成员：${c.members.map(nm).join("、")}${c.gated ? " · 🔐 购买者专属" : ""}` : short(c.members.find((x) => x !== me) || me)}</div></div>
    ${c.members.includes(me) ? `<select id="xc-cshot" class="xc-shotsel" title="会话截图设置">${Object.entries(SHOT).map(([k, v]) => `<option value="${k}" ${shotOf(c) === k ? "selected" : ""}>${v}</option>`).join("")}</select>` : ""}</div>`;
  if (!c.members.includes(me)) {
    const ok = hasPurchased(me);
    pane.innerHTML = head + `<div class="xc-empty"><div style="font-size:46px">🔐</div><b>${esc(c.name)}</b><p class="muted">只有购买过 ${nm(c.admin)} 内容的钱包才能加入。<br>门控（模拟）：读取演示模式的购买记录；真实版本读取 SnapVault 合约的 Purchase 事件。</p>
      ${ok ? `<button class="primary" id="xc-join">✅ 已验证购买记录，加入群聊</button>` : `<button class="primary done" disabled>未找到购买记录，请先去「粉丝广场」解锁一张内容</button>`}</div>`;
    return;
  }
  const read = LS.get(readKey(), {}); read[c.id] = Date.now(); LS.set(readKey(), read);
  const key = await Crypto.convKey(c, me);
  const rows = await Promise.all(T.list(c.id).map(async (m) => {
    if (m.sys) return `<div class="xc-sys">${esc(m.sys)}</div>`;
    const mine = m.from === me, o = opened[m.id], sp = shotOf(c, m); let body;
    if (o) body = `${esc(o.text)}<div class="bar"><div class="cprog" style="width:${o.left / m.secs * 100}%"></div></div><small class="count">${o.left} 秒后焚毁</small>`;
    else if (m.burn && mine) { const n = (m.viewed || []).length, tot = c.members.length - 1; body = `<i class="muted">🔥 阅后即焚 · ${m.secs} 秒（${n}/${tot} 已查看${m.env ? "" : "，密文已删除"}）</i>`; }
    else if (m.burn && ((m.viewed || []).includes(me) || !m.env)) body = `<i class="muted">🔥 已焚毁</i>`;
    else if (m.burn) body = `<button class="tapburn" data-open="${m.id}">🔥 点击查看（${m.secs} 秒）</button>`;
    else body = esc(dec.decode(await Crypto.unaes(key, m.env).catch(() => enc.encode("（解密失败）"))));
    return `<div class="msg ${mine ? "me" : ""}">${c.type === "group" && !mine ? `<small class="muted">${PEOPLE[m.from]?.av || ""} ${nm(m.from)}</small>` : ""}<div class="bubble ${sp === "forbid" && !mine ? "noshot" : ""}" data-wm="${esc(nm(me) + " " + uidOf(me))}">${body}</div><small class="muted">${fmt(m.ts)}${m.shot ? " · " + SHOT[m.shot] : ""}</small></div>`;
  }));
  const prevVal = pane.querySelector("#chat-text")?.value || "";
  pane.innerHTML = head + `<div id="chat-list" class="chat-list">${rows.join("") || `<p class="muted" style="text-align:center">还没有消息，打个招呼吧 👋</p>`}</div>
    <form id="chat-form" class="chat-input"><input id="chat-text" maxlength="500" placeholder="发送加密消息…" autocomplete="off">
      <label class="burn"><input type="checkbox" id="chat-burn"> 🔥 阅后即焚</label>
      <select id="chat-secs"><option>5</option><option selected>10</option><option>30</option></select><span class="muted">秒</span>
      <select id="chat-shot" title="这条消息的截图设置"><option value="">截图：跟随会话</option>${Object.entries(SHOT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <button class="primary">发送</button></form>`;
  pane.querySelector("#xc-cshot").onchange = (e) => { c.shot = e.target.value; T.saveConv(c); T.send({ conv: c.id, from: me, ts: Date.now(), sys: `${nm(me)} 把会话截图设置改为「${SHOT[c.shot]}」` }); render(); };
  pane.querySelector("#chat-text").value = prevVal;
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
  opened[id] = { text, left: m.secs }; renderPane();
  const t = setInterval(() => { if (--opened[id].left <= 0) { clearInterval(t); delete opened[id]; } renderPane(); }, 1000);
}
function renderFriends() {
  const box = R.querySelector("#xc-frbox"); if (box.classList.contains("hidden")) return;
  const fs = Friends.all(), inc = fs.filter((f) => f.to === me && f.status === "pending"), out = fs.filter((f) => f.from === me && f.status === "pending");
  const mine = fs.filter((f) => f.status === "accepted" && [f.from, f.to].includes(me)).map((f) => (f.from === me ? f.to : f.from));
  box.innerHTML = `<div>我的 UID：<b class="xc-uid">${uidOf(me)}</b> <span class="muted">${short(me)}</span></div>
    <div class="row"><input id="xc-fq" placeholder="输入 UID（如 ${uidOf(Object.keys(PEOPLE)[3])}）或钱包地址" style="flex:1"><button class="primary" id="xc-fadd">加好友</button></div><div id="xc-fmsg" class="muted"></div>
    ${inc.map((f) => `<div class="xc-row">📩 ${nm(f.from)}（${uidOf(f.from)}）请求加你为好友 <button class="tapburn" data-acc="${f.from}">接受</button></div>`).join("")}
    ${out.map((f) => `<div class="muted">⏳ 等待 ${nm(f.to)} 接受</div>`).join("")}
    <div class="muted">好友：${mine.map((a) => `${PEOPLE[a]?.av || "👤"} ${nm(a)}`).join("、") || "暂无"}</div>`;
  box.querySelector("#xc-fadd").onclick = () => {
    const a = Friends.resolve(box.querySelector("#xc-fq").value);
    try { if (!a) throw new Error("找不到这个 UID 或地址"); Friends.request(me, a); renderFriends(); box.querySelector("#xc-fmsg").textContent = `✅ 已向 ${nm(a)} 发送好友请求（模拟 TapeSend）`; }
    catch (e) { box.querySelector("#xc-fmsg").textContent = "❌ " + e.message; }
  };
  box.querySelectorAll("[data-acc]").forEach((b) => b.onclick = () => { Friends.accept(b.dataset.acc, me); renderFriends(); });
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
