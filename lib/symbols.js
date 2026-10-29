// Map an internal asset to its TradingView symbol.
// `src` is the data source for crypto: "bitunix" maps to Bitunix's own perpetual contract (many of
// those coins are not on Binance at all), anything else to Binance spot.
export function tvSymbol(mkt, symbol, src) {
  if (mkt === "crypto" && src === "bitunix") return `BITUNIX:${symbol}USDT.P`;
  if (mkt === "crypto") return `BINANCE:${symbol}USDT`;
  if (symbol === "XAUUSD") return "OANDA:XAUUSD"; // gold
  return `FX:${symbol}`; // EURUSD, USDJPY, EURGBP, GBPJPY, ...
}

// Dashboard timeframe -> TradingView interval code.
export const TV_INTERVAL = { "5m": "5", "15m": "15", "1h": "60", "4h": "240" };

// A public TradingView chart URL (used as an external fallback link).
export function tvUrl(mkt, symbol, tf, src) {
  const sym = tvSymbol(mkt, symbol, src).replace(":", "%3A");
  return `https://www.tradingview.com/chart/?symbol=${sym}&interval=${TV_INTERVAL[tf] || "240"}`;
}
