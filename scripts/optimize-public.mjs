// Build-time tree shaking only. No CDN, network, upload or runtime decompression.
import {build} from 'esbuild';
import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
export async function optimizePublic(out){
 await build({stdin:{contents:"export { Interface, JsonRpcProvider } from 'ethers';",resolveDir:fileURLToPath(new URL('../',import.meta.url)),sourcefile:'wallet-ethers-entry.js',loader:'js'},absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'inline',outfile:resolve(out,'vendor/ethers.min.js'),logLevel:'silent'});
}
