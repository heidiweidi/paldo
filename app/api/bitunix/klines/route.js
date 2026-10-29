// All scanner timeframes for one Bitunix symbol in a single call: ?symbol=BTC&intervals=4h,1h,15m,5m
// The four upstream requests run sequentially on purpose (see lib/bitunix.js).
export const runtime = "edge";

import { fetchBitunixAll, BITUNIX_INTERVALS } from "@/lib/bitunix";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(symbol)) return json({ error: "symbol required" }, 400);
  const wanted = (searchParams.get("intervals") || BITUNIX_INTERVALS.join(","))
    .split(",")
    .filter((iv) => BITUNIX_INTERVALS.includes(iv));
  if (!wanted.length) return json({ error: "no valid intervals" }, 400);
  try {
    const bars = await fetchBitunixAll(symbol, wanted);
    return json({ bars }, 200, 30);
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
