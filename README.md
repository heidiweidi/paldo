# Trend & Volatility Scanner

A Next.js (App Router) web app that scans **crypto + forex/gold** for high-volatility assets with clear
trend continuation, secured behind **wallet sign-in** (MetaMask, Trust Wallet, any WalletConnect wallet), and built to deploy on **Cloudflare Pages**.

- Live data proxied through the site's own **edge API** (`/api/klines`, `/api/forex`) — fixes forex CORS and hides upstream calls.
- Indicators computed client-side: EMA20/50 alignment, ADX(14), ATR(14) volatility, RSI(14).
- Each signal ships with an ATR-based **entry / stop (1.5×ATR) / target (3×ATR)** = fixed **2:1 reward-to-risk**.
- Click any asset to open a **trade-idea page**: plain-English idea, the risk levels, and an embedded **TradingView chart**.
- Sign-In with Ethereum (EIP-4361) with signed-cookie sessions (no database), so it runs on the Cloudflare edge runtime.

> Educational signal simulation on live public data — **not financial advice**.

---

## 0. Prerequisites

- Node.js 18+ and npm
- A wallet (MetaMask or Trust Wallet) and, for QR-code / mobile sign-in, a free WalletConnect project ID
- A Cloudflare account (free plan is fine)

Install dependencies:

```bash
cd trend-scanner
npm install
```

---

## 1. How wallet sign-in works

The login page asks your wallet to sign a short message (Sign-In with Ethereum, EIP-4361). Signing is free: no transaction is sent and no funds move. The server checks the signature, checks the wallet against `WALLET_ALLOWLIST`, and sets a signed httpOnly session cookie (7 days). A middleware gate then protects every page and API route. `/api/cron/scan` is exempt and keeps its own bearer secret (`CRON_SECRET`).

- **Browser wallets** (MetaMask, Trust Wallet extension or in-app browser) connect directly.
- **WalletConnect** adds a QR code / mobile deep link, and is how Trust Wallet connects on desktop. Create a free project at <https://dashboard.reown.com> and set `WALLETCONNECT_PROJECT_ID`. Without it only browser and in-app wallets work.
- **Signing out:** the Disconnect button, or switching account in the wallet, ends the session. Removing an address from `WALLET_ALLOWLIST` revokes it on its next request.
- **Per-wallet sync:** the trade journal and alert settings follow the wallet across devices, stored in the same KV namespace as the cron ledger (section 5). Without KV they stay in that browser only.

---

## 2. Configure environment variables

```bash
cp .env.example .env.local
```

```
SESSION_SECRET=<run: openssl rand -base64 33>     # 32+ characters; without it nobody can sign in
WALLET_ALLOWLIST=0xYourWallet,0xAnotherWallet     # "*" = any wallet; empty = nobody (fail closed)
WALLETCONNECT_PROJECT_ID=                         # optional, from dashboard.reown.com
```

---

## 3. Run locally

```bash
npm run dev
```

Open <http://localhost:3000> → you'll be redirected to `/login` → connect your wallet and sign → dashboard loads and scans live data.

To check the whole sign-in and sync flow without a real wallet, run the dev server with `SESSION_SECRET` and `WALLET_ALLOWLIST` set to the address of a throwaway key, then `TEST_KEY=<that key> node scripts/auth-smoke.mjs http://localhost:3000`.

To test the Cloudflare build locally (edge runtime, like production):

```bash
npm run preview
```

---

## 4. Deploy to Cloudflare Pages

You can deploy from the CLI or by connecting your Git repo.

### Option A — CLI (fastest)

```bash
npm run deploy
```

This runs `@cloudflare/next-on-pages` and `wrangler pages deploy`. On first run, wrangler asks you to log in.

### Option B — Git integration (recommended for ongoing use)

1. Push this folder to a GitHub/GitLab repo.
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git** → select the repo.
3. Build settings:
   - **Framework preset:** Next.js
   - **Build command:** `npx @cloudflare/next-on-pages`
   - **Build output directory:** `.vercel/output/static`
4. **Settings → Functions → Compatibility flags:** add `nodejs_compat` (Production **and** Preview).
   (Already set in `wrangler.toml`, but confirm it in the dashboard for Git builds.)

### Environment variables on Cloudflare

In **Settings → Environment variables**, add for Production (and Preview):

| Name | Value |
|------|-------|
| `SESSION_SECRET` | random string, 32+ characters (`openssl rand -base64 33`) |
| `WALLET_ALLOWLIST` | comma-separated wallet addresses, or `*` for any wallet |
| `WALLETCONNECT_PROJECT_ID` | optional, for QR / mobile wallets |

Nothing else to register: wallet sign-in has no callback URLs. Set the variables, then redeploy.

**Set `SESSION_SECRET` and `WALLET_ALLOWLIST` before deploying this version.** Until both exist, every page redirects to `/login` and nobody can sign in.



---

## 5. Scheduled scan + alerts (works without a browser open)

The Dashboard's alerts (🔔 button) only fire while that tab is open and scanning. `/api/cron/scan` runs the same Strat#5 scan server-side and posts Discord alerts on its own, so it works even when nobody's watching the site.

