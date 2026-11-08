import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { ensureProfile } from "@/lib/profile";
import { useSolanaWallet } from '@/lib/SolanaWalletContext';
import { useAuth } from '@/lib/AuthContext';

/** @typedef {{ id: string; signedIn: boolean; profile: Awaited<ReturnType<typeof ensureProfile>> }} WalletIdentity */
/** @type {React.Context<{ me: WalletIdentity | null | undefined; likedIds: Set<string>;
 * refresh: () => Promise<void>; toggleLike: (post: { id: string; like_count?: number }) => Promise<void> }>} */
const Ctx = createContext({ me: undefined, likedIds: new Set(), refresh: async () => {}, toggleLike: async () => {} });

export function MeProvider({ children }) {
  const wallet = useSolanaWallet();
  const walletId = wallet.publicKey?.toBase58();
  const { isAuthenticated } = useAuth();
  const [me, setMe] = useState(/** @type {WalletIdentity | null | undefined} */ (undefined));
  const [likedIds, setLikedIds] = useState(new Set());

  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++latest.current;
    if (!walletId) { setMe(null); return; }
    const identity = { id: walletId };
    // Profiles are created once the wallet has signed in; before that, show a preview.
    const profile = await ensureProfile(identity, { create: isAuthenticated });
    // Ignore a slower, older lookup that finishes after a newer one.
    if (run === latest.current) setMe({ ...identity, signedIn: isAuthenticated, profile });
  }, [walletId, isAuthenticated]);

  useEffect(() => { setMe(undefined); refresh().catch(() => setMe(null)); }, [refresh]);
  useEffect(() => {
    if (!me?.id) { setLikedIds(new Set()); return; }
    const load = () =>
      base44.entities.PostLike.filter({ user_id: me.id }, "-created_date", 500)
        .then((l) => setLikedIds(new Set(l.map((x) => x.post_id))));
    load();
    return base44.entities.PostLike.subscribe(load);
  }, [me?.id]);

  const toggleLike = useCallback(async (post) => {
    if (!me?.signedIn) return;
    const liked = likedIds.has(post.id);
    setLikedIds((prev) => { const n = new Set(prev); liked ? n.delete(post.id) : n.add(post.id); return n; });
    if (liked) {
      const [rec] = await base44.entities.PostLike.filter({ user_id: me.id, post_id: post.id });
      if (rec) await base44.entities.PostLike.delete(rec.id);
      await base44.entities.Post.update(post.id, { like_count: Math.max(0, (post.like_count || 0) - 1) });
    } else {
      await base44.entities.PostLike.create({ user_id: me.id, post_id: post.id });
      await base44.entities.Post.update(post.id, { like_count: (post.like_count || 0) + 1 });
    }
  }, [me, likedIds]);

  return <Ctx.Provider value={{ me, likedIds, refresh, toggleLike }}>{children}</Ctx.Provider>;
}

export const useMe = () => useContext(Ctx);