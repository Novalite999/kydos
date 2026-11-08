import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPhantomSigner } from './solana/phantom.js';
import phantomVersioned from '@/lib/solana/phantomVersioned';
const Context = createContext(null);

const findPhantom = () => {
  if (typeof window === 'undefined') return null;
  const injected = window.phantom?.solana ?? window.solana;
  return injected?.isPhantom ? injected : null;
};
const isMobile = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// On phones without the extension, open this page inside Phantom's in-app browser.
export function phantomBrowseUrl(href = window.location.href) {
  return `https://phantom.app/ul/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(window.location.origin)}`;
}

export function SolanaWalletProvider({ children }) {
  const [phantom, setPhantom] = useState(findPhantom);
  const [publicKey, setPublicKey] = useState(null);
  const [connecting, setConnecting] = useState(false);

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
      else phantom.connect({ onlyIfTrusted: true }).then(r => setPublicKey(r.publicKey)).catch(() => setPublicKey(null));
    };
    const disconnected = () => setPublicKey(null);
    phantom.on?.('connect', connected);
    phantom.on?.('accountChanged', changed);
    phantom.on?.('disconnect', disconnected);
    if (phantom.isConnected && phantom.publicKey) setPublicKey(phantom.publicKey);
    // Reconnect returning users without a popup when the site is already trusted.
    else phantom.connect({ onlyIfTrusted: true }).then(r => setPublicKey(r.publicKey)).catch(() => {});
    return () => {
      phantom.removeListener?.('connect', connected);
      phantom.removeListener?.('accountChanged', changed);
      phantom.removeListener?.('disconnect', disconnected);
    };
  }, [phantom]);

  const connect = useCallback(async () => {
    const provider = phantom || findPhantom();
    if (!provider) {
      if (isMobile()) { window.location.href = phantomBrowseUrl(); throw new Error('Opening Phantom…'); }
      window.open('https://phantom.app/download', '_blank', 'noopener');
      throw new Error('Phantom wallet was not found. Install the Phantom browser extension, then reload this page.');
    }
    if (!phantom) setPhantom(provider);
    setConnecting(true);
    try {
      const result = await provider.connect();
      setPublicKey(result.publicKey);
      return result.publicKey;
    } catch (error) {
      if (error?.code === 4001) throw new Error('Connection request was rejected in Phantom.');
      throw new Error(error?.message || 'Could not connect to Phantom.');
    } finally { setConnecting(false); }
  }, [phantom]);

  const disconnect = useCallback(async () => {
    try { await phantom?.disconnect(); } finally { setPublicKey(null); }
  }, [phantom]);

  const signMessage = useCallback(async message => {
    if (!phantom || !publicKey) throw new Error('Connect Phantom first.');
    try { return await phantom.signMessage(message, 'utf8'); }
    catch (error) {
      if (error?.code === 4001) throw new Error('Signature request was rejected in Phantom.');
      throw error;
    }
  }, [phantom, publicKey]);

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
