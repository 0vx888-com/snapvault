# SnapVault TapeRelay 大文件（本地实现，默认关闭）

大视频和大文件上传是产品主路径：完整流程是 **分块加密上传 → 中断后续传 → 分享后按权限播放**（Story / 付费解锁 / 私聊附件共用同一底座）。这不是只放宽 MIME 或把 2 MB 调大。

当前仓库已完成本地实现和模拟测试。**没有真实电路、开发者密钥或官方节点联调，不能称为线上已打通。** 开关默认关闭，不影响现有 2 MB 图片路径和已有 GA 代码。

## 怎么打开（只在本地或你明确配置的后端）

环境变量见 `config/taperelay-media.example`。常用项：

- `TAPERELAY_MEDIA_ENABLED=1` 才启用
- `TAPERELAY_MEDIA_MODE=mock`（默认，无密钥时）或 `live`
- `TAPERELAY_MEDIA_MAX_BYTES` 产品上限，默认 `209715200`（200 MiB，与官方播放器整段进内存上限对齐）。**尚未真机实测**，不要把它当成协议或手机保证
- live 还需要：`TAPERELAY_DEV_KEY`（`trk1_…`，仅服务端）、`TAPERELAY_CIRCUIT`、`TAPERELAY_SERVERS`、`TAPERELAY_SELF_SECRET`（电路加密私钥，32 字节 hex 或 base64）

主网不会把 mock 当成真实存储。没有 live 凭据时，即使打开开关也只是本地模拟。

不要把开发者密钥或电路私钥放进前端、仓库或聊天。本实现也不会向你索要这些值。

## 官方 API（未发明）

使用官方 `@taperelay/client` 0.1.0-test.132（MIT，源码在 `vendor/taperelay-client/`，浏览器打包在 `web/vendor/taperelay-client.js`）：

- 浏览器直传、后台只签上传/认领：`remoteAuth` + `createRemoteSigner`（模板 A）
- 加密计划、续传：`planEncryptedFile`、`resumableOf`、`planEncryptedResume`
- 按块上传：`uploadToServers` / `uploadFile`（1 MiB 对象；已有对象认领后跳过）
- 播放：`openEncryptedFileWithKey`、`readEncryptedFileWithKey`、`streamMedia`；MP4/MOV 上传前 `faststart`

开发者密钥只在服务端用于签名，权限按官方默认应只有 `objects`（存、读文件），不要把 `release` 等额外权限放进这把钥匙。浏览器没有 `trk` 密钥，文件明文不会整份 POST 到 Railway。

## 三个场景如何共用底座

1. 前端用 `File`/`Blob` 按块加密（另加一把仅用于本机续传的临时公钥），信封同时封给应用电路公钥。
2. 浏览器把密文对象直接传到节点（或本地 mock）；后端只签名。
3. 播放前必须先通过 SnapVault 登录，再由后端用电路私钥打开信封，把 **file key** 发给当前被授权的人。密钥走已认证 HTTPS，不写进 URL、分享链接、列表或日志。

现有 ≤2 MB 图片路径保持不变。只有视频，或大于 2 MB 且开关已打开时，才走这条路径。

## 付费任意买家 vs 信封最多 16 个收件人

官方加密信封（含自己）最多 16 个收件人。群聊最多 32 人，付费买家数量也不受这 16 限制。本实现 **不会** 把买家或群成员写进信封。

授权在应用层：付款校验（`confirmed` + `accessUntil`，创作者预览除外）或会话成员资格通过后，再发放 file key。没有付款不能打开付费内容。这是有意识的密钥服务器设计，不是「没有这个限制」。

## 过期文案

私密/限时内容是 **应用层过期**：到期后本应用停止发放密钥。节点上的加密对象不会立刻删除（官方：回收站约 7 天，对象至少保留约 30 天）。不要宣传「看完立刻从全网永久删除」。

## 续传与手机内存

加密续传必须复用上次的 nonce 和 `resumableOf` 记录，并用本机保存的临时密钥对调用 `planEncryptedResume`。官方演示站「不支持续传」不等于官方客户端没有续传。

