import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

// Latest swaps in the token's busiest pool, refreshed every 15 seconds while visible.
export default function useRecentTrades(mint) {
  return useQuery({
    queryKey: ['recent-trades', 'solana-mainnet', mint],
    enabled: !!mint,
    queryFn: async () => (await api.functions.invoke('marketTrades', { mint })).data,
    staleTime: 10_000, refetchInterval: 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: false,
    retry: 1,
  });
}
