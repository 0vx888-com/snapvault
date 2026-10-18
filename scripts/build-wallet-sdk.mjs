import {build} from 'esbuild';
await build({stdin:{contents: "export {OKXUniversalProvider} from '@okxconnect/universal-provider/src/OKXUniversalProvider.js';",resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'inline',outfile:'web/vendor/okx-connect.min.js'});
