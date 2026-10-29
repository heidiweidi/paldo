// Shared market-data fetchers for Binance (crypto) and Yahoo Finance (forex/gold).
// Used by both the client-facing proxy routes (app/api/klines, app/api/forex)
// and the server-side cron scanner (app/api/cron/scan), so the two never
// drift on how a symbol's bars are actually fetched.

const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://api-gcp.binance.com",
  "https://data-api.binance.vision",
];

const KLINES_INTERVALS = ["5m", "15m", "1h", "4h", "1d"];

export async function fetchKlines(symbolRaw, intervalRaw, limitRaw) {
  const symbol = (symbolRaw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const interval = KLINES_INTERVALS.includes(intervalRaw) ? intervalRaw : "4h";
  const limit = Math.min(1000, Math.max(50, parseInt(limitRaw, 10) || 200));
  if (!symbol) throw new Error("symbol required");

  let lastErr = "unknown";
  for (const host of BINANCE_HOSTS) {
    try {
      const r = await fetch(
        `${host}/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`,
        { cf: { cacheTtl: 60, cacheEverything: true } }
      );
      if (!r.ok) { lastErr = "http " + r.status; continue; }
      const d = await r.json();
      return d.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
    } catch (e) {
      lastErr = String(e);
    }
  }
  throw new Error("binance unreachable: " + lastErr);
}

const FOREX_INTRADAY = ["5m", "15m", "60m"];

export async function fetchForex(ysym, intervalRaw, rangeRaw) {
  if (!ysym) throw new Error("symbol required");
  const wantsDaily = intervalRaw === "1d";
  const interval = wantsDaily ? "1d" : (FOREX_INTRADAY.includes(intervalRaw) ? intervalRaw : "60m");

  let allowedRanges, defaultRange;
  if (wantsDaily) { allowedRanges = ["1y", "2y", "5y"]; defaultRange = "2y"; }
  else if (interval === "60m") { allowedRanges = ["1mo", "3mo", "6mo"]; defaultRange = "1mo"; }
  else { allowedRanges = ["5d", "10d", "1mo", "60d"]; defaultRange = "5d"; }
  const range = allowedRanges.includes(rangeRaw) ? rangeRaw : defaultRange;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ysym
  )}?interval=${interval}&range=${range}`;

  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!r.ok) throw new Error("yahoo http " + r.status);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error("yahoo empty");
  const q = res.indicators.quote[0];
  const ts = res.timestamp || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null) continue;
    bars.push({ t: ts[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume ? q.volume[i] : null });
  }
  return bars;
}
