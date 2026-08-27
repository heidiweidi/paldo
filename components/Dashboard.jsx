"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CRYPTO, FOREX } from "@/lib/universe";
import { analyze, analyzeLiquiditySweep, to4h } from "@/lib/indicators";

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
  const [mode, setMode] = useState("trend"); // "trend" | "structure"
  const [tf, setTf] = useState("4h");
  const [mkt, setMkt] = useState("all");
  const [onlySignals, setOnlySignals] = useState(true);
  const [minAdx, setMinAdx] = useState(20);
  const [sort, setSort] = useState({ k: "signal", asc: false });
  const [rows, setRows] = useState([]);
  const [rows2, setRows2] = useState([]);
  const [status, setStatus] = useState("Loading live data…");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  // ---- Trend / ADX mode (original screener) ----
  const scan = useCallback(async () => {
    setLoading(true);
    setNotice("");
    const interval = tf;
    const fails = [];
    let done = 0;
    const total = CRYPTO.length + FOREX.length;
    const tick = () => setStatus(`Scanning ${done}/${total}…`);
    tick();
    const out = [];

    await Promise.all(
      CRYPTO.map(async (sym) => {
        try {
          const { bars } = await jget(`/api/klines?symbol=${sym}&interval=${interval}`);
          const r = analyze(sym, "crypto", bars);
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
          let { bars } = await jget(`/api/forex?symbol=${encodeURIComponent(o.y)}`);
          if (interval === "4h") bars = to4h(bars);
          const r = analyze(o.s, "forex", bars);
          if (r) out.push(r);
        } catch {
          fails.push(o.s);
        } finally {
          done++; tick();
        }
      })
    );

    // Volatility ranking within each market.
    ["crypto", "forex"].forEach((m) => {
      const g = out.filter((r) => r.mkt === m).map((r) => r.atrPct).sort((a, b) => a - b);
      if (!g.length) return;
      const q = (p) => g[Math.floor((g.length - 1) * p)];
      out.filter((r) => r.mkt === m).forEach((r) => {
        r.vol = r.atrPct >= q(0.66) ? "High" : r.atrPct >= q(0.33) ? "Med" : "Low";
        r.volN = (r.atrPct - g[0]) / ((g[g.length - 1] - g[0]) || 1);
      });
    });
    out.forEach((r) => { r.oppScore = r.signal !== 0 ? r.adx * (0.5 + (r.volN || 0)) : 0; });

    setRows(out);
    const sigCount = out.filter((r) => r.signal !== 0).length;
    setStatus(`Updated ${new Date().toLocaleString()} · ${out.length} assets · ${sigCount} trending`);
    if (fails.length) {
      setNotice(
        `Couldn't load ${fails.length} symbol(s): ${fails.join(", ")}. The market source may have rate-limited momentarily — press Scan to retry.`
      );
    }
    setLoading(false);
  }, [tf]);

  // ---- Structure Setup mode ----
  // ICT/SMC liquidity-sweep checklist, single timeframe (the tf toggle above):
  //   Liquidity Sweep -> Market Structure Shift (MSS) -> Breaker Block -> Fair
  //   Value Gap (FVG) -> entry sized to a fixed 1:2 risk/reward.
  // Sweep, MSS, and FVG are detected from the candles; Breaker Block is
  // surfaced as a candidate only — confirm it yourself on the chart.
  const scanStructure = useCallback(async () => {
    setLoading(true);
    setNotice("");
    const interval = tf;
    const fails = [];
    let done = 0;
    const total = CRYPTO.length + FOREX.length;
    const tick = () => setStatus(`Scanning ${done}/${total}…`);
    tick();
    const out = [];

    await Promise.all(
      CRYPTO.map(async (sym) => {
        try {
          const { bars } = await jget(`/api/klines?symbol=${sym}&interval=${interval}&limit=300`);
          const r = analyzeLiquiditySweep(sym, "crypto", bars);
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
          let { bars } = await jget(`/api/forex?symbol=${encodeURIComponent(o.y)}&range=3mo`);
          if (interval === "4h") bars = to4h(bars);
          const r = analyzeLiquiditySweep(o.s, "forex", bars);
          if (r) out.push(r);
        } catch {
          fails.push(o.s);
        } finally {
          done++; tick();
        }
      })
    );

    setRows2(out);
    const sigCount = out.filter((r) => r.bias).length;
    setStatus(`Updated ${new Date().toLocaleString()} · ${out.length} assets · ${sigCount} structure shifts`);
    if (fails.length) {
      setNotice(
        `Couldn't load ${fails.length} symbol(s): ${fails.join(", ")}. The market source may have rate-limited momentarily — press Scan to retry.`
      );
    }
    setLoading(false);
  }, [tf]);

  useEffect(() => {
    if (mode === "trend") scan();
    else scanStructure();
  }, [mode, scan, scanStructure]);

  const view = useMemo(() => {
    let r = rows.slice();
    if (mkt !== "all") r = r.filter((x) => x.mkt === mkt);
    r.forEach((x) => (x._sig = x.signal !== 0 && x.adx >= minAdx));
    if (onlySignals) r = r.filter((x) => x._sig);
    const { k, asc } = sort;
    r.sort((a, b) => {
      let av, bv;
      if (k === "signal") { av = a._sig ? a.oppScore : -1; bv = b._sig ? b.oppScore : -1; }
      else if (k === "symbol") { return asc ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol); }
      else { av = a[k]; bv = b[k]; }
      return asc ? av - bv : bv - av;
    });
    return r;
  }, [rows, mkt, minAdx, onlySignals, sort]);

  const view2 = useMemo(() => {
    let r = rows2.slice();
    if (mkt !== "all") r = r.filter((x) => x.mkt === mkt);
    if (onlySignals) r = r.filter((x) => x.bias);
    r.sort((a, b) => {
      const av = (a.setupReady ? 2 : 0) + (a.bias ? 1 : 0);
      const bv = (b.setupReady ? 2 : 0) + (b.bias ? 1 : 0);
      if (bv !== av) return bv - av;
      return (a.barsAgo ?? 999) - (b.barsAgo ?? 999);
    });
    return r;
  }, [rows2, mkt, onlySignals]);

  const cards = useMemo(() => {
    const sigs = rows.filter((r) => r.signal !== 0 && r.adx >= minAdx && (mkt === "all" || r.mkt === mkt));
    const longs = sigs.filter((r) => r.signal > 0).length;
    const shorts = sigs.filter((r) => r.signal < 0).length;
    const top = sigs.slice().sort((a, b) => b.oppScore - a.oppScore)[0];
    const hot = rows.filter((r) => mkt === "all" || r.mkt === mkt).slice().sort((a, b) => b.atrPct - a.atrPct)[0];
    return { count: sigs.length, longs, shorts, top, hot };
  }, [rows, mkt, minAdx]);

  const cards2 = useMemo(() => {
    const scoped = rows2.filter((r) => mkt === "all" || r.mkt === mkt);
    const shifted = scoped.filter((r) => r.bias);
    const ready = scoped.filter((r) => r.setupReady);
    return {
      shiftLongs: shifted.filter((r) => r.bias === "long").length,
      shiftShorts: shifted.filter((r) => r.bias === "short").length,
      readyLongs: ready.filter((r) => r.bias === "long").length,
      readyShorts: ready.filter((r) => r.bias === "short").length,
    };
  }, [rows2, mkt]);

  const onSort = (k) =>
    setSort((s) => (s.k === k ? { k, asc: !s.asc } : { k, asc: false }));

  const th = (k, label) => (
    <th
      onClick={() => onSort(k)}
      className={sort.k === k ? (sort.asc ? "sorted asc" : "sorted") : ""}
    >
      {label}
    </th>
  );

  const strategyParam = mode === "structure" ? "&strategy=structure" : "";

  return (
    <div className="wrap">
      <div className="controls">
        <div className="seg">
          <button className={mode === "trend" ? "active" : ""} onClick={() => setMode("trend")}>Trend/ADX</button>
          <button className={mode === "structure" ? "active" : ""} onClick={() => setMode("structure")}>Structure Setup</button>
        </div>
        <div className="seg">
          <button className={tf === "1h" ? "active" : ""} onClick={() => setTf("1h")}>1H</button>
          <button className={tf === "4h" ? "active" : ""} onClick={() => setTf("4h")}>4H</button>
        </div>
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
        {mode === "trend" ? (
          <select value={minAdx} onChange={(e) => setMinAdx(+e.target.value)}>
            <option value={0}>ADX ≥ 0</option>
            <option value={20}>ADX ≥ 20</option>
            <option value={25}>ADX ≥ 25</option>
            <option value={30}>ADX ≥ 30</option>
          </select>
        ) : null}
        <button className="btn primary" onClick={mode === "trend" ? scan : scanStructure} disabled={loading}>
          {loading ? "Scanning…" : "↻ Scan"}
        </button>
        <div className="statusline">{status}</div>
      </div>

      {notice ? <div className="notice">⚠ {notice}</div> : null}

      {mode === "trend" ? (
        <>
          <div className="cards">
            <div className="card"><div className="k">Actionable setups</div><div className="v">{cards.count} <small>on {tf}</small></div></div>
            <div className="card"><div className="k">Long / Short</div><div className="v"><span style={{ color: "var(--long)" }}>{cards.longs}</span> / <span style={{ color: "var(--short)" }}>{cards.shorts}</span></div></div>
            <div className="card"><div className="k">Top opportunity</div><div className="v">{cards.top ? cards.top.symbol : "—"} <small>{cards.top ? `${cards.top.signal > 0 ? "long" : "short"} · ADX ${cards.top.adx.toFixed(0)}` : ""}</small></div></div>
            <div className="card"><div className="k">Most volatile</div><div className="v">{cards.hot ? cards.hot.symbol : "—"} <small>{cards.hot ? `ATR ${cards.hot.atrPct.toFixed(2)}%` : ""}</small></div></div>
          </div>

          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  {th("symbol", "Asset")}
                  {th("price", "Price")}
                  {th("chg", "Chg%")}
                  {th("signal", "Signal")}
                  {th("adx", "Trend (ADX)")}
                  {th("atrPct", "Volatility (ATR%)")}
                  {th("rsi", "RSI")}
                  {th("entry", "Entry")}
                  {th("stop", "Stop")}
                  {th("target", "Target")}
                  {th("rr", "R:R")}
                </tr>
              </thead>
              <tbody>
                {view.length === 0 ? (
                  <tr><td colSpan={11} className="empty">{loading ? "Loading…" : "No rows match the current filters."}</td></tr>
                ) : (
                  view.map((r) => {
                    const volCls = r.vol === "High" ? "volHigh" : r.vol === "Low" ? "volLow" : "volMed";
                    const dotCls = r.signal > 0 ? "up" : r.signal < 0 ? "down" : "no";
                    return (
                      <tr key={r.symbol}>
                        <td className="left">
                          <span className={`dot ${dotCls}`} />
                          <a className="sym-link" href={`/asset/${r.symbol}?mkt=${r.mkt}&tf=${tf}`} title={`Open ${r.symbol} trade idea & chart`}>
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
                          {r._sig ? (
                            <span className={`pill ${r.signal > 0 ? "long" : "short"}`}>
                              {r.signal > 0 ? "▲ LONG" : "▼ SHORT"}
                            </span>
                          ) : (
                            <span className="pill flat">no trend</span>
                          )}
                        </td>
                        <td className="num">
                          {r.adx.toFixed(1)}
                          <div className="bar"><i style={{ width: `${Math.min(100, r.adx)}%` }} /></div>
                        </td>
                        <td className={`num ${volCls}`}>{r.atrPct.toFixed(2)}% · {r.vol}</td>
                        <td className="num" style={{ color: r.rsi > 70 ? "var(--short)" : r.rsi < 30 ? "var(--long)" : "var(--txt)" }}>
                          {r.rsi.toFixed(0)}
                        </td>
                        <td className="num">{r._sig ? fmt(r.entry, r.symbol) : "—"}</td>
                        <td className="num" style={{ color: "var(--short)" }}>{r._sig ? fmt(r.stop, r.symbol) : "—"}</td>
                        <td className="num" style={{ color: "var(--long)" }}>{r._sig ? fmt(r.target, r.symbol) : "—"}</td>
                        <td className="num rr">{r._sig ? `${r.rr.toFixed(1)}:1` : "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="foot">
            <b>How to read it:</b> A row is flagged <span className="pill long">LONG</span> or <span className="pill short">SHORT</span> only when the trend is aligned and strong — price on the trend side of EMA20/EMA50, +DI/−DI confirming, and ADX above your threshold. Volatility is ATR as a % of price, ranked within each market. Entry/Stop/Target are ATR-based (stop 1.5×ATR, target 3×ATR ⇒ 2:1 reward-to-risk).
            <br /><br />
            <b>Disclaimer:</b> Educational signal simulation on live public data — not financial advice. Verify every level on your own charts before acting. Crypto data via Binance, forex/gold via Yahoo Finance, proxied through this site's edge API.
          </div>
        </>
      ) : (
        <>
          <div className="notice" style={{ marginBottom: 12 }}>
            ⚠ Checklist: <b>Liquidity Sweep</b> → <b>Market Structure Shift (MSS)</b> → <b>Breaker Block</b> → <b>Fair Value Gap (FVG)</b> → 1:2 risk/reward. Sweep, MSS, and FVG are detected automatically on the {tf.toUpperCase()}. <b>Breaker Block is not</b> — the table shows a candidate candle, but confirm it yourself on the plain price chart (open any asset below) before entering. Entry/Stop/Target only appear once all three automated checks pass.
          </div>

          <div className="cards">
            <div className="card"><div className="k">Structure shifts</div><div className="v"><span style={{ color: "var(--long)" }}>{cards2.shiftLongs}</span> / <span style={{ color: "var(--short)" }}>{cards2.shiftShorts}</span> <small>bull/bear</small></div></div>
            <div className="card"><div className="k">Full setups (+ FVG)</div><div className="v"><span style={{ color: "var(--long)" }}>{cards2.readyLongs}</span> / <span style={{ color: "var(--short)" }}>{cards2.readyShorts}</span> <small>bull/bear</small></div></div>
            <div className="card"><div className="k">Entry timeframe</div><div className="v">{tf.toUpperCase()}</div></div>
            <div className="card"><div className="k">Assets scanned</div><div className="v">{rows2.length}</div></div>
          </div>

          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Price</th>
                  <th>Chg%</th>
                  <th>Bias</th>
                  <th>Sweep</th>
                  <th>MSS</th>
                  <th>Breaker (confirm yourself)</th>
                  <th>FVG</th>
                  <th>Entry</th>
                  <th>Stop</th>
                  <th>Target</th>
                  <th>R:R</th>
                  <th>Bars since MSS</th>
                </tr>
              </thead>
              <tbody>
                {view2.length === 0 ? (
                  <tr><td colSpan={13} className="empty">{loading ? "Loading…" : "No rows match the current filters."}</td></tr>
                ) : (
                  view2.map((r) => {
                    const biasCls = r.bias === "long" ? "up" : r.bias === "short" ? "down" : "no";
                    const ck = (v) => (v ? <span className="pill long">✓</span> : <span className="pill flat">—</span>);
                    return (
                      <tr key={r.symbol}>
                        <td className="left">
                          <span className={`dot ${biasCls}`} />
                          <a className="sym-link" href={`/asset/${r.symbol}?mkt=${r.mkt}&tf=${tf}${strategyParam}`} title={`Open ${r.symbol} structure setup & chart`}>
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
                          {r.bias === "long" ? <span className="pill long">▲ BULL</span>
                            : r.bias === "short" ? <span className="pill short">▼ BEAR</span>
                            : <span className="pill flat">—</span>}
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
            <b>How to read it:</b> <b>Bias</b> is the direction of the reversal in progress (bull = swept a low then shifted up; bear = swept a high then shifted down). <b>Sweep</b>/<b>MSS</b>/<b>FVG</b> are detected from candles on the {tf.toUpperCase()}. <b>Breaker</b> only ever shows a candidate candle to check — it is never treated as confirmed. Entry/Stop/Target appear once Sweep + MSS + FVG all pass: entry is the middle of the FVG, stop is the sweep candle's wick extreme, target is sized for a fixed 1:2 risk/reward. Still confirm the Breaker Block yourself before entering.
            <br /><br />
            <b>Disclaimer:</b> Educational signal simulation on live public data — not financial advice. Verify every level on your own charts before acting. Crypto data via Binance, forex/gold via Yahoo Finance, proxied through this site's edge API.
          </div>
        </>
      )}
    </div>
  );
}
