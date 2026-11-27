// In-process TapeRelay object store for local mock mode and tests.
// Speaks the official client upload/claim/getObject HTTP shapes without a live node.
// Not a real TapeRelay server: signatures are accepted but not verified here.
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const HEX64 = /^[a-f0-9]{64}$/;

function asBytes(body) {
  if (body == null) return new Uint8Array(0);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === 'string') return new TextEncoder().encode(body);
  throw new Error('unsupported body');
}

export function createMockRelay({name = 'mock.snapvault.local:4246'} = {}) {
  const objects = new Map();
  const uploads = []; // {sha256, bytes: number} for resume assertions; no plaintext
  const stats = {claimCalls: 0, uploadCalls: 0, skippedExisting: 0};

  function put(bytes) {
    const raw = Buffer.from(asBytes(bytes));
    if (raw.length > 1048576) return {error: 'too-large', status: 413};
    const sha = sha256Hex(raw);
    const created = !objects.has(sha);
    objects.set(sha, raw);
    if (created) uploads.push({sha256: sha, bytes: raw.length});
    else stats.skippedExisting++;
    return {sha256: sha, created};
  }

  function claim(list) {
    stats.claimCalls++;
    if (!Array.isArray(list) || list.length < 1 || list.length > 1000) return {error: 'bad-claim', status: 400};
    const claimed = [], missing = [];
    for (const sha of list) {
      if (typeof sha !== 'string' || !HEX64.test(sha)) return {error: 'bad-claim', status: 400};
      (objects.has(sha) ? claimed : missing).push(sha);
    }
    return {claimed, missing};
  }

  async function handle(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const u = new URL(typeof url === 'string' ? url : url.url, 'https://mock.snapvault.local');
    const path = u.pathname;
    if (path === '/v1/info' && method === 'GET') {
      return json(200, {name, mock: true, mirrors: []});
    }
    if (path === '/v1/objects' && method === 'POST') {
      stats.uploadCalls++;
      const body = asBytes(init.body);
      const r = put(body);
      if (r.error) return json(r.status, {error: r.error});
      return json(r.created ? 201 : 200, {sha256: r.sha256, created: r.created});
    }
    if (path === '/v1/objects/claim' && method === 'POST') {
      let parsed;
      try { parsed = JSON.parse(new TextDecoder().decode(asBytes(init.body))); } catch { return json(400, {error: 'bad-json'}); }
      const r = claim(parsed?.objects);
      if (r.error) return json(r.status, {error: r.error});
      return json(200, r);
    }
    const obj = path.match(/^\/v1\/objects\/([a-f0-9]{64})$/);
    if (obj) {
      const buf = objects.get(obj[1]);
      if (!buf) return json(404, {error: 'not-found'});
      if (method === 'HEAD') return new Response(null, {status: 200, headers: {'Content-Length': String(buf.length)}});
      if (method === 'GET') return new Response(buf, {status: 200, headers: {'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length)}});
    }
    return json(404, {error: 'not-found'});
  }

  async function fetch(url, init) {
    return handle(url, init);
  }

  function listen(host = '127.0.0.1', port = 0) {
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const r = await handle('https://'+name+req.url, {method: req.method, body, headers: req.headers});
      const bytes = r.body ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
      res.end(bytes);
    });
    return new Promise((ok, no) => server.listen(port, host, (e) => e ? no(e) : ok(server)));
  }

  return {name, objects, uploads, stats, put, claim, handle, fetch, listen, has: (sha) => objects.has(sha), size: () => objects.size};
}

function json(status, obj) {
  const body = JSON.stringify(obj);
  return new Response(body, {status, headers: {'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body))}});
}
