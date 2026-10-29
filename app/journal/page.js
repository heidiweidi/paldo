import { auth, signOut } from "@/auth";
import Journal from "@/components/Journal";
import AppHeader from "@/components/AppHeader";

export const runtime = "edge";

export default async function JournalPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <>
      <AppHeader active="journal">
        {user ? (
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
        ) : null}
      </AppHeader>
      <Journal />
    </>
  );
}
