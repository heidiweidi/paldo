// Server-side relay for Discord webhook alerts.
//
// Why a relay at all: Discord's webhook endpoint doesn't send CORS headers
// that allow browser calls from an arbitrary origin, so posting straight from
// the page is unreliable. Routing through the edge also keeps the webhook URL
// out of the page source when it's configured as an environment variable.
export const runtime = "edge";

// SECURITY: this endpoint accepts a destination URL from the client, which
// would otherwise make it an open proxy — anyone could point it at an internal
// address or a third-party API and use this site to launder the request
// (SSRF). So the target is validated to be a genuine Discord webhook and
// nothing else: exact host match (not a suffix check, which "discord.com.
// evil.tld" would defeat), https only, and the /api/webhooks/ path.
const ALLOWED_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

// Returns the *normalised* URL to fetch, or null if it isn't a Discord
// webhook. Returning the normalised form matters: validating the parsed URL
// but then fetching the caller's raw string would let the two disagree. We
// only ever request the URL we actually checked.
function normaliseWebhook(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null; // https://discord.com@evil.tld/…
  if (!ALLOWED_HOSTS.has(u.hostname)) return null;
  if (!/^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname)) return null;
  // Drop any query/fragment the caller tacked on.
  return `https://${u.hostname}${u.pathname}`;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "bad request body" }, 400);

    // Prefer a server-configured webhook; fall back to one supplied by the
    // client so alerts can be set up without a redeploy.
    let envUrl;
    try {
      envUrl = typeof process !== "undefined" && process.env ? process.env.DISCORD_WEBHOOK_URL : undefined;
    } catch {
      envUrl = undefined;
    }
    const target = (typeof body.webhook === "string" && body.webhook.trim()) || (envUrl && envUrl.trim()) || "";

    if (!target) {
      return json({ error: "No Discord webhook configured. Paste one in the Alerts panel, or set DISCORD_WEBHOOK_URL in the Cloudflare Pages environment." }, 400);
    }
    const endpoint = normaliseWebhook(target);
    if (!endpoint) {
      return json({ error: "That doesn't look like a Discord webhook URL. It should look like https://discord.com/api/webhooks/<id>/<token>" }, 400);
    }

    // Only forward the fields Discord expects — never the raw client body,
    // so a caller can't smuggle extra parameters through.
    const payload = {};
    if (typeof body.content === "string" && body.content) payload.content = body.content.slice(0, 2000);
    if (Array.isArray(body.embeds) && body.embeds.length) payload.embeds = body.embeds.slice(0, 10);
    if (!payload.content && !payload.embeds) return json({ error: "nothing to send" }, 400);
    payload.username = "Paldo · Strat#5";
    payload.allowed_mentions = { parse: [] }; // never let alert text ping @everyone

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let r;
    try {
      r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (r.status === 429) {
      const retry = r.headers.get("retry-after");
      return json({ error: "Discord rate-limited the webhook", retryAfter: retry }, 429);
    }
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.text()).slice(0, 300); } catch {}
      return json({ error: `Discord rejected the message (HTTP ${r.status})`, detail }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    const reason = e && e.name === "AbortError" ? "Discord timed out" : (e && e.message) || String(e);
    return json({ error: reason }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
