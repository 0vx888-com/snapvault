import {mediaCommitProof} from '../web/taperelay-file-id.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getAddress} from 'ethers';
import {WalletService} from '../server/wallet-service.mjs';
import {walletHttp} from '../server/wallet-http.mjs';
import {
  planEncryptedFile,
  generateKeyPair,
  uploadToServers,
  createClient,
  remoteAuth,
} from '../vendor/taperelay-client/src/taperelay.mjs';

const origin = 'http://media-story.test';
const alice = '0x' + '11'.repeat(20);
const bob = '0x' + '22'.repeat(20);
const eve = '0x' + '33'.repeat(20);

function fixture({friends, profiles, extra} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sv-tr-story-'));
  const service = new WalletService({
    dir, origins: [origin], allowLocalKeyFile: true, operator: {address: alice},
    provider: {getNetwork: async () => ({chainId: 31337})},
    vault: {target: '0x' + '44'.repeat(20), interface: {fragments: []}, feeBps: async () => 1000, contents: () => { throw Error('No chain operation allowed'); }},
  });
  service.state.profiles = profiles || {[alice]: {name: 'Alice'}, [bob]: {name: 'Bob'}, [eve]: {name: 'Eve'}};
  service.state.friends = friends || [{from: alice, to: bob, status: 'accepted'}];
  service.sessions.set('alice', {account: alice, origin, until: Date.now() + 60_000});
  service.sessions.set('bob', {account: bob, origin, until: Date.now() + 60_000});
  service.sessions.set('eve', {account: eve, origin, until: Date.now() + 60_000});
  service.configureTapeRelayMedia({enabled: true, mode: 'mock', maxBytes: 8 * 1024 * 1024, ...extra});
  return {s: service, dir, cleanup: () => rmSync(dir, {recursive: true, force: true})};
}

