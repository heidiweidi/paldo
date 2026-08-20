import { handlers } from "@/auth";

// Auth.js route handlers must run on the edge for Cloudflare Pages.
export const runtime = "edge";

export const { GET, POST } = handlers;
