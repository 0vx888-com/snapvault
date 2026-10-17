# 发布与钱包签名（2026-10-18）

主网部署目标只能是 `SnapVaultDirect`。`scripts/deploy.js` 仅允许隔离本地链 31337；公共链不能使用 DEPLOYER_KEY。不要使用基础 SnapVault 的 purchase 作为生产收款入口。

当前 GitHub 分支：`codex-wip`。已有 Railway 入口与 1952 合约是旧测试版，不能当成本轮新合约验收或主网发布证据。

## 发布顺序，不可跳步

1. 跑 `npm run test:all`。全部本地合约、服务、浏览器测试成功。
2. 浏览器钱包部署**新的加固合约**到 X Layer 1952。A 创作者上架，B 买、看图，A 提现，保存回执和浏览器解密证据。官方 1952 无 Hub，TapeSend 必须先在本地官方 Hub 验证。
3. 单独核算网站电路、容器与文件上传预算；用户确认后，通过 `serve-deweb-publish.mjs` 只发布 `dist/wallet`，按链上哈希和实际字节核验，保存 `deployment/deweb-wallet-proof.json`。不能传 wallet-local、实验页面或 HTTP 重定向壳。
4. 新 owner/treasury 公开地址由用户提供；禁止旧测试地址。主网 operator 与发送 C 使用新生成的**不同**钱包，C 只存少量 gas。开 C 与测试买家容器前再报预算并由用户确认。
5. `node scripts/serve-mainnet-deploy.mjs PRIVATE_PUBLIC_SETUP.json`：验证新测试网回执及真实 DeWEB 文件证据后，打开 localhost:5199，用户在浏览器钱包预览、签名部署。服务器不持有部署私钥、不代签广播。会核对创建字节码、chainId、sender、owner、treasury、operator、15% 上限和回执。
6. 后端切到独立的主网数据目录与明确的 196 配置。主网默认关闭；必须有真实部署区块、字节码哈希、精确 DeWEB Origin、独立 C、Hub 钉住哈希和异地加密备份。先迁移并恢复演练，不覆盖旧测试卷。
7. 用户确认很小金额后：主网买、看、提现；C 自动发送一次真实 TAP-10 消息，使用官方收件箱查看并保存 Sent 回执、收件箱截图。证据未齐不得称正式上线/参赛集成完成。

## 本机入口

- `node scripts/serve-testnet-deploy.mjs PRIVATE_TEST_SETUP_DIR` → 5188，仅新测试网合约。
- `node scripts/build-app.mjs --api https://API_ORIGIN --allow-mainnet` → `dist/wallet`。显式配置允许 1952/196，运行时仍核对后端主网开关。
- `node scripts/serve-deweb-publish.mjs REVIEWED_WEBSITE_SETUP.json` → 5200。网站容器须已开通，核对持有人、标准名字、合约实现与预算；每笔用户签名，续传顺序按回执保存。
- `node scripts/serve-mainnet-deploy.mjs REVIEWED_MAINNET_SETUP.json` → 5199。见 config/*.example.json；模板故意缺失真实地址、预算与证据，不能直接运行。

创建服务钥匙：`node scripts/prepare-service-wallets.mjs NEW_PRIVATE_DIR_OUTSIDE_REPO`。只生成新钱包和加密存储/备份钥匙，不充值、不部署、不导入用户私钥。输出仅公开地址，私密文件 0600，目录 0700。

## 备份与恢复

- `SNAPVAULT_MASTER_KEY`：32 字节 hex，来自服务环境变量；生产禁止自动生成替代 key。既有卷先用 `migrate-master.mjs EXISTING_DIR PRIVATE_OUTPUT_ENV` 验证并导出旧 key，不删除旧文件；不打印或提交 key。
- `SNAPVAULT_BACKUP_KEY`：独立 32 字节 hex。快照将 state.enc 与 master 一起 AES-256-GCM 加密；备份钥匙必须单独离线保存。
- `SNAPVAULT_BACKUP_PUT_URL`：支持 HTTPS PUT 的异地存储预签名地址，仅放服务变量，不进 Git/前端/日志。主网缺少它就拒绝启动；本地卷内副本不等于灾难恢复。建议独立账号、对象版本控制与受限权限。签名 URL 过期会导致新付款凭证停止。
- 上传待售内容在签付款凭证前完成异地备份；首次付费查看截止时间也会备份。普通消息定时备份（默认 5 分钟），因此灾难恢复有非零 RPO；未承诺零丢失。
- `node scripts/backup-state.mjs create DATA_DIR PRIVATE_BACKUP`、`verify BACKUP`、`restore BACKUP NEW_PRIVATE_DIR`。恢复检查 GCM、JSON 和 chain/vault identity，拒绝覆盖现有状态；恢复 master 写到私人 env 文件。先在隔离目录恢复测试，再切服务。

## 退款与权限

`setOperator` 仅 owner，旧签名立即失效。`Ownable2Step` 的新 owner 必须 acceptOwnership。默认只收 OKB，其他标准 ERC20 需 owner 明确加入白名单；撤销白名单不冻结已有收入提现。上限 1500 bps。

`refundDelivery(id,buyer)` 由 owner 裁决线下交付故障，并额外提供**全额**退款资金（OKB msg.value；ERC20 需 owner approve）。不侵占创作者/treasury 已有记账，已提现也可退。退款后撤销站内购买资格，不允许重复退款或对同一买家重售同一 ID。这不是链上自动证明“没交付”，不能收回已拿到的密钥。

## 当前仍需人工完成

用户自己的主网 owner/treasury 地址；新公共测试网的 A/B 签名；真实异地备份账户和恢复演练；DeWEB/C/买家容器预算确认；主网小额最终钱包签名；官方收件箱截图。它们不能由本地测试报告代替。

## 新测试网验收记录

部署页生成 `deployment/xlayerTestnet-direct-v2.json`，不手工改成旧合约地址。完成两个真实测试账户的购买/解密/提现后，再写独立验收 JSON：`chainId:1952`、`vault`、`artifactHash`、`creator`、`buyer`、`purchaseTx`、`withdrawTx`、`originalSHA256`、`decryptedSHA256`。后两个必须是原图与浏览器实际解密字节的 SHA-256，不能只填“已通过”。在主网 setup.evidence.testnetRecord 指定此文件名，dewebRecord 指向真实 DeWEB proof。

主网门禁会重新读链验证 v2 创建交易完整字节码、部署者、部署回执与运行时代码哈希，以及购买/提现事件；DeWEB 证据必须对应当前 dist/wallet 完整文件。记录本身不代替链上核对。旧实验付款页的无钱包安全回归使用隔离 RPC fixture，明确不计入公共测试网验收。
