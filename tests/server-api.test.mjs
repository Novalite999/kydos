// End-to-end checks for the Vercel API that replaced Base44, run against an
// in-process Postgres (PGlite) so no network database is needed.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

process.env.SESSION_SECRET = 'x'.repeat(48);
process.env.DATABASE_URL = 'postgres://test';
const { setTestClient } = await import('../server/db.js');
const { handle } = await import('../server/router.js');

const BASE = 'https://kydos.test';
const call = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
  const init = { method, headers: { ...headers, ...(cookie ? { cookie } : {}) } };
  if (body !== undefined) init.body = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
  const res = await handle(new Request(BASE + path, init));
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
};

async function signIn(keys = nacl.sign.keyPair()) {
  const wallet = bs58.encode(keys.publicKey);
  const { data: challenge } = await call('/api/auth/challenge', { method: 'POST', body: { wallet } });
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), keys.secretKey));
  const res = await call('/api/auth/verify', { method: 'POST', body: { wallet, token: challenge.token, signature } });
  assert.equal(res.status, 200);
  return { wallet, cookie: res.headers.get('set-cookie').split(';')[0], keys };
}

before(async () => {
  const db = new PGlite();
  setTestClient({ query: async (text, params) => (await db.query(text, params)).rows });
});

test('health reports database and config', async () => {
  const { data } = await call('/api/health');
  assert.equal(data.database, 'ok');
  assert.equal(data.configured.SESSION_SECRET, true);
});

test('wallet sign-in sets a session; bad signatures are rejected', async () => {
  const { wallet, cookie } = await signIn();
  const me = await call('/api/auth/me', { cookie });
  assert.equal(me.data.id, wallet);
  assert.equal(me.data.role, 'user');
  assert.equal((await call('/api/auth/me')).status, 401);

  const keys = nacl.sign.keyPair(), other = nacl.sign.keyPair();
  const target = bs58.encode(keys.publicKey);
  const { data: challenge } = await call('/api/auth/challenge', { method: 'POST', body: { wallet: target } });
  const forged = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), other.secretKey));
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { wallet: target, token: challenge.token, signature: forged } })).status, 401);
});

test('admins come from ADMIN_WALLETS', async () => {
  const keys = nacl.sign.keyPair();
  process.env.ADMIN_WALLETS = bs58.encode(keys.publicKey);
  const { cookie } = await signIn(keys);
  assert.equal((await call('/api/auth/me', { cookie })).data.role, 'admin');
  process.env.ADMIN_WALLETS = '';
});

test('social entities: ownership, filters, sorting and counters', async () => {
  const alice = await signIn(), bob = await signIn();
  assert.equal((await call('/api/entities/Post', { method: 'POST', body: { author_id: alice.wallet, body: 'x' } })).status, 401);
  assert.equal((await call('/api/entities/Post', { method: 'POST', cookie: bob.cookie, body: { author_id: alice.wallet, body: 'spoof' } })).status, 403);

  const first = await call('/api/entities/Post', { method: 'POST', cookie: alice.cookie, body: { author_id: alice.wallet, body: 'gm @bob', like_count: 0, score: 5 } });
  assert.equal(first.status, 201);
  await call('/api/entities/Post', { method: 'POST', cookie: alice.cookie, body: { author_id: alice.wallet, body: 'second', like_count: 0, score: 9 } });

  const q = encodeURIComponent(JSON.stringify({ author_id: alice.wallet, score: { $gte: 6 } }));
  const filtered = await call(`/api/entities/Post?q=${q}&sort=-score&limit=10`);
  assert.deepEqual(filtered.data.map(p => p.body), ['second']);
  const rx = encodeURIComponent(JSON.stringify({ body: { $regex: '@bob(\\b|$)', $options: 'i' } }));
  assert.equal((await call(`/api/entities/Post?q=${rx}`)).data.length, 1);
  const inq = encodeURIComponent(JSON.stringify({ score: { $in: [5, 7] } }));
  assert.equal((await call(`/api/entities/Post?q=${inq}`)).data.length, 1);

  const id = first.data.id;
  assert.equal((await call(`/api/entities/Post/${id}`, { method: 'PATCH', cookie: bob.cookie, body: { body: 'hijack' } })).status, 403);
  assert.equal((await call(`/api/entities/Post/${id}`, { method: 'PATCH', cookie: bob.cookie, body: { like_count: 1 } })).status, 200);
  assert.equal((await call(`/api/entities/Post/${id}`, { method: 'PATCH', cookie: bob.cookie, body: { like_count: 50 } })).status, 400);
  assert.equal((await call(`/api/entities/Post/${id}`, { method: 'DELETE', cookie: bob.cookie })).status, 403);
  assert.equal((await call(`/api/entities/Post/${id}`, { method: 'PATCH', cookie: alice.cookie, body: { body: 'edited' } })).data.body, 'edited');

  const like = { user_id: bob.wallet, post_id: id };
  const a = await call('/api/entities/PostLike', { method: 'POST', cookie: bob.cookie, body: like });
  const b = await call('/api/entities/PostLike', { method: 'POST', cookie: bob.cookie, body: like });
  assert.equal(a.data.id, b.data.id, 'duplicate likes collapse to one record');

  const since = new Date(Date.now() - 60000).toISOString();
  assert.ok((await call(`/api/entities/Post/changes?since=${encodeURIComponent(since)}`)).data.length >= 2);
});

test('private entities are not readable or writable from the browser', async () => {
  const user = await signIn();
  assert.equal((await call('/api/entities/AdminLaunchReceipt')).status, 401);
  assert.equal((await call('/api/entities/AstraMessage', { cookie: user.cookie })).status, 403);
  assert.equal((await call('/api/entities/SolanaTrade', { method: 'POST', cookie: user.cookie, body: { mint: 'x' } })).status, 403);
  assert.equal((await call('/api/entities/SolanaTrade')).status, 200);
});

test('uploads are stored and served back', async () => {
  const user = await signIn();
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  assert.equal((await call('/api/upload', { method: 'POST', body: png, headers: { 'content-type': 'image/png' } })).status, 401);
  const up = await call('/api/upload', { method: 'POST', cookie: user.cookie, body: png, headers: { 'content-type': 'image/png' } });
  assert.equal(up.status, 201);
  const path = new URL(up.data.file_url).pathname;
  const got = await call(path);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.deepEqual([...got.data], [...png]);
});

test('server functions run through the context shim', async () => {
  const res = await call('/api/functions/launchMetadata', { method: 'POST', body: { action: 'metadata' } });
  assert.equal(res.status, 401);
  assert.equal((await call('/api/functions/astraChat', { method: 'POST', body: {} })).status, 503);
  assert.equal((await call('/api/functions/nope', { method: 'POST', body: {} })).status, 404);
});

test('service store supports the bulk writes used by candle sampling', async () => {
  const { entityStore } = await import('../server/entities.js');
  const store = entityStore('JupiterCandle');
  const [a, b] = await store.bulkCreate([{ mint: 'm1', interval: '1m', is_closed: false, close: 1 }, { mint: 'm2', interval: '1m', is_closed: false, close: 2 }]);
  const updated = await store.bulkUpdate([{ id: a.id, close: 5 }, { id: b.id, is_closed: true }]);
  assert.equal(updated.length, 2);
  assert.equal((await store.get(a.id)).close, 5);
  assert.equal((await store.get(a.id)).mint, 'm1');
  assert.equal((await store.get(b.id)).is_closed, true);
  assert.equal((await store.filter({ is_closed: false })).length, 1);
  assert.equal((await store.deleteMany({ id: { $in: [a.id, b.id] } })).deleted, 2);
});
