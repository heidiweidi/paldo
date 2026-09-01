// Alert engine: turns scan results into de-duplicated Discord notifications.
//
// The core problem this solves is *repeat firing*. The scanner re-scores on
// every scan and on every filter change, so naively alerting on "price is in
// the entry zone" would spam the same setup indefinitely. Instead we alert on
// the transition into a state, and remember what we've already sent in a
// ledger that survives page reloads — otherwise a refresh would replay every
// alert you'd already seen.
import { GRADE_RANK } from "@/lib/indicators";

const LEDGER_KEY = "paldo.alerts.ledger.v1";
const SETTINGS_KEY = "paldo.alerts.settings.v1";
const LEDGER_TTL_MS = 7 * 24 * 60 * 60 * 1000; // forget setups after a week

export const ALERT_EVENTS = {
  entry: { key: "entry", window: "in_zone", label: "Entry in zone", colour: 0x4c8dff, emoji: "🎯" },
  tp1: { key: "tp1", window: "tp1_hit", label: "TP1 hit (1:1)", colour: 0x1fbf75, emoji: "✅" },
  tp2: { key: "tp2", window: "tp2_hit", label: "TP2 hit (1:2)", colour: 0x14a06a, emoji: "🏁" },
  stop: { key: "stop", window: "invalidated", label: "Stop hit — invalidated", colour: 0xff5470, emoji: "🛑" },
};

export const DEFAULT_ALERT_SETTINGS = {
  enabled: false,
  webhook: "",
  minGrade: "A", // alert on A and above; "B" = everything, "A+" = only the best
  events: { entry: true, tp1: true, tp2: true, stop: true },
};

// --- persistence -----------------------------------------------------------
// All storage access is wrapped: Safari private mode and some embedded
// browsers throw on localStorage rather than just returning null.
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full — alerts still work for this session */
  }
}

export function loadSettings() {
  const s = readJSON(SETTINGS_KEY, null);
  if (!s) return { ...DEFAULT_ALERT_SETTINGS };
  return {
    ...DEFAULT_ALERT_SETTINGS,
    ...s,
    events: { ...DEFAULT_ALERT_SETTINGS.events, ...(s.events || {}) },
  };
}
export function saveSettings(s) {
  writeJSON(SETTINGS_KEY, s);
}

function loadLedger() {
  const l = readJSON(LEDGER_KEY, {});
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(l)) {
    if (typeof l[k] !== "number" || now - l[k] > LEDGER_TTL_MS) { delete l[k]; changed = true; }
  }
  if (changed) writeJSON(LEDGER_KEY, l);
  return l;
}

// A setup's identity includes its entry price, so when a genuinely new setup
// forms on the same symbol/timeframe it gets a fresh set of alerts rather
// than being suppressed by the previous one's ledger entries.
function setupId(row, pairing) {
  const e = row.entry != null ? row.entry.toPrecision(8) : "na";
  const s = row.stop != null ? row.stop.toPrecision(8) : "na";
  return `${row.symbol}|${pairing}|${e}|${s}`;
}
function ledgerKey(row, pairing, eventKey) {
  return `${setupId(row, pairing)}|${eventKey}`;
}

/**
 * Compare current rows against the ledger and return the alerts that should
 * fire now. Does not send anything and does not mutate the ledger — call
 * markSent() once delivery succeeds, so a failed send is retried next scan
 * instead of being silently swallowed.
 */
export function collectAlerts(rows, pairing, settings) {
  if (!settings?.enabled) return [];
  const ledger = loadLedger();
  const minRank = GRADE_RANK[settings.minGrade] ?? 2;
  const out = [];

  for (const row of rows) {
    if (!row?.setupReady || !row.grade) continue;
    if ((GRADE_RANK[row.grade] ?? 0) < minRank) continue;

    for (const ev of Object.values(ALERT_EVENTS)) {
      if (!settings.events?.[ev.key]) continue;
      if (row.entryWindow !== ev.window) continue;
      const key = ledgerKey(row, pairing, ev.key);
      if (ledger[key]) continue; // already sent for this exact setup
      out.push({ key, event: ev, row, pairing });
    }
  }
  return out;
}

export function markSent(keys) {
  if (!keys?.length) return;
  const ledger = loadLedger();
  const now = Date.now();
  for (const k of keys) ledger[k] = now;
  writeJSON(LEDGER_KEY, ledger);
}

