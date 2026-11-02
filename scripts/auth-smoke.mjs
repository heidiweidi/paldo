// End-to-end check of the wallet gate against a running server (no browser, no real wallet).
//   SESSION_SECRET=... WALLET_ALLOWLIST=<address of TEST_KEY> npm run dev
//   node scripts/auth-smoke.mjs http://localhost:3000
// Signs real SIWE messages with throwaway keys and exercises the happy path and the failure cases.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const base = process.argv[2] || "http://localhost:3000";
const host = new URL(base).host;
const allowed = privateKeyToAccount(process.env.TEST_KEY);
const stranger = privateKeyToAccount(generatePrivateKey());

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); if (!ok) failed++; };

const cookieJar = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).filter((c) => !c.endsWith("="));
const merge = (...lists) => Object.values(Object.fromEntries(lists.flat().map((c) => [c.split("=")[0], c]))).join("; ");

async function nonce() {
  const r = await fetch(`${base}/api/auth/nonce`);
  return { n: (await r.json()).nonce, cookies: cookieJar(r) };
}
function msg(account, n, over = {}) {
  const now = new Date();
  return createSiweMessage({
    address: account.address, chainId: 1, domain: host, nonce: n, uri: base, version: "1",
    statement: "Sign in", issuedAt: now, expirationTime: new Date(now.getTime() + 5 * 60_000), ...over,
  });
}
async function verify(account, cookies, message, sigOverride) {
  const signature = sigOverride || (await account.signMessage({ message }));
  const r = await fetch(`${base}/api/auth/verify`, {
    method: "POST", headers: { "content-type": "application/json", cookie: cookies.join("; ") },
    body: JSON.stringify({ message, signature }),
  });
  return { r, body: await r.json(), cookies: cookieJar(r) };
}

// gate
let r = await fetch(`${base}/`, { redirect: "manual" });
check("page without session redirects to /login", r.status === 307 && new URL(r.headers.get("location"), base).pathname === "/login", r.status);
r = await fetch(`${base}/api/klines?symbol=BTC&interval=1h`);
check("data route without session is 401", r.status === 401, r.status);
r = await fetch(`${base}/api/sync`);
check("sync without session is 401", r.status === 401, r.status);
r = await fetch(`${base}/api/cron/scan`, { method: "POST" });
check("cron route is not behind the wallet gate (its own secret answers)", [401, 503].includes(r.status) && !(await r.text()).includes("wallet"), r.status);
r = await fetch(`${base}/login`);
check("login page is public", r.status === 200, r.status);

// happy path
let { n, cookies } = await nonce();
let v = await verify(allowed, cookies, msg(allowed, n));
check("allowed wallet signs in", v.r.status === 200 && v.body.address === allowed.address, JSON.stringify(v.body));
const session = merge(v.cookies);
check("session cookie is httpOnly + SameSite", (v.r.headers.getSetCookie?.() || []).some((c) => c.startsWith("paldo_session=") && /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c)));
r = await fetch(`${base}/api/auth/session`, { headers: { cookie: session } });
check("session endpoint reports the address", (await r.json()).address === allowed.address);
r = await fetch(`${base}/`, { headers: { cookie: session }, redirect: "manual" });
check("page with session loads", r.status === 200, r.status);
r = await fetch(`${base}/login`, { headers: { cookie: session }, redirect: "manual" });
check("login page redirects away when already signed in", r.status === 307 || r.status === 308, r.status);
r = await fetch(`${base}/api/bitunix?limit=2`, { headers: { cookie: session } });
check("data route with session works", r.status === 200, r.status);

// failures
({ n, cookies } = await nonce());
v = await verify(stranger, cookies, msg(stranger, n));
check("valid signature from a wallet not on the list is 403 with its address", v.r.status === 403 && v.body.address === stranger.address, JSON.stringify(v.body));
check("rejected wallet gets no session cookie", !(v.r.headers.getSetCookie?.() || []).some((c) => c.startsWith("paldo_session=") && !c.includes("Max-Age=0")));

