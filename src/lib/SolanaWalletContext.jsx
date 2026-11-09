import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPhantomSigner } from './solana/phantom.js';
import phantomVersioned from '@/lib/solana/phantomVersioned';
const Context = createContext(null);

// Prefer Phantom's own namespace: other wallets (e.g. Brave Wallet) also set
// window.solana.isPhantom for compatibility but are not Phantom.
const findPhantom = () => {
  if (typeof window === 'undefined') return null;
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  const injected = window.solana;
  return injected?.isPhantom && !injected.isBraveWallet ? injected : null;
};
const braveWalletOnly = () => typeof window !== 'undefined' && !!window.solana?.isBraveWallet && !window.phantom?.solana;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Phantom rejects a request while another one is still open and sometimes returns a
// generic "Unexpected error" (-32603) on the first try; queue requests and retry once.
function walletError(error, action) {
  const code = error?.code;
  if (code === 4001) return new Error(`${action} request was rejected in Phantom.`);
  if (code === 4100) return new Error('Phantom is locked or has not approved this site. Unlock Phantom and try again.');
  if (code === -32002) return new Error('A Phantom request is already open. Check the Phantom window.');
  const detail = error?.message && error.message !== 'Unexpected error' ? error.message : 'Phantom returned an unexpected error';
  return new Error(`${detail}${code ? ` (code ${code})` : ''}. Unlock Phantom and try again. If it keeps happening, open Phantom → Settings → Connected apps, remove this site, then reconnect.`);
}
const retryable = error => error?.code === -32603 || /unexpected error/i.test(error?.message || '');
const isMobile = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// On phones without the extension, open this page inside Phantom's in-app browser.
export function phantomBrowseUrl(href = window.location.href) {
  return `https://phantom.app/ul/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(window.location.origin)}`;
}

export function SolanaWalletProvider({ children }) {
  const [phantom, setPhantom] = useState(findPhantom);
  const [publicKey, setPublicKey] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const pending = useRef(Promise.resolve());
  // Runs wallet requests one at a time.
  const queue = useCallback(task => {
    const run = pending.current.catch(() => {}).then(task);
    pending.current = run.catch(() => {});
    return run;
  }, []);

  // Phantom can inject after the first render (slow devices, in-app browsers).
  useEffect(() => {
    if (phantom) return;
    const check = () => { const found = findPhantom(); if (found) setPhantom(found); };
    const timers = [100, 500, 1500, 3000].map(ms => setTimeout(check, ms));
    window.addEventListener('load', check);
    return () => { timers.forEach(clearTimeout); window.removeEventListener('load', check); };
  }, [phantom]);

  useEffect(() => {
    if (!phantom) return;
    const connected = key => setPublicKey(key || phantom.publicKey || null);
    const changed = key => {
      if (key) setPublicKey(key);
      // Phantom reports null when the user switches to an account this site is not
      // connected to; ask it to reconnect silently, otherwise treat as disconnected.
      else queue(() => phantom.connect({ onlyIfTrusted: true })).then(r => setPublicKey(r.publicKey)).catch(() => setPublicKey(null));
    };
    const disconnected = () => setPublicKey(null);
    phantom.on?.('connect', connected);
    phantom.on?.('accountChanged', changed);
    phantom.on?.('disconnect', disconnected);
    if (phantom.isConnected && phantom.publicKey) setPublicKey(phantom.publicKey);
    // Reconnect returning users without a popup when the site is already trusted.
    else queue(() => phantom.connect({ onlyIfTrusted: true })).then(r => setPublicKey(r.publicKey)).catch(() => {});
    return () => {
      phantom.removeListener?.('connect', connected);
      phantom.removeListener?.('accountChanged', changed);
      phantom.removeListener?.('disconnect', disconnected);
    };
  }, [phantom, queue]);

  const connect = useCallback(async () => {
    const provider = phantom || findPhantom();
    if (!provider) {
      if (isMobile()) { window.location.href = phantomBrowseUrl(); throw new Error('Opening Phantom…'); }
      if (braveWalletOnly()) throw new Error('Only Brave Wallet was found. Install the Phantom extension, or set Brave → Settings → Web3 → Default Solana wallet to "Extensions (no fallback)".');
      window.open('https://phantom.app/download', '_blank', 'noopener');
      throw new Error('Phantom wallet was not found. Install the Phantom browser extension, then reload this page.');
    }
    if (!phantom) setPhantom(provider);
    setConnecting(true);
    try {
      const result = await queue(async () => {
        try { return await provider.connect(); }
        catch (error) {
          if (!retryable(error)) throw error;
          await wait(500);
          return provider.connect();
        }
      });
      const key = result?.publicKey || provider.publicKey;
      if (!key) throw new Error('Phantom did not return a wallet address.');
      setPublicKey(key);
      return key;
    } catch (error) {
      console.error('Phantom connect failed', error);
      throw walletError(error, 'Connection');
    } finally { setConnecting(false); }
  }, [phantom, queue]);

  const disconnect = useCallback(async () => {
    try { await queue(() => phantom?.disconnect()); } finally { setPublicKey(null); }
  }, [phantom, queue]);

  const signMessage = useCallback(async message => {
    if (!phantom || !publicKey) throw new Error('Connect Phantom first.');
    try {
      return await queue(async () => {
        try { return await phantom.signMessage(message, 'utf8'); }
        catch (error) {
          if (!retryable(error)) throw error;
          await wait(500);
          return phantom.signMessage(message, 'utf8');
        }
      });
    } catch (error) {
      console.error('Phantom signMessage failed', error);
      throw walletError(error, 'Signature');
    }
  }, [phantom, publicKey, queue]);

  const value = useMemo(() => ({
    installed: !!phantom, connected: !!publicKey, connecting, publicKey, connect, disconnect, signMessage,
    ...createPhantomSigner(phantom, publicKey),
    signVersionedTransaction: phantomVersioned(phantom, publicKey),
  }), [phantom, publicKey, connecting, connect, disconnect, signMessage]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSolanaWallet() {
  const value = useContext(Context);
  if (!value) throw new Error('SolanaWalletProvider is missing');
  return value;
}
