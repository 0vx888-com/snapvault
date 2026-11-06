// Authenticated client-reported capture notices. This is not device attestation.
import {randomUUID} from 'node:crypto';
import {uidOf,publicProfile} from './public-profiles.mjs';
const fail=(text,status=400)=>{throw Object.assign(Error(text),{status});};
export function installScreenPrivacy(Service){Object.assign(Service.prototype,{
 privacySetting(b,who){const c=this.member(b.conv,who);if(typeof b.enabled!=='boolean')fail('提醒设置无效');c.captureNotices=b.enabled;this.save();return {enabled:c.captureNotices};},
 async reportCapture(b,who){
  if(!/^[0-9a-f-]{36}$/i.test(b.eventId||'')||!['ios','android'].includes(b.platform)||!Number.isSafeInteger(b.capturedAt)||Math.abs(Date.now()-b.capturedAt)>300000)fail('截图事件无效或已过期');
  const context=b.context;if(!context||!['conversation','content','post','story'].includes(context.kind)||typeof context.id!=='string'||context.id.length>100)fail('截图范围无效');
  // Replays return the original result without adding another notice.
  this.state.captureEvents||=[];const duplicate=this.state.captureEvents.find(e=>e.actor===who&&e.eventId===b.eventId);if(duplicate)return {id:duplicate.id,duplicate:true};
  this.limit('capture:'+who,12);let recipients=[],conv=null;
  if(context.kind==='conversation'){conv=this.member(context.id,who);if(!conv.captureNotices)fail('此会话未启用手机截图提醒',409);recipients=conv.members.filter(a=>a!==who);}
  else if(['post','story'].includes(context.kind)){
   const p=(context.kind==='story'?this.state.socialStories:this.state.socialPosts)?.[context.id];if(!p||p.creator===who)fail('内容不存在或无需提醒',404);
   const allowed=this.socialState(who)[context.kind==='story'?'stories':'posts'].some(p=>p.id===context.id);if(!allowed)fail('无权访问此内容',403);recipients=[p.creator];
  }else{
   const {p}=await this.product(context.id,who);if(p.creator===who)fail('作者预览无需提醒',409);
   if(!await this.vault.accessUntil(context.id,who)||Number(await this.vault.accessUntil(context.id,who))*1000<=Date.now())fail('尚未购买或已过期',403);
   recipients=[p.creator];conv=p.convId?this.member(p.convId,who):null;if(conv&&!conv.captureNotices)fail('此会话未启用手机截图提醒',409);
  }
  const notice={id:randomUUID(),eventId:b.eventId,actor:who,actorUID:uidOf(who),actorName:publicProfile(this.state.profiles[who]).name,recipients,platform:b.platform,context:{kind:context.kind,id:context.id},ts:Date.now(),capturedAt:b.capturedAt,source:'device-reported'};
  if(conv&&this.state.messages.length>=20000)fail("消息容量已满，提醒未保存",507);
  this.state.captureEvents.push(notice);if(this.state.captureEvents.length>2000)this.state.captureEvents.splice(0,this.state.captureEvents.length-2000);
  if(conv)this.state.messages.push({id:notice.id,conv:conv.id,from:who,ts:notice.ts,kind:'privacy-notice',notice:'device-screenshot',platform:b.platform,burn:false,opens:{}});
  this.save();return {id:notice.id,duplicate:false};
 },
 captureNoticesFor(who){return (this.state.captureEvents||[]).filter(e=>e.recipients.includes(who)).map(({recipients,eventId,...e})=>e);}
});}
