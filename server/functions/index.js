import adminLaunchToken from './adminLaunchToken.js';
import indexSolanaTransactions from './indexSolanaTransactions.js';
import jupiterTrade from './jupiterTrade.js';
import launchMetadata from './launchMetadata.js';
import listGithubPullRequests from './listGithubPullRequests.js';
import listGithubReleases from './listGithubReleases.js';
import marketCandles from './marketCandles.js';
import marketDiscovery from './marketDiscovery.js';
import pollJupiterPrices from './pollJupiterPrices.js';
import solanaBoard from './solanaBoard.js';
import solanaRpc from './solanaRpc.js';
import solanaTokenChart from './solanaTokenChart.js';

// The Astra AI assistant was tied to Base44's AI integrations and is not part of
// this deployment yet; its admin screens show this message instead of failing.
const astraUnavailable = async () => Response.json({ error: 'The Astra assistant is not enabled on this deployment yet.' }, { status: 503 });

export const FUNCTIONS = {
  adminLaunchToken, indexSolanaTransactions, jupiterTrade, launchMetadata, listGithubPullRequests, listGithubReleases,
  marketCandles, marketDiscovery, pollJupiterPrices, solanaBoard, solanaRpc, solanaTokenChart,
  astraChat: astraUnavailable, astraDetail: astraUnavailable, astraReference: astraUnavailable, ingestReference: astraUnavailable,
  exportAstraTrainingData: astraUnavailable,
};
