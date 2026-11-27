import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockRelay} from '../server/taperelay-mock.mjs';
import {
  planEncryptedFile,
  planEncryptedResume,
  resumableOf,
  generateKeyPair,
  uploadToServers,
  createClient,
  createRemoteSigner,
  keyWallet,
  newPrivateKey,
  signerOf,
  sha256Hex,
  remoteAuth,
  readEncryptedFileWithKey,
  openEnvelope,
  ENCRYPTED_CHUNK,
  parseDeveloperKey,
} from '../vendor/taperelay-client/src/taperelay.mjs';
import {loadMediaSettings, objectBudget} from '../server/taperelay-media.mjs';

const CIRCUIT = '1.2.0';
const SERVER = 'mock.snapvault.local:4246';

function header(headers, name) {
  const h = headers instanceof Headers ? headers : new Headers(headers);
  return h.get('TR-' + name) || h.get('tr-' + name);
}

function verifyingFetch(relay, expectedAddress) {
  return async (url, init = {}) => {
    const u = new URL(url, 'https://mock.snapvault.local:4246');
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return relay.fetch(u.href, init);
    const headers = new Headers(init.headers || {});
    const account = header(headers, 'Account');
    const timestamp = Number(header(headers, 'Timestamp'));
    const nonceHeader = header(headers, 'Nonce');
    const signature = header(headers, 'Signature');
    if (!account || !signature || !nonceHeader || !Number.isFinite(timestamp)) {
      return new Response('missing official request headers', {status: 401});
    }
    const body = init.body == null ? new Uint8Array(0) : (init.body instanceof Uint8Array ? init.body : new Uint8Array(await new Blob([init.body]).arrayBuffer()));
    const bodyHash = '0x' + sha256Hex(body);
    const objectHdr = header(headers, 'Object');
    if (objectHdr && objectHdr !== sha256Hex(body) && objectHdr !== bodyHash.slice(2)) {
      return new Response('TR-Object mismatch', {status: 400});
    }
    const server = (u.port && u.port !== '443') ? `${u.hostname}:${u.port}` : u.hostname;
    const message = {
      account,
      server,
      method,
      path: u.pathname,
      query: u.search.startsWith('?') ? u.search.slice(1) : '',
      bodyHash,
      timestamp,
      nonce: nonceHeader.startsWith('0x') ? nonceHeader : '0x' + nonceHeader,
    };
    const addr = signerOf('Request', account, message, signature);
    if (!addr || addr.toLowerCase() !== expectedAddress.toLowerCase()) {
      return new Response('signature rejected', {status: 401});
    }
    return relay.fetch(u.href, init);
  };
}

test('official signer and verifying transport run chunked upload plus resume, unsigned posts are rejected', async () => {
  const privateKey = newPrivateKey();
  const wallet = keyWallet(privateKey);
  const relay = createMockRelay();
  const signer = createRemoteSigner({wallet, account: CIRCUIT, servers: [SERVER]});
  const fetchImpl = verifyingFetch(relay, wallet.address);
  const unsigned = await fetchImpl('https://mock.snapvault.local:4246/v1/objects', {method: 'POST', body: new Uint8Array([1, 2, 3])});
  assert.equal(unsigned.status, 401);

  const client = createClient({fetch: fetchImpl});
  const auth = remoteAuth({
    account: CIRCUIT,
    endpoint: 'https://backend.test/sign',
    fetch: async (_url, init) => {
      const checked = signer.check(JSON.parse(init.body));
      assert.ok(checked.every((item) => item.kind === 'upload' || item.kind === 'claim'));
      assert.equal(checked.some((item) => item.path === '/v1/objects/release' || item.kind === 'release'), false);
      const signed = await signer.sign(checked);
      return new Response(JSON.stringify(signed), {status: 200, headers: {'Content-Type': 'application/json'}});
    },
  });

  const bytes = new Uint8Array(2 * ENCRYPTED_CHUNK + 80).fill(11);
  const self = generateKeyPair(), ephemeral = generateKeyPair();
  const plan = await planEncryptedFile(new Blob([bytes], {type: 'image/png'}), {
    name: 'clip.png', contentType: 'image/png', from: CIRCUIT, selfKey: self.publicKey, to: [ephemeral.publicKey],
  });
  assert.ok(objectBudget(bytes.byteLength) >= 2);
  const stop = new AbortController();
  let progressed = 0;
  const mid = await uploadToServers(client, [SERVER], auth, null, {
    plan, signal: stop.signal, retryMs: [],
    onProgress: () => { progressed++; if (progressed === 1) stop.abort(); },
  });
  assert.equal(mid.stored, false);
  assert.ok(progressed >= 1);
  const saved = resumableOf(plan);
  assert.equal(saved.fileKey, undefined);
  const resumed = await planEncryptedResume(new Blob([bytes], {type: 'image/png'}), {saved, keyPairs: [ephemeral]});
  const done = await uploadToServers(client, [SERVER], auth, null, {plan: resumed, retryMs: []});
  assert.equal(done.stored, true);
  const opened = openEnvelope(plan.envelope.bytes, [self]);
  const plain = await readEncryptedFileWithKey(client, [SERVER], plan.envelope.sha256, opened.fileKey);
  assert.equal(plain.bytes.byteLength, bytes.byteLength);
  assert.deepEqual(plain.bytes, bytes);
  opened.fileKey.fill(0);
  plan.dispose();
  resumed.dispose();
});

test('live mode stays off without a real official developer key, and garbage keys are not accepted', () => {
  assert.throws(() => parseDeveloperKey('not-a-key'));
  const off = loadMediaSettings({TAPERELAY_MEDIA_ENABLED: '1', TAPERELAY_MEDIA_MODE: 'live'});
  assert.equal(off.mode, 'off');
  assert.equal(off.enabled, false);
  const mock = loadMediaSettings({TAPERELAY_MEDIA_ENABLED: '1'});
  assert.equal(mock.mode, 'mock');
  assert.equal(mock.mockOnly ?? mock.mode === 'mock', true);
});
