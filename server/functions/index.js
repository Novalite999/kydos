// Each handler is loaded on first use, so a heavy dependency (e.g. Solana web3)
// never slows down or breaks the auth and database routes.
// The Astra AI assistant was tied to Base44's AI integrations and is not part of
// this deployment yet; its admin screens show this message instead of failing.
const astraUnavailable = async () => ({ default: async () => Response.json({ error: 'The Astra assistant is not enabled on this deployment yet.' }, { status: 503 }) });

export const FUNCTIONS = {
  adminLaunchToken: () => import('./adminLaunchToken.js'),
  indexSolanaTransactions: () => import('./indexSolanaTransactions.js'),
  jupiterTrade: () => import('./jupiterTrade.js'),
  launchMetadata: () => import('./launchMetadata.js'),
  listGithubPullRequests: () => import('./listGithubPullRequests.js'),
  listGithubReleases: () => import('./listGithubReleases.js'),
  marketCandles: () => import('./marketCandles.js'),
  marketDiscovery: () => import('./marketDiscovery.js'),
  pollJupiterPrices: () => import('./pollJupiterPrices.js'),
  solanaBoard: () => import('./solanaBoard.js'),
  solanaRpc: () => import('./solanaRpc.js'),
  solanaTokenChart: () => import('./solanaTokenChart.js'),
  astraChat: astraUnavailable, astraDetail: astraUnavailable, astraReference: astraUnavailable,
  ingestReference: astraUnavailable, exportAstraTrainingData: astraUnavailable,
};