1. **Create the KV namespace** used to remember which alerts were already sent (so a symbol doesn't re-alert every run):
   ```bash
   npx wrangler kv namespace create ALERTS_KV
   ```
   Copy the `id` it prints into `wrangler.toml` (`[[kv_namespaces]]` block), and also add the same binding in the Cloudflare dashboard under **Settings → Functions → KV namespace bindings** (bindings in `wrangler.toml` aren't picked up by Git-triggered Pages builds).

2. **Set environment variables** on the Cloudflare Pages project (Production and Preview):

   | Name | Value |
   |------|-------|
   | `CRON_SECRET` | a random secret, e.g. `openssl rand -base64 33` — the endpoint refuses to run without one |
   | `DISCORD_WEBHOOK_URL` | your Discord webhook, so alerts don't depend on a browser having one saved |
   | `ALERT_MIN_GRADE` | optional, defaults to `A` |

3. **Schedule it.** `.github/workflows/scan-cron.yml` calls the endpoint every 5 minutes via GitHub Actions — add these as repo secrets (**Settings → Secrets and variables → Actions**):
   - `SITE_URL` — e.g. `https://paldo.pages.dev`
   - `CRON_SECRET` — same value as above

   GitHub's scheduled workflows are best-effort (can run a few minutes late, and get disabled after 60 days with no repo activity — a commit or a manual **Run workflow** click re-enables it). For tighter timing, trigger the same URL from any external cron service instead (e.g. cron-job.org, or a Cloudflare Worker Cron Trigger once one's set up on the account).

Manually test it any time with:
```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR-PROJECT.pages.dev/api/cron/scan
```
It returns a JSON summary (`scanned`, `candidates`, `sent`).

---

## Coin lists and the Bitunix scan

The scanner's coin list is a toggle above the table:

- **Curated list**: a fixed set of liquid coins (`lib/universe.js`), candles from Binance.
- **Top by market cap**: the current top N from CoinGecko, candles from Binance.
- **Bitunix**: the top N USDT perpetuals on Bitunix by 24h volume, scanned with **Bitunix's own candles** (`/api/bitunix` for the list, `/api/bitunix/klines` for candles, helpers in `lib/bitunix.js`). Most of what Bitunix lists is not on Binance spot, which is why it doesn't reuse the Binance proxy. Bitunix also lists tokenized stocks, ETFs and commodities, so those show up next to the coins. Rows are labelled `BITUNIX`, and their asset page and TradingView chart use the Bitunix perpetual (`BITUNIX:XXXUSDT.P`).

Bitunix throttles bursts ("request too frequently"), so the scan fetches two symbols at a time and the edge route retries throttled calls with backoff. A 25-coin scan takes about 10 to 15 seconds.

## Hidden controls

`lib/uiFlags.js` switches off the Strat#5 v1.0 / v1.1 toggle and the 4H to 15m / 1H to 5m tabs for now. The scanner uses the default version and shows the 4H to 15m table; alerts still watch both pairings. Set a flag to `true` to bring a control back. The "how to read it" text lives in the header **Menu** (`components/HelpContent.jsx`).

---

## Project structure

```
trend-scanner/
├─ middleware.js               # Wallet gate: session cookie required on every route
├─ next.config.mjs
├─ wrangler.toml               # Cloudflare Pages config + nodejs_compat
├─ app/
│  ├─ layout.js
│  ├─ globals.css
│  ├─ page.js                  # Protected dashboard page (server) + top bar / sign-out
│  ├─ login/page.js            # Wallet sign-in screen
│  ├─ asset/[symbol]/page.js   # Per-asset trade-idea + TradingView chart (edge)
│  └─ api/
│     ├─ auth/{nonce,verify,session,logout}/route.js  # Sign-In with Ethereum
│     ├─ sync/route.js                 # Per-wallet journal + alert settings (KV)
│     ├─ klines/route.js               # Binance proxy (edge)
│     └─ forex/route.js                # Yahoo Finance proxy (edge)
├─ components/
│  ├─ Dashboard.jsx            # Client dashboard: fetch → compute → render
│  ├─ AssetDetail.jsx          # Trade-idea view (recomputes live) + stats
│  └─ TradingViewChart.jsx     # Embedded TradingView Advanced Chart
└─ lib/
   ├─ indicators.js            # EMA/RSI/ATR/ADX + analyze()
   ├─ symbols.js               # Internal → TradingView symbol mapping
   └─ universe.js              # Crypto + forex symbol lists
```

## Customizing

- **Assets:** edit `lib/universe.js`.
- **Risk model:** change the `1.5 * atrV` / `3 * atrV` multipliers in `lib/indicators.js` (`analyze`).
- **Signal strictness:** raise the ADX threshold in the UI, or tighten the alignment rules in `analyze`.
- **Lock down access:** edit `WALLET_ALLOWLIST`.

## Notes & limits

- Binance/Yahoo are free public endpoints and can rate-limit; the edge routes cache responses ~60s and the UI has a Scan/retry button.
- Yahoo has no native 4H interval — the app pulls 60m and aggregates to 4H client-side.
- Cloudflare free plan allows plenty of requests for personal use; each scan makes ~41 lightweight edge calls.
