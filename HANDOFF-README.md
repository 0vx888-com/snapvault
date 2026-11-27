# SnapVault 源码交接说明（截至 83f93e9）

本包是可下载的完整源码交接件，不是线上发布，也尚未部署到生产环境。功能默认关闭，不能把它当成已经接通官方节点。

## 提交与工作区

- 导出头提交（完整 id）：`83f93e9b94b0e98dbcb7b9895f6d3936f21d71e9`
- 短号：`83f93e9`（说明：Record live Railway and DeWEB version mapping for default-off release）
- 分支：`codex-wip`（相对 `origin/codex-wip` 超前 5 个提交，push 已禁用，这些提交不在 GitHub 上）
- 远程对照基线：`18fdb4f60c6ca712de64974ea68aef82ea39a6aa`（`origin/main` 与 `origin/codex-wip` 仍停在该提交，GA4 公共站基线）
- 导出时工作区状态：干净。`HEAD` 就是 `83f93e9`，没有未提交修改、没有未跟踪文件、没有 stash。因此本包等于该提交的完整源码树（再减去下方排除项），不存在额外补丁层。

未推送到远程的 5 个提交（从旧到新）：

1. `f9d24cead64d9105c17e2eee559a5ddd08019cbd` Harden TapeRelay large-media path and correct overclaimed mock coverage
2. `7785b1bd945cfa7945559bd092096e659e4c21bc` Fix media preview overlays and seed loopback mock acceptance data
3. `c96adbc58edff3f9a6b46a405eb3d95089307f8e` Fix friend Story reload visibility and hashed large-file resume
4. `6204ad38fdaccad54ab00b06080fe8a0691b0209` Fix production image copy for file-id and document default-off release
5. `83f93e9b94b0e98dbcb7b9895f6d3936f21d71e9` Record live Railway and DeWEB version mapping for default-off release

（打包脚本会把短号补成完整 id。）

## 导出与排除规则

- 源码来自 `83f93e9` 全树，包含 `package-lock.json`、`vendor/`（含 TapeRelay 与 TapeSend 客户端）、全部测试、文档、示例配置、Dockerfile、`railway.json`。
- 不包含：`.git`、`node_modules`、`dist`、`artifacts`、`cache` 等构建缓存，以及用户状态、keystore、钱包材料、凭据、`.env` 及其变体。
- 名为 `.env` 的示例也排除；变量名写在本说明里，不含值。
- 扫描后排除的敏感文件见 `MANIFEST.txt`（只写路径和排除理由，不写秘密内容）。
- 测试里的合成夹具（例如全 0 地址）保留，并在此注明：`scripts/taperelay-media-preview.mjs` 中的 `token` 是 `0x000…0` 占位，不是真实密钥。
- `config/taperelay-media.example` 与 `config/wallet.example.json` 是示例，已保留；其中的 `trk1_...` 只是格式说明。

## 安装、构建与测试

环境：Node.js 24（与生产 Dockerfile 的 `node:24-bookworm-slim` 一致），需要 `npm`。

```bash
cd snapvault
npm ci --ignore-scripts --no-audit --no-fund
```

本地预览（不会连官方节点，也不是主网付款）：

```bash
# 仅前端/服务端静态构建，需显式 API 源
# node scripts/build-app.mjs --server --allow-mainnet
# node scripts/build-app.mjs --api https://snapvault-api-production.up.railway.app --allow-mainnet
```

TapeRelay 相关测试：

```bash
npm run test:taperelay-media
npm run test:story-backup
```

历史测试结果（本轮导出未重新跑完整回归，不能把下面的记录说成这一轮刚验证通过）：

- 在写入 `83f93e9` 前，本地曾跑通大文件/权限/构建相关测试，其中包括 `test/taperelay-media-persistence.test.mjs`（3 项）以及更早的 Story 授权、近 200 MiB 分片续传等 mock/离线测试。
- 那些结果都是本地或 mock，不代表官方节点、真机或付费钱包流程已通过。
- 本轮只做源码扫描、打包、解压与校验和核对，没有再跑应用测试，也没有部署。

## 功能范围、限制与未验证项

三种场景都要接上，但本包默认关闭：

1. Story 视频
2. 付费解锁的视频/大文件
3. 私聊与群聊附件

默认单文件上限 200 MiB（`TAPERELAY_MEDIA_MAX_BYTES`，可配置），走官方客户端的加密分片上传、进度、取消和内容哈希续传。原有 ≤2 MB 图片与服务端加密文件路径保留。应用层过期不等于节点立刻永久删除。

尚未验证、不能称为 live：

- 官方节点上的实际上传、播放、续传
- 真机（iPhone Safari、Android、OKX 内置浏览器）近 200 MiB 体验
- 付费钱包实付与解锁
- 修后页面上 Bob 能看到 Alice 的好友 Story、Eve 不能看到（后端测试有过，浏览器 UI 需再验）
- 真实 GA 收数

