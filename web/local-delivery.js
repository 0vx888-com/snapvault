// Explicit local test mode; never falls back to simulated unlock when the service fails.
export const local={enabled:typeof location!=='undefined'&&['localhost','127.0.0.1','[::1]'].includes(location.hostname)&&new URLSearchParams(location.search).get('delivery')==='local',data:{contents:[],orders:[]},who:null,revision:0};
export async function localCall(action,body={}){
 const r=await fetch('/api/local/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.error||'本地交付服务不可用');if(d.chainId&&d.chainId!==31337)throw Error('本地测试网络不符');return d;
}
export async function localRefresh(who){const revision=++local.revision;const d=await localCall('state',{who});if(revision!==local.revision)return;const changed=local.who!==who||JSON.stringify(local.data)!==JSON.stringify(d);local.who=who;local.data=d;if(changed)window.dispatchEvent(new Event('snapvault:change'));}
