# 单次迁移入口与公开维护隔离

此文档不是执行授权。只在人工批准停写、云端写入及费用后执行。不得通过 push 自动触发部署。

## 隔离方式

公开服务设置 `SNAPVAULT_MAINTENANCE=true` 时，原有业务初始化、钱包及 worker 都不启动。新增 `SNAPVAULT_MAINTENANCE_SOCKET` 指向预先准备的私有父目录中的新绝对路径，例如 `/data/control/maintenance.sock`。服务提供权限为0600的 Unix socket 证明，公开端口不提供 `/status` 或迁移路由，业务仍为503。

迁移命令必须在同一受信任主机上请求这个 socket，并核对维护进程PID、源目录摘要、停写确认及 B0 检查点。运行前还必须由运维确认旧版本/旧副本已真正停止：Unix socket只能证明当前维护入口，不证明另一台主机不存在旧写进程。Railway 挂载同卷的单实例切换及旧部署终止必须先核对。

## 两个显式子命令

只读计划（不需要密钥、不连接S3，不创建目标）：

```sh
node scripts/migrate-views-once.mjs plan /data/snapvault-mainnet-v2 /data/migrations/REVIEWED_UNIQUE_RUN
```

`plan.source.sha256` 是整个 `state.enc` + `burn/` 文件清单的摘要，不是单独state文件摘要。运行前应在停写后重新核对；活跃服务的容量盘点不能代替一致性检查点。

真正的 `execute` 不应出现在 Docker CMD、Railway启动命令或普通自动部署流程中。所需环境均通过秘密变量/受保护操作会话提供，不在聊天、Git或 shell 命令行写钥匙：

|变量|要求|
|---|---|
|SNAPVAULT_MAINTENANCE|true|
|SNAPVAULT_MAINTENANCE_SOCKET|当前维护进程的本机socket|
|SNAPVAULT_MIGRATION_ACK|STOPPED_SOURCE_NEW_TARGET_ONLY|
|SNAPVAULT_EXPECT_IDENTITY|196:现有合约小写地址|
|SNAPVAULT_APPROVED_SOURCE_SHA256|停写后审阅的源清单摘要|
|SNAPVAULT_MIGRATION_B0_FILE|已验证加密B0的绝对路径|
|SNAPVAULT_MIGRATION_B0_SHA256|已审阅B0的精确摘要|
|SNAPVAULT_MASTER_KEY / BACKUP_KEY / VIEW_LEDGER_KEY|三把独立钥匙；前两把沿用原钥匙|
|SNAPVAULT_BACKUP_S3_*|原桶配置；命令只用raw client写独立日志，不调用快照修剪|

```sh
node --max-old-space-size=512 scripts/migrate-views-once.mjs execute /data/snapvault-mainnet-v2 /data/migrations/REVIEWED_UNIQUE_RUN
```

## 执行边界

- 仅接受与B0完全相符、未经本次日志迁移的v2旧状态；已迁移状态/已有远端日志拒绝重新初始化。
- 拒绝已有工作目录、包含/被包含源目录的目标、软链接、不匹配密钥及缺失正文。
- 空间预检按源正文12倍加64MiB保留空间；这是准备门槛，不能取代执行期间容量监控。
- 原文件保持不变。工作区包含原始输入副本、候选状态、独立日志、加密B1和隔离恢复演练。运行失败保留现场，不删除源数据、历史备份或失败工作区，不自动重试。
- 每次远端日志写入前重新验证维护PID和源摘要；并发变化、S3失败、检查点不一致都不产生成功回执。
- 成功回执为 `MIGRATED_NOT_PROMOTED`，不会切换公网或启动worker。B0/B1仍需通过单独审阅的无修剪checkpoints上传、读回与恢复流程，不能凭本地B1就开放业务。本入口不冒充完整异地备份发布器。
- 迁移期间无付款、提现或TapeSend发送，也不加载签名钱包。现有数据/备份永远不是本脚本的删除对象；仅候选副本内过期正文按迁移规则清除。
- CLI错误输出只报类型和停止状态，避免JSON解析错误带出内容片段。

## 本地测试

`hardhat test test/OfflineMigration.test.js` 使用合成源、合成B0、模拟远端日志和本机socket。覆盖实际CLI计划/误执行防护、维护隔离、B0、摘要变化、远端失败、重复运行及恢复。不能把这些测试说成生产数据已迁移。

`scripts/production-storage-inventory.cjs` 只读文件元数据、统计大小和statfs，不解密用户内容；不能在上线前用容量统计替代停写快照。
