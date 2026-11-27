import {mediaCommitProof} from '../web/taperelay-file-id.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWriteStream, openAsBlob, rmSync, utimesSync, mkdtempSync} from 'node:fs';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WalletService} from '../server/wallet-service.mjs';
import {DEFAULT_MAX_BYTES} from '../server/taperelay-media.mjs';
import {
  sourceFromBytes,
  hashReadableSource,
  findResumeJob,
  resumeJobMatches,
  metadataCollides,
} from '../web/taperelay-file-id.js';
import {
  planEncryptedFile,
  planEncryptedResume,
  resumableOf,
  generateKeyPair,
  uploadToServers,
  createClient,
  remoteAuth,
  openEncryptedFileWithKey,
} from '../vendor/taperelay-client/src/taperelay.mjs';

const origin = 'http://large-media.test';
const alice = '0x' + '11'.repeat(20);
const LARGE_BYTES = Number(process.env.TAPERELAY_LARGE_TEST_BYTES) || (DEFAULT_MAX_BYTES - 8192);
const CIRCUIT = '1.2.0';

async function writePatternFile(path, size, seed) {
  const out = createWriteStream(path);
  const chunk = Buffer.alloc(Math.min(1048576, size));
  let written = 0;
  let n = seed >>> 0;
  while (written < size) {
    const take = Math.min(chunk.length, size - written);
    for (let i = 0; i < take; i++) {
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
      chunk[i] = n & 255;
    }
    if (!out.write(chunk.subarray(0, take))) await once(out, 'drain');
    written += take;
  }
  out.end();
  await once(out, 'finish');
}

function instrumentBlob(blob, stats) {
  const meta = {name: blob.name, type: blob.type, lastModified: blob.lastModified};
  return {
    get size() { return blob.size; },
    get name() { return meta.name; },
    set name(v) { meta.name = v; },
    get type() { return meta.type; },
    set type(v) { meta.type = v; },
    get lastModified() { return meta.lastModified; },
    set lastModified(v) { meta.lastModified = v; },
    arrayBuffer() { throw new Error('must not read the whole file into memory'); },
    slice(a, b) {
      const part = blob.slice(a, b);
      const size = part.size;
      return {
        size,
        slice: (x, y) => this.slice((a || 0) + (x || 0), y == null ? b : (a || 0) + y),
        arrayBuffer: async () => {
          stats.current += size;
          if (stats.current > stats.peak) stats.peak = stats.current;
          if (size > stats.maxSlice) stats.maxSlice = size;
          try {
            return await part.arrayBuffer();
          } finally {
            stats.current -= size;
          }
        },
      };
    },
  };
}

function persistable(plan, ephemeral, meta) {
  const saved = resumableOf(plan);
  return {
    sessionId: meta.sessionId,
    name: meta.name,
    byteSize: meta.byteSize,
    lastModified: meta.lastModified,
    account: meta.account,
    contentSha: meta.contentSha,
    envelope: saved.envelope,
    index: saved.index,
    nonces: saved.nonces,
    secretKey: ephemeral.secretKey.slice(),
    publicKey: ephemeral.publicKey.slice(),
  };
}

function asSaved(job) {
  return {envelope: job.envelope, index: job.index, nonces: job.nonces};
}

async function shaOf(data) {
  return hashReadableSource(sourceFromBytes(data));
}

function resumeFetcher(relay, {failAt = 0, abortAfter = 0, signal, posted} = {}) {
  const count = posted || {n: 0};
  return async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url, 'https://mock.snapvault.local:4246').pathname;
    if (method === 'POST' && path === '/v1/objects') {
      count.n++;
      if (signal?.aborted) return new Response('aborted', {status: 499});
      if (failAt && count.n === failAt) return new Response('injected interrupt', {status: 503});
      if (abortAfter && count.n === abortAfter) {
        signal.abort();
        return new Response('cancelled', {status: 499});
      }
    }
    return relay.fetch(url, init);
  };
}

