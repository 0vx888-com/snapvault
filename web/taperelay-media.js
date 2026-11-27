import {wallet, call, apiURL} from './wallet.js';
import {sourceFromBytes, hashReadableSource, findResumeJob, mediaCommitProof} from './taperelay-file-id.js';
import {
  planEncryptedFile,
  planEncryptedResume,
  resumableOf,
  generateKeyPair,
  uploadToServers,
  createClient,
  remoteAuth,
  readEncryptedFileWithKey,
  openEncryptedFileWithKey,
  faststart,
  ENCRYPTED_CHUNK,
  streamMedia,
  saveFile,
  cleanupTempDownloads,
  sha256,
} from './vendor/taperelay-client.js';

const TYPES = new Set(['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime','application/pdf','application/zip','application/octet-stream']);
const fileMime = (file) => TYPES.has(file.type) ? file.type : 'application/octet-stream';
const IMAGE_TYPES = new Set(['image/png','image/jpeg','image/webp','image/gif']);
const PLAYER_MEMORY_MAX = 200 * 1048576; // official player.mjs default
const DB = 'snapvault-taperelay-resume', STORE = 'jobs';
const toB64 = (u) => {
  let s = '';
  const b = u instanceof Uint8Array ? u : new Uint8Array(u);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const SECRET_KEYS = /fileKey|secretKey|privateKey|#k=|#ks=|encryptedKey/i;
export function analyticsSafeDetail(detail) {
  if (!detail || typeof detail !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SECRET_KEYS.test(k) || (typeof v === 'string' && SECRET_KEYS.test(v))) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export function largeMediaStatus() {
  return wallet.config?.taperelayMedia || {enabled: false, mode: 'off'};
}
export function largeMediaEnabled() {
  return wallet.enabled && largeMediaStatus().enabled === true;
}
export function usesLargeMediaPath(file) {
  if (!file || !largeMediaEnabled()) return false;
  if (!IMAGE_TYPES.has(file.type)) return true;
  return file.size > 2 * 1024 * 1024;
}
export function mediaAccept() {
  return largeMediaEnabled()
    ? '*/*'
    : 'image/png,image/jpeg,image/webp,image/gif';
}
export function mediaHelp() {
  const s = largeMediaStatus();
  if (!s.enabled) return 'PNG、JPEG、WebP、GIF · 最大 2 MB';
  const mb = Math.round((s.maxBytes || 0) / 1048576);
  const mode = s.mockOnly ? '本地模拟，尚未连接真实节点' : '加密上传到 TapeRelay';
  return `图片、视频或文件 · 最大 ${mb} MiB。${mode}。Story 支持图片和视频，其他文件解锁后可下载。`;
}

function nodeFetch(status) {
  return async (url, init) => {
    const u = new URL(url, location.href);
    if (status.mode === 'mock' && u.hostname === 'mock.snapvault.local') {
      return fetch(apiURL('/tr-mock' + u.pathname + u.search), init);
    }
    return fetch(url, init);
  };
}

async function openResumeDb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
async function saveResume(job) {
  const db = await openResumeDb();
  await new Promise((ok, no) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(job, job.sessionId);
    t.oncomplete = () => ok();
    t.onerror = () => no(t.error);
  });
  db.close();
}
async function loadResume(sessionId) {
  const db = await openResumeDb();
  const value = await new Promise((ok, no) => {
    const r = db.transaction(STORE).objectStore(STORE).get(sessionId);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  db.close();
  return value;
}
async function clearResume(sessionId) {
  const db = await openResumeDb();
  await new Promise((ok, no) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).delete(sessionId);
    t.oncomplete = () => ok();
    t.onerror = () => no(t.error);
  });
  db.close();
}
async function listResumeJobs() {
  const db = await openResumeDb();
  const value = await new Promise((ok, no) => {
    const r = db.transaction(STORE).objectStore(STORE).getAll();
    r.onsuccess = () => ok(r.result || []);
    r.onerror = () => no(r.error);
  });
  db.close();
  return value;
}
export async function sweepExpiredResume(now = Date.now()) {
  const jobs = await listResumeJobs();
  for (const job of jobs) {
    if (!job.expiresAt || job.expiresAt <= now) await clearResume(job.sessionId);
  }
}
export async function clearAllResumeJobs() {
  const db = await openResumeDb();
  await new Promise((ok, no) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).clear();
    t.oncomplete = () => ok();
    t.onerror = () => no(t.error);
  });
  db.close();
}
function nobleHasher() {
  const h = sha256.create();
  return {update: (u) => h.update(u), digestHex: () => [...h.digest()].map((b) => b.toString(16).padStart(2, '0')).join('')};
}
export async function contentShaOf(data) {
  return hashReadableSource(sourceFromBytes(data), nobleHasher());
}
export async function findResumeForFile(file, size, contentSha, context) {
  await sweepExpiredResume();
  const jobs = await listResumeJobs();
  const candidates = context ? jobs.filter((j) => j.scene === context.scene && j.scope === context.scope && (j.convId || null) === (context.convId || null) && j.mime === context.mime) : jobs;
  return findResumeJob(candidates, {
    name: file.name,
    byteSize: size,
    lastModified: file.lastModified,
    account: (wallet.account || '').toLowerCase(),
    contentSha,
  });
}

