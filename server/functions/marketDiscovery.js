import { secrets } from '../runtime.js';
import { fetchMarketSnapshot, MarketProviderError } from '../shared/jupiterMarkets.js';
import { writeJupiterCandles } from '../shared/jupiterCandleWriter.js';
import { readMarketRequest } from '../shared/marketRequest.js';
import { cachedSnapshot } from '../shared/snapshotCache.js';

export default async function(request, ctx) {
  if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'Method not allowed' }, { status: 405 });
  try {
    const input = request.method === 'POST' ? await readMarketRequest(request) : {};
    const interval = input.interval || '24h', mint = input.mint ?? null;
    const { snapshot: data, fresh } = await cachedSnapshot(`${interval}:${mint || ''}`,
      () => fetchMarketSnapshot({ apiKey: secrets.get('JUP_API_KEY'), interval, mint }));
    // Candle samples are written once per real provider fetch, not per visitor.
    if (!fresh) return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
    const prices = Object.fromEntries(data.tokens.filter(token => Number.isFinite(token.price) && token.price > 0)
      .map(token => [token.mint, { price: token.price, blockId: token.priceBlockId }]));
    try {
      // Only provider-validated prices are persisted; callers cannot submit candle values.
      await writeJupiterCandles(ctx.asServiceRole.entities, prices, data.fetchedAt);
    } catch (error) {
      console.error('Market candle sampling failed', error);
      data.sampleError = 'Chart sampling is temporarily unavailable.';
    }
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const known = error instanceof MarketProviderError || error.status === 400;
    return Response.json({ error: known ? error.message : 'Market data is temporarily unavailable.' }, { status: known ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}