// Edge proxy for Binance klines — avoids browser geo/CORS issues.
export const runtime = "edge";

const HOSTS = [
  "https://api.binance.com",
  "https://api-gcp.binance.com",
  "https://data-api.binance.vision",
];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const interval = searchParams.get("interval") === "1h" ? "1h" : "4h";
  if (!symbol) return json({ error: "symbol required" }, 400);

  let lastErr = "unknown";
  for (const host of HOSTS) {
    try {
      const r = await fetch(
        `${host}/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=200`,
        { cf: { cacheTtl: 60, cacheEverything: true } }
      );
      if (!r.ok) { lastErr = "http " + r.status; continue; }
      const d = await r.json();
      const bars = d.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
      return json({ bars }, 200, 60);
    } catch (e) {
      lastErr = String(e);
    }
  }
  return json({ error: "binance unreachable: " + lastErr }, 502);
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
