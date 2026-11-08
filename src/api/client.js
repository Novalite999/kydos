// Browser client for the Kydos API (Vercel Functions + Neon). It keeps the same
// surface the app used with Base44 — entities.X.filter/create/update/subscribe,
// functions.invoke, auth.me, integrations.Core.UploadFile — so pages stay unchanged.
import bs58 from 'bs58';

const POLL_MS = 8000;

function apiError(status, data, fallback) {
  const message = (data && typeof data === 'object' && data.error) || fallback || `Request failed (${status})`;
  return Object.assign(new Error(message), { status, data, response: { status, data } });
}

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method, credentials: 'same-origin',
      headers: body !== undefined && !raw ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw apiError(0, null, 'Network error. Check your connection and try again.');
  }
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; } }
  if (!response.ok) throw apiError(response.status, data);
  return data;
}

// --- Live updates -------------------------------------------------------------
// Local writes notify subscribers immediately; other people's writes arrive by polling.
const channels = new Map();
function channel(type) {
  let c = channels.get(type);
  if (!c) {
    c = { listeners: new Set(), timer: null, since: new Date().toISOString() };
    channels.set(type, c);
  }
  return c;
}
function emit(type, event) {
  for (const listener of channel(type).listeners) { try { listener(event); } catch (error) { console.error(error); } }
}
async function poll(type) {
  const c = channel(type);
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const rows = await request(`entities/${type}/changes?since=${encodeURIComponent(c.since)}`);
    for (const row of rows) {
      if (row.updated_date > c.since) c.since = row.updated_date;
      emit(type, { type: row.created_date === row.updated_date ? 'create' : 'update', id: row.id, data: row });
    }
  } catch { /* Polling is best effort; the next tick retries. */ }
}
function subscribe(type, listener) {
  const c = channel(type);
  c.listeners.add(listener);
  if (!c.timer) c.timer = setInterval(() => poll(type), POLL_MS);
  return () => {
    c.listeners.delete(listener);
    if (!c.listeners.size && c.timer) { clearInterval(c.timer); c.timer = null; }
  };
}

function entity(type) {
  const query = (filter, sort, limit, skip) => {
    const params = new URLSearchParams();
    if (filter && Object.keys(filter).length) params.set('q', JSON.stringify(filter));
    if (sort) params.set('sort', sort);
    if (limit) params.set('limit', String(limit));
    if (skip) params.set('skip', String(skip));
    const qs = params.toString();
    return request(`entities/${type}${qs ? `?${qs}` : ''}`);
  };
  return {
    list: (sort, limit, skip) => query({}, sort, limit, skip),
    filter: query,
    get: id => request(`entities/${type}/${encodeURIComponent(id)}`),
    async create(data) {
      const row = await request(`entities/${type}`, { method: 'POST', body: data });
      emit(type, { type: 'create', id: row.id, data: row });
      return row;
    },
    async bulkCreate(items) { return Promise.all(items.map(item => this.create(item))); },
    async update(id, data) {
      const row = await request(`entities/${type}/${encodeURIComponent(id)}`, { method: 'PATCH', body: data });
      emit(type, { type: 'update', id, data: row });
      return row;
    },
    async delete(id) {
      const result = await request(`entities/${type}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      emit(type, { type: 'delete', id, data: { id } });
      return result;
    },
    async deleteMany(filter) {
      const result = await request(`entities/${type}/delete-many`, { method: 'POST', body: { query: filter } });
      emit(type, { type: 'delete', id: null, data: null });
      return result;
    },
    subscribe: listener => subscribe(type, listener),
  };
}

// --- Auth (sign in with a Solana wallet) ---------------------------------------
const authListeners = new Set();
const notifyAuth = user => authListeners.forEach(listener => listener(user));

const auth = {
  me: () => request('auth/me'),
  async isAuthenticated() { try { await auth.me(); return true; } catch { return false; } },
  onChange(listener) { authListeners.add(listener); return () => authListeners.delete(listener); },
  /** Signs a free, human-readable challenge with the wallet; no transaction is sent. */
  async signInWithWallet(wallet, signMessage) {
    if (!wallet || typeof signMessage !== 'function') throw new Error('Connect your wallet first.');
    const { message, token } = await request('auth/challenge', { method: 'POST', body: { wallet } });
    const signed = await signMessage(new TextEncoder().encode(message));
    const bytes = signed?.signature ?? signed;
    const user = await request('auth/verify', { method: 'POST', body: { wallet, token, signature: bs58.encode(bytes) } });
    notifyAuth(user);
    return user;
  },
  async logout(redirectTo) {
    try { await request('auth/logout', { method: 'POST' }); } finally {
      notifyAuth(null);
      if (redirectTo) window.location.href = typeof redirectTo === 'string' ? redirectTo : '/';
    }
  },
  redirectToLogin(returnTo) {
    const target = returnTo ? `?returnTo=${encodeURIComponent(new URL(returnTo, window.location.href).pathname)}` : '';
    window.location.href = `/login${target}`;
  },
};

export const api = {
  entities: new Proxy({}, { get: (_, name) => (typeof name === 'string' ? entity(name) : undefined) }),
  functions: {
    async invoke(name, body = {}) {
      return { data: await request(`functions/${encodeURIComponent(name)}`, { method: 'POST', body }) };
    },
  },
  auth,
  integrations: {
    Core: {
      async UploadFile({ file }) {
        const type = file.type || 'application/octet-stream';
        return request('upload', { method: 'POST', body: file, raw: true, headers: { 'Content-Type': type } });
      },
    },
  },
  app: { getPublicSettings: async () => ({ id: 'kydos', public_settings: {} }) },
};
