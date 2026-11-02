// Merge rules for data that lives both in the browser and in KV. Pure functions, used by the
// client and by /api/sync, so both sides always agree on who wins.
//
// Journal entries merge per entry: the higher updatedAt wins. A deleted entry is kept as a
// tombstone ({ id, deleted: true, updatedAt }) so a delete on one device isn't undone by another
// device that still has the old copy. Alert settings are a single record; the newer one wins.

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const stamp = (e) => String(e?.updatedAt || e?.createdAt || "");

export function mergeJournal(a = [], b = []) {
  const byId = new Map();
  for (const e of [...a, ...b]) {
    if (!e || typeof e.id !== "string") continue;
    const prev = byId.get(e.id);
    if (!prev) { byId.set(e.id, e); continue; }
    const sp = stamp(prev), se = stamp(e);
    if (se > sp || (se === sp && e.deleted && !prev.deleted)) byId.set(e.id, e);
  }
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  return [...byId.values()]
    .filter((e) => !(e.deleted && Date.parse(e.updatedAt) < cutoff))
    .sort((x, y) => String(y.createdAt || y.updatedAt || "").localeCompare(String(x.createdAt || x.updatedAt || "")));
}

export function mergeAlerts(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
}

const GRADES = new Set(["A+", "A", "B"]);

/** Server-side clean-up of alert settings from the client: known keys only, sane types. */
export function sanitizeAlerts(s) {
  if (!s || typeof s !== "object") return null;
  const ev = s.events && typeof s.events === "object" ? s.events : {};
  return {
    enabled: !!s.enabled,
    webhook: typeof s.webhook === "string" ? s.webhook.slice(0, 300) : "",
    minGrade: GRADES.has(s.minGrade) ? s.minGrade : "A",
    events: { entry: ev.entry !== false, tp1: ev.tp1 !== false, tp2: ev.tp2 !== false, stop: ev.stop !== false },
    updatedAt: Number.isFinite(s.updatedAt) ? s.updatedAt : 0,
  };
}

export function sanitizeJournal(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e === "object" && typeof e.id === "string" && e.id.length <= 64)
    .slice(0, 5000);
}
