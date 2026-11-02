import { redirect } from "next/navigation";
import { getAddress } from "viem";
import { getSession } from "@/lib/session";
import { authConfig, env } from "@/lib/sessionCore";
import WalletLogin from "@/components/WalletLogin";

export const runtime = "edge";

export default async function LoginPage({ searchParams }) {
  const session = await getSession();
  if (session?.address) redirect("/");

  const cfg = authConfig();
  const missing = [];
  if (!cfg.secretOk) missing.push("SESSION_SECRET (a random string of 32+ characters)");
  if (!cfg.allowlistOk) missing.push("WALLET_ALLOWLIST (comma-separated wallet addresses, or * to allow any wallet)");

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Structure Setup Scanner</h1>
        <p className="login-sub">
          Connect your wallet and sign a short message to open the scanner. Signing is free: no transaction is sent and no funds move.
        </p>
        {missing.length ? (
          <div className="wl-error" role="alert">
            <div>Sign-in isn&apos;t set up on this server yet. The owner needs to set:</div>
            <ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        ) : null}
        <WalletLogin
          projectId={env("WALLETCONNECT_PROJECT_ID") || ""}
          next={typeof searchParams?.next === "string" ? searchParams.next : ""}
          reason={typeof searchParams?.reason === "string" ? searchParams.reason : ""}
          disabled={missing.length > 0}
        />
        <p className="login-foot">Educational signal tool — not financial advice.</p>
      </div>
    </div>
  );
}
