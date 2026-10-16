// SnapVault 前端：演示模式完全离线；连接钱包后走真实合约（需填 CONFIG.contract）
import { SNAPVAULT_ABI } from "./abi.js";
import { initChat } from "./chat.js";

const CONFIG = {
  contract: "",            // TODO: 部署后填 SnapVault 地址
  usdt: "",                // TODO: X Layer 上的 USDT 地址（请自行核实）
  chainIdHex: "0x7a0",     // X Layer 测试网 1952；主网 0xc4 = 196
};

const $ = (s) => document.querySelector(s);
const enc = new TextEncoder();
const b64 = (u8) => { const a = new Uint8Array(u8); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const log = (m) => { $("#log").textContent += m + "\n"; };

// ---------- 存储（模拟 IPFS / DeWEB 容器）----------
// TODO: 换成 IPFS(pinning) 或者用 HashPort 把密文写进 TapeOut 容器 (tape://...)
const Storage = {
  async put(cipherB64) {
    const h = hex(await crypto.subtle.digest("SHA-256", unb64(cipherB64)));
    localStorage.setItem("blob:" + h, cipherB64);
    return { hash: "0x" + h, uri: "mock-ipfs://" + h };
  },
  get(uri) { return localStorage.getItem("blob:" + uri.split("://")[1]); },
};

// ---------- 密钥投递（模拟 TapeSend）----------
// 真实流程：链下服务监听 Purchase 事件 → 用 TapeSend(TAP-10, X25519 + XChaCha20-Poly1305)
// 把密钥加密投递到粉丝的容器 endpoint。这里用 localStorage 模拟“创作者密钥保管箱”和“粉丝收件箱”。
// TODO(TapeSend): 接入 TapeSend SDK / 中心合约，替换 vault 与 deliver。
const KeyVault = {
  save(id, rawKeyB64) { localStorage.setItem("key:" + id, rawKeyB64); },
  deliver(id, fan) { // 返回“投递到粉丝收件箱”的密钥
    const k = localStorage.getItem("key:" + id);
    sessionStorage.setItem(`inbox:${fan}:${id}`, k);
    return k;
  },
  takeFromInbox(id, fan) { // 取出即删除（一次性）
    const k = sessionStorage.getItem(`inbox:${fan}:${id}`);
    sessionStorage.removeItem(`inbox:${fan}:${id}`);
    return k;
  },
};

// ---------- 链（演示模式 = 本地模拟合约）----------
let wallet = { mode: "demo", address: "0xDem0FaN000000000000000000000000000000001" };
const MockChain = {
  list(c) { const all = this.all(); c.id = all.length + 1; c.sold = 0; all.push(c); localStorage.setItem("contents", JSON.stringify(all)); return c.id; },
  all() { return JSON.parse(localStorage.getItem("contents") || "[]"); },
  purchase(id, fan) {
    const all = this.all(); const c = all[id - 1];
    if (c.max && c.sold >= c.max) throw new Error("已售罄");
    c.sold++; localStorage.setItem("contents", JSON.stringify(all));
    const ps = JSON.parse(localStorage.getItem("purchases") || "[]"); ps.push({ id, fan, ts: Date.now() }); localStorage.setItem("purchases", JSON.stringify(ps)); // 私聊付费群门控用（模拟 Purchase 事件）
    const fee = c.price * 0.1;
    return { tx: "0xmock" + Date.now().toString(16), fee, creatorGets: c.price - fee };
  },
};
let ethersLib, contract;
async function connect() {
  if (!window.ethereum) { alert("没检测到钱包（OKX Wallet / MetaMask），继续使用演示模式"); return; }
  ethersLib = await import("https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm");
  const p = new ethersLib.BrowserProvider(window.ethereum);
  await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CONFIG.chainIdHex }] }).catch(() => {});
  const signer = await p.getSigner();
  wallet = { mode: "wallet", address: await signer.getAddress(), signer };
  if (CONFIG.contract) contract = new ethersLib.Contract(CONFIG.contract, SNAPVAULT_ABI, signer);
  $("#mode").textContent = (contract ? "链上模式 " : "钱包已连接（未配置合约，仍为模拟） ") + wallet.address.slice(0, 6) + "…";
}

