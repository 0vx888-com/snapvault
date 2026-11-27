// TapeRelay 客户端库：与一台服务器打交道（TapeRelay §6、TapeRelay §8.4、TapeRelay §10）。2026-10-11 由主编写窗口编写（CHANGELOG 第 90 条）。
// - fetch：浏览器里就是标准的 fetch；在 Node.js 里测试时，传一个只信任测试证书的 fetch（client/test/）。
// - 签名的请求由 auth（session.mjs 的 sessionAuth 或 walletAuth）签；不跟随跳转（redirect: 'manual'）。
// - 服务器回了错误，抛 TapeRelayError，code 是 TapeRelay §11.1 的错误码；连不上时 code 是 unreachable（只在客户端里用，不是服务器的回复）。
// - D-613：参考服务器的管理接口（D-152，不算协议的一部分）不在开发包里；运营方用 taperelay-node，或自己签名请求 /v1/admin/*。
// - 第 286 条（收件箱改造）：加交出通知、投递状态、拉取收件箱、标记已读（TapeRelay §9.3、TapeRelay §9.6），由 inbox.mjs 用。
// - 第 312 条：加写、读签名指针（TapeRelay §7.3），由 pointers.mjs 用。
// - 2026-10-28（TapeRelay §9.10，D-503）：加拉取服务器消息、标记已读，由 servermsgs.mjs 用。
// - 2026-10-29（D-518、D-519）：这里只留 TapeRelay 的接口（上传、认领、读取对象，收发、指针、信息）；释放、列出、用量是 TapeStore 的，
//   挪到 storage.mjs（withStorage 在这里给出的 request 上加这三个）。request 给建在本协议上的标准用。
import { HEX64, sha256Hex, utf8 } from './core.mjs';
import { signedHeaders, serverUrl } from './session.mjs';

export class TapeRelayError extends Error {
  constructor(code, { status, tapekitStatus, server } = {}) {
    super(`${code}${server ? `（${server}）` : ''}`);
    this.code = code;
    this.status = status;
    this.tapekitStatus = tapekitStatus;
    this.server = server;
  }
}

/** 回复最多读这么多字节：对象最多 1 MiB（Files §3.1），现在用到的别的回复都远小于它（I-093 第 2 点，第 97 条）；第 3 阶段加收件箱时按通知的大小再看 */
const MAX_REPLY = 1048576;

