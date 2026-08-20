// Auth.js middleware — enforces the `authorized` callback in auth.js on every request.
export { auth as middleware } from "@/auth";

export const config = {
  // Run on everything except static assets and the auth API (handled internally).
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
