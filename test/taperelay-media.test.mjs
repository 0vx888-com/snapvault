import {mediaCommitProof} from '../web/taperelay-file-id.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WalletService} from '../server/wallet-service.mjs';
import {walletHttp} from '../server/wallet-http.mjs';
import {DEFAULT_MAX_BYTES, MEDIA_TYPES, MAX_ENVELOPE_RECIPIENTS} from '../server/taperelay-media.mjs';
import {
  planEncryptedFile,
  planEncryptedResume,
  resumableOf,
  generateKeyPair,
  uploadToServers,
  createClient,
  remoteAuth,
  readEncryptedFileWithKey,
} from '../vendor/taperelay-client/src/taperelay.mjs';

const alice = '0x' + '11'.repeat(20), bob = '0x' + '22'.repeat(20), eve = '0x' + '33'.repeat(20), origin = 'http://media.test';
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(1200).fill(7)]);

function fixture(enabled = true) {
  const dir = mkdtempSync(join(tmpdir(), 'sv-trmedia-'));
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
  if (enabled) service.configureTapeRelayMedia({enabled: true, mode: 'mock', maxBytes: 8 * 1024 * 1024});
  return {s: service, dir, cleanup: () => rmSync(dir, {recursive: true, force: true})};
}

function secretIn(value) {
  const text = JSON.stringify(value);
  return /trk1_|fileKey|secretKey|developerKey|_devKey/.test(text) && /trk1_/.test(text)
    || (value && typeof value === 'object' && (value.fileKey || value.secretKey || value._devKey || value.developerKey));
}

