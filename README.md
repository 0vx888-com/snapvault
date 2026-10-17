# SnapVault

现有社交前端上的创作者广场、免费私聊/群聊、普通图文、自设阅后即焚与付费图片。视觉使用已确认的青柠/炭黑磁带标志；不重建前端。

正式目标：前端 **X Layer DeWEB**，付款合约 **X Layer 196 的 SnapVaultDirect**。先用 1952 新合约验收。当前已公开的 Railway 和旧测试合约仍是上一测试版本；本轮加固尚未由用户签名部署。

## 交付方式

- TapeSend 是正式交付路径。买家绑定已开通容器和官方可用公钥后，购买调用 purchaseDelivered，由独立发送账户 C 自动向官方 Hub 发出 TAP-10 查看链接；图片密钥只在 URL fragment。
- 无容器/未绑定时明确提示并使用普通钱包 RSA 包装交付；有效容器路径故障会在付款前拒绝，不悄悄收费或静默降级。
- operator 与 C 分离。operator 只签就绪凭证，C 持有发件容器并只存少量 OKB，owner/treasury 为用户自己的钱包。
- 免费聊天不上链，不逐条付 gas；平台服务会接触消息和图片密钥，不宣传端到端加密或防截图。阅后即焚是限时展示，不能撤回已保存内容。

## 合约与存储

主网工具仅部署 SnapVaultDirect；旧 purchase 不可绕过交付检查。onlyOwner 轮换 operator、Ownable2Step、15% 费率上限、OKB/标准白名单代币、owner 补资全额退款。退款不侵占其他记账，也不自动证明链下故障。

后端有持久增量订单索引、确认缓存、重组锚点与匿名限流。主网需显式开关、部署哈希和角色验证；存储 master 从环境读取，单独备份密钥加密完整恢复快照，主网要求异地 HTTPS PUT 存储。

## 检查

```sh
npm ci --ignore-scripts
npm run test:all              # 所有本地链/服务/浏览器回归；需要 Chrome、Python 3
npm run prepare:deployment    # 只编译并导出 ABI，不发交易
npm run build:app -- --api https://API_ORIGIN --allow-mainnet
```

`test:all` 只创建自己的本地服务（5210–5213，Hub 浏览器测试 5182/5197），结束会清理；不连接用户钱包或发主网交易。验收记录 `deployment/hardening-all-tests.json` 必须区分本地、公共测试网和主网。

发布顺序、钱包部署页、备份恢复和主网门禁见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。参赛规则核验见 [docs/CONTEST-CHECKLIST.md](docs/CONTEST-CHECKLIST.md)；测试通过不等于主办方资格审批。
