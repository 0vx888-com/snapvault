# TapeRelay 大文件发布准备（功能默认关闭）

对应本地提交：在 `codex-wip` 上，当前可审阅头是 `6204ad3`（本说明随发布核对一起更新）。对照远程：`origin/main` 与 `origin/codex-wip` 仍停在 `18fdb4f`（GA4）。本地超前的提交尚未推送。

**本文件不是上线许可。** 未推送、未改生产环境、未创建电路、未付费、未把 mock 说成 live。没有凭据时不能连官方节点。

## 发布形态（两处，不要混）

1. **后端：Railway**，`Dockerfile` + `railway.json`，入口 `node server/wallet-start.mjs`，健康检查 `GET /healthz`。镜像构建时执行 `node scripts/build-app.mjs --server --allow-mainnet`，静态前端打进容器的 `./web`。`RAILWAY_ENVIRONMENT_ID` 存在时必须把 `config.dataDir` 放在 `RAILWAY_VOLUME_MOUNT_PATH` 指向的持久卷下，否则进程会拒绝启动。
2. **前端公共站：DeWEB 容器上传**。本地打包命令是 `node scripts/build-app.mjs --api https://API_ORIGIN --allow-mainnet`，产物在 `dist/wallet`。上传与打开发布费用是链上交易，必须单独停下来由你在钱包里确认。普通 HTTPS 辅助入口不能代替 DeWEB。

现有 2 MB 图片路径、加密 `.enc` Story/帖子、会话与订单数据仍走原来的服务端文件，不依赖 TapeRelay。`TAPERELAY_MEDIA_ENABLED` 保持 `0`（或不设置）时，视频/大文件入口不会启用，主网也禁止把 mock 当成真实存储。

## 现网版本对照（2026-11-25 核对，只读）

DeWEB 前端和 Railway 后端不是同一份代码，不能互相代替回滚。以下为公开静态文件与构建日志的对照，**不是**把本地提交说成已经上线。

**Railway 后端**（`https://snapvault-api-production.up.railway.app`）：

- 当前成功部署 `9f7e1839-20f3-4c7c-bb93-dc59c5845eb1`，理由是 redeploy，构建时间 2026-11-07 1:46 AM ET。健康检查 `GET /healthz` 现网返回 `chainId` 196（主网），服务在线。
- 构建日志写的是 Railway 源码快照 `sha256:5bb6c0c1c1e3d5c98f91538e4e43af2251c0699d19e001a72781e2c5a9174487`（压缩约 1.76 MB，解开约 4.70 MB）。这是 Railway 归档摘要，**不是 git commit**。日志里没有 git SHA，因此不能声称整棵上传树已逐字节还原。
- 实际构建走的是仓库里的 `Dockerfile`（`node:24-bookworm-slim`，`node scripts/build-app.mjs --server --allow-mainnet`，入口 `CMD ["node", "server/wallet-start.mjs"]`），不是 Railpack 自动语言构建。服务配置里虽显示 builder 为 RAILPACK，但官方说明是：只要源码里有 Dockerfile，就会用它来构建。
- 现网对外提供的 30 个静态文件（`index.html`、`app.js`、`style.css`、`social.js`、`product-ui.css`、`deweb-manifest.json` 及同一构建清单中的其余资源）与本地对 `ca8fb12`（2026-11-06 9:38 AM ET，「Sync deployed social features and bounded backup protection with regression tests」）执行同样 server 构建的产物 **SHA-256 完全一致**。`/app-config.json` 不同是因为 `server/wallet-http.mjs` 按运行中的 `chainId` 动态返回（现网为 `[196]`），不是另一份源码。现网没有 `about.html`（404），也与 `ca8fb12` 的 Dockerfile 一致。
- `066742b`（2026-11-07 1:54 AM ET）写在该次快照拉取约 8 分钟之后；从时间上不能把它算进现网后端镜像。`f2fa017` 及之后给 Dockerfile 加了 SEO 页面，与现网构建步骤不符。
- 未公开的 `server/*.mjs` 无法从静态文件哈希。因此：**现网后端静态包和 Dockerfile 指纹支持映射到 `ca8fb12`，但不能证明整份 Railway 快照与该 commit 的工作区逐字节相同。** 回滚时优先复用现网成功部署 `9f7e1839` / 上述快照，git 对照点用 `ca8fb12`，不要把 `18fdb4f` 当成 Railway 现网代码。

**DeWEB 前端**（`https://www.snapvault.cc/`，`https://snapvault.cc/` 会跳转到它）：

- 用 `18fdb4f` 执行 `node scripts/build-app.mjs --api https://snapvault-api-production.up.railway.app --allow-mainnet` 得到的 `dist/wallet` 中，`index.html`、`about.html`、`faq.html`、`style.css`、`app.js`、`social.js`、`product-ui.css`、`app-config.json` 与现网 **SHA-256 完全一致**，含 `GTM-MNKKDRXR`。这是 GA4 公共站，比 Railway 后端新。
- `https://10-2-6-open.tapekit.org/` 的首页多了 Cloudflare Insights 脚本，其余与上述 `18fdb4f` 构建一致。`https://10-2-6.tapekit.org/` 是 `tape://` 容器壳页，不是应用本体。
- `app.js` / `social.js` / `style.css` 在 `ca8fb12` 到 `18fdb4f` 之间没有改字节，所以两端哈希相同，并不表示前后端是同一发布。`6204ad3` 改过这些文件，**尚未出现在现网任一端**。