**续传身份不能只用文件名 + 大小 + 修改时间。** 这三个字段可以碰撞。内容哈希不一致时，不得调用 `planEncryptedResume`、不得用旧 nonce 加密另一份明文（会泄漏）。现已先对实际上传字节（含 faststart 之后的数据）做分块 SHA-256，写入 IndexedDB 的 `contentSha`；对不上或没有哈希的旧记录一律新开计划。官方 `planEncryptedResume` 自己也会在块哈希对不上时报 `resume-mismatch`，但前置校验是为了避免比较过程中再用旧 nonce 加密不同明文。

上传按块读取 `File`/`Blob`，不要 `arrayBuffer()` 整文件，也不要 base64 整份交给后端。不能流式播放的内容，官方播放器整段进内存上限约 200 MiB；默认产品上限与此一致。手机是否稳定，还需要真机验收。

## 测试与尚未完成的事项

```bash
npm run test:taperelay-media
```

覆盖：默认关闭、现有图片路径、官方分块加密上传、中断后续传、Story/付费/私聊权限、过期后不再发钥匙、密钥不泄漏、签名接口 fail-closed、Alice 好友视频 Story 对 Bob 可见/可取钥匙且 Eve 列表与直接取钥匙均被拒绝、近 200 MiB 惰性文件中断后续传并核对解密哈希、同名同大小同 mtime 不同内容不得复用 nonce、取消与配额。

仍需你这边才能算验收完成：

- 在 TapeRelay 控制台开通电路并签名（会有链上费用，需你本人确认）
- 配置服务端密钥后做真实节点联调
- 钱包付款与真机大视频上传/续传/播放
- UI 浏览验收（不要用 shell 自动开浏览器代替）

未做部署、push、PR、DeWEB 上传或任何付费交易。

## 审查纠正（先前“底座已写好、12 项通过”的夸大）

先前报告把本地模拟单测通过说得过满。审查后已修复或明确的缺口：

1. **三个 UI 入口**现在都会走 `web/taperelay-media.js` 的 `uploadEncryptedMedia` / `playAuthorizedMedia`：Story 与免费动态在 `web/social.js` 的 `publishSocial` 与 `showItem`，付费发布/打开在 `web/app.js` 的 `publish` 与 `view`，私聊附件在 `web/wallet-chat.js` 的发送表单与 `mediaNode`。列表会标出视频/大文件而不再对 `photo()` 抛 `'media'`；Story 视频按播放结束前进，不再一律 5 秒切走。付费 `open` 不再把 `fileKey` 摊进响应，只由 `media-key` 发钥匙。
2. **签名绑定**：`signMediaRemote` 只签官方允许的上传/认领，并按 `layoutOf(size, ENCRYPTED_CHUNK)` 限制对象数，认领/上传哈希必须落在本会话清单内，跨用户不能签别人的会话，另有账户配额（默认 1 GiB，可配 `TAPERELAY_MEDIA_USER_QUOTA_BYTES`）。 `media-sign` 的每分钟次数上限按 `objectBudget(maxBytes)*4+40` 计算，并避开账户总闸 90 次/分钟，否则接近 200 MiB 的分块签名会被误杀；会话内哈希白名单仍然有效。
3. **权限反向**：未发布媒体只向创建者发钥匙；退好友、退出群成员、付费未确认/过期/已退款、应用层过期后都不再发钥匙。当前产品接口本身没有“解除好友 / 退群”动作，反向测试改的是好友记录和群成员名单这一事实来源，以证明授权是实时检查而不是上传时快照。
4. **密钥存放**：电路私钥和开发者密钥只在服务端内存/环境变量；续传计划（含临时密钥）在本机 IndexedDB `snapvault-taperelay-resume`，按文件名+大小+修改时间+账户初步索引，但必须再用全文件 `contentSha` 核对后才能复用计划；会话约 2 小时过期后清理，退出登录会清空。密钥不会进 URL、列表、日志或 GA（`analyticsSafeDetail` 会剥掉敏感字段）。撤回/过期是应用层停止授权，节点对象不会立即删除。
5. **生产适配器契约**：`test/taperelay-adapter.contract.test.mjs` 用官方 `createRemoteSigner` + `keyWallet` + `signerOf` 在离线传输层校验请求头，再跑分块上传和续传；不再把“签名不校验的 mock 收对象”说成生产适配器已验证。live 模式在没有官方开发者密钥、电路和节点时保持关闭。
6. **真实节点 / 真机 / 付费交易仍未做。** 默认关闭，未部署。

