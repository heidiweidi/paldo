// Per-wallet storage for the trade journal and alert settings, so they follow the wallet across
// devices. The wallet comes from the session cookie, never from the request, so one wallet can't
// read or write another's data.
export const runtime = "edge";

import { getKV } from "@/lib/kv";
import { json, sameOrigin, sessionFromCookieHeader } from "@/lib/sessionCore";
import { mergeAlerts, mergeJournal, sanitizeAlerts, sanitizeJournal } from "@/lib/syncMerge";

const MAX_BODY = 900_000; // stays well under KV's value limit and keeps a bad client from filling it

async function load(kv, address) {
  const [j, a] = await Promise.all([kv.get(`user:${address}:journal`), kv.get(`user:${address}:alerts`)]);
  const parse = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  return { journal: sanitizeJournal(parse(j, [])), alerts: sanitizeAlerts(parse(a, null)) };
}

async function authed(request) {
  const s = await sessionFromCookieHeader(request.headers.get("cookie"));
  return s ? s.address.toLowerCase() : null;
}

export async function GET(request) {
  const address = await authed(request);
  if (!address) return json({ error: "Sign in with your wallet first." }, 401);
  const kv = getKV();
  if (!kv) return json({ enabled: false });
  return json({ enabled: true, ...(await load(kv, address)) });
}

export async function PUT(request) {
  if (!sameOrigin(request)) return json({ error: "Cross-site request refused." }, 403);
  const address = await authed(request);
  if (!address) return json({ error: "Sign in with your wallet first." }, 401);
  const kv = getKV();
  if (!kv) return json({ enabled: false });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: "Too much data to sync." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Bad request body." }, 400); }

  // Merge into what is stored rather than overwrite it, so two open devices can't erase each other.
  const stored = await load(kv, address);
  const journal = mergeJournal(stored.journal, sanitizeJournal(body?.journal));
  const alerts = mergeAlerts(stored.alerts, sanitizeAlerts(body?.alerts));
  await Promise.all([
    kv.put(`user:${address}:journal`, JSON.stringify(journal)),
    alerts ? kv.put(`user:${address}:alerts`, JSON.stringify(alerts)) : Promise.resolve(),
  ]);
  return json({ enabled: true, journal, alerts });
}
