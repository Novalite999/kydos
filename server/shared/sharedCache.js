// Small key/value cache shared by every server instance (memory first, then Neon).
// Used for free third-party APIs with tight rate limits (GeckoTerminal ~30 calls/min).
import { entityStore } from '../entities.js';

const memory = new Map();
const inflight = new Map();
const store = () => entityStore('ProviderCache');

async function read(key) {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const [row] = await store().filter({ key }, '-at', 1);
    if (row && Number.isFinite(row.at)) {
      const entry = { value: row.value, at: row.at, id: row.id };
      memory.set(key, entry);
      return entry;
    }
  } catch (error) { console.warn('Shared cache read failed', error.message); }
  return null;
}

async function write(key, value, at, previous) {
  memory.set(key, { value, at, id: previous?.id });
  if (memory.size > 1000) memory.delete(memory.keys().next().value);
  try {
    if (previous?.id) await store().update(previous.id, { key, value, at });
    else { const row = await store().create({ key, value, at }); memory.set(key, { value, at, id: row.id }); }
  } catch (error) { console.warn('Shared cache write failed', error.message); }
}

/**
 * Returns { value, at, stale }. Fresh copies younger than `ttl` are reused; otherwise `load`
 * runs (one at a time per key on this instance). If `load` fails and a copy younger than
 * `maxStale` exists, that copy is returned with stale = true instead of the error.
 */
export async function shared(key, ttl, load, { maxStale = 24 * 3600_000, now = Date.now } = {}) {
  const existing = await read(key);
  if (existing && now() - existing.at < ttl) return { value: existing.value, at: existing.at, stale: false };
  if (inflight.has(key)) return inflight.get(key);
  const task = (async () => {
    try {
      const value = await load();
      const at = now();
      await write(key, value, at, existing);
      return { value, at, stale: false };
    } catch (error) {
      if (existing && now() - existing.at < maxStale) return { value: existing.value, at: existing.at, stale: true, error };
      throw error;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, task);
  return task;
}

export function clearSharedMemory() { memory.clear(); inflight.clear(); }
