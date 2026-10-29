"use client";

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, ColorType, LineStyle } from "lightweight-charts";

const LONG = "#1fbf75";
const SHORT = "#ff5470";
const WARN = "#f2b13c";
const ACCENT = "#4c8dff";
const MUTED = "#8ba0be";
const TXT = "#e7edf6";

// Illustrative candles (not any real asset's data) shaped to show the entry
// checklist used by this scanner: a decline into a swing low, a liquidity
// sweep below it, a Market Structure Shift back above the prior swing high,
// a Fair Value Gap left behind on the reversal leg, and an entry/stop/target
// sized to a 1:2 reward-to-risk. Rendered with the same lightweight-charts
// library (and the same candlestick/price-line approach) as the real
// PositionChart, just with hand-picked numbers instead of live data. Time
// values are arbitrary sequential hours — the x-axis isn't meaningful here.
const BASE_T = 1704067200; // 2024-01-01T00:00:00Z, arbitrary anchor
const t = (i) => BASE_T + i * 3600;

const CANDLES = [
  { time: t(0), open: 175, high: 200, low: 170, close: 195 },
  { time: t(1), open: 190, high: 220, low: 185, close: 215 },
  { time: t(2), open: 205, high: 210, low: 160, close: 170 },
  { time: t(3), open: 165, high: 170, low: 120, close: 125 },
  { time: t(4), open: 120, high: 125, low: 80, close: 85 },
  { time: t(5), open: 90, high: 95, low: 58, close: 62 }, // swing-low pivot / Breaker Block candle
  { time: t(6), open: 80, high: 88, low: 35, close: 62 }, // Liquidity Sweep: wicks below the pivot, closes back above
  { time: t(7), open: 90, high: 180, low: 70, close: 175 }, // MSS: closes back above the prior swing high
  { time: t(8), open: 170, high: 175, low: 142, close: 148 }, // pullback into the Fair Value Gap
  { time: t(9), open: 170, high: 220, low: 160, close: 215 },
  { time: t(10), open: 205, high: 260, low: 200, close: 255 },
  { time: t(11), open: 235, high: 300, low: 230, close: 295 },
];

const SWEEP_LEVEL = 58; // the swept swing-low
const MSS_LEVEL = 170; // the prior swing-high that gets broken
const ENTRY = 150;
const STOP = 90;
const TARGET = 270;
const BREAKER_IDX = 5;
const FVG_TOP = 170;
const FVG_BOTTOM = 110;
const FVG_FROM_IDX = 7;
const FVG_TO_IDX = 9;

export default function StrategyDiagram({ height = 320 }) {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#0f1826" }, textColor: "#c7d2e0" },
      grid: {
        vertLines: { color: "rgba(34, 48, 74, 0.6)" },
        horzLines: { color: "rgba(34, 48, 74, 0.6)" },
      },
      timeScale: { visible: false }, // the time axis is arbitrary here, not real dates
      rightPriceScale: { borderColor: "rgba(34, 48, 74, 0.9)" },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: LONG, downColor: SHORT, borderVisible: false,
      wickUpColor: LONG, wickDownColor: SHORT,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    series.setData(CANDLES);

    series.createPriceLine({ price: ENTRY, color: WARN, lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Entry" });
    series.createPriceLine({ price: STOP, color: SHORT, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Stop" });
    series.createPriceLine({ price: TARGET, color: LONG, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Target (1:2)" });
    series.createPriceLine({ price: SWEEP_LEVEL, color: MUTED, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "Liquidity Sweep" });
    series.createPriceLine({ price: MSS_LEVEL, color: ACCENT, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "MSS" });

    chart.timeScale().fitContent();

    function scaleWidth() {
      try {
        const w = chart.priceScale("right").width();
        return typeof w === "number" && w > 0 ? w : 60;
      } catch {
        return 60;
      }
    }

    function draw() {
      const el = overlayRef.current;
      if (!el) return;
      const right = scaleWidth();
      const yEntry = series.priceToCoordinate(ENTRY);
      const yStop = series.priceToCoordinate(STOP);
      const yTarget = series.priceToCoordinate(TARGET);
      const yFvgTop = series.priceToCoordinate(FVG_TOP);
      const yFvgBottom = series.priceToCoordinate(FVG_BOTTOM);
      const xBreaker = chart.timeScale().timeToCoordinate(CANDLES[BREAKER_IDX].time);
      const xFvgFrom = chart.timeScale().timeToCoordinate(CANDLES[FVG_FROM_IDX].time);
      const xFvgTo = chart.timeScale().timeToCoordinate(CANDLES[FVG_TO_IDX].time);
      if ([yEntry, yStop, yTarget, yFvgTop, yFvgBottom, xBreaker, xFvgFrom, xFvgTo].some((v) => v == null)) {
        el.innerHTML = "";
        return;
      }

      const riskTop = Math.min(yEntry, yStop);
      const riskH = Math.max(1, Math.abs(yStop - yEntry));
      const rewardTop = Math.min(yEntry, yTarget);
      const rewardH = Math.max(1, Math.abs(yTarget - yEntry));
      const fvgTop = Math.min(yFvgTop, yFvgBottom);
      const fvgH = Math.max(1, Math.abs(yFvgBottom - yFvgTop));
      const fvgLeft = Math.min(xFvgFrom, xFvgTo) - 8;
      const fvgWidth = Math.abs(xFvgTo - xFvgFrom) + 16;

      el.innerHTML = `
        <div style="position:absolute;left:0;right:${right}px;top:${riskTop}px;height:${riskH}px;background:rgba(255,84,112,0.10);"></div>
        <div style="position:absolute;left:0;right:${right}px;top:${rewardTop}px;height:${rewardH}px;background:rgba(31,191,117,0.10);"></div>
        <div style="position:absolute;left:${fvgLeft}px;width:${fvgWidth}px;top:${fvgTop}px;height:${fvgH}px;background:rgba(76,141,255,0.18);border:1px dashed rgba(76,141,255,0.55);box-sizing:border-box;"></div>
        <div style="position:absolute;left:${fvgLeft}px;top:${Math.max(2, fvgTop - 16)}px;color:${ACCENT};font-size:11px;font-weight:700;white-space:nowrap;">FVG</div>
        <div style="position:absolute;left:${xBreaker - 16}px;top:0;width:32px;height:100%;border:1px dashed rgba(231,237,246,0.55);box-sizing:border-box;"></div>
        <div style="position:absolute;left:${xBreaker - 38}px;bottom:2px;color:${TXT};font-size:11px;font-weight:700;white-space:nowrap;">Breaker Block</div>
      `;
    }

    draw();
    chart.timeScale().subscribeVisibleLogicalRangeChange(draw);
    const resizeObs = new ResizeObserver(() => {
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
      draw();
    });
    resizeObs.observe(containerRef.current);

    return () => {
      resizeObs.disconnect();
      chart.remove();
    };
  }, []);

  return (
    <div style={{ position: "relative", height }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={overlayRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
    </div>
  );
}
