"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FOREX } from "@/lib/universe";
import { analyzeMTF, to4h } from "@/lib/indicators";
import { tvSymbol, TV_INTERVAL, tvUrl } from "@/lib/symbols";
import TradingViewChart from "@/components/TradingViewChart";
import PositionChart from "@/components/PositionChart";

const PLAIN_STUDIES = []; // stable reference — avoids re-mounting the chart every render

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

// Plain-English readout: 4H bias for context, 1H checklist as the entry trigger.
function narrative(m) {
  if (!m) return "";
  if (!m.bias4h) {
    return `No liquidity-sweep reversal in progress on the 4H right now — no recent sweep of a swing high/low has been followed by a structure shift. Nothing to check on 1H yet.`;
  }
  const side4h = m.bias4h === "long" ? "bullish" : "bearish";
  const parts = [`4H bias is ${side4h}: price swept a prior swing and confirmed a Market Structure Shift on the 4H.`];

  if (!m.bias1h) {
    parts.push(`1H hasn't shown a matching reversal yet — no sweep/MSS on the 1H to act on.`);
  } else if (!m.aligned) {
    parts.push(`1H has its own reversal in progress, but it's ${m.bias1h === "long" ? "bullish" : "bearish"} — opposite the 4H bias, so this isn't a valid entry trigger yet.`);
  } else if (!m.checklist?.fvg) {
    parts.push(`1H is aligned with the 4H bias (Sweep + MSS confirmed on 1H), but no Fair Value Gap has formed yet in the 1H reversal leg — no formulaic entry until one does.`);
  } else {
    parts.push(
      `1H is aligned and complete: Sweep → MSS → FVG all confirmed on the 1H, ${m.barsAgo != null ? `${m.barsAgo} bar(s) since the 1H MSS` : ""}. Entry sits mid-gap at ${fmt(m.entry, m.symbol)}, stop beyond the 1H sweep at ${fmt(m.stop, m.symbol)}, target ${fmt(m.target, m.symbol)} for a fixed 1:2 risk/reward.`
    );
  }

  if (m.breaker) {
    parts.push(`Candidate 1H Breaker Block: the candle at index ${m.breaker.index} (high ${fmt(m.breaker.high, m.symbol)}, low ${fmt(m.breaker.low, m.symbol)}) — confirm this yourself on the chart before treating it as your flip zone.`);
  }

  return parts.join(" ");
}

export default function AssetDetail({ symbol, mkt }) {
  const [chartTf, setChartTf] = useState("1h"); // which timeframe the charts display — entry (1H) or bias (4H)
  const [m, setM] = useState(null);
  const [bars4h, setBars4h] = useState(null);
  const [bars1h, setBars1h] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | error

  const load = useCallback(async () => {
    setState("loading");
    try {
      let b4h, b1h;
      if (mkt === "crypto") {
        [{ bars: b4h }, { bars: b1h }] = await Promise.all([
          jget(`/api/klines?symbol=${symbol}&interval=4h&limit=300`),
          jget(`/api/klines?symbol=${symbol}&interval=1h&limit=300`),
        ]);
      } else {
        const f = FOREX.find((x) => x.s === symbol);
        const ysym = encodeURIComponent(f ? f.y : symbol);
        const { bars: raw1h } = await jget(`/api/forex?symbol=${ysym}&range=3mo`);
        b1h = raw1h;
        b4h = to4h(raw1h);
      }
      const res = analyzeMTF(symbol, mkt, b4h, b1h);
      setM(res);
      setBars4h(b4h);
      setBars1h(b1h);
      setState(res ? "ok" : "error");
    } catch {
      setState("error");
    }
  }, [symbol, mkt]);

  useEffect(() => { load(); }, [load]);

  const idea = useMemo(() => narrative(m), [m]);
  const tvSym = tvSymbol(mkt, symbol);
  const chartBars = chartTf === "1h" ? bars1h : bars4h;

  const biasClass = m && m.bias4h === "long" ? "long" : m && m.bias4h === "short" ? "short" : "flat";
  const biasLabel = m && m.bias4h === "long" ? "▲ BULLISH REVERSAL (4H)" : m && m.bias4h === "short" ? "▼ BEARISH REVERSAL (4H)" : "NO REVERSAL IN PROGRESS";

  return (
    <div className="wrap">
      <div className="detail-head">
        <Link href="/" className="back">← Back to scanner</Link>
        <div className="seg">
          <button className={chartTf === "1h" ? "active" : ""} onClick={() => setChartTf("1h")}>1H (entry)</button>
          <button className={chartTf === "4h" ? "active" : ""} onClick={() => setChartTf("4h")}>4H (bias)</button>
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
              <div className="idea-h">Structure setup</div>
              <p className="idea-text">{idea}</p>
              <a className="tv-ext" href={tvUrl(mkt, symbol, chartTf)} target="_blank" rel="noreferrer">
                Open full chart on TradingView ↗
              </a>
            </div>
            <div className="stats-card">
              <Stat label="4H Bias" value={m.bias4h ? (m.bias4h === "long" ? "Bullish" : "Bearish") : "—"} cls={biasClass} />
              <Stat label="1H Sweep" value={m.checklist?.sweep ? "✓ confirmed" : "—"} cls={m.checklist?.sweep ? biasClass : ""} />
              <Stat label="1H Market Structure Shift" value={m.checklist?.mss ? "✓ confirmed" : "—"} cls={m.checklist?.mss ? biasClass : ""} />
              <Stat label="1H / 4H Aligned" value={m.bias1h ? (m.aligned ? "✓ yes" : "✗ no") : "—"} cls={m.aligned ? biasClass : m.bias1h ? "short" : ""} />
              <Stat label="1H Breaker Block" value={m.breaker ? `candidate: candle ${m.breaker.index}` : "—"} />
              <Stat label="1H Fair Value Gap" value={m.checklist?.fvg ? "✓ found" : "—"} cls={m.checklist?.fvg ? biasClass : ""} />
              <Stat label="Entry" value={m.setupReady ? fmt(m.entry, symbol) : "—"} />
              <Stat label="Stop (1H sweep extreme)" value={m.setupReady ? fmt(m.stop, symbol) : "—"} cls="short" />
              <Stat label="Target (1:2 R:R)" value={m.setupReady ? fmt(m.target, symbol) : "—"} cls="long" />
              <Stat label="Bars since 1H MSS" value={m.barsAgo != null ? String(m.barsAgo) : "—"} />
            </div>
          </div>

          <div className="chart-grid">
            <div className="chart-panel">
              <TradingViewChart symbol={tvSym} interval={TV_INTERVAL[chartTf]} studies={PLAIN_STUDIES} />
            </div>
            {m.setupReady ? (
              <div className="chart-panel">
                <div className="idea-h">
                  Position (1H) — entry <span className="warn-txt">{fmt(m.entry, symbol)}</span>
                  {" · "}stop <span className="short-txt">{fmt(m.stop, symbol)}</span>
                  {" · "}target <span className="long-txt">{fmt(m.target, symbol)}</span>
                </div>
                <PositionChart bars={bars1h} entry={m.entry} stop={m.stop} target={m.target} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="foot">
        Chart is plain price action on purpose — Liquidity Sweep, MSS, and FVG are computed from the data above; Breaker Block is a candidate only. Confirm the Breaker Block, and the overall pattern, visually before acting. Levels shown are sized for a fixed 1:2 risk/reward, based on the 1H entry-timeframe setup.{" "}
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
