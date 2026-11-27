// Bundles official TapeRelay client modules for the static web app. No upload or deploy.
import * as esbuild from 'esbuild';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await esbuild.build({
  entryPoints: [resolve(root, 'scripts/taperelay-client-entry.mjs')],
  bundle: true,
  format: 'esm',
  outfile: resolve(root, 'web/vendor/taperelay-client.js'),
  platform: 'browser',
  legalComments: 'none',
  minify: false,
  banner: {js: '/* Official TapeRelay client APIs, MIT. See taperelay-client-LICENSE.md. Vendored from @taperelay/client 0.1.0-test.132. */'},
});
