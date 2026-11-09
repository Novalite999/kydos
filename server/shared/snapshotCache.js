// One shared copy of each market snapshot for every visitor and server instance.
// Jupiter's free tier allows roughly one request per second; without this, each
// browser polling every 30s multiplied provider calls and triggered rate limits.
import { entityStore } from '../entities.js';

export const FRESH_MS = 20_000;      // serve the shared copy without asking Jupiter
export const FALLBACK_MS = 15 * 60_000; // on provider errors, keep serving the last good copy
const memory = new Map();
const inflight = new Map();

function store() { return entityStore('MarketSnapshotCache'); }

async function readShared(key) {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const [row] = await store().filter({ key }, '-at', 1);
    if (row?.snapshot && Number.isFinite(row.at)) {
      const value = { snapshot: row.snapshot, at: row.at, id: row.id };
      memory.set(key, value);
      return value;
    }
  } catch (error) { console.warn('Snapshot cache read failed', error.message); }
  return null;
}

async function writeShared(key, snapshot, at, previous) {
  memory.set(key, { snapshot, at, id: previous?.id });
  if (memory.size > 300) memory.delete(memory.keys().next().value);
  try {
    if (previous?.id) await store().update(previous.id, { key, snapshot, at });
    else {
      const row = await store().create({ key, snapshot, at });
      memory.set(key, { snapshot, at, id: row.id });
    }
  } catch (error) { console.warn('Snapshot cache write failed', error.message); }
}

/**
 * Returns { snapshot, fresh } where fresh = true when this call fetched new data
 * (so the caller can do once-per-fetch work such as candle sampling).
 */
export async function cachedSnapshot(key, fetchFresh, now = Date.now) {
  const shared = await readShared(key);
  if (shared && now() - shared.at < FRESH_MS) return { snapshot: shared.snapshot, fresh: false };
  // Collapse simultaneous requests on one instance into a single provider fetch.
  if (inflight.has(key)) return inflight.get(key);
  const task = (async () => {
    try {
      const snapshot = await fetchFresh();
      await writeShared(key, snapshot, now(), shared);
      return { snapshot, fresh: true };
    } catch (error) {
      if (shared && now() - shared.at < FALLBACK_MS) {
        console.warn('Market provider failed; serving the last good snapshot:', error.code || '', error.message);
        return { snapshot: shared.snapshot, fresh: false };
      }
      throw error;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, task);
  return task;
}

export function clearSnapshotMemory() { memory.clear(); inflight.clear(); }
