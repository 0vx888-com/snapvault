// Shared TapeRelay large-media base for Stories, paid unlock and chat attachments.
// Official client APIs only. Developer trk keys stay on the server. Default off.
// Ciphertext is uploaded from the client to nodes (or the local mock) in 1 MiB objects;
// this process signs upload/claim and later issues the file key after authorization.
import {randomBytes, createHmac, timingSafeEqual} from 'node:crypto';
import {
  ENCRYPTED_CHUNK,
  layoutOf,
  createRemoteSigner,
  developerKeyAuth,
  generateKeyPair,
  keyWallet,
  newPrivateKey,
  normalizeCircuitInput,
  openEnvelope,
  parseDeveloperKey,
  publicKeyOf,
} from '../vendor/taperelay-client/src/taperelay.mjs';
import {createMockRelay} from './taperelay-mock.mjs';
import {acceptedFriends,listHasAddr,sameAddr} from './addr.mjs';

export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
export const MAX_ENVELOPE_RECIPIENTS = 16;
export const MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf', 'application/zip', 'application/octet-stream']);
export const SCENES = Object.freeze(['story', 'post', 'paid', 'chat']);
const SESSION_MS = 2 * 60 * 60 * 1000;
const fail = (message, status = 400) => { throw Object.assign(Error(message), {status}); };
const HEX64 = /^[a-f0-9]{64}$/;
const enabledFrom = (env) => env.TAPERELAY_MEDIA_ENABLED === '1' || env.SNAPVAULT_TAPERELAY_MEDIA === '1';

function parseMaxBytes(raw, fallback = DEFAULT_MAX_BYTES) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > 5 * 1024 * 1024 * 1024) fail('TAPERELAY_MEDIA_MAX_BYTES 无效');
  return n;
}

