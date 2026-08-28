"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FOREX } from "@/lib/universe";
import { analyzeMTF, to4h } from "@/lib/indicators";
import { tvSymbol, TV_INTERVAL, tvUrl } from "@/lib/symbols";
import TradingViewChart from "@/components/TradingViewChart";
import PositionChart from "@/components/PositionChart";

const PLAIN_STUDIES = []; // stable reference — avoids re-mounting the chart every render

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
    const targetNote = m.targetSource === "poi"
      ? `target ${fmt(m.target, m.symbol)} at the next unswept swing (POI) on the ${p.higherLabel}`
      : `target ${fmt(m.target, m.symbol)} (no clear ${p.higherLabel} POI ahead yet, so this falls back to a fixed 1:2 risk/reward)`;
    parts.push(
      `${p.lowerLabel} is aligned and complete: Sweep → MSS → FVG all confirmed, ${m.barsAgo != null ? `${m.barsAgo} bar(s) since the ${p.lowerLabel} MSS` : ""}. Entry sits mid-gap at ${fmt(m.entry, m.symbol)}, stop beyond the ${p.lowerLabel} sweep at ${fmt(m.stop, m.symbol)}, ${targetNote} — a ${m.rr.toFixed(1)}:1 reward-to-risk.`
    );
  }

  if (m.breaker) {
    parts.push(`Candidate ${p.lowerLabel} Breaker Block: the candle at index ${m.breaker.index} (high ${fmt(m.breaker.high, m.symbol)}, low ${fmt(m.breaker.low, m.symbol)}) — confirm this yourself on the chart before treating it as your flip zone.`);
  }

  return parts.join(" ");
}

export default function AssetDetail({ symbol, mkt }) {
  const [pairing, setPairing] = useState("A"); // "A": 4H->15m, "B": 1H->5m
  const [chartView, setChartView] = useState("lower"); // "lower" (entry) | "higher" (bias)
  const [results, setResults] = useState(null); // { A: {...}, B: {...} }
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
      setResults({ A: a, B: b });
      setBars({ "4h": b4h, "1h": b1h, "15m": b15m, "5m": b5m });
      setState(a || b ? "ok" : "error");
    } catch {
      setState("error");
    }
  }, [symbol, mkt]);

  useEffect(() => { load(); }, [load]);

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
      </div>

      <div className="detail-title">
        <h1>{symbol} <span className="mk">{mkt === "crypto" ? "CRYPTO" : "FOREX/GOLD"}</span></h1>
        {m && state === "ok" ? <span className={`pill ${biasClass}`}>{biasLabel}</span> : null}
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
          <div className="idea-grid">
            <div className="idea-card">
              <div className="idea-h">Structure setup — {p.title}</div>
              <p className="idea-text">{idea}</p>
              <a className="tv-ext" href={tvUrl(mkt, symbol, chartTf)} target="_blank" rel="noreferrer">
                Open full chart on TradingView ↗
              </a>
            </div>
            <div className="stats-card">
              <Stat label={`${p.higherLabel} Bias`} value={m.biasHigh ? (m.biasHigh === "long" ? "Bullish" : "Bearish") : "—"} cls={biasClass} />
              <Stat label={`${p.lowerLabel} Sweep`} value={m.checklist?.sweep ? "✓ confirmed" : "—"} cls={m.checklist?.sweep ? biasClass : ""} />
              <Stat label={`${p.lowerLabel} Market Structure Shift`} value={m.checklist?.mss ? "✓ confirmed" : "—"} cls={m.checklist?.mss ? biasClass : ""} />
              <Stat label={`${p.lowerLabel} / ${p.higherLabel} Aligned`} value={m.biasLow ? (m.aligned ? "✓ yes" : "✗ no") : "—"} cls={m.aligned ? biasClass : m.biasLow ? "short" : ""} />
              <Stat label={`${p.lowerLabel} Breaker Block`} value={m.breaker ? `candidate: candle ${m.breaker.index}` : "—"} />
              <Stat label={`${p.lowerLabel} Fair Value Gap`} value={m.checklist?.fvg ? "✓ found" : "—"} cls={m.checklist?.fvg ? biasClass : ""} />
              <Stat label="Entry" value={m.setupReady ? fmt(m.entry, symbol) : "—"} />
              <Stat label={`Stop (${p.lowerLabel} sweep extreme)`} value={m.setupReady ? fmt(m.stop, symbol) : "—"} cls="short" />
              <Stat label={`Target (${m.targetSource === "poi" ? `${p.higherLabel} POI` : "fixed 1:2"})`} value={m.setupReady ? fmt(m.target, symbol) : "—"} cls="long" />
              <Stat label="Reward : Risk" value={m.setupReady ? `${m.rr.toFixed(1)} : 1` : "—"} />
              <Stat label={`Bars since ${p.lowerLabel} MSS`} value={m.barsAgo != null ? String(m.barsAgo) : "—"} />
            </div>
          </div>

          <div className="chart-grid">
            <div className="chart-panel">
              <TradingViewChart symbol={tvSym} interval={TV_INTERVAL[chartTf]} studies={PLAIN_STUDIES} />
            </div>
            {m.setupReady ? (
              <div className="chart-panel">
                <div className="idea-h">
                  Position ({p.lowerLabel}) — entry <span className="warn-txt">{fmt(m.entry, symbol)}</span>
                  {" · "}stop <span className="short-txt">{fmt(m.stop, symbol)}</span>
                  {" · "}target <span className="long-txt">{fmt(m.target, symbol)}</span>
                </div>
                <PositionChart bars={bars ? bars[p.lower] : null} entry={m.entry} stop={m.stop} target={m.target} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="foot">
        Chart is plain price action on purpose — Liquidity Sweep, MSS, and FVG are computed from the data above; Breaker Block is a candidate only. Confirm the Breaker Block, and the overall pattern, visually before acting. Target is the next unswept swing on the {p.higherLabel} ahead of price, or a fixed 1:2 risk/reward when no such level exists yet.{" "}
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
