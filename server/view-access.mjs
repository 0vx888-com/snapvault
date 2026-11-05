// Durable one-shot grants. Raw bearer tokens never enter persisted state.
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const deny=(s=410)=>{throw Object.assign(Error(s===403?'无权使用此查看凭证':'查看已结束或凭证已使用'),{status:s})};
const hash=t=>createHash('sha256').update(t).digest('hex');
export function installViewAccess(Service){
 Object.assign(Service.prototype,{
  initViews(){this.state.viewGrants||={};this.state.viewRefs||={};mkdirSync(resolve(this.dir,'burn'),{recursive:true,mode:0o700});for(const m of this.state.messages)if(m.burn&&m.payload){writeFileSync(resolve(this.dir,'burn',m.id+'.enc'),JSON.stringify(m.payload),{mode:0o600});delete m.payload;m.burnFile=true;}this.sweepViews();},
  finishView(ref,who){const r=this.state.viewRefs[ref];if(!r||r.who!==who)deny(403);r.finished=true;for(const g of Object.values(this.state.viewGrants))if(g.ref===ref)g.used=true;
   if(r.message){const m=this.state.messages.find(x=>x.id===r.message);const c=m&&this.state.convs.find(x=>x.id===m.conv);if(m&&c?.type==='dm'){const file=resolve(this.dir,'burn',m.id+'.enc');if(existsSync(file))unlinkSync(file);delete m.payload;delete m.burnFile;m.destroyedAt=Date.now();}if(m)m.opens[who]=Math.min(m.opens[who]||Date.now(),Date.now());}
   else {const a=this.state.assets[r.asset];if(a?.meta?.scope==='dm'&&a.meta.burn){delete a.blob;delete a.key;a.destroyedAt=Date.now();}}if(!r.message)this.state.opens[ref]=Math.min(this.state.opens[ref]||Date.now(),Date.now());this.save();return {ok:true};},
  sweepViews(){for(const [ref,r]of Object.entries(this.state.viewRefs))if(!r.finished&&r.viewUntil<=Date.now())this.finishView(ref,r.who);},
  grantView({who,ref,secs,message,asset,preview=false,accessUntil=Infinity,existingDeadline=Infinity}){this.sweepViews();let r=this.state.viewRefs[ref];if(r&&!preview)deny();const now=Date.now();r={who,message,asset,viewUntil:Math.min(now+secs*1000,accessUntil,existingDeadline),finished:false};this.state.viewRefs[ref]=r;const token=randomBytes(32).toString('hex');this.state.viewGrants[hash(token)]={who,ref,expires:Math.min(now+(secs+10)*1000,accessUntil),used:false};if(message){const m=this.state.messages.find(m=>m.id===message);m.opens[who]=r.viewUntil;}else if(!preview)this.state.opens[ref]=r.viewUntil;this.save();return {uri:'/api/wallet/access/'+token,viewRef:ref,viewUntil:r.viewUntil,tokenExpires:Math.min(now+(secs+10)*1000,accessUntil)};},
  consumeView(token,who){const g=this.state.viewGrants[hash(token||'')];if(!g)deny();if(g.who!==who)deny(403);const r=this.state.viewRefs[g.ref];if(g.used||g.expires<=Date.now()||!r||r.finished||r.viewUntil<=Date.now()){if(r&&!r.finished)this.finishView(g.ref,who);deny();}let bytes,mime;
   if(r.message){const m=this.state.messages.find(x=>x.id===r.message);if(!m||m.destroyedAt)deny();const file=resolve(this.dir,'burn',m.id+'.enc');if(m.burnFile&&!existsSync(file)){this.finishView(g.ref,who);deny();}const payload=m.burnFile?JSON.parse(readFileSync(file,'utf8')):m.payload;bytes=this.unseal(payload);mime='application/json';}
   else{const a=this.state.assets[r.asset];if(!a?.blob)deny();bytes=Buffer.from(a.blob,'base64');mime='application/octet-stream';}g.used=true;this.save();return {bytes,mime};},
 });
}
