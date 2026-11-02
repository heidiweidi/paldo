"use client";

import { useState } from "react";

// Header user area: the connected wallet and a Disconnect button.
export default function WalletMenu({ address }) {
  const [busy, setBusy] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <div className="user">
      <span className="wallet-chip" title={address}>
        <i className="wallet-dot" aria-hidden="true" />
        {short}
      </span>
      <button className="signout" type="button" disabled={busy} onClick={async () => { setBusy(true); (await import("@/lib/wallet")).signOut(); }}>
        Disconnect
      </button>
    </div>
  );
}
