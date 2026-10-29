"use client";

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, ColorType, LineStyle } from "lightweight-charts";

const LONG = "#1fbf75";
const SHORT = "#ff5470";
const WARN = "#f2b13c";
const ACCENT = "#4c8dff";
const MUTED = "#8ba0be";
const TXT = "#e7edf6";
const POI_C = "#c58cff"; // next liquidity pool — distinct from MSS blue

// Our own candlestick chart (TradingView's *embedded* widget is a cross-origin
// iframe with no API for injecting drawings, so every checklist marker has to
// live on a chart we render ourselves — this uses TradingView's open-source
// lightweight-charts library) for this exact asset's real data. Draws:
//   - Entry/Stop plus TP1 (1:1) and TP2 (1:2), with shaded risk (red) and
//     reward (green) bands
//   - The POI — next unswept liquidity on the bias timeframe — as a marker of
//     where price is likely headed after TP2, not as a target itself
//   - Liquidity Sweep / MSS levels as dotted price lines
//   - The Fair Value Gap as a shaded zone between its start/end candles
//   - The Breaker Block candidate as a dashed outline around that candle
// sweepIdx/mssIdx/fvgZone.fromIdx/toIdx/breaker.index are bar indices into
// this same `bars` array (that's what lib/indicators.js computed them
// against), so we look up real chart times from `bars` directly rather than
// the chart's internal (sorted/deduped) series data.
export default function PositionChart({
  bars, entry, stop, tp1, tp2, poi,
  sweepLevel, mssLevel, fvgZone, breaker,
  height = 320,
}) {
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
    if (tp1 != null) {
      series.createPriceLine({ price: tp1, color: LONG, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "TP1 1:1" });
    }
    if (tp2 != null) {
      series.createPriceLine({ price: tp2, color: LONG, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "TP2 1:2" });
    }
    // Where price is likely to travel next — drawn deliberately unlike the TP
    // lines so it never reads as an exit level.
    if (poi != null) {
      series.createPriceLine({ price: poi, color: POI_C, lineWidth: 2, lineStyle: LineStyle.LargeDashed, axisLabelVisible: true, title: "POI — next liquidity" });
    }
    if (sweepLevel != null) {
      series.createPriceLine({ price: sweepLevel, color: MUTED, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "Liquidity Sweep" });
    }
    if (mssLevel != null) {
      series.createPriceLine({ price: mssLevel, color: ACCENT, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "MSS" });
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

    function barTime(idx) {
      const b = bars[idx];
      return b ? Math.floor(b.t / 1000) : null;
    }

    function update() {
      const el = overlayRef.current;
      if (!el) return;
      const right = scaleWidth();
      let html = "";

      if (entry != null && stop != null) {
        const yEntry = series.priceToCoordinate(entry);
        const yStop = series.priceToCoordinate(stop);
        if (yEntry != null && yStop != null) {
          const riskTop = Math.min(yEntry, yStop);
          const riskH = Math.max(1, Math.abs(yStop - yEntry));
          html += `<div style="position:absolute;left:0;right:${right}px;top:${riskTop}px;height:${riskH}px;background:rgba(255,84,112,0.14);border-top:1px dashed rgba(255,84,112,0.5);border-bottom:1px dashed rgba(255,84,112,0.5);"></div>`;
        }
        // Reward shading is split so the 1R band (entry->TP1) reads as the
        // high-probability leg and the 1R->2R band as the runner.
        const shadeBand = (from, to, alpha) => {
          if (from == null || to == null) return;
          const yA = series.priceToCoordinate(from);
          const yB = series.priceToCoordinate(to);
          if (yA == null || yB == null) return;
          const top = Math.min(yA, yB);
          const h = Math.max(1, Math.abs(yB - yA));
          html += `<div style="position:absolute;left:0;right:${right}px;top:${top}px;height:${h}px;background:rgba(31,191,117,${alpha});border-top:1px dashed rgba(31,191,117,0.45);border-bottom:1px dashed rgba(31,191,117,0.45);"></div>`;
        };
        shadeBand(entry, tp1, 0.18);
        shadeBand(tp1, tp2, 0.09);
      }

      if (fvgZone && fvgZone.fromIdx != null && fvgZone.toIdx != null) {
        const tFrom = barTime(fvgZone.fromIdx);
        const tTo = barTime(fvgZone.toIdx);
        const xFrom = tFrom != null ? chart.timeScale().timeToCoordinate(tFrom) : null;
        const xTo = tTo != null ? chart.timeScale().timeToCoordinate(tTo) : null;
        const yTop = series.priceToCoordinate(fvgZone.top);
        const yBottom = series.priceToCoordinate(fvgZone.bottom);
        if (xFrom != null && xTo != null && yTop != null && yBottom != null) {
          const left = Math.min(xFrom, xTo) - 6;
          const width = Math.abs(xTo - xFrom) + 12;
          const top = Math.min(yTop, yBottom);
          const h = Math.max(1, Math.abs(yBottom - yTop));
          html += `<div style="position:absolute;left:${left}px;width:${width}px;top:${top}px;height:${h}px;background:rgba(76,141,255,0.16);border:1px dashed rgba(76,141,255,0.55);box-sizing:border-box;"></div>`;
          html += `<div style="position:absolute;left:${left}px;top:${Math.max(2, top - 16)}px;color:${ACCENT};font-size:11px;font-weight:700;white-space:nowrap;">FVG</div>`;
        }
      }

      if (breaker && breaker.index != null) {
        const tB = barTime(breaker.index);
        const xB = tB != null ? chart.timeScale().timeToCoordinate(tB) : null;
        if (xB != null) {
          html += `<div style="position:absolute;left:${xB - 9}px;top:0;width:18px;height:100%;border:1px dashed rgba(231,237,246,0.55);box-sizing:border-box;"></div>`;
          html += `<div style="position:absolute;left:${Math.max(0, xB - 44)}px;bottom:2px;color:${TXT};font-size:11px;font-weight:700;white-space:nowrap;">Breaker</div>`;
        }
      }

      el.innerHTML = html;
    }

    update();
    chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    const resizeObs = new ResizeObserver(() => {
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
      update();
    });
    resizeObs.observe(containerRef.current);

    return () => {
      resizeObs.disconnect();
      chart.remove();
    };
  }, [bars, entry, stop, tp1, tp2, poi, sweepLevel, mssLevel, fvgZone, breaker]);

  return (
    <div style={{ position: "relative", height }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={overlayRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
    </div>
  );
}
