# 本地修复与发布前验收（2026-10-19，第二轮）

本轮范围：基于 c5a0e9e 的既有前端修复。未部署、未上传 DeWEB、未操作用户钱包签名、未广播主网交易。网关仍为原入口。本轮 OKB 支出为 0。

## 对照清单

1. 未加载配置前，主网相关初始文字统一为“正在连接 X Layer 主网…”。只有配置校验与初始服务读取成功后才显示实际网络、币种。连接服务器失败或配置未就绪时点击连接，常驻提示“暂时连不上服务器，请检查网络或开启代理后刷新”。超过原 toast 的 4 秒生命周期仍可见；配置与交易安全检查保留。配置请求超时受控，缓存登录也不能绕过交易就绪检查。
2. OKX Connect 显式使用 openUniversalUrl:false。连接 URI 仅设置到 target=_blank、rel=noopener noreferrer 的链接，不自动离开本站。测试同时核对当前页面 URL 不变、链接在新窗口打开。
3. 远程 personal_sign、typed-data、交易和切网请求均显示“请到 OKX App 中确认”，只有按钮点击才调用 openWallet()。SDK 拒绝码 300/301、EIP-1193 拒绝码、超时都有明确提示；失败提示保留在页面。交易请求超时且未知哈希时记录“不确定”状态，阻止直接重复广播，须先核查钱包记录。
4. 电脑显示安装 OKX Wallet 插件后刷新的指引；手机显示可用 OKX App 的 Web3 内置浏览器打开本站。没有增加二维码依赖。
5. 所有浏览器启动共用 scripts/browser-test-config.cjs：仅从 CHROME_PATH 读取可选路径；没有则由 Playwright 选择自带 Chromium。原先写死 /private/tmp 的截图及结果改用 os.tmpdir()。仓库中的既有命名截图证据仍按原用途保留。
6. ethers 已从 devDependencies 移入 dependencies 并更新锁文件。Docker 运行阶段独立执行 npm ci --omit=dev，不再复制构建阶段的全部 node_modules。已在隔离临时目录实际验证生产安装、ethers 和服务模块导入，hardhat/playwright 不在生产安装中。本机没有 Docker，未声称已实际构建 Linux Docker 镜像。
7. publicTestnetV2Verified 从已保存的真实测试网验收记录推导，并比对当前 SnapVaultDirect artifact、链号、合约地址、双钱包、交易哈希及图片哈希。当前记录可匹配，因此为 true；注明本轮没有重新查链或重新做测试网交易。缺记录返回 unknown，错误链返回 false。它与本轮本地测试状态分开记录。
8. localRefresh 只有身份或服务数据改变时才通知重绘，不再每两秒无条件重建聊天操作区。市场测试每轮使用唯一标题，取消购买比较前后订单集合，检查当前商品订单而非要求整个服务零订单。test:all 在同一个已存在服务上连续跑两次，保留真实购买/解密/交付校验，不通过 force 点击或无限重试隐藏失败。

## 可复现测试

跨平台默认步骤：

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:all
```

有已安装浏览器时，可显式设置 CHROME_PATH 后执行 npm run test:all。本轮使用本机 macOS Chrome；没有把 macOS 结果写成 Linux 实测。最新总结果见 deployment/hardening-all-tests.json，页面状态专项见 deployment/wallet-readiness-browser-tests.json，生产依赖见 deployment/production-dependencies-check.json。

所有链上付款、签名和官方 Hub 测试均在隔离本地链使用公开测试账户；不涉及用户主网钱包。手机 UA/尺寸仿真只验证加载、SDK 初始化、UI 和模拟会话，不算真 iPhone 上 App 切换成功。

## 真 iPhone 发布前门禁

用户目前要求不签名、不上传且已休息，因此以下验收不能自行完成。deployment/real-iphone-acceptance.json 继续保持 PENDING。

必须在同一版本、可供真手机访问的 HTTPS 候选地址上，分别用 iPhone Safari 与 OKX App Web3 内置浏览器完成：打开 → 连接钱包 → 经用户批准后签名登录（0 OKB）→ 切到 X Layer 主网（不发送链上交易）→ 进入购买页但不付款。每个环境各留截图，隐藏敏感查看链接、签名内容和账户私密资料。没有真机截图前不能宣称完成手机验收，也不恢复 DeWEB 上传。

当前新版仅在本地候选目录，没有偷偷创建公网预览或部署后端。手机也不能把 127.0.0.1 当成本机开发服务器；后续需经用户同意安排 HTTPS 预览入口。本轮没有安装手机证书、开公网隧道或替换公开网页。

## 费用

最新候选目录为 dist/mobile-candidate，原 dist/wallet 与已冻结发布目录保持不变。最终报价取 deployment/mobile-release-cost-readonly.json：只读核对链上现有文件、复用相同内容、估算差量存储操作；不是上传授权或保证发票。旧 0.006 OKB 修复预算余额单列，不重复算成新增额度。

登录、切网、读取 TapeSend 已有消息不需要 OKB；涉及用户签名仍需先获得确认。不重新发信，不新开容器，不做主网退款或重复购买。本轮无新增订阅、服务器部署或套餐升级。

## 最终结果

最终 npm run test:all 共 11 套测试通过，含 59 项合约/服务检查、12 项连接与交易保护单测、23 项钱包网页检查；同一服务的市场流程连续两轮通过。远程登录拒绝后清理旧会话，再次连接的网页回归也已通过。

最后只读报价：38 笔差量操作，当前存储模型约 0.003390996809549832 OKB；gas 数量和价格分别留 20% 余量后约 0.004883035365059798 OKB。旧修复预算按已存上传记录还剩 0.001636877601843891 OKB，新模型超过余额约 0.003246157763215907 OKB。该报价不包含任何重新发信或开容器，本轮没有恢复上传。
