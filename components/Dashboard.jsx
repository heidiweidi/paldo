"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CRYPTO, FOREX } from "@/lib/universe";
import { analyzeMTF, to4h } from "@/lib/indicators";
import PositionChart from "@/components/PositionChart";

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
  in_zone: { cls: "long", label: "✓ In zone" },
  running: { cls: "warn", label: "Running — past entry" },
  reached: { cls: "flat", label: "Target reached" },
  invalidated: { cls: "short", label: "✗ Invalidated" },
};
function EntryWindowPill({ status }) {
  const w = ENTRY_WINDOW[status];
  if (!w) return <span className="pill flat">—</span>;
  return <span className={`pill ${w.cls}`}>{w.label}</span>;
}

const PAIRING_TABS = {
  A: { label: "4H → 15m", title: "4H Bias → 15m Entry", higherLabel: "4H", lowerLabel: "15m" },
  B: { label: "1H → 5m", title: "1H Bias → 5m Entry", higherLabel: "1H", lowerLabel: "5m" },
};

const ADX_MAX = 50;

export default function Dashboard() {
  const [mkt, setMkt] = useState("all");
  const [onlySignals, setOnlySignals] = useState(true);
  const [pairing, setPairing] = useState("A"); // which timeframe pairing's table is shown
  const [adxMin, setAdxMin] = useState(0); // adjustable ADX confluence threshold, 0 = filter effectively off
  // Raw bars per symbol — kept separate from analysis so moving the ADX
  // slider re-scores instantly against already-fetched data instead of
  // re-hitting Binance/Yahoo (and risking rate limits) on every drag.
  const [barsMap, setBarsMap] = useState([]); // [{ sym, mkt, b4h, b1h, b15m, b5m }]
  const [lastUpdated, setLastUpdated] = useState(null);
  const [status, setStatus] = useState("Loading live data…");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  // Structure Setup scanner — ICT/SMC liquidity-sweep checklist, run as two
  // independent higher-timeframe/entry-timeframe pairings side by side:
  //   Pairing A: 4H bias -> 15m entry
  //   Pairing B: 1H bias -> 5m entry
  // Each pairing sets its bias on the higher TF (Sweep -> MSS), then looks for
  // its own Sweep -> MSS -> FVG on the entry TF. Target is the next unswept
  // opposing swing (POI) on the higher TF, falling back to a fixed 1:2 R:R.
  const scan = useCallback(async () => {
    setLoading(true);
    setNotice("");
    const fails = [];
    let done = 0;
    const total = CRYPTO.length + FOREX.length;
    const tick = () => setStatus(`Scanning ${done}/${total}…`);
    tick();
    const collected = [];

    await Promise.all(
      CRYPTO.map(async (sym) => {
        try {
          const [{ bars: b4h }, { bars: b1h }, { bars: b15m }, { bars: b5m }] = await Promise.all([
            jget(`/api/klines?symbol=${sym}&interval=4h&limit=300`),
            jget(`/api/klines?symbol=${sym}&interval=1h&limit=300`),
            jget(`/api/klines?symbol=${sym}&interval=15m&limit=300`),
            jget(`/api/klines?symbol=${sym}&interval=5m&limit=300`),
          ]);
          collected.push({ sym, mkt: "crypto", b4h, b1h, b15m, b5m });
        } catch {
          fails.push(sym);
        } finally {
          done++; tick();
        }
      })
    );

    await Promise.all(
      FOREX.map(async (o) => {
        try {
          const [{ bars: raw1h }, { bars: b15m }, { bars: b5m }] = await Promise.all([
            jget(`/api/forex?symbol=${encodeURIComponent(o.y)}&range=3mo`),
            jget(`/api/forex?symbol=${encodeURIComponent(o.y)}&interval=15m&range=10d`),
            jget(`/api/forex?symbol=${encodeURIComponent(o.y)}&interval=5m&range=5d`),
          ]);
          const b4h = to4h(raw1h);
          collected.push({ sym: o.s, mkt: "forex", b4h, b1h: raw1h, b15m, b5m });
        } catch {
          fails.push(o.s);
        } finally {
          done++; tick();
        }
      })
    );

    setBarsMap(collected);
    setLastUpdated(new Date());
    if (fails.length) {
      setNotice(
        `Couldn't load ${fails.length} symbol(s): ${fails.join(", ")}. The market source may have rate-limited momentarily — press Scan to retry.`
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { scan(); }, [scan]);

  // Re-scored from barsMap whenever the ADX threshold changes — no re-fetch.
  const rowsA = useMemo(
    () => barsMap.map((x) => analyzeMTF(x.sym, x.mkt, x.b4h, x.b15m, adxMin)).filter(Boolean),
    [barsMap, adxMin]
  );
  const rowsB = useMemo(
    () => barsMap.map((x) => analyzeMTF(x.sym, x.mkt, x.b1h, x.b5m, adxMin)).filter(Boolean),
    [barsMap, adxMin]
  );
  const readyCount = useMemo(
    () => rowsA.filter((r) => r.setupReady).length + rowsB.filter((r) => r.setupReady).length,
    [rowsA, rowsB]
  );
  // Lookup so an expanded row can pull its own entry-timeframe candles for
  // the position chart, without re-fetching — barsMap already has them.
  const barsBySymbol = useMemo(() => {
    const map = {};
    for (const x of barsMap) map[x.sym] = x;
    return map;
  }, [barsMap]);
  const statusLine = lastUpdated
    ? `Updated ${lastUpdated.toLocaleString()} · ${barsMap.length} assets · ${readyCount} ready setups`
    : status;

  return (
    <div className="wrap">
      <div className="controls">
        <div className="seg">
          {["all", "crypto", "forex"].map((m) => (
            <button key={m} className={mkt === m ? "active" : ""} onClick={() => setMkt(m)}>
              {m === "all" ? "All" : m === "crypto" ? "Crypto" : "Forex/Gold"}
            </button>
          ))}
        </div>
        <label className="ck">
          <input type="checkbox" checked={onlySignals} onChange={(e) => setOnlySignals(e.target.checked)} />
          Signals only
        </label>
        <label className="ck" style={{ gap: 8 }}>
          ADX filter &gt; {adxMin}
          <input
            type="range"
            min={0}
            max={ADX_MAX}
            step={1}
            value={adxMin}
            onChange={(e) => setAdxMin(Number(e.target.value))}
            style={{ width: 140 }}
          />
        </label>
        <button className="btn primary" onClick={scan} disabled={loading}>
          {loading ? "Scanning…" : "↻ Scan"}
        </button>
        <div className="statusline">{statusLine}</div>
      </div>

      {notice ? <div className="notice">⚠ {notice}</div> : null}

      <div className="notice" style={{ marginBottom: 12 }}>
        ⚠ Checklist: <b>Liquidity Sweep</b> → <b>Market Structure Shift (MSS)</b> → <b>Breaker Block</b> → <b>Fair Value Gap (FVG)</b>, confirmed with <b>ADX(14) &gt; {adxMin}</b> on the bias timeframe (trending, not choppy — adjust the slider above, 0–{ADX_MAX}). Volume on the MSS candle is still measured and shown (expand a row to see it) but no longer required to flag a setup — it was screening out too many otherwise-valid setups. Two parallel pairings, higher timeframe for bias / lower timeframe for the entry trigger — pick a tab below. Target is the next unswept swing (POI) on the <i>higher</i> timeframe ahead of price, falling back to a fixed 1:2 if none exists yet. <b>Breaker Block is never automated</b> — confirm it yourself on the plain price chart before entering. Click a row's arrow to expand full details; click the symbol to open its chart in a new tab.
      </div>

      <div className="seg" style={{ marginBottom: 14 }}>
        {Object.entries(PAIRING_TABS).map(([key, t]) => (
          <button key={key} className={pairing === key ? "active" : ""} onClick={() => setPairing(key)}>
            {t.label}
          </button>
        ))}
      </div>

      <PairingSection
        pairingKey={pairing}
        title={PAIRING_TABS[pairing].title}
        rows={pairing === "A" ? rowsA : rowsB}
        mkt={mkt}
        onlySignals={onlySignals}
        loading={loading}
        higherLabel={PAIRING_TABS[pairing].higherLabel}
        lowerLabel={PAIRING_TABS[pairing].lowerLabel}
        barsBySymbol={barsBySymbol}
        lowerKey={pairing === "A" ? "b15m" : "b5m"}
      />

      <div className="foot">
        <b>How to read it:</b> The table shows Asset, Price, Chg%, Bias, Entry, Stop, and Target to avoid horizontal scrolling — expand a row (▸) for the full breakdown: the annotated Position chart, the Sweep/MSS/Breaker/FVG checklist, ADX, MSS-candle volume, R:R, bars since MSS, and Still catchable. <b>Bias</b> is the higher-timeframe reversal direction (a sweep followed by a structure shift). The lower-timeframe Sweep/MSS/FVG columns are the entry-trigger checklist, detected independently. A row only shows Entry/Stop/Target once the lower-TF checklist completes, agrees with the higher-TF bias, <i>and</i> ADX &gt; your slider threshold — lower the ADX slider toward 0 to see more candidates, raise it to demand a stronger trend. Volume is shown for context only and no longer blocks a setup. Entry is the middle of the lower-TF Fair Value Gap, stop is the lower-TF sweep candle's wick extreme, target is the next unswept opposing swing on the <i>higher</i> TF (or a fixed 1:2 if none exists yet — shown in the expanded R:R). Breaker Block is always a candidate to check yourself, never auto-confirmed. <b>Still catchable?</b> compares the current price to entry/stop/target, not just bar count: <b>In zone</b> means price has pulled back to the gap — this is your window; <b>Running</b> means price never pulled back and is already headed to target — chasing it now is worse risk/reward than planned; <b>Target reached</b> or <b>Invalidated</b> mean the move has already played out one way or the other.
        <br /><br />
        <b>Disclaimer:</b> Educational signal simulation on live public data — not financial advice. Verify every level on your own charts before acting. Crypto data via Binance, forex/gold via Yahoo Finance, proxied through this site's edge API.
      </div>
    </div>
  );
}

function PairingSection({ pairingKey, title, rows, mkt, onlySignals, loading, higherLabel, lowerLabel, barsBySymbol, lowerKey }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleRow = (sym) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym); else next.add(sym);
      return next;
    });
  };

  const view = useMemo(() => {
    let r = rows.slice();
    if (mkt !== "all") r = r.filter((x) => x.mkt === mkt);
    if (onlySignals) r = r.filter((x) => x.aligned);
    r.sort((a, b) => {
      const av = (a.setupReady ? 2 : 0) + (a.aligned ? 1 : 0);
      const bv = (b.setupReady ? 2 : 0) + (b.aligned ? 1 : 0);
      if (bv !== av) return bv - av;
      return (a.barsAgo ?? 999) - (b.barsAgo ?? 999);
    });
    return r;
  }, [rows, mkt, onlySignals]);

  const cards = useMemo(() => {
    const scoped = rows.filter((r) => mkt === "all" || r.mkt === mkt);
    const aligned = scoped.filter((r) => r.aligned);
    const ready = scoped.filter((r) => r.setupReady);
    return {
      alignedLongs: aligned.filter((r) => r.biasLow === "long").length,
      alignedShorts: aligned.filter((r) => r.biasLow === "short").length,
      readyLongs: ready.filter((r) => r.biasLow === "long").length,
      readyShorts: ready.filter((r) => r.biasLow === "short").length,
    };
  }, [rows, mkt]);

  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>{title}</h2>

      <div className="cards">
        <div className="card"><div className="k">{higherLabel}/{lowerLabel} aligned</div><div className="v"><span style={{ color: "var(--long)" }}>{cards.alignedLongs}</span> / <span style={{ color: "var(--short)" }}>{cards.alignedShorts}</span> <small>bull/bear</small></div></div>
        <div className="card"><div className="k">Ready setups (+ FVG)</div><div className="v"><span style={{ color: "var(--long)" }}>{cards.readyLongs}</span> / <span style={{ color: "var(--short)" }}>{cards.readyShorts}</span> <small>bull/bear</small></div></div>
        <div className="card"><div className="k">Bias / Entry timeframe</div><div className="v">{higherLabel} <small>/ {lowerLabel}</small></div></div>
        <div className="card"><div className="k">Assets scanned</div><div className="v">{rows.length}</div></div>
      </div>

      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Asset</th>
              <th>Price</th>
              <th>Chg%</th>
              <th>{higherLabel} Bias</th>
              <th>Entry</th>
              <th>Stop</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr><td colSpan={8} className="empty">{loading ? "Loading…" : "No rows match the current filters."}</td></tr>
            ) : (
              view.map((r) => {
                const biasCls = r.biasHigh === "long" ? "up" : r.biasHigh === "short" ? "down" : "no";
                const isOpen = expanded.has(r.symbol);
                return (
                  <RowGroup
                    key={r.symbol}
                    r={r}
                    pairingKey={pairingKey}
                    higherLabel={higherLabel}
                    lowerLabel={lowerLabel}
                    biasCls={biasCls}
                    isOpen={isOpen}
                    onToggle={() => toggleRow(r.symbol)}
                    lowerBars={barsBySymbol?.[r.symbol]?.[lowerKey] ?? null}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowGroup({ r, pairingKey, higherLabel, lowerLabel, biasCls, isOpen, onToggle, lowerBars }) {
  const ck = (v) => (v ? <span className="pill long">✓</span> : <span className="pill flat">—</span>);
  return (
    <>
      <tr>
        <td>
          <button
            className="btn"
            style={{ padding: "2px 7px", fontSize: 12, lineHeight: 1 }}
            onClick={onToggle}
            aria-label={isOpen ? "Collapse details" : "Expand details"}
            title={isOpen ? "Collapse details" : "Expand details"}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        </td>
        <td className="left">
          <span className={`dot ${biasCls}`} />
          <a
            className="sym-link"
            href={`/asset/${r.symbol}?mkt=${r.mkt}&pairing=${pairingKey}&adxMin=${r.confluence?.adx?.threshold ?? 0}`}
            title={`Open ${r.symbol} structure setup & chart`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="sym">{r.symbol}</span>
            <span className="open-ico">↗</span>
          </a>
          <span className="mk">{r.mkt === "crypto" ? "CRYPTO" : "FX"}</span>
        </td>
        <td className="num">{fmt(r.price, r.symbol)}</td>
        <td className="num" style={{ color: r.chg >= 0 ? "var(--long)" : "var(--short)" }}>{r.chg >= 0 ? "+" : ""}{r.chg.toFixed(2)}%</td>
        <td>
          {r.biasHigh === "long" ? <span className="pill long">▲ BULL</span>
            : r.biasHigh === "short" ? <span className="pill short">▼ BEAR</span>
            : <span className="pill flat">—</span>}
        </td>
        <td className="num">{r.setupReady ? fmt(r.entry, r.symbol) : "—"}</td>
        <td className="num" style={{ color: "var(--short)" }}>{r.setupReady ? fmt(r.stop, r.symbol) : "—"}</td>
        <td className="num" style={{ color: "var(--long)" }}>{r.setupReady ? `${fmt(r.target, r.symbol)}${r.targetSource === "poi" ? " (POI)" : ""}` : "—"}</td>
      </tr>
      {isOpen ? (
        <tr className="expand-row">
          <td></td>
          <td colSpan={7} style={{ whiteSpace: "normal", verticalAlign: "top" }}>
            <div className="three-col" style={{ padding: "8px 0 14px" }}>
              <div className="chart-panel" style={{ margin: 0 }}>
                <div className="pos-head">
                  <span className="lbl">Position ({lowerLabel}) — entry idea</span>
                  {r.setupReady ? (
                    <>
                      <span className="pos-badge entry">Entry {fmt(r.entry, r.symbol)}</span>
                      <span className="pos-badge stop">Stop {fmt(r.stop, r.symbol)}</span>
                      <span className="pos-badge target">Target {fmt(r.target, r.symbol)}</span>
                    </>
                  ) : (
                    <small style={{ color: "var(--muted)" }}>checklist not complete yet</small>
                  )}
                </div>
                {lowerBars ? (
                  <PositionChart
                    bars={lowerBars}
                    entry={r.entry}
                    stop={r.stop}
                    target={r.target}
                    sweepLevel={r.sweepLevel}
                    mssLevel={r.mssLevel}
                    fvgZone={r.fvgZone}
                    breaker={r.breaker}
                    height={240}
                  />
                ) : (
                  <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading chart…</div>
                )}
                <div className="chart-legend">
                  <span><i className="sw" style={{ background: "var(--warn)" }} />Entry</span>
                  <span><i className="sw" style={{ background: "var(--short)" }} />Stop</span>
                  <span><i className="sw" style={{ background: "var(--long)" }} />Target</span>
                  <span><i className="sw" style={{ background: "var(--muted)" }} />Sweep</span>
                  <span><i className="sw" style={{ background: "var(--accent)" }} />MSS</span>
                  <span><i className="sw" style={{ background: "rgba(76,141,255,.4)" }} />FVG</span>
                </div>
              </div>

              <div className="stats-card col-half">
                <div className="stat">
                  <div className="stat-k">{lowerLabel} / {higherLabel} Aligned</div>
                  <div className="stat-v">
                    {r.biasLow ? (r.aligned ? "✓ yes" : "✗ no") : "—"}
                    {r.biasHigh && !r.aligned ? <small style={{ marginLeft: 6, color: "var(--muted)" }}>{lowerLabel} not aligned</small> : null}
                  </div>
                </div>
                <div className="stat"><div className="stat-k">{lowerLabel} Sweep</div><div className="stat-v">{ck(r.checklist?.sweep)}</div></div>
                <div className="stat"><div className="stat-k">{lowerLabel} MSS</div><div className="stat-v">{ck(r.checklist?.mss)}</div></div>
                <div className="stat">
                  <div className="stat-k">{lowerLabel} Breaker (confirm yourself)</div>
                  <div className="stat-v">{r.breaker ? <span className="pill flat" title="Candidate only — verify on chart">check candle {r.breaker.index}</span> : <span className="pill flat">—</span>}</div>
                </div>
                <div className="stat"><div className="stat-k">{lowerLabel} FVG</div><div className="stat-v">{ck(r.checklist?.fvg)}</div></div>
                <div className="stat">
                  <div className="stat-k">ADX (gates readiness)</div>
                  <div className="stat-v" title={r.confluence?.adx?.value != null ? `ADX ${r.confluence.adx.value.toFixed(1)} (need > ${r.confluence.adx.threshold})` : ""}>{ck(r.confluence?.adx?.ok)}</div>
                </div>
                <div className="stat">
                  <div className="stat-k">MSS Volume (info only)</div>
                  <div className="stat-v" title={r.confluence?.volume?.ratio ? `${r.confluence.volume.ratio.toFixed(1)}× avg on the MSS candle` : ""}>{ck(r.confluence?.volume?.ok)}</div>
                </div>
              </div>

              <div className="stats-card col-half">
                <div className="stat"><div className="stat-k">Entry</div><div className="stat-v">{r.setupReady ? fmt(r.entry, r.symbol) : "—"}</div></div>
                <div className="stat"><div className="stat-k">Stop</div><div className="stat-v short-txt">{r.setupReady ? fmt(r.stop, r.symbol) : "—"}</div></div>
                <div className="stat"><div className="stat-k">Target</div><div className="stat-v long-txt">{r.setupReady ? `${fmt(r.target, r.symbol)}${r.targetSource === "poi" ? " (POI)" : ""}` : "—"}</div></div>
                <div className="stat"><div className="stat-k">R:R</div><div className="stat-v rr">{r.setupReady ? `${r.rr.toFixed(1)}:1` : "—"}</div></div>
                <div className="stat"><div className="stat-k">Bars since {lowerLabel} MSS</div><div className="stat-v">{r.barsAgo != null ? r.barsAgo : "—"}</div></div>
                <div className="stat"><div className="stat-k">Still catchable?</div><div className="stat-v">{r.setupReady ? <EntryWindowPill status={r.entryWindow} /> : "—"}</div></div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
