// Edge proxy for CoinGecko's coin-market-data endpoint — avoids browser CORS
// issues and gives us a place to cache, since CoinGecko's free/keyless tier
// is rate-limited (roughly 5-15 calls/min). Used to build a "top N by market
// cap" crypto universe for the scanner, as an alternative to the curated
// fixed list in lib/universe.js.
export const runtime = "edge";

// Coins that track another asset 1:1 (stablecoins, wrapped/staked/bridged
// tokens) don't have independent price action worth running a reversal
// checklist on, so they're filtered out of the market-cap universe.
const EXCLUDE_SYMBOLS = new Set([
  // stablecoins
  "USDT", "USDC", "DAI", "BUSD", "TUSD", "USDD", "USDP", "GUSD", "FDUSD",
  "PYUSD", "USDE", "FRAX", "LUSD", "USTC", "EURS", "EURT", "USDS", "USD1",
  "XSGD", "PAXG", "XAUT",
  // wrapped / staked / bridged derivatives that just track another coin
  "WBTC", "WETH", "WSTETH", "STETH", "WEETH", "WBETH", "CBETH", "RETH",
  "METH", "BETH", "WBNB",
]);

// Whole handler wrapped in one outer try/catch so literally nothing here can
// escape as an uncaught exception — an uncaught throw in a Cloudflare Pages
// Function makes Cloudflare serve its own opaque HTML "Bad gateway" page
// instead of our JSON, which is indistinguishable from a real network
// failure on the client and impossible to debug without this guard.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const perPage = Math.min(250, Math.max(10, parseInt(searchParams.get("limit"), 10) || 50));
    const debug = searchParams.get("debug") === "1";

    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=false&price_change_percentage=24h`;

    // Reading process.env has been observed to throw in some Cloudflare Pages
    // edge-runtime configurations depending on how the binding is wired up —
    // guard it so a missing/misbehaving env binding never takes down the
    // whole route.
    let apiKey;
    try {
      apiKey = typeof process !== "undefined" && process.env ? process.env.COINGECKO_API_KEY : undefined;
    } catch {
      apiKey = undefined;
    }
    apiKey = typeof apiKey === "string" ? apiKey.trim() : undefined;

    const headers = { Accept: "application/json" };
    // Optional: set COINGECKO_API_KEY in the Cloudflare Pages environment to
    // use a demo key for a higher rate limit. Works fine without one. Guard
    // against stray whitespace/newlines from copy-paste, which can make
    // fetch() throw "Invalid header value" when building the request.
    if (apiKey && /^[\x21-\x7e]+$/.test(apiKey)) {
      headers["x-cg-demo-api-key"] = apiKey;
    }

    // CoinGecko's free tier can be slow or drop connections outright for
    // requests coming from Cloudflare's IP ranges. If we let that fetch hang,
    // the Worker itself times out and Cloudflare serves its own opaque 502
    // (bypassing our try/catch below entirely, so the client never sees a
    // useful error). A hard timeout here guarantees we always fail fast and
    // return real JSON that the scanner can fall back on. Using
    // AbortController + setTimeout instead of the newer AbortSignal.timeout()
    // static method, since that method isn't reliably available in every
    // edge runtime build.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let r;
    try {
      r = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!r.ok) {
      let detail;
      if (debug) {
        try { detail = (await r.text()).slice(0, 500); } catch {}
      }
      return json({ error: "coingecko http " + r.status, ...(debug ? { detail, hadKey: !!apiKey } : {}) }, 502);
    }
    const data = await r.json();
    if (!Array.isArray(data)) return json({ error: "coingecko unexpected response" }, 502);

    const seen = new Set();
    const coins = [];
    for (const c of data) {
      const symbol = (c.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!symbol || EXCLUDE_SYMBOLS.has(symbol) || seen.has(symbol)) continue;
      seen.add(symbol);
      coins.push({
        symbol,
        name: c.name,
        rank: c.market_cap_rank ?? null,
        price: c.current_price ?? null,
        marketCap: c.market_cap ?? null,
        volume24h: c.total_volume ?? null,
        chg24h: c.price_change_percentage_24h ?? null,
      });
    }
    return json({ coins, ...(debug ? { hadKey: !!apiKey } : {}) }, 200, 300);
  } catch (e) {
    const reason = e && e.name === "TimeoutError" ? "coingecko timed out" : "coingecko unreachable: " + (e && e.message ? e.message : String(e));
    return json({ error: reason }, 502);
  }
}

function json(obj, status = 200, cache = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": cache ? `public, max-age=${cache}` : "no-store",
    },
  });
}
