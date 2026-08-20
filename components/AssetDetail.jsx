"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FOREX } from "@/lib/universe";
import { analyze, to4h } from "@/lib/indicators";
import { tvSymbol, TV_INTERVAL, tvUrl } from "@/lib/symbols";
import TradingViewChart from "@/components/TradingViewChart";

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

// Turn the computed analysis into a plain-English trade idea.
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

export default function AssetDetail({ symbol, mkt, tf: tf0 }) {
  const [tf, setTf] = useState(tf0 === "1h" ? "1h" : "4h");
  const [a, setA] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | error

  const load = useCallback(async () => {
    setState("loading");
    try {
      let bars;
      if (mkt === "crypto") {
        ({ bars } = await jget(`/api/klines?symbol=${symbol}&interval=${tf}`));
      } else {
        const f = FOREX.find((x) => x.s === symbol);
        ({ bars } = await jget(`/api/forex?symbol=${encodeURIComponent(f ? f.y : symbol)}`));
        if (tf === "4h") bars = to4h(bars);
      }
      const res = analyze(symbol, mkt, bars);
      // volatility label relative to a simple absolute scale (single-asset view)
      if (res) res.vol = res.atrPct >= (mkt === "crypto" ? 3 : 0.5) ? "High" : res.atrPct >= (mkt === "crypto" ? 1.5 : 0.25) ? "Medium" : "Low";
      setA(res);
      setState(res ? "ok" : "error");
    } catch {
      setState("error");
    }
  }, [symbol, mkt, tf]);

  useEffect(() => { load(); }, [load]);

  const idea = useMemo(() => narrative(a, tf), [a, tf]);
  const tvSym = tvSymbol(mkt, symbol);
  const sigClass = a && a.signal > 0 ? "long" : a && a.signal < 0 ? "short" : "flat";
  const sigLabel = a && a.signal > 0 ? "▲ LONG" : a && a.signal < 0 ? "▼ SHORT" : "NO CLEAR TREND";

  return (
    <div className="wrap">
      <div className="detail-head">
        <Link href={`/?tf=${tf}`} className="back">← Back to scanner</Link>
        <div className="seg">
          <button className={tf === "1h" ? "active" : ""} onClick={() => setTf("1h")}>1H</button>
          <button className={tf === "4h" ? "active" : ""} onClick={() => setTf("4h")}>4H</button>
        </div>
      </div>

      <div className="detail-title">
        <h1>{symbol} <span className="mk">{mkt === "crypto" ? "CRYPTO" : "FOREX/GOLD"}</span></h1>
        {a && state === "ok" ? <span className={`pill ${sigClass}`}>{sigLabel}</span> : null}
        {a && state === "ok" ? (
          <div className="price-now">
            {fmt(a.price, symbol)}{" "}
            <small style={{ color: a.chg >= 0 ? "var(--long)" : "var(--short)" }}>
              {a.chg >= 0 ? "+" : ""}{a.chg.toFixed(2)}%
            </small>
          </div>
        ) : null}
      </div>

      {state === "loading" ? <div className="notice">Loading live data for {symbol}…</div> : null}
      {state === "error" ? (
        <div className="notice">Couldn't load data for {symbol}. The source may have rate-limited — go back and retry, or check the symbol.</div>
      ) : null}

      {a && state === "ok" ? (
        <>
          <div className="idea-grid">
            <div className="idea-card">
              <div className="idea-h">Trade idea</div>
              <p className="idea-text">{idea}</p>
              <a className="tv-ext" href={tvUrl(mkt, symbol, tf)} target="_blank" rel="noreferrer">
                Open full chart on TradingView ↗
              </a>
            </div>
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
          </div>

          <div className="chart-panel">
            <TradingViewChart symbol={tvSym} interval={TV_INTERVAL[tf]} />
          </div>
        </>
      ) : null}

      <div className="foot">
        Levels are ATR-based (stop 1.5×ATR, target 3×ATR ⇒ 2:1). Educational signal simulation on live public data —
        <b> not financial advice</b>. Confirm on the chart before acting.
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
