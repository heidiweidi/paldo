"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CRYPTO, FOREX } from "@/lib/universe";
import { analyze, analyzeStructure, to4h } from "@/lib/indicators";

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
  // Two independent, objective triggers layered on top of chart reading you do yourself:
  //  - Reversal confirmation: RSI(30) crosses 50 on the entry timeframe. Only meaningful
  //    after you've spotted a BOS -> liquidity sweep -> ChoCH by eye on the chart.
  //  - Continuation entry: EMA50/EMA200 cross on the entry timeframe, taken only when it
  //    agrees with the Daily trend bias. Gets an ATR-based stop/target like the trend mode.
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
          const [{ bars: entryBars }, { bars: dailyBars }] = await Promise.all([
            jget(`/api/klines?symbol=${sym}&interval=${interval}&limit=500`),
            jget(`/api/klines?symbol=${sym}&interval=1d&limit=500`),
          ]);
          const r = analyzeStructure(sym, "crypto", entryBars, dailyBars);
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
          const [{ bars: raw }, { bars: dailyBars }] = await Promise.all([
            jget(`/api/forex?symbol=${encodeURIComponent(o.y)}&range=3mo`),
            jget(`/api/forex?symbol=${encodeURIComponent(o.y)}&interval=1d`),
          ]);
          const entryBars = interval === "4h" ? to4h(raw) : raw;
          const r = analyzeStructure(o.s, "forex", entryBars, dailyBars);
          if (r) out.push(r);
        } catch {
          fails.push(o.s);
        } finally {
          done++; tick();
        }
      })
    );

    setRows2(out);
    const sigCount = out.filter((r) => r.contDir || r.reversalDir).length;
    setStatus(`Updated ${new Date().toLocaleString()} · ${out.length} assets · ${sigCount} signals`);
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
    if (onlySignals) r = r.filter((x) => x.contDir || x.reversalDir);
    r.sort((a, b) => {
      const av = (a.contDir ? 2 : 0) + (a.reversalDir ? 1 : 0);
      const bv = (b.contDir ? 2 : 0) + (b.reversalDir ? 1 : 0);
      return bv - av;
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
    const cont = scoped.filter((r) => r.contDir);
    const rev = scoped.filter((r) => r.reversalDir);
    return {
      contLongs: cont.filter((r) => r.contDir === "long").length,
      contShorts: cont.filter((r) => r.contDir === "short").length,
      revLongs: rev.filter((r) => r.reversalDir === "long").length,
      revShorts: rev.filter((r) => r.reversalDir === "short").length,
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
            ⚠ <b>Reversal Confirm</b> is a trigger, not an entry: it only means RSI(30) crossed 50 on the {tf.toUpperCase()}. Confirm the setup yourself first — a break of structure (BOS), a sweep of liquidity beyond the prior swing, and a change of character (ChoCH) reversing it — on a chart with EMA50/EMA200/RSI(30) added (open any asset below). <b>Continuation Entry</b> is fully mechanical: EMA50/EMA200 crossed on the {tf.toUpperCase()}, agreeing with the Daily trend bias.
          </div>

          <div className="cards">
            <div className="card"><div className="k">Continuation entries</div><div className="v"><span style={{ color: "var(--long)" }}>{cards2.contLongs}</span> / <span style={{ color: "var(--short)" }}>{cards2.contShorts}</span> <small>long/short</small></div></div>
            <div className="card"><div className="k">Reversal confirmations</div><div className="v"><span style={{ color: "var(--long)" }}>{cards2.revLongs}</span> / <span style={{ color: "var(--short)" }}>{cards2.revShorts}</span> <small>long/short</small></div></div>
            <div className="card"><div className="k">Entry timeframe</div><div className="v">{tf.toUpperCase()} <small>vs Daily bias</small></div></div>
            <div className="card"><div className="k">Assets scanned</div><div className="v">{rows2.length}</div></div>
          </div>

          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Price</th>
                  <th>Chg%</th>
                  <th>Daily Bias</th>
                  <th>EMA50/200 Cross ({tf.toUpperCase()})</th>
                  <th>Continuation Entry</th>
                  <th>Entry</th>
                  <th>Stop</th>
                  <th>Target</th>
                  <th>R:R</th>
                  <th>RSI(30)</th>
                  <th>Reversal Confirm</th>
                </tr>
              </thead>
              <tbody>
                {view2.length === 0 ? (
                  <tr><td colSpan={12} className="empty">{loading ? "Loading…" : "No rows match the current filters."}</td></tr>
                ) : (
                  view2.map((r) => {
                    const biasCls = r.dailyBias === "up" ? "up" : r.dailyBias === "down" ? "down" : "no";
                    const contCls = r.contDir === "long" ? "up" : r.contDir === "short" ? "down" : "no";
                    const revCls = r.reversalDir === "long" ? "up" : r.reversalDir === "short" ? "down" : "no";
                    return (
                      <tr key={r.symbol}>
                        <td className="left">
                          <span className={`dot ${contCls !== "no" ? contCls : revCls}`} />
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
                          {r.dailyBias === "up" ? <span className="pill long">UP</span>
                            : r.dailyBias === "down" ? <span className="pill short">DOWN</span>
                            : <span className="pill flat">flat</span>}
                        </td>
                        <td>
                          {r.emaCrossDir === "up" ? <span className="pill long">▲ cross up</span>
                            : r.emaCrossDir === "down" ? <span className="pill short">▼ cross down</span>
                            : <span className="pill flat">—</span>}
                        </td>
                        <td>
                          {r.contDir ? (
                            <span className={`pill ${r.contDir === "long" ? "long" : "short"}`}>
                              {r.contDir === "long" ? "▲ LONG" : "▼ SHORT"}
                            </span>
                          ) : <span className="pill flat">—</span>}
                        </td>
                        <td className="num">{r.contDir ? fmt(r.entry, r.symbol) : "—"}</td>
                        <td className="num" style={{ color: "var(--short)" }}>{r.contDir ? fmt(r.stop, r.symbol) : "—"}</td>
                        <td className="num" style={{ color: "var(--long)" }}>{r.contDir ? fmt(r.target, r.symbol) : "—"}</td>
                        <td className="num rr">{r.contDir ? `${r.rr.toFixed(1)}:1` : "—"}</td>
                        <td className="num" style={{ color: r.rsi30 > 50 ? "var(--long)" : "var(--short)" }}>
                          {r.rsi30 != null ? r.rsi30.toFixed(0) : "—"}
                        </td>
                        <td>
                          {r.reversalDir ? (
                            <span className={`pill ${r.reversalDir === "long" ? "long" : "short"}`}>
                              {r.reversalDir === "long" ? "▲ bull x50" : "▼ bear x50"}
                            </span>
                          ) : <span className="pill flat">—</span>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="foot">
            <b>How to read it:</b> <b>Daily Bias</b> is EMA50 vs EMA200 (+ price) alignment on Daily bars. <b>Continuation Entry</b> fires only when the {tf.toUpperCase()} EMA50/EMA200 cross agrees with that Daily bias — it ships with an ATR-based stop/target (1.5×ATR / 3×ATR ⇒ 2:1), same risk model as Trend/ADX mode. <b>Reversal Confirm</b> fires when RSI(30) crosses the 50 midline on the {tf.toUpperCase()} — treat it strictly as a confirmation for a BOS → liquidity sweep → ChoCH pattern you've already spotted visually; there's no automated entry/stop for it since that placement is inherently discretionary (relative to the sweep and ChoCH candle).
            <br /><br />
            <b>Disclaimer:</b> Educational signal simulation on live public data — not financial advice. Verify every level on your own charts before acting. Crypto data via Binance, forex/gold via Yahoo Finance, proxied through this site's edge API.
          </div>
        </>
      )}
    </div>
  );
}
