import { getAddress } from "viem";
import { getSession } from "@/lib/session";
import Dashboard from "@/components/Dashboard";
import AppHeader from "@/components/AppHeader";
import WalletMenu from "@/components/WalletMenu";
import WalletSync from "@/components/WalletSync";

export const runtime = "edge";

export default async function Home() {
  const session = await getSession();

  return (
    <>
      {session ? <WalletSync address={getAddress(session.address)} /> : null}
      <AppHeader active="scanner">
        {session ? <WalletMenu address={getAddress(session.address)} /> : null}
      </AppHeader>
      <Dashboard />
    </>
  );
}