/** 读回复的内容，最多 max 字节：边读边数，超过就停下、不再读，返回 null；先看 Content-Length，已经超过的不读 */
async function readAtMost(res, max) {
  if (Number(res.headers.get('content-length')) > max) { await res.body?.cancel().catch(() => {}); return null; }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** 一个请求（连上、读完回复）最多等多久：60 秒，超时当作连不上（unreachable）。上传 1 MiB 要多给点时间，所以比网关取对象的 20 秒长（I-102 第 2 点，第 141 条） */
const REQUEST_TIMEOUT_MS = 60000;

const MIRROR_TIMEOUT_MS = 20000;
const HEDGE_MS = 2000;            // 镜像这么久还没开始回应，就同时向服务器要
const okMirrorUrl = (u) => { try { const x = new URL(u); return typeof u === 'string' && u.length <= 200 && x.protocol === 'https:' && !x.username && !x.password && !x.search && !x.hash && !u.endsWith('/'); } catch { return false; } };

/**
 * mirrors（2026-11-13）：读文件的加速镜像。不给（默认）不用；给 'auto'：第一次读某台服务器的对象时在后台问一次它的 /v1/info，
 * 之后的读取用它声明的 mirrors（问到之前照常直接读服务器，不多等）；给 { 服务器名字: [https 地址…] } 就用给的。
 * 镜像取到的照样核对哈希，取不到、超时、核对不过都回服务器去取。
 */
export function createClient({ fetch = globalThis.fetch, now = () => Math.floor(Date.now() / 1000), timeoutMs = REQUEST_TIMEOUT_MS, mirrors } = {}) {
  const mirrorState = new Map();
  let mirrorBusy = 0;              // 正在从镜像取的个数
  /** 这台服务器的镜像：{ list, off（没有、还没问到、出过错的都是 true）}；'auto' 时在后台问，不等它 */
  function mirrorsOf(name) {
    if (!mirrorState.has(name)) {
      const st = { list: [], off: true };
      mirrorState.set(name, st);
      if (mirrors && typeof mirrors === 'object' && Array.isArray(mirrors[name])) { st.list = mirrors[name].filter(okMirrorUrl).slice(0, 4); st.off = !st.list.length; }
      else if (mirrors === 'auto') {
        send(name, { path: '/v1/info', timeout: 8000 }).then((r) => {
          const list = r.status === 200 && Array.isArray(r.json?.mirrors) ? r.json.mirrors.filter(okMirrorUrl).slice(0, 4) : [];
          if (list.length) { st.list = list; st.off = false; }
        }, () => {});
      }
    }
    return mirrorState.get(name);
  }
  /**
   * 从镜像取一个对象：返回 { headers（回应头到了就兑现：true 是 200、false 是别的）, body（核对过哈希的字节）}。
   * 分两步，是为了按「开始回应」的快慢决定要不要同时向服务器要，而不是按整个对象下完的快慢（慢线路上下完 1 MiB 本来就要几秒）
   */
  function fromMirror(base, sha) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('timeout')), MIRROR_TIMEOUT_MS);
    const res = fetch(`${base}/v1/objects/${sha}`, { method: 'GET', redirect: 'manual', signal: ac.signal });
    const headers = res.then((r) => r.status === 200, () => false);
    mirrorBusy++;
    const body = (async () => {
      try {
        const r = await res;
        if (r.status !== 200) throw new TapeRelayError(`http-${r.status}`, { status: r.status, server: base });
        const bytes = await readAtMost(r, MAX_REPLY);
        if (!bytes || sha256Hex(bytes) !== sha) throw new TapeRelayError('hash-mismatch', { server: base });
        return bytes;
      } finally {
        clearTimeout(timer);
        mirrorBusy--;
      }
    })();
    body.catch(() => {});
    return { headers, body };
  }
  /** tooLarge：回复超过 MAX_REPLY 时抛的错误码（读对象时是 hash-mismatch：超过 1 MiB 的不可能是要的对象） */
  async function send(name, { method = 'GET', path, query = '', body, auth, upload = false, tooLarge = 'unreachable', maxReply = MAX_REPLY, timeout = timeoutMs }) {
    const headers = {};
    if (body) headers['Content-Type'] = upload ? 'application/octet-stream' : 'application/json';
    if (auth) Object.assign(headers, await signedHeaders(auth, { server: name, method, path, query, body, now: now(), upload }));
    let res, bytes;
    // 时限：自己开计时器、用完清掉（Node.js 的 AbortSignal.timeout 用的计时器不让程序一直开着，假服务器不回答时程序会提前退出，第 141 条）
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('timeout')), timeout);
    try {
      res = await fetch(`${serverUrl(name)}${path}${query ? `?${query}` : ''}`, { method, headers, body, redirect: 'manual', cache: 'no-store', signal: ac.signal });
      bytes = await readAtMost(res, maxReply);
    } catch {
      throw new TapeRelayError('unreachable', { server: name });
    } finally {
      clearTimeout(timer);
    }
    if (!bytes) throw new TapeRelayError(tooLarge, { status: res.status, server: name });
    let json;
    if (/json/i.test(res.headers.get('content-type') ?? '')) { try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch { json = undefined; } }
    return { status: res.status, headers: res.headers, bytes, json };
  }
  const expect = (r, name, ...statuses) => {
    if (statuses.includes(r.status)) return r;
    const code = typeof r.json?.error === 'string' ? r.json.error : `http-${r.status}`;
    throw new TapeRelayError(code, { status: r.status, tapekitStatus: r.json?.tapekitStatus, server: name });
  };
  const jsonBody = (v) => utf8(JSON.stringify(v));

  return {
    now,
    /** TapeRelay §10.1 */
    info: async (name) => expect(await send(name, { path: '/v1/info' }), name, 200).json,
    /** TapeRelay §6.1：上传一个对象；返回 { created（新存的为 true）, sha256 } */
    async upload(name, auth, bytes) {
      const r = expect(await send(name, { method: 'POST', path: '/v1/objects', body: bytes, auth, upload: true }), name, 200, 201);
      return { created: r.status === 201, sha256: sha256Hex(bytes) };
    },
    /** TapeRelay §6.3：最多 1,000 个；返回 { claimed, missing } */
    claim: async (name, auth, objects) => expect(await send(name, { method: 'POST', path: '/v1/objects/claim', body: jsonBody({ objects }), auth }), name, 200).json,
    /**
     * 2026-10-29（D-518）：给建在本协议上的标准（例如 TapeStore 的 storage.mjs）发一个请求：给了 auth 就签名；回复的状态码不在 ok 里就抛
     * TapeRelayError（与上面各个接口相同）。返回 { status, headers, bytes, json }。ok 默认 [200]
     */
    async request(name, { method = 'GET', path, query = '', body, auth, maxReply = MAX_REPLY } = {}, ok = [200]) {
      if (typeof path !== 'string' || !path.startsWith('/v1/')) throw new Error('path 要以 /v1/ 开头');
      return expect(await send(name, { method, path, query, body, auth, maxReply }), name, ...ok);
    },
    /** TapeRelay §8.4：撤销的请求体（session.mjs 的 signRevocation），不签请求头 */
    async revoke(name, revocationJson) { expect(await send(name, { method: 'POST', path: '/v1/revocations', body: utf8(revocationJson) }), name, 204); },
    // ---- 第 286 条（收件箱改造，TapeRelay §9.3、TapeRelay §9.6）：inbox.mjs 用 ----
    /** TapeRelay §9.3：把签名的通知（字节）交给这台服务器；返回 { id } */
    submitNotice: async (name, auth, body) => expect(await send(name, { method: 'POST', path: '/v1/outbox', body, auth }), name, 202).json,
    /** TapeRelay §9.3：投递状态（不签名）；返回 { id, status, error? }，不是这台收下的抛 not-found */
    async outboxStatus(name, id) {
      if (!HEX64.test(id)) throw new Error('通知编号要是 64 位小写十六进制');
      return expect(await send(name, { path: `/v1/outbox/${id}` }), name, 200).json;
    },
    /** TapeRelay §9.6：拉取自己收件箱的一页；一条通知最多 16 KiB（服务器的上限），一页 100 条也不超过 2 MiB */
    async inbox(name, auth, { cursor, limit } = {}) {
      const q = new URLSearchParams();
      if (limit) q.set('limit', String(limit));
      if (cursor) q.set('cursor', cursor);
      return expect(await send(name, { path: `/v1/inbox/${auth.account}`, query: q.toString(), auth, maxReply: 2 * MAX_REPLY }), name, 200).json;
    },
    /** D-659：「已发送」的一页（GET /v1/outbox，自己签名；新的在前）；一页最多 100 条，每条带投递状态 */
    async sent(name, auth, { cursor, limit } = {}) {
      const q = new URLSearchParams();
      if (limit) q.set('limit', String(limit));
      if (cursor) q.set('cursor', cursor);
      return expect(await send(name, { path: '/v1/outbox', query: q.toString(), auth, maxReply: 2 * MAX_REPLY }), name, 200).json;
    },
    /** TapeRelay §9.6：标记已读，最多 100 个 */
    async markRead(name, auth, ids) { expect(await send(name, { method: 'POST', path: `/v1/inbox/${auth.account}/read`, body: jsonBody({ ids }), auth }), name, 204); },
    // ---- 2026-10-28（TapeRelay §9.10，D-503）：服务器消息，servermsgs.mjs 用 ----
    /** TapeRelay §9.10：拉取自己的服务器消息的一页；一条最多约 26 KiB（标题 100、正文 2,000 个字符全写成 \uXXXX），一页 100 条不超过 4 MiB */
    async serverMessages(name, auth, { cursor, limit } = {}) {
      const q = new URLSearchParams();
      if (limit) q.set('limit', String(limit));
      if (cursor) q.set('cursor', cursor);
      return expect(await send(name, { path: `/v1/server-messages/${auth.account}`, query: q.toString(), auth, maxReply: 4 * MAX_REPLY }), name, 200).json;
    },
    /** TapeRelay §9.10：服务器消息标记已读，最多 100 个 */
    async markServerMessagesRead(name, auth, ids) { expect(await send(name, { method: 'POST', path: `/v1/server-messages/${auth.account}/read`, body: jsonBody({ ids }), auth }), name, 204); },
    // ---- 第 312 条（签名指针，TapeRelay §7.3）：pointers.mjs 用；account、pname 由它先核对过写法 ----
    /** TapeRelay §7.3：把签名的指针（字节）写给这台服务器（204）；版号不比存着的大抛 pointer-not-newer */
    async putPointer(name, auth, account, pname, body) { expect(await send(name, { method: 'PUT', path: `/v1/pointers/${account}/${pname}`, body, auth }), name, 204); },
    /** TapeRelay §7.3：读一个名字存着的签名的指针（不签名）；服务器只收 16 KiB 以内的，更大的回复当作不对（bad-reply）；没有这个名字抛 not-found */
    async getPointer(name, account, pname) {
      const r = expect(await send(name, { path: `/v1/pointers/${account}/${pname}`, maxReply: 16384, tooLarge: 'bad-reply' }), name, 200);
      if (r.json === undefined) throw new TapeRelayError('bad-reply', { server: name });
      return r.json;
    },
    /**
     * TapeRelay §6.2：读一个对象的全部字节，核对 SHA-256；不符抛 hash-mismatch。maxBytes：比 1 MiB 更小的上限（例如清单对象 16 KiB，TapeRelay §9.8），
     * 超过就停下、不读完，抛 too-large（第 154 条）
     */
    async getObject(name, sha, { maxBytes } = {}) {
      if (!HEX64.test(sha)) throw new Error('对象地址要是 64 位小写十六进制');
      // 2026-11-13：服务器声明了镜像的，先到镜像取（核对哈希）；镜像出错以后这一页不再用它
      const direct = async () => {
        const r = expect(await send(name, { path: `/v1/objects/${sha}`, tooLarge: maxBytes ? 'too-large' : 'hash-mismatch', maxReply: maxBytes ? Math.min(maxBytes, MAX_REPLY) : MAX_REPLY }), name, 200);
        if (sha256Hex(r.bytes) !== sha) throw new TapeRelayError('hash-mismatch', { server: name });
        return r.bytes;
      };
      const m = !maxBytes && mirrors ? mirrorsOf(name) : null;
      if (!m || m.off || !m.list.length) return direct();
      // 镜像先取（只用第一个；它出错了这一页就不再用它）。只有这一个在取时，HEDGE_MS 内镜像还没开始回应（多半是镜像里还没有、要回服务器拉），
      // 同时向服务器要，谁先到用谁；镜像那边不中断，拉完会存下来，下一个人就快了。镜像开始回应了就只等它
      const alone = mirrorBusy === 0;                                      // 同时在取的多（预取）时不重复要：慢线路上带宽本来就满了，重复要只会更慢
      const mm = fromMirror(m.list[0], sha);
      const noteFail = (e) => { if (e?.status !== 404 && e?.status !== 451) m.off = true; };
      mm.body.catch(noteFail);
      const started = alone ? await Promise.race([mm.headers, new Promise((r) => setTimeout(() => r(null), HEDGE_MS))]) : await mm.headers;
      if (started === true) { try { return await mm.body; } catch { return direct(); } }
      if (started === false) return direct();
      const viaServer = direct();
      viaServer.catch(() => {});
      try { return await Promise.any([mm.body, viaServer]); } catch { return viaServer; }
    },
    /**
     * TapeRelay §6.2 的 HEAD：这台服务器上有没有这个对象（不要签名，不读内容）。200 → true；404（not-found）、451（taken-down）→ false；
     * 别的回复照常抛错（第 262 条，阶段 6）。只说明那台上有这份内容，不说明记在谁名下：给没登录的场合用（例如打开别人发来的链接时
     * 看哪台有）；核对自己的副本用列出（replicas.mjs 的 checkReplicas，D-223；第 276 条起，原来用认领，D-214）
     */
    async has(name, sha) {
      if (!HEX64.test(sha)) throw new Error('对象地址要是 64 位小写十六进制');
      const r = await send(name, { method: 'HEAD', path: `/v1/objects/${sha}` });
      if (r.status === 200) return true;
      if (r.status === 404 || r.status === 451) return false;
      throw new TapeRelayError(`http-${r.status}`, { status: r.status, server: name });
    },
  };
}
