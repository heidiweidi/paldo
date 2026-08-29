"use client";

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, ColorType, LineStyle } from "lightweight-charts";

const LONG = "#1fbf75";
const SHORT = "#ff5470";
const WARN = "#f2b13c";

// Our own candlestick chart (TradingView's *embedded* widget is a cross-origin
// iframe with no API for injecting drawings, so entry/stop/target markers have
// to live on a chart we render ourselves — this uses TradingView's open-source
// lightweight-charts library). Draws horizontal Entry/Stop/Target lines plus
// shaded risk (red) / reward (green) bands between them.
export default function PositionChart({ bars, entry, stop, target, height = 320 }) {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !bars || bars.length === 0) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#0f1826" }, textColor: "#c7d2e0" },
      grid: {
        vertLines: { color: "rgba(34, 48, 74, 0.6)" },
        horzLines: { color: "rgba(34, 48, 74, 0.6)" },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: "rgba(34, 48, 74, 0.9)" },
      crosshair: { mode: 0 },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: LONG, downColor: SHORT, borderVisible: false,
      wickUpColor: LONG, wickDownColor: SHORT,
      // The library's own "last price" line/label sits on the price axis just
      // like our Entry/Stop/Target lines do — when the current price lands
      // close to one of those (a tight stop especially), its label collides
      // with ours. We already show current price elsewhere on the page, so
      // turn off the built-in one here to stop that overlap.
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const data = bars
      .map((b) => ({ time: Math.floor(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c }))
      .sort((x, y) => x.time - y.time)
      .filter((d, i, arr) => i === 0 || d.time !== arr[i - 1].time);
    series.setData(data);

    if (entry != null) {
      series.createPriceLine({ price: entry, color: WARN, lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Entry" });
    }
    if (stop != null) {
      series.createPriceLine({ price: stop, color: SHORT, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Stop" });
    }
    if (target != null) {
      series.createPriceLine({ price: target, color: LONG, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Target" });
    }

    chart.timeScale().fitContent();

    function scaleWidth() {
      try {
        const w = chart.priceScale("right").width();
        return typeof w === "number" && w > 0 ? w : 60;
      } catch {
        return 60;
      }
    }

    function updateBands() {
      const el = overlayRef.current;
      if (!el) return;
      if (entry == null || stop == null || target == null) { el.innerHTML = ""; return; }
      const yEntry = series.priceToCoordinate(entry);
      const yStop = series.priceToCoordinate(stop);
      const yTarget = series.priceToCoordinate(target);
      if (yEntry == null || yStop == null || yTarget == null) { el.innerHTML = ""; return; }

      const right = scaleWidth();
      const riskTop = Math.min(yEntry, yStop);
      const riskH = Math.max(1, Math.abs(yStop - yEntry));
      const rewardTop = Math.min(yEntry, yTarget);
      const rewardH = Math.max(1, Math.abs(yTarget - yEntry));

      el.innerHTML = `
        <div style="position:absolute;left:0;right:${right}px;top:${riskTop}px;height:${riskH}px;background:rgba(255,84,112,0.14);border-top:1px dashed rgba(255,84,112,0.5);border-bottom:1px dashed rgba(255,84,112,0.5);"></div>
        <div style="position:absolute;left:0;right:${right}px;top:${rewardTop}px;height:${rewardH}px;background:rgba(31,191,117,0.14);border-top:1px dashed rgba(31,191,117,0.5);border-bottom:1px dashed rgba(31,191,117,0.5);"></div>
      `;
    }

    updateBands();
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateBands);
    const resizeObs = new ResizeObserver(() => {
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
      updateBands();
    });
    resizeObs.observe(containerRef.current);

    return () => {
      resizeObs.disconnect();
      chart.remove();
    };
  }, [bars, entry, stop, target]);

  return (
    <div style={{ position: "relative", height }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={overlayRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
    </div>
  );
}
