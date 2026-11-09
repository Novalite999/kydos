// Real OHLCV candles (open/high/low/close + USD volume) from GeckoTerminal's public API,
// taken from the token's most liquid Solana pool. Free, no key; ~30 requests/minute,
// so pool lookups and pages are cached in memory per server instance.
import { CandleError } from './marketCandles.js';

const API = 'https://api.geckoterminal.com/api/v2/networks/solana';
const HEADERS = { Accept: 'application/json;version=20230302' };
export const GECKO_FRAMES = { '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1] };
const PAGE = 300;
const POOL_TTL = 30 * 60_000, PAGE_TTL = 20_000, HISTORY_TTL = 10 * 60_000;
const pools = new Map(), pages = new Map();

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const cached = (map, key, ttl, now) => { const hit = map.get(key); return hit && now - hit.at < ttl ? hit.value : undefined; };
function remember(map, key, value, now) {
  map.set(key, { value, at: now });
  if (map.size > 500) map.delete(map.keys().next().value);
  return value;
}

async function gecko(path, fetchImpl) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetchImpl(`${API}${path}`, { headers: HEADERS, signal: controller.signal });
    if (res.status === 429) throw new CandleError('rate_limited', 'Chart provider is busy. Retrying shortly.', 503, 30);
    if (res.status === 404) return null;
    if (!res.ok) throw new CandleError('upstream', `Chart provider error (${res.status}).`, 503, 60);
    return await res.json();
  } catch (error) {
    if (error instanceof CandleError) throw error;
    throw new CandleError('upstream', 'Chart provider could not be reached.', 503, 60);
  } finally { clearTimeout(timer); }
}

/** The token's most liquid pool, or null when GeckoTerminal does not index it. */
export async function topPool(mint, { fetchImpl = fetch, now = Date.now() } = {}) {
  const hit = cached(pools, mint, POOL_TTL, now);
  if (hit !== undefined) return hit;
  const body = await gecko(`/tokens/${mint}/pools?page=1`, fetchImpl);
  const list = (body?.data || [])
    .map(item => ({ address: item?.attributes?.address, name: item?.attributes?.name, liquidity: Number(item?.attributes?.reserve_in_usd) || 0 }))
    .filter(pool => ADDRESS.test(pool.address || ''));
  list.sort((a, b) => b.liquidity - a.liquidity);
  const best = list[0] ? { address: list[0].address, name: list[0].name || 'Top pool', kind: 'pool', liquidityUsd: list[0].liquidity } : null;
  return remember(pools, mint, best, now);
}

// GeckoTerminal occasionally reports wicks that do not contain the body; widen them.
function toBar([time, open, high, low, close, volume]) {
  const t = Math.floor(Number(time)), o = Number(open), c = Number(close), v = Number(volume);
  if (!Number.isSafeInteger(t) || ![o, c, Number(high), Number(low)].every(n => Number.isFinite(n) && n > 0)) return null;
  return { time: t, open: o, high: Math.max(Number(high), o, c), low: Math.min(Number(low), o, c), close: c, volume: Number.isFinite(v) && v >= 0 ? v : 0 };
}

export async function readGeckoCandles(input, pool, { fetchImpl = fetch, now = Date.now() } = {}) {
  const [timeframe, aggregate] = GECKO_FRAMES[input.interval];
  const key = `${pool.address}:${input.interval}:${input.before ?? 'latest'}`;
  let list = cached(pages, key, input.before ? HISTORY_TTL : PAGE_TTL, now);
  if (!list) {
    const params = new URLSearchParams({ aggregate: String(aggregate), limit: String(PAGE), currency: 'usd', token: input.mint });
    if (input.before) params.set('before_timestamp', String(input.before + 1));
    const body = await gecko(`/pools/${pool.address}/ohlcv/${timeframe}?${params}`, fetchImpl);
    list = remember(pages, key, body?.data?.attributes?.ohlcv_list || [], now);
  }
  const byTime = new Map();
  for (const row of list) {
    const bar = Array.isArray(row) ? toBar(row) : null;
    if (bar && bar.time <= now / 1000 && (input.before == null || bar.time <= input.before)) byTime.set(bar.time, bar);
  }
  const candles = [...byTime.values()].sort((a, b) => a.time - b.time).slice(-PAGE);
  const hasMore = list.length >= PAGE && candles.length > 0;
  return {
    network: 'solana-mainnet', mint: input.mint, interval: input.interval, before: input.before,
    pool: { address: pool.address, name: pool.name, kind: 'pool' },
    candles, currency: 'USD', volumeCurrency: 'USD', volumeAvailable: true,
    source: 'GeckoTerminal', sampled: false, fetchedAt: now,
    hasMore, nextBefore: hasMore ? candles[0].time - 1 : null, stale: false, warning: null,
  };
}