export function clearLedger() {
  try { localStorage.removeItem(LEDGER_KEY); } catch {}
}

// --- message formatting ----------------------------------------------------
function fmt(n, sym) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const dp = sym && sym.includes("JPY") ? 3 : abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return n.toLocaleString(undefined, { minimumFractionDigits: dp > 4 ? 2 : dp, maximumFractionDigits: dp });
}

const PAIRING_LABEL = { A: "4H bias → 15m entry", B: "1H bias → 5m entry" };

export function buildEmbed({ event, row, pairing }, siteUrl) {
  const sym = row.symbol;
  const dir = row.biasLow === "long" ? "LONG" : "SHORT";
  const q = row.quality;

  // Why this grade — the strong points first, then whatever is dragging it
  // down, so the message answers "should I take this?" not just "here's a
  // letter".
  const strong = (q?.reasons || []).filter((r) => r.tone === "strong");
  const weak = (q?.reasons || []).filter((r) => r.tone === "weak");
  const whyLines = [];
  for (const r of strong.slice(0, 4)) whyLines.push(`✅ ${r.detail}`);
  for (const r of weak.slice(0, 3)) whyLines.push(`⚠️ ${r.detail}`);

  const fields = [
    { name: "Entry", value: `\`${fmt(row.entry, sym)}\``, inline: true },
    { name: "Stop", value: `\`${fmt(row.stop, sym)}\``, inline: true },
    { name: "​", value: "​", inline: true },
    { name: "TP1 (1:1)", value: `\`${fmt(row.tp1, sym)}\``, inline: true },
    { name: "TP2 (1:2)", value: `\`${fmt(row.tp2, sym)}\``, inline: true },
    {
      name: "POI",
      value: row.poi != null ? `\`${fmt(row.poi, sym)}\` · ${row.poiR != null ? `${row.poiR.toFixed(1)}R` : "—"}` : "none ahead",
      inline: true,
    },
  ];

  if (whyLines.length) {
    fields.push({
      name: `Why ${q?.grade ?? "?"} (${q?.score ?? 0}/${q?.max ?? 0})`,
      value: whyLines.join("\n").slice(0, 1024),
      inline: false,
    });
  }

  // Action line tailored to the event — the whole point is that the user can
  // act straight from the notification without opening the site.
  const action =
    event.key === "entry"
      ? `Price has pulled back into the FVG. Risking to \`${fmt(row.stop, sym)}\`, scale out half at TP1 \`${fmt(row.tp1, sym)}\`.`
      : event.key === "tp1"
      ? `TP1 filled — bank half and move the stop to break-even (\`${fmt(row.entry, sym)}\`). Runner targets \`${fmt(row.tp2, sym)}\`.`
      : event.key === "tp2"
      ? "TP2 filled — trade complete."
      : "Price traded through the stop. This setup is dead — don't re-enter on it.";

  const embed = {
    title: `${event.emoji} ${sym} · ${dir} · ${event.label}`,
    description: `**${q?.grade ?? "?"} setup** — Strat#5, ${PAIRING_LABEL[pairing] || pairing}\n${action}`,
    color: event.colour,
    fields,
    footer: { text: `Paldo · ${row.mkt === "crypto" ? "Crypto" : "Forex/Gold"} · educational simulation, not financial advice` },
    timestamp: new Date().toISOString(),
  };
  if (siteUrl) embed.url = `${siteUrl}/asset/${encodeURIComponent(sym)}?mkt=${row.mkt}&pairing=${pairing}`;
  return embed;
}

/** POSTs a batch of alerts through the edge relay. Returns the keys that were delivered. */
export async function sendAlerts(alerts, settings, siteUrl) {
  if (!alerts.length) return [];
  const delivered = [];
  // Sent one at a time: Discord rate-limits webhooks, and a single failure
  // shouldn't discard the whole batch.
  for (const a of alerts) {
    try {
      const r = await fetch("/api/discord", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          webhook: settings.webhook || undefined,
          embeds: [buildEmbed(a, siteUrl)],
        }),
      });
      if (r.ok) delivered.push(a.key);
      else if (r.status === 429) break; // rate-limited: stop, retry next scan
    } catch {
      /* network hiccup — leave it unmarked so it retries on the next scan */
    }
  }
  return delivered;
}
