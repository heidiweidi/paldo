"use client";

import { useEffect } from "react";
import { startSync } from "@/lib/sync";

// Mounted by each signed-in page with the wallet address from the server (no extra request, which
// matters on the scanner where dozens of data fetches start at once). It (1) syncs the journal and alert
// settings with that wallet's KV record and (2) signs out if the wallet switches account. Renders
// nothing.
export default function WalletSync({ address }) {
  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    (async () => {
      try {
        if (!address || cancelled) return;
        startSync(address);
        // Loaded on demand: the wallet library (viem) is heavy and only matters once someone is signed in.
        const { signOut, watchWallet } = await import("@/lib/wallet");
        const off = await watchWallet(address, (why) => signOut(why));
        if (cancelled) off(); else stop = off;
      } catch {
        // offline or a transient error: the app still works from local data
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [address]);
  return null;
}
