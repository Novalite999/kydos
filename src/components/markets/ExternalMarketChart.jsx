import { requestStatus } from '@/lib/requestError';
import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import MarketCandleChart from '@/components/solana/MarketCandleChart';
import useMarketCandles from '@/hooks/useMarketCandles';
import { CANDLE_INTERVALS } from '@/lib/marketCandles';
import { ageLabel, formatPrice } from '@/lib/markets';

const formatCap = value => typeof value === 'number' && Number.isFinite(value) && value > 0
  ? `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: value >= 1e9 ? 2 : 1 }).format(value)}` : '—';

// Like Jupiter's "Auto": pick the candle size from the token's age so the chart
// shows a few hundred candles instead of one or two daily bars for a new coin.
export function autoInterval(createdAt, now = Date.now()) {
  const hours = createdAt ? (now - Date.parse(createdAt)) / 3600_000 : NaN;
  if (!Number.isFinite(hours) || hours < 0) return '15m';
  if (hours < 4) return '1m';
  if (hours < 20) return '5m';
  if (hours < 72) return '15m';
  if (hours < 12 * 24) return '1h';
  if (hours < 50 * 24) return '4h';
  return '1d';
}
const SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

export default function ExternalMarketChart({ mint, symbol, livePrice, supply = null, createdAt = null }) {
  const [choice, setChoice] = useState('auto');
  const auto = autoInterval(createdAt);
  const interval = choice === 'auto' ? auto : choice;
  const setInterval = setChoice;
  const [mode, setMode] = useState('price');
  const feed = useMarketCandles(mint, interval), { page } = feed;
  // Market cap view = price × circulating supply (as on Jupiter's Price / MC toggle).
  const capMode = mode === 'mcap' && supply > 0;
  const candles = useMemo(() => capMode
    ? feed.candles.map(bar => ({ ...bar, open: bar.open * supply, high: bar.high * supply, low: bar.low * supply, close: bar.close * supply }))
    : feed.candles, [feed.candles, capMode, supply]);
  const modeToggle = supply > 0 ? <div aria-label="Price or market cap" className="flex rounded-lg bg-background/70 p-1">
    {[['price', 'Price'], ['mcap', 'MCap']].map(([id, label]) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}
      className={`min-h-8 rounded-md px-2.5 text-xs ${mode === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
  </div> : null;
  const signIn = [401, 403].includes(requestStatus(feed.error));
  return <section aria-label={`${symbol} interactive price chart`} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card/70">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
      <div><h2 className="text-sm font-semibold">{symbol} / USD <span className="ml-2 font-mono text-primary">{capMode ? formatCap((livePrice ?? feed.candles.at(-1)?.close) * supply) : formatPrice(livePrice ?? candles.at(-1)?.close)}</span></h2><p className="mt-1 text-[11px] text-muted-foreground">{page ? `${page.pool.name} · ${page.sampled ? 'sampled prices' : 'trades'} · ${ageLabel(page.fetchedAt, feed.now)}` : 'Price history'}</p></div>
      <div className="flex max-w-full flex-wrap items-center gap-2"><div aria-label="Candle interval" className="flex rounded-lg bg-background/70 p-1">{['auto', ...CANDLE_INTERVALS].map(item => <button key={item} type="button" aria-pressed={item === choice} onClick={() => setInterval(item)} title={item === 'auto' ? `Auto picks ${auto} for this token` : undefined} className={`min-h-9 rounded-md px-2.5 text-xs ${choice === item ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{item === 'auto' ? `Auto · ${auto}` : item}</button>)}</div><button type="button" aria-label="Refresh chart" disabled={feed.isFetching} onClick={() => feed.refetch()} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${feed.isFetching ? 'animate-spin' : ''}`}/></button></div>
    </header>
    {choice !== 'auto' && !feed.isPending && candles.length > 0 && candles.length < 12 && !feed.hasMore && (() => {
      const span = candles.at(-1).time - candles[0].time + SECONDS[interval];
      // Largest candle size that still gives ~100 candles over this history.
      const smaller = CANDLE_INTERVALS.filter(item => SECONDS[item] < SECONDS[interval] && span / SECONDS[item] >= 100).at(-1) || '1m';
      return <p role="status" className="border-b border-border bg-primary/5 px-4 py-2 text-xs text-muted-foreground">Only {candles.length} {interval} candle{candles.length === 1 ? '' : 's'}: this market's trading history is short. <button type="button" onClick={() => setInterval(smaller)} className="text-primary underline underline-offset-2">Show {smaller} candles</button></p>;
    })()}
    {feed.stale && candles.length > 0 && <p role="status" className="border-b border-amber-400/20 bg-amber-400/5 px-4 py-2 text-xs text-amber-200">Chart updates are delayed. Showing saved candles. {page?.warning || feed.error?.message}</p>}
    {candles.length > 0 ? <MarketCandleChart candles={candles} timeframe={interval} seriesKey={`${mint}:${interval}:${capMode ? 'mcap' : 'price'}`} livePrice={capMode && livePrice ? livePrice * supply : livePrice} currency="USD" volumeCurrency="USD" valueFormatter={capMode ? formatCap : null} toolbar={modeToggle} onLoadOlder={feed.loadOlder} canLoadOlder={feed.hasMore && !feed.loadingOlder && !feed.historyError}/> : <div className="flex min-h-[390px] flex-col items-center justify-center gap-3 px-6 text-center"><p role="status" className="text-sm text-muted-foreground">{feed.isPending && !feed.error ? 'Loading price history…' : feed.error?.message || 'Price history starts with new Jupiter samples. The first sample will appear after collection runs.'}</p>{signIn ? <Link to="/login" className="text-sm text-primary underline">Sign in</Link> : <button type="button" disabled={feed.isFetching} onClick={() => feed.refetch()} className="rounded-lg border border-border px-4 py-2 text-xs disabled:opacity-40">{feed.isFetching ? 'Loading…' : 'Retry chart'}</button>}</div>}
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-[11px] text-muted-foreground"><div><p>{page?.sampled === false
        ? <>Candles from <a href={`https://www.geckoterminal.com/solana/pools/${page.pool.address}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">GeckoTerminal</a> · {candles.length} candles · volume in USD</>
        : page ? <><a href={`https://jup.ag/tokens/${mint}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Jupiter Price V3</a> · {candles.length} sampled candles · volume unavailable</> : 'Loading market data'}</p>
      <p className="mt-1">{page?.sampled ? 'No trading pool found for this token yet, so the chart shows sampled prices. ' : ''}Drag to pan; scroll or pinch to zoom.</p>{feed.historyError && <p role="status" className="mt-2 text-amber-200">{feed.historyError}</p>}{feed.atHistoryLimit && <p className="mt-2">History limit reached for this view. Choose a wider interval to see further back.</p>}</div><button type="button" onClick={feed.loadOlder} disabled={!feed.hasMore || feed.loadingOlder} className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">{feed.loadingOlder ? 'Loading older…' : 'Load older'}</button></footer>
  </section>;
}