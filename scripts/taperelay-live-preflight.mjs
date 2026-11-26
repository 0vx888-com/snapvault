// Local operator check. Reads credentials only from the private directory; never logs them.
// No wallet transactions, deployment, production feature flags, or paid quota purchases.
import {readFileSync, statSync, mkdtempSync, openSync, closeSync, writeSync, openAsBlob, rmSync} from 'node:fs';
import {createHash, randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient, describeDeveloperKey, developerKeyAuth, serversOfKey, planEncryptedFile, planEncryptedResume, resumableOf, generateKeyPair, publicKeyOf, openEnvelope, uploadToServers, openEncryptedFileWithKey} from '../vendor/taperelay-client/src/taperelay.mjs';
import {loadMediaSettings} from '../server/taperelay-media.mjs';

try {
  const folder = join(homedir(), 'Library', 'Application Support', 'SnapVault', 'secrets');
  const file = join(folder, 'taperelay.env');
  const secretFile = join(folder, 'taperelay-self-secret');
  for (const path of [file, secretFile]) {
    if ((statSync(path).mode & 0o777) !== 0o600) throw Error('credential-file-permissions');
  }
  const raw = readFileSync(file, 'utf8');
  const match = /^TAPERELAY_KEY=(trk1_[A-Za-z0-9_-]+)\s*$/m.exec(raw);
  if (!match) throw Error('credential-file-format');
  const developerKey = match[1];
  const selfSecret = readFileSync(secretFile, 'utf8').trim();
  const description = describeDeveloperKey(developerKey);
  const servers = serversOfKey(developerKey);
  const settings = loadMediaSettings({TAPERELAY_MEDIA_ENABLED: '0', TAPERELAY_MEDIA_MODE: 'live',
    TAPERELAY_DEV_KEY: developerKey, TAPERELAY_SELF_SECRET: selfSecret,
    TAPERELAY_CIRCUIT: '1408.2.265.tape', TAPERELAY_SERVERS: servers.join(',')});
  if (!settings.liveConfigured || description.account !== '1408.2.265.tape') throw Error('credential-configuration');
  const expected = ['relay1.taperelay.com:4246', 'relay4.taperelay.com:4246', 'relay5.taperelay.com:4246'];
  if (servers.length !== 3 || expected.some((s) => !servers.includes(s))) throw Error('unexpected-nodes');
  const client = createClient({timeoutMs: 20000});
  const auth = developerKeyAuth(developerKey);
  console.log(JSON.stringify({phase: 'local-configuration', valid: true, productionEnabled: false,
    circuit: description.account, servers, scopes: description.scopes, expires: new Date(description.expires * 1000).toISOString()}));
  const result = await Promise.allSettled(servers.map(async (server) => {
    const info = await client.info(server);
    const usage = await client.request(server, {path: '/v1/usage/' + auth.account, auth});
    return {server, acceptsEncrypted: info.acceptsEncrypted, usage: usage.json};
  }));
  for (let i = 0; i < result.length; i++) {
    const r = result[i];
    console.log(JSON.stringify(r.status === 'fulfilled' ? {phase: 'authenticated-usage', ...r.value}
      : {phase: 'authenticated-usage', server: servers[i], ok: false, code: /^[a-z0-9-]{1,64}$/.test(r.reason?.code) ? r.reason.code : 'request-failed'}));
  }
  if (result.some((r) => r.status !== 'fulfilled')) process.exitCode = 1;
  if (process.argv.includes('--transfer-test') && !process.exitCode) {
    const size = Number(process.env.SNAPVAULT_SYNTHETIC_TEST_BYTES || 3 * 1048576 + 123);
    if (!Number.isSafeInteger(size) || size < 1048576 || size > 200 * 1048576) throw Error('test-size');
    for (const r of result) {
      const usage = r.value.usage;
      if (!Number.isSafeInteger(usage.storedBytes) || usage.quota?.storageBytes - usage.storedBytes < size * 2 + 1048576) throw Error('insufficient-existing-quota');
    }
    const dir = mkdtempSync(join(tmpdir(), 'snapvault-tr-live-'));
    let plan, resumed;
    try {
      const file = join(dir, 'synthetic.bin');
      const fd = openSync(file, 'wx', 0o600), expectedHash = createHash('sha256');
      try {
        for (let at = 0; at < size; at += 1048576) {
          const chunk = randomBytes(Math.min(1048576, size - at));
          writeSync(fd, chunk); expectedHash.update(chunk);
        }
      } finally { closeSync(fd); }
      const blob = await openAsBlob(file, {type: 'application/octet-stream'});
      const self = {secretKey: Buffer.from(selfSecret, 'hex')}; self.publicKey = publicKeyOf(self.secretKey);
      const ephemeral = generateKeyPair();
      plan = await planEncryptedFile(blob, {name: 'SnapVault synthetic transport test.bin', contentType: blob.type,
        from: auth.account, selfKey: self.publicKey, to: [ephemeral.publicKey]});
      const stop = new AbortController();
      const partial = await uploadToServers(client, servers, auth, null, {plan, signal: stop.signal, retryMs: [], onProgress: () => stop.abort()});
      await partial.settled;
      assert.equal(partial.stored, false);
      console.log(JSON.stringify({phase: 'real-node-interruption', bytes: size, stored: false, cancellationObserved: stop.signal.aborted}));
      const saved = resumableOf(plan);
      resumed = await planEncryptedResume(blob, {saved, keyPairs: [ephemeral]});
      assert.equal(resumed.envelope.sha256, plan.envelope.sha256);
      const done = await uploadToServers(client, servers, auth, null, {plan: resumed, retryMs: [],
        onProgress: ({server, done, total}) => { if (done % 25 === 0 || done === total) console.log(JSON.stringify({phase: 'transfer-progress', server, done, total})); }});
      const final = await done.settled;
      assert.equal(done.stored, true);
      assert.equal(final.ok.length, 3);
      const key = openEnvelope(resumed.envelope.bytes, [self]);
      const expected = expectedHash.digest('hex');
      for (const server of servers) {
        const opened = await openEncryptedFileWithKey(client, [server], resumed.envelope.sha256, key.fileKey);
        const actualHash = createHash('sha256');
        try {
          for (let at = 0; at < size; at += 1048576) actualHash.update(await opened.read(at, Math.min(size, at + 1048576)));
          assert.equal(actualHash.digest('hex'), expected);
        } finally { opened.close(); }
        console.log(JSON.stringify({phase: 'real-node-decryption', server, bytes: size, sha256Matched: true}));
      }
      key.fileKey.fill(0); self.secretKey.fill(0); ephemeral.secretKey.fill(0);
      console.log(JSON.stringify({phase: 'real-node-transfer-complete', bytes: size, replicas: 3, resumeVerified: true, mediaPlaybackTested: false}));
    } finally {
      plan?.dispose(); resumed?.dispose(); rmSync(dir, {recursive: true, force: true});
    }
  }
} catch {
  console.error('Live preflight stopped; no credential values are printed.');
  process.exitCode = 1;
}
