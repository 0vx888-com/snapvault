import {mediaCommitProof} from '../web/taperelay-file-id.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WalletService} from '../server/wallet-service.mjs';
import {objectBudget} from '../server/taperelay-media.mjs';
import {
  planEncryptedFile,
  generateKeyPair,
  uploadToServers,
  createClient,
  remoteAuth,
  sha256Hex,
  utf8,
  randomHex,
} from '../vendor/taperelay-client/src/taperelay.mjs';

const alice = '0x' + '11'.repeat(20), bob = '0x' + '22'.repeat(20), eve = '0x' + '33'.repeat(20), origin = 'http://media.test';

function fixture({quota} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sv-trsec-'));
  const service = new WalletService({
    dir, origins: [origin], allowLocalKeyFile: true, operator: {address: alice},
    provider: {getNetwork: async () => ({chainId: 31337})},
    vault: {target: '0x' + '44'.repeat(20), interface: {fragments: []}, feeBps: async () => 1000, contents: () => { throw Error('No chain operation allowed'); }},
  });
  service.state.profiles = {[alice]: {name: 'Alice'}, [bob]: {name: 'Bob'}, [eve]: {name: 'Eve'}};
  service.state.friends = [{from: alice, to: bob, status: 'accepted'}];
  service.sessions.set('alice', {account: alice, origin, until: Date.now() + 60_000});
  service.sessions.set('bob', {account: bob, origin, until: Date.now() + 60_000});
  service.sessions.set('eve', {account: eve, origin, until: Date.now() + 60_000});
  service.configureTapeRelayMedia({enabled: true, mode: 'mock', maxBytes: 8 * 1024 * 1024, ...(quota ? {userQuota: quota} : {})});
  return {s: service, dir, cleanup: () => rmSync(dir, {recursive: true, force: true})};
}

async function upload(service, token, {file, scene, mime, name = 'clip.bin', scope = 'public', convId, title}) {
  const session = await service.handle('media-session', {scene, mime, size: file.size ?? file.length, name, scope, convId, title}, token, origin);
  const selfKey = Buffer.from(session.selfKey, 'base64url');
  const ephemeral = generateKeyPair();
  const plan = await planEncryptedFile(file, {name, contentType: mime, from: session.circuit, selfKey, to: [ephemeral.publicKey]});
  const client = createClient({fetch: (...args) => service.tapeRelay.relay.fetch(...args)});
  const auth = remoteAuth({
    account: session.circuit,
    endpoint: 'https://media.test/api/wallet/media-sign',
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      body.sessionId = session.sessionId;
      try {
        const result = await service.handle('media-sign', body, token, origin);
        return new Response(JSON.stringify(result), {status: 200, headers: {'Content-Type': 'application/json'}});
      } catch (e) {
        return new Response(JSON.stringify({error: e.message}), {status: e.status || 400, headers: {'Content-Type': 'application/json'}});
      }
    },
  });
  const up = await uploadToServers(client, session.servers, auth, null, {plan, retryMs: []});
  assert.equal(up.stored, true);
  const committed = await service.handle('media-commit', {
    sessionId: session.sessionId,
    envelopeSha: plan.envelope.sha256,
    fileId: plan.fileId,
    manifestJson: plan.manifestJson,
    commitProof: await mediaCommitProof(plan.fileKey, session.sessionId, plan.envelope.sha256, plan.fileId),
  }, token, origin);
  plan.dispose();
  return {session, committed};
}

function requestMessage({account, server, path, body = '', timestamp = Math.floor(Date.now() / 1000)}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    message: {
      account, server, method: 'POST', path, query: '',
      bodyHash: '0x' + sha256Hex(utf8(raw)),
      timestamp,
      nonce: '0x' + randomHex(16),
    },
    body: path.includes('claim') ? raw : undefined,
  };
}

