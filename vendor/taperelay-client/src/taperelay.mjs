// TapeRelay 客户端库（@taperelay/client 的入口；D-514、D-518、D-519）。2026-10-29 由主编写窗口从 index.mjs 分出（CHANGELOG 第 454 条）。
// 三层里的下面两层：公共的文件格式（切块、清单、加密文件和信封、网站目录），和 TapeRelay（身份与签名、会话密钥、发现文件、
// 上传认领读取对象、页面里核对着播放、分享链接、签名指针、收件箱和通知、服务器消息、运营方信息和注册表）。
// 这里的模块一个都不引用 TapeStore 那一层（client/test/test-layers.mjs 核对）。
// 普通 JavaScript（D-094），浏览器和 Node.js 都能用；只用 @noble 库，ABI 编解码用 TapeKit 内核的。
// 会话密钥和钱包相关的代码与网页内核分开（TapeRelay Security Considerations）：网页拿不到会话密钥的私钥。
export * from './core.mjs';
export { authorizeSession, sessionAuth, walletAuth, signedHeaders, signRevocation, serverUrl } from './session.mjs';
export { eip1193Wallet, keyWallet } from './wallet.mjs';
// 2026-10-29（TapeRelay §8.7，D-520）：开发者密钥（最长 366 天的带范围授权，写成 trk1_ 开头的一串）
export { DEV_KEY_PREFIX, NO_DEVELOPER_KEY_MESSAGE, DEVELOPER_KEY_REFUSED_MESSAGE, SESSION_REFUSED_MESSAGE, SCOPE_TEXT, refusedMessage, developerKeyExpiredMessage, checkDeveloperKeyExpiry, createDeveloperKey, parseDeveloperKey, developerKeyAuth, describeDeveloperKey, serversOfKey } from './devkey.mjs';
export { createClient, TapeRelayError } from './client.mjs';
export { layout, sourceOf, planPublicFile, indexObjectsOf, parseManifest } from './files.mjs';
export { CHUNK, FANOUT, MAX_MANIFEST, contentTypeOf } from './manifest.mjs';
export { ENCRYPTED_CHUNK, layoutOf, checkManifest } from './manifest.mjs';
export { uploadFile, checkAborted } from './upload.mjs';
export { readObject, readFile } from './read.mjs';
export { SITE_CHUNK, SITE_MAX_CHUNKS, SELECTORS, fileInfo, readSiteFile, writeSiteFile, fallbackPath, setFallback } from './siteregistry.mjs';
export { planSitePublish, executeSitePublish } from './sitepublish.mjs';
// 第 150 条（阶段 3 第 1 步）：加密密钥对和加密文件（TapeRelay §4.4、Files §5.1～Files §5.6、Files §5.7）、私钥的备份与转移（Files §6.2～Files §6.4、TapeRelay §4.5）
export { checkPublicKey, publicKeyOf, sealBox, openBox } from './sealedbox.mjs';
export {
  generateKeyPair, keyString, parseKeyString, signEncryptionKey, checkRecipientKey, ownKeyStatus, selfKeyOf, chunkAad, indexAad, encryptObject, decryptObject,
  lastChunkPadTarget, slotPadTarget, openChunk, openIndex, commitmentOf, buildEnvelope, openEnvelope, planEncryptedFile, readEncryptedFile,
  resumableOf, planEncryptedResume,                // 第 409 条（I-351）：接着传没传完的加密文件
} from './encrypted.mjs';
// 2026-11-07（网关入口 G1，D-650、D-665、D-666）：按文件钥匙打开加密文件；分享链接
export { openEnvelopeWithKey, openEncryptedFileWithKey, readEncryptedFileWithKey } from './encrypted.mjs';
export { shareLink, parseShareLink, parseSharePath, parseFileKey, checkKeyServer } from './sharelink.mjs';
// 2026-11-08（前端第 3 步，D-681、D-682）：播放器组件、不用 Service Worker 的边下边播、边解密边存盘的下载、把播放器复制进自己的容器网站
export { mountPlayer, chunkedReader, explainError, pickLang, serversOf, PLAYER_TEXT, PLAYER_MEMORY_MAX } from './player.mjs';
export { streamMedia, openSource, mediaSourceClass } from './mediasource.mjs';
export { saveFile, cleanupTempDownloads, downloadBlob, SAVE_MEMORY_MAX } from './savefile.mjs';
export { listSitePaths, readSiteFiles, planCopySite } from './sitecopy.mjs';
export {
  CROCKFORD, BACKUP_MIN, BACKUP_MAX, newRecoveryCode, newPairingCode, normalizeCode, passphraseFromRecoveryCode, passphraseFromUser,
  makeKeyBundle, checkKeyBundle, deriveBackupKey, writeBackup, readBackup, pairingRequest, parsePairingRequest, pairingNumber, sealKeyBundle, openKeyBundle,
  importPairedBundle,
} from './keybackup.mjs';
// 第 154 条（阶段 3 第 3 步）：文件通知（TapeRelay §9.8）；判断本机、内网地址（网关也用）。
// 第 286 条（收件箱改造，D-225、D-237）：通知改经本协议自己的收件箱（inbox.mjs）；原来的 TapeSend 通道（tapesend-channel.mjs）、
// 「直接发」的核对（tapesend-direct.mjs）和只用于 TapeSend 的提示、标明都从客户端库去掉（原来挪给主网检查的旧脚本用，D-604 连同那些脚本删了）
export { isLocalHost } from './hosts.mjs';
export {
  // 2026-11-07（D-649、D-655）：一律加密：PROMPT_UNENCRYPTED、manifestObjectOf、sendAdvice 去掉；发之前用 requireRecipientKey 核对对方的加密公钥
  MARK_FROM_MISMATCH, MARK_SESSION_SIGNED, requireRecipientKey, checkNoticeServers,
  serverNameOf, prepareReceived, openNoticedFile, saveToOwnSpace,
  fileObjects,                                                       // 第 225 条（D-166）：一个文件用到的全部对象
} from './notices.mjs';
// 第 295 条：mergePulled（合并几次拉到的，I-222）、verifyPulled（同一编号的几份逐份核对，I-224）
export { makeNotice, noticeIdOf, signNotice, submitNotice, deliveryStatus, pullInbox, mergePulled, markRead, verifyNotice, verifyPulled,
  sealNoticeBody, openNoticeBody, pullSent } from './inbox.mjs';   // 2026-11-07（D-654）：短消息直接带密文；D-659：pullSent 拉「已发送」
