// Local test identities and chain stubs; storage uses real official TapeRelay nodes.
// Loopback only. No production account access, wallet transactions, deployment or Google traffic.
import {readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {walletHttp} from '../server/wallet-http.mjs';
import {createTapeRelayPreviewService, PREVIEW_HOST, PREVIEW_VAULT} from './taperelay-media-preview.mjs';
import {tmpdir} from 'node:os';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {loadMediaSettings} from '../server/taperelay-media.mjs';
import {describeDeveloperKey,serversOfKey,createClient,remoteAuth,planEncryptedFile,uploadToServers} from '../vendor/taperelay-client/src/taperelay.mjs';
import {mediaCommitProof} from '../web/taperelay-file-id.js';
import assert from 'node:assert/strict';

const HOST = PREVIEW_HOST;
const PORT = Number(process.env.TAPERELAY_PREVIEW_PORT || 4189);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw Error('TAPERELAY_PREVIEW_PORT 无效');
const origin = `http://${HOST}:${PORT}`;
const root = resolve(import.meta.dirname, '..');
const PIN = '0xFd9b25442955C09007abB2D10dEcD24b4d2CF83f';

const walletSource = readFileSync(resolve(root, 'web/wallet.js'), 'utf8');
if (!walletSource.includes('export const CHAIN_ID = 196;') || !walletSource.includes(PIN)) {
  throw Error('Production wallet pins changed; review the preview rewrite');
}
const rewrittenWallet = walletSource
  .replaceAll(PIN, PREVIEW_VAULT)
  .replace('export const CHAIN_ID = 196;', 'export const CHAIN_ID = 31337;');
const previewJs = Buffer.from(readFileSync(resolve(root, 'scripts/local-media-preview.js'),'utf8').replace('本地模拟预览','本地真实节点验收').replace('不连真实 TapeRelay / Google / 钱包，也不代签付费交易。页头发布按钮应可点。','存储连接真实 TapeRelay；登录身份与链上订单为测试夹具，不代表生产登录或付费验证。').replace('（约 738 KB，8 秒）','（合成图案，6 秒）'));
const fixturePath = resolve(root, '../snapvault-video-fixtures/upload-test.mp4');
const extraStatic = {
  '/local-media-preview.js': {type: 'text/javascript; charset=utf-8', body: previewJs},
};
if (existsSync(fixturePath)) {
  extraStatic['/fixtures/upload-test.mp4'] = {type: 'video/mp4', body: readFileSync(fixturePath)};
}

const dir = process.env.TAPERELAY_PREVIEW_DIR || mkdtempSync(join(tmpdir(), 'sv-tr-preview-'));
const service = createTapeRelayPreviewService({dir, origin});
const secrets = join(homedir(),'Library','Application Support','SnapVault','secrets');
const raw = readFileSync(join(secrets,'taperelay.env'),'utf8');
const devKey = /^TAPERELAY_KEY=(trk1_[A-Za-z0-9_-]+)\s*$/m.exec(raw)?.[1];
const selfSecret = readFileSync(join(secrets,'taperelay-self-secret'),'utf8').trim();
const description = describeDeveloperKey(devKey), servers = serversOfKey(devKey);
if(description.account!=='1408.2.265.tape'||servers.length!==3||['relay1.taperelay.com:4246','relay4.taperelay.com:4246','relay5.taperelay.com:4246'].some(s=>!servers.includes(s)))throw Error('Unexpected developer key circuit or nodes');
service.tapeRelay=null; // discard the brand-new empty mock fixture, never production state
service.configureTapeRelayMedia({enabled:true,mode:'live',devKey,selfSecret,circuit:description.account,servers});
assert.equal(service.mediaStatus().mode,'live');
const video=new Blob([readFileSync(fixturePath)],{type:'video/mp4'});
const session=await service.handle('media-session',{scene:'story',mime:'video/mp4',size:video.size,name:'synthetic-story.mp4',scope:'friends'},'preview-alice',origin);
const plan=await planEncryptedFile(video,{name:'synthetic-story.mp4',contentType:'video/mp4',from:session.circuit,selfKey:Buffer.from(session.selfKey,'base64url')});
const auth=remoteAuth({account:session.circuit,endpoint:origin+'/local-test-sign',fetch:async(_url,init)=>{
  const body=JSON.parse(init.body);body.sessionId=session.sessionId;
  const signed=await service.handle('media-sign',body,'preview-alice',origin);
  return new Response(JSON.stringify(signed),{status:200,headers:{'Content-Type':'application/json'}});
}});
try{
 const uploaded=await uploadToServers(createClient({timeoutMs:20000}),servers,auth,null,{plan,retryMs:[]});
 const settled=await uploaded.settled;
 assert.equal(settled.ok.length,3);
 const committed=await service.handle('media-commit',{sessionId:session.sessionId,envelopeSha:plan.envelope.sha256,fileId:plan.fileId,manifestJson:plan.manifestJson,commitProof:await mediaCommitProof(plan.fileKey,session.sessionId,plan.envelope.sha256,plan.fileId)},'preview-alice',origin);
 const post=await service.handle('social-publish',{kind:'story',mediaId:committed.mediaId,title:'真实节点 · 合成测试视频',scope:'friends'},'preview-alice',origin);
 assert.equal((await service.handle('social-state',{},'preview-bob',origin)).stories.length,1);
 assert.equal((await service.handle('social-state',{},'preview-eve',origin)).stories.length,0);
 const key=await service.handle('media-key',{mediaId:committed.mediaId},'preview-bob',origin);assert.ok(key.fileKey);key.fileKey='';
 await assert.rejects(service.handle('media-key',{mediaId:committed.mediaId},'preview-eve',origin));
 console.log(JSON.stringify({realNodes:servers,syntheticVideoBytes:video.size,replicas:3,bobStoryListed:true,bobKeyIssued:true,eveStoryHidden:true,eveKeyDenied:true,productionAuthenticationTested:false,paidTransactionTested:false}));
}finally{plan.dispose();}


const server = walletHttp({
  service,
  root,
  port: PORT,
  allowedHosts: [`${HOST}:${PORT}`],
  extraStatic,
  rewriteStatic(requested, bytes) {
    if (requested === '/wallet.js') return Buffer.from(rewrittenWallet);
    if (requested === '/index.html') {
      let html = bytes.toString('utf8');
      if (!html.includes('local-media-preview.js')) {
        html = html.replace('<head>', '<head>\n  <script src="/local-media-preview.js"></script>');
      }
      return Buffer.from(html);
    }
    return bytes;
  },
});

await new Promise((ok, no) => server.listen(PORT, HOST, ok).on('error', no));
const url = `${origin}/index.html?delivery=wallet&localMediaPreview=1`;
console.log('TAPERELAY_MEDIA_PREVIEW ' + url);
console.log('Bind: ' + HOST + ':' + PORT + ' only. Data dir: ' + dir);
console.log('Fixture: ' + (extraStatic['/fixtures/upload-test.mp4'] ? origin + '/fixtures/upload-test.mp4' : 'missing ' + fixturePath));
console.log('Accounts: Alice (publisher) · Bob (accepted friend, DM + 预览群) · Eve (no access). Switch with the top bar, which does not cover the publish control.');
console.log('Browser checks pending; this server startup only verifies service ACL against real storage.');
console.log('Local identities and chain stubs only. Real storage nodes. Not covered: production auth, paid purchases, phones.');
process.on('SIGINT', () => server.close(() => process.exit()));
process.on('SIGTERM', () => server.close(() => process.exit()));
