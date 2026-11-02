// The wallet gate: every page and API route needs a valid session cookie, except the sign-in
// endpoints themselves and the cron route (which has its own bearer secret).
import { NextResponse } from "next/server";
import { bearer, env, safeEqual, sessionFromCookieHeader } from "@/lib/sessionCore";

const PUBLIC_PREFIXES = ["/login", "/api/auth/", "/api/cron/"];

export async function middleware(request) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))) return NextResponse.next();

  // The scheduled scan posts its alerts through /api/discord, so it may present the cron secret.
  const cron = env("CRON_SECRET");
  if (pathname === "/api/discord" && cron && safeEqual(bearer(request), cron)) return NextResponse.next();

  if (await sessionFromCookieHeader(request.headers.get("cookie"))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
