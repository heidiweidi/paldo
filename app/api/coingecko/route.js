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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const perPage = Math.min(250, Math.max(10, parseInt(searchParams.get("limit"), 10) || 50));

  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=false&price_change_percentage=24h`;

  try {
    const headers = { Accept: "application/json" };
    // Optional: set COINGECKO_API_KEY in the Cloudflare Pages environment to
    // use a demo/pro key for a higher rate limit. Works fine without one.
    if (process.env.COINGECKO_API_KEY) {
      headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
    }
    const r = await fetch(url, { headers, cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return json({ error: "coingecko http " + r.status }, 502);
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
    return json({ coins }, 200, 300);
  } catch (e) {
    return json({ error: "coingecko unreachable: " + String(e) }, 502);
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