// 2026-11-07（D-649、D-653～D-655）：直接放在消息里的密文（免费层、电路之间的通知、服务器消息同一种写法）
export { SEALED_BODY_MAX, sealBody, openBody } from './sealedbody.mjs';   // sealedBodyOk、NO_KEY_MESSAGE 照旧经 selfmsg.mjs 转出（下面）
// 2026-11-07（D-659）：通知里直接带的内容用小信封（收件人、发件人各一份钥匙）
export { INLINE_LABEL, sealInline, openInline } from './sealedbody.mjs';   // inlineBodyOk 经 selfmsg.mjs 转出（下面）
// 2026-10-29（TapeRelay §9.10，D-503）：服务器消息（服务器自己发的告警、关服通知、公告；不签名，不是通知）
export { checkPulledMessage, pullServerMessages, markServerMessagesRead, openServerMessageFile, serverMessageId } from './servermsgs.mjs';
// 第 291 条（D-249）：上传公开文件之前查有没有像密钥的东西（只给种类和行号）
export { scanForSecrets } from './secretscan.mjs';
// 第 196 条（阶段 4）：价格说明、运营方登记表（TapeStore §5.3、TapeRelay §10.3）
export { pricingView, parseOperatorList, checkOperator } from './operators.mjs';
// 第 308 条（TapeRelay §10.3、TapeRelay §10.5；D-201、D-263）：/v1/info 的 exit（付款前核对编号的 payableOperator 在 TapeStore 一侧，tapestore.mjs）
export { exitView } from './operators.mjs';
// 第 308 条（TapeRelay §10.3、TapeRelay §10.4；D-268、D-272）：读官方注册表（在保、退出）
export { REGISTRY_SELECTORS, STAKE_STATUS, officialRegistry, readStanding } from './registry.mjs';
// 第 383 条（TapeRelay §10.3 第二版，D-423、D-431）：链上的运营方目录、两头核对、/v1/info 写的运营方编号
export { DIRECTORY_SELECTORS, readServersOf, readDirectoryIds, readOnchainOperators } from './registry.mjs';
// 2026-10-30（D-523）：每条链各一整套合约：官方公布的表取一条链（officialOn）、/v1/info 的 pricing.payments 按列表读（paymentsList）
export { officialOn } from './registry.mjs';
export { paymentsList } from './operators.mjs';
export { operatorIdOf, checkOnchainOperator } from './operators.mjs';
// 第 384 条（TapeRelay §10.4，D-433）：开着的强制截止
export { readCutoff } from './registry.mjs';
// 2026-10-31（D-563）：一次读很多条链（Multicall3；没有时一个一个读）
export { MULTICALL3, MULTICALL3_CODEHASH, MULTICALL_SELECTORS, MAX_ONE_BY_ONE, encodeAggregate3, decodeAggregate3, callMany, batched } from './multicall.mjs';
// 第 199 条（阶段 5）：发现文件（TapeRelay §4）
export { DISCOVERY_PATH, DISCOVERY_MAX, parseDiscovery, discoveryJson, serverEntryOf, readDiscovery } from './discovery.mjs';
// 第 262 条（阶段 6，D-203、D-212）：同时传到几台（核对副本、补缺的在 TapeStore 一侧，tapestore.mjs）
export { uploadToServers } from './upload.mjs';
// 2026-10-22（TapeStore §3，D-336、D-342、D-345）：随机挑 3 家；模板 A 的浏览器直传（后台逐个请求签名）
export { pickOperators } from './operators.mjs';
export { remoteAuth, createRemoteSigner } from './remote.mjs';
// 第 312 条（TapeRelay §7.3，D-252、D-265、D-283）：签名指针（名字不变、内容可以换新的版本）
export { POINTER_NAME, POINTER_KINDS, MARK_POINTER_SESSION, MARK_POINTER_CONFLICT, makePointer, signPointer, publishPointer, verifyPointer, readPointer } from './pointers.mjs';
// 免费消息层（自主身份）：不要电路、不碰存储、不读链，收件人批准过才收得到（selfmsg.mjs）
// 2026-11-07（D-652～D-656）：内容一律加密（makeSelfNotice 要收件人的公钥、openSelfNotice 打开）、公开和取加密公钥、拉黑、准入
export { newSelfIdentity, selfAuth, nodeOf, makeSelfNotice, signSelfNotice, verifySelfNotice, openSelfNotice, submitSelfNotice,
  listSenders, updateSenders, subscribeNotices, publishSelfKey, fetchSelfKey, updateAdmissions, sealedBodyOk, NO_KEY_MESSAGE,
  inlineBodyOk, listSent } from './selfmsg.mjs';   // D-659：小信封的格式检查、「已发送」
// （isSelfAccount、selfKeyOf 等等第 7 行的 export * from './core.mjs' 已经带出去了）
// 2026-11-13：上传前把 MP4、MOV 的目录挪到文件开头（边下边播不用先取文件末尾）
export { faststart } from './faststart.mjs';
// 2026-11-17：TapeKit 内核的 createKernel 从根入口导出（读链用：serversOf(createKernel(), '1.2.0')），开发者不用从 vendor 子路径引；
// 打包时 tools/pack-sdk.mjs 把这一行改写成 ../vendor/tapekit-kernel/index.js
export { createKernel } from '../vendor/tapekit-kernel/index.js';
