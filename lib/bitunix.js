// Bitunix USDT-margined futures market data (public endpoints, no key needed).
//
// Why Bitunix gets its own data source instead of reusing the Binance proxy: most of what Bitunix
// lists is not on Binance spot at all (new tokens, tokenized stocks, commodities), so scanning
// Binance candles for those symbols would just fail. Bitunix's own candles are also the prices
// you would actually trade at.
//
// Quirks handled here: at most 200 candles per request, newest first, and no CORS headers (so the
// browser must go through our edge routes).
const HOST = "https://fapi.bitunix.com";

export const BITUNIX_INTERVALS = ["5m", "15m", "1h", "4h"];

const THROTTLED = /10006|too frequent|http 429/i;

async function bget(path) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(HOST + path, { signal: controller.signal, cf: { cacheTtl: 60, cacheEverything: true } });
      if (!r.ok) throw new Error(`bitunix http ${r.status}`);
      const j = await r.json();
      if (j.code !== 0) throw new Error(`bitunix ${j.code}: ${j.msg || "error"}`);
      return j.data;
    } catch (e) {
      lastErr = e;
      // Only throttling and transient network failures are worth retrying. A rejected symbol
      // ("not allowed to trade") will fail the same way every time.
      const transient = THROTTLED.test(e.message) || e.name === "AbortError" || /http 5\d\d/.test(e.message) || e instanceof TypeError;
      if (!transient || attempt === 2) break;
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Open USDT perpetual pairs, most traded first (24h quote volume).
 * Returns [{ symbol: "BTC", pair: "BTCUSDT", vol }]; symbol is the pair without the USDT suffix.
 */
export async function fetchBitunixUniverse(limit) {
  const [pairs, tickers] = await Promise.all([
    bget("/api/v1/futures/market/trading_pairs"),
    bget("/api/v1/futures/market/tickers"),
  ]);
  const vol = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVol) || 0]));
  return pairs
    .filter((p) => p.quote === "USDT" && p.symbolStatus === "OPEN" && /^[A-Z0-9]{1,20}USDT$/.test(p.symbol))
    // The scanner's symbol is the pair minus "USDT". Bitunix's own `base` field can differ from it
    // (1000PEPEUSDT has base PEPE), and requests must use the real pair name.
    .map((p) => ({ symbol: p.symbol.slice(0, -4), pair: p.symbol, vol: vol.get(p.symbol) || 0 }))
    .filter((p) => p.vol > 0)
    .sort((a, b) => b.vol - a.vol)
    .slice(0, limit);
}

/** Candles oldest-first in the same shape the Binance proxy returns: { t, o, h, l, c, v }. */
export async function fetchBitunixKlines(coin, interval, limit = 200) {
  if (!/^[A-Z0-9]{1,20}$/.test(coin)) throw new Error("bad symbol");
  if (!BITUNIX_INTERVALS.includes(interval)) throw new Error("bad interval");
  const n = Math.min(200, Math.max(50, limit));
  const rows = await bget(`/api/v1/futures/market/kline?symbol=${coin}USDT&interval=${interval}&limit=${n}`);
  return rows
    .map((k) => ({ t: Number(k.time), o: +k.open, h: +k.high, l: +k.low, c: +k.close, v: +k.baseVol }))
    .sort((a, b) => a.t - b.t);
}

/** All four timeframes for one symbol, fetched one after another so a single scan stays under Bitunix's rate limit. */
export async function fetchBitunixAll(coin, intervals = BITUNIX_INTERVALS) {
  const out = {};
  for (const iv of intervals) out[iv] = await fetchBitunixKlines(coin, iv, 200);
  return out;
}