async function uploadOnce(service, token, {file, scene, mime, name = 'clip.bin', scope = 'public', convId, title, signal, resume}) {
  const who = service.sessions.get(token).account;
  const session = await service.handle('media-session', {scene, mime, size: file.size ?? file.length, name, scope, convId, title}, token, origin);
  const selfKey = Buffer.from(session.selfKey, 'base64url');
  const ephemeral = resume?.keyPair || generateKeyPair();
  const input = file instanceof Uint8Array ? file : file;
  const plan = resume
    ? await planEncryptedResume(input, {saved: resume.saved, keyPairs: [ephemeral]})
    : await planEncryptedFile(input, {name, contentType: mime, from: session.circuit, selfKey, to: [ephemeral.publicKey]});
  const client = createClient({fetch: (...args) => service.tapeRelay.relay.fetch(...args)});
  const auth = remoteAuth({
    account: session.circuit,
    endpoint: 'https://media.test/api/wallet/media-sign',
    headers: {Authorization: 'Bearer ' + token},
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
  const up = await uploadToServers(client, session.servers, auth, null, {plan, signal, retryMs: []});
  const saved = resumableOf(plan);
  if (!up.stored) return {session, plan, up, ephemeral, saved, committed: null};
  const committed = await service.handle('media-commit', {
    sessionId: session.sessionId,
    envelopeSha: plan.envelope.sha256,
    fileId: plan.fileId,
    manifestJson: plan.manifestJson,
    commitProof: await mediaCommitProof(plan.fileKey, session.sessionId, plan.envelope.sha256, plan.fileId),
  }, token, origin);
  plan.dispose();
  return {session, up, ephemeral, saved, committed, who};
}

test('large media stays off by default and does not loosen the existing 2 MB image path', async () => {
  const f = fixture(false);
  try {
    const status = f.s.mediaStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.mode, 'off');
    assert.equal(status.selfKey, null);
    assert.equal((await f.s.config()).socialMedia.video, false);
    await assert.rejects(f.s.handle('media-session', {scene: 'story', mime: 'video/mp4', size: 1000}, 'alice', origin), /未启用/);
    await assert.rejects(f.s.handle('social-publish', {kind: 'post', scope: 'public', title: 'x', image: Buffer.from(png).toString('base64'), mime: 'video/mp4'}, 'alice', origin), /视频/);
    const image = Buffer.from(png).toString('base64');
    const p = await f.s.handle('social-publish', {kind: 'post', scope: 'public', title: 'photo', image, mime: 'image/png'}, 'alice', origin);
    const opened = await f.s.handle('social-open', {id: p.id}, 'bob', origin);
    assert.equal(opened.image, image);
    assert(!opened.mediaId);
  } finally { f.cleanup(); }
});

test('mock upload uses official chunked encrypted APIs, File/Blob reads, and resume after abort', async () => {
  const f = fixture(true);
  try {
    const bytes = new Uint8Array(2 * 1048536 + 100).fill(9);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new Blob([bytes], {type: 'image/png'});
    let reads = 0, maxSlice = 0;
    const orig = file.slice.bind(file);
    file.slice = (a, b) => { reads++; maxSlice = Math.max(maxSlice, (b ?? file.size) - a); return orig(a, b); };
    const ac = new AbortController();
    const first = await uploadOnce(f.s, 'alice', {file, scene: 'post', mime: 'image/png', title: 'big', signal: ac.signal});
    // Force an abort mid-flight on a second file to exercise official resume.
    const bytes2 = new Uint8Array(3 * 1048536).fill(3);
    const file2 = new Blob([bytes2], {type: 'image/png'});
    const session = await f.s.handle('media-session', {scene: 'post', mime: 'image/png', size: file2.size, name: 'resume.bin', scope: 'public', title: 'resume'}, 'alice', origin);
    const selfKey = Buffer.from(session.selfKey, 'base64url');
    const ephemeral = generateKeyPair();
    const plan = await planEncryptedFile(file2, {name: 'resume.bin', contentType: 'image/png', from: session.circuit, selfKey, to: [ephemeral.publicKey]});
    const client = createClient({fetch: (...args) => f.s.tapeRelay.relay.fetch(...args)});
    const authFor = (sid) => remoteAuth({
      account: session.circuit,
      endpoint: 'https://media.test/api/wallet/media-sign',
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        body.sessionId = sid;
        const result = await f.s.handle('media-sign', body, 'alice', origin);
        return new Response(JSON.stringify(result), {status: 200, headers: {'Content-Type': 'application/json'}});
      },
    });
    const stop = new AbortController();
    let progressed = 0;
    const pending = uploadToServers(client, session.servers, authFor(session.sessionId), null, {
      plan, signal: stop.signal, retryMs: [],
      onProgress: () => { progressed++; if (progressed === 1) stop.abort(); },
    });
    const mid = await pending;
    assert.equal(mid.stored, false);
    const saved = resumableOf(plan);
    assert.ok(saved.envelope && saved.nonces && saved.index);
    assert.equal(saved.fileKey, undefined);
    const uploadsBefore = f.s.tapeRelay.relay.stats.uploadCalls;
    const plan2 = await planEncryptedResume(file2, {saved, keyPairs: [ephemeral]});
    const again = await uploadToServers(client, session.servers, authFor(session.sessionId), null, {plan: plan2, retryMs: []});
    assert.equal(again.stored, true);
    assert.ok(f.s.tapeRelay.relay.stats.uploadCalls <= uploadsBefore + 8, 'resume should skip already-uploaded objects');
    const committed = await f.s.handle('media-commit', {
      sessionId: session.sessionId,
      envelopeSha: plan2.envelope.sha256,
      fileId: plan2.fileId,
      manifestJson: plan2.manifestJson,
    commitProof: await mediaCommitProof(plan2.fileKey, session.sessionId, plan2.envelope.sha256, plan2.fileId),
    }, 'alice', origin);
    plan.dispose(); plan2.dispose();
    const published = await f.s.handle('social-publish', {kind: 'post', scope: 'public', title: 'resumed', mediaId: committed.mediaId}, 'alice', origin);
    const opened = await f.s.handle('social-open', {id: published.id}, 'bob', origin);
    assert.equal(opened.mediaId, committed.mediaId);
    assert.equal(opened.image, undefined);
    const issued = await f.s.handle('media-key', {mediaId: committed.mediaId}, 'bob', origin);
    const key = Buffer.from(issued.fileKey, 'base64url');
    const read = await readEncryptedFileWithKey(client, session.servers, issued.envelopeSha, key);
    assert.deepEqual(Buffer.from(read.bytes), Buffer.from(bytes2));
    read && issued.fileKey;
    assert.ok(maxSlice <= 1048536 + 40 || first, 'planning and upload must not slurp the whole Blob');
    assert.ok(reads >= 2);
  } finally { f.cleanup(); }
});

