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

// ---------------------------------------------------------------------------
// Structure Setup mode — ICT/SMC liquidity-sweep checklist:
//   Liquidity Sweep -> Market Structure Shift (MSS) -> Breaker Block -> Fair
//   Value Gap (FVG) -> entry sized to a fixed 1:2 risk/reward.
//
// Sweep, MSS, and FVG are mechanically defined from candle data, so they're
// automated below. Breaker Block — exactly which candle becomes the flip
// zone — is left for you to confirm visually; we surface a *candidate* candle
// (the last opposite-colored candle before the MSS break) as a pointer, not
// a claim. Nothing here is charted automatically (TradingView's basic widget
// studies don't include ICT concepts) — the chart stays plain price action
// so you can verify the boxes/lines yourself, same spirit as the checklist.
// ---------------------------------------------------------------------------

// Causal swing pivots: bar i is a swing high/low if it's the extreme among
// `lookback` bars on both sides. The most recent `lookback` bars can never
// be confirmed pivots yet — that's fine, sweeps/MSS use bars *after* a pivot.
function swingPivots(bars, lookback = 3) {
  const highs = [], lows = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let k = 1; k <= lookback && (isHigh || isLow); k++) {
      if (isHigh && (bars[i].h <= bars[i - k].h || bars[i].h <= bars[i + k].h)) isHigh = false;
      if (isLow && (bars[i].l >= bars[i - k].l || bars[i].l >= bars[i + k].l)) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

// Looks for one directional setup (bull or bear) within the trailing `window`
// bars: a swing pivot -> a wick-through-and-close-back sweep of it -> a
// structure break in the opposite direction (MSS) -> a fair value gap
// somewhere in that reversal leg. Returns null if the chain doesn't complete.
function findSetup(bars, highs, lows, searchFrom, dir) {
  const n = bars.length;
  const pivots = dir === "bull" ? lows : highs;
  const candidates = pivots.filter((idx) => idx >= searchFrom && idx < n - 1);

  for (let pi = candidates.length - 1; pi >= 0; pi--) {
    const swingIdx = candidates[pi];
    const swingLevel = dir === "bull" ? bars[swingIdx].l : bars[swingIdx].h;

    // Sweep: a later bar wicks beyond the pivot but closes back on the other side.
    let sweepIdx = null;
    for (let i = swingIdx + 1; i < n; i++) {
      const wickedThrough = dir === "bull" ? bars[i].l < swingLevel : bars[i].h > swingLevel;
      const closedBack = dir === "bull" ? bars[i].c > swingLevel : bars[i].c < swingLevel;
      if (wickedThrough && closedBack) { sweepIdx = i; break; }
      // Structure actually broke through and held — this pivot's liquidity
      // wasn't "swept", it was invalidated. Try an earlier pivot instead.
      const brokeForReal = dir === "bull" ? bars[i].c < swingLevel : bars[i].c > swingLevel;
      if (brokeForReal) break;
    }
    if (sweepIdx == null) continue;

    // MSS: the opposing structure level between the pivot and the sweep, then
    // a close beyond it afterwards confirms the shift.
    const oppositePivots = (dir === "bull" ? highs : lows).filter((idx) => idx > swingIdx && idx < sweepIdx);
    if (!oppositePivots.length) continue;
    const mssLevel = dir === "bull"
      ? Math.max(...oppositePivots.map((idx) => bars[idx].h))
      : Math.min(...oppositePivots.map((idx) => bars[idx].l));

    let mssIdx = null;
    for (let i = sweepIdx + 1; i < n; i++) {
      if (dir === "bull" ? bars[i].c > mssLevel : bars[i].c < mssLevel) { mssIdx = i; break; }
    }
    if (mssIdx == null) continue;

    // Fair Value Gap: any 3-candle imbalance in the reversal leg (sweep -> now).
    let fvg = null;
    for (let i = sweepIdx + 1; i < n - 2; i++) {
      if (dir === "bull" && bars[i].h < bars[i + 2].l) {
        fvg = { startIdx: i, top: bars[i + 2].l, bottom: bars[i].h };
        break;
      }
      if (dir === "bear" && bars[i].l > bars[i + 2].h) {
        fvg = { startIdx: i, top: bars[i].l, bottom: bars[i + 2].h };
        break;
      }
    }

    // Breaker Block candidate — last opposite-colored candle before the MSS
    // break. Surfaced as a pointer only; confirm it yourself on the chart.
    let breaker = null;
    for (let i = mssIdx - 1; i >= sweepIdx; i--) {
      const bullishCandle = bars[i].c >= bars[i].o;
      if (dir === "bull" ? !bullishCandle : bullishCandle) {
        breaker = { index: i, high: bars[i].h, low: bars[i].l };
        break;
      }
    }

    return { dir, swingIdx, swingLevel, sweepIdx, mssIdx, mssLevel, fvg, breaker };
  }
  return null;
}

// bars: the timeframe you're screening/entering on (4H recommended, per the checklist).
export function analyzeLiquiditySweep(sym, mkt, bars, { lookback = 3, window = 60 } = {}) {
  if (!bars || bars.length < lookback * 2 + 20) return null;
  const n = bars.length;
  const price = bars[n - 1].c;
  const chg = ((price - bars[n - 2].c) / bars[n - 2].c) * 100;
  const { highs, lows } = swingPivots(bars, lookback);
  const searchFrom = Math.max(0, n - window);

  const bull = findSetup(bars, highs, lows, searchFrom, "bull");
  const bear = findSetup(bars, highs, lows, searchFrom, "bear");
  // If both directions somehow qualify (rare), prefer whichever shifted structure more recently.
  const setup = bull && bear ? (bull.mssIdx >= bear.mssIdx ? bull : bear) : bull || bear;

  if (!setup) {
    return {
      symbol: sym, mkt, price, chg,
      bias: null,
      checklist: { sweep: false, mss: false, fvg: false },
      breaker: null, setupReady: false,
      entry: null, stop: null, target: null, rr: null,
      barsAgo: null,
    };
  }

  const { dir, sweepIdx, mssIdx, fvg, breaker } = setup;
  const hasFvg = !!fvg;
  const setupReady = hasFvg; // sweep + MSS are required just to reach `setup`; FVG is the last automated gate

  let entry = null, stop = null, target = null, rr = null;
  if (setupReady) {
    entry = (fvg.top + fvg.bottom) / 2;
    stop = dir === "bull" ? bars[sweepIdx].l : bars[sweepIdx].h;
    const risk = Math.abs(entry - stop);
    target = dir === "bull" ? entry + 2 * risk : entry - 2 * risk;
    rr = 2; // fixed 1:2 risk/reward by construction
  }

  return {
    symbol: sym, mkt, price, chg,
    bias: dir === "bull" ? "long" : "short",
    checklist: { sweep: true, mss: true, fvg: hasFvg },
    fvgZone: fvg ? { top: fvg.top, bottom: fvg.bottom } : null,
    breaker,
    setupReady,
    entry, stop, target, rr,
    barsAgo: n - 1 - mssIdx,
  };
}

// ---------------------------------------------------------------------------
// 1H entry strategy: 4H sets the reversal bias (which way the market has
// shifted on the higher timeframe), 1H is where the entry trigger lives —
// its own independent Sweep -> MSS -> FVG checklist, run on the 1H candles.
// A setup is only "ready" when the 1H checklist completes AND its direction
// agrees with the 4H bias; entry/stop/target come from the 1H setup (tighter,
// more precise than trading the 4H swing directly), same as the standard
// ICT top-down approach: higher timeframe for context, lower for timing.
// ---------------------------------------------------------------------------
export function analyzeMTF(sym, mkt, bars4h, bars1h) {
  const s4h = analyzeLiquiditySweep(sym, mkt, bars4h);
  const s1h = analyzeLiquiditySweep(sym, mkt, bars1h);
  if (!s4h || !s1h) return null;

  const aligned = !!(s4h.bias && s1h.bias && s4h.bias === s1h.bias);
  const ready = aligned && s1h.setupReady;

  return {
    symbol: sym, mkt,
    price: s1h.price, chg: s1h.chg,
    bias4h: s4h.bias,
    bias1h: s1h.bias,
    aligned,
    checklist: s1h.checklist, // the 1H entry-trigger checklist
    breaker: s1h.breaker,     // 1H breaker candidate
    barsAgo: s1h.barsAgo,     // bars since the 1H MSS
    setupReady: ready,
    entry: ready ? s1h.entry : null,
    stop: ready ? s1h.stop : null,
    target: ready ? s1h.target : null,
    rr: ready ? s1h.rr : null,
    s4h, s1h, // raw sub-results, handy for a detailed readout
  };
}
