# SnapVault 加固交接 · 2026-10-18

本轮只改代码并做隔离本地验收，没有操作用户钱包、充值、买容器或花真钱。代码在 `codex-wip`，不自动切 Railway 主网。既有 Railway URL 和旧 1952 合约仍是上一版；不要拿旧回执当新合约验收。

## 已完成

- 生产目标统一为 SnapVaultDirect；公共链通过本机部署页由用户浏览器钱包签名，CLI 只允许本地链。
- Ownable2Step、onlyOwner setOperator、最高 15% 抽成、OKB 或 owner 白名单代币；交付异常可由 owner 另行出资全额退款。退款不是自动争议裁决，也不能收回买家已保存的图片/密钥。
- 显式 196 配置与主网确认开关，保留链、钱包、Hub 实现、字节码、角色、DeWEB 来源及预算检查。
- 订单日志增量分页、缓存及重启恢复；匿名 state 限流；前端后台标签暂停刷新、可见时 10 秒刷新。
- master 从环境变量读取；独立 backup key 加密 state+master，支持异地 HTTPS PUT、认证恢复、拒绝覆盖；异地备份失败不发新付款凭证，也不广播 TapeSend 待发交易。普通聊天定时备份，有非零数据恢复窗口。
- 生产 WalletService 接通官方 TAP-10 加密协议和 DeWebHub；可用买家容器 → purchaseDelivered → 独立 C 发送含 fragment 密钥的查看链接。没有容器/可用公钥时明确显示普通交付。有有效容器但发送故障时停止新付款，不静默降级。
- 已付款发送任务持久化、保存签名交易后备份、原交易重试、回执核对及去重；持有人/公钥变更停止交付。TapeSend 尚未确认时不提前消耗阅后即焚时间。
- 私聊、群聊、普通免费图文、付费图片、自选阅后即焚继续保留；增加容器绑定、收入/提现和官方消息链接查看入口，保留已认可的青柠视觉。
- Docker 与 DeWEB 使用同一前端文件白名单；付款实验页/部署页不公开。DeWEB 工具只接受 dist/wallet，支持分块、预算限制、人工逐笔签名、保存进度、两家 RPC 核验文件字节。

## 验证证据

最终完整回归 **PASS**：43 项合约/服务测试，7 项浏览器订单模型测试，以及现有演示 UI、钱包聊天/付费图片/提现 UI（17 项检查）、旧自动交付 UI、钱包准备与隔离、付款页无钱包安全等全部 7 组套件通过；51 个脚本语法检查与 git diff --check 通过。以 `deployment/hardening-all-tests.json` 为机器可读结果。核心测试包含官方未修改 DeWebHub 的本地代理合约和生产 WalletService/HTTP/浏览器真实解密链路。`screenshots/wallet-tapesend-viewer.png` 与 `wallet-tapesend-verified.png` 是本地交付截图，**不是主网官方收件箱截图**。

本轮还没有完成：新版本公共测试网 A/B 验收、真实异地存储账户及恢复演练、Docker 云构建、真实 DeWEB 发布、主网合约、主网 TapeSend 与官方收件箱证明。因此不能宣称主网正式上线或参赛要求已全部验证。

## 明早按此顺序继续

1. 用户给出自己控制的主网 owner 与 treasury **公开地址**（可以相同；不能使用旧测试 A）。不要发私钥/助记词。
2. 1952 用新合约，用户 A/B 分别签名完成上架、购买、查看和提现。官方 Hub 不在 1952，上面只验收普通交付；TapeSend 已先做本地官方 Hub 测试。保存新合约部署/购买/提现回执、解密原图哈希，生成新测试网验收记录。
3. 选择异地备份存储，配置受限上传地址和离线备份钥匙，隔离目录恢复演练。新的 operator 和 C 已在仓库外生成，尚未充值或上传 Railway；分别管理，不使用用户钱包私钥。
4. 重新只读核算 DeWEB 网站容器、C 容器和测试买家容器、上链文件 gas、合约部署与小额购买/提现预算。**先报总预算，用户确认后再付款**。没有已经开通的容器时，网站、C、买家都要分别核算；此前读取的费率不能当明日授权金额。
5. 构建真实 API 的 dist/wallet，用户钱包逐笔发布 DeWEB，核验文件和公共网关打开/钱包/CORS/外部 API 许可，保存 DeWEB 证据。不能传 wallet-local，不能用 Railway 页面冒充 DeWEB。
6. 部署页先验证新测试网记录和 DeWEB 证据，再由用户主网钱包部署 SnapVaultDirect；owner/treasury 用用户地址，operator 用新服务地址。
7. 主网独立数据目录、明确 196 配置、新服务角色和异地备份就绪后再切 Railway。默认单副本，不能多个进程写同一状态文件。
8. 预算内极小金额真实购买、查看、提现；由 C 自动真实 TapeSend 一次，保存 Sent 回执并在官方收件箱截图。完成后才发布可用范围与参赛证据。

部署命令、环境变量、退款与备份恢复步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。公开服务身份见 `deployment/mainnet-service-identities.json`，私密文件不进 Git、不进入前端或 DeWEB。


## 2026-10-18 后续实测：新测试网双钱包验收通过

- 新合约 `0x9186c06E97D104ad8e6794b3C2ef2B71b259A356`，X Layer 1952，MAX_FEE_BPS = 1500。A 上架 #1；B 实际 purchaseDirect 付款、RSA 密钥交付及图片解密可见，60 秒到期关闭，刷新不重置。
- A 提现 0.00001 测试 OKB。Withdraw 事件、钱包余额差（扣除 gas）、可提现余额归零均已核验。
- 浏览器导出同一商品的作者预览原始 PNG，162730 字节，与上传原图逐字节一致、SHA-256 相同。明文哈希来自作者预览导出；B 的实际付款查看、到期及刷新有单独界面证据，没有重置 B 的查看期限。
- 完整记录：`deployment/xlayerTestnet-direct-v2-acceptance.json`。部署、上架、购买、提现 gas 合计 0.000125226779858712 测试 OKB，未花主网 OKB。完整浏览器截图留在私人临时目录，不把其他标签页等个人浏览信息上传 GitHub。
- B 付款时钱包曾提示“异常收款地址／非合约交互”。用户继续确认后，已按官方 RPC 核对目标代码哈希及真实交易 chainId/to/from/value、purchaseDirect calldata，均正确。提示原因尚未确认，不能称已修复。
- 1952 无官方 Hub，本次公共测试网验收是普通交付；正式 TapeSend 仍需后续主网 C／买家容器及官方收件箱证据。本地官方 Hub 测试不能代替主网实测。
- 本机入口 127.0.0.1:5191。`scripts/serve-testnet-acceptance.mjs` 明确限制当前 v2 的 1952 合约、独立加密目录、环境 master key，不导入 A/B 用户私钥。
- Railway 仍是旧测试版；DeWEB 未发布。后续先准备异地备份与恢复演练、公开后端 v2 切换、主网 owner/treasury 公开地址、DeWEB/C/买家容器及发布预算。任何真钱步骤先给预算，再由用户确认。
