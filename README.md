# Kydos

**Kydos is a mobile-first, Solana-native social memecoin launchpad.**

Launch with Phantom, trade a constant-product bonding curve, follow market activity, and discuss tokens in one application.

## Current direction

Kydos targets Solana exclusively. The active implementation uses Anchor programs, Solana Web3, SPL Token, Phantom wallet interaction, and Helius-backed RPC/indexing services. The previous EVM implementation is retained under `archive/` for historical reference and is not part of the active product.

## Core product

- Atomic DBC token creation and original-creator registration (DBC initial-buy UI remains planned)
- Image upload and automatic IPFS metadata through a server-configured Pinata integration
- Phantom-only signing for launch and trading flows
- Constant-product bonding curve with explicit slippage limits
- One-billion-token launch supply: 793.1M nominal DBC curve allocation and 206.9M gross migration allocation; see [DBC accounting](docs/dbc-transition.md). Legacy curves remain a separate path.
- Persistent transaction recovery and confirmed-state refreshes
- Helius transaction parsing and history ingestion
- Social posts, replies, likes, follows, profiles, and token discussion
- Astra-assisted repository operations with durable checkpoints

## Architecture

`Phantom -> React/Vite client -> Meteora DBC / Kydos instructions -> Solana`

`Browser -> /api (one Vercel Function, server/) -> Neon Postgres + Helius + Jupiter + Pinata`

Base44 has been removed. The app now runs on Vercel and Neon:

- `api/router.js` is the single Vercel Function; `server/router.js` serves every `/api/*` route.
- `server/entities.js` stores app records (posts, likes, follows, profiles, trades, candles) in one Postgres JSONB table, created automatically on first request.
- `server/auth.js` signs users in with their wallet: Phantom signs a free text message and the server sets a 30-day session cookie. Admins are the wallets listed in `ADMIN_WALLETS`.
- `server/functions/` holds the market, chart, trading, RPC relay and launch handlers; `server/shared/` holds their logic.
- `src/api/client.js` is the browser client used by every page.
- `base44/` keeps only the old entity schemas and functions for reference; nothing there is deployed.

## Local development

1. `npm ci`
2. Copy `.env.example` to `.env.local` and fill in `DATABASE_URL` and `SESSION_SECRET` (or run offline with `PGLITE=1`).
3. In one terminal run `npm run dev:api`; in another run `npm run dev`. Vite proxies `/api` to the local API.
4. `npm run test:api` runs the API tests against an in-memory Postgres.

## Deploying on Vercel

Import the GitHub repo in Vercel (framework: Vite). Set the server variables from `.env.example` in Project Settings, then deploy. `vercel.json` routes `/api/*` to the function and everything else to the app.

## Mainnet DBC launches

The `/launch` page supports connected-Phantom creation, image or hosted metadata,
reviewed priority/rent fees, real-SOL consent, confirmed-launch navigation and
controller fee actions. Configure and verify the approved mainnet deployment
using [the mainnet release checklist](docs/dbc-mainnet.md). No live manifest or
private key is included in this repository.

## Verification

Install Node 22.16.0 and Deno 2.9.7, then run `npm ci --ignore-scripts` and
`npm --prefix solana/dbc ci --ignore-scripts`. Run `npm run typecheck`,
`npm run test:types`, `npm run test:backend`, `npm run test:backend-runtime`,
`npm run lint`, and `npm run build`. Typecheck covers maintained frontend,
backend/shared modules and operational scripts using their actual runtime
contexts and committed dependency locks. Coverage guards reject unassigned files.
Historical examples, archived EVM source and test suites have explicit boundaries;
this is not a strict-mode or third-party-code safety claim. See
[backend/tooling verification](docs/backend-tooling.md). Production operations use
mainnet only; local fixtures do not need a devnet RPC. See
[the readiness record](docs/mainnet-readiness.md).

## Repository map

- `solana/` — Anchor program, tests, configuration, and deployment notes
- `src/lib/solana/` — client instructions, market math, activity recovery, and configuration
- `src/pages/SolanaLaunch.jsx` — token creation flow
- `src/pages/SolanaMarket.jsx` — market state and trading flow
- `base44/functions/solanaRpc/` — bounded Solana RPC access
- `base44/functions/indexSolanaTransactions/` — Helius-backed transaction indexing
- `docs/` — active Solana architecture and delivery documentation
- `archive/` — deprecated Robinhood-chain implementation, preserved but inactive

## Security

Never commit private keys or API credentials. Keep wallet checks, account validation, slippage bounds, authority validation, and transaction confirmation logic intact. Review `SECURITY.md` before contributing.

## License

MIT — see `LICENSE`.