function parseServers(raw) {
  if (!raw) return [];
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function selfSecretBytes(value) {
  if (typeof value !== 'string') return null;
  if (/^[a-fA-F0-9]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === value ? bytes : null;
}

function httpsTransports(servers, parsedKey) {
  const authorized = new Set(parsedKey?.session?.delegation?.delegation?.servers || []);
  return servers.map((server) => {
    const alias = server.replace(/:\d+$/, ':443');
    // Same hostname only, and only when the holder explicitly signed the alias.
    return authorized.has(alias) ? alias : server;
  });
}

export const DEFAULT_USER_QUOTA = 1024 * 1024 * 1024;
export function objectBudget(size) {
  const layout = layoutOf(size, ENCRYPTED_CHUNK);
  if (!layout) return 0;
  return layout.n + 1 + layout.lower + 1;
}


function toPublicKey(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return null;
  return bytes;
}

export function loadMediaSettings(env = process.env, overrides = {}) {
  const enabled = overrides.enabled ?? enabledFrom(env);
  const maxBytes = overrides.maxBytes ?? parseMaxBytes(env.TAPERELAY_MEDIA_MAX_BYTES);
  const userQuota = overrides.userQuota ?? parseMaxBytes(env.TAPERELAY_MEDIA_USER_QUOTA_BYTES, DEFAULT_USER_QUOTA);
  const requestedMode = overrides.mode ?? env.TAPERELAY_MEDIA_MODE ?? '';
  const devKey = overrides.devKey ?? env.TAPERELAY_DEV_KEY ?? '';
  const circuit = normalizeCircuitInput(overrides.circuit ?? env.TAPERELAY_CIRCUIT ?? (requestedMode === 'live' ? '' : '1.2.0'));
  const servers = overrides.servers ?? parseServers(env.TAPERELAY_SERVERS);
  const selfSecret = overrides.selfSecret ?? env.TAPERELAY_SELF_SECRET ?? '';
  let liveError = null, parsedKey = null;
  if (devKey) {
    try { parsedKey = parseDeveloperKey(devKey); } catch (e) { liveError = '开发者密钥无法解析'; parsedKey = null; }
  }
  if (requestedMode === 'live' && !liveError) {
    if (!parsedKey || !circuit || !servers.length) liveError = 'live 模式需要 TAPERELAY_DEV_KEY、TAPERELAY_CIRCUIT 和 TAPERELAY_SERVERS';
    else if (parsedKey.session.account !== circuit) liveError = '开发者密钥与 TAPERELAY_CIRCUIT 不匹配';
    else if (!parsedKey.session.scopes.includes('objects')) liveError = '开发者密钥缺少存取文件权限';
    else if (parsedKey.session.notBefore > Math.floor(Date.now() / 1000) || parsedKey.session.expires <= Math.floor(Date.now() / 1000)) liveError = '开发者密钥尚未生效或已过期';
    else if (new Set(servers).size !== servers.length || servers.length !== parsedKey.primary.length || servers.some((s) => !parsedKey.primary.includes(s))) liveError = 'TAPERELAY_SERVERS 必须与开发者密钥中的主节点一致';
    else {
      const raw = selfSecretBytes(selfSecret);
      if (!raw) liveError = 'live 模式必须持久配置 TAPERELAY_SELF_SECRET（32 字节 hex 或 base64）';
      raw?.fill(0);
    }
  }
  const liveConfigured = !!(parsedKey && circuit && servers.length && !liveError && requestedMode === 'live');
  let mode = 'off';
  if (enabled) {
    if (requestedMode === 'live' && liveConfigured) mode = 'live';
    else if (requestedMode === 'live' && !liveConfigured) mode = 'off';
    else mode = 'mock';
  }
  const transportServers = mode === 'live' ? httpsTransports(servers, parsedKey) : ['mock.snapvault.local:4246'];
  return {
    enabled: mode !== 'off',
    mode,
    maxBytes,
    userQuota,
    circuit: circuit || null,
    servers: mode === 'live' ? servers : ['mock.snapvault.local:4246'],
    transportServers,
    signerServers: mode === 'live' ? [...new Set([...servers, ...transportServers])] : transportServers,
    liveConfigured,
    liveError,
    parsedKey,
    // Never returned to clients. Held only in this settings object on the server.
    _devKey: mode === 'live' ? devKey : '',
    _selfSecret: mode === 'live' ? selfSecret : '',
  };
}

function friends(service, a, b) {
  return acceptedFriends(service.state.friends, a, b);
}

export function mediaVisible(service, media, who) {
  if (media.expiresAt && media.expiresAt <= Date.now()) return false;
  if (sameAddr(media.creator, who)) return true;
  if (media.scope === 'public' && (media.scene === 'story' || media.scene === 'post')) return true;
  if (!who) return false;
  if (media.scope === 'friends') return friends(service, media.creator, who);
  if (media.convId) return (service.state.convs || []).some((c) => c.id === media.convId && listHasAddr(c.members, who) && listHasAddr(c.members, media.creator));
  return false;
}

export function installTapeRelayMedia(Service) {
  Object.assign(Service.prototype, {
    initTapeRelayMedia(overrides) {
      const settings = loadMediaSettings(process.env, overrides || this._tapeRelayMediaOverrides || {});
      this._tapeRelayMediaOverrides = overrides || this._tapeRelayMediaOverrides;
      this.tapeRelay = this.tapeRelay || {settings, signer: null, relay: null, keyPair: null, mockSignerKey: null};
      this.tapeRelay.settings = settings;
      this.state.mediaSessions ||= {};
      this.state.mediaFiles ||= {};
      if (!settings.enabled) {
        this.tapeRelay.signer = null;
        return;
      }
      if (settings.mode === 'mock' && this.policy?.mainnet) {
        this.tapeRelay.settings = {...settings, enabled: false, mode: 'off', liveError: '主网不能使用模拟存储，需配置真实电路和开发者密钥'};
        this.tapeRelay.signer = null;
        return;
      }
      if (!this.tapeRelay.keyPair) {
        if (settings.mode === 'live') {
          const raw = selfSecretBytes(settings._selfSecret);
          if (!raw) fail('TAPERELAY_SELF_SECRET 必须持久配置为 32 字节', 500);
          const secretKey = new Uint8Array(raw);
          raw.fill(0);
          this.tapeRelay.keyPair = {secretKey, publicKey: publicKeyOf(secretKey)};
        } else {
          this.tapeRelay.keyPair = generateKeyPair();
        }
      }
      if (settings.mode === 'live') {
        const raw = selfSecretBytes(settings._selfSecret);
        const expected = publicKeyOf(new Uint8Array(raw));
        raw.fill(0);
        if (!Buffer.from(expected).equals(Buffer.from(this.tapeRelay.keyPair.publicKey))) fail('已加载的媒体密钥与持久配置不同，请勿在运行中更换 TAPERELAY_SELF_SECRET', 500);
      }
      if (settings.mode === 'mock') {
        this.tapeRelay.relay = this.tapeRelay.relay || createMockRelay({name: settings.servers[0]});
        this.tapeRelay.mockSignerKey = this.tapeRelay.mockSignerKey || newPrivateKey();
        this.tapeRelay.signer = createRemoteSigner({
          wallet: keyWallet(this.tapeRelay.mockSignerKey),
          account: settings.circuit,
          servers: settings.servers,
        });
      } else {
        this.tapeRelay.relay = null;
        this.tapeRelay.signer = createRemoteSigner({
          auth: developerKeyAuth(settings._devKey),
          account: settings.circuit,
          servers: settings.signerServers,
        });
      }
    },

    configureTapeRelayMedia(overrides) {
      this.initTapeRelayMedia(overrides);
    },

    mediaEnabled() { return this.tapeRelay?.settings?.enabled === true; },

    mediaStatus() {
      const s = this.tapeRelay?.settings || loadMediaSettings();
      return {
        enabled: s.enabled,
        mode: s.mode,
        liveReady: s.mode === 'live',
        mockOnly: s.mode === 'mock',
        liveError: s.mode === 'off' ? (s.liveError || null) : (s.mode === 'mock' ? (s.liveError || '未配置真实电路和开发者密钥，当前只是本地模拟') : null),
        maxBytes: s.maxBytes,
        userQuota: s.userQuota,
        chunkBytes: ENCRYPTED_CHUNK,
        maxEnvelopeRecipients: MAX_ENVELOPE_RECIPIENTS,
        types: MEDIA_TYPES,
        scenes: SCENES,
        circuit: s.enabled ? s.circuit : null,
        servers: s.enabled ? (s.transportServers || s.servers) : [],
        primaryServers: s.enabled ? s.servers : [],
        selfKey: s.enabled && this.tapeRelay?.keyPair ? Buffer.from(this.tapeRelay.keyPair.publicKey).toString('base64url') : null,
        signPath: '/api/wallet/media-sign',
        testedOnPhones: false,
        expiryNote: '应用层过期后停止授权查看；节点上的加密对象不会立即删除，回收站约 7 天，对象至少保留约 30 天。',
      };
    },

    sweepMediaSessions() {
      const now = Date.now();
      for (const [id, session] of Object.entries(this.state.mediaSessions || {})) {
        if (session.expiresAt <= now || session.status === 'committed') delete this.state.mediaSessions[id];
      }
    },

    createMediaSession(body, who) {
      if (!this.mediaEnabled()) fail('大文件上传未启用', 404);
      this.limit('media-session:' + who, 12);
      this.sweepMediaSessions();
      const scene = body.scene;
      if (!SCENES.includes(scene)) fail('场景无效');
      const mime = String(body.mime || '');
      if (!MEDIA_TYPES.includes(mime)) fail('文件格式无效');
      if (scene === 'story' && !mime.startsWith('image/') && !mime.startsWith('video/')) fail('Story 仅支持图片或视频');
      const size = Number(body.size);
      if (!Number.isSafeInteger(size) || size < 1) fail('文件大小无效');
      if (size > this.tapeRelay.settings.maxBytes) fail(`超过当前产品上限（${this.tapeRelay.settings.maxBytes} 字节，可配置，尚未真机实测）`);
      const used = Object.values(this.state.mediaFiles || {}).filter((m) => sameAddr(m.creator, who)).reduce((n, m) => n + (m.size || 0), 0);
      if (used + size > this.tapeRelay.settings.userQuota) fail('超出当前账户的存储配额');
      const name = String(body.name || 'media').slice(0, 80);
      const scope = body.scope || (scene === 'chat' ? 'dm' : 'public');
      let convId = null;
      if (scene === 'chat') {
        const c = this.member(body.convId, who);
        convId = c.id;
      } else if (['dm', 'group'].includes(scope)) {
        const c = this.member(body.convId, who);
        if (scene === 'story' && c.type !== scope) fail('可见范围无效');
        convId = c.id;
      } else if (scene === 'story' && !['public', 'friends'].includes(scope)) fail('可见范围无效');
      else if (scene === 'post' && !['public', 'friends', 'dm', 'group'].includes(scope)) fail('可见范围无效');
      else if (scene === 'paid' && scope !== 'public' && !['dm', 'group'].includes(scope)) fail('可见范围无效');
      const id = 'ms_' + randomBytes(16).toString('hex');
      const session = {
        id, who, scene, mime, size, name, scope, convId,
        title: String(body.title || '').slice(0, 140),
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_MS,
        status: 'open',
      };
      this.state.mediaSessions[id] = session;
      this.save();
      const status = this.mediaStatus();
      return {
        sessionId: id,
        expiresAt: session.expiresAt,
        circuit: status.circuit,
        servers: status.servers,
        selfKey: status.selfKey,
        maxBytes: status.maxBytes,
        chunkBytes: status.chunkBytes,
        mode: status.mode,
      };
    },

    signMediaRemote(body, who) {
      if (!this.mediaEnabled()) fail('大文件上传未启用', 404);
      // 60/min is too low for a near-cap file (hundreds of signed objects, plus resume claims).
      // Per-session hash allowlisting still caps signs at objectBudget(size)*4.
      this.limit('media-sign:' + who, Math.max(60, objectBudget(this.tapeRelay.settings.maxBytes) * 4 + 40));
      const session = this.state.mediaSessions[body.sessionId];
      if (!session || session.who !== who) fail('上传会话无效', 403);
      if (session.status !== 'open' || session.expiresAt <= Date.now()) fail('上传会话已结束', 403);
      let checked;
      try { checked = this.tapeRelay.signer.check(body); }
      catch (e) { fail(e.message || '请求不签', e.code === 'remote-refused' ? 400 : 400); }
      const budget = objectBudget(session.size);
      if (!budget) fail('文件大小不在官方布局范围内');
      session.allowlist ||= [];
      session.uploadSigns ||= 0;
      for (const item of checked) {
        if (item.kind !== 'upload' && item.kind !== 'claim') fail('只签上传和认领', 403);
        const hashes = item.objects || [];
        if (item.kind === 'claim') {
          if (hashes.length > budget) fail('认领对象超过该文件预算', 403);
          if (!session.allowlist.length) session.allowlist = [...hashes];
          else if (hashes.some((h) => !session.allowlist.includes(h))) fail('认领了本会话以外的对象', 403);
        }
        if (item.kind === 'upload') {
          session.uploadSigns += 1;
          if (session.uploadSigns > budget * 4) fail('上传签名次数过多', 429);
          const sha = hashes[0];
          if (!session.allowlist.includes(sha)) {
            if (session.allowlist.length + 1 > budget) fail('上传对象超过该文件预算', 403);
            session.allowlist.push(sha);
          }
        }
      }
      this.save();
      return this.tapeRelay.signer.sign(checked);
    },

    async commitMedia(body, who) {
      if (!this.mediaEnabled()) fail('大文件上传未启用', 404);
      this.limit('media-commit:' + who, 12);
      const session = this.state.mediaSessions[body.sessionId];
      if (!session || session.who !== who) fail('上传会话无效', 403);
      if (session.status !== 'open' || session.expiresAt <= Date.now()) fail('上传会话已结束', 403);
      const envelopeSha = String(body.envelopeSha || '');
      const fileId = String(body.fileId || '');
      if (!HEX64.test(envelopeSha) || !HEX64.test(fileId)) fail('信封或文件标识无效');
      if (typeof body.manifestJson !== 'string' || body.manifestJson.length > 16384) fail('清单无效');
      let manifest;
      try { manifest = JSON.parse(body.manifestJson); } catch { fail('清单不是合法 JSON'); }
      if (manifest.type !== 'encrypted' || manifest.size !== session.size || manifest.contentType !== session.mime) fail('清单与上传会话不符');
      if (manifest.from !== this.tapeRelay.settings.circuit) fail('清单电路不符');
      if (this._looksLikeSecret(body) || this._looksLikeSecret(manifest)) fail('提交不得包含文件密钥或私钥');
      const envelope = await this._loadObject(envelopeSha);
      if (!envelope) fail('节点上找不到信封，请先完成上传', 409);
      let opened;
      try { opened = openEnvelope(new Uint8Array(envelope), [this.tapeRelay.keyPair]); }
      catch (e) { fail('信封不是签给本应用电路的，无法代为授权', 403); }
      try {
        if (opened.manifest.size !== session.size || opened.manifest.contentType !== session.mime || opened.manifest.from !== this.tapeRelay.settings.circuit || opened.manifest.index !== fileId) fail('信封清单与会话不符');
        // Public object hashes are not ownership credentials. Require knowledge
        // of the file key, bound to this upload session, before linking content.
        const proof = String(body.commitProof || '');
        const message = `snapvault-media-commit-v1\n${session.id}\n${envelopeSha}\n${fileId}`;
        const expected = createHmac('sha256', opened.fileKey).update(message).digest();
        if (!HEX64.test(proof) || !timingSafeEqual(Buffer.from(proof, 'hex'), expected)) fail('上传者文件密钥持有证明无效', 403);
        const mediaId = 'tm_' + randomBytes(16).toString('hex');
        const media = {
          id: mediaId,
          sessionId: session.id,
          creator: who,
          scene: session.scene,
          mime: session.mime,
          size: session.size,
          name: session.name,
          title: session.title,
          scope: session.scope,
          convId: session.convId,
          envelopeSha,
          fileId,
          manifestJson: JSON.stringify(opened.manifest),
          createdAt: Date.now(),
          expiresAt: session.scene === 'story' ? Date.now() + 86400000 : null,
          linked: false,
        };
        opened.fileKey.fill(0);
        session.status = 'committed';
        session.mediaId = mediaId;
        this.state.mediaFiles[mediaId] = media;
        this.save();
        return {mediaId, envelopeSha, fileId, size: media.size, mime: media.mime, expiresAt: media.expiresAt, mode: this.tapeRelay.settings.mode};
      } catch (e) {
        opened?.fileKey?.fill?.(0);
        throw e;
      }
    },

    async issueMediaKey(body, who) {
      if (!this.mediaEnabled()) fail('大文件上传未启用', 404);
      this.limit('media-key:' + who, 30);
      const media = this.state.mediaFiles[body.mediaId];
      if (!media) fail('媒体不存在', 404);
      if (!media.linked && !sameAddr(who, media.creator)) fail('内容不存在、已过期或没有查看权限', 404);
      const access = await this.authorizeMediaKey(media, who);
      const envelope = await this._loadObject(media.envelopeSha);
      if (!envelope) fail('加密文件暂时读不到', 503);
      let opened;
      try { opened = openEnvelope(new Uint8Array(envelope), [this.tapeRelay.keyPair]); }
      catch { fail('无法打开信封', 503); }
      try {
        const fileKey = Buffer.from(opened.fileKey).toString('base64url');
        opened.fileKey.fill(0);
        return {
          mediaId: media.id,
          envelopeSha: media.envelopeSha,
          servers: this.tapeRelay.settings.transportServers || this.tapeRelay.settings.servers,
          manifest: {size: opened.manifest.size, contentType: opened.manifest.contentType, name: opened.manifest.name},
          fileKey,
          viewUntil: access.viewUntil,
          preview: access.preview === true,
          mode: this.tapeRelay.settings.mode,
        };
      } catch (e) {
        opened?.fileKey?.fill?.(0);
        throw e;
      }
    },

    async authorizeMediaKey(media, who) {
      if (media.expiresAt && media.expiresAt <= Date.now()) fail('内容已过期，本应用已停止授权查看', 410);
      if (media.scene === 'paid') return this._authorizePaidMedia(media, who);
      if (media.scene === 'chat') return this._authorizeChatMedia(media, who);
      if (media.linked && media.socialId) {
        const collection = media.scene === 'story' ? this.state.socialStories : this.state.socialPosts;
        if (!collection?.[media.socialId] || collection[media.socialId].mediaId !== media.id) fail('内容已删除或没有查看权限', 404);
      }
      if (!mediaVisible(this, media, who)) fail('内容不存在、已过期或没有查看权限', 404);
      return {viewUntil: media.expiresAt, preview: sameAddr(who, media.creator)};
    },

    async _authorizePaidMedia(media, who) {
      if (!media.contentId) fail('作品尚未上架', 409);
      const {p, c} = await this.product(String(media.contentId), who);
      const preview = sameAddr(p.creator, who);
      const accessUntil = preview ? Date.now() + 86400000 : Number(await this.vault.accessUntil(media.contentId, who)) * 1000;
      if (!preview && (!accessUntil || accessUntil <= Date.now() || !await this.confirmed(media.contentId, who))) fail('订单尚未确认或已过期', 403);
      let viewUntil = accessUntil;
      if (p.burn) {
        const ref = media.contentId + ':' + who;
        viewUntil = preview ? Date.now() + p.secs * 1000 : this.state.opens[ref];
        if (viewUntil && viewUntil <= Date.now()) fail('此作品已结束展示', 410);
        if (!viewUntil) {
          viewUntil = Math.min(accessUntil, Date.now() + p.secs * 1000);
          this.state.opens[ref] = viewUntil;
          this.save();
        }
      }
      return {viewUntil, preview};
    },

    _authorizeChatMedia(media, who) {
      const m = this.state.messages.find((x) => x.mediaId === media.id);
      if (!m) fail('消息不存在', 410);
      this.member(m.conv, who);
      let viewUntil = null;
      if (m.burn) {
        if (who === m.from) fail('发送者不能打开限时消息');
        viewUntil = m.opens[who];
        if (viewUntil && viewUntil <= Date.now()) fail('此消息已结束展示', 410);
        if (!viewUntil) {
          viewUntil = Date.now() + m.secs * 1000;
          m.opens[who] = viewUntil;
          this.save();
        }
      }
      return {viewUntil, preview: who === m.from && !m.burn};
    },

    mediaRecord(id) { return this.state.mediaFiles[id] || null; },

    linkMedia(mediaId, who, extra = {}) {
      const media = this.state.mediaFiles[mediaId];
      if (!media || !sameAddr(media.creator, who)) fail('媒体不存在或没有权限', 403);
      if (extra.scene && media.scene !== extra.scene) fail('媒体场景不符');
      if (extra.convId && media.convId && extra.convId !== media.convId) fail('会话与上传会话不符');
      if (media.linked && extra.contentId && media.contentId && media.contentId !== extra.contentId) fail('媒体已绑定其他作品');
      Object.assign(media, extra, {linked: true});
      this.save();
      return media;
    },

    async _loadObject(sha) {
      if (this.tapeRelay.settings.mode === 'mock') {
        const buf = this.tapeRelay.relay.objects.get(sha);
        return buf ? new Uint8Array(buf) : null;
      }
      const {createClient} = await import('../vendor/taperelay-client/src/taperelay.mjs');
      const stop = new AbortController();
      const client = createClient({fetch: (url, init) => globalThis.fetch(url, {...init,
        signal: AbortSignal.any([init.signal, stop.signal]),
      })});
      try {
        // The official client verifies each object's hash. A slow first replica
        // must not hold up authorization while another valid replica is ready.
        const servers = this.tapeRelay.settings.transportServers || this.tapeRelay.settings.servers;
        return await Promise.any(servers.map((server) => client.getObject(server, sha)));
      } catch { return null; }
      finally { stop.abort(); }
    },

    _looksLikeSecret(value) {
      if (!value || typeof value !== 'object') return false;
      const keys = Object.keys(value);
      return keys.some((k) => /^(fileKey|secretKey|trk|developerKey|_devKey|privateKey)$/i.test(k));
    },
  });
}
