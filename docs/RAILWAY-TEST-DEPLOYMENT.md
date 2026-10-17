# Railway 公开测试部署进度（2026-10-17）

- Chrome 已确认 Railway 登录；新项目页显示 30 天 / 5 美元试用额度，尚未升级付费。
- GitHub 仓库未向 Railway App 授权。改用官方 CLI 上传明确白名单的源文件，不授予读取全部 GitHub 仓库的权限。
- 官方 CLI 5.70.0 已下载到私有临时工作目录，并比对 GitHub 发布资产 SHA256；没有全局安装。
- CLI OAuth 尚待用户确认。已选定“0vx's Projects”一个工作区；官方 CLI 仍申请该工作区管理（含成员/账单设置）、项目管理、SSH key 与保持登录权限。代理没有点击 Authorize。
- 已新增 Dockerfile、railway.json、持久卷检查、秘密环境变量输入、/healthz、严格 Host/CORS 与请求时限。6 项相关 HTTP/钱包验证通过。当前电脑没有 Docker，镜像构建须在 Railway 实际验证，未声称容器已构建成功。
- 待上传包 /private/tmp/snapvault-railway-upload，35 个明确白名单文件，约 1.03 MB。清单见 deployment/railway-upload-manifest.json。没有上传，未包含 keystore、密码、用户数据或本地配置。
- 新生成测试交付凭证签名地址：0x010699a0E280A4325652f6D26bE2275E23A21506。不持有用户资金。加密 keystore 与独立密码在 /private/tmp/snapvault-railway-private，均为私有文件；只有部署时才能通过 Railway 指定服务的秘密变量标准输入上传，不能进仓库、前端、日志或聊天。
- X Layer Testnet 1952 新合约预览 http://127.0.0.1:5188/ 。预期部署者/收款者为用户 A：0x1538ac2d29d03615d2336a2227900aab334d9402，平台费 1000 bps。官方 RPC 本轮估算 2194069 gas，约 0.000043881382194069 测试 OKB；实际以钱包预览为准。尚未发送交易。
- 部署预览服务只读 RPC；只在核验 A 签署的完全一致创建交易、成功回执及合约构造参数后记录配置。人的钱包私钥不进入服务。

## 待完成顺序

1. 用户确认官方 CLI 授权（若不接受，改为网页部署，不绕过授权）。
2. 用试用额度创建 SnapVault 测试项目、单个后台和 /data 持久卷，生成 Railway HTTPS 域名；核对账户为可访问 X Layer RPC 的试用类型。不升级套餐。
3. 人在 Chrome 的 OKX Wallet 确认新 SnapVaultDirect 的 X Layer 测试网部署，核对回执；不能用历史 PaymentProbe 替代。
4. 配置公开后台的具体合约、部署区块、允许来源、私密签名变量与持久数据目录；实际构建并验证重启持久化与公网多用户流程。
5. 为实际 API 域名打包 DeWEB 前端，列出网站容器开通和上传的具体主网交易及费用，让用户先确认，再发送。普通 HTTPS 辅助入口不能代替真正 DeWEB 上传。
6. 官方 TapeSend 保持可选，单独核验；本轮新后台不开启主网收款，也不把本地 fixture 当官方交付成功。

任何试用转付费、绑定付费套餐、DeWEB 主网开通/上传或主网业务部署都要先给用户看具体费用；当前授权不等于可以直接花真钱。
