import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMediaSettings, installTapeRelayMedia} from '../server/taperelay-media.mjs';
import {createDeveloperKey, keyWallet, newPrivateKey, planEncryptedFile, openEnvelope} from '../vendor/taperelay-client/src/taperelay.mjs';

const circuit = '1408.2.265.tape';
const servers = ['relay1.taperelay.com:4246', 'relay4.taperelay.com:4246', 'relay5.taperelay.com:4246'];
const now = Math.floor(Date.now() / 1000);
// Synthetic local delegation; never a production credential and never sent to nodes.
async function envFor({scopes = ['objects'], start = now, days = 90} = {}) {
  const {key} = await createDeveloperKey({wallet: keyWallet(newPrivateKey()), account: circuit, servers, scopes, now: start, days});
  return {TAPERELAY_MEDIA_ENABLED: '1', TAPERELAY_MEDIA_MODE: 'live', TAPERELAY_DEV_KEY: key,
    TAPERELAY_CIRCUIT: circuit, TAPERELAY_SERVERS: servers.join(','), TAPERELAY_SELF_SECRET: '11'.repeat(32)};
}

test('live configuration refuses missing, malformed and noncanonical persistent secrets', async () => {
  const env = await envFor();
  for (const secret of ['', 'abc', 'z'.repeat(64), Buffer.alloc(31).toString('base64'), 'A'.repeat(43) + 'x']) {
    const result = loadMediaSettings({...env, TAPERELAY_SELF_SECRET: secret});
    assert.equal(result.enabled, false);
    assert.equal(result.mode, 'off');
    assert.match(result.liveError, /TAPERELAY_SELF_SECRET/);
    assert.equal(result._devKey, '');
  }
  assert.equal(loadMediaSettings(env).mode, 'live');
  assert.equal(loadMediaSettings({...env, TAPERELAY_SELF_SECRET: Buffer.alloc(32, 17).toString('base64')}).mode, 'live');
  assert.equal(loadMediaSettings({...env, TAPERELAY_MEDIA_ENABLED: '0'}).mode, 'off');
});

test('live configuration binds circuit, node set, permissions and delegation lifetime', async () => {
  const env = await envFor();
  const wrong = [
    {...env, TAPERELAY_CIRCUIT: '1.2.0'},
    {...env, TAPERELAY_SERVERS: 'relay2.taperelay.com:4246'},
    {...env, TAPERELAY_SERVERS: servers.concat(servers[0]).join(',')},
    await envFor({scopes: ['send']}),
    await envFor({start: now - 3 * 86400, days: 1}),
    await envFor({start: now + 86400}),
  ];
  for (const input of wrong) {
    const result = loadMediaSettings(input);
    assert.equal(result.mode, 'off');
    assert.ok(result.liveError);
  }
});

test('separate service starts with the persisted secret can open the same envelope', async () => {
  const env = await envFor();
  class Service { constructor() { this.state = {}; this.policy = {}; } }
  installTapeRelayMedia(Service);
  const settings = {enabled: true, mode: 'live', devKey: env.TAPERELAY_DEV_KEY, circuit, servers, selfSecret: env.TAPERELAY_SELF_SECRET};
  const first = new Service(); first.initTapeRelayMedia(settings);
  const plan = await planEncryptedFile(new Uint8Array([1, 2, 3]), {name: 'restart.bin', contentType: 'application/octet-stream', from: circuit, selfKey: first.tapeRelay.keyPair.publicKey});
  const restarted = new Service(); restarted.initTapeRelayMedia(settings);
  assert.deepEqual(restarted.tapeRelay.keyPair.publicKey, first.tapeRelay.keyPair.publicKey);
  const opened = openEnvelope(plan.envelope.bytes, [restarted.tapeRelay.keyPair]);
  assert.equal(opened.manifest.size, 3);
  opened.fileKey.fill(0); plan.dispose();
  assert.throws(() => first.configureTapeRelayMedia({...settings, selfSecret: '22'.repeat(32)}), /更换/);
  const status = restarted.mediaStatus();
  assert.equal(status.enabled, true);
  assert.equal(JSON.stringify(status).includes(env.TAPERELAY_SELF_SECRET), false);
  assert.equal(JSON.stringify(status).includes(env.TAPERELAY_DEV_KEY), false);
});
