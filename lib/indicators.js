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
    const hasVol = chunk.every((x) => x.v != null);
    out.push({
      t: chunk[0].t,
      o: chunk[0].o,
      h: Math.max(...chunk.map((x) => x.h)),
      l: Math.min(...chunk.map((x) => x.l)),
      c: chunk[chunk.length - 1].c,
      v: hasVol ? chunk.reduce((s, x) => s + x.v, 0) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry strategies. Each strategy is a self-contained setup definition; the
// scanner can eventually run several side by side, so they're registered here
// by id rather than hard-coded into the UI.
// ---------------------------------------------------------------------------
export const STRATEGIES = {
  strat5: {
    id: "strat5",
    name: "Strat#5",
    short: "Liquidity Sweep → MSS → Breaker Block → FVG",
    title: "Strat#5 — Liquidity Sweep → MSS → Breaker Block → FVG (1:2 R:R)",
  },
};
export const DEFAULT_STRATEGY = "strat5";

// ---------------------------------------------------------------------------
// Strat#5 — ICT/SMC liquidity-sweep checklist:
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
      volume: null,
      fvgZone: null, sweepLevel: null, sweepIdx: null, mssLevel: null, mssIdx: null,
    };
  }

  const { dir, swingLevel, sweepIdx, mssIdx, mssLevel, fvg, breaker } = setup;
  const hasFvg = !!fvg;

  // Volume measured on the actual MSS confirmation candle — the reversal
  // event itself — not just whatever the most recent candle happens to be.
  const volume = volumeConfluenceAt(bars, mssIdx);

  // Geometry check. The Fair Value Gap can occasionally form on the *wrong
  // side* of the sweep extreme — price sweeps a low, shifts structure up, then
  // retraces and leaves a gap below the sweep candle's low. That yields a long
  // whose stop sits above its entry: risk is inverted and every target
  // computed off it is meaningless (a 1R target would land exactly on the
  // stop). Such a setup isn't tradeable as written, so it doesn't count as
  // ready — sweep/MSS/FVG still report honestly in the checklist.
  let entry = null, stop = null, validGeometry = false;
  if (hasFvg) {
    const e = (fvg.top + fvg.bottom) / 2;
    const s = dir === "bull" ? bars[sweepIdx].l : bars[sweepIdx].h;
    validGeometry = dir === "bull" ? s < e : s > e;
    if (validGeometry) { entry = e; stop = s; }
  }
  const setupReady = hasFvg && validGeometry;

  let target = null, rr = null;
  if (setupReady) {
    const risk = Math.abs(entry - stop);
    target = dir === "bull" ? entry + 2 * risk : entry - 2 * risk;
    rr = 2; // fixed 1:2 by construction; analyzeMTF splits this into TP1/TP2
  }

  return {
    symbol: sym, mkt, price, chg,
    bias: dir === "bull" ? "long" : "short",
    checklist: { sweep: true, mss: true, fvg: hasFvg },
    // fromIdx/toIdx are bar indices into the *same* `bars` array passed in —
    // callers with access to that array (e.g. a chart) can look up the real
    // time of the gap's start/end candles to draw it in the right place.
    fvgZone: fvg ? { top: fvg.top, bottom: fvg.bottom, fromIdx: fvg.startIdx, toIdx: fvg.startIdx + 2 } : null,
    breaker,
    setupReady,
    entry, stop, target, rr,
    barsAgo: n - 1 - mssIdx,
    volume, // volume confluence at the MSS candle — see volumeConfluenceAt()
    sweepLevel: swingLevel, // the swing level that got swept (liquidity pool)
    sweepIdx,               // bar index of the sweep candle
    mssLevel,                // the opposing structure level that confirmed the shift
    mssIdx,                  // bar index of the MSS confirmation candle
  };
}

