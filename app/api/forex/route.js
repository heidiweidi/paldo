// Edge proxy for Yahoo Finance forex/gold candles — server-side fetch removes the browser CORS problem.
export const runtime = "edge";

import { fetchForex } from "@/lib/marketData";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ysym = searchParams.get("symbol") || "";
  const interval = searchParams.get("interval");
  const range = searchParams.get("range");
  if (!ysym) return json({ error: "symbol required" }, 400);

  try {
    const bars = await fetchForex(ysym, interval, range);
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
