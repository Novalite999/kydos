import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import AuthLayout from "@/components/AuthLayout";
import { useAuth } from "@/lib/AuthContext";
import { useSolanaWallet } from "@/lib/SolanaWalletContext";
import { safeReturnTo } from "@/lib/authReturnTo";

export default function Login() {
  const returnTo = safeReturnTo();
  const navigate = useNavigate();
  const auth = useAuth(), wallet = useSolanaWallet();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");

  const signIn = async () => {
    setBusy(true); setError("");
    try { await auth.signIn(); navigate(returnTo, { replace: true }); }
    catch (reason) { setError(reason.message || "Sign-in failed."); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout
      icon={Wallet}
      title="Sign in to Kydos"
      subtitle="Your Phantom wallet is your account. Signing in asks for a free message signature — no transaction, no SOL."
      footer={<Link to="/" className="text-primary font-medium hover:underline">Back to markets</Link>}
    >
      {auth.isAuthenticated ? (
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">Signed in as <span className="font-mono text-foreground">{auth.user.id.slice(0, 4)}…{auth.user.id.slice(-4)}</span>{auth.isAdmin ? " (admin)" : ""}.</p>
          <Button className="w-full h-12" onClick={() => navigate(returnTo, { replace: true })}>Continue</Button>
        </div>
      ) : (
        <Button className="w-full h-12 text-sm font-semibold" onClick={signIn} disabled={busy}>
          {busy ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Wallet className="w-5 h-5 mr-2" />}
          {busy ? "Check Phantom…" : wallet.connected ? "Sign in with Phantom" : "Connect Phantom & sign in"}
        </Button>
      )}
      {error && <p role="alert" className="mt-4 text-center text-sm text-destructive">{error}</p>}
      {!wallet.installed && <p className="mt-4 text-center text-xs text-muted-foreground">No Phantom detected. On desktop, install the <a className="underline" href="https://phantom.app/download" target="_blank" rel="noreferrer">Phantom extension</a>; on a phone the button opens this page in the Phantom app.</p>}
    </AuthLayout>
  );
}