test('name/size/mtime collisions must not resume a different file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sv-tr-collide-'));
  const pathA = join(dir, 'clip.bin');
  const pathB = join(dir, 'other.bin');
  const size = 3 * 1048576;
  const mtime = new Date('2026-11-25T12:00:00Z');
  try {
    await writePatternFile(pathA, size, 1);
    await writePatternFile(pathB, size, 99);
    utimesSync(pathA, mtime, mtime);
    utimesSync(pathB, mtime, mtime);
    const a = instrumentBlob(await openAsBlob(pathA), {current: 0, peak: 0, maxSlice: 0});
    const b = instrumentBlob(await openAsBlob(pathB), {current: 0, peak: 0, maxSlice: 0});
    a.name = 'clip.bin'; a.lastModified = mtime.getTime();
    b.name = 'clip.bin'; b.lastModified = mtime.getTime();
    const shaA = await shaOf(a);
    const shaB = await shaOf(b);
    assert.notEqual(shaA, shaB);
    const job = {
      name: 'clip.bin',
      byteSize: size,
      lastModified: mtime.getTime(),
      account: alice,
      contentSha: shaA,
      sessionId: 'tm_old',
    };
    const metaA = {name: 'clip.bin', byteSize: size, lastModified: mtime.getTime(), account: alice, contentSha: shaA};
    const metaB = {name: 'clip.bin', byteSize: size, lastModified: mtime.getTime(), account: alice, contentSha: shaB};
    assert.equal(metadataCollides(job, metaB), true);
    assert.equal(resumeJobMatches(job, metaB), false);
    assert.equal(findResumeJob([job], metaB), null);
    assert.equal(findResumeJob([job], metaA).sessionId, 'tm_old');
    assert.equal(findResumeJob([job], {...metaA, contentSha: ''}), null);
    assert.equal(findResumeJob([{...job, contentSha: undefined}], metaA), null);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('near-cap lazy file survives mid-upload interrupt, reload resume, and decrypts to the same hash', {timeout: 300000}, async () => {
  assert.ok(LARGE_BYTES > 100 * 1048576, 'large-file test must stay near the 200 MiB product cap');
  const dir = mkdtempSync(join(tmpdir(), 'sv-tr-large-'));
  const path = join(dir, 'near-cap.bin');
  const mem = {current: 0, peak: 0, maxSlice: 0};
  const resumedCalls = {planEncryptedResume: 0};
  try {
    await writePatternFile(path, LARGE_BYTES, 2026);
    const blob = instrumentBlob(await openAsBlob(path), mem);
    blob.name = 'near-cap.bin';
    blob.type = 'video/mp4';
    blob.lastModified = 1_700_000_000_000;
    const contentSha = await shaOf(blob);
    assert.equal(contentSha.length, 64);
    assert.ok(mem.peak < 8 * 1048576, 'hashing must stay chunked, peak=' + mem.peak);

    const service = new WalletService({
      dir: join(dir, 'svc'), origins: [origin], allowLocalKeyFile: true, operator: {address: alice},
      provider: {getNetwork: async () => ({chainId: 31337})},
      vault: {target: '0x' + '44'.repeat(20), interface: {fragments: []}, feeBps: async () => 1000, contents: () => { throw Error('No chain'); }},
    });
    service.sessions.set('alice', {account: alice, origin, until: Date.now() + 60_000});
    service.configureTapeRelayMedia({enabled: true, mode: 'mock', maxBytes: DEFAULT_MAX_BYTES});
    const session = await service.handle('media-session', {
      scene: 'story', mime: 'video/mp4', size: LARGE_BYTES, name: 'near-cap.mp4', scope: 'public', title: 'large',
    }, 'alice', origin);
    const selfKey = Buffer.from(session.selfKey, 'base64url');
    const ephemeral = generateKeyPair();
    const plan = await planEncryptedFile(blob, {name: 'near-cap.mp4', contentType: 'video/mp4', from: session.circuit, selfKey, to: [ephemeral.publicKey]});
    assert.ok(mem.peak < 8 * 1048576, 'planning must stay chunked, peak=' + mem.peak);

    const posted = {n: 0};
    const interrupted = await uploadToServers(
      createClient({fetch: resumeFetcher(service.tapeRelay.relay, {failAt: 12, posted})}),
      session.servers,
      remoteAuth({
        account: session.circuit,
        endpoint: 'https://large-media.test/api/wallet/media-sign',
        fetch: async (_url, init) => {
          const body = JSON.parse(init.body);
          body.sessionId = session.sessionId;
          try {
            const result = await service.handle('media-sign', body, 'alice', origin);
            return new Response(JSON.stringify(result), {status: 200, headers: {'Content-Type': 'application/json'}});
          } catch (err) {
            return new Response(JSON.stringify({error: err.message}), {status: err.status || 400, headers: {'Content-Type': 'application/json'}});
          }
        },
      }),
      null,
      {plan, retryMs: []},
    );
    assert.equal(interrupted.stored, false);
    assert.ok(posted.n >= 12, 'interrupt must happen after some objects have been sent');

    const diskJob = persistable(plan, ephemeral, {
      sessionId: session.sessionId,
      name: blob.name,
      byteSize: blob.size,
      lastModified: blob.lastModified,
      account: alice,
      contentSha,
    });
    plan.dispose();
    ephemeral.secretKey.fill(0);

    // Simulate page reload: only the persisted job remains, then the same lazy file is chosen again.
    const reloaded = instrumentBlob(await openAsBlob(path), mem);
    reloaded.name = 'near-cap.bin';
    reloaded.lastModified = 1_700_000_000_000;
    const reloadedSha = await shaOf(reloaded);
    const found = findResumeJob([diskJob], {
      name: reloaded.name,
      byteSize: reloaded.size,
      lastModified: reloaded.lastModified,
      account: alice,
      contentSha: reloadedSha,
    });
    assert.ok(found);
    resumedCalls.planEncryptedResume++;
    const keyPair = {secretKey: found.secretKey, publicKey: found.publicKey};
    const resumed = await planEncryptedResume(reloaded, {saved: asSaved(found), keyPairs: [keyPair]});
    const finished = await uploadToServers(
      createClient({fetch: resumeFetcher(service.tapeRelay.relay)}),
      session.servers,
      remoteAuth({
        account: session.circuit,
        endpoint: 'https://large-media.test/api/wallet/media-sign',
        fetch: async (_url, init) => {
          const body = JSON.parse(init.body);
          body.sessionId = session.sessionId;
          try {
            const result = await service.handle('media-sign', body, 'alice', origin);
            return new Response(JSON.stringify(result), {status: 200, headers: {'Content-Type': 'application/json'}});
          } catch (err) {
            return new Response(JSON.stringify({error: err.message}), {status: err.status || 400, headers: {'Content-Type': 'application/json'}});
          }
        },
      }),
      null,
      {plan: resumed, retryMs: []},
    );
    assert.equal(finished.stored, true);
    const committed = await service.handle('media-commit', {
      sessionId: session.sessionId,
      envelopeSha: resumed.envelope.sha256,
      fileId: resumed.fileId,
      manifestJson: resumed.manifestJson,
    commitProof: await mediaCommitProof(resumed.fileKey, session.sessionId, resumed.envelope.sha256, resumed.fileId),
    }, 'alice', origin);
    const issued = await service.handle('media-key', {mediaId: committed.mediaId}, 'alice', origin);
    const fileKey = Buffer.from(issued.fileKey, 'base64url');
    issued.fileKey = '';
    const opened = await openEncryptedFileWithKey(
      createClient({fetch: (...args) => service.tapeRelay.relay.fetch(...args)}),
      issued.servers,
      issued.envelopeSha,
      fileKey,
      {cacheChunks: 1},
    );
    fileKey.fill(0);
    try {
      const plainSha = await hashReadableSource({size: opened.manifest.size, read: (a, b) => opened.read(a, b)});
      assert.equal(plainSha, contentSha);
    } finally {
      opened.close();
    }
    assert.ok(mem.peak < 8 * 1048576, 'resume/decrypt must stay chunked, peak=' + mem.peak);
    assert.equal(resumedCalls.planEncryptedResume, 1);
    resumed.dispose();
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('a colliding same-meta file must not reuse the old nonce plan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sv-tr-nonce-'));
  const pathA = join(dir, 'a.bin');
  const pathB = join(dir, 'b.bin');
  const size = 2 * 1048576;
  const mtime = new Date('2026-11-25T15:00:00Z');
  try {
    await writePatternFile(pathA, size, 7);
    await writePatternFile(pathB, size, 8);
    utimesSync(pathA, mtime, mtime);
    utimesSync(pathB, mtime, mtime);
    const a = await openAsBlob(pathA);
    const b = await openAsBlob(pathB);
    a.name = 'clip.bin'; a.lastModified = mtime.getTime();
    b.name = 'clip.bin'; b.lastModified = mtime.getTime();
    const selfKey = generateKeyPair().publicKey;
    const ephemeral = generateKeyPair();
    const plan = await planEncryptedFile(a, {name: 'clip.bin', contentType: 'application/octet-stream', from: CIRCUIT, selfKey, to: [ephemeral.publicKey]});
    const job = persistable(plan, ephemeral, {
      sessionId: 'tm_collision',
      name: 'clip.bin',
      byteSize: size,
      lastModified: mtime.getTime(),
      account: alice,
      contentSha: await shaOf(a),
    });
    plan.dispose();
    const found = findResumeJob([job], {
      name: 'clip.bin',
      byteSize: size,
      lastModified: mtime.getTime(),
      account: alice,
      contentSha: await shaOf(b),
    });
    assert.equal(found, null);
    await assert.rejects(
      planEncryptedResume(b, {saved: asSaved(job), keyPairs: [{secretKey: job.secretKey, publicKey: job.publicKey}]}),
      /resume-mismatch|接不上/,
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('cancel aborts mid-upload and quota rejects a near-cap session', {timeout: 180000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sv-tr-cancel-'));
  const path = join(dir, 'cancel.bin');
  const size = 8 * 1048576;
  try {
    await writePatternFile(path, size, 3);
    const blob = await openAsBlob(path);
    const service = new WalletService({
      dir: join(dir, 'svc'), origins: [origin], allowLocalKeyFile: true, operator: {address: alice},
      provider: {getNetwork: async () => ({chainId: 31337})},
      vault: {target: '0x' + '44'.repeat(20), interface: {fragments: []}, feeBps: async () => 1000, contents: () => { throw Error('No chain'); }},
    });
    service.sessions.set('alice', {account: alice, origin, until: Date.now() + 60_000});
    service.configureTapeRelayMedia({enabled: true, mode: 'mock', maxBytes: DEFAULT_MAX_BYTES, userQuota: 1024});
    await assert.rejects(service.handle('media-session', {
      scene: 'story', mime: 'video/mp4', size: LARGE_BYTES, name: 'near-cap.mp4', scope: 'public', title: 'quota',
    }, 'alice', origin), /配额|上限|quota|容量/i);
    service.configureTapeRelayMedia({enabled: true, mode: 'mock', maxBytes: DEFAULT_MAX_BYTES});
    const openSession = await service.handle('media-session', {
      scene: 'story', mime: 'video/mp4', size, name: 'cancel.mp4', scope: 'public', title: 'cancel',
    }, 'alice', origin);
    const selfKey = Buffer.from(openSession.selfKey, 'base64url');
    const ephemeral = generateKeyPair();
    const plan = await planEncryptedFile(blob, {name: 'cancel.mp4', contentType: 'video/mp4', from: openSession.circuit, selfKey, to: [ephemeral.publicKey]});
    const ac = new AbortController();
    const posted = {n: 0};
    const result = await uploadToServers(
      createClient({fetch: resumeFetcher(service.tapeRelay.relay, {abortAfter: 6, signal: ac, posted})}),
      openSession.servers,
      remoteAuth({
        account: openSession.circuit,
        endpoint: 'https://large-media.test/api/wallet/media-sign',
        fetch: async (_url, init) => {
          const body = JSON.parse(init.body);
          body.sessionId = openSession.sessionId;
          try {
            const result = await service.handle('media-sign', body, 'alice', origin);
            return new Response(JSON.stringify(result), {status: 200, headers: {'Content-Type': 'application/json'}});
          } catch (err) {
            return new Response(JSON.stringify({error: err.message}), {status: err.status || 400, headers: {'Content-Type': 'application/json'}});
          }
        },
      }),
      null,
      {plan, retryMs: [], signal: ac.signal},
    );
    assert.equal(result.stored, false);
    assert.ok(posted.n >= 6);
    assert.equal(ac.signal.aborted, true);
    plan.dispose();
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
