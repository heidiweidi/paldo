"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CRYPTO, FOREX } from "@/lib/universe";
import { analyzeMTF, to4h } from "@/lib/indicators";

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

export default function Dashboard() {
  const [mkt, setMkt] = useState("all");
  const [onlySignals, setOnlySignals] = useState(true);
  const [pairing, setPairing] = useState("A"); // which timeframe pairing's table is shown
  const [rowsA, setRowsA] = useState([]); // 4H bias -> 15m entry
  const [rowsB, setRowsB] = useState([]); // 1H bias -> 5m entry
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
    const outA = [];
    const outB = [];

    await Promise.all(
      CRYPTO.map(async (sym) => {
        try {
          const [{ bars: b4h }, { bars: b1h }, { bars: b15m }, { bars: b5m }] = await Promise.all([
            jget(`/api/klines?symbol=${sym}&interval=4h&limit=300`),
            jget(`/api/klines?symbol=${sym}&interval=1h&limit=300`),
            jget(`/api/klines?symbol=${sym}&interval=15m&limit=300`),
            jget(`/api/klines?symbol=${sym}&interval=5m&limit=300`),
          ]);
          const a = analyzeMTF(sym, "crypto", b4h, b15m);
          const b = analyzeMTF(sym, "crypto", b1h, b5m);
          if (a) outA.push(a);
          if (b) outB.push(b);
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
          const a = analyzeMTF(o.s, "forex", b4h, b15m);
          const b = analyzeMTF(o.s, "forex", raw1h, b5m);
          if (a) outA.push(a);
          if (b) outB.push(b);
        } catch {
          fails.push(o.s);
        } finally {
          done++; tick();
        }
      })
    );

    setRowsA(outA);
    setRowsB(outB);
    const readyCount = outA.filter((r) => r.setupReady).length + outB.filter((r) => r.setupReady).length;
    setStatus(`Updated ${new Date().toLocaleString()} · ${outA.length} assets · ${readyCount} ready setups`);
    if (fails.length) {
      setNotice(
        `Couldn't load ${fails.length} symbol(s): ${fails.join(", ")}. The market source may have rate-limited momentarily — press Scan to retry.`
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { scan(); }, [scan]);

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
        <button className="btn primary" onClick={scan} disabled={loading}>
          {loading ? "Scanning…" : "↻ Scan"}
        </button>
        <div className="statusline">{status}</div>
      </div>

      {notice ? <div className="notice">⚠ {notice}</div> : null}

      <div className="notice" style={{ marginBottom: 12 }}>
        ⚠ Checklist: <b>Liquidity Sweep</b> → <b>Market Structure Shift (MSS)</b> → <b>Breaker Block</b> → <b>Fair Value Gap (FVG)</b>, confirmed with <b>ADX(14) &gt; 20</b> on the bias timeframe (trending, not choppy) and <b>volume ≥ 1.5× its 20-bar average</b> on the entry candle (real participation, not a thin fakeout). Two parallel pairings, higher timeframe for bias / lower timeframe for the entry trigger — pick a tab below. Target is the next unswept swing (POI) on the <i>higher</i> timeframe ahead of price, falling back to a fixed 1:2 if none exists yet. <b>Breaker Block is never automated</b> — confirm it yourself on the plain price chart before entering.
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
      />

      <div className="foot">
        <b>How to read it:</b> <b>Bias</b> is the higher-timeframe reversal direction (a sweep followed by a structure shift). The lower-timeframe Sweep/MSS/FVG columns are the entry-trigger checklist, detected independently. A row only shows Entry/Stop/Target once the lower-TF checklist completes, agrees with the higher-TF bias, <i>and</i> both confluence checks (ADX &gt; 20, high volume) pass. Entry is the middle of the lower-TF Fair Value Gap, stop is the lower-TF sweep candle's wick extreme, target is the next unswept opposing swing on the <i>higher</i> TF (or a fixed 1:2 if none exists yet — shown in the R:R column). Breaker Block is always a candidate to check yourself, never auto-confirmed. <b>Still catchable?</b> compares the current price to entry/stop/target, not just bar count: <b>In zone</b> means price has pulled back to the gap — this is your window; <b>Running</b> means price never pulled back and is already headed to target — chasing it now is worse risk/reward than planned; <b>Target reached</b> or <b>Invalidated</b> mean the move has already played out one way or the other.
        <br /><br />
        <b>Disclaimer:</b> Educational signal simulation on live public data — not financial advice. Verify every level on your own charts before acting. Crypto data via Binance, forex/gold via Yahoo Finance, proxied through this site's edge API.
      </div>
    </div>
  );
}

