# @taperelay/client

Client library for TapeRelay, the relay gateways of TapeOut circuit containers: identity and request signing (holder wallets, session keys, developer keys, revocation), discovery files, the shared file format (chunking, manifests, encrypted files and envelopes, site manifests), uploading/claiming/reading objects, verified playback, share links, signed pointers, inbox and file notices, server messages, and operator lists and registries.

For long-term storage with a simple API, use [`@tapestore/client`](https://www.npmjs.com/package/@tapestore/client), which builds on this package.

> **Status: preview (0.x), TapeRelay test period.** APIs may change before 1.0. Only the root export (`@taperelay/client`) is the public API; the `src/*` and `vendor/*` subpaths exist for `@tapestore/client` and may change in any release.


## Install

```bash
npm install @taperelay/client
```

Developer guide: https://www.taperelay.com/developers

## Example

```js
import { createClient, createKernel, serversOf, eip1193Wallet, authorizeSession, sessionAuth, normalizeCircuitInput } from '@taperelay/client';

const client = createClient();                       // standard fetch in browsers and Node.js
const info = await client.info('relay1.taperelay.com:4246');

const account = normalizeCircuitInput('1.2.0');       // the circuit, written 1.2.0; on-chain name 1.2.0.tape
const servers = await serversOf(createKernel(), '1.2.0');   // read from the circuit's on-chain discovery file
const wallet = eip1193Wallet(window.ethereum, holderAddress);       // the container holder's wallet

// a session key for one day, signed once by the holder's wallet
const session = await authorizeSession({ wallet, account, servers, now: client.now(), scopes: ['objects', 'inbox'] });
const auth = sessionAuth(session);

// a developer key for a backend or CLI: up to 366 days, shown once, revocable (see @tapestore/client)
// const { key } = await createDeveloperKey({ wallet, account, servers, now: client.now(), days: 90, note: 'ci' });   // the wallet shows a DeveloperKey
```

Works in browsers and Node.js ≥ 22. Plain JavaScript (ES modules); depends only on the audited `@noble` libraries. Chain reads and ABI encoding use the TapeKit kernel, included under `vendor/tapekit-kernel/` at a pinned commit (MIT, see its `LICENSE`). Its `createKernel` is exported from the root entry, so import it from `@taperelay/client`, not from the `vendor/` subpath.

## Security notes

- Request signatures are bound to one server, method, path and body, and are valid for 300 s.
- Never put a holder wallet's private key or a developer key (`trk1_…`) in a browser.
- Only a developer key (`DeveloperKey`) can carry the `release` scope, which the holder ticks separately; what it releases stays in each server's recycle bin for 7 days and keeps counting toward the container's usage meanwhile. A page's session key cannot release at all. Releases signed directly by the holder's wallet take effect at once and skip the recycle bin.
- Everything read is verified by its SHA-256; a server that returns other bytes is skipped.

## 中文摘要

TapeRelay（中继网关）的客户端库：身份和请求签名、会话密钥、开发者密钥（最长 366 天，钥匙只给一次，能撤销）、发现文件、公共的文件格式、上传认领读取对象、核对着播放、分享链接、签名指针、收件箱和服务器消息。长期存储和给开发者的简单接口在 `@tapestore/client`。预览版（测试期），1.0 之前接口可能变；只有根入口是公开接口。读链用的 `createKernel`（TapeKit 内核）从根入口导出。安装：`npm install @taperelay/client`。开发者指南：https://www.taperelay.com/developers

License: MIT.
