// Full-file identity for encrypted resume. Name + size + mtime can collide;
// reusing a saved nonce plan on different plaintext would leak under GCM/XChaCha.
export const HASH_STEP = 1048576;

// Proves possession of the upload's file key without sending that key to the
// backend. Bind the proof to this session so another user cannot replay it.
export async function mediaCommitProof(fileKey, sessionId, envelopeSha, fileId) {
  const key = await crypto.subtle.importKey('raw', fileKey, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const message = new TextEncoder().encode(`snapvault-media-commit-v1\n${sessionId}\n${envelopeSha}\n${fileId}`);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sourceFromBytes(data) {
  if (data instanceof Uint8Array) return {size: data.length, read: async (a, b) => data.subarray(a, b)};
  if (data && typeof data.size === 'number' && typeof data.slice === 'function') {
    return {size: data.size, read: async (a, b) => new Uint8Array(await data.slice(a, b).arrayBuffer())};
  }
  throw new Error('文件要是 Uint8Array 或 Blob');
}

export async function createDefaultHasher() {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const {createHash} = await import('node:crypto');
    const h = createHash('sha256');
    return {update: (u) => h.update(u), digestHex: () => h.digest('hex')};
  }
  const {sha256} = await import('./vendor/taperelay-client.js');
  const h = sha256.create();
  return {
    update: (u) => h.update(u),
    digestHex: () => [...h.digest()].map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

export async function hashReadableSource(source, hasher, step = HASH_STEP) {
  if (!source || !Number.isFinite(source.size) || source.size < 0) throw new Error('文件大小无效');
  const h = hasher || await createDefaultHasher();
  for (let a = 0; a < source.size; a += step) {
    const end = Math.min(source.size, a + step);
    const part = await source.read(a, end);
    if (part.length !== end - a) throw new Error('读取长度不符');
    h.update(part);
  }
  return h.digestHex();
}

export function metadataCollides(job, meta) {
  return !!job
    && job.name === meta.name
    && job.byteSize === meta.byteSize
    && job.lastModified === meta.lastModified
    && job.account === meta.account;
}

export function resumeJobMatches(job, meta) {
  if (!job || !meta?.contentSha || !job.contentSha) return false;
  return metadataCollides(job, meta) && job.contentSha === meta.contentSha;
}

export function findResumeJob(jobs, meta) {
  if (!meta?.contentSha) return null;
  return (jobs || []).find((job) => resumeJobMatches(job, meta)) || null;
}
