// Coin universe for the "Bitunix" scan mode: open USDT perpetuals, most traded first.
// Proxied through the edge because Bitunix sends no CORS headers.
export const runtime = "edge";

import { fetchBitunixUniverse } from "@/lib/bitunix";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(300, Math.max(5, parseInt(searchParams.get("limit"), 10) || 50));
  try {
    const coins = await fetchBitunixUniverse(limit);
    return json({ coins }, 200, 120);
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