// ---------- 创作者：加密并上架 ----------
async function publish(e) {
  e.preventDefault(); $("#log").textContent = "";
  const file = $("#file").files[0]; if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  log(`读取图片 ${file.name}，${(bytes.length / 1024).toFixed(1)} KB`);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const blob = new Uint8Array(12 + ct.length); blob.set(iv); blob.set(ct, 12);
  log("✅ 已在本地用 AES-GCM-256 随机密钥加密（明文不离开浏览器）");
  const { hash, uri } = await Storage.put(b64(blob));
  log(`✅ 密文已存储（模拟 IPFS）：${uri.slice(0, 40)}…\n   sha256 = ${hash.slice(0, 22)}…`);
  const thumb = await makeThumb(file);
  const c = { title: $("#title").value, price: +$("#price").value, token: $("#token").value,
    secs: +$("#secs").value, max: +$("#max").value, hash, uri, thumb, creator: wallet.address };
  let id;
  if (contract) {
    const dec = c.token === "OKB" ? 18 : 6;
    const tx = await contract.list(c.token === "OKB" ? ethersLib.ZeroAddress : CONFIG.usdt,
      ethersLib.parseUnits(String(c.price), dec), c.secs, c.max, hash, uri);
    const r = await tx.wait(); id = Number(r.logs[0].topics[1]); log("✅ 链上上架 tx " + tx.hash);
    MockChain.list(c); // 本地也缓存一份用于展示
  } else { id = MockChain.list(c); log(`✅ 合约 list() 已模拟调用，contentId = ${id}`); }
  KeyVault.save(id, b64(await crypto.subtle.exportKey("raw", key)));
  log("🔑 密钥已交给（模拟）TapeSend 投递服务，等待粉丝付款后发出");
  render();
}
async function makeThumb(file) { // 极小缩略图，展示时再模糊（只用于预览）
  const img = await createImageBitmap(file); const c = document.createElement("canvas");
  c.width = 24; c.height = Math.round(24 * img.height / img.width) || 24;
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.5);
}

// ---------- 粉丝：付款 → 收密钥 → 解密 → 限时查看 → 焚毁 ----------
const burned = new Set(JSON.parse(sessionStorage.getItem("burned") || "[]"));
async function buy(id) {
  const c = MockChain.all()[id - 1];
  if (!confirm(`支付 ${c.price} ${c.token} 解锁「${c.title}」？\n平台抽成 10%，创作者到手 ${(c.price * 0.9).toFixed(2)} ${c.token}`)) return;
  if (contract) {
    const tx = await contract.purchase(id, c.token === "OKB" ? { value: ethersLib.parseEther(String(c.price)) } : {});
    await tx.wait();
  } else MockChain.purchase(id, wallet.address);
  KeyVault.deliver(id, wallet.address); // 模拟：服务监听 Purchase 事件后投递
  await view(id, c);
}
async function view(id, c) {
  let keyB64 = KeyVault.takeFromInbox(id, wallet.address);
  let blob = unb64(Storage.get(c.uri));
  let key = await crypto.subtle.importKey("raw", unb64(keyB64), "AES-GCM", false, ["decrypt"]);
  let pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) }, key, blob.slice(12));
  let url = URL.createObjectURL(new Blob([pt]));
  $("#vimg").src = url;
  $("#wm").innerHTML = Array(40).fill(`${wallet.address.slice(0, 10)}… ${new Date().toLocaleString()}`).map((t) => `<span>${t}</span>`).join("");
  $("#viewer").classList.remove("hidden");
  const total = c.secs; let left = total;
  const tick = () => { $("#count").textContent = `🔥 ${left} 秒后焚毁`; $("#prog").style.width = (left / total * 100) + "%"; };
  tick();
  await new Promise((res) => { const t = setInterval(() => { left--; tick(); if (left <= 0) { clearInterval(t); res(); } }, 1000); });
  // 焚毁：撤销 URL、清空图片、丢弃密钥与明文引用
  $("#vimg").src = ""; URL.revokeObjectURL(url); keyB64 = key = pt = blob = url = null;
  $("#viewer").classList.add("hidden");
  burned.add(id); sessionStorage.setItem("burned", JSON.stringify([...burned])); render();
}

// ---------- 渲染 ----------
function render() {
  const all = MockChain.all();
  $("#grid").innerHTML = all.length ? all.map((c) => `
    <div class="card"><div class="thumb">${c.thumb ? `<img class="ph" src="${c.thumb}" style="filter:blur(14px)">` : `<div class="ph"></div>`}
      <div class="lock">${burned.has(c.id) ? "🔥" : "🔒"}<span>${burned.has(c.id) ? "已焚毁 · 已过期" : `限时 ${c.secs} 秒`}</span></div></div>
      <div class="meta"><b>${escapeHtml(c.title)}</b><div class="muted">创作者 ${c.creator.slice(0, 8)}… · 已售 ${c.sold}${c.max ? "/" + c.max : ""}</div>
      ${burned.has(c.id) ? `<button class="primary done" disabled>已过期</button>` : `<button class="primary" data-buy="${c.id}">💰 ${c.price} ${c.token} 解锁</button>`}</div></div>`).join("")
    : `<p class="sub">还没有内容，去「我是创作者」发布一条吧。</p>`;
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

document.querySelectorAll(".tab").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("hidden", p.id !== b.dataset.tab));
});
$("#grid").onclick = (e) => { const id = e.target.dataset.buy; if (id) buy(+id).catch((er) => alert(er.message)); };
$("#form").onsubmit = (e) => publish(e).catch((er) => log("❌ " + er.message));
$("#connect").onclick = () => connect().catch((er) => alert(er.message));
document.addEventListener("contextmenu", (e) => { if (e.target.id === "vimg") e.preventDefault(); });
render();
initChat(document.querySelector("#chat"));
window.__snapvault = { MockChain, KeyVault, Storage };