// Nearest not-yet-broken opposing swing level on the higher timeframe, ahead
// of price in the trade direction — the liquidity pool ("Point of Interest")
// the move is likely reaching for. Long -> next swing high above price that
// no later close has broken through; short -> next swing low below price.
// Returns null if no such level exists yet (caller should fall back to a
// fixed R:R target in that case).
function nextPOI(bars, dir, lookback = 3) {
  if (!bars || bars.length < lookback * 2 + 5 || (dir !== "long" && dir !== "short")) return null;
  const { highs, lows } = swingPivots(bars, lookback);
  const price = bars[bars.length - 1].c;
  const pivots = dir === "long" ? highs : lows;

  const candidates = [];
  for (const idx of pivots) {
    const level = dir === "long" ? bars[idx].h : bars[idx].l;
    const aheadOfPrice = dir === "long" ? level > price : level < price;
    if (!aheadOfPrice) continue;
    let broken = false;
    for (let i = idx + 1; i < bars.length; i++) {
      if (dir === "long" ? bars[i].c > level : bars[i].c < level) { broken = true; break; }
    }
    if (!broken) candidates.push(level);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a - price) - Math.abs(b - price));
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Strat#5, paired to a higher timeframe for bias:
//   higherBars sets the reversal bias (Sweep -> MSS on the higher TF).
//   lowerBars is the entry trigger — its own independent Sweep -> MSS -> FVG
//   checklist, run on the lower-timeframe candles.
// A setup is only "ready" when the lower-TF checklist completes AND its
// direction agrees with the higher-TF bias. Target is the next unswept
// opposing swing (liquidity pool / POI) on the HIGHER timeframe ahead of
// price — not a fixed R:R — falling back to the lower TF's fixed 1:2 target
// when no such level exists yet. Works for any pairing, e.g. 4H bias with a
// 15m entry, or 1H bias with a 5m entry.
// ---------------------------------------------------------------------------
// Is this still catchable, or has price already moved on? Compares the
// latest close to the entry/stop/TP levels rather than just counting bars — a
// setup can be "fresh" by bar count but already have run away (no pullback
// into the FVG yet), or be many bars old but still sitting right at entry.
// Ordering for a long is stop < entry < tp1 < tp2 (mirrored for short):
//   invalidated — price already traded through the stop; setup is dead.
//   in_zone     — price has pulled back into the entry zone; catch it now.
//   running     — price never pulled back and is already between entry and
//                 TP1; chasing here means worse risk/reward than planned.
//   tp1_hit     — TP1 (1:1) is already banked; only the TP2 runner is left.
//   tp2_hit     — both targets are done; this one has fully played out.
function entryWindowStatus(dir, price, entry, stop, tp1, tp2) {
  if (dir === "long") {
    if (price <= stop) return "invalidated";
    if (price <= entry) return "in_zone";
    if (price < tp1) return "running";
    if (price < tp2) return "tp1_hit";
    return "tp2_hit";
  }
  if (price >= stop) return "invalidated";
  if (price >= entry) return "in_zone";
  if (price > tp1) return "running";
  if (price > tp2) return "tp1_hit";
  return "tp2_hit";
}

// Trend-strength metric: latest ADX reading on the higher (bias) timeframe.
// ADX > 20 is the conventional line between "trending enough to trust a
// structure shift" and "choppy/ranging". Exposed as an optional *filter* only
// — it never decides whether a Strat#5 setup exists.
function trendStrength(bars, period = 14) {
  if (!bars || bars.length < period * 2 + 1) return null;
  const { adx: adxArr } = adx(bars.map((b) => b.h), bars.map((b) => b.l), bars.map((b) => b.c), period);
  for (let i = adxArr.length - 1; i >= 0; i--) {
    if (adxArr[i] != null) return adxArr[i];
  }
  return null;
}

// Volatility metric: ATR(14) expressed as a percentage of the latest close,
// so it's comparable across assets priced in wildly different units (BTC at
// ~$77k vs EURUSD at ~1.08). Roughly: < 0.5% is a quiet/rangebound market,
// > 2% is a fast-moving one. Exposed as an optional filter — useful for
// skipping assets too sluggish to reach target, or too wild for the stop.
export function volatilityPct(bars, period = 14) {
  if (!bars || bars.length < period + 2) return null;
  const atrArr = atr(bars.map((b) => b.h), bars.map((b) => b.l), bars.map((b) => b.c), period);
  const price = bars[bars.length - 1].c;
  for (let i = atrArr.length - 1; i >= 0; i--) {
    if (atrArr[i] != null) return price > 0 ? (atrArr[i] / price) * 100 : null;
  }
  return null;
}

