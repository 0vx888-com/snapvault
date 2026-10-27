import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export async function cleanPublicBuild(out){
 const edit=async(file,fn)=>{const path=resolve(out,file);await writeFile(path,fn(await readFile(path,'utf8')))};
 await edit('index.html',s=>s.replace('<html lang="zh-CN">','<html lang="zh-CN" data-app-mode="wallet">')
 .replace('class="service-status hidden"','class="service-status"')
 .replace('当前为不扣款的产品预览。','钱包登录，聊天发图，按需解锁内容。')
 .replace('class="preview-note"','class="preview-note hidden"')
 .replace('class="discovery-aside"','class="discovery-aside hidden"')
 .replace('class="demo-identity"','class="demo-identity hidden"')
 .replace('切换体验身份','账户设置')
 .replace('本地体验版</div>','X Layer</div>')
 .replace('<span>人物与内容为演示数据</span>','')
 .replace('class="identity-label"','class="identity-label hidden"').replaceAll('演示身份','账户')
 .replace('钱包接入说明','连接钱包').replace('<option value="USDT">USDT</option><option value="OKB">OKB</option>','<option value="OKB">正在连接 X Layer 主网…</option>').replace('SnapVault / 本地预览','SnapVault / X Layer')
 .replace('产品预览：人物与聊天为演示数据，购买不扣款。正式钱包、多人同步与内容交付仍在接入。','正在连接服务。连接成功后显示当前网络与可用功能。')
 .replace('本地体验版 · 人物与内容为演示数据，购买不扣款。','正在连接服务。连接成功后显示当前网络与可用功能。')
 .replace('了解进度 ↗','使用说明 ↗').replace('体验图片解锁','发布图片')
 .replace('试一张示例图片','发布图片').replace('体验解锁','发布图片').replace('体验一次图片解锁和限时查看。','上传图片，设置价格与查看时长。').replace('本地模拟，不扣款。无法阻止截图。','付款由钱包确认。限时展示无法阻止截图。')
 .replace('一张 10 秒的示例图片','设置一张限时图片').replace('打开后才计时 · 本地模拟，不扣款','价格和时长由你设置 · 付款需钱包确认').replace('人物与内容为演示数据','以当前服务返回的内容为准')
 .replace('AI 生成的海边示例图片','装饰性海边插画')
 .replace('当前为本地演示，图片和密钥保存在本浏览器。','')
 .replace('当前产品预览','钱包登录与内容分享').replace('正式前端计划发布到 X Layer DeWEB','前端托管于 X Layer DeWEB').replace('预览说明','使用说明')
 .replace(/<dialog id="preview-dialog"[\s\S]*?<\/dialog>/,`<dialog id="preview-dialog" class="purchase-dialog"><form method="dialog"><button class="dialog-close" aria-label="关闭使用说明">×</button></form><p class="eyebrow">SNAPVAULT</p><h2>分享，由你决定。</h2><p>连接钱包后使用私聊、群聊和图片分享。普通用户无需个人容器。</p><p>付费内容以当前网络、订单金额和钱包确认信息为准，服务未就绪时不开放付款。</p><p>平台服务保存密文并负责交付。已有可用容器和公钥时使用 TapeSend，否则明确提示普通交付。</p><p class="field-note">阅后即焚限制站内展示，无法阻止截图或收回已保存的内容。</p></dialog>`)
 .replace('本地演示：不会连接钱包、扣款或发送链上交易。密钥交付尚未接入 TapeSend。','付款前请核对网络、金额和交付方式。').replaceAll('模拟付款并解锁','钱包确认付款'));
 await edit('wallet.js',s=>s.replace('let settings={};',"let settings={mode:'wallet'};").replace('/* existing demo remains usable without a deployment config */','/* Missing config keeps wallet mode fail-closed; never enable simulated purchases. */'));
 await edit('store.js',s=>s.replace(/export const PEOPLE = \{[\s\S]*?\n\};/,'export const PEOPLE = {};')
 .replace(/export async function purchaseDemo\([\s\S]*?\nexport function beginView/,"export async function purchaseDemo(){throw new Error('付款服务未就绪，未发起交易');}\nexport function beginView")
 .replace(/  \/\/ Keep the explicitly labelled seeded buyer[^\n]*\n  if \(creator === CREATOR[^\n]*\n/,''));
 await writeFile(resolve(out,'chat.js'),`import {wallet,walletAction} from './wallet.js';
import {uidOf} from './store.js';
import {initWalletChat} from './wallet-chat.js';
export {uidOf,hasPurchased,PEOPLE} from './store.js';
export const Friends={all:()=>wallet.data.friends||[],resolve(q){q=q.trim();return /^0x[0-9a-fA-F]{40}$/.test(q)?q.toLowerCase():Object.keys(wallet.data.profiles).find(a=>uidOf(a)===q.toUpperCase())||null;},request(from,to){return walletAction('friend',{to});},accept(from,to){return walletAction('friend',{to:from,accept:true});},isFriend(x,y){return this.all().some(f=>f.status==='accepted'&&[f.from,f.to].includes(x)&&[f.from,f.to].includes(y));}};
export function initChat(root,options={}){return initWalletChat(root,options);}
`);
 await edit('app.js',s=>s.replace(/\$\('#try-demo'\)\.onclick = async \(\) => \{[\s\S]*?\n\};/,"$('#try-demo').onclick=()=>{go('creator');if(!wallet.account)toast('请先连接钱包');};")
 .replace("$('#connect').onclick = () => toast('当前只演示前端流程，真实钱包付款与 TapeSend 交付尚未接入；不会发起交易。');","$('#connect').onclick=()=>toast('请连接钱包，服务未就绪时无法付款。');")
 .replace("${wallet.enabled?'示例风景封面':'AI 生成的创作者示例封面'}",'装饰封面').replace("${wallet.enabled?'示例封面':'界面示例'}",'')
 .replaceAll('发布测试图片 ↗','发布图片 ↗'));
 await edit('wallet-chat.js',s=>s.replace('测试服务可读取内容，尚非端到端加密','平台服务处理消息，尚非端到端加密'));
}
