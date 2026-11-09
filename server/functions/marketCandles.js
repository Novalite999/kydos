import { CandleError, chartInput, noteChartInterest, readJupiterCandles } from '../shared/marketCandles.js';
import { readGeckoCandles, topPool } from '../shared/geckoCandles.js';
import { readMarketRequest } from '../shared/marketRequest.js';

// Real pool candles from GeckoTerminal first; the sampled Jupiter price stream
// (pool = mint) is the fallback for tokens GeckoTerminal does not index yet.
export async function readCandles(input, entities, deps = {}) {
  const sampled = () => readJupiterCandles(entities.JupiterCandle, { ...input, pool: input.mint });
  if (input.pool === input.mint) return sampled();
  try {
    const pool = input.pool ? { address: input.pool, name: 'Top pool' } : await topPool(input.mint, deps);
    if (!pool) return sampled();
    const page = await readGeckoCandles(input, pool, deps);
    if (!input.pool) return page;
    // A pinned pool keeps the name it was shown with; refresh it from the cache when known.
    const known = await topPool(input.mint, deps).catch(() => null);
    return known?.address === pool.address ? { ...page, pool: { ...page.pool, name: known.name } } : page;
  } catch (error) {
    // Once a chart is pinned to a pool, switching sources mid-session would mix prices.
    if (input.pool) throw error;
    console.warn('GeckoTerminal candles unavailable, using sampled prices:', input.mint, input.interval, error.code || '', error.message);
    return sampled();
  }
}

export default async function(request, ctx) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
  try {
    const query = new URL(request.url).searchParams;
    const raw = request.method === 'GET'
      ? { mint: query.get('mint'), interval: query.get('interval'), pool: query.get('pool') || null, before: query.get('before') ? Number(query.get('before')) : null }
      : await readMarketRequest(request);
    const input = chartInput(raw);
    const entities = ctx.entities;
    if (!input.before) await noteChartInterest(entities.MarketChartInterest, input.mint).catch(() => { /* An optional interest hint must never block a public chart read. */ });
    return Response.json(await readCandles(input, entities), { headers });
  } catch (error) {
    if (error instanceof CandleError || error.status === 400) {
      return Response.json({ error: error.message, code: error.code || 'invalid_input', retryAfter: error.retryAfter || 60 }, { status: error.status, headers });
    }
    console.error('marketCandles failed', error);
    return Response.json({ error: 'Chart data is temporarily unavailable.', retryAfter: 60 }, { status: 503, headers });
  }
}
