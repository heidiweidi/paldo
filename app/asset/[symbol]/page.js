import AssetDetail from "@/components/AssetDetail";

export const runtime = "edge";

export default function AssetPage({ params, searchParams }) {
  const symbol = decodeURIComponent(params.symbol || "").toUpperCase();
  const mkt = searchParams?.mkt === "forex" ? "forex" : "crypto";
  const pairing = searchParams?.pairing === "B" ? "B" : "A";
  const parsedAdxMin = parseInt(searchParams?.adxMin, 10);
  const adxMin = Number.isFinite(parsedAdxMin) ? Math.min(50, Math.max(0, parsedAdxMin)) : 0;
  return <AssetDetail symbol={symbol} mkt={mkt} initialPairing={pairing} initialAdxMin={adxMin} />;
}
