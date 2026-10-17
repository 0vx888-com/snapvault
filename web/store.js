import {wallet,walletAction} from './wallet.js';
import {local} from './local-delivery.js';
// Shared FRONTEND DEMO state. Not an authorization server or a real payment rail.
export const CREATOR = '0xCreAt0r00000000000000000000000000000001';
export const FAN = '0xDem0FaN000000000000000000000000000000001';
export const PEOPLE = {
  [CREATOR]: { name: '小鹿', role: '创作者', av: '🦌', bio: '分享摄影、日常和镜头之外的独家花絮。', tag: '摄影 · 生活', creator: true },
  [FAN]: { name: '演示粉丝', role: '粉丝', av: '🙂', bio: '发现喜欢的创作者。' },
  '0xFaN2000000000000000000000000000000000002': { name: '阿杰', role: '粉丝', av: '😎', bio: '在这里认识同好。' },
  '0xFaN3000000000000000000000000000000000003': { name: 'Mia', role: '创作者', av: '🐱', bio: '画画、手作，以及还没公开的小灵感。', tag: '插画 · 手作', creator: true },
};
export const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
export function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error('浏览器本地空间不足，未保存成功。请换小一点的图片。'); }
}
export function changed() { window.dispatchEvent(new Event('snapvault:change')); }
export const identity = () => wallet.enabled ? (wallet.account||'') : sessionStorage.getItem('sv:identity') || FAN;
export function setIdentity(address) {
  if(wallet.enabled)throw Error('钱包模式需要签名登录，不能切换演示身份');
  if (!PEOPLE[address]) throw new Error('请选择演示身份');
  sessionStorage.setItem('sv:identity', address);
  if(local.enabled){local.revision++;local.data={contents:[],orders:[]};local.who=null;}
  window.dispatchEvent(new Event('snapvault:identity'));
}
export const uidOf = (address) => {
  let h = 2166136261;
  for (const c of address.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return 'SV' + (h >>> 0).toString(36).toUpperCase().padStart(7, '0');
};
export const profile = (address) => ({ name: address.slice(0, 8) + '…', av: '👤', bio: '', ...(wallet.enabled?wallet.data.profiles[address]:PEOPLE[address]), ...(!wallet.enabled?read('sv:profiles', {})[address]:{}) });
export function saveProfile(address, values) {
  if(wallet.enabled)return walletAction('profile',values);
  const all = read('sv:profiles', {}); all[address] = { ...all[address], ...values, creator: true };
  write('sv:profiles', all); changed();
}
export const profiles = () => wallet.enabled ? Object.entries(wallet.data.profiles).filter(([a,p])=>p.creator||contents().some(c=>c.creator===a)).map(([address,p])=>({address,...p})) : [...new Set([...Object.keys(PEOPLE), ...Object.keys(read('sv:profiles', {})), ...contents().map(c => c.creator)])]
  .filter(a => profile(a).creator || contents().some(c => c.creator === a)).map(address => ({ address, ...profile(address) }));
export const follows = (who = identity()) => read('sv:follows:' + who, []);
export function toggleFollow(address) {
  if (address === identity()) return;
  const list = follows(); write('sv:follows:' + identity(), list.includes(address) ? list.filter(a => a !== address) : [...list, address]); changed();
}
export const contents = () => (wallet.enabled?wallet.data.contents:local.enabled?local.data.contents:read('contents', [])).map(c => ({ scope: 'public', burn: true, createdAt: 0, ...c }));
export const content = id => contents().find(c => String(c.id) === String(id));
export const orders = () => wallet.enabled?wallet.data.orders:local.enabled?local.data.orders:read('sv:orders', []);
export const order = (id, who = identity()) => orders().find(o => String(o.contentId) === String(id) && o.buyer === who);
export function eligible(c, who = identity()) {
  return !!c && (c.creator === who || c.scope === 'public' || (c.audience || []).includes(who) || !!order(c.id, who));
}
export function addContent(c, cipherB64, rawKeyB64) {
  const all = contents(); const id = Math.max(0, ...all.map(x => Number(x.id) || 0)) + 1;
  // A card is only published once both local demo blob and key have saved.
  localStorage.setItem('blob:' + c.hash.slice(2), cipherB64);
  localStorage.setItem('key:' + id, rawKeyB64);
  const result = { ...c, id, sold: 0, createdAt: Date.now() };
  write('contents', [...all, result]); changed(); return result;
}
export function orderState(c, who = identity()) {
  if (c.creator === who) return 'creator';
  const o = order(c.id, who);
  if (!o) return 'locked';
  if (Date.now() >= o.accessUntil || (c.burn && o.viewUntil && Date.now() >= o.viewUntil)) return 'expired';
  if((local.enabled||wallet.enabled)&&o.delivery!=='ready')return 'delivering';
  return o.viewUntil ? 'viewing' : 'ready';
}
export async function purchaseDemo(id, buyer = identity()) {
  const purchase = async () => {
    const c = content(id);
    if (!eligible(c, buyer)) throw new Error('这张图片未向当前身份开放');
    if (buyer === c.creator) throw new Error('创作者可以直接预览自己的图片');
    const existing = order(id, buyer); if (existing) return existing;
    if (c.max && c.sold >= c.max) throw new Error('已售罄');
    if (!localStorage.getItem('key:' + id) || !localStorage.getItem('blob:' + c.hash.slice(2))) throw new Error('演示内容尚未就绪，没有扣款');
    const o = { id: crypto.randomUUID(), contentId: c.id, buyer, creator: c.creator, price: c.price, token: c.token,
      paidAt: Date.now(), accessUntil: Date.now() + 24 * 3600_000, viewUntil: null, demo: true };
    write('sv:orders', [...orders(), o]);
    // sold is derived from unique demo orders; no independent increment to drift.
    write('contents', contents().map(x => String(x.id) === String(id) ? { ...x, sold: Math.max(x.sold || 0, orders().filter(p => String(p.contentId) === String(id)).length) } : x));
    const old = read('purchases', []); write('purchases', [...old, { id: c.id, fan: buyer, creator: c.creator, ts: o.paidAt }]);
    changed(); return o;
  };
  return navigator.locks ? navigator.locks.request('snapvault-purchase', purchase) : purchase();
}
export function beginView(c, who = identity()) {
  if (c.creator === who) return { preview: true, viewUntil: c.burn ? Date.now() + c.secs * 1000 : null };
  if (!eligible(c, who) || !order(c.id, who)) throw new Error('请先购买');
  if (orderState(c, who) === 'expired') throw new Error('本次查看权限已结束');
  const all = orders(); const o = all.find(o => String(o.contentId) === String(c.id) && o.buyer === who);
  if (c.burn && !o.viewUntil) { o.viewUntil = Math.min(o.accessUntil, Date.now() + c.secs * 1000); write('sv:orders', all); }
  changed(); return o;
}
export function hasPurchased(fan, creator = CREATOR) {
  if (fan === creator) return true;
  // Keep the explicitly labelled seeded buyer for the existing demo group.
  if (creator === CREATOR && fan === '0xFaN2000000000000000000000000000000000002') return true;
  return orders().some(o => o.buyer === fan && o.creator === creator) || (!local.enabled && read('purchases', []).some(p => p.fan === fan && (p.creator || content(p.id)?.creator) === creator));
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