let activeUpload = null;
export function cancelActiveUpload() {
  activeUpload?.abort();
}
export function hasActiveUpload() {
  return !!activeUpload;
}

function packResume(plan, ephemeral) {
  const saved = resumableOf(plan);
  return {
    envelope: toB64(saved.envelope),
    index: saved.index.map(toB64),
    nonces: toB64(saved.nonces),
    secret: toB64(ephemeral.secretKey),
    publicKey: toB64(ephemeral.publicKey),
  };
}
function unpackResume(record) {
  return {
    saved: {
      envelope: fromB64(record.envelope),
      index: record.index.map(fromB64),
      nonces: fromB64(record.nonces),
    },
    keyPair: {secretKey: fromB64(record.secret), publicKey: fromB64(record.publicKey)},
  };
}
function fromBase64Url(s) {
  const pad = '=='.slice(0, (4 - s.length % 4) % 4);
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0));
}

export async function uploadEncryptedMedia({file, scene, scope, convId, title, onProgress, signal, sessionId}) {
  if (!largeMediaEnabled()) throw Error('大文件上传未启用');
  const mime = fileMime(file);
  if (scene === 'story' && !IMAGE_TYPES.has(mime) && !mime.startsWith('video/')) throw Error('Story 仅支持图片或 MP4 / WebM / MOV 视频');
  const status = largeMediaStatus();
  if (file.size > status.maxBytes) throw Error(`超过当前产品上限（${Math.round(status.maxBytes/1048576)} MB，尚未真机实测）`);
  let data = file;
  let faststarted = false;
  if (file.type === 'video/mp4' || file.type === 'video/quicktime') {
    try { const r = await faststart(file); data = r.data; faststarted = true; } catch { data = file; }
  }
  const size = data.size ?? data.length;
  const contentSha = await contentShaOf(data);
  const context = {scene, scope: scope || (scene === 'chat' ? 'dm' : 'public'), convId: convId || null, mime};
  const found = sessionId ? await loadResume(sessionId) : await findResumeForFile(file, size, contentSha, context);
  if (sessionId && found && found.contentSha !== contentSha) {
    throw Error('续传记录与当前文件内容不一致，已拒绝复用加密计划');
  }
  if (sessionId && found && (found.scene !== context.scene || found.scope !== context.scope || (found.convId || null) !== context.convId || found.mime !== mime)) throw Error('续传记录属于另一种发布场景或会话');
  let session;
  if (found && !sessionId) {
    try {
      session = {sessionId: found.sessionId, ...status, expiresAt: found.expiresAt, circuit: found.circuit || status.circuit, servers: found.servers || status.servers, selfKey: found.selfKey || status.selfKey};
    } catch { session = null; }
  } else if (sessionId) {
    session = {sessionId, ...status, expiresAt: found?.expiresAt, circuit: status.circuit, servers: status.servers, selfKey: status.selfKey};
  }
  if (!session?.sessionId) {
    session = await call('media-session', {scene, mime, size, name: file.name, scope, convId, title});
  }
  const selfKey = fromBase64Url(session.selfKey);
  let ephemeral, plan, usedResume = false;
  const existing = found && found.sessionId === session.sessionId ? found : (sessionId ? await loadResume(session.sessionId) : null);
  const sameContent = existing && existing.contentSha === contentSha && existing.size === size && existing.name === file.name;
  if (sameContent) {
    try {
      const unpacked = unpackResume(existing);
      ephemeral = unpacked.keyPair;
      plan = await planEncryptedResume(data, {saved: unpacked.saved, keyPairs: [ephemeral]});
      usedResume = true;
    } catch {
      ephemeral = generateKeyPair();
      plan = await planEncryptedFile(data, {name: file.name || 'media', contentType: mime, from: session.circuit, selfKey, to: [ephemeral.publicKey]});
    }
  } else {
    ephemeral = generateKeyPair();
    plan = await planEncryptedFile(data, {name: file.name || 'media', contentType: mime, from: session.circuit, selfKey, to: [ephemeral.publicKey]});
  }
  await saveResume({
    sessionId: session.sessionId,
    size,
    byteSize: size,
    name: file.name,
    lastModified: file.lastModified,
    account: (wallet.account || '').toLowerCase(),
    contentSha,
    expiresAt: session.expiresAt || Date.now() + 2 * 60 * 60 * 1000,
    circuit: session.circuit,
    servers: session.servers,
    selfKey: session.selfKey,
    ...context,
    ...packResume(plan, ephemeral),
  });
  const client = createClient({fetch: nodeFetch(status)});
  const auth = remoteAuth({
    account: session.circuit,
    endpoint: apiURL('/api/wallet/media-sign'),
    headers: {Authorization: 'Bearer ' + wallet.token, 'X-SnapVault-Client': 'view-ledger-v2'},
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      body.sessionId = session.sessionId;
      return fetch(url, {...init, body: JSON.stringify(body), headers: {'Content-Type': 'application/json', ...init.headers}});
    },
  });
  const localAbort = new AbortController();
  const onAbort = () => localAbort.abort();
  if (signal) signal.addEventListener('abort', onAbort, {once: true});
  if (signal?.aborted) localAbort.abort();
  activeUpload = localAbort;
  let uploadResult;
  try {
    const up = uploadResult = await uploadToServers(client, session.servers, auth, null, {plan, signal: localAbort.signal, onProgress});
    if (!up.stored) throw Error(up.message || '还没有存够节点，请稍后继续上传');
    // The SDK returns as soon as two replicas are stored. The third still needs
    // the plan's encryption keys, including during background retries.
    await up.settled;
    if (localAbort.signal.aborted) throw Error('上传已取消，可重新选择同一文件继续');
    const commitProof = await mediaCommitProof(plan.fileKey, session.sessionId, plan.envelope.sha256, plan.fileId);
    const committed = await call('media-commit', {
      sessionId: session.sessionId,
      envelopeSha: plan.envelope.sha256,
      fileId: plan.fileId,
      manifestJson: plan.manifestJson,
      commitProof,
    });
    await clearResume(session.sessionId);
    return {...committed, resumed: usedResume, faststarted};
  } finally {
    await uploadResult?.settled;
    if (signal) signal.removeEventListener('abort', onAbort);
    if (activeUpload === localAbort) activeUpload = null;
    plan.dispose?.();
    ephemeral.secretKey.fill?.(0);
  }
}

