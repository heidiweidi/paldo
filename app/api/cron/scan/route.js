// Server-side scan + alert: runs the same Strat#5 scan the Dashboard does,
// but with no browser tab required. Trigger it on a schedule (see
// .github/workflows/scan-cron.yml) and it scans the full universe, figures
// out which setups just entered/hit TP1/hit TP2/stopped, and pushes Discord
// alerts for the ones it hasn't already sent — tracked in a KV-backed
// ledger (lib/cronLedger.js) rather than the client's localStorage one,
// since there's no browser here to hold that state.
export const runtime = "edge";

import { CRYPTO, FOREX } from "@/lib/universe";
import { analyzeMTF, to4h, DEFAULT_FILTERS, DEFAULT_STRATEGY_VERSION } from "@/lib/indicators";
import { candidateAlerts, buildEmbed, DEFAULT_ALERT_SETTINGS } from "@/lib/alerts";
import { fetchKlines, fetchForex } from "@/lib/marketData";
import { filterUnsent, markSent } from "@/lib/cronLedger";

function env(key) {
  try {
    return typeof process !== "undefined" && process.env ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(request) {
  return handle(request);
}
export async function POST(request) {
  return handle(request);
}

async function handle(request) {
  // Fail closed: this endpoint fetches from Binance/Yahoo and can post to
  // Discord, so unlike the rest of the site (whose auth gate is currently
  // disabled — a separate, deliberate call) it always requires its own
  // secret rather than defaulting to open.
  const secret = env("CRON_SECRET");
  if (!secret) {
    return json({ error: "CRON_SECRET is not configured on the server. Set it in your deployment's environment variables before scheduling this endpoint." }, 503);
  }
  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : new URL(request.url).searchParams.get("secret");
  if (provided !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const settings = {
    ...DEFAULT_ALERT_SETTINGS,
    enabled: true,
    minGrade: (env("ALERT_MIN_GRADE") || "A").toUpperCase(),
  };

  const fails = [];
  const collected = [];

  await Promise.all(
    CRYPTO.map(async (sym) => {
      try {
        const [b4h, b1h, b15m, b5m] = await Promise.all([
          fetchKlines(sym, "4h", 300),
          fetchKlines(sym, "1h", 300),
          fetchKlines(sym, "15m", 300),
          fetchKlines(sym, "5m", 300),
        ]);
        collected.push({ sym, mkt: "crypto", b4h, b1h, b15m, b5m });
      } catch {
        fails.push(sym);
      }
    })
  );

  await Promise.all(
    FOREX.map(async (o) => {
      try {
        const [raw1h, b15m, b5m] = await Promise.all([
          fetchForex(o.y, "60m", "3mo"),
          fetchForex(o.y, "15m", "10d"),
          fetchForex(o.y, "5m", "5d"),
        ]);
        collected.push({ sym: o.s, mkt: "forex", b4h: to4h(raw1h), b1h: raw1h, b15m, b5m });
      } catch {
        fails.push(o.s);
      }
    })
  );

  const rowsA = collected.map((x) => analyzeMTF(x.sym, x.mkt, x.b4h, x.b15m, DEFAULT_FILTERS, DEFAULT_STRATEGY_VERSION)).filter(Boolean);
  const rowsB = collected.map((x) => analyzeMTF(x.sym, x.mkt, x.b1h, x.b5m, DEFAULT_FILTERS, DEFAULT_STRATEGY_VERSION)).filter(Boolean);

  const candidates = [...candidateAlerts(rowsA, "A", settings), ...candidateAlerts(rowsB, "B", settings)];
  const unsentKeys = new Set(await filterUnsent(candidates.map((c) => c.key)));
  const toSend = candidates.filter((c) => unsentKeys.has(c.key));

  const siteUrl = new URL(request.url).origin;
  const sentKeys = [];
  const sendErrors = [];
  for (const c of toSend) {
    try {
      const r = await fetch(`${siteUrl}/api/discord`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ embeds: [buildEmbed(c, siteUrl)] }),
      });
      if (r.ok) {
        sentKeys.push(c.key);
      } else if (r.status === 429) {
        break; // rate-limited: stop, the rest retry next scheduled run
      } else {
        sendErrors.push({ key: c.key, status: r.status });
      }
    } catch (e) {
      sendErrors.push({ key: c.key, error: String(e) });
    }
  }
  if (sentKeys.length) await markSent(sentKeys);

  return json({
    scanned: collected.length,
    failedSymbols: fails,
    candidates: candidates.length,
    sent: sentKeys.length,
    sendErrors,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