// Volume metric: was the Market Structure Shift confirmation candle
// itself — the bar whose close actually broke the opposing structure level —
// trading on noticeably higher volume than its own trailing average? A real
// reversal tends to show a burst of participation right as structure breaks;
// a quiet break is more likely a fakeout. Works the same way for a bullish or
// a bearish shift — only the bar being checked (the MSS candle) differs.
// Returns null when volume data isn't available or there isn't enough history
// before the MSS candle, rather than silently failing the check.
function volumeConfluenceAt(bars, idx, lookback = 20, highMultiple = 1.5) {
  if (!bars || idx == null || idx < lookback) return null;
  const window = bars.slice(idx - lookback, idx);
  if (window.some((b) => b.v == null) || bars[idx].v == null) return null;
  const avg = window.reduce((s, b) => s + b.v, 0) / window.length;
  const current = bars[idx].v;
  const ratio = avg > 0 ? current / avg : 0;
  return { current, avg, ratio, high: ratio >= highMultiple };
}

// ---------------------------------------------------------------------------
// Setup grading — A+ / A / B.
//
// Grades measure the *structural quality* of a completed Strat#5 setup, not
// its timing. Deliberately excluded: the entry window (in_zone / running /
// etc). Whether price happens to be sitting in the gap right now is a
// question of when to act, not of how good the setup is — folding it into
// the grade would make a setup's grade flicker as price wanders around.
//
// Every factor is scored transparently and returned in `reasons`, so the
// scanner and the Discord alert can both explain exactly why a setup earned
// its grade rather than showing an unexplained letter.
// ---------------------------------------------------------------------------
const GRADE_RULES = [
  {
    key: "poi",
    // The single most important one: TP2 sits at 2R, so if the next liquidity
    // pool sits *inside* that, price has a natural reason to stall or reverse
    // before TP2 fills. Room beyond 2R is what makes the runner realistic.
    score: (m) => (m.poiR == null ? 1 : m.poiBeyondTp2 ? 3 : 0),
    max: 3,
    label: "Room to TP2",
    detail: (m) =>
      m.poiR == null
        ? "No unswept pool ahead — nothing obvious blocking TP2, but no magnet pulling price either"
        : m.poiBeyondTp2
        ? `Next liquidity sits at ${m.poiR.toFixed(1)}R — beyond TP2, so the runner has clear room`
        : `Next liquidity sits at ${m.poiR.toFixed(1)}R — inside TP2, price may stall or reverse before the runner fills`,
  },
  {
    key: "adx",
    score: (m) => { const v = m.filters?.adx?.value; return v == null ? 0 : v >= 25 ? 2 : v >= 20 ? 1 : 0; },
    max: 2,
    label: "Trend strength",
    detail: (m) => { const v = m.filters?.adx?.value;
      return v == null ? "ADX unavailable"
        : v >= 25 ? `ADX ${v.toFixed(1)} — trending firmly, structure shifts carry`
        : v >= 20 ? `ADX ${v.toFixed(1)} — moderately trending`
        : `ADX ${v.toFixed(1)} — choppy, reversals here are more often noise`; },
  },
  {
    key: "volume",
    score: (m) => { const v = m.filters?.volume?.value; return v == null ? 0 : v >= 1.5 ? 2 : v >= 1.0 ? 1 : 0; },
    max: 2,
    label: "MSS participation",
    detail: (m) => { const v = m.filters?.volume?.value;
      return v == null ? "No volume data on this feed"
        : v >= 1.5 ? `Structure broke on ${v.toFixed(1)}× average volume — real participation behind the shift`
        : v >= 1.0 ? `${v.toFixed(1)}× average volume on the MSS candle — adequate`
        : `Only ${v.toFixed(1)}× average volume on the MSS candle — a quiet break is more easily faded`; },
  },
  {
    key: "fresh",
    score: (m) => (m.barsAgo == null ? 0 : m.barsAgo <= 5 ? 2 : m.barsAgo <= 12 ? 1 : 0),
    max: 2,
    label: "Freshness",
    detail: (m) =>
      m.barsAgo == null ? "Unknown age"
        : m.barsAgo <= 5 ? `${m.barsAgo} bar(s) since the structure shift — still fresh`
        : m.barsAgo <= 12 ? `${m.barsAgo} bars since the shift — ageing but valid`
        : `${m.barsAgo} bars since the shift — stale, the move has had time to play out`,
  },
  {
    key: "volatility",
    // A 2R move needs the asset to actually travel. Sub-0.5% ATR often can't.
    score: (m) => { const v = m.filters?.volatility?.value; return v != null && v >= 0.5 ? 1 : 0; },
    max: 1,
    label: "Volatility",
    detail: (m) => { const v = m.filters?.volatility?.value;
      return v == null ? "Volatility unavailable"
        : v >= 0.5 ? `ATR ${v.toFixed(2)}% — enough range to reach 2R`
        : `ATR ${v.toFixed(2)}% — sluggish, 2R may take a long time or never arrive`; },
  },
  {
    key: "breaker",
    score: (m) => (m.breaker ? 1 : 0),
    max: 1,
    label: "Breaker Block",
    detail: (m) => (m.breaker ? `Candidate found at candle ${m.breaker.index} — confirm visually` : "No clear breaker candidate to confirm"),
  },
];
const GRADE_MAX = GRADE_RULES.reduce((s, r) => s + r.max, 0); // 11

