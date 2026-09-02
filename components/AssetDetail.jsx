"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FOREX } from "@/lib/universe";
import { analyzeMTF, to4h, STRATEGIES } from "@/lib/indicators";
import { tvSymbol, TV_INTERVAL, tvUrl } from "@/lib/symbols";
import TradingViewChart from "@/components/TradingViewChart";
import PositionChart from "@/components/PositionChart";

const STRAT = STRATEGIES.strat5;
const GRADE_CLS = { "A+": "grade-aplus", A: "grade-a", B: "grade-b" };
// Stochastic RSI + MACD in their own panes; volume is hidden in the widget
// config. Module-scope constant so the chart isn't re-mounted every render.
const STUDIES = ["StochasticRSI@tv-basicstudies", "MACD@tv-basicstudies"];

const PAIRINGS = {
  A: { higher: "4h", lower: "15m", higherLabel: "4H", lowerLabel: "15m", title: "4H Bias → 15m Entry" },
  B: { higher: "1h", lower: "5m", higherLabel: "1H", lowerLabel: "5m", title: "1H Bias → 5m Entry" },
};

async function jget(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function fmt(n, sym) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const dp = sym && sym.includes("JPY") ? 3 : abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return n.toLocaleString(undefined, { minimumFractionDigits: dp > 4 ? 2 : dp, maximumFractionDigits: dp });
}

// Is this setup still catchable, or has price already moved on? See
// entryWindowStatus() in lib/indicators.js for how each status is derived.
const ENTRY_WINDOW = {
  in_zone: { cls: "long", label: "✓ In zone — price has pulled back to entry" },
  running: { cls: "warn", label: "Running — already past entry, no pullback yet" },
  tp1_hit: { cls: "flat", label: "TP1 (1:1) already hit — runner only" },
  tp2_hit: { cls: "flat", label: "TP2 (1:2) already reached" },
  invalidated: { cls: "short", label: "✗ Invalidated — stop already hit" },
};
const ENTRY_WINDOW_NOTE = {
  in_zone: "Price is currently sitting in the entry zone — this is your window.",
  running: "Price already ran past entry without pulling back — chasing it now means worse risk/reward than planned.",
  tp1_hit: "Price has already traded through TP1 — the 1:1 scale-out is gone; only the TP2 runner remains, on worse terms than planned.",
  tp2_hit: "Price has already reached TP2 — this one's fully played out.",
  invalidated: "Price has already traded through the stop — this setup is dead, don't chase it.",
};

// A setup that's already hit TP2 or been invalidated is purely historical —
// still shown for reference, but flagged so it's not mistaken for a live
// opportunity. Mirrors the same helper in Dashboard.jsx.
const PLAYED_OUT_WINDOWS = new Set(["tp2_hit", "invalidated"]);
const PLAYED_OUT_LABEL = { tp2_hit: "PLAYED OUT", invalidated: "INVALIDATED" };
function isPlayedOut(m) {
  return !!(m?.setupReady && PLAYED_OUT_WINDOWS.has(m.entryWindow));
}
function PlayedOutBadge({ window }) {
  const cls = window === "invalidated" ? "short" : "flat";
  return <span className={`pill ${cls} played-out-badge`}>{PLAYED_OUT_LABEL[window]}</span>;
}

