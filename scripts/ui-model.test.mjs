import test from 'node:test';
import assert from 'node:assert/strict';
const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), clear: () => map.clear() }; };
globalThis.localStorage = memory(); globalThis.sessionStorage = memory(); globalThis.window = new EventTarget();
let queue = Promise.resolve();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_name, fn) => { const run = queue.then(fn); queue = run.catch(() => {}); return run; } } } });
const s = await import('../web/store.js');
let now = 2_000_000; Date.now = () => now;
const fan2 = Object.keys(s.PEOPLE)[2];
function listing(overrides = {}) {
  return s.addContent({ creator: s.CREATOR, title: '独家图片', scope: 'public', burn: true, secs: 10, price: 1, token: 'OKB', max: 0, hash: '0xabc', ...overrides }, 'cipher', 'key');
}
test.beforeEach(() => { localStorage.clear(); sessionStorage.clear(); now = 2_000_000; });
test('private products stay scoped; public follows and purchases do not grant private access', () => {
  const c = listing({ scope: 'dm', audience: [s.CREATOR, s.FAN] });
  assert.equal(s.eligible(c, s.FAN), true); assert.equal(s.eligible(c, fan2), false);
  assert.equal(s.eligible(c, s.CREATOR), true);
});
test('duplicate/concurrent purchase creates one order and consumes one unit', async () => {
  const c = listing({ max: 1 }); const result = await Promise.all([s.purchaseDemo(c.id, s.FAN), s.purchaseDemo(c.id, s.FAN)]);
  assert.equal(result[0].id, result[1].id); assert.equal(s.orders().length, 1); assert.equal(s.content(c.id).sold, 1);
  await assert.rejects(s.purchaseDemo(c.id, fan2), /已售罄/);
});
test('opening, not payment, starts timer; reopening keeps original deadline', async () => {
  const c = listing(); await s.purchaseDemo(c.id, s.FAN); now += 60_000;
  assert.equal(s.order(c.id, s.FAN).viewUntil, null);
  const first = s.beginView(c, s.FAN); const until = first.viewUntil; now += 3000;
  assert.equal(s.beginView(c, s.FAN).viewUntil, until); now = until + 1;
  assert.equal(s.orderState(c, s.FAN), 'expired'); assert.throws(() => s.beginView(c, s.FAN), /已结束/);
});
test('group buyers have independent viewing windows and creator preview consumes none', async () => {
  const c = listing({ scope: 'group', audience: [s.CREATOR, s.FAN, fan2] });
  await s.purchaseDemo(c.id, s.FAN); await s.purchaseDemo(c.id, fan2);
  const first = s.beginView(c, s.FAN); now = first.viewUntil + 1;
  assert.equal(s.orderState(c, s.FAN), 'expired'); assert.equal(s.orderState(c, fan2), 'ready');
  assert.equal(s.beginView(c, s.CREATOR).preview, true); assert.equal(s.orders().length, 2);
});
test('non-ephemeral content reopens until purchase access expires', async () => {
  const c = listing({ burn: false }); await s.purchaseDemo(c.id, s.FAN);
  s.beginView(c, s.FAN); now += 30_000; assert.equal(s.orderState(c, s.FAN), 'ready');
  now = s.order(c.id, s.FAN).accessUntil + 1; assert.equal(s.orderState(c, s.FAN), 'expired');
});
test('purchase eligibility and creator-specific group gates are enforced by demo model', async () => {
  const c = listing({ scope: 'dm', audience: [s.CREATOR, s.FAN] });
  await assert.rejects(s.purchaseDemo(c.id, fan2), /未向/);
  await assert.rejects(s.purchaseDemo(c.id, s.CREATOR), /直接预览/);
  await s.purchaseDemo(c.id, s.FAN);
  assert.equal(s.hasPurchased(s.FAN, s.CREATOR), true);
  assert.equal(s.hasPurchased(s.FAN, Object.keys(s.PEOPLE)[3]), false);
});
test('UIDs are stable, distinct; follows belong to each demo identity', () => {
  assert.equal(new Set(Object.keys(s.PEOPLE).map(s.uidOf)).size, 4);
  s.setIdentity(s.FAN); s.toggleFollow(s.CREATOR); assert.deepEqual(s.follows(), [s.CREATOR]);
  s.setIdentity(fan2); assert.deepEqual(s.follows(), []);
});
