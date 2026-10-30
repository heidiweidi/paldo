// Step 1 of wallet sign-in: hand the browser a one-time nonce and remember it in a signed,
// short-lived cookie so /api/auth/verify can check it without a database.
export const runtime = "edge";

import { NONCE_COOKIE, NONCE_TTL_S, authConfig, cookieString, isHttps, json, signToken } from "@/lib/sessionCore";

export async function GET(request) {
  if (!authConfig().secretOk) {
    return json({ error: "Sign-in isn't configured on the server yet (SESSION_SECRET is missing or shorter than 32 characters)." }, 503);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const token = await signToken({ n: nonce }, "nonce", NONCE_TTL_S);
  return json({ nonce }, 200, [["set-cookie", cookieString(NONCE_COOKIE, token, { maxAge: NONCE_TTL_S, secure: isHttps(request) })]]);
}
