import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Globe, Send, ShieldAlert, ShieldCheck, X as XIcon } from 'lucide-react';
import { formatCompact, formatPrice, MARKET_INTERVALS } from '@/lib/markets';
import { PriceChange } from '@/components/markets/MarketPrimitives';
import useRecentTrades from '@/hooks/useRecentTrades';

const short = value => `${value.slice(0, 4)}…${value.slice(-4)}`;
const isNum = value => typeof value === 'number' && Number.isFinite(value);

export function timeAgo(ms, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function amountLabel(value) {
  if (!isNum(value)) return '—';
  return new Intl.NumberFormat('en-US', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: value >= 1 ? 2 : 6 }).format(value);
}

/** Socials and quick links, shown in the header like Jupiter's token page. */
export function TokenLinks({ token, mint }) {
  const profile = token.profile || {};
  const links = [
    profile.twitter && { href: profile.twitter, label: 'X (Twitter)', icon: XIcon },
    profile.telegram && { href: profile.telegram, label: 'Telegram', icon: Send },
    profile.website && { href: profile.website, label: 'Website', icon: Globe },
  ].filter(Boolean);
  return <div className="flex flex-wrap items-center gap-1.5">
    {links.map(({ href, label, icon: Icon }) => <a key={label} href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={label} title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-primary"><Icon className="h-3.5 w-3.5"/></a>)}
    <a href={`https://solscan.io/token/${mint}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background/60 px-2.5 text-[11px] text-muted-foreground hover:text-primary">Solscan<ArrowUpRight className="h-3 w-3"/></a>
    <a href={`https://jup.ag/tokens/${mint}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background/60 px-2.5 text-[11px] text-muted-foreground hover:text-primary">Jupiter<ArrowUpRight className="h-3 w-3"/></a>
  </div>;
}

/** Headline numbers under the header: market cap, liquidity, holders, volume, FDV, organic score. */
export function TokenStatStrip({ token }) {
  const day = token.stats?.['24h'] || {}, profile = token.profile || {};
  const cells = [
    ['Market cap', formatCompact(token.marketCap)],
    ['Liquidity', formatCompact(token.liquidity), day.liquidityChange],
    ['Holders', formatCompact(token.holders, false)],
    ['24h volume', formatCompact(day.volume), day.volumeChange],
    ['FDV', formatCompact(token.fdv)],
    ['Organic score', isNum(profile.organicScore) ? profile.organicScore.toFixed(1) : '—'],
  ];
  return <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
    {cells.map(([label, value, change]) => <div key={label} className="bg-card px-4 py-3">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-2 font-mono text-sm font-medium">{value}{isNum(change) && <PriceChange value={change} className="text-[11px]"/>}</dd>
    </div>)}
  </dl>;
}

/** Per-window flow: price change, volume, buys vs sells, traders and net buyers. */
export function TokenFlowPanel({ token }) {
  const [win, setWin] = useState('24h');
  const stats = token.stats?.[win] || {};
  const buyShare = isNum(stats.buyVolume) && isNum(stats.sellVolume) && stats.buyVolume + stats.sellVolume > 0 ? stats.buyVolume / (stats.buyVolume + stats.sellVolume) * 100 : null;
  return <section aria-label="Trading activity" className="rounded-2xl border border-border bg-card/70 p-4">
    <div role="tablist" aria-label="Time window" className="grid grid-cols-4 gap-1 rounded-lg bg-background/70 p-1">
      {MARKET_INTERVALS.map(key => <button key={key} type="button" role="tab" aria-selected={win === key} onClick={() => setWin(key)}
        className={`rounded-md py-1.5 text-center ${win === key ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
        <span className="block text-[11px]">{key}</span><PriceChange value={token.stats?.[key]?.priceChange} className="block text-[11px]"/>
      </button>)}
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
      <div><dt className="text-muted-foreground">Volume</dt><dd className="mt-0.5 font-mono">{formatCompact(stats.volume)}</dd></div>
      <div><dt className="text-muted-foreground">Traders</dt><dd className="mt-0.5 font-mono">{formatCompact(stats.traders, false)}</dd></div>
      <div><dt className="text-muted-foreground">Buys</dt><dd className="mt-0.5 font-mono text-emerald-400">{formatCompact(stats.buys, false)} · {formatCompact(stats.buyVolume)}</dd></div>
      <div><dt className="text-muted-foreground">Sells</dt><dd className="mt-0.5 font-mono text-rose-400">{formatCompact(stats.sells, false)} · {formatCompact(stats.sellVolume)}</dd></div>
    </dl>
    {buyShare != null && <div className="mt-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-rose-500/70" role="img" aria-label={`${buyShare.toFixed(0)}% of volume was buys`}><div className="bg-emerald-500" style={{ width: `${buyShare}%` }}/></div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{buyShare.toFixed(0)}% buy</span><span>{(100 - buyShare).toFixed(0)}% sell</span></div>
    </div>}
    {isNum(stats.netBuyers) && <p className="mt-3 text-xs text-muted-foreground">Net buyers <span className={`font-mono ${stats.netBuyers >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{stats.netBuyers >= 0 ? '+' : '−'}{formatCompact(Math.abs(stats.netBuyers), false)}</span></p>}
  </section>;
}

function AuditRow({ label, ok, value }) {
  const Icon = ok == null ? null : ok ? ShieldCheck : ShieldAlert;
  return <div className="flex items-center justify-between gap-3 py-2 text-xs">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className={`flex items-center gap-1.5 font-mono ${ok == null ? 'text-muted-foreground' : ok ? 'text-emerald-400' : 'text-amber-300'}`}>{Icon && <Icon className="h-3.5 w-3.5"/>}{value}</dd>
  </div>;
}

/** Safety checks and token facts. Jupiter's audit fields; missing values show as —. */
export function TokenInfoPanel({ token, mint }) {
  const profile = token.profile || {}, audit = profile.audit || {};
  const yesNo = (disabled) => disabled == null ? '—' : disabled ? 'Disabled' : 'Enabled';
  const pct = value => isNum(value) ? `${value.toFixed(2)}%` : '—';
  const created = profile.createdAt ? new Date(profile.createdAt) : null;
  return <section aria-label="Token info" className="rounded-2xl border border-border bg-card/70 p-4">
    <h2 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Token info</h2>
    <dl className="divide-y divide-border">
      <AuditRow label="Mint authority" ok={audit.mintAuthorityDisabled} value={yesNo(audit.mintAuthorityDisabled)}/>
      <AuditRow label="Freeze authority" ok={audit.freezeAuthorityDisabled} value={yesNo(audit.freezeAuthorityDisabled)}/>
      <AuditRow label="Top 10 holders" ok={isNum(audit.topHoldersPercentage) ? audit.topHoldersPercentage < 30 : null} value={pct(audit.topHoldersPercentage)}/>
      <AuditRow label="Dev holds" ok={isNum(audit.devBalancePercentage) ? audit.devBalancePercentage < 5 : null} value={pct(audit.devBalancePercentage)}/>
      <AuditRow label="Circulating supply" value={amountLabel(profile.circSupply)}/>
      <AuditRow label="Launchpad" value={profile.launchpad || '—'}/>
      <AuditRow label="Created" value={created ? created.toLocaleDateString() : '—'}/>
      {token.verified && <AuditRow label="Jupiter" ok value={<><Check className="h-3 w-3"/>Verified</>}/>}
    </dl>
    <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{mint}</p>
  </section>;
}

/** Live trade tape for the token's busiest pool. */
export function RecentTrades({ mint, symbol }) {
  const trades = useRecentTrades(mint), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const rows = trades.data?.trades || [];
  if (trades.isPending) return <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading trades…</p>;
  if (trades.error && !rows.length) return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{trades.error.message || 'Recent trades are unavailable.'}</p>;
  if (!rows.length) return <p className="px-4 py-10 text-center text-sm text-muted-foreground">No trades in the last 24 hours.</p>;
  return <div className="max-h-[460px] overflow-auto">
    <table className="w-full min-w-[560px] text-xs">
      <thead className="sticky top-0 bg-card text-[11px] text-muted-foreground"><tr className="border-b border-border">
        <th className="px-4 py-2 text-left font-normal">Age</th><th className="px-2 py-2 text-left font-normal">Type</th>
        <th className="px-2 py-2 text-right font-normal">Price</th><th className="px-2 py-2 text-right font-normal">{symbol}</th>
        <th className="px-2 py-2 text-right font-normal">Value</th><th className="px-4 py-2 text-right font-normal">Trader</th>
      </tr></thead>
      <tbody>{rows.map((trade, index) => <tr key={`${trade.signature}:${index}`} className="border-b border-border/60 font-mono hover:bg-white/[0.02]">
        <td className="px-4 py-2 text-muted-foreground"><a href={`https://solscan.io/tx/${trade.signature}`} target="_blank" rel="noopener noreferrer" className="hover:text-primary">{timeAgo(trade.time, now)}</a></td>
        <td className={`px-2 py-2 font-sans font-medium capitalize ${trade.kind === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.kind}</td>
        <td className="px-2 py-2 text-right">{formatPrice(trade.price)}</td>
        <td className="px-2 py-2 text-right">{amountLabel(trade.amount)}</td>
        <td className={`px-2 py-2 text-right ${trade.kind === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCompact(trade.usd)}</td>
        <td className="px-4 py-2 text-right text-muted-foreground">{trade.trader ? <a href={`https://solscan.io/account/${trade.trader}`} target="_blank" rel="noopener noreferrer" className="hover:text-primary">{short(trade.trader)}</a> : '—'}</td>
      </tr>)}</tbody>
    </table>
    <p className="px-4 py-2 text-[10px] text-muted-foreground">{trades.data?.pool?.name} · trades via GeckoTerminal · refreshes every 15s</p>
  </div>;
}
