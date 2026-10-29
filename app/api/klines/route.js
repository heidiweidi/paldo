// Edge proxy for Binance klines — avoids browser geo/CORS issues.
export const runtime = "edge";

import { fetchKlines } from "@/lib/marketData";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const interval = searchParams.get("interval");
  const limit = searchParams.get("limit");
  if (!(symbol || "").trim()) return json({ error: "symbol required" }, 400);

  try {
    const bars = await fetchKlines(symbol, interval, limit);
    return json({ bars }, 200, 60);
  } catch (e) {
    return json({ error: e.message || String(e) }, 502);
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
