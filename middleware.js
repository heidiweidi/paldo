// Auth.js middleware — enforces the `authorized` callback in auth.js on every request.
export { auth as middleware } from "@/auth";

// TEMP: auth gate disabled for debugging (empty matcher = middleware never runs).
// Restore the original matcher below once Google OAuth is working:
// matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
export const config = {
  matcher: [],
};
