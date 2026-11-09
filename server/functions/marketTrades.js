import { CandleError } from '../shared/marketCandles.js';
import { isSolanaMint } from '../shared/marketCatalog.js';
import { readRecentTrades } from '../shared/geckoTrades.js';

export default async function(request) {
  const headers = { 'Cache-Control': 'no-store' };
  const url = new URL(request.url);
  let mint = url.searchParams.get('mint');
  if (request.method === 'POST') mint = (await request.json().catch(() => ({}))).mint;
  if (!isSolanaMint(mint)) return Response.json({ error: 'A valid Solana mint is required.' }, { status: 400, headers });
  try {
    return Response.json(await readRecentTrades(mint), { headers });
  } catch (error) {
    const status = error instanceof CandleError ? error.status : 503;
    if (!(error instanceof CandleError)) console.error('marketTrades failed', error);
    return Response.json({ error: error instanceof CandleError ? error.message : 'Recent trades are temporarily unavailable.', retryAfter: error.retryAfter || 30 }, { status, headers });
  }
}
