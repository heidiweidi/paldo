"use client";

import { useEffect, useRef } from "react";

// Momentum context beneath the candles. Liquidity Sweep / MSS / FVG / Breaker
// Block still aren't drawable via TradingView's basic-studies widget, so the
// price pane itself stays unobstructed for reading structure — these two sit
// in their own panes below it:
//   Stochastic RSI — momentum exhaustion, useful for timing the pullback
//                    into the FVG rather than chasing.
//   MACD           — momentum/trend confirmation of the structure shift.
// Volume is switched off (hide_volume below) so the price pane stays clean.
const DEFAULT_STUDIES = ["StochasticRSI@tv-basicstudies", "MACD@tv-basicstudies"];

// Embeds the TradingView Advanced Chart via the legacy tv.js widget loader.
export default function TradingViewChart({ symbol, interval = "240", height = 520, studies = DEFAULT_STUDIES }) {
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
        hide_volume: true, // volume overlay off — Stoch RSI + MACD replace it
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
