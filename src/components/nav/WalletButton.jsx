import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, LogOut, UserRound, Wallet } from 'lucide-react';
import { useSolanaWallet } from '@/lib/SolanaWalletContext';
import { useAuth } from '@/lib/AuthContext';

const short = key => `${key.slice(0, 4)}…${key.slice(-4)}`;

// One wallet control for every page: connect, sign in, copy address, disconnect.
export default function WalletButton({ compact = false }) {
  const wallet = useSolanaWallet(), auth = useAuth();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const ref = useRef(null);
  const address = wallet.publicKey?.toBase58();

  useEffect(() => {
    if (!open) return;
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => { if (!error) return; const t = setTimeout(() => setError(''), 6000); return () => clearTimeout(t); }, [error]);

  const run = async task => {
    setBusy(true); setError('');
    try { await task(); } catch (reason) { setError(reason.message || 'Wallet request failed.'); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const disconnect = () => run(async () => { setOpen(false); if (auth.sessionWallet) await auth.logout(); await wallet.disconnect(); });

  const base = 'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-70';
  return <div ref={ref} className="relative">
    {!wallet.connected
      ? <button type="button" disabled={busy || wallet.connecting} onClick={() => run(() => wallet.connect())} className={`${base} border-primary/40 bg-primary/10 text-primary hover:bg-primary/20`}>
          <Wallet className="h-3.5 w-3.5"/>{busy || wallet.connecting ? 'Connecting…' : compact ? 'Connect' : 'Connect Phantom'}
        </button>
      : <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={`${base} border-border bg-card hover:border-primary/40`}>
          <span className={`h-2 w-2 rounded-full ${auth.isAuthenticated ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden/>
          {short(address)}
        </button>}
    {open && wallet.connected && <div role="menu" className="absolute right-0 top-11 z-50 w-60 rounded-xl border border-border bg-card p-2 text-sm shadow-xl">
      <p className="px-2 pb-2 pt-1 text-xs text-muted-foreground">{auth.isAuthenticated ? 'Signed in with Phantom' : 'Connected — not signed in yet'}</p>
      {!auth.isAuthenticated && <button type="button" disabled={busy} onClick={() => run(async () => { await auth.signIn(); setOpen(false); })} className="flex w-full items-center gap-2 rounded-lg bg-primary px-2 py-2 font-semibold text-primary-foreground disabled:opacity-70">
        <Wallet className="h-4 w-4"/>{busy ? 'Check Phantom…' : 'Sign in (free signature)'}
      </button>}
      <button type="button" onClick={copy} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted">{copied ? <Check className="h-4 w-4 text-emerald-400"/> : <Copy className="h-4 w-4"/>}{copied ? 'Copied' : 'Copy address'}</button>
      <Link to="/profile" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"><UserRound className="h-4 w-4"/>Profile</Link>
      <button type="button" onClick={disconnect} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-destructive hover:bg-muted"><LogOut className="h-4 w-4"/>Disconnect</button>
    </div>}
    {error && <p role="alert" className="absolute right-0 top-11 z-50 w-64 rounded-lg border border-destructive/40 bg-card p-2 text-xs text-destructive shadow-lg">{error}</p>}
  </div>;
}
