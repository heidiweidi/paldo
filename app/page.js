import { auth, signOut } from "@/auth";
import Dashboard from "@/components/Dashboard";

export const runtime = "edge";

export default async function Home() {
  const session = await auth();
  const user = session?.user;

  return (
    <>
      <div className="topbar">
        <div className="brand">
          Trend &amp; Volatility Scanner <span>· Crypto + Forex</span>
        </div>
        <div className="user">
          {user?.image ? (
            <img src={user.image} alt="" className="avatar" referrerPolicy="no-referrer" />
          ) : null}
          <span className="uname">{user?.name || user?.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="signout" type="submit">Sign out</button>
          </form>
        </div>
      </div>
      <Dashboard />
    </>
  );
}
