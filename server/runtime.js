// Server secrets come from Vercel environment variables.
// Without a Helius key the app falls back to Solana's public mainnet RPC, which
// works for light use but is rate limited and lacks Helius-only methods.
const FALLBACKS = { HELIUS_RPC_URL: 'https://api.mainnet-beta.solana.com' };

export const secrets = {
  get(name) {
    const value = process.env[name];
    return value && value.trim() ? value.trim() : FALLBACKS[name];
  },
};
