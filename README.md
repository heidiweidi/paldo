# Trend & Volatility Scanner

A Next.js (App Router) web app that scans **crypto + forex/gold** for high-volatility assets with clear
trend continuation, secured behind **Google OAuth**, and built to deploy on **Cloudflare Pages**.

- Live data proxied through the site's own **edge API** (`/api/klines`, `/api/forex`) — fixes forex CORS and hides upstream calls.
- Indicators computed client-side: EMA20/50 alignment, ADX(14), ATR(14) volatility, RSI(14).
- Each signal ships with an ATR-based **entry / stop (1.5×ATR) / target (3×ATR)** = fixed **2:1 reward-to-risk**.
- Click any asset to open a **trade-idea page**: plain-English idea, the risk levels, and an embedded **TradingView chart**.
- Auth.js v5 with JWT sessions (no database) so it runs on the Cloudflare edge runtime.

> Educational signal simulation on live public data — **not financial advice**.

---

## 0. Prerequisites

- Node.js 18+ and npm
- A Google account (for the OAuth client)
- A Cloudflare account (free plan is fine)

Install dependencies:

```bash
cd trend-scanner
npm install
```

---

## 1. Create the Google OAuth client

1. Go to <https://console.cloud.google.com/> → create/select a project.
2. **APIs & Services → OAuth consent screen**: choose **External**, fill app name + your email, save.
   (You can leave it in "Testing" mode; add your email under **Test users** if so.)
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application.**
4. Add **Authorized redirect URIs**:
   - Local: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://YOUR-PROJECT.pages.dev/api/auth/callback/google`
     (add your custom domain's callback too, if you use one)
5. Copy the **Client ID** and **Client secret**.

---

## 2. Configure environment variables

Copy the example file and fill it in:

```bash
cp .env.example .env.local
```

```
AUTH_SECRET=<run: npx auth secret>
AUTH_GOOGLE_ID=<your client id>
AUTH_GOOGLE_SECRET=<your client secret>
ALLOWED_EMAILS=            # empty = any Google account (current setting)
AUTH_URL=http://localhost:3000
```

To later lock it down to only your account, set `ALLOWED_EMAILS=rpa@connectsys.tech` (comma-separate for more).

---

## 3. Run locally

```bash
npm run dev
```

Open <http://localhost:3000> → you'll be redirected to `/login` → sign in with Google → dashboard loads and scans live data.

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
| `AUTH_SECRET` | your generated secret |
| `AUTH_GOOGLE_ID` | Google client ID |
| `AUTH_GOOGLE_SECRET` | Google client secret |
| `AUTH_URL` | `https://YOUR-PROJECT.pages.dev` |
| `ALLOWED_EMAILS` | empty, or your allowlist |

Then update the Google OAuth **Authorized redirect URI** to match your final `pages.dev` (or custom) domain, e.g.
`https://YOUR-PROJECT.pages.dev/api/auth/callback/google`.

Redeploy. Done.

---

## Project structure

```
trend-scanner/
├─ auth.js                     # Auth.js v5 config (Google, JWT, allowlist, route protection)
├─ middleware.js               # Enforces auth on every route
├─ next.config.mjs
├─ wrangler.toml               # Cloudflare Pages config + nodejs_compat
├─ app/
│  ├─ layout.js
│  ├─ globals.css
│  ├─ page.js                  # Protected dashboard page (server) + top bar / sign-out
│  ├─ login/page.js            # Google sign-in screen
│  ├─ asset/[symbol]/page.js   # Per-asset trade-idea + TradingView chart (edge)
│  └─ api/
│     ├─ auth/[...nextauth]/route.js   # Auth.js edge handlers
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
- **Lock down access:** set `ALLOWED_EMAILS`.

## Notes & limits

- Binance/Yahoo are free public endpoints and can rate-limit; the edge routes cache responses ~60s and the UI has a Scan/retry button.
- Yahoo has no native 4H interval — the app pulls 60m and aggregates to 4H client-side.
- Cloudflare free plan allows plenty of requests for personal use; each scan makes ~41 lightweight edge calls.
