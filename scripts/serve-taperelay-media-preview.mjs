// Loopback-only mock preview for large-media Story / free posts / chat attachments.
// Does not connect to real TapeRelay, Google, or a wallet, and does not bypass production payment auth.
import {readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {walletHttp} from '../server/wallet-http.mjs';
import {createTapeRelayPreviewService, PREVIEW_HOST, PREVIEW_VAULT} from './taperelay-media-preview.mjs';
import {tmpdir} from 'node:os';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';

const HOST = PREVIEW_HOST;
const PORT = Number(process.env.TAPERELAY_PREVIEW_PORT || 4188);
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
const previewJs = readFileSync(resolve(root, 'scripts/local-media-preview.js'));
const fixturePath = resolve(root, '../snapvault-video-fixtures/upload-test.mp4');
const extraStatic = {
  '/local-media-preview.js': {type: 'text/javascript; charset=utf-8', body: previewJs},
};
if (existsSync(fixturePath)) {
  extraStatic['/fixtures/upload-test.mp4'] = {type: 'video/mp4', body: readFileSync(fixturePath)};
}

const dir = process.env.TAPERELAY_PREVIEW_DIR || mkdtempSync(join(tmpdir(), 'sv-tr-preview-'));
const service = createTapeRelayPreviewService({dir, origin});

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
console.log('Covered in this preview: Story, free posts, chat attachments, progress/cancel, same-file resume, playback.');
console.log('Not covered: paid listing, paid purchase, real TapeRelay nodes, real wallet signatures.');
process.on('SIGINT', () => server.close(() => process.exit()));
process.on('SIGTERM', () => server.close(() => process.exit()));
