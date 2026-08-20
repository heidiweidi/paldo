/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// Enables the Cloudflare bindings (env vars) in `next dev` when using next-on-pages.
if (process.env.NODE_ENV === "development") {
  try {
    const { setupDevPlatform } = await import("@cloudflare/next-on-pages/next-dev");
    await setupDevPlatform();
  } catch {
    // next-on-pages not installed yet during first `npm install`; safe to ignore.
  }
}

export default nextConfig;
