# SnapVault · 阅后即焚私密付费内容（X Layer × TapeOut 黑客松模板）

## 怎么跑
```bash
npm install
npx hardhat test                       # 合约测试，6 个用例
python3 -m http.server 5173 -d web     # 前端：浏览器打开 http://localhost:5173
```
- 前端是纯静态页面（原生 JS 加 ES Module），不需要构建。
- 演示模式完全离线，不需要钱包：先在「我是创作者」上传图片，再去「粉丝广场」付款解锁，看几秒后内容自动焚毁。
- 私聊（仿 XChat）：左边是会话列表（私信和群聊，带未读数、最后一条消息、时间），右边是聊天窗口。用「当前身份」下拉框在 小鹿（创作者）、演示粉丝、阿杰、Mia 之间切换；开两个标签页也能互相看到。👥 加好友，✉️＋ 新建私信或群聊。
- 截图脚本：`scripts/demo-screenshots.mjs`、`scripts/chat-screenshot.mjs`，需要 playwright。截图在 `screenshots/`。

## 哪些是真的，哪些是模拟
| 部分 | 状态 |
|---|---|
| 合约 `contracts/SnapVault.sol`：上架、支持原生 OKB 和 ERC20 付款、平台抽 10%（上限 30%）给 treasury、记录访问过期、限量、下架、创作者提现、Purchase 事件 | ✅ 真实实现，测试全部通过。**没有审计，也没有部署** |
| 浏览器本地 AES-GCM-256 随机密钥加密和解密 | ✅ 真实实现（WebCrypto） |
| 限时查看、粉丝地址水印、到时间撤销 URL、丢掉密钥和明文引用 | ✅ 真实实现。注意截图和录屏没法阻止 |
| 密文存储 | 🟡 模拟：用 localStorage 代替 IPFS。TODO：换成 IPFS pinning，或者用 HashPort 写进 TapeOut 容器 |
| 密钥投递 | 🟡 模拟：用 localStorage/sessionStorage 代替 TapeSend。TODO：链下服务监听 `Purchase` 事件，再用 TapeSend（TAP-10：X25519 + XChaCha20-Poly1305）把密钥加密发到粉丝容器 |
| 钱包模式 | 🟡 能连钱包（会从 CDN 加载 ethers v6），但 `web/app.js` 里的 `CONFIG.contract` 和 `CONFIG.usdt` 是空的，不填就还是走模拟。链上模式还没有端到端测过 |
| 私聊界面（`web/chat.js`）：私信、群聊、未读数、新建会话 | ✅ 前端真实实现，数据存在 localStorage |
| 创作者付费粉丝群 | 🟡 门控是模拟的：读取演示模式的 `purchases` 购买记录（阿杰预置为已购买）。TODO：改成读取合约的 `Purchase` 事件或 `hasAccess` |
| 群聊端到端加密 | 🟡 模拟：每个群一把 AES-GCM-256 群密钥，管理员用 ECDH P-256 给每个成员各包裹一份。TODO：改用 TAP-10（X25519 + XChaCha20-Poly1305）；成员变动时轮换群密钥（现在没做）；群消息要逐个成员发，gas 会随人数线性增长 |
| 阅后即焚 | ✅ 每个查看者各自焚毁：看一次就本地丢掉明文，所有成员都看过之后才删除密文。⚠️ 链上的密文删不掉，客户端改一改就能绕过 |
| 截图设置（会话级和单条消息级）：允许 / 禁止 / 截图通知 | 🟡 尽力而为。「禁止」会模糊内容、加水印、禁用右键和选中，窗口失焦或切走时遮住内容。「通知」靠 PrintScreen 或 Cmd+Shift+3/4/5 按键，以及查看焚毁消息时切走页面来判断，然后在会话里发一条系统提示。**浏览器拿不到真正的截图事件**：手机系统截图、外接相机拍屏、开发者工具都检测不到，也拦不住 |
| 好友（短 UID 或钱包地址 → 发请求 → 对方接受 → 才能私信） | 🟡 模拟：UID 由地址算出来，请求存在 localStorage。TODO：UID 和地址的映射放到链上注册表，或者做成类似 ENS 的解析，最后解析到 TapeSend 地址；好友请求本身是公开的 TapeSend 消息，需要防骚扰（付费请求、限频、黑名单） |
| 合约的 `hasAccess` 只是一条记录 | ⚠️ 链上的过期时间管不住已经发出去的密钥。真正的门控要靠投递服务，只在没过期的时候发密钥 |

## 部署到 X Layer（自己部署，仓库里没有任何私钥）
- 网络参数（2026-10-16 用 eth_chainId 实测）：
  - 主网：chainId 196，RPC `https://rpc.xlayer.tech`
  - 测试网：chainId 1952，RPC `https://testrpc.xlayer.tech/terigon`
```bash
export DEPLOYER_KEY=0x...   # 只放在本机环境变量里
export TREASURY=0x你的平台收款地址 FEE_BPS=1000
npx hardhat run scripts/deploy.js --network xlayerTestnet
```
- 部署后把地址填进 `web/app.js` 的 `CONFIG.contract`。
- X Layer 上的 USDT 地址请自己去官方浏览器核实后再填。

## TapeOut 接在哪里
1. **DeWEB 托管前端：** 把 `web/` 整个目录通过 HashPort 或 TapeNow 上传进你的电路容器（X Layer 开容器要 0.08 OKB），之后用 `tape://<电路>.<区号+处理器>.tape` 打开。
2. **TapeSend 投递密钥：** 替换 `app.js` 里的 `KeyVault.deliver` 和 `takeFromInbox`，接收地址就是粉丝的容器 endpoint。
3. **TapeCode：** 可以用它重新生成或改写合约，让合约归你的电路容器所有（容器地址作为构造函数第一个参数）。现在的合约用 Ownable，需要改造才能适配。
4. **大图永久存储（可选）：** 密文写进容器。单个文件最大 8.4 MB，按每块 24,000 字节存储。数据来自社区编写的 TapeOut 新手指南，未经官方确认。

## 私聊接入 TapeSend 的 TODO
- 实现 `TapeSendTransport`（接口：convs、saveConv、send、list、markViewed），替换 `chat.js` 里的 `T`。身份密钥改成由钱包签名派生的 X25519 密钥，对方公钥从 TapeSend 读取。
- 阅后即焚的限制：链上消息删不掉，「焚毁」只能在客户端丢掉密钥和明文。更稳的做法是链上只发指针加一次性密钥，密文放在链下，读完就删。
- TapeSend 的元数据（谁发给谁、什么时间、消息多长）是公开的。陌生人可以往信箱里塞消息，需要做付费门槛或白名单。TAP-10 目前还是草案，接口可能会变。
- 群聊：TapeSend 是一对一的，群消息要逐个成员发，或者链上只发指针、密文放链下。成员变动时要轮换群密钥。会话元数据（谁在哪个群）也会公开。

## 待确认问题
1. TapeSend 单条消息的大小上限是多少，每条消息或每 KB 的 gas 是多少？
2. X Layer 上网站仓库合约的地址是多少？（指南里的 Issue #6 说 X Layer 用的是另一个地址）
3. 赛事规则是否允许把密文放在 IPFS（链下）？

## 已知限制
- 拦不住截图，也删不掉已经泄露的明文。
- TapeSend 的元数据（谁发给谁）是公开的。
- 演示模式的数据存在 localStorage，换一个浏览器就看不到了。
- 合约没有审计，不要直接拿来放真钱。
