"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FOREX } from "@/lib/universe";
import { analyze, analyzeLiquiditySweep, to4h } from "@/lib/indicators";
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

// Turn the computed analysis into a plain-English trade idea (Trend/ADX mode).
function narrative(a, tf) {
  if (!a) return "";
  const t = tf.toUpperCase();
  const vol = a.vol ? a.vol.toLowerCase() : "moderate";
  if (a.signal === 0) {
    return `On the ${t}, ${a.symbol} is not showing a clean, aligned trend right now — price and the EMAs are not stacked in one direction, or ADX (${a.adx.toFixed(0)}) is too weak to call continuation. No high-conviction setup; wait for the trend to resolve.`;
  }
  const dir = a.signal > 0 ? "uptrend" : "downtrend";
  const side = a.signal > 0 ? "long" : "short";
  const rsiNote =
    a.rsi > 70 ? "RSI is overbought — a pullback entry is safer than chasing"
    : a.rsi < 30 ? "RSI is oversold — momentum is stretched, manage risk tightly"
    : `RSI ${a.rsi.toFixed(0)} leaves room to run`;
  return `On the ${t}, ${a.symbol} is in a strong ${dir} (ADX ${a.adx.toFixed(0)}), with price on the ${side === "long" ? "upper" : "lower"} side of both EMA20 and EMA50 and the directional index confirming. Volatility is ${vol} (ATR ${a.atrPct.toFixed(2)}% of price). This is a continuation ${side} setup: enter near ${fmt(a.entry, a.symbol)}, place the stop 1.5×ATR away at ${fmt(a.stop, a.symbol)}, and target ${fmt(a.target, a.symbol)} (3×ATR) for a fixed 2:1 reward-to-risk. ${rsiNote}. The idea is invalidated on a close beyond the stop.`;
}

// Plain-English readout for Structure Setup mode (liquidity-sweep checklist).
function narrativeStructure(s, tf) {
  if (!s) return "";
  const t = tf.toUpperCase();
  if (!s.bias) {
    return `No liquidity-sweep reversal in progress on the ${t} right now — no recent sweep of a swing high/low has been followed by a structure shift. Nothing to check yet.`;
  }
  const side = s.bias === "long" ? "bullish" : "bearish";
  const sweptWhat = s.bias === "long" ? "swing low" : "swing high";
  const parts = [
    `A ${side} reversal is in progress on the ${t}: price swept a prior ${sweptWhat} (wicked through and closed back), then confirmed a Market Structure Shift ${s.barsAgo != null ? `${s.barsAgo} bar(s) ago` : ""}.`,
  ];
  if (s.checklist?.fvg) {
    parts.push(
      `A Fair Value Gap formed in the reversal leg, completing the automated checklist. Entry sits mid-gap at ${fmt(s.entry, s.symbol)}, stop beyond the sweep at ${fmt(s.stop, s.symbol)}, target ${fmt(s.target, s.symbol)} for a fixed 1:2 risk/reward.`
    );
  } else {
    parts.push(`No Fair Value Gap has formed yet in this leg — no formulaic entry until one does.`);
  }
  if (s.breaker) {
    parts.push(`Candidate Breaker Block: the candle at index ${s.breaker.index} (high ${fmt(s.breaker.high, s.symbol)}, low ${fmt(s.breaker.low, s.symbol)}) — confirm this yourself on the chart below before treating it as your flip zone.`);
  } else {
    parts.push(`No clear Breaker Block candidate was found — check the chart yourself for the right flip candle.`);
  }
  return parts.join(" ");
}

