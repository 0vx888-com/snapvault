// TapeRelay 客户端库：把一个容器网站整个复制到另一个容器（前端第 3 步，D-682「开发者可以把官方播放器复制进自己的容器网站并自定义」）。
// 2026-11-08 由编写窗口编写。读源容器网站的全部文件（pathCount、pathsRange、fileInfo、read，TapeKit SPEC 附录 B.5），每个文件核对链上声明的 SHA-256，
// 再交给 sitepublish.mjs 的 planSitePublish 算出要发几笔（目标容器里已有同一份的不重写），页面先给用户看笔数、用户确认后 executeSitePublish 逐笔发。
// 用法（浏览器里，chain 的 send 由钱包发；控制台的「复制一份播放器」按钮第 4 步做）：
//   const { files, plan } = await planCopySite({ chain, registry, from: 官方播放器的容器, to: 自己的容器 });
//   // 给用户看 plan.txs（笔数）、plan.bytes，用户确认后：
//   await executeSitePublish({ chain, plan, files, onStep });
// Node.js 里也可以不经链：node entry/build.mjs 构建出播放器（entry/dist/player/），照 deploy/test/local-world.mjs 的 siteFiles 读成文件清单再发布。
// 只读链、只在 executeSitePublish 时发交易；不碰私钥。
import { encodeCall, decodeResult } from '../vendor/tapekit-kernel/abi.js';
import { selectorOf, sha256Hex } from './core.mjs';
import { fileInfo, readSiteFile, fallbackPath } from './siteregistry.mjs';
import { planSitePublish } from './sitepublish.mjs';

const PAGE = 100;
export const SITE_COPY_MAX_FILES = 2000;
const SEL = Object.freeze({ pathCount: selectorOf('pathCount(address)'), pathsRange: selectorOf('pathsRange(address,uint256,uint256)') });
const bad = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** 容器网站里的全部路径（按合约给的顺序；超过 SITE_COPY_MAX_FILES 个的抛错） */
export async function listSitePaths(chain, registry, container) {
  const [count] = decodeResult(['uint'], await chain.call({ to: registry, data: encodeCall(SEL.pathCount, ['address'], [container]) }));
  const n = Number(count);
  if (n > SITE_COPY_MAX_FILES) bad('too-many-files', `网站里有 ${n} 个文件，超过 ${SITE_COPY_MAX_FILES} 个`);
  const out = [];
  for (let from = 0; from < n; from += PAGE) {
    const [page] = decodeResult(['string[]'], await chain.call({ to: registry, data: encodeCall(SEL.pathsRange, ['address', 'uint256', 'uint256'], [container, from, Math.min(PAGE, n - from)]) }));
    out.push(...page);
  }
  return out;
}

/** 读一个容器网站的全部文件：[{ path, contentType, bytes }]；每个文件的字节要和链上声明的 SHA-256 对得上，没声明的、对不上的抛错 */
export async function readSiteFiles(chain, registry, container) {
  const files = [];
  for (const path of await listSitePaths(chain, registry, container)) {
    const info = await fileInfo(chain, registry, container, path);
    if (!info.chunkCount) continue;                                   // 列着但已经删了
    const bytes = await readSiteFile(chain, registry, container, path, info.size);
    if (/^0+$/.test(info.sha256)) bad('no-hash', `${path} 在链上没有声明 SHA-256，不复制`);
    if (bytes.length !== info.size || sha256Hex(bytes) !== info.sha256) bad('hash-mismatch', `${path} 读到的内容和链上声明的 SHA-256 对不上`);
    files.push({ path, contentType: info.contentType, bytes });
  }
  if (!files.length) bad('empty-site', '源容器网站里没有文件');
  return files;
}

/** 复制的计划：from 的全部文件 → to；单页回退照 from 的（没设就是 index.html）。返回 { files, plan }（plan 见 planSitePublish） */
export async function planCopySite({ chain, registry, from, to }) {
  const files = await readSiteFiles(chain, registry, from);
  const fallback = (await fallbackPath(chain, registry, from)) || 'index.html';
  const known = await listSitePaths(chain, registry, to);
  return { files, plan: await planSitePublish({ chain, registry, container: to, files, fallback, known }) };
}
