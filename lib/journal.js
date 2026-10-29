// Trade journal — a browser-local log of the trades you actually took, as
// opposed to what the scanner flags as a valid setup. Same storage pattern as
// lib/alerts.js (localStorage, wrapped in try/catch so a private-browsing
// tab or a full quota doesn't crash the page).
//
// Why this exists: grading and R:R math tell you what the strategy *should*
// do; only your own logged outcomes tell you what it actually did for you.
// Building a real sample (50+ trades) before trusting a win rate is the
// whole point — see the "why-card" grading rationale in lib/indicators.js.

const KEY = "paldo.journal.v1";

export function loadJournal() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveJournal(entries) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // storage full or unavailable — journal just won't persist this write
  }
}

function makeId() {
  return `j_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Builds a journal entry from a live Strat#5 result row (the same shape
// Dashboard.jsx / AssetDetail.jsx get back from analyzeMTF). Pulls a
// snapshot of the setup as it stood the moment you logged it — the journal
// never re-reads live prices, so it stays a record of what you actually saw.
export function newEntryFromSetup(r, pairing) {
  return {
    id: makeId(),
    createdAt: new Date().toISOString(),
    source: "scanner",
    symbol: r?.symbol ?? "",
    mkt: r?.mkt ?? "crypto",
    pairing: pairing ?? null,
    direction: r?.biasLow ?? r?.biasHigh ?? null,
    grade: r?.grade ?? null,
    entry: r?.entry ?? null,
    stop: r?.stop ?? null,
    tp1: r?.tp1 ?? null,
    tp2: r?.tp2 ?? null,
    poi: r?.poi ?? null,
    status: "open",
    exitPrice: null,
    notes: "",
  };
}

// Blank/manual entry — for trades taken outside a Strat#5 alert, or logged
// after the fact from memory. Every field is optional; symbol is the only
// one worth requiring in the UI.
export function newManualEntry(fields = {}) {
  return {
    id: makeId(),
    createdAt: new Date().toISOString(),
    source: "manual",
    symbol: fields.symbol || "",
    mkt: fields.mkt || "crypto",
    pairing: fields.pairing || null,
    direction: fields.direction || null,
    grade: fields.grade || null,
    entry: fields.entry ?? null,
    stop: fields.stop ?? null,
    tp1: fields.tp1 ?? null,
    tp2: fields.tp2 ?? null,
    poi: null,
    status: fields.status || "open",
    exitPrice: fields.exitPrice ?? null,
    notes: fields.notes || "",
  };
}

export function addJournalEntry(entry) {
  const list = [entry, ...loadJournal()];
  saveJournal(list);
  return list;
}

export function updateJournalEntry(id, patch) {
  const list = loadJournal().map((e) => (e.id === id ? { ...e, ...patch } : e));
  saveJournal(list);
  return list;
}

export function removeJournalEntry(id) {
  const list = loadJournal().filter((e) => e.id !== id);
  saveJournal(list);
  return list;
}

// Outcome statuses a logged trade can be marked as. Realized R is an
// approximation, not exact accounting — it assumes the standard Strat#5
// scale-out (half the position banked at TP1, the rest to TP2/stop/breakeven)
// unless the trade was closed manually, in which case R is computed from the
// actual exit price against the original entry/stop distance.
export const JOURNAL_STATUSES = {
  open: { label: "Open / running", cls: "warn" },
  tp1_only: { label: "Closed at TP1 (+1R)", cls: "long" },
  tp2: { label: "Ran to TP2 (~+1.5R)", cls: "long" },
  breakeven: { label: "Stopped at breakeven (~+0.5R)", cls: "flat" },
  stopped: { label: "Stopped out (-1R)", cls: "short" },
  closed_manual: { label: "Closed manually", cls: "flat" },
};

// Approximate realized R for a logged trade, or null while it's still open
// or if a manual close is missing the data needed to compute it.
export function realizedR(e) {
  if (!e) return null;
  switch (e.status) {
    case "tp1_only":
      return 1;
    case "tp2":
      return 1.5; // half banked at 1R + half at 2R, the standard Strat#5 scale-out
    case "breakeven":
      return 0.5; // half banked at 1R, the rest closed flat at break-even
    case "stopped":
      return -1;
    case "closed_manual": {
      if (e.exitPrice == null || e.entry == null || e.stop == null) return null;
      const risk = Math.abs(e.entry - e.stop);
      if (!risk) return null;
      const dir = e.direction === "short" ? -1 : 1;
      return ((e.exitPrice - e.entry) / risk) * dir;
    }
    default:
      return null; // open
  }
}

// Summary stats across the whole journal — the numbers that actually matter
// more than any theoretical win rate: how many trades you've logged, how
// many are closed, and what your own realized win rate and average R are.
export function journalStats(entries) {
  const total = entries.length;
  const open = entries.filter((e) => e.status === "open").length;
  const closed = entries.filter((e) => e.status !== "open");
  const withR = closed.map((e) => ({ e, r: realizedR(e) })).filter((x) => x.r != null);
  const wins = withR.filter((x) => x.r > 0).length;
  const losses = withR.filter((x) => x.r < 0).length;
  const flat = withR.filter((x) => x.r === 0).length;
  const totalR = withR.reduce((s, x) => s + x.r, 0);
  const decided = wins + losses; // breakeven trades excluded from win-rate denominator
  return {
    total,
    open,
    closedCount: closed.length,
    wins,
    losses,
    flat,
    winRatePct: decided ? (wins / decided) * 100 : null,
    totalR,
    avgR: withR.length ? totalR / withR.length : null,
  };
}
