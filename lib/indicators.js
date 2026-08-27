// Technical indicators — validated against known series.
// rma = Wilder's smoothing (used by ATR, ADX, RSI).
export function rma(vals, p) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    if (i < p) {
      sum += vals[i];
      out.push(i === p - 1 ? sum / p : null);
    } else {
      out.push((out[i - 1] * (p - 1) + vals[i]) / p);
    }
  }
  return out;
}

export function ema(vals, p) {
  const k = 2 / (p + 1);
  let e = vals[0];
  const out = [e];
  for (let i = 1; i < vals.length; i++) {
    e = vals[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

export function rsi(c, p = 14) {
  const g = [], l = [];
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g.push(Math.max(d, 0));
    l.push(Math.max(-d, 0));
  }
  const ag = rma(g, p), al = rma(l, p);
  const out = [null];
  for (let i = 0; i < ag.length; i++) {
    if (ag[i] == null) out.push(null);
    else out.push(al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]));
  }
  return out;
}

export function atr(h, l, c, p = 14) {
  const tr = [];
  for (let i = 0; i < c.length; i++) {
    tr.push(
      i === 0
        ? h[i] - l[i]
        : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))
    );
  }
  return rma(tr, p);
}

export function adx(h, l, c, p = 14) {
  const pdm = [], mdm = [], tr = [];
  for (let i = 0; i < c.length; i++) {
    if (i === 0) { pdm.push(0); mdm.push(0); tr.push(h[i] - l[i]); continue; }
    const up = h[i] - h[i - 1];
    const dn = l[i - 1] - l[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const a = rma(tr, p), pd = rma(pdm, p), md = rma(mdm, p);
  const pdi = [], mdi = [], dx = [];
  for (let i = 0; i < c.length; i++) {
    if (a[i] == null || a[i] === 0) { pdi.push(null); mdi.push(null); dx.push(0); continue; }
    const p1 = (100 * pd[i]) / a[i];
    const m1 = (100 * md[i]) / a[i];
    pdi.push(p1);
    mdi.push(m1);
    dx.push(p1 + m1 === 0 ? 0 : (100 * Math.abs(p1 - m1)) / (p1 + m1));
  }
  return { adx: rma(dx, p), pdi, mdi };
}

// Aggregate 1h bars into 4h bars.
export function to4h(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i += 4) {
    const chunk = bars.slice(i, i + 4);
    if (!chunk.length) break;
    out.push({
      t: chunk[0].t,
      o: chunk[0].o,
      h: Math.max(...chunk.map((x) => x.h)),
      l: Math.min(...chunk.map((x) => x.l)),
      c: chunk[chunk.length - 1].c,
    });
  }
  return out;
}

// Full per-asset analysis: trend, volatility, signal, and ATR-based risk levels.
export function analyze(sym, mkt, bars) {
  if (!bars || bars.length < 60) return null;
  const h = bars.map((b) => b.h), l = bars.map((b) => b.l), c = bars.map((b) => b.c);
  const price = c[c.length - 1];
  const e20 = ema(c, 20), e50 = ema(c, 50);
  const A = adx(h, l, c, 14), at = atr(h, l, c, 14), rs = rsi(c, 14);
  const i = c.length - 1;
  const adxV = A.adx[i] || 0, atrV = at[i] || 0, rsiV = rs[i] || 50;
  const atrPct = (atrV / price) * 100;
  const chg = ((price - c[c.length - 2]) / c[c.length - 2]) * 100;
  const up = price > e20[i] && e20[i] > e50[i] && A.pdi[i] > A.mdi[i];
  const down = price < e20[i] && e20[i] < e50[i] && A.mdi[i] > A.pdi[i];
  const dir = up ? "long" : down ? "short" : "flat";

  let entry = null, stop = null, target = null, rr = null;
  if (dir !== "flat") {
    entry = price;
    if (dir === "long") { stop = price - 1.5 * atrV; target = price + 3 * atrV; }
    else { stop = price + 1.5 * atrV; target = price - 3 * atrV; }
    rr = Math.abs(target - entry) / Math.abs(entry - stop);
  }

  return {
    symbol: sym, mkt, price, chg,
    adx: adxV, atrPct, rsi: rsiV,
    dir, signal: dir === "flat" ? 0 : dir === "long" ? 1 : -1,
    entry, stop, target, rr, vol: "", volN: 0, oppScore: 0,
  };
}

// ---------------------------------------------------------------------------
// Structure Setup mode
//
// Two independent, objective triggers — deliberately NOT a full automation of
// market-structure reading. BOS (break of structure), liquidity sweeps, and
// ChoCH (change of character) are discretionary chart-pattern calls and are
// left for you to confirm visually (add EMA50/EMA200/RSI(30) to the chart —
// see TradingViewChart). What IS automated here:
//
//  1) reversalDir  — RSI(30) crossing the 50 midline on the entry timeframe
//     (4H recommended). Use this only AFTER you've spotted a BOS -> liquidity
//     sweep -> ChoCH by eye; it's a confirmation signal, not an entry by itself,
//     so no formulaic entry/stop/target is attached to it (your actual entry
//     would be placed relative to the sweep low/high and ChoCH candle).
//
//  2) contDir      — EMA50/EMA200 crossing on the entry timeframe, counted
//     only when it agrees with the Daily trend bias (EMA50 vs EMA200 + price
//     on Daily bars) — i.e. a trend-continuation entry, not a countertrend one.
//     This one DOES get an ATR-based stop/target (1.5x / 3x => 2:1), same
//     risk model as the original screener, since it's a clean formulaic entry.
// ---------------------------------------------------------------------------

// Returns "up" if series a crossed above series b on the most recent bar,
// "down" if it crossed below, else null. Guards against leading nulls.
function crossDir(a, b, i) {
  if (i < 1) return null;
  const pa = a[i - 1], pb = b[i - 1], ca = a[i], cb = b[i];
  if (pa == null || pb == null || ca == null || cb == null) return null;
  const prevDiff = pa - pb;
  const curDiff = ca - cb;
  if (prevDiff <= 0 && curDiff > 0) return "up";
  if (prevDiff >= 0 && curDiff < 0) return "down";
  return null;
}

// RSI with a configurable length (default 30, per the structure-setup spec)
// crossing its 50 midline on the most recent bar.
export function rsiMidlineCross(c, length = 30) {
  const rs = rsi(c, length);
  const i = c.length - 1;
  const fifty = rs.map((v) => (v == null ? null : 50));
  return { value: rs[i], cross: crossDir(rs, fifty, i) };
}

// EMA(fast)/EMA(slow) cross on the most recent bar (default 50/200).
export function emaCross(c, fast = 50, slow = 200) {
  const ef = ema(c, fast), es = ema(c, slow);
  const i = c.length - 1;
  return { fast: ef[i], slow: es[i], cross: crossDir(ef, es, i) };
}

// Higher-timeframe (e.g. Daily) trend bias from EMA50/EMA200 + price alignment.
// Needs a decent amount of history for EMA200 to mean anything — see the
// `limit`/`interval=1d` params added to /api/klines and /api/forex.
export function trendBias(bars, fast = 50, slow = 200) {
  if (!bars || bars.length < 60) return null;
  const c = bars.map((b) => b.c);
  const ef = ema(c, fast), es = ema(c, slow);
  const i = c.length - 1;
  const price = c[i];
  if (price > ef[i] && ef[i] > es[i]) return "up";
  if (price < ef[i] && ef[i] < es[i]) return "down";
  return "flat";
}

// entryBars: the timeframe you're screening/entering on (4H recommended).
// dailyBars: higher-timeframe bars used only for the continuation-entry bias filter.
export function analyzeStructure(sym, mkt, entryBars, dailyBars) {
  if (!entryBars || entryBars.length < 60) return null;
  const h = entryBars.map((b) => b.h), l = entryBars.map((b) => b.l), c = entryBars.map((b) => b.c);
  const i = c.length - 1;
  const price = c[i];
  const chg = ((price - c[i - 1]) / c[i - 1]) * 100;
  const at = atr(h, l, c, 14);
  const atrV = at[i] || 0;
  const atrPct = (atrV / price) * 100;

  const rc = rsiMidlineCross(c, 30);
  const xc = emaCross(c, 50, 200);
  const bias = dailyBars ? trendBias(dailyBars, 50, 200) : null;

  // Reversal confirmation — direction only, confirm BOS/sweep/ChoCH yourself.
  const reversalDir = rc.cross === "up" ? "long" : rc.cross === "down" ? "short" : null;

  // Continuation entry — EMA cross must agree with the Daily bias direction.
  let contDir = null;
  if (xc.cross === "up" && bias === "up") contDir = "long";
  else if (xc.cross === "down" && bias === "down") contDir = "short";

  let entry = null, stop = null, target = null, rr = null;
  if (contDir) {
    entry = price;
    if (contDir === "long") { stop = price - 1.5 * atrV; target = price + 3 * atrV; }
    else { stop = price + 1.5 * atrV; target = price - 3 * atrV; }
    rr = Math.abs(target - entry) / Math.abs(entry - stop);
  }

  return {
    symbol: sym, mkt, price, chg, atrPct,
    rsi30: rc.value,
    reversalDir,
    dailyBias: bias,
    emaCrossDir: xc.cross,
    contDir,
    entry, stop, target, rr,
  };
}