## 本地模拟预览（不连接真实钱包或官方节点）

```bash
npm run serve:taperelay-preview
```

浏览器打开（仅本机回环）：

[http://127.0.0.1:4188/index.html?delivery=wallet&localMediaPreview=1](http://127.0.0.1:4188/index.html?delivery=wallet&localMediaPreview=1)

测试视频（供手动选择，不是自动上传）：

- 本机文件：`/workspace/snapvault-video-fixtures/upload-test.mp4`
- 预览下载：[http://127.0.0.1:4188/fixtures/upload-test.mp4](http://127.0.0.1:4188/fixtures/upload-test.mp4)
- 约 738 KB，`video/mp4`，约 8 秒

顶部账号条只占用预留高度，不再挡住页头「发布」按钮。Alice 与 Bob 已是互为接受的好友，并预置「预览私聊」和「预览群」及文本消息；Eve 看不到这些会话。选中视频后，预览控件应可点击播放；更换文件请用「更换文件」。

**未在浏览器验收、也不应绕过的部分：** 付费上架（`publishWallet`）和付费购买（`purchaseWallet`）仍要求真实钱包签名和链上交易。预览不会绕过生产认证。真实 TapeRelay 节点、真机和 Google 收数也未验证。

## 第二次浏览器预览后的结论（Stories 空、大文件未验）

第二次手动预览里：Alice 已能在本地 mock 发布好友可见 24h 视频 Story 并自己播放；Bob 也能播放私聊/群附件。随后 Bob 切换身份并刷新后，页面上的 Stories 是空的。当时 **服务端授权并没有放宽，也不是“好友过滤写错了”**：对已发布的那条 Story，后端 `social-state` / `social-open` / `media-key` 已经是 Alice 与 Bob 可见、Eve 不可见且直接要钥匙会被拒绝。`test/taperelay-media-story-auth.test.mjs` 把这条生产逻辑锁进了集成测试（含大小写不同的好友记录）。

Mock 预览里“Stories 空”更像是前端加载/身份切换/页面位置问题，而不是服务端把 Bob 漏掉：

- Story 只出现在发现页顶部的 `#story-strip`（会显示 `24h Story · N`），不会出现在「创作者」或「最新内容」列表里。
- 若停留在消息页再刷新，地址栏会带 `view=messages`，不会先看到 Story 条。预览账号切换现在会回到 `view=discover` 并重新拉取列表。
- 钱包尚未就绪时，前端不再把已有 Story 状态清空；打开「发现」会再拉一次 `social-state`；好友/成员比较改为大小写不敏感。
- 发布免费/Story 内容会把作者标成创作者。

738 KB 的 `upload-test.mp4` **不能**当成大文件或中断续传验收。近默认上限的惰性文件测试在 `test/taperelay-large-media.test.mjs`：临时文件 + `openAsBlob` 分块读写，注入上传中断，持久化 resumable，模拟 reload 后按全文件哈希恢复，解密哈希一致；并覆盖取消与配额。这些测试只跑 headless Node，不驱动浏览器，无外联。

**不要再无限重跑同一套 738 KB 浏览器预览。** 仍未在浏览器/真机/真实节点验证的部分：

- 付费上架与购买（仍要真实钱包签名，预览不会绕过）
- 真实 TapeRelay 节点、电路开通与钱包签名费用
- 真机大视频上传、中断续传与播放
- 浏览器里 Bob 刷新后能否在 Story 条看到 Alice（本次只修了代码和后端集成，未再要求同目标手工重跑）
- 浏览器里 Eve 的 Story 可见性（后端/HTTP 已拒绝，浏览器未点验）
- 近 200 MiB 文件在真实浏览器中的上传/续传
- Google Analytics 真实收数

功能默认关闭，未部署、未 push、未付费。真实节点/钱包/手机等待后续明确流程。

发布准备与回滚（功能默认关闭、不自动上线）见 [TAPERELAY-RELEASE.md](TAPERELAY-RELEASE.md)。