// Plain-English readout: higher-TF bias for context, lower-TF checklist as the entry trigger.
function narrative(m, p) {
  if (!m) return "";
  if (!m.biasHigh) {
    return `No liquidity-sweep reversal in progress on the ${p.higherLabel} right now — no recent sweep of a swing high/low has been followed by a structure shift. Nothing to check on ${p.lowerLabel} yet.`;
  }
  const sideHigh = m.biasHigh === "long" ? "bullish" : "bearish";
  const parts = [`${p.higherLabel} bias is ${sideHigh}: price swept a prior swing and confirmed a Market Structure Shift on the ${p.higherLabel}.`];

  if (!m.biasLow) {
    parts.push(`${p.lowerLabel} hasn't shown a matching reversal yet — no sweep/MSS on the ${p.lowerLabel} to act on.`);
  } else if (!m.aligned) {
    parts.push(`${p.lowerLabel} has its own reversal in progress, but it's ${m.biasLow === "long" ? "bullish" : "bearish"} — opposite the ${p.higherLabel} bias, so this isn't a valid entry trigger yet.`);
  } else if (!m.checklist?.fvg) {
    parts.push(`${p.lowerLabel} is aligned with the ${p.higherLabel} bias (Sweep + MSS confirmed), but no Fair Value Gap has formed yet in the ${p.lowerLabel} reversal leg — no entry until one does.`);
  } else {
    parts.push(
      `${p.lowerLabel} is aligned and complete: Sweep → MSS → FVG all confirmed, ${m.barsAgo != null ? `${m.barsAgo} bar(s) since the ${p.lowerLabel} MSS` : ""}. Entry sits mid-gap at ${fmt(m.entry, m.symbol)}, stop beyond the ${p.lowerLabel} sweep at ${fmt(m.stop, m.symbol)}. Scale out at TP1 ${fmt(m.tp1, m.symbol)} (1:1) to de-risk, and let the rest run to TP2 ${fmt(m.tp2, m.symbol)} (1:2).`
    );
    if (m.poi != null) {
      parts.push(
        `The next unswept liquidity pool on the ${p.higherLabel} sits at ${fmt(m.poi, m.symbol)}${m.poiR != null ? `, ${m.poiR.toFixed(1)}R from entry` : ""} — ${m.poiBeyondTp2 ? "beyond TP2, so the runner has room to reach for it" : "closer than TP2, so price may stall or reverse around there before TP2 fills"}.`
      );
    } else {
      parts.push(`No unswept liquidity pool ahead on the ${p.higherLabel} yet, so there's no obvious magnet drawing price beyond TP2.`);
    }
    parts.push(ENTRY_WINDOW_NOTE[m.entryWindow] || "");
  }

  if (m.breaker) {
    parts.push(`Candidate ${p.lowerLabel} Breaker Block: the candle at index ${m.breaker.index} (high ${fmt(m.breaker.high, m.symbol)}, low ${fmt(m.breaker.low, m.symbol)}) — confirm this yourself on the chart before treating it as your flip zone.`);
  }

  return parts.join(" ");
}