## Railway 构建方式与发布风险

官方 Config as Code 仍适用于现有服务（文档写明该方式将于 2026-12-01 弃用，迁移到 Infrastructure as Code 是另一件事，本次不改）。规则是：代码里的 `railway.json` 只覆盖当次部署，不改控制台里保存的设置；若源码含 Dockerfile，即使用 RAILPACK 作为默认 builder 也会走 Dockerfile。

因此，以后若发布 `6204ad3`，可以继续用**现有卷挂载、现有 `CMD`、现有 Dockerfile 构建路径**，不必为了大文件功能去改成另一种 start/volume 方案。`railway.json` 的 `deploy` 段（`/healthz`、120 秒、ON_FAILURE、1 副本）与 `ca8fb12` 相同。控制台 builder 显示为 RAILPACK 不必先改掉，以免增加无关变更。本次核对没有部署、没有改配置。

## 卷占用、旧数据与回滚兼容

现网卷是 `snapvault-api-volume`（1000 MB）挂在 `/data`。这 **不能** 直接解读成「1 GB 不够放大视频」：

- 直传 TapeRelay 时，密文由浏览器分片上传到官方节点；服务端 `_loadObject` 在 live 模式只调用官方 `getObject`，不会把对象正文写入数据目录。账户配额 `TAPERELAY_MEDIA_USER_QUOTA_BYTES` 默认 1 GiB，统计的是 `state.mediaFiles[].size` 的逻辑合计，不是 Railway 卷用量。
- 模拟模式把对象放在进程内 `Map`，同样不落卷。现网是主网，代码会拒绝用 mock 充当真实存储。
- 功能关闭时，现有 ≤2 MB 图片、AES-GCM `.enc` Story、会话、订单和独立 view ledger 仍走原来的路径。打开功能后，新媒体用 `mediaId`，旧内容没有该字段时仍读原来的 `.enc` / payload。
- 即便功能保持关闭，`6204ad3` 首次启动也会在 `state` 里补上空的 `mediaFiles` / `mediaSessions` 并 `save()`。这会重写 `state.enc` 信封，但不会改写旧图片正文或触发 view ledger 迁移（`SNAPVAULT_ALLOW_VIEW_MIGRATION` 默认不是 `true`，现网主网在未显式批准时会拒绝遗留迁移）。旧代码以 JSON 加载状态，不认识的键会保留并忽略，因此在尚未写入新媒体的前提下可以滚回现网部署。
- 若已经在生产写入 TapeRelay 媒体后再滚回不认识 `mediaId` 的后端，那些条目将无法播放。回滚前应确认尚未写入新媒体，或保留可解码的后端版本。
- `package.json` 的生产依赖集合与 `ca8fb12` / `18fdb4f` 相同；TapeRelay 客户端是 vendor 目录，不新增 npm 生产依赖。入口仍是 `node server/wallet-start.mjs`，健康检查仍是 `GET /healthz`。
- 运行日志里见过既有的 `backup worker unavailable; new checkout fails closed when readiness is missing`（2026-11-24 10:12 AM ET）。这是现网已经出现的现象，不是这次本地提交引入的，也尚未当作本次发布变更去处理。


## 官方 GA / GTM

与 `18fdb4f` 相比：`web/index.html` 的 `<head>` 脚本字节级一致，仍是 `GTM-MNKKDRXR`；`web/about.html`、`web/faq.html` 全文未改。页面其余改动只为视频预览/播放器节点，不改统计容器。

## 生产环境变量（只列名称）

后端配置来自 `SNAPVAULT_WALLET_CONFIG_JSON` 或 `SNAPVAULT_WALLET_CONFIG` 指向的 JSON（仓库里的 `config/wallet.json` 不会打进 Docker 镜像）。Railway 上还需要这些**已有**项才能启动现网（值留在现网秘密变量里，这里不读、不打印）：