test('UI entry files call the shared upload and playback base', () => {
  const web = (name) => readFileSync(new URL('../web/' + name, import.meta.url), 'utf8');
  for (const file of ['social.js', 'app.js', 'wallet-chat.js']) {
    const src = web(file);
    assert.match(src, /uploadEncryptedMedia\(/);
    assert.match(src, /playAuthorizedMedia\(/);
    assert.match(src, /usesLargeMediaPath\(/);
  }
  const social = web('social.js');
  assert.match(social, /data-media/);
  assert.match(social, /onended/);
  assert.match(social, /onProgress/);
  const app = web('app.js');
  assert.match(app, /bindMediaCancel/);
  assert.match(app, /analyticsSafeDetail/);
  const chat = web('wallet-chat.js');
  assert.match(chat, /scene:'chat'/);
  assert.doesNotMatch(web('taperelay-media.js'), /gtag\(/);
  assert.doesNotMatch(social + app + chat, /fileKey/);
});

test('remoteAuth signing rejects release, oversized claims, foreign hashes, and other users', async () => {
  const f = fixture();
  try {
    const session = await f.s.handle('media-session', {scene: 'post', mime: 'image/png', size: 4000, name: 'p.png', scope: 'public', title: 't'}, 'alice', origin);
    const account = session.circuit, server = session.servers[0];
    await assert.rejects(f.s.handle('media-sign', {
      sessionId: session.sessionId,
      requests: [requestMessage({account, server, path: '/v1/objects/release', body: '{"objects":["' + 'aa'.repeat(32) + '"]}'})],
    }, 'alice', origin), /只签上传和认领/);
    const many = Array.from({length: objectBudget(4000) + 5}, (_, i) => i.toString(16).padStart(64, '0'));
    await assert.rejects(f.s.handle('media-sign', {
      sessionId: session.sessionId,
      requests: [requestMessage({account, server, path: '/v1/objects/claim', body: JSON.stringify({objects: many})})],
    }, 'alice', origin), /预算/);
    const allowed = Array.from({length: 2}, (_, i) => (i + 1).toString(16).padStart(64, '0'));
    await f.s.handle('media-sign', {
      sessionId: session.sessionId,
      requests: [requestMessage({account, server, path: '/v1/objects/claim', body: JSON.stringify({objects: allowed})})],
    }, 'alice', origin);
    await assert.rejects(f.s.handle('media-sign', {
      sessionId: session.sessionId,
      requests: [requestMessage({account, server, path: '/v1/objects/claim', body: JSON.stringify({objects: ['ff'.repeat(32)]})})],
    }, 'alice', origin), /以外的对象|不在本会话清单/);
    await assert.rejects(f.s.handle('media-sign', {
      sessionId: session.sessionId,
      requests: [requestMessage({account, server, path: '/v1/objects', body: ''})],
    }, 'bob', origin), /上传会话无效/);
  } finally { f.cleanup(); }
});

test('unpublished media keys stay with the creator; lists and status do not leak secrets', async () => {
  const f = fixture();
  try {
    const up = await upload(f.s, 'alice', {file: new Uint8Array(2500).fill(4), scene: 'post', mime: 'image/png', title: 'hold'});
    await assert.rejects(f.s.handle('media-key', {mediaId: up.committed.mediaId}, 'bob', origin), /不存在|没有查看权限/);
    const asCreator = await f.s.handle('media-key', {mediaId: up.committed.mediaId}, 'alice', origin);
    assert.ok(asCreator.fileKey);
    const published = await f.s.handle('social-publish', {kind: 'post', mediaId: up.committed.mediaId, title: 'open', scope: 'public'}, 'alice', origin);
    const opened = await f.s.handle('social-open', {id: published.id}, 'bob', origin);
    assert.equal(opened.mediaId, up.committed.mediaId);
    assert.equal(opened.fileKey, undefined);
    const key = await f.s.handle('media-key', {mediaId: up.committed.mediaId}, 'bob', origin);
    assert.ok(key.fileKey);
    const status = f.s.mediaStatus();
    const social = await f.s.handle('social-state', {}, 'bob', origin);
    assert.equal(status._devKey, undefined);
    assert.doesNotMatch(JSON.stringify({status, opened, social, mediaFiles: Object.values(f.s.state.mediaFiles).map((m)=>({id:m.id,scene:m.scene,linked:m.linked,mime:m.mime}))}), /trk1_|secretKey|_devKey|"fileKey":/);
  } finally { f.cleanup(); }
});

test('an envelope hash alone cannot be relinked by Eve to obtain another user file key', async () => {
  const f = fixture();
  try {
    const victim = await upload(f.s, 'alice', {file: new Uint8Array(3000).fill(31), scene: 'story', mime: 'video/mp4', scope: 'friends'});
    const media = f.s.mediaRecord(victim.committed.mediaId);
    const attacker = await f.s.handle('media-session', {scene: 'post', mime: media.mime, size: media.size, name: media.name, scope: 'public'}, 'eve', origin);
    await assert.rejects(f.s.handle('media-commit', {
      sessionId: attacker.sessionId, envelopeSha: media.envelopeSha, fileId: media.fileId,
      manifestJson: media.manifestJson, commitProof: '00'.repeat(32),
    }, 'eve', origin), /证明|上传者/);
    assert.equal(Object.values(f.s.state.mediaFiles).length, 1);
  } finally { f.cleanup(); }
});

test('unfriend, leave-group, expiry, unpaid and refunded access are denied', async () => {
  const f = fixture();
  try {
    const storyUp = await upload(f.s, 'alice', {file: new Uint8Array(1800).fill(2), scene: 'story', mime: 'image/png', scope: 'friends', title: 'friends-only'});
    const story = await f.s.handle('social-publish', {kind: 'story', mediaId: storyUp.committed.mediaId, title: 'friends-only', scope: 'friends'}, 'alice', origin);
    await f.s.handle('media-key', {mediaId: storyUp.committed.mediaId}, 'bob', origin);
    f.s.state.friends = [];
    await assert.rejects(f.s.handle('media-key', {mediaId: storyUp.committed.mediaId}, 'bob', origin), /不存在|没有查看权限/);
    await assert.rejects(f.s.handle('social-open', {id: story.id}, 'bob', origin), /不存在|没有查看权限/);

    const conv = {id: 'group1', type: 'group', name: 'g', members: [alice, bob], admin: alice, ts: Date.now(), shot: 'allow'};
    f.s.state.convs.push(conv);
    const chatUp = await upload(f.s, 'alice', {file: new Uint8Array(1600).fill(5), scene: 'chat', mime: 'image/png', scope: 'group', convId: conv.id, title: 'clip'});
    await f.s.handle('send', {conv: conv.id, text: 'video', mediaId: chatUp.committed.mediaId}, 'alice', origin);
    await f.s.handle('media-key', {mediaId: chatUp.committed.mediaId}, 'bob', origin);
    conv.members = [alice];
    await assert.rejects(f.s.handle('media-key', {mediaId: chatUp.committed.mediaId}, 'bob', origin), /会话|成员|不存在|没有/);

    const paidUp = await upload(f.s, 'alice', {file: new Uint8Array(1700).fill(6), scene: 'paid', mime: 'image/png', title: 'paid'});
    const media = f.s.state.mediaFiles[paidUp.committed.mediaId];
    media.linked = true;
    media.contentId = '9';
    f.s.product = async () => ({p: {creator: alice, burn: false, secs: 30, mediaId: media.id}, c: {}});
    let access = 0n, refunded = false;
    f.s.vault.accessUntil = async () => access;
    f.s.confirmed = async () => !refunded && access > 0n;
    await assert.rejects(f.s.handle('media-key', {mediaId: media.id}, 'bob', origin), /尚未确认或已过期/);
    access = BigInt(Math.floor(Date.now() / 1000) + 3600);
    await f.s.handle('media-key', {mediaId: media.id}, 'bob', origin);
    access = BigInt(Math.floor(Date.now() / 1000) - 10);
    await assert.rejects(f.s.handle('media-key', {mediaId: media.id}, 'bob', origin), /尚未确认或已过期/);
    access = BigInt(Math.floor(Date.now() / 1000) + 3600);
    refunded = true;
    await assert.rejects(f.s.handle('media-key', {mediaId: media.id}, 'bob', origin), /尚未确认或已过期/);

    const expUp = await upload(f.s, 'alice', {file: new Uint8Array(1400).fill(7), scene: 'story', mime: 'image/png', scope: 'public', title: 'old'});
    await f.s.handle('social-publish', {kind: 'story', mediaId: expUp.committed.mediaId, title: 'old', scope: 'public'}, 'alice', origin);
    f.s.state.mediaFiles[expUp.committed.mediaId].expiresAt = Date.now() - 1000;
    await assert.rejects(f.s.handle('media-key', {mediaId: expUp.committed.mediaId}, 'bob', origin), /已过期/);
  } finally { f.cleanup(); }
});

test('user quota is enforced at session creation', async () => {
  const f = fixture({quota: 3000});
  try {
    await upload(f.s, 'alice', {file: new Uint8Array(2000).fill(1), scene: 'post', mime: 'image/png', title: 'one'});
    await assert.rejects(f.s.handle('media-session', {scene: 'post', mime: 'image/png', size: 2000, name: 'two.png', scope: 'public', title: 'two'}, 'alice', origin), /配额/);
  } finally { f.cleanup(); }
});
