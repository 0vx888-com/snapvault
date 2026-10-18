> 当前预算请看 [DEWEB-RELEASE-BUDGET.md](DEWEB-RELEASE-BUDGET.md)：包含网站、发送 C、演示买家三个容器及真实 dist/wallet 大小；旧双容器成本不适用。

> 2026-10-18 更新：最新发布/交付架构以 [DEPLOYMENT.md](DEPLOYMENT.md) 为准。TapeSend 已要求接入正式交付，普通无容器交付为明确提示的回退；本文旧预算与“可选”描述只作历史记录，不是当前上线证明。

# SnapVault 主网接法与预算（历史双容器方案）

> 已被用户最新确定的 docs/MVP-PLAN.md 替代。普通用户不要求容器、TapeSend 可选、前端必须 DeWEB；约 27 美元旧方案不再作为当前总预算。底层只读费用记录仍可参考。

> 最新范围修正：用户已明确要求正式前端必须部署到 X Layer DeWEB。下文约 27 美元的旧预算按 HTTPS 前端计算，未覆盖必需的前端上链上传／更新 gas，不能作为完整交付总价。须补算前端实际发布包、SiteRegistry 分块写入、名称激活与网关兼容；发送容器能否兼作网站容器需要按持有账户与权限确认，不预先按增加一个容器收费。

核验日期：2026-10-16；链号 196；协议费钉住区块 73392316；gas/数据费为最新状态模拟。无签名、无广播、无充值、无新账户或付费资源。

## 预算

平台发送账户一个容器 + 一位买家一个容器；使用既有处理器，不自建；原生 OKB 测试小额商品，图片不上链；前端先用 HTTPS，不强制 DeWEB。

| 项目 | OKB | 性质 |
|---|---:|---|
| 2 个容器开通 | 0.16 | 官方与 dRPC 同块读取 FEE()=0.08 |
| 2 次电路流片 | 0.0026 | TAPEOUT_FEE()=0.0013 |
| 2 次晶体管铸造协议费 | 0.00132 | protocolFee()=0.00066；假设每个 NFT 用一个 NAND、分别铸造 |
| 晶体管本身 | 0–0.00132 | 抽查 CPU340 为 0、CPU341–343 为每个 0.00066；均有余额。不是对处理器的安全背书，需付款前复核 |
| Checkout 部署执行费估算 | 0.000039458861972943 | 约 1972943 gas，未实际部署 |
| 小密钥消息执行费估算 | 0.000003491940174597 | 414 字节实际 TAP-10 封包，174597 gas；历史持有人身份仅用于 eth_estimateGas |

协议基础小计 0.16392–0.16524 OKB，加公钥发布、上架、付款、提现等 gas 后，建议链上预算预留 0.18 OKB。OKX 公开行情抓取 119.61 USDT/OKB，行情时间戳 1792161495933，折合约 21.53 美元。主网 gasPrice 当时为 20000001 wei；GasPriceOracle 对样例未签名编码返回数据费 0，仅为当前报价，不保证未来总费。月费 monthlyFee() 当前为 0，不能据此承诺永久免费。CPU0 的晶体管已售罄，不能再照它的零单价直接给购买承诺。

每位全新买家若沿用当前官方收信路线，还要约 0.082–0.083 OKB（约 9.8–9.9 美元）取得并开通容器、发布公钥；已经有合适已开通容器的用户可以复用。商品价是转给创作者的钱，不是基础设施消耗。平台代付开通费是补贴成本，不会消失。

Pinata 当前免费方案：1GB 存储、500 文件、10GB 月流量、10K 请求、1 网关；升级示例 Picnic 为 20 美元/月。正式开通前仍须确认账户可用的 public IPFS 上传与网关额度。后端持久化服务示例 Railway Hobby 最低 5 美元/月（含 5 美元使用额度，超额另计）。因此双人演示第一月规划约 27 美元起：链上预留约 21.5 + 后端 5，IPFS 用免费额度；不含域名、桥接／交易所提币、购买图片本金和资源超额。如果上 IPFS 付费档，第一月约 47 美元起、后续约 25 美元/月起另加 gas。上述不是已批准花费。

