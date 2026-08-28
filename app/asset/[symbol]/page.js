import AssetDetail from "@/components/AssetDetail";

export const runtime = "edge";

export default function AssetPage({ params, searchParams }) {
  const symbol = decodeURIComponent(params.symbol || "").toUpperCase();
  const mkt = searchParams?.mkt === "forex" ? "forex" : "crypto";
  return <AssetDetail symbol={symbol} mkt={mkt} />;
}
