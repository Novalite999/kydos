import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, CrosshairMode, createChart } from 'lightweight-charts';
import { Button } from '@/components/ui/button';
import { formatPrice as formatSolPrice } from '@/lib/solana/marketMetrics';
import { formatPrice as formatUsdPrice, formatCompact } from '@/lib/markets';
import { canUpdateLastCandle } from '@/lib/solana/candles';

const UP = '#22c55e', DOWN = '#ef4444', ACCENT = '#f2b429';
export const CHART_TYPES = [
  { id: 'candles', label: 'Candles' },
  { id: 'heikin', label: 'Heikin-Ashi' },
  { id: 'bars', label: 'Bars' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
];
const STORAGE_KEY = 'kydos.chartType';
const readType = () => { try { const v = localStorage.getItem(STORAGE_KEY); return CHART_TYPES.some(t => t.id === v) ? v : 'candles'; } catch { return 'candles'; } };
const saveType = value => { try { localStorage.setItem(STORAGE_KEY, value); } catch { /* storage blocked */ } };

const isOhlc = type => type === 'candles' || type === 'heikin' || type === 'bars';
const lineBar = bar => ({ time: bar.time, value: bar.close });
const ohlcBar = bar => ({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
const volumeBar = bar => bar.volume == null ? { time: bar.time } : ({ time: bar.time, value: bar.volume, color: bar.close >= bar.open ? `${UP}66` : `${DOWN}66` });

// Heikin-Ashi smooths noise: each bar averages with the previous one.
export function heikinAshi(candles) {
  const out = [];
  for (const bar of candles) {
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const prev = out.at(-1);
    const open = prev ? (prev.open + prev.close) / 2 : (bar.open + bar.close) / 2;
    out.push({ time: bar.time, open, close, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close), volume: bar.volume });
  }
  return out;
}

function addPriceSeries(chart, type, priceFormat) {
  const common = { priceFormat, priceLineColor: ACCENT };
  if (type === 'candles' || type === 'heikin') return chart.addCandlestickSeries({ ...common, upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN });
  if (type === 'bars') return chart.addBarSeries({ ...common, upColor: UP, downColor: DOWN, thinBars: false });
  if (type === 'area') return chart.addAreaSeries({ ...common, lineColor: ACCENT, topColor: `${ACCENT}55`, bottomColor: `${ACCENT}05`, lineWidth: 2 });
  return chart.addLineSeries({ ...common, color: ACCENT, lineWidth: 2 });
}

export default function MarketCandleChart({ candles, timeframe, seriesKey = timeframe, currency = 'SOL', volumeCurrency = 'SOL', onLoadOlder = undefined, canLoadOlder = false, livePrice = null }) {
  const container = useRef(null), api = useRef(null), previous = useRef([]), frame = useRef(null);
  const following = useRef(true), applying = useRef(false), history = useRef({ onLoadOlder, canLoadOlder }), bars = useRef(new Map());
  const [chartType, setChartType] = useState(readType);
  const shown = useMemo(() => chartType === 'heikin' ? heikinAshi(candles) : candles, [candles, chartType]);
  history.current = { onLoadOlder, canLoadOlder };
  bars.current = new Map(candles.map(bar => [bar.time, bar]));
  const [legend, setLegend] = useState(null), [follow, setFollow] = useState(true);
  const formatPrice = useMemo(() => currency === 'USD' ? formatUsdPrice : formatSolPrice, [currency]);
  const hasVolume = candles.some(bar => bar.volume != null);

  useEffect(() => {
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8f8f8f', fontSize: 11 },
      grid: { vertLines: { color: '#1b1b1b' }, horzLines: { color: '#1b1b1b' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#292929', scaleMargins: { top: 0.08, bottom: hasVolume ? 0.24 : 0.06 } },
      timeScale: { borderColor: '#292929', timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 8 },
      localization: { priceFormatter: formatPrice },
    });
    /** @type {import('lightweight-charts').PriceFormatCustom} */
    const priceFormat = { type: 'custom', formatter: formatPrice, minMove: 0.000000000001 };
    const volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const price = addPriceSeries(chart, chartType, priceFormat);
    chart.subscribeCrosshairMove(event => setLegend(event.time == null ? null : bars.current.get(event.time) || null));
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (!range || applying.current) return;
      following.current = range.to >= previous.current.length - 1;
      setFollow(following.current);
      // Initial fit must not consume every history page. Load only after panning away from the latest bar.
      if (!following.current && range.from < 15 && history.current.canLoadOlder) history.current.onLoadOlder?.();
    });
    api.current = { chart, price, volume };
    return () => { chart.remove(); api.current = null; previous.current = []; frame.current = null; };
  }, [formatPrice, chartType, hasVolume]);

  useEffect(() => {
    if (!api.current) return;
    const { chart, price, volume } = api.current, identity = `${seriesKey}:${timeframe}:${currency}:${chartType}`, reset = frame.current !== identity;
    const toPoint = isOhlc(chartType) ? ohlcBar : lineBar;
    const range = chart.timeScale().getVisibleRange(), wasFollowing = following.current;
    applying.current = true;
    try {
      // Heikin-Ashi bars depend on their neighbours, so they are always redrawn.
      if (!reset && chartType !== 'heikin' && canUpdateLastCandle(previous.current, shown)) {
        for (const bar of shown.slice(previous.current.length - 1)) { price.update(toPoint(bar)); volume.update(volumeBar(bar)); }
      } else { price.setData(shown.map(toPoint)); volume.setData(shown.map(volumeBar)); }
      previous.current = shown; frame.current = identity;
      if (reset) {
        // Open on the most recent ~120 bars instead of squeezing all history in.
        const ts = chart.timeScale();
        if (shown.length > 120) ts.setVisibleLogicalRange({ from: shown.length - 120, to: shown.length + 3 }); else ts.fitContent();
        following.current = true; setFollow(true); setLegend(null);
      }
      else if (wasFollowing) chart.timeScale().scrollToRealTime();
      else if (range) chart.timeScale().setVisibleRange(range);
    } finally { applying.current = false; }
  }, [shown, timeframe, seriesKey, currency, formatPrice, chartType]);

  useEffect(() => {
    if (!api.current || !Number.isFinite(livePrice) || livePrice <= 0) return;
    const series = api.current.price;
    const line = series.createPriceLine({ price: livePrice, color: ACCENT, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Live' });
    return () => { if (api.current?.price === series) series.removePriceLine(line); };
  }, [livePrice, formatPrice, seriesKey, chartType]);

  const bar = legend ? bars.current.get(legend.time) || candles.at(-1) : candles.at(-1);
  const change = bar ? (bar.close - bar.open) / bar.open * 100 : null;
  const goLive = () => { following.current = true; setFollow(true); api.current?.chart.timeScale().scrollToRealTime(); };
  const pick = id => { setChartType(id); saveType(id); };
  const vol = bar?.volume == null ? '—' : `${formatCompact(bar.volume, volumeCurrency === 'USD')}${volumeCurrency === 'USD' ? '' : ` ${volumeCurrency}`}`;

  return <div>
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
      <div role="radiogroup" aria-label="Chart type" className="flex flex-wrap rounded-lg bg-background/70 p-1">
        {CHART_TYPES.map(type => <button key={type.id} type="button" role="radio" aria-checked={chartType === type.id} onClick={() => pick(type.id)}
          className={`min-h-8 rounded-md px-2.5 text-xs ${chartType === type.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{type.label}</button>)}
      </div>
      <Button size="sm" variant="ghost" onClick={goLive} disabled={follow}>Follow latest</Button>
    </div>
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 font-mono text-[11px] text-muted-foreground">
      {bar && <>
        <span>O <span className="text-foreground">{formatPrice(bar.open)}</span></span>
        <span>H <span className="text-foreground">{formatPrice(bar.high)}</span></span>
        <span>L <span className="text-foreground">{formatPrice(bar.low)}</span></span>
        <span>C <span className={bar.close >= bar.open ? 'text-emerald-400' : 'text-red-400'}>{formatPrice(bar.close)}</span></span>
        {Number.isFinite(change) && <span className={change >= 0 ? 'text-emerald-400' : 'text-red-400'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span>}
        <span>Vol <span className="text-foreground">{vol}</span></span>
      </>}
    </div>
    <div ref={container} className="h-[340px] w-full sm:h-[440px]" role="img" aria-label={`Interactive ${currency} price chart (${CHART_TYPES.find(t => t.id === chartType).label})${hasVolume ? ` with ${volumeCurrency} volume` : ', volume unavailable'}. Drag to pan and scroll or pinch to zoom.`}/>
    <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="block px-4 py-2 text-right text-[10px] text-muted-foreground underline">Charts by TradingView Lightweight Charts™</a>
  </div>;
}
