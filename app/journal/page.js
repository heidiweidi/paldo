import { getAddress } from "viem";
import { getSession } from "@/lib/session";
import Journal from "@/components/Journal";
import AppHeader from "@/components/AppHeader";
import WalletMenu from "@/components/WalletMenu";
import WalletSync from "@/components/WalletSync";

export const runtime = "edge";

export default async function JournalPage() {
  const session = await getSession();

  return (
    <>
      {session ? <WalletSync address={getAddress(session.address)} /> : null}
      <AppHeader active="journal">
        {session ? <WalletMenu address={getAddress(session.address)} /> : null}
      </AppHeader>
      <Journal />
    </>
  );
}