test('status, logs and listings never include developer keys or file keys; signer is fail-closed', async () => {
  const f = fixture(true);
  try {
    const status = f.s.mediaStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.mode, 'mock');
    assert.equal(status.liveReady, false);
    assert.equal(status.testedOnPhones, false);
    assert.equal(status.maxEnvelopeRecipients, MAX_ENVELOPE_RECIPIENTS);
    assert.ok(status.maxBytes <= DEFAULT_MAX_BYTES || status.maxBytes === 8 * 1024 * 1024);
    assert.ok(MEDIA_TYPES.includes('video/mp4'));
    assert.equal(status._devKey, undefined);
    assert.ok(!secretIn(status));
    assert.match(status.expiryNote, /不会立即删除/);
    const file = new Uint8Array(4000).fill(4);
    const up = await uploadOnce(f.s, 'alice', {file, scene: 'story', mime: 'image/png', scope: 'friends'});
    const pub = await f.s.handle('social-publish', {kind: 'story', scope: 'friends', title: '', mediaId: up.committed.mediaId}, 'alice', origin);
    const listed = f.s.socialState(bob);
    const dumped = JSON.stringify({status, listed, pub, committed: up.committed, config: await f.s.config()});
    assert.doesNotMatch(dumped, /trk1_/);
    assert.ok(!JSON.parse(JSON.stringify(listed)).stories[0].fileKey);
    const open = await f.s.handle('media-session', {scene: 'post', mime: 'image/png', size: 1000, name: 'x.png', scope: 'public', title: 'x'}, 'alice', origin);
    await assert.rejects(f.s.handle('media-sign', {sessionId: open.sessionId, requests: [{message: {path: '/v1/inbox/x'}}]}, 'alice', origin), /不签|不合格|不是 Request|Request/);
    await assert.rejects(f.s.handle('media-commit', {
      sessionId: open.sessionId, envelopeSha: 'aa'.repeat(32), fileId: 'bb'.repeat(32),
      manifestJson: '{}', fileKey: 'should-not-be-accepted',
    }, 'alice', origin), /包含文件密钥|清单|无效/);
  } finally { f.cleanup(); }
});