async function uploadStory(service, token, file, {scope = 'friends', title = 'friends video story'} = {}) {
  const mime = file.type || 'video/mp4';
  const name = file.name || 'story.mp4';
  const session = await service.handle('media-session', {scene: 'story', mime, size: file.size ?? file.length, name, scope, title}, token, origin);
  const selfKey = Buffer.from(session.selfKey, 'base64url');
  const ephemeral = generateKeyPair();
  const plan = await planEncryptedFile(file, {name, contentType: mime, from: session.circuit, selfKey, to: [ephemeral.publicKey]});
  const client = createClient({fetch: (...args) => service.tapeRelay.relay.fetch(...args)});
  const auth = remoteAuth({
    account: session.circuit,
    endpoint: 'https://media-story.test/api/wallet/media-sign',
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
  const published = await service.handle('social-publish', {kind: 'story', scope, mediaId: committed.mediaId, title}, token, origin);
  return {session, committed, published};
}

function noSecrets(obj) {
  const raw = JSON.stringify(obj);
  for (const key of ['fileKey', 'secretKey', 'privateKey', 'encryptedKey', '#k=', '#ks=']) {
    assert.equal(raw.includes(key), false, 'must not leak ' + key);
  }
}

test('Alice friends-only media Story is listed and keyed for Bob, hidden and key-denied for Eve', async () => {
  const f = fixture();
  try {
    const file = new Blob([Uint8Array.from({length: 4096}, (_, i) => (i * 17) & 255)], {type: 'video/mp4'});
    file.name = 'clip.mp4';
    const {committed, published} = await uploadStory(f.s, 'alice', file);
    assert.ok(published.id.startsWith('story_'));
    assert.equal(f.s.state.profiles[alice].creator, true);

    const aliceState = await f.s.handle('social-state', {}, 'alice', origin);
    const bobState = await f.s.handle('social-state', {}, 'bob', origin);
    const eveState = await f.s.handle('social-state', {}, 'eve', origin);
    noSecrets(aliceState); noSecrets(bobState); noSecrets(eveState);
    assert.equal(aliceState.stories.length, 1);
    assert.equal(bobState.stories.length, 1);
    assert.equal(bobState.stories[0].id, published.id);
    assert.equal(bobState.stories[0].media, true);
    assert.equal(eveState.stories.length, 0);
    assert.equal(eveState.posts.length, 0);

    const bobOpen = await f.s.handle('social-open', {id: published.id}, 'bob', origin);
    noSecrets(bobOpen);
    assert.equal(bobOpen.mediaId, committed.mediaId);
    const bobKey = await f.s.handle('media-key', {mediaId: committed.mediaId}, 'bob', origin);
    assert.ok(bobKey.fileKey);
    bobKey.fileKey = '';

    await assert.rejects(f.s.handle('social-open', {id: published.id}, 'eve', origin), /权限|不存在/);
    await assert.rejects(f.s.handle('media-key', {mediaId: committed.mediaId}, 'eve', origin), /权限|不存在/);
  } finally {
    f.cleanup();
  }
});

test('mixed-case friend records still authorize Bob and still deny Eve, permissions stay fail-closed', async () => {
  const mixedAlice = '0xA1B2C3D4E5F60718293A4B5C6D7E8F9012345678';
  const mixedBob = '0xB1C2D3E4F5061718293A4B5C6D7E8F9012345678';
  const mixedEve = '0xC1D2E3F405161718293A4B5C6D7E8F9012345678';
  const a = getAddress(mixedAlice).toLowerCase();
  const b = getAddress(mixedBob).toLowerCase();
  const e = getAddress(mixedEve).toLowerCase();
  const f = fixture({
    profiles: {[a]: {name: 'Alice'}, [b]: {name: 'Bob'}, [e]: {name: 'Eve'}},
    friends: [{from: mixedAlice, to: mixedBob, status: 'accepted'}],
  });
  f.s.sessions.set('alice', {account: a, origin, until: Date.now() + 60_000});
  f.s.sessions.set('bob', {account: b, origin, until: Date.now() + 60_000});
  f.s.sessions.set('eve', {account: e, origin, until: Date.now() + 60_000});
  try {
    const file = new Blob([Uint8Array.from({length: 2048}, (_, i) => i & 255)], {type: 'video/mp4'});
    file.name = 'mix.mp4';
    const {committed, published} = await uploadStory(f.s, 'alice', file);
    assert.equal((await f.s.handle('social-state', {}, 'bob', origin)).stories.map((s) => s.id).join(), published.id);
    assert.equal((await f.s.handle('social-state', {}, 'eve', origin)).stories.length, 0);
    const key = await f.s.handle('media-key', {mediaId: committed.mediaId}, 'bob', origin);
    assert.ok(key.fileKey);
    await assert.rejects(f.s.handle('media-key', {mediaId: committed.mediaId}, 'eve', origin), /权限|不存在/);
  } finally {
    f.cleanup();
  }
});

test('HTTP path: Bob sees and unlocks Alice media Story, Eve is denied even with the mediaId', async () => {
  const f = fixture();
  const hosts = [];
  const server = walletHttp({service: f.s, root: process.cwd(), port: 0, allowedHosts: hosts});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  hosts.push(new URL(base).host);
  const request = (action, data, token) => fetch(base + '/api/wallet/' + action, {
    method: 'POST',
    headers: {Origin: origin, 'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
    body: JSON.stringify(data),
  });
  try {
    const file = new Blob([Uint8Array.from({length: 3072}, (_, i) => (i * 9) & 255)], {type: 'video/mp4'});
    file.name = 'http.mp4';
    const {committed, published} = await uploadStory(f.s, 'alice', file);
    const bobState = await (await request('social-state', {}, 'bob')).json();
    const eveState = await (await request('social-state', {}, 'eve')).json();
    noSecrets(bobState); noSecrets(eveState);
    assert.equal(bobState.stories.length, 1);
    assert.equal(bobState.stories[0].id, published.id);
    assert.equal(eveState.stories.length, 0);
    const bobOpen = await request('social-open', {id: published.id}, 'bob');
    assert.equal(bobOpen.status, 200);
    const opened = await bobOpen.json();
    noSecrets(opened);
    assert.equal(opened.mediaId, committed.mediaId);
    const bobKey = await request('media-key', {mediaId: committed.mediaId}, 'bob');
    assert.equal(bobKey.status, 200);
    assert.ok((await bobKey.json()).fileKey);
    assert.equal((await request('social-open', {id: published.id}, 'eve')).status, 404);
    assert.equal((await request('media-key', {mediaId: committed.mediaId}, 'eve')).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
    f.cleanup();
  }
});
