// Real OHLCV candles (open/high/low/close + USD volume) from GeckoTerminal's public API,
// taken from the token's most liquid Solana pool. Free, no key; ~30 requests/minute,
// so pool lookups and pages are shared across all visitors and instances (sharedCache),
// and a "busy" reply serves the last real candles instead of downgrading the chart.
import { CandleError } from './marketCandles.js';
import { shared } from './sharedCache.js';

const API = 'https://api.geckoterminal.com/api/v2/networks/solana';
const HEADERS = { Accept: 'application/json;version=20230302' };
export const GECKO_FRAMES = { '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1] };
const PAGE = 300;
const POOL_TTL = 30 * 60_000, HISTORY_TTL = 24 * 3600_000;
// How long the latest page is reused: roughly half a candle, capped at 10 minutes.
const LATEST_TTL = { '1m': 30_000, '5m': 60_000, '15m': 120_000, '1h': 300_000, '4h': 600_000, '1d': 600_000 };

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** GeckoTerminal GET with one retry after a short pause when it reports "busy" (429). */
export async function gecko(path, fetchImpl, { retryDelay = 1200 } = {}) {
  try { return await geckoOnce(path, fetchImpl); }
  catch (error) {
    if (error.code !== 'rate_limited' || !retryDelay) throw error;
    await wait(retryDelay);
    return geckoOnce(path, fetchImpl);
  }
}

async function geckoOnce(path, fetchImpl) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetchImpl(`${API}${path}`, { headers: HEADERS, signal: controller.signal });
    if (res.status === 429) throw new CandleError('rate_limited', 'Chart provider is busy. Retrying shortly.', 503, 30);
    if (res.status === 404) return null;
    if (!res.ok) throw new CandleError('upstream', `Chart provider error (${res.status}) for ${path.split('?')[0]}.`, 503, 60);
    return await res.json();
  } catch (error) {
    if (error instanceof CandleError) throw error;
    throw new CandleError('upstream', 'Chart provider could not be reached.', 503, 60);
  } finally { clearTimeout(timer); }
}

/** The token's most liquid pool, or null when GeckoTerminal does not index it. */
export async function topPool(mint, { fetchImpl = fetch, now = Date.now(), retryDelay } = {}) {
  const { value } = await shared(`gecko:pool:${mint}`, POOL_TTL, () => findTopPool(mint, fetchImpl, retryDelay), { maxStale: 7 * 24 * 3600_000, now: () => now });
  return value;
}

async function findTopPool(mint, fetchImpl, retryDelay) {
  const body = await gecko(`/tokens/${mint}/pools?page=1`, fetchImpl, { retryDelay });
  const list = (body?.data || [])
    .map(item => ({ address: item?.attributes?.address, name: item?.attributes?.name,
      liquidity: Number(item?.attributes?.reserve_in_usd) || 0, volume: Number(item?.attributes?.volume_usd?.h24) || 0 }))
    .filter(pool => ADDRESS.test(pool.address || ''));
  // The busiest pool gives the densest, most accurate candles. A liquidity floor keeps
  // out thin pools whose price can be pushed around; fall back to all pools if none pass.
  const floor = list.filter(pool => pool.liquidity >= 10_000);
  const ranked = (floor.length ? floor : list).sort((a, b) => b.volume - a.volume || b.liquidity - a.liquidity);
  return ranked[0] ? { address: ranked[0].address, name: ranked[0].name || 'Top pool', kind: 'pool', liquidityUsd: ranked[0].liquidity } : null;
}

// GeckoTerminal occasionally reports wicks that do not contain the body; widen them.
function toBar([time, open, high, low, close, volume]) {
  const t = Math.floor(Number(time)), o = Number(open), c = Number(close), v = Number(volume);
  if (!Number.isSafeInteger(t) || ![o, c, Number(high), Number(low)].every(n => Number.isFinite(n) && n > 0)) return null;
  return { time: t, open: o, high: Math.max(Number(high), o, c), low: Math.min(Number(low), o, c), close: c, volume: Number.isFinite(v) && v >= 0 ? v : 0 };
}

export async function readGeckoCandles(input, pool, { fetchImpl = fetch, now = Date.now(), retryDelay } = {}) {
  const [timeframe, aggregate] = GECKO_FRAMES[input.interval];
  const key = `gecko:ohlcv:${pool.address}:${input.mint}:${input.interval}:${input.before ?? 'latest'}`;
  const params = new URLSearchParams({ aggregate: String(aggregate), limit: String(PAGE), currency: 'usd', token: input.mint });
  if (input.before) params.set('before_timestamp', String(input.before + 1));
  const page = await shared(key, input.before ? HISTORY_TTL : LATEST_TTL[input.interval],
    async () => (await gecko(`/pools/${pool.address}/ohlcv/${timeframe}?${params}`, fetchImpl, { retryDelay }))?.data?.attributes?.ohlcv_list || [],
    { now: () => now });
  const list = Array.isArray(page.value) ? page.value : [];
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
    source: 'GeckoTerminal', sampled: false, fetchedAt: page.at,
    hasMore, nextBefore: hasMore ? candles[0].time - 1 : null, stale: page.stale,
    warning: page.stale ? 'Chart provider is busy; showing the most recent saved candles.' : null,
  };
}
