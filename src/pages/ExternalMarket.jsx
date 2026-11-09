import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, TriangleAlert } from 'lucide-react';
import useMarketDiscovery from '@/hooks/useMarketDiscovery';
import useMarketWatchlist from '@/hooks/useMarketWatchlist';
import { emptyToken, formatPrice, identityFor, isSolanaMint, shortMint } from '@/lib/markets';
import { MarketAvatar, MarketDataNotice, MintCopy, PriceChange, SnapshotStamp, WatchButton } from '@/components/markets/MarketPrimitives';
import ExternalMarketChart from '@/components/markets/ExternalMarketChart';
import ExternalTradePanel from '@/components/markets/ExternalTradePanel';
import { RecentTrades, TokenFlowPanel, TokenInfoPanel, TokenLinks, TokenStatStrip, timeAgo } from '@/components/markets/TokenPanels';

// Token terminal, laid out like jup.ag/tokens/<mint>: identity and headline stats on top,
// chart and live trades on the left, swap and token facts on the right.
export default function ExternalMarket() {
  const { mint } = useParams(), market = useMarketDiscovery({ mint: isSolanaMint(mint) ? mint : null }), watchlist = useMarketWatchlist();
  const [tab, setTab] = useState('trades');
  if (!isSolanaMint(mint)) return <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6"><Link to="/" className="text-sm text-primary">Back to Discover</Link><h1 className="mt-6 text-2xl font-semibold">Invalid Solana mint</h1><p className="mt-3 text-sm text-muted-foreground">Open a coin from Discover to view its market.</p></div>;
  const identity = identityFor(mint), saved = watchlist.saved.find(token => token.mint === mint);
  const token = market.snapshot.tokens.find(item => item.mint === mint) || emptyToken(identity || saved || { mint, name: 'Solana token', symbol: shortMint(mint) });
  const profile = token.profile || {};
  const supply = profile.circSupply || (token.marketCap && token.price ? token.marketCap / token.price : null);
  const created = profile.createdAt ? Date.parse(profile.createdAt) : null;

  return <div className="mx-auto max-w-[1400px] px-3 pt-4 sm:px-6 sm:pt-6">
    <Link to="/" className="mb-4 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4"/>Back to Discover</Link>
    <MarketDataNotice market={market}/>

    <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <MarketAvatar token={token} large/>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="truncate font-display text-xl font-semibold sm:text-2xl">{token.name}</h1>
            <span className="text-sm text-muted-foreground">{token.symbol}</span>
            {token.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-400" aria-label="Verified by Jupiter"/>}
            {profile.launchpad && <span className="rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">{profile.launchpad}</span>}
            {token.suspicious && <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"><TriangleAlert className="h-3 w-3"/>Flagged</span>}
            <WatchButton token={token} watchlist={watchlist}/>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <MintCopy mint={mint}/>
            {created && <span>{timeAgo(created)} old</span>}
            <SnapshotStamp market={market}/>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-2xl font-semibold tracking-tight sm:text-3xl">{formatPrice(token.price)}</p>
          <PriceChange value={token.stats?.['24h']?.priceChange} className="text-sm"/>
        </div>
        <TokenLinks token={token} mint={mint}/>
      </div>
    </header>
    {watchlist.error && <p role="status" className="mb-4 text-xs text-amber-200">{watchlist.error}</p>}

    <TokenStatStrip token={token}/>
    {!token.available && <p role="status" className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">Jupiter statistics are not available for this coin yet. The chart and trades load separately.</p>}

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <ExternalMarketChart key={mint} mint={mint} symbol={token.symbol} livePrice={token.price} supply={supply}/>
        <section aria-label="Market activity" className="overflow-hidden rounded-2xl border border-border bg-card/70">
          <div role="tablist" className="flex gap-1 border-b border-border px-3 pt-2">
            {[['trades', 'Trades'], ['info', 'About']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
          </div>
          {tab === 'trades' ? <RecentTrades mint={mint} symbol={token.symbol}/> : <div className="space-y-3 p-4 text-sm text-muted-foreground">
            <p>{identity?.kind === 'wrapped' ? `${identity.wrapper}. This is the Solana representation of the asset.` : identity?.kind === 'native' ? 'SOL market data uses the wrapped SOL mint. Native SOL in a wallet and SPL wrapped SOL are separate balances.' : 'This token is identified by its Solana mint address. Names and symbols can be shared by unrelated coins, so always check the mint.'}</p>
            {profile.tags?.length > 0 && <p className="flex flex-wrap gap-1.5">{profile.tags.map(tag => <span key={tag} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px]">{tag}</span>)}</p>}
            <p className="text-[11px]">Market data from Jupiter Tokens V2 and Price V3; candles and trades from GeckoTerminal. Missing values show as —.</p>
          </div>}
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20">
        <ExternalTradePanel key={`trade:${mint}`} mint={mint} symbol={token.symbol}/>
        <TokenFlowPanel token={token}/>
        <TokenInfoPanel token={token} mint={mint}/>
      </aside>
    </div>
  </div>;
}
