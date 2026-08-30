"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CRYPTO, FOREX } from "@/lib/universe";
import { analyzeMTF, to4h, STRATEGIES, DEFAULT_FILTERS } from "@/lib/indicators";
import PositionChart from "@/components/PositionChart";

const STRAT = STRATEGIES.strat5;

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
  tp1_hit: { cls: "flat", label: "TP1 hit — runner only" },
  tp2_hit: { cls: "flat", label: "TP2 reached" },
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

const COIN_COUNTS = [25, 50, 100, 150];

// Optional screening filters, applied on top of a completed Strat#5 setup —
// never a condition for the setup itself. All default to off so the scanner
// surfaces every valid entry; switch one on to narrow the list.
const FILTER_DEFS = [
  {
    key: "adx",
    label: "ADX",
    unit: "",
    min: 0, max: 50, step: 1,
    fmt: (v) => v.toFixed(0),
    hint: "Trend strength on the bias timeframe. ~20+ is trending rather than choppy.",
  },
  {
    key: "volatility",
    label: "Volatility",
    unit: "%",
    min: 0, max: 5, step: 0.1,
    fmt: (v) => v.toFixed(1),
    hint: "ATR(14) as a % of price on the bias timeframe. Under ~0.5% is a sluggish market; over ~2% moves fast.",
  },
  {
    key: "volume",
    label: "Volume",
    unit: "×",
    min: 0, max: 5, step: 0.1,
    fmt: (v) => v.toFixed(1),
    hint: "Volume on the entry-timeframe MSS candle vs its own 20-bar average. Note: some forex feeds report no volume, so switching this on will hide those assets.",
  },
];