export default function AssetDetail({ symbol, mkt, tf: tf0, strategy = "trend" }) {
  const [tf, setTf] = useState(tf0 === "1h" ? "1h" : "4h");
  const [a, setA] = useState(null);
  const [s, setS] = useState(null);
  const [bars, setBars] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | error

  const loadTrend = useCallback(async () => {
    setState("loading");
    try {
      let bars0;
      if (mkt === "crypto") {
        ({ bars: bars0 } = await jget(`/api/klines?symbol=${symbol}&interval=${tf}`));
      } else {
        const f = FOREX.find((x) => x.s === symbol);
        ({ bars: bars0 } = await jget(`/api/forex?symbol=${encodeURIComponent(f ? f.y : symbol)}`));
        if (tf === "4h") bars0 = to4h(bars0);
      }
      const res = analyze(symbol, mkt, bars0);
      if (res) res.vol = res.atrPct >= (mkt === "crypto" ? 3 : 0.5) ? "High" : res.atrPct >= (mkt === "crypto" ? 1.5 : 0.25) ? "Medium" : "Low";
      setA(res);
      setBars(bars0);
      setState(res ? "ok" : "error");
    } catch {
      setState("error");
    }
  }, [symbol, mkt, tf]);

  const loadStructure = useCallback(async () => {
    setState("loading");
    try {
      let bars0;
      if (mkt === "crypto") {
        ({ bars: bars0 } = await jget(`/api/klines?symbol=${symbol}&interval=${tf}&limit=300`));
      } else {
        const f = FOREX.find((x) => x.s === symbol);
        const ysym = encodeURIComponent(f ? f.y : symbol);
        ({ bars: bars0 } = await jget(`/api/forex?symbol=${ysym}&range=3mo`));
        if (tf === "4h") bars0 = to4h(bars0);
      }
      const res = analyzeLiquiditySweep(symbol, mkt, bars0);
      setS(res);
      setBars(bars0);
      setState(res ? "ok" : "error");
    } catch {
      setState("error");
    }
  }, [symbol, mkt, tf]);

  useEffect(() => {
    if (strategy === "structure") loadStructure();
    else loadTrend();
  }, [strategy, loadTrend, loadStructure]);

  const idea = useMemo(() => (strategy === "structure" ? narrativeStructure(s, tf) : narrative(a, tf)), [strategy, s, a, tf]);
  const tvSym = tvSymbol(mkt, symbol);
  const backHref = strategy === "structure" ? `/?tf=${tf}&strategy=structure` : `/?tf=${tf}`;

  // Trend mode display bits
  const sigClass = a && a.signal > 0 ? "long" : a && a.signal < 0 ? "short" : "flat";
  const sigLabel = a && a.signal > 0 ? "▲ LONG" : a && a.signal < 0 ? "▼ SHORT" : "NO CLEAR TREND";

  // Structure mode display bits
  const biasClass = s && s.bias === "long" ? "long" : s && s.bias === "short" ? "short" : "flat";
  const biasLabel = s && s.bias === "long" ? "▲ BULLISH REVERSAL" : s && s.bias === "short" ? "▼ BEARISH REVERSAL" : "NO REVERSAL IN PROGRESS";

  const data = strategy === "structure" ? s : a;

  // Whichever mode is active, only surface a position to draw once there's an
  // actual computed entry (Trend/ADX: signal !== 0; Structure Setup: setupReady).
  const hasPosition = strategy === "structure" ? !!(s && s.setupReady) : !!(a && a.signal !== 0);
  const positionEntry = hasPosition ? data.entry : null;
  const positionStop = hasPosition ? data.stop : null;
  const positionTarget = hasPosition ? data.target : null;

  return (
    <div className="wrap">
      <div className="detail-head">
        <Link href={backHref} className="back">← Back to scanner</Link>
        <div className="seg">
          <button className={tf === "1h" ? "active" : ""} onClick={() => setTf("1h")}>1H</button>
          <button className={tf === "4h" ? "active" : ""} onClick={() => setTf("4h")}>4H</button>
        </div>
      </div>

      <div className="detail-title">
        <h1>{symbol} <span className="mk">{mkt === "crypto" ? "CRYPTO" : "FOREX/GOLD"}</span></h1>
        {strategy === "structure" ? (
          data && state === "ok" ? <span className={`pill ${biasClass}`}>{biasLabel}</span> : null
        ) : (
          data && state === "ok" ? <span className={`pill ${sigClass}`}>{sigLabel}</span> : null
        )}
        {data && state === "ok" ? (
          <div className="price-now">
            {fmt(data.price, symbol)}{" "}
            <small style={{ color: data.chg >= 0 ? "var(--long)" : "var(--short)" }}>
              {data.chg >= 0 ? "+" : ""}{data.chg.toFixed(2)}%
            </small>
          </div>
        ) : null}
      </div>

      {state === "loading" ? <div className="notice">Loading live data for {symbol}…</div> : null}
      {state === "error" ? (
        <div className="notice">Couldn't load data for {symbol}. The source may have rate-limited — go back and retry, or check the symbol.</div>
      ) : null}

      {data && state === "ok" ? (
        <>
          <div className="idea-grid">
            <div className="idea-card">
              <div className="idea-h">{strategy === "structure" ? "Structure setup" : "Trade idea"}</div>
              <p className="idea-text">{idea}</p>
              <a className="tv-ext" href={tvUrl(mkt, symbol, tf)} target="_blank" rel="noreferrer">
                Open full chart on TradingView ↗
              </a>
            </div>
            {strategy === "structure" ? (
              <div className="stats-card">
                <Stat label="Bias" value={s.bias ? (s.bias === "long" ? "Bullish" : "Bearish") : "—"} cls={biasClass} />
                <Stat label="Liquidity Sweep" value={s.checklist?.sweep ? "✓ confirmed" : "—"} cls={s.checklist?.sweep ? biasClass : ""} />
                <Stat label="Market Structure Shift" value={s.checklist?.mss ? "✓ confirmed" : "—"} cls={s.checklist?.mss ? biasClass : ""} />
                <Stat label="Breaker Block" value={s.breaker ? `candidate: candle ${s.breaker.index}` : "—"} />
                <Stat label="Fair Value Gap" value={s.checklist?.fvg ? "✓ found" : "—"} cls={s.checklist?.fvg ? biasClass : ""} />
                <Stat label="Entry" value={s.setupReady ? fmt(s.entry, symbol) : "—"} />
                <Stat label="Stop (sweep extreme)" value={s.setupReady ? fmt(s.stop, symbol) : "—"} cls="short" />
                <Stat label="Target (1:2 R:R)" value={s.setupReady ? fmt(s.target, symbol) : "—"} cls="long" />
                <Stat label="Reward : Risk" value={s.setupReady ? "2 : 1" : "—"} />
                <Stat label="Bars since MSS" value={s.barsAgo != null ? String(s.barsAgo) : "—"} />
              </div>
            ) : (
              <div className="stats-card">
                <Stat label="Direction" value={a.signal === 0 ? "—" : a.signal > 0 ? "Long" : "Short"} cls={sigClass} />
                <Stat label="Entry" value={a.signal === 0 ? "—" : fmt(a.entry, symbol)} />
                <Stat label="Stop (1.5×ATR)" value={a.signal === 0 ? "—" : fmt(a.stop, symbol)} cls="short" />
                <Stat label="Target (3×ATR)" value={a.signal === 0 ? "—" : fmt(a.target, symbol)} cls="long" />
                <Stat label="Reward : Risk" value={a.signal === 0 ? "—" : `${a.rr.toFixed(1)} : 1`} />
                <Stat label="Trend strength (ADX)" value={a.adx.toFixed(1)} />
                <Stat label="Volatility (ATR%)" value={`${a.atrPct.toFixed(2)}% · ${a.vol}`} />
                <Stat label="RSI(14)" value={a.rsi.toFixed(0)} />
              </div>
            )}
          </div>

          <div className="chart-grid">
            <div className="chart-panel">
              <TradingViewChart symbol={tvSym} interval={TV_INTERVAL[tf]} studies={strategy === "structure" ? PLAIN_STUDIES : undefined} />
            </div>
            {positionEntry != null ? (
              <div className="chart-panel">
                <div className="idea-h">
                  Position — entry <span className="warn-txt">{fmt(positionEntry, symbol)}</span>
                  {" · "}stop <span className="short-txt">{fmt(positionStop, symbol)}</span>
                  {" · "}target <span className="long-txt">{fmt(positionTarget, symbol)}</span>
                </div>
                <PositionChart bars={bars} entry={positionEntry} stop={positionStop} target={positionTarget} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="foot">
        {strategy === "structure" ? (
          <>Chart is plain price action on purpose — Liquidity Sweep, MSS, and FVG are computed from the data above; Breaker Block is a candidate only. Confirm the Breaker Block, and the overall pattern, visually before acting. Levels shown are sized for a fixed 1:2 risk/reward.</>
        ) : (
          <>Levels are ATR-based (stop 1.5×ATR, target 3×ATR ⇒ 2:1).</>
        )}{" "}
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