// A+ = 8+/11, A = 5-7, B = under 5.
export function gradeSetup(m) {
  if (!m || !m.setupReady) return null;
  let score = 0;
  const reasons = [];
  for (const rule of GRADE_RULES) {
    const s = rule.score(m);
    score += s;
    reasons.push({
      key: rule.key,
      label: rule.label,
      detail: rule.detail(m),
      score: s,
      max: rule.max,
      // strong = full marks, weak = zero, ok = partial
      tone: s === rule.max ? "strong" : s === 0 ? "weak" : "ok",
    });
  }
  const grade = score >= 8 ? "A+" : score >= 5 ? "A" : "B";
  return { grade, score, max: GRADE_MAX, reasons };
}

// Ranking helper so "A+ and A only" style thresholds are easy to express.
export const GRADE_RANK = { "A+": 3, A: 2, B: 1 };

// Default filter set — every filter off, so the scanner shows every valid
// Strat#5 setup until the user opts into narrowing it down.
export const DEFAULT_FILTERS = {
  adx: { on: false, min: 20 },
  volatility: { on: false, min: 0.5 },
  volume: { on: false, min: 1.5 },
};

// filters: optional screening applied *after* the strategy has already found a
// setup. Backtesting showed that gating setup detection on ADX/volume threw
// away a large share of valid, profitable Strat#5 entries — so these are now
// purely a way to narrow a result list, never a condition for a setup to
// exist. A filter that's off, or whose metric is unavailable for that asset,
// simply doesn't exclude anything unless it's explicitly switched on.
export function analyzeMTF(sym, mkt, higherBars, lowerBars, filters = DEFAULT_FILTERS) {
  const high = analyzeLiquiditySweep(sym, mkt, higherBars);
  const low = analyzeLiquiditySweep(sym, mkt, lowerBars);
  if (!high || !low) return null;

  const aligned = !!(high.bias && low.bias && high.bias === low.bias);

  // --- Strat#5 readiness: the checklist and nothing else ------------------
  // Sweep -> MSS -> FVG on the entry timeframe, agreeing with the higher-TF
  // bias. Breaker Block stays a visual confirmation step, as always.
  const ready = aligned && low.setupReady;

  // --- Optional filters (do not affect `ready`) ---------------------------
  const f = { ...DEFAULT_FILTERS, ...(filters || {}) };
  const adxValue = trendStrength(higherBars);
  const volValue = volatilityPct(higherBars);
  const volume = low.volume;
  const volumeRatio = volume && volume.ratio != null ? volume.ratio : null;

  // A filter passes when it's switched off, or when the metric exists and
  // clears the threshold. Missing data (e.g. no volume on some forex feeds)
  // only excludes an asset if the user actually turned that filter on.
  const gate = (cfg, value) => {
    if (!cfg || !cfg.on) return true;
    return value != null && value >= cfg.min;
  };
  const adxPass = gate(f.adx, adxValue);
  const volatilityPass = gate(f.volatility, volValue);
  const volumePass = gate(f.volume, volumeRatio);
  const filtersPass = adxPass && volatilityPass && volumePass;
  const anyFilterOn = !!(f.adx?.on || f.volatility?.on || f.volume?.on);

  // Scaled exits instead of one distant target. Taking the whole position to
  // the next liquidity pool meant an R:R that varied wildly with how far away
  // that pool happened to sit — often 4-5R, which looks great on paper but
  // rarely fills. Fixed 1R/2R exits are far likelier to actually be reached:
  //   TP1 = 1:1 — bank half, de-risk the trade.
  //   TP2 = 1:2 — the runner.
  // The POI (next unswept liquidity on the bias timeframe) is still computed
  // and marked on the chart, but as *context for where price is headed next*,
  // not as the exit itself. poiR says how far it sits in R multiples: below
  // ~1R and the path to TP1 is congested, well beyond 2R means room to run.
  let entry = null, stop = null, tp1 = null, tp2 = null, entryWindow = null;
  let poi = null, poiR = null, poiBeyondTp2 = null;
  if (ready) {
    entry = low.entry;
    stop = low.stop;
    const risk = Math.abs(entry - stop);
    tp1 = low.bias === "long" ? entry + risk : entry - risk;
    tp2 = low.bias === "long" ? entry + 2 * risk : entry - 2 * risk;
    poi = nextPOI(higherBars, low.bias);
    if (poi != null && risk > 0) {
      poiR = Math.abs(poi - entry) / risk;
      poiBeyondTp2 = poiR >= 2;
    }
    entryWindow = entryWindowStatus(low.bias, low.price, entry, stop, tp1, tp2);
  }

  const result = {
    symbol: sym, mkt,
    strategy: STRATEGIES.strat5.id,
    price: low.price, chg: low.chg,
    biasHigh: high.bias,
    biasLow: low.bias,
    aligned,
    checklist: low.checklist, // the lower-TF entry-trigger checklist
    breaker: low.breaker,     // lower-TF breaker candidate
    barsAgo: low.barsAgo,     // bars since the lower-TF MSS
    fvgZone: low.fvgZone,     // lower-TF Fair Value Gap, with bar indices for charting
    sweepLevel: low.sweepLevel, // lower-TF swept swing level
    sweepIdx: low.sweepIdx,
    mssLevel: low.mssLevel,     // lower-TF Market Structure Shift level
    mssIdx: low.mssIdx,
    // Screening metrics — each carries its live value, the threshold in play,
    // whether the user switched it on, and whether this asset clears it.
    filters: {
      adx: { value: adxValue, min: f.adx?.min ?? 0, on: !!f.adx?.on, pass: adxPass },
      volatility: { value: volValue, min: f.volatility?.min ?? 0, on: !!f.volatility?.on, pass: volatilityPass },
      volume: { value: volumeRatio, min: f.volume?.min ?? 0, on: !!f.volume?.on, pass: volumePass, avg: volume?.avg ?? null, current: volume?.current ?? null },
    },
    filtersPass,
    anyFilterOn,
    setupReady: ready,
    entry, stop,
    tp1, tp2,           // scaled exits: 1:1 and 1:2 by construction
    poi, poiR,          // next unswept liquidity on the bias TF + its distance in R
    poiBeyondTp2,       // true when the pool sits past TP2 — room for the runner
    entryWindow, // "invalidated" | "in_zone" | "running" | "tp1_hit" | "tp2_hit" | null
    high, low, // raw sub-results, handy for a detailed readout
  };
  // Graded after the fact — gradeSetup() reads the assembled fields above.
  result.quality = gradeSetup(result); // { grade, score, max, reasons } | null
  result.grade = result.quality?.grade ?? null;
  return result;
}
