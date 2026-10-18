// Build-time tree shaking only. No CDN, network, upload or runtime decompression.
import {build} from 'esbuild';
import {resolve} from 'node:path';
export async function optimizePublic(out){
 await build({stdin:{contents:"export { Interface, JsonRpcProvider } from 'ethers';",resolveDir:new URL('../',import.meta.url).pathname,sourcefile:'wallet-ethers-entry.js',loader:'js'},absWorkingDir:new URL('../',import.meta.url).pathname,bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'inline',outfile:resolve(out,'vendor/ethers.min.js'),logLevel:'silent'});
}
