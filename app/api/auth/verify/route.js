// Step 2 of wallet sign-in: check the signed Sign-In with Ethereum (EIP-4361) message and, if it
// is genuine and the wallet is on the access list, start a session.
export const runtime = "edge";

import { getAddress, recoverMessageAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";
import {
  NONCE_COOKIE, SESSION_COOKIE, SESSION_TTL_S, authConfig, clearCookieString, cookieString, isAllowed,
  isHttps, json, parseCookies, readToken, sameOrigin, signToken,
} from "@/lib/sessionCore";

const MAX_MESSAGE = 1500;
const WINDOW_MS = 15 * 60 * 1000; // how far issuedAt / expirationTime may stray from now

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: "Cross-site request refused." }, 403);
  const cfg = authConfig();
  if (!cfg.secretOk) return json({ error: "Sign-in isn't configured on the server yet (SESSION_SECRET)." }, 503);

  const body = await request.json().catch(() => null);
  const message = body?.message;
  const signature = body?.signature;
  if (typeof message !== "string" || message.length > MAX_MESSAGE || !/^0x[0-9a-fA-F]+$/.test(signature || "")) {
    return json({ error: "Malformed sign-in request." }, 400);
  }

  const secure = isHttps(request);
  const nonceToken = parseCookies(request.headers.get("cookie"))[NONCE_COOKIE];
  const nonce = (await readToken(nonceToken, "nonce"))?.n;
  if (!nonce) return json({ error: "That sign-in attempt expired. Try again." }, 400);

  const m = parseSiweMessage(message);
  const host = new URL(request.url).host;
  const now = Date.now();
  let uriHost = null;
  try { uriHost = m.uri ? new URL(m.uri).host : null; } catch {}

  const problems = [];
  if (!m.address || !m.nonce || !m.issuedAt || !m.expirationTime) problems.push("incomplete message");
  else {
    if (m.nonce !== nonce) problems.push("nonce mismatch");
    if (m.domain !== host || uriHost !== host) problems.push("wrong site");
    if (Math.abs(now - m.issuedAt.getTime()) > WINDOW_MS) problems.push("stale message");
    if (m.expirationTime.getTime() <= now || m.expirationTime.getTime() > now + WINDOW_MS) problems.push("expired message");
  }
  if (problems.length) return json({ error: `Sign-in message rejected (${problems.join(", ")}).` }, 400);

  let recovered;
  try {
    recovered = await recoverMessageAddress({ message, signature });
  } catch {
    return json({ error: "That signature isn't valid." }, 400);
  }
  let claimed;
  try { claimed = getAddress(m.address); } catch { return json({ error: "Bad wallet address." }, 400); }
  if (recovered !== claimed) return json({ error: "The signature doesn't match that wallet." }, 400);

  const clear = ["set-cookie", clearCookieString(NONCE_COOKIE, secure)]; // a nonce is single use
  if (!isAllowed(claimed)) {
    return json(
      { error: "This wallet isn't on the access list.", address: claimed, reason: cfg.allowlistOk ? "not_allowed" : "no_allowlist" },
      403,
      [clear]
    );
  }
  const session = await signToken({ addr: claimed.toLowerCase() }, "session", SESSION_TTL_S);
  return json({ address: claimed }, 200, [
    clear,
    ["set-cookie", cookieString(SESSION_COOKIE, session, { maxAge: SESSION_TTL_S, secure })],
  ]);
}
