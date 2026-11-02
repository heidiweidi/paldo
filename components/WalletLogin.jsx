"use client";

import { useEffect, useState } from "react";
import { discoverWallets, friendlyError, signInWithInjected, signInWithWalletConnect } from "@/lib/wallet";

const REASONS = {
  switched: "Your wallet switched to a different account, so you were signed out for safety.",
  disconnected: "Your wallet session ended, so you were signed out.",
};

export default function WalletLogin({ projectId, next, reason, disabled }) {
  const [wallets, setWallets] = useState(null); // null while detecting
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null); // { text, address?, reason? }
  const [copied, setCopied] = useState(false);
  const [mobile, setMobile] = useState(false);

  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  useEffect(() => {
    setMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    discoverWallets().then(setWallets);
  }, []);

  async function run(id, fn) {
    setError(null);
    setBusy(id);
    try {
      await fn();
      window.location.replace(target);
    } catch (e) {
      setError({ text: friendlyError(e), address: e?.address, reason: e?.reason });
      setBusy("");
    }
  }

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const here = typeof window !== "undefined" ? window.location : null;
  const metamaskLink = here ? `https://metamask.app.link/dapp/${here.host}${here.pathname}${here.search}` : "#";
  const trustLink = here ? `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(here.href)}` : "#";
  const noneFound = wallets && wallets.length === 0;

  return (
    <div className="wallet-login">
      {REASONS[reason] && !error ? <div className="wl-note">{REASONS[reason]}</div> : null}

      {wallets === null ? <div className="wl-muted">Looking for wallets…</div> : null}

      {(wallets || []).map((w) => (
        <button key={w.id} type="button" className="wallet-btn" disabled={disabled || !!busy} onClick={() => run(w.id, () => signInWithInjected(w))}>
          {w.icon ? <img src={w.icon} alt="" width="22" height="22" /> : <span className="wl-ico">◆</span>}
          <span>{busy === w.id ? "Check your wallet…" : w.name}</span>
        </button>
      ))}

      {projectId ? (
        <button type="button" className="wallet-btn" disabled={disabled || !!busy} onClick={() => run("wc", () => signInWithWalletConnect(projectId))}>
          <span className="wl-ico">⌁</span>
          <span>{busy === "wc" ? "Waiting for your wallet…" : "WalletConnect (QR or mobile app)"}</span>
        </button>
      ) : null}

      {noneFound ? (
        <div className="wl-muted">
          No browser wallet detected.{" "}
          {mobile ? "Open this page inside your wallet app:" : <>Install <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a> or <a href="https://trustwallet.com/browser-extension" target="_blank" rel="noreferrer">Trust Wallet</a>{projectId ? ", or use WalletConnect above." : "."}</>}
        </div>
      ) : null}
      {mobile && noneFound ? (
        <div className="wl-links">
          <a className="wallet-btn" href={metamaskLink}>Open in MetaMask</a>
          <a className="wallet-btn" href={trustLink}>Open in Trust Wallet</a>
        </div>
      ) : null}

      {error ? (
        <div className="wl-error" role="alert">
          <div>{error.text}</div>
          {error.address ? (
            <div className="wl-addr">
              <code>{error.address}</code>
              <button type="button" onClick={() => copy(error.address)}>{copied ? "Copied" : "Copy"}</button>
              <div className="wl-muted">Send this address to the owner to request access.</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
