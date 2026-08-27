"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FOREX } from "@/lib/universe";
import { analyze, analyzeStructure, to4h } from "@/lib/indicators";
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

// Plain-English readout for Structure Setup mode.
function narrativeStructure(s, tf) {
  if (!s) return "";
  const t = tf.toUpperCase();
  const bits = [];

  if (s.contDir) {
    const side = s.contDir === "long" ? "long" : "short";
    bits.push(
      `Continuation entry: EMA50 crossed ${s.contDir === "long" ? "above" : "below"} EMA200 on the ${t}, and the Daily trend bias agrees (${s.dailyBias}). This is a mechanical ${side} entry near ${fmt(s.entry, s.symbol)}, stop ${fmt(s.stop, s.symbol)} (1.5×ATR), target ${fmt(s.target, s.symbol)} (3×ATR) for 2:1 reward-to-risk.`
    );
  } else if (s.emaCrossDir) {
    bits.push(
      `EMA50/EMA200 crossed ${s.emaCrossDir} on the ${t} just now, but the Daily bias (${s.dailyBias || "flat"}) doesn't agree yet — no continuation entry until it does.`
    );
  } else {
    bits.push(`No EMA50/EMA200 cross on the ${t} right now. Daily bias currently reads ${s.dailyBias || "flat"}.`);
  }

  if (s.reversalDir) {
    bits.push(
      `Reversal confirmation: RSI(30) just crossed ${s.reversalDir === "long" ? "above" : "below"} 50 on the ${t}. Treat this only as confirmation — first verify a break of structure, a sweep of liquidity beyond the prior swing ${s.reversalDir === "long" ? "low" : "high"}, and a change of character (ChoCH) reversing it, on the chart below. If that pattern is there, your entry/stop are placed relative to the sweep and ChoCH candle, not formulaic.`
    );
  } else {
    bits.push(`RSI(30) is at ${s.rsi30 != null ? s.rsi30.toFixed(0) : "—"} — no fresh cross of the 50 midline on the ${t} this bar.`);
  }

  return bits.join(" ");
}

export default function AssetDetail({ symbol, mkt, tf: tf0, strategy = "trend" }) {
  const [tf, setTf] = useState(tf0 === "1h" ? "1h" : "4h");
  const [a, setA] = useState(null);
  const [s, setS] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | error

  const loadTrend = useCallback(async () => {
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
      if (res) res.vol = res.atrPct >= (mkt === "crypto" ? 3 : 0.5) ? "High" : res.atrPct >= (mkt === "crypto" ? 1.5 : 0.25) ? "Medium" : "Low";
      setA(res);
      setState(res ? "ok" : "error");
    } catch {
      setState("error");
    }
  }, [symbol, mkt, tf]);

  const loadStructure = useCallback(async () => {
    setState("loading");
    try {
      let entryBars, dailyBars;
      if (mkt === "crypto") {
        [{ bars: entryBars }, { bars: dailyBars }] = await Promise.all([
          jget(`/api/klines?symbol=${symbol}&interval=${tf}&limit=500`),
          jget(`/api/klines?symbol=${symbol}&interval=1d&limit=500`),
        ]);
      } else {
        const f = FOREX.find((x) => x.s === symbol);
        const ysym = encodeURIComponent(f ? f.y : symbol);
        const [{ bars: raw }, daily] = await Promise.all([
          jget(`/api/forex?symbol=${ysym}&range=3mo`),
          jget(`/api/forex?symbol=${ysym}&interval=1d`),
        ]);
        entryBars = tf === "4h" ? to4h(raw) : raw;
        dailyBars = daily.bars;
      }
      const res = analyzeStructure(symbol, mkt, entryBars, dailyBars);
      setS(res);
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
  const contClass = s && s.contDir === "long" ? "long" : s && s.contDir === "short" ? "short" : "flat";
  const contLabel = s && s.contDir === "long" ? "▲ LONG (continuation)" : s && s.contDir === "short" ? "▼ SHORT (continuation)" : "NO CONTINUATION ENTRY";

  const data = strategy === "structure" ? s : a;

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
          data && state === "ok" ? <span className={`pill ${contClass}`}>{contLabel}</span> : null
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
                <Stat label="Daily Bias" value={s.dailyBias ? s.dailyBias.toUpperCase() : "—"} cls={s.dailyBias === "up" ? "long" : s.dailyBias === "down" ? "short" : ""} />
                <Stat label={`EMA50/200 Cross (${tf.toUpperCase()})`} value={s.emaCrossDir ? (s.emaCrossDir === "up" ? "▲ up" : "▼ down") : "—"} />
                <Stat label="Continuation Entry" value={s.contDir ? (s.contDir === "long" ? "Long" : "Short") : "—"} cls={contClass} />
                <Stat label="Entry" value={s.contDir ? fmt(s.entry, symbol) : "—"} />
                <Stat label="Stop (1.5×ATR)" value={s.contDir ? fmt(s.stop, symbol) : "—"} cls="short" />
                <Stat label="Target (3×ATR)" value={s.contDir ? fmt(s.target, symbol) : "—"} cls="long" />
                <Stat label="Reward : Risk" value={s.contDir ? `${s.rr.toFixed(1)} : 1` : "—"} />
                <Stat label={`RSI(30) — ${tf.toUpperCase()}`} value={s.rsi30 != null ? s.rsi30.toFixed(0) : "—"} />
                <Stat label="Reversal Confirm" value={s.reversalDir ? (s.reversalDir === "long" ? "Bull cross 50" : "Bear cross 50") : "—"} cls={s.reversalDir === "long" ? "long" : s.reversalDir === "short" ? "short" : ""} />
                <Stat label="Volatility (ATR%)" value={`${s.atrPct.toFixed(2)}%`} />
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

          <div className="chart-panel">
            <TradingViewChart symbol={tvSym} interval={TV_INTERVAL[tf]} />
          </div>
        </>
      ) : null}

      <div className="foot">
        {strategy === "structure" ? (
          <>Chart has EMA50, EMA200, and RSI(30) added — use it to confirm BOS, liquidity sweep, and ChoCH yourself before acting on a Reversal Confirm signal. Continuation Entry levels are ATR-based (stop 1.5×ATR, target 3×ATR ⇒ 2:1).</>
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
