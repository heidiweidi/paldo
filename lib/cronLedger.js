// Dedup ledger for the server-side cron scan (app/api/cron/scan).
//
// The client's alert ledger lives in localStorage (see lib/alerts.js), which
// doesn't exist on the edge. The cron route runs on a schedule with no
// browser involved, so "have we already alerted on this exact setup" has to
// be tracked somewhere that survives between invocations: Cloudflare KV.
//
// Falls back to an in-process Map when no KV binding is present (local dev,
// or a deployment that hasn't wired one up yet) — alerts still work, they
// just won't dedup across cold starts. That tradeoff is intentional: a
// missing KV binding should degrade alerting, not break the whole endpoint.
import { getRequestContext } from "@cloudflare/next-on-pages";

const memoryLedger = new Map();
const TTL_SECONDS = 7 * 24 * 60 * 60; // matches the client ledger's 7-day TTL

function getKV() {
  try {
    // getRequestContext() throws outside an actual Cloudflare Pages request
    // (plain `next dev`, or `next build`'s static analysis pass), so this
    // must only ever be called lazily, at request time, inside a try/catch.
    return getRequestContext()?.env?.ALERTS_KV || null;
  } catch {
    return null;
  }
}

/** Returns the subset of keys that have NOT already been sent. */
export async function filterUnsent(keys) {
  if (!keys.length) return keys;
  const kv = getKV();
  if (!kv) {
    const now = Date.now();
    return keys.filter((k) => {
      const sentAt = memoryLedger.get(k);
      return !(sentAt && now - sentAt < TTL_SECONDS * 1000);
    });
  }
  const checks = await Promise.all(keys.map((k) => kv.get(`alert:${k}`)));
  return keys.filter((_, i) => checks[i] == null);
}

export async function markSent(keys) {
  if (!keys.length) return;
  const kv = getKV();
  if (!kv) {
    const now = Date.now();
    for (const k of keys) memoryLedger.set(k, now);
    return;
  }
  await Promise.all(keys.map((k) => kv.put(`alert:${k}`, "1", { expirationTtl: TTL_SECONDS })));
}
