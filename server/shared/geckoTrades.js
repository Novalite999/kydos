// Latest swaps in the token's busiest pool (GeckoTerminal, last 24h, newest first).
import { gecko, topPool } from './geckoCandles.js';
import { shared } from './sharedCache.js';

const TTL = 12_000, LIMIT = 60;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const num = value => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; };

export function toTrade(item, mint) {
  const a = item?.attributes || {};
  const kind = a.kind === 'buy' || a.kind === 'sell' ? a.kind : null;
  const time = Date.parse(a.block_timestamp);
  if (!kind || !Number.isFinite(time) || !SIGNATURE.test(a.tx_hash || '')) return null;
  // With `token=<mint>`, a buy receives the token and a sell gives it away.
  const ours = kind === 'buy' ? { amount: a.to_token_amount, price: a.price_to_in_usd, address: a.to_token_address } : { amount: a.from_token_amount, price: a.price_from_in_usd, address: a.from_token_address };
  if (ours.address && ours.address !== mint) return null;
  return {
    signature: a.tx_hash, time, kind, usd: num(a.volume_in_usd), amount: num(ours.amount), price: num(ours.price),
    trader: ADDRESS.test(a.tx_from_address || '') ? a.tx_from_address : null,
  };
}

export async function readRecentTrades(mint, { fetchImpl = fetch, now = Date.now(), retryDelay } = {}) {
  const pool = await topPool(mint, { fetchImpl, now, retryDelay });
  if (!pool) return { mint, pool: null, trades: [], fetchedAt: now, source: 'GeckoTerminal' };
  const page = await shared(`gecko:trades:${pool.address}:${mint}`, TTL, async () => {
    const body = await gecko(`/pools/${pool.address}/trades?token=${mint}`, fetchImpl, { retryDelay });
    return Array.isArray(body?.data) ? body.data : [];
  }, { maxStale: 30 * 60_000, now: () => now });
  const list = Array.isArray(page.value) ? page.value : [];
  const trades = list.map(item => toTrade(item, mint)).filter(Boolean).sort((a, b) => b.time - a.time).slice(0, LIMIT);
  return { mint, pool: { address: pool.address, name: pool.name }, trades, fetchedAt: page.at, stale: page.stale, source: 'GeckoTerminal' };
}