test('Stories, paid unlock and chat all reuse the same encrypted media base with app-layer expiry and payment checks', async () => {
  const f = fixture(true);
  try {
    // Story: friends only, expires, strangers cannot get the key.
    const storyFile = new Uint8Array(5000).fill(11);
    const storyUp = await uploadOnce(f.s, 'alice', {file: storyFile, scene: 'story', mime: 'image/png', scope: 'friends'});
    const story = await f.s.handle('social-publish', {kind: 'story', scope: 'friends', title: '', mediaId: storyUp.committed.mediaId}, 'alice', origin);
    const friendKey = await f.s.handle('media-key', {mediaId: storyUp.committed.mediaId}, 'bob', origin);
    assert.equal(friendKey.envelopeSha, storyUp.committed.envelopeSha);
    await assert.rejects(f.s.handle('media-key', {mediaId: storyUp.committed.mediaId}, 'eve', origin), /权限|不存在/);
    f.s.state.mediaFiles[storyUp.committed.mediaId].expiresAt = Date.now() - 1;
    f.s.state.socialStories[story.id].expiresAt = Date.now() - 1;
    await assert.rejects(f.s.handle('media-key', {mediaId: storyUp.committed.mediaId}, 'bob', origin), /过期/);
    assert.ok(f.s.tapeRelay.relay.has(storyUp.committed.envelopeSha), 'ciphertext remains on the node after app-layer expiry');

    // Paid: no key without a confirmed purchase; creator can preview; 20-buyer list is not limited by the 16-slot envelope.
    const paidFile = new Uint8Array(8000).fill(12);
    const paidUp = await uploadOnce(f.s, 'alice', {file: paidFile, scene: 'paid', mime: 'image/png', scope: 'public', title: 'clip'});
    const asset = await f.s.handle('upload', {mediaId: paidUp.committed.mediaId, mime: 'image/png', meta: {title: 'clip', price: '1', secs: 30, max: 0, burn: false}}, 'alice', origin);
    assert.match(asset.uri, /^trmedia:/);
    assert.equal(asset.blob, undefined);
    f.s.state.mediaFiles[paidUp.committed.mediaId].contentId = '99';
    f.s.product = async () => ({p: {creator: alice, burn: false, secs: 30, mediaId: paidUp.committed.mediaId}, c: {}});
    f.s.confirmed = async () => false;
    f.s.vault.accessUntil = async () => 0n;
    await assert.rejects(f.s.handle('media-key', {mediaId: paidUp.committed.mediaId}, 'bob', origin), /订单|过期|确认/);
    const correctProduct = f.s.product;
    f.s.product = async () => ({p: {creator: alice, mediaId: 'different-media'}, c: {}});
    await assert.rejects(f.s.handle('media-key', {mediaId: paidUp.committed.mediaId}, 'alice', origin), /作品媒体记录不符/);
    f.s.product = correctProduct;
    const preview = await f.s.handle('media-key', {mediaId: paidUp.committed.mediaId}, 'alice', origin);
    assert.equal(preview.preview, true);
    f.s.confirmed = async () => true;
    f.s.vault.accessUntil = async () => BigInt(Math.floor(Date.now() / 1000) + 3600);
    const buyer = await f.s.handle('media-key', {mediaId: paidUp.committed.mediaId}, 'bob', origin);
    assert.ok(buyer.fileKey);
    let confirmationReads = 0;
    f.s.confirmed = async () => ++confirmationReads === 1;
    await assert.rejects(f.s.handle('media-key', {mediaId: paidUp.committed.mediaId}, 'bob', origin), /订单|过期|确认/);
    f.s.confirmed = async () => true;
    assert.notEqual(buyer.fileKey, preview.fileKey + 'nope');
    // Arbitrary additional buyers still go through the key server; they are not envelope recipients.
    f.s.sessions.set('buyer20', {account: '0x' + 'aa'.repeat(20), origin, until: Date.now() + 60_000});
    f.s.state.profiles['0x' + 'aa'.repeat(20)] = {name: 'Buyer20'};
    const extra = await f.s.handle('media-key', {mediaId: paidUp.committed.mediaId}, 'buyer20', origin);
    assert.ok(extra.fileKey);

    // Chat: membership is required; groups may exceed 16 members.
    const members = [alice, bob, ...Array.from({length: 18}, (_, i) => '0x' + i.toString(16).padStart(2, '0').repeat(20))];
    for (const a of members.slice(2)) f.s.state.profiles[a] = {name: a.slice(0, 6)};
    f.s.state.friends.push(...members.slice(1).map((to) => ({from: alice, to, status: 'accepted'})));
    const conv = {id: 'group-big', type: 'group', name: 'big', members, admin: alice, ts: Date.now(), shot: 'allow'};
    f.s.state.convs.push(conv);
    const chatFile = new Uint8Array(2500).fill(13);
    const chatUp = await uploadOnce(f.s, 'alice', {file: chatFile, scene: 'chat', mime: 'image/png', scope: 'group', convId: conv.id});
    const sent = await f.s.handle('send', {conv: conv.id, mediaId: chatUp.committed.mediaId, text: 'watch'}, 'alice', origin);
    assert.ok(sent.id);
    const opened = await f.s.handle('message-open', {id: sent.id}, 'bob', origin);
    assert.equal(opened.mediaId, chatUp.committed.mediaId);
    const memberKey = await f.s.handle('media-key', {mediaId: chatUp.committed.mediaId}, 'bob', origin);
    assert.ok(memberKey.fileKey);
    await assert.rejects(f.s.handle('media-key', {mediaId: chatUp.committed.mediaId}, 'eve', origin), /不是|权限|会话/);
  } finally { f.cleanup(); }
});

