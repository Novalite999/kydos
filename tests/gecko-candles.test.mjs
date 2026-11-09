import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCandles } from '../server/functions/marketCandles.js';
import { CandleError } from '../server/shared/marketCandles.js';

const mint = 'So11111111111111111111111111111111111111112';
const pool = 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE';
const now = 1_794_220_000_000;
const t0 = Math.floor(now / 1000 / 3600) * 3600;

function fakeGecko({ pools = [{ address: pool, name: 'SOL / USDC', reserve: '9000000' }], ohlcv, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (status !== 200) return new Response('{}', { status });
    if (url.includes('/tokens/')) return Response.json({ data: pools.map(p => ({ attributes: { address: p.address, name: p.name, reserve_in_usd: p.reserve } })) });
    return Response.json({ data: { attributes: { ohlcv_list: ohlcv } } });
  };
  return { fetchImpl, calls };
}
const noSamples = { JupiterCandle: { filter: async () => [] } };

test('uses the most liquid GeckoTerminal pool and returns ascending candles with volume', async () => {
  const ohlcv = [[t0, 150, 152, 149, 151, 1000], [t0 - 3600, 148, 151, 147, 150, 2000], [t0 - 7200, 147, 146, 147.5, 148, 500]];
  const { fetchImpl, calls } = fakeGecko({ ohlcv, pools: [{ address: 'So1ana1111111111111111111111111111111111112', name: 'small', reserve: '10' }, { address: pool, name: 'SOL / USDC', reserve: '9000000' }] });
  const page = await readCandles({ mint, interval: '4h', pool: null, before: null }, noSamples, { fetchImpl, now: now + 1 });
  assert.equal(page.pool.address, pool);
  assert.equal(page.source, 'GeckoTerminal');
  assert.deepEqual(page.candles.map(c => c.time), [t0 - 7200, t0 - 3600, t0]);
  assert.equal(page.candles[0].high, 148, 'wick widened to contain the body');
  assert.equal(page.candles[0].low, 147);
  assert.equal(page.candles[2].volume, 1000);
  assert.ok(calls[1].includes('/ohlcv/hour?') && calls[1].includes('aggregate=4') && calls[1].includes(`token=${mint}`));
});

test('falls back to sampled Jupiter prices when GeckoTerminal has no pool or fails', async () => {
  const empty = fakeGecko({ pools: [] });
  const page = await readCandles({ mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', interval: '1h', pool: null, before: null }, noSamples, { fetchImpl: empty.fetchImpl, now });
  assert.equal(page.pool.address, 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN');
  assert.equal(page.sampled, true);
  const down = fakeGecko({ status: 500 });
  assert.equal((await readCandles({ mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', interval: '1h', pool: null, before: null }, noSamples, { fetchImpl: down.fetchImpl, now })).sampled, true);
});

test('a chart pinned to a pool reports provider errors instead of switching source', async () => {
  const limited = fakeGecko({ status: 429 });
  await assert.rejects(readCandles({ mint, interval: '1h', pool: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zZ', before: null }, noSamples, { fetchImpl: limited.fetchImpl, now }), CandleError);
});

test('history pages stay before the cursor and expose the next cursor', async () => {
  const ohlcv = Array.from({ length: 300 }, (_, i) => [t0 - 3600 * (i + 10), 1, 1.1, 0.9, 1, 5]);
  const { fetchImpl, calls } = fakeGecko({ ohlcv });
  const before = t0 - 3600 * 10;
  const page = await readCandles({ mint, interval: '1h', pool, before }, noSamples, { fetchImpl, now: now + 2 });
  assert.ok(calls.at(-1).includes(`before_timestamp=${before + 1}`));
  assert.ok(page.candles.every(c => c.time <= before));
  assert.equal(page.hasMore, true);
  assert.equal(page.nextBefore, page.candles[0].time - 1);
});
