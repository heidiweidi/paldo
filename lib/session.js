import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionFromCookieHeader } from "@/lib/sessionCore";

/** The signed-in wallet for this request ({ address }), or null. Server components only. */
export async function getSession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return token ? sessionFromCookieHeader(`${SESSION_COOKIE}=${token}`) : null;
}