## 官方 TapeSend

官方 TAP-10 已有 Draft v1.1（2026-09-28 更新），不是仍在等待第一次新版公布。当前主网 Hub 为 0xe61a9c7213a6aa616c246a2b569e555b417b25ee。send 要求 ownerOf(tokenId)==msg.sender，单纯 approve 不能直接代发；授权合约短暂借入 NFT 的方式有客户端提示与额外风险，不作为 MVP 接法。TAP-11 的签名委托不修改 Hub 的写权限。

最小接法：平台独立 C 账户持有发送容器，持久化服务监听付款，严格核对官方实现与多运营方公钥读取后封装 TAP-10，C 自动发送。买家在官方 TapeSend 发布公钥并启用 X Layer 收信位，付款前检查其收信条件。付款后去官方收件箱点链接，返回 SnapVault 解密；不能继续把本地服务替买家解密收件箱的测试方式当成生产方案，不索取买家的 TapeSend 私密签名。

源码模块名 @tapekit/send 与 @tapekit/kernel 存在，但公共 npm registry 查询 latest 当前均为 404；沿用固定官方 Git commit 40994bd65baedbda4df72cb0985031a5f082f606 的源码，不能承诺 npm install 可用。Hub send 无原生币额外协议费，仅 gas；不要把容器 execute 的收费误加到直接 send 上。

## 公共网关

上传前加密，上传 public IPFS 的只有密文，记录 ipfs://CID 和密文 SHA256；平台保存交付密钥，TapeSend 仅传加密查看链接，密钥在 URL fragment 中，不给 IPFS 网关。浏览器拿到密文后核对链上承诺的 SHA256 并 AES-GCM 解密；CID 与文件原始字节 SHA256 不能简单当成同一个字段。

采用自己账户的 Pinata 固定存储与专属网关，公共 ipfs.io/dweb.link 仅作备选；本次用官方 Pinata 文档中的公开 CID QmaHVPUAt5iqhCGHgMcbyRh4dkcoFNod8B38ZUaZ3urxRU 试取，两者都返回 429，故没有把它们计为已验证可用。尚未上传我们自己的密文 CID、未完成跨设备验证。网关 CORS 与限流、第二份 pin、HTTPS 后端与密钥持久化均要上线前验收。每 MB 在 IPFS 不付 X Layer 上传 gas；存储和下载按服务商额度计费。阅后到期只能停止服务／展示，不能收回已传播的密钥与内容。

## 参赛判断

官方规则要求实际使用 X Layer 的 TapeOut 电路、合约或链上数据并提交地址；允许界面等链外运行、使用现有工具，不强制自建处理器或把所有前端上传 DeWEB。按 HTTPS 前端 + X Layer 付款合约 + 官方 X Layer TapeSend + IPFS 密文接法，架构方向符合所列技术条件，但最终资格由主办方审核。

当前仅测试网独立付款与本地完整交付，尚不能说已满足实际生态集成。正式提交前需：真实 X Layer 主网官方容器与 Hub 交付回执、官方客户端收信解密、公共网关跨设备还原、实际访问链接、地址清单、活动期新增说明，以及目标用户、触达、商业模式和留存说明。不声称 100% 链上、绝对防截图或已通过参赛审核。

## 来源

- https://web3.okx.com/zh-hans/xlayer/build-x-series
- https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-10.md
- https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-11.md
- https://github.com/TapeOutProtocol/TapeKit/blob/40994bd65baedbda4df72cb0985031a5f082f606/kernel/src/config.js
- https://github.com/TapeOutProtocol/TapeKit/blob/40994bd65baedbda4df72cb0985031a5f082f606/send/contracts/src/DeWebHub.sol
- https://docs.pinata.cloud/files/uploading-files
- https://pinata.cloud/pricing
- https://docs.ipfs.tech/how-to/gateway-best-practices/
- https://railway.com/pricing
- https://web3.okx.com/nl/onchainos/dev-docs/xlayer/developer/build-on-xlayer/contracts
- https://www.okx.com/api/v5/market/ticker?instId=OKB-USDT

原始 eth_call 与 estimateGas 记录：deployment/xlayer-mainnet-budget-readonly.json。