- 绑定与入口：`PORT`、`BIND`、`NODE_ENV`、`RAILWAY_ENVIRONMENT_ID`、`RAILWAY_PUBLIC_DOMAIN`、`RAILWAY_VOLUME_MOUNT_PATH`
- 钱包配置：`SNAPVAULT_WALLET_CONFIG_JSON` 或 `SNAPVAULT_WALLET_CONFIG`（须含已验证的 `chainId`、`rpc`、`vault`、`deploymentBlock`、`origins`、`hosts`、`dataDir`；主网另有 `vaultBytecodeHash`、`owner`、`treasury`、`dewebURL`、`testnetEvidenceSHA256` 等门禁字段）
- 运营签名（加密 keystore，禁止进仓库/聊天）：`RELAYER_KEYSTORE_JSON` 或 `RELAYER_KEYSTORE`，以及 `RELAYER_PASSWORD`；若开启 TapeSend：`TAPESEND_KEYSTORE_JSON` 或 `TAPESEND_KEYSTORE`，以及 `TAPESEND_PASSWORD`
- 账本与备份：`SNAPVAULT_MASTER_KEY`、`SNAPVAULT_BACKUP_KEY`、`SNAPVAULT_VIEW_LEDGER_DIR`、`SNAPVAULT_VIEW_LEDGER_KEY`、`SNAPVAULT_BACKUP_PUT_URL` 及相关备份/迁移开关
- 交付工人：`SNAPVAULT_DELIVERY_WORKER_ENABLED`
- 紧急维护：`SNAPVAULT_MAINTENANCE=true` 时只提供维护页和 `/healthz`

大文件功能（**默认关闭**，live 未配置齐全时不会自行变成 live）：

| 变量 | 作用 |
| --- | --- |
| `TAPERELAY_MEDIA_ENABLED` | 设为 `1` 才考虑打开；默认关。别名 `SNAPVAULT_TAPERELAY_MEDIA` |
| `TAPERELAY_MEDIA_MODE` | `mock` 或 `live`。主网禁止 mock 充当真实存储 |
| `TAPERELAY_MEDIA_MAX_BYTES` | 产品上限，默认 209715200（200 MiB） |
| `TAPERELAY_MEDIA_USER_QUOTA_BYTES` | 账户配额，默认 1 GiB |
| `TAPERELAY_DEV_KEY` | 官方控制台密钥文件里的 `TAPERELAY_KEY`（`trk1_…`），只放服务端 |
| `TAPERELAY_CIRCUIT` | 控制台开通后的电路名，例如 `1.2.0` |
| `TAPERELAY_SERVERS` | 官方节点，需带端口，例如 `relay1.taperelay.com:4246` |
| `TAPERELAY_SELF_SECRET` | 应用电路加密私钥，32 字节 hex 或 base64；必须一次生成并跨重启保持，否则已有信封无法打开 |

没有 `TAPERELAY_DEV_KEY`、`TAPERELAY_CIRCUIT` 和 `TAPERELAY_SERVERS` 时，即便把 mode 写成 `live` 也会保持关闭。不要把本地 mock 预览当成官方节点已接通。

## 开通电路与密钥（必须你本人签名，费用以钱包为准）

依据官方文档：[开发者指南](https://www.taperelay.com/developers)、[控制台](https://www.taperelay.com/console/)、[价格](https://www.taperelay.com/)。测试期官方节点为 relay1～relay5，均由 TapeOut 运营。

先展开并确认电路列表，避免重复开通。只有列表确认没有可复用电路后，才在控制台点「一键开通」，并确认 **3 笔交易**（开通电路、开通容器、把 3 家节点写上链）和 **1 次不花 gas 的授权签名**。官方说明合计约 0.08 OKB 加手续费，**以钱包弹窗为准**。然后在「密钥」页生成 API Key（再签 1 次，免费），勾选「存文件、读文件」和「删除文件」，下载 `taperelay.env`。密钥只显示一次，只放到 Railway 秘密变量，不要发到聊天。

代理不会代签、不会代付、不会替你创建电路。

## 回滚

两端要分开回滚，不要用错基线。

1. 紧急：设置 `SNAPVAULT_MAINTENANCE=true`，不改数据卷。
2. Railway 后端：把服务滚回当前生产正在运行的部署 `9f7e1839-20f3-4c7c-bb93-dc59c5845eb1`（源码快照 `sha256:5bb6c0c1c1e3d5c98f91538e4e43af2251c0699d19e001a72781e2c5a9174487`）。git 对照点是 `ca8fb12`，**不是** `18fdb4f`。在新镜像成功替换之前不要删卷。
3. DeWEB 前端：git 对照点是 `18fdb4f`（「Add GA4 tracking to public SnapVault pages」）。若已上传新的 DeWEB 前端，用上一份已记录的、与 `18fdb4f` 构建清单相符的发布包再发一版，同样需要你确认上传费用。
4. 不要把 Railway 滚到 `18fdb4f` 当作「恢复现网后端」：那会把后端静态包向前推到 SEO/GA 版本，并不是当前线上镜像。
5. 只读预检脚本：`node scripts/check-safe-rollback.mjs <解压后的回滚包根目录>`。它不会切换部署，也不会改数据库。
6. 不要把 `TAPERELAY_MEDIA_ENABLED=1` 带到回滚环境。密钥与卷保留在原处，不要为了回滚而打印或轮换。
7. 不要用新镜像去初始化或覆盖持久卷。

## 本地产物

功能默认关闭的可审阅包在仓库外：`/workspace/snapvault-release/`（见其中 `NOTES.md` 与校验和）。不包含 keystore、密码、`TAPERELAY_DEV_KEY` 或用户数据。本地补充了 `test/taperelay-media-persistence.test.mjs`，用于核对密文不落数据目录、以及功能关闭时旧资源可被忽略多余键的加载方式。
