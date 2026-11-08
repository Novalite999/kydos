// Website sign-in = a signed message from the connected Solana wallet.
// The session cookie is only trusted while that same wallet stays connected.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useSolanaWallet } from '@/lib/SolanaWalletContext';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const wallet = useSolanaWallet();
  const walletId = wallet.publicKey?.toBase58() || null;
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [authError, setAuthError] = useState(null);

  const checkUserAuth = useCallback(async () => {
    try { setSession(await api.auth.me()); } catch { setSession(null); }
  }, []);

  useEffect(() => { checkUserAuth(); return api.auth.onChange(user => setSession(user)); }, [checkUserAuth]);

  // A session for a different wallet than the one connected is not used.
  const user = session && walletId && session.id === walletId ? session : null;
  const isLoadingAuth = session === undefined;

  const signIn = useCallback(async () => {
    setAuthError(null);
    try {
      const key = wallet.publicKey || await wallet.connect();
      const id = key.toBase58();
      if (session?.id === id) return session;
      return await api.auth.signInWithWallet(id, wallet.signMessage);
    } catch (error) {
      setAuthError({ type: 'sign_in_failed', message: error.message });
      throw error;
    }
  }, [wallet, session]);

  const logout = useCallback(async (shouldRedirect = false) => {
    await api.auth.logout(shouldRedirect ? '/' : undefined);
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      sessionWallet: session?.id || null,
      isAuthenticated: !!user,
      isAdmin: user?.role === 'admin',
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authChecked: !isLoadingAuth,
      authError,
      appPublicSettings: { id: 'kydos', public_settings: {} },
      signIn,
      logout,
      navigateToLogin: () => api.auth.redirectToLogin(window.location.href),
      checkUserAuth,
      checkAppState: checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
