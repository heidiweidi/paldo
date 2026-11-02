// KV access for per-wallet data. Uses the same ALERTS_KV binding as the cron ledger (keys are
// prefixed, so they never collide). Outside production there is an in-memory stand-in so the sync
// flow can be exercised locally; in production without the binding this returns null and sync
// switches itself off.
import { getRequestContext } from "@cloudflare/next-on-pages";

const mem = new Map();
const memoryKV = {
  async get(key) { return mem.get(key) ?? null; },
  async put(key, value) { mem.set(key, value); },
};

export function getKV() {
  try {
    const kv = getRequestContext()?.env?.ALERTS_KV;
    if (kv) return kv;
  } catch {
    // not inside a Cloudflare request (plain `next dev`)
  }
  return process.env.NODE_ENV !== "production" ? memoryKV : null;
}
