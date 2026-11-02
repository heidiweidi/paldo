export const runtime = "edge";

import { getAddress } from "viem";
import { json, sessionFromCookieHeader } from "@/lib/sessionCore";

// Who is signed in, if anyone. Public on purpose: the client uses it to decide whether to sync.
export async function GET(request) {
  const s = await sessionFromCookieHeader(request.headers.get("cookie"));
  return json({ address: s ? getAddress(s.address) : null });
}
