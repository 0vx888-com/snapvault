> 最新联调状态见 [TESTNET-HANDOFF.md](TESTNET-HANDOFF.md)。下文部署脚本为早期基础 SnapVault；真实交付购买需使用新的 SnapVaultCheckout，不能用基础合约绕开交付凭证。

# 合约与部署

## 已经完成

- 合约上架、原生币/ERC20 购买、限量、分账、提现、重复购买拦截与独立购买期限。
- 首次打开展示时间与付款后 24 小时购买资格分离；可选择限时或可重复展示。
- 9 项本地合约测试；本地临时链部署脚本演练。
- `npm run prepare:deployment` 输出 ABI/字节码和源码 SHA-256；`web/abi.js` 同步生成。

没有向 X Layer 广播交易，没有正式合约地址。`npm run deploy:local` 的 chainId 31337 和地址仅属于一次性本地临时链。

## 真实部署前准备

需要部署钱包、该网络 gas 币、平台收款地址、确定平台费率。私钥仅配置在本人本机环境变量中，不发给聊天、平台用户或写入 Git。

当前配置保留 X Layer 主网 chainId 196 和测试网 chainId 1952。执行前应从 X Layer 官方文档重新核对 RPC、chainId 与测试币入口；部署脚本会核验实际 RPC chainId。测试网部署不代表 TapeSend 在同一测试网可用。

```bash
npm ci --ignore-scripts
npm test
npm run prepare:deployment
# 在本机安全配置 DEPLOYER_KEY 和 TREASURY 后执行；示例不包含任何私钥。
FEE_BPS=1000 CONFIRM_LIVE_DEPLOY=xlayerTestnet npx hardhat run scripts/deploy.js --network xlayerTestnet
```

`CONFIRM_LIVE_DEPLOY` 必须与网络名称一致。主网名称为 `xlayer`，必须在测试网验收后再决定。RPC 可用 `XLAYER_TEST_RPC` 或 `XLAYER_RPC` 覆盖。

脚本保存 `deployments/<network>.json`，包含合约地址、交易、链 ID、owner、treasury、费率与 gasUsed，不包含私钥。收款地址 treasury 不等于合约 owner；初始 owner 是部署账户。归属 TapeOut 容器需要先核实该容器能调用 Ownable 管理方法，再单独验证/执行 transferOwnership，不能用 treasury 参数替代。

## 上链不等于整套产品上线

当前前端明确固定为本地演示，没有“填个合约地址就自动真实付款”的开关。接真实链前还需要：

1. 钱包身份认证与网络核验、真实发布交易、确认收据后的订单索引；ERC20 地址和 decimals 需要核实，不能直接信任 UI 代币名称。
2. 真实密文存储、固定 pinning、可用网关和下载失败重试；先上传并校验密文，确认可交付后才允许上架收款。
3. 交付服务监听 Purchase，经最终确认后验证买家身份、作品/会话权限与期限，幂等重试、记录投递状态。异常订单需要退款或申诉规则；现有合约没有自动退款逻辑。
4. TapeSend 发送方容器/持有者的可执行签名方案，接收方 endpoint、公钥与收件适配。当前合约不调用 TapeSend，不声称仅靠 ERC721 approve 就能代发。
5. 首次打开在服务端原子记录，跨设备共用固定截止时间。本地 UI 截止时间可被修改，不能作为线上授权依据。密钥交付后仍无法阻止保存与拍屏。
6. 私聊/群聊作品的买家授权：现有公开合约不限制谁能购买，需要在真实收费前增加绑定买家与作品 ID 的签名授权或白名单；否则无法兑现私有范围与付款后交付。
7. 持久数据库、创作者与订单索引、密钥隔离保管、密钥轮换、备份和运营处置。这些都未由当前静态演示实现。

前端先部署普通静态预览即可体验；DeWEB 部署还需容器、上传工具和目标网关实测。没有完成这些接入之前，保留“本地演示 · 不扣款”标识。
