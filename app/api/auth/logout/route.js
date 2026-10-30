export const runtime = "edge";

import { NONCE_COOKIE, SESSION_COOKIE, clearCookieString, isHttps, json, sameOrigin } from "@/lib/sessionCore";

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: "Cross-site request refused." }, 403);
  const secure = isHttps(request);
  return json({ ok: true }, 200, [
    ["set-cookie", clearCookieString(SESSION_COOKIE, secure)],
    ["set-cookie", clearCookieString(NONCE_COOKIE, secure)],
  ]);
}
