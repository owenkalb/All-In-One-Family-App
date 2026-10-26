import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createGroup } from "./groups/actions";
import { signOut } from "./login/actions";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
      <Suspense fallback={<p>Loading…</p>}>
        <Homescreen />
      </Suspense>
    </main>
  );
}

async function Homescreen() {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("group_members")
    .select("role, status, groups(id, name)")
    .eq("user_id", user.id)
    .order("joined_at");

  return (
    <>
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Hi, {user.displayName}</h1>
        <form action={signOut}>
          <button className="text-sm underline">Sign out</button>
        </form>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Your groups</h2>
        {memberships?.length ? (
          <ul className="flex flex-col gap-2">
            {memberships.map((m) =>
              m.groups ? (
                <li key={m.groups.id}>
                  <Link
                    href={`/groups/${m.groups.id}`}
                    className="flex justify-between rounded-md border border-black/10 px-3 py-2 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
                  >
                    <span>{m.groups.name}</span>
                    <span className="text-sm opacity-60">
                      {m.status === "pending" ? "Awaiting approval" : m.role}
                    </span>
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        ) : (
          <p className="opacity-70">
            You&apos;re not in any groups yet. Create one, or open an invite
            link from someone in your family.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Create a group</h2>
        <form action={createGroup} className="flex gap-2">
          <input
            name="name"
            required
            maxLength={80}
            placeholder="e.g. The Smith household"
            className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          />
          <button className="rounded-md bg-foreground px-4 py-2 font-medium text-background">
            Create
          </button>
        </form>
      </section>
    </>
  );
}
