// Browser-test interception only. Never included in APP_FILES or production builds.
import {readFile} from 'node:fs/promises';
export async function localWalletFixture(page,{origin,vault,provider}){
 const u=new URL(origin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||Number(BigInt(await provider.send('eth_chainId',[])))!==31337||!/^0x[0-9a-fA-F]{40}$/.test(vault))throw Error('Only isolated loopback chain fixtures allowed');
 let source=await readFile(new URL('../web/wallet.js',import.meta.url),'utf8');
 if(!source.includes('export const CHAIN_ID = 196;')||!source.includes('0xFd9b25442955C09007abB2D10dEcD24b4d2CF83f'))throw Error('Production pins changed; review fixture');
 source=source.replace('"0xFd9b25442955C09007abB2D10dEcD24b4d2CF83f"',JSON.stringify(vault)).replace('export const CHAIN_ID = 196;','export const CHAIN_ID = 31337;');
 await page.route(url=>url.origin===u.origin&&url.pathname==='/wallet.js',route=>route.fulfill({contentType:'text/javascript',body:source}));
}
