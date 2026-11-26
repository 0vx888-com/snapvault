import {mediaCommitProof} from '../web/taperelay-file-id.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readdirSync, statSync, existsSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WalletService} from '../server/wallet-service.mjs';
import {DEFAULT_USER_QUOTA} from '../server/taperelay-media.mjs';
import {
  planEncryptedFile,
  uploadToServers,
  createClient,
  remoteAuth,
  generateKeyPair,
} from '../vendor/taperelay-client/src/taperelay.mjs';

const alice = '0x' + '11'.repeat(20);
const origin = 'http://persist.test';
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(1200).fill(7)]);

function treeFiles(root) {
  const out = [];
  const walk = (dir, prefix = '') => {
    for (const name of readdirSync(dir)) {
      const rel = prefix ? prefix + '/' + name : name;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, rel);
      else out.push({rel, size: st.size});
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

function fixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sv-trpersist-'));
  const service = new WalletService({
    dir, origins: [origin], allowLocalKeyFile: true, operator: {address: alice},
    provider: {getNetwork: async () => ({chainId: 31337})},
    vault: {target: '0x' + '44'.repeat(20), interface: {fragments: []}, feeBps: async () => 1000, contents: () => { throw Error('No chain operation allowed'); }},
  });
  service.state.profiles = {[alice]: {name: 'Alice', creator: true}};
  service.state.assets = {legacy: {key: 'old', blob: 'cG5n', mime: 'image/png'}};
  service.sessions.set('alice', {account: alice, origin, until: Date.now() + 60_000});
  if (overrides.enabled) service.configureTapeRelayMedia(overrides);
  return {s: service, dir, cleanup: () => rmSync(dir, {recursive: true, force: true})};
}

test('feature-off boot keeps old assets and does not store object bytes on the data dir', () => {
  const {s, dir, cleanup} = fixture();
  try {
    assert.equal(s.mediaEnabled(), false);
    assert.deepEqual(s.state.mediaFiles, {});
    assert.deepEqual(s.state.mediaSessions, {});
    assert.equal(s.state.assets.legacy.blob, 'cG5n');
    s.save();
    const files = treeFiles(dir);
    assert.ok(files.some((f) => f.rel === 'state.enc'));
    const unexpected = files.filter((f) => f.rel !== 'state.enc' && f.rel !== 'master.key' && !f.rel.startsWith('view-ledger'));
    assert.deepEqual(unexpected, []);
    assert.ok(files.every((f) => f.size < 64 * 1024), 'feature-off state must stay metadata-sized');
  } finally { cleanup(); }
});

test('mock ciphertext stays in the in-memory Map; Railway-style data dir only keeps metadata; extra keys remain loadable', async () => {
  const {s, dir, cleanup} = fixture({enabled: true, mode: 'mock', maxBytes: 8 * 1024 * 1024});
  try {
    const session = await s.handle('media-session', {scene: 'story', mime: 'image/png', size: png.length, name: 'clip.png', scope: 'public'}, 'alice', origin);
    const selfKey = Buffer.from(session.selfKey, 'base64url');
    const ephemeral = generateKeyPair();
    const plan = await planEncryptedFile(png, {name: 'clip.png', contentType: 'image/png', from: session.circuit, selfKey, to: [ephemeral.publicKey]});
    const client = createClient({fetch: (...args) => s.tapeRelay.relay.fetch(...args)});
    const auth = remoteAuth({
      account: session.circuit,
      endpoint: 'https://persist.test/api/wallet/media-sign',
      headers: {Authorization: 'Bearer alice'},
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        body.sessionId = session.sessionId;
        const result = await s.handle('media-sign', body, 'alice', origin);
        return new Response(JSON.stringify(result), {status: 200, headers: {'Content-Type': 'application/json'}});
      },
    });
    const up = await uploadToServers(client, session.servers, auth, null, {plan, retryMs: []});
    assert.equal(up.stored, true);
    await s.handle('media-commit', {
      sessionId: session.sessionId,
      envelopeSha: plan.envelope.sha256,
      fileId: plan.fileId,
      manifestJson: plan.manifestJson,
    commitProof: await mediaCommitProof(plan.fileKey, session.sessionId, plan.envelope.sha256, plan.fileId),
    }, 'alice', origin);
    plan.dispose();

    const objectBytes = [...s.tapeRelay.relay.objects.values()].reduce((n, buf) => n + buf.length, 0);
    assert.ok(objectBytes > png.length, 'ciphertext objects exist in the mock Map');
    const files = treeFiles(dir);
    const objectSizes = new Set([...s.tapeRelay.relay.objects.values()].map((buf) => buf.length));
    assert.ok(files.every((f) => !objectSizes.has(f.size)), 'no data-dir file matches a stored object length');
    assert.ok(files.every((f) => f.rel === 'state.enc' || f.rel === 'master.key' || f.rel.startsWith('view-ledger')));
    const media = Object.values(s.state.mediaFiles);
    assert.equal(media.length, 1);
    assert.equal(media[0].size, png.length);
    assert.equal(DEFAULT_USER_QUOTA, 1024 * 1024 * 1024);
    const used = Object.values(s.state.mediaFiles).reduce((n, m) => n + (m.size || 0), 0);
    assert.equal(used, png.length, 'quota accounts logical size, not Railway volume occupancy');

    // A pre-feature loader that ignores unknown keys must still see legacy assets.
    const {mediaFiles, mediaSessions, ...legacy} = s.state;
    assert.ok(mediaFiles && mediaSessions);
    assert.equal(legacy.assets.legacy.blob, 'cG5n');
    assert.equal(legacy.profiles[alice].name, 'Alice');
  } finally { cleanup(); }
});

test('live _loadObject reads official getObject and never writeFile to the data dir', () => {
  const src = readFileSync(new URL('../server/taperelay-media.mjs', import.meta.url), 'utf8');
  const start = src.indexOf('async _loadObject(sha) {');
  assert.ok(start >= 0);
  const end = src.indexOf('\n    },', start);
  assert.ok(end > start);
  const fn = src.slice(start, end);
  assert.match(fn, /client\.getObject\(server, sha\)/);
  assert.doesNotMatch(fn, /writeFile|mkdirSync|this\.dir/);
  assert.match(fn, /objects\.get\(sha\)/);
});
