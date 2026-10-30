// Wallet-login session primitives. Edge-safe on purpose (no next/headers, no Node APIs): the
// middleware, the auth routes and the server pages all share it.
//
// Sessions are signed JWTs in an httpOnly cookie, so there is no database. A separate short-lived
// cookie carries the sign-in nonce. The two tokens use different audiences so one can never be
// replayed as the other.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "paldo_session";
export const NONCE_COOKIE = "paldo_nonce";
export const SESSION_TTL_S = 7 * 24 * 60 * 60;
export const NONCE_TTL_S = 10 * 60;

export function env(key) {
  try {
    return typeof process !== "undefined" && process.env ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const isAddress = (s) => typeof s === "string" && ADDRESS_RE.test(s);

/** The signing key, or null when SESSION_SECRET is missing or too short to be safe. */
function secretKey() {
  const s = env("SESSION_SECRET");
  return s && s.length >= 32 ? new TextEncoder().encode(s) : null;
}

/**
 * WALLET_ALLOWLIST: comma, space or newline separated 0x addresses. A lone "*" lets any wallet in.
 * Empty or unset lets nobody in (fail closed), so a missing variable can't leave the site open.
 */
export function allowlist() {
  const raw = (env("WALLET_ALLOWLIST") || "").trim();
  if (raw === "*") return { any: true, set: new Set() };
  const set = new Set(
    raw
      .split(/[\s,]+/)
      .filter(isAddress)
      .map((a) => a.toLowerCase())
  );
  return { any: false, set };
}

export function isAllowed(address) {
  if (!isAddress(address)) return false;
  const l = allowlist();
  return l.any || l.set.has(address.toLowerCase());
}

/** What the login page needs to explain a half-configured deployment instead of failing silently. */
export function authConfig() {
  const l = allowlist();
  return { secretOk: !!secretKey(), allowlistOk: l.any || l.set.size > 0, open: l.any };
}

export async function signToken(payload, audience, ttlSeconds) {
  const key = secretKey();
  if (!key) throw new Error("SESSION_SECRET is not configured");
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export async function readToken(token, audience) {
  const key = secretKey();
  if (!key || !token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { audience, algorithms: ["HS256"] });
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Returns { address } for a valid, still-allowed session cookie, otherwise null. */
export async function sessionFromCookieHeader(header) {
  const payload = await readToken(parseCookies(header)[SESSION_COOKIE], "session");
  const address = payload?.addr;
  // Re-checking the allowlist on every request means removing an address revokes access at once.
  return isAddress(address) && isAllowed(address) ? { address } : null;
}

export function cookieString(name, value, { maxAge, secure }) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export const clearCookieString = (name, secure) => cookieString(name, "", { maxAge: 0, secure });

export function isHttps(request) {
  return new URL(request.url).protocol === "https:";
}

/** Rejects cross-site POSTs. SameSite=Lax already blocks most of them; this closes the rest. */
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from some clients omit it
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** Constant-time string compare, for the cron bearer secret. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bearer(request) {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export function json(obj, status = 200, extraHeaders) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (extraHeaders) for (const [k, v] of extraHeaders) headers.append(k, v);
  return new Response(JSON.stringify(obj), { status, headers });
}
