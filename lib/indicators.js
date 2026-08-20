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