function PairingSection({ pairingKey, title, rows, mkt, onlySignals, loading, higherLabel, lowerLabel }) {
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
              <th>Asset</th>
              <th>Price</th>
              <th>Chg%</th>
              <th>{higherLabel} Bias</th>
              <th>{lowerLabel} Sweep</th>
              <th>{lowerLabel} MSS</th>
              <th>{lowerLabel} Breaker (confirm yourself)</th>
              <th>{lowerLabel} FVG</th>
              <th>ADX &gt; 20</th>
              <th>Volume</th>
              <th>Entry</th>
              <th>Stop</th>
              <th>Target</th>
              <th>R:R</th>
              <th>Bars since {lowerLabel} MSS</th>
              <th>Still catchable?</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr><td colSpan={16} className="empty">{loading ? "Loading…" : "No rows match the current filters."}</td></tr>
            ) : (
              view.map((r) => {
                const biasCls = r.biasHigh === "long" ? "up" : r.biasHigh === "short" ? "down" : "no";
                const ck = (v) => (v ? <span className="pill long">✓</span> : <span className="pill flat">—</span>);
                return (
                  <tr key={r.symbol}>
                    <td className="left">
                      <span className={`dot ${biasCls}`} />
                      <a className="sym-link" href={`/asset/${r.symbol}?mkt=${r.mkt}&pairing=${pairingKey}`} title={`Open ${r.symbol} structure setup & chart`}>
                        <span className="sym">{r.symbol}</span>
                        <span className="open-ico">↗</span>
                      </a>
                      <span className="mk">{r.mkt === "crypto" ? "CRYPTO" : "FX"}</span>
                    </td>
                    <td className="num">{fmt(r.price, r.symbol)}</td>
                    <td className="num" style={{ color: r.chg >= 0 ? "var(--long)" : "var(--short)" }}>
                      {r.chg >= 0 ? "+" : ""}{r.chg.toFixed(2)}%
                    </td>
                    <td>
                      {r.biasHigh === "long" ? <span className="pill long">▲ BULL</span>
                        : r.biasHigh === "short" ? <span className="pill short">▼ BEAR</span>
                        : <span className="pill flat">—</span>}
                      {r.biasHigh && !r.aligned ? <small style={{ marginLeft: 6, color: "var(--muted)" }}>{lowerLabel} not aligned</small> : null}
                    </td>
                    <td>{ck(r.checklist?.sweep)}</td>
                    <td>{ck(r.checklist?.mss)}</td>
                    <td>{r.breaker ? <span className="pill flat" title="Candidate only — verify on chart">check candle {r.breaker.index}</span> : <span className="pill flat">—</span>}</td>
                    <td>{ck(r.checklist?.fvg)}</td>
                    <td title={r.confluence?.adx?.value != null ? `ADX ${r.confluence.adx.value.toFixed(1)}` : ""}>{ck(r.confluence?.adx?.ok)}</td>
                    <td title={r.confluence?.volume?.ratio ? `${r.confluence.volume.ratio.toFixed(1)}× avg` : ""}>{ck(r.confluence?.volume?.ok)}</td>
                    <td className="num">{r.setupReady ? fmt(r.entry, r.symbol) : "—"}</td>
                    <td className="num" style={{ color: "var(--short)" }}>{r.setupReady ? fmt(r.stop, r.symbol) : "—"}</td>
                    <td className="num" style={{ color: "var(--long)" }}>{r.setupReady ? `${fmt(r.target, r.symbol)}${r.targetSource === "poi" ? " (POI)" : ""}` : "—"}</td>
                    <td className="num rr">{r.setupReady ? `${r.rr.toFixed(1)}:1` : "—"}</td>
                    <td className="num">{r.barsAgo != null ? r.barsAgo : "—"}</td>
                    <td>{r.setupReady ? <EntryWindowPill status={r.entryWindow} /> : "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
