// Browser side of the per-wallet sync. The journal and alert settings keep living in localStorage
// (so the app works offline and without KV); this module copies them to and from /api/sync.
import { mergeAlerts, mergeJournal } from "@/lib/syncMerge";

const JOURNAL_KEY = "paldo.journal.v1";
const SETTINGS_KEY = "paldo.alerts.settings.v1";
const OWNER_KEY = "paldo.sync.owner";
export const SYNCED_EVENT = "paldo:synced";

let ready = false;      // true once the first pull for this wallet has finished
let enabled = true;     // false when the server has no KV bound
let timer = null;
let lastPull = 0;

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** Called by the journal and alerts modules after every local save. */
export function queuePush() {
  if (typeof window === "undefined" || !ready || !enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => { sync().catch(() => {}); }, 1500);
}

async function sync() {
  const local = { journal: read(JOURNAL_KEY, []), alerts: read(SETTINGS_KEY, null) };
  const r = await fetch("/api/sync", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(local),
  });
  if (!r.ok) return;
  const data = await r.json();
  if (data.enabled === false) { enabled = false; return; }
  const journal = mergeJournal(local.journal, data.journal);
  const alerts = mergeAlerts(local.alerts, data.alerts);
  const changed = JSON.stringify(journal) !== JSON.stringify(local.journal) || JSON.stringify(alerts) !== JSON.stringify(local.alerts);
  if (changed) {
    write(JOURNAL_KEY, journal);
    if (alerts) write(SETTINGS_KEY, alerts);
    window.dispatchEvent(new Event(SYNCED_EVENT));
  }
  lastPull = Date.now();
}

/**
 * Start syncing for the signed-in wallet. Local data that belongs to a different wallet (same
 * browser, different login) is dropped first, so one wallet's journal is never pushed to another's.
 */
export async function startSync(address) {
  if (typeof window === "undefined") return;
  const owner = (() => { try { return window.localStorage.getItem(OWNER_KEY); } catch { return null; } })();
  const me = address.toLowerCase();
  if (owner && owner !== me) {
    try {
      window.localStorage.removeItem(JOURNAL_KEY);
      window.localStorage.removeItem(SETTINGS_KEY);
    } catch {}
    window.dispatchEvent(new Event(SYNCED_EVENT));
  }
  try { window.localStorage.setItem(OWNER_KEY, me); } catch {}

  try { await sync(); } catch {}
  ready = true;

  // Pick up changes made on another device when this tab comes back into view.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && enabled && Date.now() - lastPull > 30_000) sync().catch(() => {});
  });
}
