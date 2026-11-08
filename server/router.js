// HTTP routes that replace the Base44 platform API.
import { createChallenge, sessionCookie, sessionUser, verifyChallenge } from './auth.js';
import { ensureSchema, sql } from './db.js';
import { entityStore, serviceEntities } from './entities.js';
import { canRead, writableStore } from './rules.js';
import { FUNCTIONS } from './functions/index.js';

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const TYPE = /^[A-Z][A-Za-z0-9]{1,48}$/;
const MAX_UPLOAD = 4 * 1024 * 1024; // Vercel request bodies are capped at 4.5 MB.
const UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'application/json']);

async function body(req) {
  const text = await req.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw fail('Invalid JSON body.'); }
}

function routePath(req) {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('path');
  const raw = fromQuery != null ? fromQuery : url.pathname.replace(/^\/api\/?/, '');
  return raw.split('/').filter(Boolean).map(decodeURIComponent);
}

// The same shape server functions used to get from Base44's createClientFromRequest.
function contextFor(req) {
  const user = sessionUser(req);
  const cronSecret = process.env.CRON_SECRET;
  const cron = cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`;
  const effective = user || (cron ? { id: 'cron', role: 'admin', disabled: false } : null);
  const entities = serviceEntities(effective?.id || null);
  return {
    user: effective,
    auth: {
      me: async () => { if (!effective) throw fail('Sign in required.', 401); return effective; },
      isAuthenticated: async () => !!effective,
    },
    entities,
    asServiceRole: { entities },
  };
}

async function entities(req, [type, id, extra]) {
  if (!TYPE.test(type || '')) throw fail('Unknown entity.', 404);
  const user = sessionUser(req), url = new URL(req.url), method = req.method;
  if (method === 'GET') {
    if (!canRead(type, user)) throw fail('Not allowed.', user ? 403 : 401);
    const store = entityStore(type);
    if (id === 'changes') return json(await store.changes(url.searchParams.get('since') || new Date(Date.now() - 60000).toISOString()));
    if (id) return json(await store.get(id));
    const q = url.searchParams.get('q');
    let query = {};
    if (q) { try { query = JSON.parse(q); } catch { throw fail('Invalid query.'); } }
    return json(await store.filter(query, url.searchParams.get('sort') || undefined, url.searchParams.get('limit') || undefined, url.searchParams.get('skip') || undefined));
  }
  if (method === 'POST' && id === 'delete-many') {
    if (user?.role !== 'admin') throw fail('Administrator required.', 403);
    return json(await entityStore(type).deleteMany((await body(req)).query));
  }
  const store = writableStore(type, user);
  if (method === 'POST' && !id) return json(await store.create(await body(req)), 201);
  if (method === 'PATCH' && id && !extra) return json(await store.update(id, await body(req)));
  if (method === 'DELETE' && id && !extra) return json(await store.delete(id));
  throw fail('Method not allowed.', 405);
}

async function auth(req, [action]) {
  if (action === 'me') {
    const user = sessionUser(req);
    return user ? json(user) : json({ error: 'Not signed in.' }, 401);
  }
  if (req.method !== 'POST') throw fail('Use POST.', 405);
  if (action === 'challenge') {
    const { wallet } = await body(req);
    return json(createChallenge(wallet, new URL(req.url).host));
  }
  if (action === 'verify') {
    const input = await body(req);
    const token = verifyChallenge(input);
    return json(sessionUser(new Request(req.url, { headers: { authorization: `Bearer ${token}` } })), 200, { 'Set-Cookie': sessionCookie(token, req) });
  }
  if (action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(null, req) });
  throw fail('Not found.', 404);
}

async function upload(req) {
  const user = sessionUser(req);
  if (!user) throw fail('Sign in with your wallet to upload.', 401);
  const type = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!UPLOAD_TYPES.has(type)) throw fail('Upload a PNG, JPG, WebP, GIF, MP4 or WebM file.');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) throw fail('Empty upload.');
  if (bytes.length > MAX_UPLOAD) throw fail('Files must be 4 MB or smaller.', 413);
  await ensureSchema();
  const [row] = await sql().query('INSERT INTO files (content_type, bytes, size, uploaded_by) VALUES ($1, decode($2, \'hex\'), $3::int, $4) RETURNING id',
    [type, Buffer.from(bytes).toString('hex'), bytes.length, user.id]);
  const origin = new URL(req.url).origin;
  return json({ file_url: `${origin}/api/files/${row.id}` }, 201);
}

async function file(id) {
  if (!/^[0-9a-f]{32}$/.test(id || '')) throw fail('Not found.', 404);
  await ensureSchema();
  const [row] = await sql().query("SELECT content_type, encode(bytes, 'base64') AS b64 FROM files WHERE id = $1", [id]);
  if (!row) throw fail('Not found.', 404);
  return new Response(Buffer.from(row.b64.replace(/\s+/g, ''), 'base64'), { headers: { 'Content-Type': row.content_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}

async function health() {
  const configured = Object.fromEntries(['DATABASE_URL', 'SESSION_SECRET', 'HELIUS_RPC_URL', 'PINATA_JWT', 'JUP_API_KEY', 'ADMIN_WALLETS', 'GITHUB_TOKEN']
    .map(name => [name, !!process.env[name]]));
  let database = 'not configured';
  if (configured.DATABASE_URL) {
    try { await ensureSchema(); await sql().query('SELECT 1'); database = 'ok'; } catch (error) { database = `error: ${error.message}`; }
  }
  return json({ ok: database === 'ok' && configured.SESSION_SECRET, database, configured });
}

export async function handle(req) {
  const [section, ...rest] = routePath(req);
  try {
    if (section === 'health') return await health();
    if (section === 'auth') return await auth(req, rest);
    if (section === 'entities') return await entities(req, rest);
    if (section === 'upload' && req.method === 'POST') return await upload(req);
    if (section === 'files' && req.method === 'GET') return await file(rest[0]);
    if (section === 'functions') {
      const handler = FUNCTIONS[rest[0]];
      if (!handler) throw fail('This feature is not available on this server.', 404);
      return await handler(req, contextFor(req));
    }
    throw fail('Not found.', 404);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('API error', section, error);
    return json({ error: status >= 500 && !error.status ? 'Server error. Try again shortly.' : error.message }, status);
  }
}