function addPlaybackControls(video) {
  video.controls = false;
  video.playsInline = true;
  video.setAttribute('controlslist', 'nodownload');
  video.draggable = false;
  const blockMenu = event => event.preventDefault();
  video.addEventListener('contextmenu', blockMenu);

  const english = document.documentElement.lang.startsWith('en');
  const bar = document.createElement('div');
  bar.className = 'tr-playback-controls';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.step = '0.1';
  seek.setAttribute('aria-label', english ? 'Playback position' : '播放进度');
  const time = document.createElement('span');
  const format = seconds => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  function update() {
    toggle.textContent = video.paused ? (english ? 'Play' : '播放') : (english ? 'Pause' : '暂停');
    seek.disabled = !Number.isFinite(video.duration) || video.duration <= 0;
    seek.max = seek.disabled ? '1' : String(video.duration);
    seek.value = String(video.currentTime);
    time.textContent = format(video.currentTime) + (seek.disabled ? '' : ' / ' + format(video.duration));
  }
  toggle.onclick = () => {
    if (video.paused) video.play().catch(update);
    else video.pause();
  };
  seek.oninput = () => { if (!seek.disabled) video.currentTime = Number(seek.value); };
  const events = ['play', 'pause', 'timeupdate', 'durationchange', 'ended'];
  for (const event of events) video.addEventListener(event, update);
  bar.append(toggle, seek, time);
  video.after(bar);
  update();
  return () => {
    bar.remove();
    video.removeEventListener('contextmenu', blockMenu);
    for (const event of events) video.removeEventListener(event, update);
  };
}

