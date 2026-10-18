import {wallet,call} from './wallet.js';
import {escapeHtml as esc} from './store.js';
export function initRefunds(){
 const panel=document.querySelector('#refund-panel'),list=document.querySelector('#refund-orders'),feedback=document.querySelector('#refund-feedback');if(!panel)return;panel.classList.remove('hidden');let revision=0;
 async function refresh(){const rev=++revision;if(!wallet.token){list.textContent='连接钱包后查看你的购买订单与退款进度。';return;}try{const data=await call('refund-list');if(rev!==revision)return;feedback.textContent=data.policy;list.innerHTML=data.requests.length?data.requests.map(r=>`<article class="card" data-refund-id="${r.id}" data-buyer="${esc(r.buyer)}"><b>${esc(r.title)}</b><p>订单 #${r.id} · ${esc(r.amount)} OKB · ${esc(({none:'可申请',requested:'待平台审核',rejected:'平台未批准',refunded:'已全额退款'})[r.status]||r.status)}</p>${data.isOwner?`<p>买家：${esc(r.buyer)}</p>`:''}${r.reason?`<p>申请原因：${esc(r.reason)}</p>`:''}${r.response?`<p>平台说明：${esc(r.response)}</p>`:''}${r.transactionHash?`<p>退款交易：${esc(r.transactionHash)}</p>`:''}${!data.isOwner&&r.status==='none'?'<label>退款原因<textarea data-reason maxlength="500" placeholder="请说明交付遇到的问题"></textarea></label><button data-refund-request class="secondary">提交退款申请（不花 gas）</button>':''}${data.isOwner&&r.status!=='refunded'?'<p>等待平台线下核查；此入口不发起主网退款交易。</p>':''}</article>`).join(''):'暂无可显示的退款订单。';}catch(e){feedback.textContent=e.message;}}
 document.querySelector('#refund-refresh').onclick=refresh;
 panel.onclick=async e=>{const article=e.target.closest('[data-refund-id]');if(!article)return;const id=article.dataset.refundId,buyer=article.dataset.buyer;try{
  if(e.target.matches('[data-refund-request]')){e.target.disabled=true;await call('refund-request',{id,reason:article.querySelector('[data-reason]').value});await refresh();}

 }catch(error){feedback.textContent=error.message;e.target.disabled=false;}};
 window.addEventListener('snapvault:identity',refresh);window.addEventListener('snapvault:change',()=>{if(!wallet.token){revision++;list.textContent='连接钱包后查看你的购买订单与退款进度。';}});refresh();
}
