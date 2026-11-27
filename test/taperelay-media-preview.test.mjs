import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WalletService} from '../server/wallet-service.mjs';
import {walletHttp} from '../server/wallet-http.mjs';
import {APP_FILES} from '../scripts/app-files.mjs';
import {createTapeRelayPreviewService, PREVIEW_ACCOUNTS} from '../scripts/taperelay-media-preview.mjs';

const origin = 'http://127.0.0.1:4188';
const alice = '0x' + '11'.repeat(20);

test('preview scripts and fixtures stay out of the production whitelist', () => {
  assert.ok(!APP_FILES.some((f) => f.includes('local-media-preview') || f.includes('taperelay-media-preview') || f.includes('upload-test.mp4') || f.includes('serve-taperelay')));
});

test('selected media preview and controls can receive clicks', () => {
  const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  assert.match(css, /upload-preview:not\(\.hidden\)[^{]*\{[^}]*pointer-events:\s*auto/);
  assert.match(css, /upload-field\.has-file/);
  assert.match(css, /\.upload-preview video/);
  const preview = readFileSync(new URL('../scripts/local-media-preview.js', import.meta.url), 'utf8');
  assert.match(preview, /--local-preview-banner-h/);
  assert.doesNotMatch(preview, /z-index:\s*9999/);
  assert.match(preview, /localMediaPreview/);
  assert.match(preview, /127\.0\.0\.1/);
  assert.match(preview, /searchParams\.set\('view', 'discover'\)/);
  assert.match(preview, /location\.assign/);
});

test('loopback preview state and refund-list work without relaxing production chain auth', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sv-tr-preview-test-'));
  const incompleteDir = mkdtempSync(join(tmpdir(), 'sv-tr-prod-stub-'));
  try {
    const preview = createTapeRelayPreviewService({dir, origin});
    const aliceState = await preview.handle('state', {}, 'preview-alice', origin);
    assert.equal(aliceState.friends.filter((f) => f.status === 'accepted').length, 1);
    assert.deepEqual(aliceState.convs.map((c) => c.id).sort(), ['preview-dm', 'preview-group']);
    assert.ok(aliceState.messages.length >= 3);
    const bobState = await preview.handle('state', {}, 'preview-bob', origin);
    assert.equal(bobState.convs.length, 2);
    const eveState = await preview.handle('state', {}, 'preview-eve', origin);
    assert.equal(eveState.convs.length, 0);
    assert.equal(eveState.friends.length, 0);
    const refunds = await preview.handle('refund-list', {}, 'preview-alice', origin);
    assert.ok(Array.isArray(refunds.requests));
    assert.equal(refunds.isOwner, false);

    const hosts = [];
    const server = walletHttp({service: preview, root: process.cwd(), port: 0, allowedHosts: hosts});
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    hosts.push(new URL(base).host);
    try {
      const post = (action, token) => fetch(base + '/api/wallet/' + action, {
        method: 'POST',
        headers: {Origin: origin, 'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
        body: '{}',
      });
      const stateRes = await post('state', PREVIEW_ACCOUNTS.alice.token);
      assert.equal(stateRes.status, 200);
      const body = await stateRes.json();
      assert.equal(body.convs.length, 2);
      assert.equal((await post('refund-list', PREVIEW_ACCOUNTS.alice.token)).status, 200);
      assert.equal((await post('state')).status, 200);
    } finally {
      await new Promise((r) => server.close(r));
    }

    const productionLike = new WalletService({
      dir: incompleteDir, origins: [origin], allowLocalKeyFile: true, operator: {address: alice},
      provider: {getNetwork: async () => ({chainId: 31337})},
      vault: {target: '0x' + '44'.repeat(20), interface: {fragments: []}, feeBps: async () => 1000, contents: () => { throw Error('No chain'); }},
    });
    productionLike.sessions.set('alice', {account: alice, origin, until: Date.now() + 60_000});
    await assert.rejects(productionLike.handle('state', {}, 'alice', origin), /not a function|Preview has no chain|send/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
    rmSync(incompleteDir, {recursive: true, force: true});
  }
});