export async function playAuthorizedMedia(target, mediaId, {onStatus} = {}) {
  if (!largeMediaEnabled()) throw Error('大文件播放未启用');
  const issued = await call('media-key', {mediaId});
  const key = fromBase64Url(issued.fileKey);
  issued.fileKey = '';
  if (issued.envelope) delete issued.envelope;
  const client = createClient({fetch: nodeFetch(largeMediaStatus())});
  const opened = await openEncryptedFileWithKey(client, issued.servers, issued.envelopeSha, key);
  key.fill(0);
  const mime = issued.manifest.contentType;
  const video = mime.startsWith('video/');
  if (!video && !IMAGE_TYPES.has(mime)) {
    const host = target.matches?.('video,img') ? target.parentElement : target;
    target.matches?.('video,img') && target.classList.add('hidden');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary tr-media-download';
    button.textContent = '下载 ' + (opened.manifest.name || '文件');
    host.append(button);
    let closed = false;
    const close = () => { closed = true; button.remove(); opened.close(); };
    const checkAccess = () => { if (closed || (issued.viewUntil && Date.now() >= issued.viewUntil)) throw Error('查看权限已结束'); };
    button.onclick = async () => {
      if (closed || (issued.viewUntil && Date.now() >= issued.viewUntil)) { close(); return; }
      button.disabled = true;
      try {
        // Official SDK: save picker -> OPFS -> bounded memory fallback. The
        // picker must open synchronously from this click, before network waits.
        await saveFile({manifest: opened.manifest, read: async (a, b) => {
          checkAccess(); const bytes = await opened.read(a, b); checkAccess(); return bytes;
        }}, {name: opened.manifest.name || 'download', memoryMax: PLAYER_MEMORY_MAX,
          onProgress: (done, total) => { if (!closed) button.textContent = `下载 ${Math.round(done / total * 100)}%`; }});
        if (!closed) button.textContent = '下载 ' + (opened.manifest.name || '文件');
      } catch { if (!closed) button.textContent = '下载失败，点击重试'; }
      finally { if (!closed) button.disabled = false; }
    };
    return {url: null, element: button, viewUntil: issued.viewUntil, close};
  }
  const mount = target.matches?.('video,img') ? target.parentElement : target;
  const el = video ? (target.matches?.('video') ? target : mount.querySelector?.('video') || document.createElement('video')) : (target.matches?.('img') ? target : mount.querySelector?.('img') || document.createElement('img'));
  if (!el.parentNode && mount.append) mount.append(el);
  mount.querySelector?.(video ? 'img' : 'video')?.classList?.add('hidden');
  el.classList?.remove?.('hidden');
  const removeControls = video ? addPlaybackControls(el) : null;
  const reader = {size: opened.manifest.size, read: (a, b) => opened.read(a, b)};
  let url = null, streamed = false, stream = null;
  try {
    if (video) {
      try { stream = await streamMedia(el, reader); streamed = true; }
      catch (e) {
        if (opened.manifest.size > PLAYER_MEMORY_MAX) throw Error('该视频无法边下边播，且超过页面内存上限（约 200 MB）');
        onStatus?.(e.message || '改为整段解密后播放');
      }
    }
    if (!streamed) {
      if (opened.manifest.size > PLAYER_MEMORY_MAX) throw Error('文件过大，无法在页面内整段打开');
      const bytes = await opened.read(0, opened.manifest.size);
      url = URL.createObjectURL(new Blob([bytes], {type: mime}));
      el.src = url;
    }
    return {url, element: el, viewUntil: issued.viewUntil, close() { removeControls?.(); stream?.close(); if (url) URL.revokeObjectURL(url); el.removeAttribute('src'); if ('srcObject' in el) el.srcObject = null; opened.close(); }};
  } catch (e) {
    removeControls?.();
    stream?.close();
    if (url) URL.revokeObjectURL(url);
    opened.close();
    throw e;
  }
}

if (typeof window !== 'undefined') {
  cleanupTempDownloads().catch(() => {});
  window.addEventListener('snapvault:identity', () => { if (!wallet.token) clearAllResumeJobs().catch(() => {}); });
  window.addEventListener('pagehide', () => { sweepExpiredResume().catch(() => {}); });
}