({ n, cookies } = await nonce());
v = await verify(allowed, cookies, msg(allowed, "0".repeat(32)));
check("wrong nonce is rejected", v.r.status === 400 && /nonce/.test(v.body.error), JSON.stringify(v.body));

({ n, cookies } = await nonce());
v = await verify(allowed, cookies, msg(allowed, n, { domain: "evil.example" }));
check("message for another domain is rejected", v.r.status === 400 && /wrong site/.test(v.body.error), JSON.stringify(v.body));

({ n, cookies } = await nonce());
v = await verify(allowed, cookies, msg(allowed, n, { issuedAt: new Date(Date.now() - 3600_000), expirationTime: new Date(Date.now() - 1800_000) }));
check("expired message is rejected", v.r.status === 400, JSON.stringify(v.body));

({ n, cookies } = await nonce());
const good = msg(allowed, n);
v = await verify(stranger, cookies, good, await stranger.signMessage({ message: good }));
check("signature from a different key than the claimed address is rejected", v.r.status === 400 && /match/.test(v.body.error), JSON.stringify(v.body));

({ n, cookies } = await nonce());
const m1 = msg(allowed, n);
v = await verify(allowed, cookies, m1);
const replay = await verify(allowed, cookies, m1); // same nonce cookie sent again, as an attacker would
check("nonce cookie is cleared after use", v.r.status === 200 && (v.r.headers.getSetCookie?.() || []).some((c) => c.startsWith("paldo_nonce=") && c.includes("Max-Age=0")));
check("replaying without a fresh nonce cookie fails", (await verify(allowed, [], m1)).r.status === 400);

r = await fetch(`${base}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
check("cross-site verify POST is refused", r.status === 403, r.status);
r = await fetch(`${base}/`, { headers: { cookie: "paldo_session=garbage" }, redirect: "manual" });
check("forged session cookie is not accepted", r.status === 307, r.status);

// sync
const put = (body, cookie = session) => fetch(`${base}/api/sync`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const e1 = { id: "j_1", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", symbol: "BTC", status: "open" };
r = await put({ journal: [e1], alerts: { enabled: true, webhook: "", minGrade: "A", events: {}, updatedAt: 5 } });
let d = await r.json();
check("sync stores a journal entry", r.status === 200 && d.journal.length === 1, JSON.stringify(d));
r = await put({ journal: [{ ...e1, updatedAt: "2026-10-02T00:00:00.000Z", status: "tp2" }] });
d = await r.json();
check("newer edit wins the merge", d.journal[0].status === "tp2", JSON.stringify(d));
r = await put({ journal: [{ ...e1, status: "stopped" }] }); // stale copy from another device
d = await r.json();
check("stale copy does not overwrite a newer one", d.journal[0].status === "tp2", JSON.stringify(d));
r = await put({ journal: [{ id: "j_1", createdAt: e1.createdAt, deleted: true, updatedAt: "2026-10-03T00:00:00.000Z" }] });
d = await r.json();
check("delete tombstone propagates", d.journal[0].deleted === true, JSON.stringify(d));
r = await put({ journal: [e1] });
d = await r.json();
check("deleted entry is not resurrected by an old copy", d.journal[0].deleted === true, JSON.stringify(d));
r = await fetch(`${base}/api/sync`, { headers: { cookie: session } });
d = await r.json();
check("alert settings were stored", d.alerts?.enabled === true && d.alerts.updatedAt === 5, JSON.stringify(d.alerts));

// a second wallet cannot see the first one's data
const other = privateKeyToAccount(generatePrivateKey());
// (other isn't on the allowlist, so it can't sign in at all; confirm that data is keyed by session, not input)
r = await fetch(`${base}/api/sync?address=${other.address}`, { headers: { cookie: session } });
d = await r.json();
check("address in the query string is ignored", d.journal?.[0]?.id === "j_1", JSON.stringify(d));

// logout
r = await fetch(`${base}/api/auth/logout`, { method: "POST" });
check("logout clears the cookie", (r.headers.getSetCookie?.() || []).some((c) => c.startsWith("paldo_session=") && c.includes("Max-Age=0")));

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
