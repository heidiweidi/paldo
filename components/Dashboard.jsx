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

export default function Dashboard() {
  const [mkt, setMkt] = useState("all");
  const [onlySignals, setOnlySignals] = useState(true);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("Loading live data…");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  // Structure Setup scanner — ICT/SMC liquidity-sweep checklist, multi-timeframe:
  //   4H sets the reversal bias (Sweep -> MSS on the 4H).
  //   1H is the entry strategy: its own independent Sweep -> MSS -> FVG
  //   checklist is what actually triggers a ready setup, and only when its
  //   direction agrees with the 4H bias. Breaker Block stays a visual check.
  const scan = useCallback(async () => {
    setLoading(true);
    setNotice("");
    const fails = [];
    let done = 0;
    const total = CRYPTO.length + FOREX.length;
    const tick = () => setStatus(`Scanning ${done}/${total}…`);
    tick();
    const out = [];

    await Promise.all(
      CRYPTO.map(async (sym) => {
        try {
          const [{ bars: bars4h }, { bars: bars1h }] = await Promise.all([
            jget(`/api/klines?symbol=${sym}&interval=4h&limit=300`),
            jget(`/api/klines?symbol=${sym}&interval=1h&limit=300`),
          ]);
          const r = analyzeMTF(sym, "crypto", bars4h, bars1h);
          if (r) out.push(r);
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
          const { bars: raw1h } = await jget(`/api/forex?symbol=${encodeURIComponent(o.y)}&range=3mo`);
          const bars4h = to4h(raw1h);
          const r = analyzeMTF(o.s, "forex", bars4h, raw1h);
          if (r) out.push(r);
        } catch {
          fails.push(o.s);
        } finally {
          done++; tick();
        }
      })
    );

    setRows(out);
    const sigCount = out.filter((r) => r.setupReady).length;
    setStatus(`Updated ${new Date().toLocaleString()} · ${out.length} assets · ${sigCount} ready setups`);
    if (fails.length) {
      setNotice(
        `Couldn't load ${fails.length} symbol(s): ${fails.join(", ")}. The market source may have rate-limited momentarily — press Scan to retry.`
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { scan(); }, [scan]);

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
      alignedLongs: aligned.filter((r) => r.bias1h === "long").length,
      alignedShorts: aligned.filter((r) => r.bias1h === "short").length,
      readyLongs: ready.filter((r) => r.bias1h === "long").length,
      readyShorts: ready.filter((r) => r.bias1h === "short").length,
    };
  }, [rows, mkt]);

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
        ⚠ Checklist: <b>Liquidity Sweep</b> → <b>Market Structure Shift (MSS)</b> → <b>Breaker Block</b> → <b>Fair Value Gap (FVG)</b> → 1:2 risk/reward. <b>4H Bias</b> is the higher-timeframe reversal direction (sweep + MSS on the 4H). <b>1H</b> is the entry strategy — its own Sweep/MSS/FVG checklist is the actual trigger, only counted once it agrees with the 4H bias. <b>Breaker Block is never automated</b> — the table shows a candidate candle; confirm it yourself on the plain price chart (open any asset below) before entering.
      </div>

      <div className="cards">
        <div className="card"><div className="k">4H/1H aligned</div><div className="v"><span style={{ color: "var(--long)" }}>{cards.alignedLongs}</span> / <span style={{ color: "var(--short)" }}>{cards.alignedShorts}</span> <small>bull/bear</small></div></div>
        <div className="card"><div className="k">Ready setups (+ FVG)</div><div className="v"><span style={{ color: "var(--long)" }}>{cards.readyLongs}</span> / <span style={{ color: "var(--short)" }}>{cards.readyShorts}</span> <small>bull/bear</small></div></div>
        <div className="card"><div className="k">Bias / Entry timeframe</div><div className="v">4H <small>/ 1H</small></div></div>
        <div className="card"><div className="k">Assets scanned</div><div className="v">{rows.length}</div></div>
      </div>

      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Price</th>
              <th>Chg%</th>
              <th>4H Bias</th>
              <th>1H Sweep</th>
              <th>1H MSS</th>
              <th>1H Breaker (confirm yourself)</th>
              <th>1H FVG</th>
              <th>Entry</th>
              <th>Stop</th>
              <th>Target</th>
              <th>R:R</th>
              <th>Bars since 1H MSS</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr><td colSpan={13} className="empty">{loading ? "Loading…" : "No rows match the current filters."}</td></tr>
            ) : (
              view.map((r) => {
                const biasCls = r.bias4h === "long" ? "up" : r.bias4h === "short" ? "down" : "no";
                const ck = (v) => (v ? <span className="pill long">✓</span> : <span className="pill flat">—</span>);
                return (
                  <tr key={r.symbol}>
                    <td className="left">
                      <span className={`dot ${biasCls}`} />
                      <a className="sym-link" href={`/asset/${r.symbol}?mkt=${r.mkt}`} title={`Open ${r.symbol} structure setup & chart`}>
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
                      {r.bias4h === "long" ? <span className="pill long">▲ BULL</span>
                        : r.bias4h === "short" ? <span className="pill short">▼ BEAR</span>
                        : <span className="pill flat">—</span>}
                      {r.bias4h && !r.aligned ? <small style={{ marginLeft: 6, color: "var(--muted)" }}>1H not aligned</small> : null}
                    </td>
                    <td>{ck(r.checklist?.sweep)}</td>
                    <td>{ck(r.checklist?.mss)}</td>
                    <td>{r.breaker ? <span className="pill flat" title="Candidate only — verify on chart">check candle {r.breaker.index}</span> : <span className="pill flat">—</span>}</td>
                    <td>{ck(r.checklist?.fvg)}</td>
                    <td className="num">{r.setupReady ? fmt(r.entry, r.symbol) : "—"}</td>
                    <td className="num" style={{ color: "var(--short)" }}>{r.setupReady ? fmt(r.stop, r.symbol) : "—"}</td>
                    <td className="num" style={{ color: "var(--long)" }}>{r.setupReady ? fmt(r.target, r.symbol) : "—"}</td>
                    <td className="num rr">{r.setupReady ? "1:2" : "—"}</td>
                    <td className="num">{r.barsAgo != null ? r.barsAgo : "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="foot">
        <b>How to read it:</b> <b>4H Bias</b> is the higher-timeframe reversal direction (a 4H liquidity sweep followed by a 4H structure shift). <b>1H Sweep/MSS/FVG</b> are the entry-timeframe checklist — the actual trigger — detected independently on 1H candles. A row only shows Entry/Stop/Target once the 1H checklist completes <i>and</i> agrees with the 4H bias. Entry is the middle of the 1H Fair Value Gap, stop is the 1H sweep candle's wick extreme, target is sized for a fixed 1:2 risk/reward. Breaker Block is always a candidate to check yourself, never auto-confirmed.
        <br /><br />
        <b>Disclaimer:</b> Educational signal simulation on live public data — not financial advice. Verify every level on your own charts before acting. Crypto data via Binance, forex/gold via Yahoo Finance, proxied through this site's edge API.
      </div>
    </div>
  );
}
