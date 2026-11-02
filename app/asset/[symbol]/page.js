import { getAddress } from "viem";
import { getSession } from "@/lib/session";
import AssetDetail from "@/components/AssetDetail";
import WalletSync from "@/components/WalletSync";

export const runtime = "edge";

export default async function AssetPage({ params, searchParams }) {
  const session = await getSession();
  const symbol = decodeURIComponent(params.symbol || "").toUpperCase();
  const mkt = searchParams?.mkt === "forex" ? "forex" : "crypto";
  const pairing = searchParams?.pairing === "B" ? "B" : "A";
  const src = searchParams?.src === "bitunix" ? "bitunix" : undefined;
  return (
    <>
      {/* Keeps the journal in sync (and watches the wallet) on this page too: "Log trade" lives here. */}
      {session ? <WalletSync address={getAddress(session.address)} /> : null}
      <AssetDetail symbol={symbol} mkt={mkt} initialPairing={pairing} src={src} />
    </>
  );
}
