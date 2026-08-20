import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Optional allowlist. Empty => any Google account may sign in.
const allowed = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // JWT sessions (no database) — required for the Cloudflare edge runtime.
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    // Gate sign-in by the optional allowlist.
    async signIn({ profile, user }) {
      const email = (profile?.email || user?.email || "").toLowerCase();
      if (!email) return false;
      if (allowed.length === 0) return true; // any Google account
      return allowed.includes(email);
    },
    // Protect every route except the login and auth endpoints.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const p = nextUrl.pathname;
      const isPublic =
        p.startsWith("/login") ||
        p.startsWith("/api/auth") ||
        p.startsWith("/_next") ||
        p === "/favicon.ico";
      if (isPublic) return true;
      return isLoggedIn;
    },
  },
  pages: {
    signIn: "/login",
  },
});