export default function AssetDetail({ symbol, mkt, initialPairing = "A" }) {
  const [pairing, setPairing] = useState(initialPairing); // "A": 4H->15m, "B": 1H->5m — set from the scanner tab that was clicked
  const [chartView, setChartView] = useState("lower"); // "lower" (entry) | "higher" (bias)
  const [bars, setBars] = useState(null); // { "4h", "1h", "15m", "5m" }
  const [state, setState] = useState("loading"); // loading | ok | error

  const load = useCallback(async () => {
    setState("loading");
    try {
      let b4h, b1h, b15m, b5m;
      if (mkt === "crypto") {
        [{ bars: b4h }, { bars: b1h }, { bars: b15m }, { bars: b5m }] = await Promise.all([
          jget(`/api/klines?symbol=${symbol}&interval=4h&limit=300`),
          jget(`/api/klines?symbol=${symbol}&interval=1h&limit=300`),
          jget(`/api/klines?symbol=${symbol}&interval=15m&limit=300`),
          jget(`/api/klines?symbol=${symbol}&interval=5m&limit=300`),
        ]);
      } else {
        const f = FOREX.find((x) => x.s === symbol);
        const ysym = encodeURIComponent(f ? f.y : symbol);
        const [{ bars: raw1h }, { bars: raw15m }, { bars: raw5m }] = await Promise.all([
          jget(`/api/forex?symbol=${ysym}&range=3mo`),
          jget(`/api/forex?symbol=${ysym}&interval=15m&range=10d`),
          jget(`/api/forex?symbol=${ysym}&interval=5m&range=5d`),
        ]);
        b1h = raw1h;
        b4h = to4h(raw1h);
        b15m = raw15m;
        b5m = raw5m;
      }
      const a = analyzeMTF(symbol, mkt, b4h, b15m);
      const b = analyzeMTF(symbol, mkt, b1h, b5m);
      setBars({ "4h": b4h, "1h": b1h, "15m": b15m, "5m": b5m });
      setState(a || b ? "ok" : "error");
    } catch {
      setState("error");
    }
  }, [symbol, mkt]);

  useEffect(() => { load(); }, [load]);

  // Both pairings scored with filters left off — on a single-asset page the
  // point is to see the actual ADX/Volatility/Volume readings, not to have
  // them hide the setup. Filtering is the scanner's job.
  const results = useMemo(() => {
    if (!bars) return null;
    return {
      A: analyzeMTF(symbol, mkt, bars["4h"], bars["15m"]),
      B: analyzeMTF(symbol, mkt, bars["1h"], bars["5m"]),
    };
  }, [bars, symbol, mkt]);

  const p = PAIRINGS[pairing];
  const m = results ? results[pairing] : null;
  const idea = useMemo(() => narrative(m, p), [m, p]);
  const tvSym = tvSymbol(mkt, symbol);
  const chartTf = chartView === "lower" ? p.lower : p.higher;

  const biasClass = m && m.biasHigh === "long" ? "long" : m && m.biasHigh === "short" ? "short" : "flat";
  const biasLabel = m && m.biasHigh === "long" ? `▲ BULLISH REVERSAL (${p.higherLabel})` : m && m.biasHigh === "short" ? `▼ BEARISH REVERSAL (${p.higherLabel})` : "NO REVERSAL IN PROGRESS";

  return (
    <div className="wrap">
      <div className="detail-head">
        <Link href="/" className="back">← Back to scanner</Link>
        <div className="seg">
          <button className={pairing === "A" ? "active" : ""} onClick={() => setPairing("A")}>4H → 15m</button>
          <button className={pairing === "B" ? "active" : ""} onClick={() => setPairing("B")}>1H → 5m</button>
        </div>
        <div className="seg">
          <button className={chartView === "lower" ? "active" : ""} onClick={() => setChartView("lower")}>{p.lowerLabel} (entry)</button>
          <button className={chartView === "higher" ? "active" : ""} onClick={() => setChartView("higher")}>{p.higherLabel} (bias)</button>
        </div>
        <span className="filter-title" style={{ marginLeft: "auto" }}>{STRAT.name}</span>
        {m?.grade ? <span className={`grade ${GRADE_CLS[m.grade] || ""}`}>{m.grade}</span> : null}
      </div>

      <div className="detail-title">
        <h1>{symbol} <span className="mk">{mkt === "crypto" ? "CRYPTO" : "FOREX/GOLD"}</span></h1>
        {m && state === "ok" ? <span className={`pill ${biasClass}`}>{biasLabel}</span> : null}
        {m && state === "ok" && isPlayedOut(m) ? <PlayedOutBadge window={m.entryWindow} /> : null}
        {m && state === "ok" ? (
          <div className="price-now">
            {fmt(m.price, symbol)}{" "}
            <small style={{ color: m.chg >= 0 ? "var(--long)" : "var(--short)" }}>
              {m.chg >= 0 ? "+" : ""}{m.chg.toFixed(2)}%
            </small>
          </div>
        ) : null}
      </div>

      {state === "loading" ? <div className="notice">Loading live data for {symbol}…</div> : null}
      {state === "error" ? (
        <div className="notice">Couldn't load data for {symbol}. The source may have rate-limited — go back and retry, or check the symbol.</div>
      ) : null}

      {m && state === "ok" ? (
        <>
          <div className="chart-panel" style={{ marginBottom: 16 }}>
            <TradingViewChart symbol={tvSym} interval={TV_INTERVAL[chartTf]} studies={STUDIES} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="idea-h">{STRAT.title} — {p.title}</div>
            {isPlayedOut(m) ? (
              <div className="notice played-out-banner">
                {m.entryWindow === "tp2_hit"
                  ? "⚑ This setup already ran its full course — price hit TP1 and TP2 before this check. It's kept here for reference, not as something to act on. A new entry will only appear once a fresh Sweep → MSS → FVG chain forms."
                  : "⚑ This setup was invalidated — price traded through the stop before entry could be caught. It's dead; don't chase it. A new entry needs a fresh Sweep → MSS → FVG chain."}
              </div>
            ) : null}
            <p className="idea-text" style={{ marginBottom: 6 }}>{idea}</p>
            <a className="tv-ext" href={tvUrl(mkt, symbol, chartTf)} target="_blank" rel="noreferrer">
              Open full chart on TradingView ↗
            </a>
          </div>

          {m.quality ? (
            <div className="why-card" style={{ marginBottom: 14 }}>
              <div className="why-head">
                <span className={`grade ${GRADE_CLS[m.grade] || ""}`}>{m.grade}</span>
                <span>setup — scored {m.quality.score} of {m.quality.max}. Grades measure structural quality, not timing.</span>
              </div>
              <div className="why-list">
                {m.quality.reasons.map((why) => (
                  <div key={why.key} className={`why-row ${why.tone}`}>
                    <span className="why-mark">{why.tone === "strong" ? "✓" : why.tone === "weak" ? "✗" : "~"}</span>
                    <span className="why-label">{why.label}</span>
                    <span className="why-detail">{why.detail}</span>
                    <span className="why-score">{why.score}/{why.max}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="three-col">
            <div className="chart-panel">
              <div className="pos-head">
                <span className="lbl">Position ({p.lowerLabel}) — entry idea</span>
                {m.setupReady ? (
                  <>
                    <span className="pos-badge entry">Entry {fmt(m.entry, symbol)}</span>
                    <span className="pos-badge stop">Stop {fmt(m.stop, symbol)}</span>
                    <span className="pos-badge target">TP1 {fmt(m.tp1, symbol)}</span>
                    <span className="pos-badge target">TP2 {fmt(m.tp2, symbol)}</span>
                    {m.poi != null ? <span className="pos-badge poi">POI {fmt(m.poi, symbol)}</span> : null}
                  </>
                ) : (
                  <small style={{ color: "var(--muted)" }}>checklist not complete yet</small>
                )}
              </div>
              <PositionChart
                bars={bars ? bars[p.lower] : null}
                entry={m.entry}
                stop={m.stop}
                tp1={m.tp1}
                tp2={m.tp2}
                poi={m.poi}
                sweepLevel={m.sweepLevel}
                mssLevel={m.mssLevel}
                fvgZone={m.fvgZone}
                breaker={m.breaker}
                height={360}
              />
              <div className="chart-legend">
                <span><i className="sw" style={{ background: "var(--warn)" }} />Entry</span>
                <span><i className="sw" style={{ background: "var(--short)" }} />Stop</span>
                <span><i className="sw" style={{ background: "var(--long)" }} />TP1 (1:1) / TP2 (1:2)</span>
                <span><i className="sw" style={{ background: "#c58cff" }} />POI — next liquidity</span>
                <span><i className="sw" style={{ background: "var(--muted)" }} />Liquidity Sweep</span>
                <span><i className="sw" style={{ background: "var(--accent)" }} />MSS</span>
                <span><i className="sw" style={{ background: "rgba(76,141,255,.4)" }} />FVG zone</span>
                <span><i className="sw" style={{ background: "var(--txt)" }} />Breaker Block</span>
              </div>
            </div>

            <div className="stats-card col-half">
              <Stat label={`${p.higherLabel} Bias`} value={m.biasHigh ? (m.biasHigh === "long" ? "Bullish" : "Bearish") : "—"} cls={biasClass} />
              <Stat label={`${p.lowerLabel} Sweep`} value={m.checklist?.sweep ? "✓ confirmed" : "—"} cls={m.checklist?.sweep ? biasClass : ""} />
              <Stat label={`${p.lowerLabel} Market Structure Shift`} value={m.checklist?.mss ? "✓ confirmed" : "—"} cls={m.checklist?.mss ? biasClass : ""} />
              <Stat label={`${p.lowerLabel} / ${p.higherLabel} Aligned`} value={m.biasLow ? (m.aligned ? "✓ yes" : "✗ no") : "—"} cls={m.aligned ? biasClass : m.biasLow ? "short" : ""} />
              <Stat label={`${p.lowerLabel} Breaker Block`} value={m.breaker ? `candidate: candle ${m.breaker.index}` : "—"} />
              <Stat label={`${p.lowerLabel} Fair Value Gap`} value={m.checklist?.fvg ? "✓ found" : "—"} cls={m.checklist?.fvg ? biasClass : ""} />
              <Stat
                label={`${p.higherLabel} Trend Strength (ADX)`}
                value={m.filters?.adx?.value != null ? m.filters.adx.value.toFixed(1) : "—"}
              />
              <Stat
                label={`${p.higherLabel} Volatility (ATR%)`}
                value={m.filters?.volatility?.value != null ? `${m.filters.volatility.value.toFixed(2)}%` : "—"}
              />
              <Stat
                label={`${p.lowerLabel} MSS Candle Volume`}
                value={m.filters?.volume?.value != null ? `${m.filters.volume.value.toFixed(1)}× avg` : "— (no volume data)"}
              />
            </div>

            <div className="stats-card col-half">
              <Stat label="Entry" value={m.setupReady ? fmt(m.entry, symbol) : "—"} />
              <Stat label={`Stop (${p.lowerLabel} sweep extreme)`} value={m.setupReady ? fmt(m.stop, symbol) : "—"} cls="short" />
              <Stat label="TP1 — 1:1 (de-risk)" value={m.setupReady ? fmt(m.tp1, symbol) : "—"} cls="long" />
              <Stat label="TP2 — 1:2 (runner)" value={m.setupReady ? fmt(m.tp2, symbol) : "—"} cls="long" />
              <div className="stat">
                <div className="stat-k">POI — next {p.higherLabel} liquidity</div>
                <div className="stat-v poi-txt">
                  {m.setupReady && m.poi != null ? (
                    <>
                      {fmt(m.poi, symbol)}
                      <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--muted)", marginTop: 2 }}>
                        {m.poiR != null ? `${m.poiR.toFixed(1)}R from entry — ${m.poiBeyondTp2 ? "beyond TP2, room to run" : "before TP2, may stall"}` : ""}
                      </div>
                    </>
                  ) : m.setupReady ? <small style={{ color: "var(--muted)" }}>none unswept ahead</small> : "—"}
                </div>
              </div>
              <Stat label={`Bars since ${p.lowerLabel} MSS`} value={m.barsAgo != null ? String(m.barsAgo) : "—"} />
              <div>
                <div className="stat-k">Still catchable?</div>
                <div className="stat-v" style={{ marginTop: 5 }}>
                  {m.setupReady ? (
                    <span className={`pill ${ENTRY_WINDOW[m.entryWindow]?.cls || "flat"}`}>{ENTRY_WINDOW[m.entryWindow]?.label || "—"}</span>
                  ) : "—"}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="foot">
        <b>{STRAT.name}</b> — {STRAT.short}, entry sized to 1:2 R:R. Liquidity Sweep, MSS, and FVG are computed from the data above; Breaker Block is a candidate only — confirm it, and the overall pattern, visually before acting. ADX, Volatility and Volume are shown here purely as context: they're optional filters in the scanner and never decide whether a setup exists. The price pane is left unobstructed for reading structure, with Stochastic RSI and MACD in panes below. Exits are scaled — <b>TP1 at 1:1</b> to bank half and move the stop to break-even, <b>TP2 at 1:2</b> for the remainder — chosen over targeting the liquidity pool directly because a fixed 1R is far likelier to fill than a pool that might sit 4–5R away. The <b>POI</b> is marked as context for where price is drawn next, not as an exit.{" "}
        Educational signal simulation on live public data — <b>not financial advice</b>. Confirm on the chart before acting.
      </div>
    </div>
  );
}

function Stat({ label, value, cls }) {
  return (
    <div className="stat">
      <div className="stat-k">{label}</div>
      <div className={`stat-v ${cls ? cls + "-txt" : ""}`}>{value}</div>
    </div>
  );
}
