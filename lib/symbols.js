// Map an internal asset to its TradingView symbol.
export function tvSymbol(mkt, symbol) {
  if (mkt === "crypto") return `BINANCE:${symbol}USDT`;
  if (symbol === "XAUUSD") return "OANDA:XAUUSD"; // gold
  return `FX:${symbol}`; // EURUSD, USDJPY, EURGBP, GBPJPY, ...
}

// Dashboard timeframe -> TradingView interval code.
export const TV_INTERVAL = { "1h": "60", "4h": "240" };

// A public TradingView chart URL (used as an external fallback link).
export function tvUrl(mkt, symbol, tf) {
  const sym = tvSymbol(mkt, symbol).replace(":", "%3A");
  return `https://www.tradingview.com/chart/?symbol=${sym}&interval=${TV_INTERVAL[tf] || "240"}`;
}