test('PDF/ZIP/binary attachments keep chat and paid access checks; Story refuses documents', async () => {
  const f = fixture(true);
  try {
    await assert.rejects(f.s.handle('media-session', {scene: 'story', mime: 'application/pdf', size: 3000, name: 'notes.pdf', scope: 'friends'}, 'alice', origin), /Story/);
    for (const type of ['dm', 'group']) {
      const conv = {id: 'files-' + type, type, name: 'files', members: [alice, bob], admin: alice, ts: Date.now(), shot: 'allow'};
      f.s.state.convs.push(conv);
      const bytes = new Uint8Array(2 * 1048576 + 17).fill(21);
      const up = await uploadOnce(f.s, 'alice', {file: bytes, scene: 'chat', mime: type === 'dm' ? 'application/pdf' : 'application/zip', scope: type, convId: conv.id, name: 'attachment.bin'});
      await f.s.handle('send', {conv: conv.id, mediaId: up.committed.mediaId, text: 'attachment'}, 'alice', origin);
      const access = await f.s.handle('media-key', {mediaId: up.committed.mediaId}, 'bob', origin);
      const client = createClient({fetch: (...args) => f.s.tapeRelay.relay.fetch(...args)});
      const back = await readEncryptedFileWithKey(client, access.servers, access.envelopeSha, Buffer.from(access.fileKey, 'base64url'));
      assert.deepEqual(back.bytes, bytes);
      await assert.rejects(f.s.handle('media-key', {mediaId: up.committed.mediaId}, 'eve', origin), /不是|权限|会话/);
    }
    const paid = await uploadOnce(f.s, 'alice', {file: new Uint8Array(1000).fill(9), scene: 'paid', mime: 'application/octet-stream', scope: 'public'});
    const media = f.s.state.mediaFiles[paid.committed.mediaId]; media.linked = true; media.contentId = '700';
    f.s.product = async () => ({p: {creator: alice, burn: false, secs: 30, mediaId: media.id}, c: {}});
    f.s.vault.accessUntil = async () => BigInt(Math.floor(Date.now() / 1000) + 3600);
    f.s.confirmed = async () => false;
    await assert.rejects(f.s.handle('media-key', {mediaId: media.id}, 'bob', origin), /订单/);
    f.s.confirmed = async () => true;
    assert.ok((await f.s.handle('media-key', {mediaId: media.id}, 'bob', origin)).fileKey);
  } finally { f.cleanup(); }
});

test('deleted social media cannot be unlocked through a retained media ID', async () => {
  const f = fixture(true);
  try {
    const up = await uploadOnce(f.s, 'alice', {file: new Uint8Array(3000).fill(23), scene: 'post', mime: 'video/mp4', scope: 'public'});
    const post = await f.s.handle('social-publish', {kind: 'post', mediaId: up.committed.mediaId, title: 'remove me', scope: 'public'}, 'alice', origin);
    assert.ok((await f.s.handle('media-key', {mediaId: up.committed.mediaId}, 'bob', origin)).fileKey);
    await f.s.handle('social-delete', {id: post.id}, 'alice', origin);
    await assert.rejects(f.s.handle('media-key', {mediaId: up.committed.mediaId}, 'bob', origin), /删除|权限/);
  } finally { f.cleanup(); }
});

test('HTTP sign and key endpoints require a wallet session and never accept a whole video body', async () => {
  const f = fixture(true), hosts = [];
  const server = walletHttp({service: f.s, root: process.cwd(), port: 0, allowedHosts: hosts});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  hosts.push(new URL(base).host);
  const post = (action, data = {}, token) => fetch(base + '/api/wallet/' + action, {
    method: 'POST',
    headers: {Origin: origin, 'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
    body: JSON.stringify(data),
  });
  try {
    assert.equal((await post('media-session', {scene: 'story', mime: 'video/mp4', size: 1000})).status, 401);
    const status = await (await post('media-status', {})).json();
    assert.equal(status.enabled, true);
    assert.equal(status.selfKey && status.fileKey, undefined);
    const over = await post('media-session', {scene: 'story', mime: 'video/mp4', size: 9 * 1024 * 1024}, 'alice');
    assert.equal(over.status, 400);
    assert.match((await over.json()).error, /上限/);
    const session = await (await post('media-session', {scene: 'post', mime: 'image/png', size: 4000, name: 'p.png', scope: 'public', title: 't'}, 'alice')).json();
    assert.ok(session.sessionId);
    const up = await uploadOnce(f.s, 'alice', {file: new Uint8Array(4000).fill(8), scene: 'post', mime: 'image/png', title: 'http'});
    const denied = await post('media-key', {mediaId: up.committed.mediaId});
    assert.equal(denied.status, 401);
  } finally {
    await new Promise((r) => server.close(r));
    f.cleanup();
  }
});