export default function Dashboard() {
  const [mkt, setMkt] = useState("all");
  const [onlySignals, setOnlySignals] = useState(true);
  const [pairing, setPairing] = useState("A"); // which timeframe pairing's table is shown
  // Optional screening filters — see FILTER_DEFS. Off by default: a Strat#5
  // setup is a Strat#5 setup regardless of these.
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const setFilter = (key, patch) =>
    setFilters((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  // Crypto universe: either the curated fixed list in lib/universe.js, or
  // the top N coins by market cap pulled live from CoinGecko. Forex/gold
  // always comes from the fixed FOREX list — CoinGecko is crypto-only.
  const [universe, setUniverse] = useState("curated"); // "curated" | "coingecko"
  const [coinCount, setCoinCount] = useState(50);
  // Raw bars per symbol — kept separate from analysis so changing a filter
  // re-scores instantly against already-fetched data instead of re-hitting
  // Binance/Yahoo (and risking rate limits) on every drag.
  const [barsMap, setBarsMap] = useState([]); // [{ sym, mkt, b4h, b1h, b15m, b5m }]
  const [lastUpdated, setLastUpdated] = useState(null);
  const [status, setStatus] = useState("Loading live data…");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  // Strat#5 scanner — ICT/SMC liquidity-sweep checklist, run as two
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
    const noticeParts = [];
    let done = 0;

    // Crypto universe: pull the top N coins by market cap from CoinGecko when
    // that mode is selected, falling back to the curated list if the request
    // fails (rate-limited, network hiccup, etc.) rather than scanning nothing.
    let cryptoSymbols = CRYPTO;
    if (universe === "coingecko") {
      setStatus("Fetching top coins by market cap (CoinGecko)…");
      try {
        const { coins } = await jget(`/api/coingecko?limit=${coinCount}`);
        if (Array.isArray(coins) && coins.length) {
          cryptoSymbols = coins.map((c) => c.symbol);
        } else {
          noticeParts.push("CoinGecko returned no coins — used the curated list instead.");
        }
      } catch {
        noticeParts.push("Couldn't reach CoinGecko — used the curated list instead.");
      }
    }

    const total = cryptoSymbols.length + FOREX.length;
    const tick = () => setStatus(`Scanning ${done}/${total}…`);
    tick();
    const collected = [];

    await Promise.all(
      cryptoSymbols.map(async (sym) => {
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
      noticeParts.push(
        `Couldn't load ${fails.length} symbol(s): ${fails.join(", ")}. The market source may have rate-limited momentarily, or a CoinGecko top coin isn't listed as a USDT pair on Binance — press Scan to retry.`
      );
    }
    if (noticeParts.length) setNotice(noticeParts.join(" "));
    setLoading(false);
  }, [universe, coinCount]);

  useEffect(() => { scan(); }, [scan]);

  // Re-scored from barsMap whenever a filter changes — no re-fetch. Both
  // pairings (4H→15m and 1H→5m) get the same strategy and the same filters.
  const rowsA = useMemo(
    () => barsMap.map((x) => analyzeMTF(x.sym, x.mkt, x.b4h, x.b15m, filters)).filter(Boolean),
    [barsMap, filters]
  );
  const rowsB = useMemo(
    () => barsMap.map((x) => analyzeMTF(x.sym, x.mkt, x.b1h, x.b5m, filters)).filter(Boolean),
    [barsMap, filters]
  );
  const readyCount = useMemo(
    () =>
      rowsA.filter((r) => r.setupReady && r.filtersPass).length +
      rowsB.filter((r) => r.setupReady && r.filtersPass).length,
    [rowsA, rowsB]
  );
  // How many valid Strat#5 setups the active filters are currently hiding —
  // shown so a filter can never silently make the scanner look empty.
  const hiddenByFilters = useMemo(
    () =>
      rowsA.filter((r) => r.setupReady && !r.filtersPass).length +
      rowsB.filter((r) => r.setupReady && !r.filtersPass).length,
    [rowsA, rowsB]
  );
  const anyFilterOn = filters.adx.on || filters.volatility.on || filters.volume.on;
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
        <div className="seg" title="Which coins to scan — a fixed curated list, or the current top N by market cap from CoinGecko">
          {[
            { key: "curated", label: "Curated list" },
            { key: "coingecko", label: "Top by market cap" },
          ].map((o) => (
            <button key={o.key} className={universe === o.key ? "active" : ""} onClick={() => setUniverse(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
        {universe === "coingecko" ? (
          <select value={coinCount} onChange={(e) => setCoinCount(Number(e.target.value))}>
            {COIN_COUNTS.map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        ) : null}
        <label className="ck">
          <input type="checkbox" checked={onlySignals} onChange={(e) => setOnlySignals(e.target.checked)} />
          Signals only
        </label>
        <button className="btn primary" onClick={scan} disabled={loading}>
          {loading ? "Scanning…" : "↻ Scan"}
        </button>
        <div className="statusline">{statusLine}</div>
      </div>

      <div className="filterbar">
        <div className="filterbar-head">
          <span className="filter-title">Filters</span>
          <span className="filter-sub">
            optional — narrows the {STRAT.name} results, never changes what counts as a setup
          </span>
          {anyFilterOn ? (
            <button className="btn" style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }} onClick={() => setFilters(DEFAULT_FILTERS)}>
              Reset filters
            </button>
          ) : null}
        </div>
        <div className="filter-row">
          {FILTER_DEFS.map((d) => {
            const f = filters[d.key];
            return (
              <div key={d.key} className={`filter-chip${f.on ? " on" : ""}`} title={d.hint}>
                <label className="ck">
                  <input type="checkbox" checked={f.on} onChange={(e) => setFilter(d.key, { on: e.target.checked })} />
                  {d.label}
                </label>
                <span className="filter-val">≥ {d.fmt(f.min)}{d.unit}</span>
                <input
                  type="range"
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  value={f.min}
                  disabled={!f.on}
                  onChange={(e) => setFilter(d.key, { min: Number(e.target.value) })}
                  style={{ width: 110 }}
                />
              </div>
            );
          })}
          {anyFilterOn && hiddenByFilters > 0 ? (
            <span className="filter-hidden">{hiddenByFilters} valid setup(s) hidden by filters</span>
          ) : null}
        </div>
      </div>

      {notice ? <div className="notice">⚠ {notice}</div> : null}

      <div className="notice" style={{ marginBottom: 12 }}>
        ⚠ <b>{STRAT.name}</b> — <b>Liquidity Sweep</b> → <b>Market Structure Shift (MSS)</b> → <b>Breaker Block</b> → <b>Fair Value Gap (FVG)</b>, exiting in two scales: <b>TP1 at 1:1</b> (bank half, de-risk) and <b>TP2 at 1:2</b> (the runner). That checklist alone decides whether a setup exists — ADX, Volatility and Volume are <i>filters only</i> and never gate detection (gating on them was hiding too many valid, profitable entries). Both pairings run the same strategy: <b>4H bias → 15m entry</b> and <b>1H bias → 5m entry</b> — pick a tab below. The <b>POI</b> (next unswept liquidity on the bias timeframe) is <i>marked, not targeted</i> — it shows where price is likely headed after TP2; its distance in R tells you how much room the runner has. <b>Breaker Block is never automated</b> — confirm it yourself on the chart before entering. Click a row's arrow to expand full details; click the symbol to open its chart in a new tab.
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
        title={`${STRAT.name} · ${PAIRING_TABS[pairing].title}`}
        rows={pairing === "A" ? rowsA : rowsB}
        mkt={mkt}
        onlySignals={onlySignals}
        loading={loading}
        higherLabel={PAIRING_TABS[pairing].higherLabel}
        lowerLabel={PAIRING_TABS[pairing].lowerLabel}
        barsBySymbol={barsBySymbol}
        lowerKey={pairing === "A" ? "b15m" : "b5m"}
        anyFilterOn={anyFilterOn}
      />

      <div className="foot">
        <b>How to read it:</b> The table shows Asset, Price, Chg%, Bias, Entry, Stop, TP1, TP2 and POI — expand a row (▸) for the full breakdown: the annotated Position chart, the Sweep/MSS/Breaker/FVG checklist, the ADX / Volatility / Volume readings, bars since MSS, and Still catchable. <b>Why two targets:</b> taking the whole position to the next liquidity pool meant a reward-to-risk that swung with however far that pool happened to sit — often 4–5R, which reads well but rarely fills. Fixed <b>TP1 at 1:1</b> and <b>TP2 at 1:2</b> are far likelier to actually be reached; scale out at TP1 and the rest runs risk-free. The <b>POI</b> column is context, not an exit: it's the next unswept liquidity on the bias timeframe, with its distance in R — comfortably beyond TP2 means the runner has room, closer than TP2 means price may stall before it. <b>Bias</b> is the higher-timeframe reversal direction (a sweep followed by a structure shift). The lower-timeframe Sweep/MSS/FVG columns are the entry-trigger checklist, detected independently. A row shows Entry/Stop/TP1/TP2 as soon as the lower-TF checklist completes and agrees with the higher-TF bias — that's the whole of <b>{STRAT.name}</b>. <b>ADX, Volatility and Volume are filters, not conditions:</b> leave them off to see every valid setup, or switch one on to narrow the list; the count of setups a filter is hiding is always shown next to them. Entry is the middle of the lower-TF Fair Value Gap, stop is the lower-TF sweep candle's wick extreme, target is the next unswept opposing swing on the <i>higher</i> TF (or a fixed 1:2 if none exists yet — shown in the expanded R:R). Breaker Block is always a candidate to check yourself, never auto-confirmed. <b>Still catchable?</b> compares the current price to entry/stop/target, not just bar count: <b>In zone</b> means price has pulled back to the gap — this is your window; <b>Running</b> means price never pulled back and is already headed to target — chasing it now is worse risk/reward than planned; <b>Target reached</b> or <b>Invalidated</b> mean the move has already played out one way or the other.
        <br /><br />
        <b>Disclaimer:</b> Educational signal simulation on live public data — not financial advice. Verify every level on your own charts before acting. Crypto data via Binance, forex/gold via Yahoo Finance, proxied through this site's edge API.
      </div>
    </div>
  );
}

function PairingSection({ pairingKey, title, rows, mkt, onlySignals, loading, higherLabel, lowerLabel, barsBySymbol, lowerKey, anyFilterOn }) {
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
    // Filters only ever remove rows from view — they never changed whether the
    // setup was detected in the first place.
    r = r.filter((x) => x.filtersPass);
    r.sort((a, b) => {
      const av = (a.setupReady ? 2 : 0) + (a.aligned ? 1 : 0);
      const bv = (b.setupReady ? 2 : 0) + (b.aligned ? 1 : 0);
      if (bv !== av) return bv - av;
      return (a.barsAgo ?? 999) - (b.barsAgo ?? 999);
    });
    return r;
  }, [rows, mkt, onlySignals]);

  const cards = useMemo(() => {
    const scoped = rows.filter((r) => (mkt === "all" || r.mkt === mkt) && r.filtersPass);
    const aligned = scoped.filter((r) => r.aligned);
    const ready = scoped.filter((r) => r.setupReady);
    return {
      alignedLongs: aligned.filter((r) => r.biasLow === "long").length,
      alignedShorts: aligned.filter((r) => r.biasLow === "short").length,
      readyLongs: ready.filter((r) => r.biasLow === "long").length,
      readyShorts: ready.filter((r) => r.biasLow === "short").length,
      scanned: scoped.length,
    };
  }, [rows, mkt]);

  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>{title}</h2>

      <div className="cards">
        <div className="card"><div className="k">{higherLabel}/{lowerLabel} aligned</div><div className="v"><span style={{ color: "var(--long)" }}>{cards.alignedLongs}</span> / <span style={{ color: "var(--short)" }}>{cards.alignedShorts}</span> <small>bull/bear</small></div></div>
        <div className="card"><div className="k">Ready {STRAT.name} setups</div><div className="v"><span style={{ color: "var(--long)" }}>{cards.readyLongs}</span> / <span style={{ color: "var(--short)" }}>{cards.readyShorts}</span> <small>bull/bear</small></div></div>
        <div className="card"><div className="k">Bias / Entry timeframe</div><div className="v">{higherLabel} <small>/ {lowerLabel}</small></div></div>
        <div className="card"><div className="k">Assets {anyFilterOn ? "passing filters" : "scanned"}</div><div className="v">{cards.scanned}{anyFilterOn ? <small> / {rows.length}</small> : null}</div></div>
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
              <th title="1:1 — bank half and de-risk">TP1 1:1</th>
              <th title="1:2 — the runner">TP2 1:2</th>
              <th title="Next unswept liquidity on the bias timeframe — where price is likely headed next, not an exit">POI</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr><td colSpan={10} className="empty">{loading ? "Loading…" : "No rows match the current filters."}</td></tr>
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

// A filter metric in the expanded row: always shows the live reading, and
// marks pass/fail only when that filter is actually switched on.
function FilterStat({ label, f, render }) {
  const has = f && f.value != null;
  return (
    <div className="stat">
      <div className="stat-k">
        {label}
        {f?.on ? <span className="filter-tag">filter ≥ {render(f.min)}</span> : null}
      </div>
      <div className={`stat-v ${f?.on ? (f.pass ? "long-txt" : "short-txt") : ""}`}>
        {has ? render(f.value) : <span style={{ color: "var(--muted)" }}>no data</span>}
        {f?.on ? <span style={{ marginLeft: 6 }}>{f.pass ? "✓" : "✗"}</span> : null}
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
            href={`/asset/${r.symbol}?mkt=${r.mkt}&pairing=${pairingKey}`}
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
        <td className="num" style={{ color: "var(--long)" }}>{r.setupReady ? fmt(r.tp1, r.symbol) : "—"}</td>
        <td className="num" style={{ color: "var(--long)", opacity: 0.75 }}>{r.setupReady ? fmt(r.tp2, r.symbol) : "—"}</td>
        <td className="num poi-txt" title={r.poiR != null ? `${r.poiR.toFixed(1)}R from entry` : "no unswept pool ahead yet"}>
          {r.setupReady && r.poi != null ? (
            <>
              {fmt(r.poi, r.symbol)} <small style={{ opacity: 0.8 }}>{r.poiR != null ? `${r.poiR.toFixed(1)}R` : ""}</small>
            </>
          ) : "—"}
        </td>
      </tr>
      {isOpen ? (
        <tr className="expand-row">
          <td></td>
          <td colSpan={9} style={{ whiteSpace: "normal", verticalAlign: "top" }}>
            <div className="three-col" style={{ padding: "8px 0 14px" }}>
              <div className="chart-panel" style={{ margin: 0 }}>
                <div className="pos-head">
                  <span className="lbl">Position ({lowerLabel}) — entry idea</span>
                  {r.setupReady ? (
                    <>
                      <span className="pos-badge entry">Entry {fmt(r.entry, r.symbol)}</span>
                      <span className="pos-badge stop">Stop {fmt(r.stop, r.symbol)}</span>
                      <span className="pos-badge target">TP1 {fmt(r.tp1, r.symbol)}</span>
                      <span className="pos-badge target">TP2 {fmt(r.tp2, r.symbol)}</span>
                      {r.poi != null ? <span className="pos-badge poi">POI {fmt(r.poi, r.symbol)}</span> : null}
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
                    tp1={r.tp1}
                    tp2={r.tp2}
                    poi={r.poi}
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
                  <span><i className="sw" style={{ background: "var(--long)" }} />TP1 / TP2</span>
                  <span><i className="sw" style={{ background: "#c58cff" }} />POI (next liquidity)</span>
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
                <FilterStat
                  label={`ADX (${higherLabel})`}
                  f={r.filters?.adx}
                  render={(v) => v.toFixed(1)}
                />
                <FilterStat
                  label={`Volatility (${higherLabel} ATR%)`}
                  f={r.filters?.volatility}
                  render={(v) => `${v.toFixed(2)}%`}
                />
                <FilterStat
                  label={`Volume (${lowerLabel} MSS candle)`}
                  f={r.filters?.volume}
                  render={(v) => `${v.toFixed(1)}× avg`}
                />
              </div>

              <div className="stats-card col-half">
                <div className="stat"><div className="stat-k">Entry</div><div className="stat-v">{r.setupReady ? fmt(r.entry, r.symbol) : "—"}</div></div>
                <div className="stat"><div className="stat-k">Stop</div><div className="stat-v short-txt">{r.setupReady ? fmt(r.stop, r.symbol) : "—"}</div></div>
                <div className="stat"><div className="stat-k">TP1 (1:1)</div><div className="stat-v long-txt">{r.setupReady ? fmt(r.tp1, r.symbol) : "—"}</div></div>
                <div className="stat"><div className="stat-k">TP2 (1:2)</div><div className="stat-v long-txt">{r.setupReady ? fmt(r.tp2, r.symbol) : "—"}</div></div>
                <div className="stat">
                  <div className="stat-k">POI — next liquidity</div>
                  <div className="stat-v poi-txt">
                    {r.setupReady && r.poi != null
                      ? <>{fmt(r.poi, r.symbol)} <small style={{ color: "var(--muted)" }}>{r.poiR != null ? `· ${r.poiR.toFixed(1)}R ${r.poiBeyondTp2 ? "(beyond TP2 — room to run)" : "(before TP2)"}` : ""}</small></>
                      : r.setupReady ? <small style={{ color: "var(--muted)" }}>none unswept ahead</small> : "—"}
                  </div>
                </div>
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