主网禁止用 mock 冒充真实存储。未完成真实验证前，不要把 `TAPERELAY_MEDIA_ENABLED` 设为 `1` 并当作已上线。

## 服务端变量（只列名称，不要把值写入代码、聊天或本包）

大文件功能（默认关；缺真实电路/密钥时不会自己变成 live）：

- `TAPERELAY_MEDIA_ENABLED`（`1` 才考虑打开；别名 `SNAPVAULT_TAPERELAY_MEDIA`）
- `TAPERELAY_MEDIA_MODE`（`mock` 或 `live`；主网禁止 mock 充当真实存储）
- `TAPERELAY_MEDIA_MAX_BYTES`（默认 209715200）
- `TAPERELAY_MEDIA_USER_QUOTA_BYTES`（默认账户逻辑配额 1 GiB，不是 Railway 卷容量）
- `TAPERELAY_DEV_KEY`（控制台密钥文件中的 `TAPERELAY_KEY`）
- `TAPERELAY_CIRCUIT`
- `TAPERELAY_SERVERS`
- `TAPERELAY_SELF_SECRET`（32 字节 hex 或 base64，必须一次生成并跨重启保持）

现网后端启动还依赖这些已有名称（值留在服务器秘密变量里，这里不列出、不索取）：`PORT`、`BIND`、`NODE_ENV`、`RAILWAY_ENVIRONMENT_ID`、`RAILWAY_PUBLIC_DOMAIN`、`RAILWAY_VOLUME_MOUNT_PATH`、`SNAPVAULT_WALLET_CONFIG_JSON` 或 `SNAPVAULT_WALLET_CONFIG`、`RELAYER_KEYSTORE_JSON` 或 `RELAYER_KEYSTORE`、`RELAYER_PASSWORD`、以及 TapeSend / 账本 / 备份相关名称（`TAPESEND_*`、`SNAPVAULT_MASTER_KEY`、`SNAPVAULT_BACKUP_KEY`、`SNAPVAULT_VIEW_LEDGER_DIR`、`SNAPVAULT_VIEW_LEDGER_KEY`、`SNAPVAULT_BACKUP_PUT_URL`、`SNAPVAULT_DELIVERY_WORKER_ENABLED` 等）。紧急维护：`SNAPVAULT_MAINTENANCE`。

## 密钥的安全写入方式

- 不要把密钥、`.env`、keystore 或 `taperelay.env` 发到聊天、提交到 Git，或写入前端。
- 开发者密钥只放到 Railway 服务的秘密变量（或同等服务器密钥库）。
- `TAPERELAY_SELF_SECRET` 只在服务器生成一次并持久保存；丢失后已有信封无法打开，不要轮换后再指望打开旧文件。
- 钱包签名和链上交易必须由用户本人在钱包里确认。

## 现有环境复用（不要新建、不要重复付费）

- 网站继续用现有 DeWEB 容器 `10.2.6`，公共站 `https://www.snapvault.cc`。
- 后端继续用 Railway 项目 `snapvault-public-test` 的 `production` / `snapvault-api`，`https://snapvault-api-production.up.railway.app`，保留卷 `snapvault-api-volume` 挂载 `/data`，不要新建项目或卷。
- 现网后端静态包与 Dockerfile 指纹对应 `ca8fb12`；DeWEB 前端对应 `18fdb4f`。两端不是同一发布。回滚 Railway 时优先复用当时记录的成功部署 `9f7e1839-20f3-4c7c-bb93-dc59c5845eb1`，并重新核对当前状态。
- TapeRelay 电路已经是 `1408.2.265.tape`，控制台截图已选节点：`relay1.taperelay.com:4246`、`relay4.taperelay.com:4246`、`relay5.taperelay.com:4246`。这不是待开通状态，不要再点「一键开通」，不要重复付款。
- 下一步仍是在同一控制台生成开发者密钥（勾选存文件、读文件、删除文件），由用户本人做免费签名，密钥自行保存后通过秘密变量配置。本包不包含该密钥，也没有做生产部署。

更细的发布与回滚说明见包内 `docs/TAPERELAY-RELEASE.md`。

## 可选二进制补丁

同一次交接还可提供 `snapvault-18fdb4f-to-83f93e9.binary.patch`（相对基线 `18fdb4f60c6ca712de64974ea68aef82ea39a6aa`）。在干净的 `18fdb4f` 目录中执行：

```bash
git apply snapvault-18fdb4f-to-83f93e9.binary.patch
```

为避免把被排除文件的正文写进补丁，该补丁不含对以下路径的删除。若你的基线是完整的 `18fdb4f` 树，应用后请直接删除这两项，不要打开或转发：

- `config/wallet.json`
- `deployment/recipient-mainnet-key-state.json`

完整源码 ZIP 是主要交付，已经不含这两项。补丁只是可选的增量方式。
