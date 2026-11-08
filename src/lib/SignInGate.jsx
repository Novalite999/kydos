import React, { createContext, useCallback, useContext, useState } from "react";
import { useSolanaWallet } from '@/lib/SolanaWalletContext';
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Wallet } from 'lucide-react';
import { LOGO_URL } from "@/lib/brand";
import { useMe } from "@/lib/MeContext";
import { useAuth } from "@/lib/AuthContext";

/** @type {React.Context<{ requireAuth: (label?: string) => boolean }>} */
const GateContext = createContext({ requireAuth: () => true });

// Wraps guest actions: returns true when signed in, otherwise opens the prompt.
export function SignInGateProvider({ children }) {
  const { me } = useMe();
  const wallet = useSolanaWallet();
  const auth = useAuth();
  const [action, setAction] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setError(''); setBusy(true);
    try { await auth.signIn(); setAction(null); } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  };

  const requireAuth = useCallback(
    (label) => {
      if (me?.signedIn) return true;
      setError('');
      setAction(label || "continue");
      return false;
    },
    [me]
  );

  return (
    <GateContext.Provider value={{ requireAuth }}>
      {children}
      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="bg-card sm:max-w-sm text-center">
          <img src={LOGO_URL} alt="Kydos" className="h-14 w-14 rounded-full mx-auto ring-1 ring-primary/40" />
          <h2 className="font-display font-bold text-xl mt-2">Sign in with Phantom to {action}</h2>
          <p className="text-sm text-muted-foreground">Your Solana wallet is your Kydos identity. Phantom will ask you to sign a message — it's free and sends no transaction.</p>
          <div className="space-y-2 mt-2">
            <Button onClick={connect} disabled={busy} className="w-full h-11 rounded-full font-semibold">
              <Wallet className="h-4 w-4 mr-2" /> {busy ? 'Check Phantom…' : wallet.connected ? 'Sign in with Phantom' : 'Connect Phantom & sign in'}
            </Button>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button variant="ghost" onClick={() => setAction(null)} className="w-full h-10 rounded-full text-muted-foreground">
              Maybe later
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </GateContext.Provider>
  );
}

export const useSignInGate = () => useContext(GateContext);