"use client";

import { useEffect, useRef } from "react";

// Default overlays for Trend/ADX mode (matches that strategy's EMA20/EMA50 + RSI(14) logic).
const TREND_STUDIES = [
  { id: "MAExp@tv-basicstudies", inputs: { length: 20 } },
  { id: "MAExp@tv-basicstudies", inputs: { length: 50 } },
  { id: "RSI@tv-basicstudies", inputs: { length: 14 } },
];

// Embeds the TradingView Advanced Chart via the legacy tv.js widget loader.
// `studies` defaults to the Trend/ADX overlays; pass an empty array for a plain
// price chart (Structure Setup mode — liquidity sweeps/MSS/FVG/breaker blocks
// aren't drawable via TradingView's basic-studies widget, so you verify those
// visually on unobstructed candles instead).
export default function TradingViewChart({ symbol, interval = "240", height = 520, studies = TREND_STUDIES }) {
  const ref = useRef(null);

  useEffect(() => {
    let cancelled = false;

    function create() {
      if (cancelled || !ref.current || !window.TradingView) return;
      ref.current.innerHTML = "";
      // eslint-disable-next-line no-new
      new window.TradingView.widget({
        container_id: ref.current.id,
        symbol,
        interval,
        autosize: true,
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        hide_side_toolbar: false,
        allow_symbol_change: true,
        withdateranges: true,
        studies,
        backgroundColor: "rgba(18, 28, 46, 1)",
        gridColor: "rgba(34, 48, 74, 0.6)",
      });
    }

    if (window.TradingView) {
      create();
    } else {
      const id = "tradingview-tvjs";
      let s = document.getElementById(id);
      if (!s) {
        s = document.createElement("script");
        s.id = id;
        s.src = "https://s3.tradingview.com/tv.js";
        s.async = true;
        s.onload = create;
        document.body.appendChild(s);
      } else if (window.TradingView) {
        create();
      } else {
        s.addEventListener("load", create);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [symbol, interval, studies]);

  return <div id="tv_advanced_chart" ref={ref} className="tvchart" style={{ height }} />;
}
