import {icon} from './ui-icons.js';
import {initLanguage} from './i18n.js';

// Language selection remains usable while the service is still connecting.
initLanguage();

export function initProductUI(){
 document.querySelectorAll('[data-back-discover]').forEach(b=>b.onclick=()=>document.querySelector('[data-tab=fan]').click());
 document.querySelectorAll('[data-open-messages]').forEach(b=>b.onclick=()=>document.querySelector('#open-chat').click());
 // A search shortcut belongs to navigation, never to a text field or an open dialog.
 document.addEventListener('keydown',e=>{
  if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,[contenteditable=true]')||document.querySelector('dialog[open]'))return;
  if(e.key==='/'){e.preventDefault();const chat=document.body.dataset.page==='chat';document.querySelector(chat?'#conversation-search':'#search')?.focus();}
 });
 document.querySelector('#search').addEventListener('keydown',e=>{if(e.key==='Escape'){e.target.value='';e.target.dispatchEvent(new Event('input',{bubbles:true}));e.target.blur();}});
 let pending=false;
 const enhance=()=>{
  const submit=document.querySelector('#editor-submit'),original=document.querySelector('#form button[type=submit]');if(submit&&original&&submit.disabled!==original.disabled)submit.disabled=original.disabled;
  for(const send of document.querySelectorAll('#chat-form button[type=submit]'))if(!send.querySelector('.send-arrow')){const label=document.createElement('span');label.className='sr-only';label.append(...send.childNodes);send.append(label);send.insertAdjacentHTML('beforeend','<svg class="send-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>');}
  for(const button of document.querySelectorAll('[data-copy-self],[data-copy-uid]')){
   if(button.querySelector('svg')||!button.textContent.includes('⧉'))continue;
   for(const child of button.childNodes){if(child.nodeType===Node.TEXT_NODE)child.textContent=child.textContent.replace('⧉','');else if(child.textContent.trim()==='⧉')child.remove();}
   button.insertAdjacentHTML('beforeend',icon('copy'));
  }
  // Generic empty decoration uses the brand symbol instead of a text-art placeholder.
  for(const tape of document.querySelectorAll('.empty-tape'))if(!tape.querySelector('img')){tape.textContent='';const img=document.createElement('img');img.src='assets/mark-tape.svg';img.alt='';img.width=46;img.height=46;tape.append(img);}
 };
 const observer=new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;enhance();});});
 enhance();observer.observe(document.querySelector('main'),{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
 const language=()=>{document.querySelector('#profile-language-value').textContent=document.documentElement.lang==='en'?'English':'简体中文';};language();window.addEventListener('snapvault:language',language);document.querySelector('#profile-language').onclick=()=>document.querySelector('#language-switch').click();
 const account=document.querySelector('#account-dialog');
 for(const [buttonId,dialogId]of [['account-edit','profile-edit-dialog'],['account-orders','orders-dialog'],['account-help','preview-dialog']]){
  const button=document.getElementById(buttonId),dialog=document.getElementById(dialogId);button.addEventListener('click',()=>{dialog.dataset.returnToProfile='true';},true);
  dialog.addEventListener('close',()=>{if(dialog.dataset.returnToProfile==='true'){delete dialog.dataset.returnToProfile;if(!document.querySelector('dialog[open]'))account.showModal();}});
 }
 document.querySelector('#account-help').onclick=()=>{account.close();document.querySelector('#preview-details').click();};
 document.body.dataset.uiReady='true';
 window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
}
