// Edge proxy for Yahoo Finance forex/gold candles — server-side fetch removes the browser CORS problem.
export const runtime = "edge";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ysym = searchParams.get("symbol") || "";
  // Yahoo has no native 4h; we always pull 60m and the client aggregates when needed.
  const interval = "60m";
  if (!ysym) return json({ error: "symbol required" }, 400);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ysym
  )}?interval=${interval}&range=1mo`;

  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!r.ok) return json({ error: "yahoo http " + r.status }, 502);
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return json({ error: "yahoo empty" }, 502);
    const q = res.indicators.quote[0];
    const ts = res.timestamp || [];
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close[i] == null) continue;
      bars.push({ t: ts[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    }
    return json({ bars }, 200, 60);
  } catch (e) {
    return json({ error: "yahoo unreachable: " + String(e) }, 502);
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
