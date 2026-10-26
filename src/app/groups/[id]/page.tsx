import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  approveMember,
  createInvite,
  removeMember,
  revokeInvite,
  setMemberRole,
} from "../actions";

const ROLE_LABELS = {
  admin: "Admin",
  member: "Member",
  child: "Child",
  guest: "Guest",
} as const;

export default function GroupPage({ params }: PageProps<"/groups/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
      <Link href="/" className="text-sm underline">
        ← Home
      </Link>
      <Suspense fallback={<p>Loading…</p>}>
        {params.then(({ id }) => (
          <Group id={id} />
        ))}
      </Suspense>
    </main>
  );
}

async function Group({ id }: { id: string }) {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const { data: group } = await supabase
    .from("groups")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!group) notFound();

  const { data: members } = await supabase
    .from("group_members")
    .select("user_id, role, status, profiles(display_name)")
    .eq("group_id", id)
    .order("joined_at");

  const me = members?.find((m) => m.user_id === user.id);
  if (me?.status !== "active") {
    return (
      <>
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        <p>Your request to join is waiting for an admin to approve it.</p>
      </>
    );
  }
  const isAdmin = me.role === "admin";

  return (
    <>
      <h1 className="text-2xl font-semibold">{group.name}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Members</h2>
        <ul className="flex flex-col gap-2">
          {members?.map((m) => (
            <li
              key={m.user_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-2 dark:border-white/15"
            >
              <span>
                {m.profiles?.display_name ?? "Unknown"}
                {m.user_id === user.id && " (you)"}
              </span>
              <span className="flex items-center gap-2 text-sm">
                {m.status === "pending" ? (
                  isAdmin ? (
                    <form action={approveMember.bind(null, id, m.user_id)}>
                      <button className="rounded bg-foreground px-2 py-1 text-background">
                        Approve
                      </button>
                    </form>
                  ) : (
                    <span className="opacity-60">Pending</span>
                  )
                ) : isAdmin ? (
                  <form
                    action={setMemberRole.bind(null, id, m.user_id)}
                    className="flex gap-1"
                  >
                    <select
                      name="role"
                      defaultValue={m.role}
                      className="rounded border border-black/15 bg-transparent px-1 py-1 dark:border-white/20"
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button className="underline">Save</button>
                  </form>
                ) : (
                  <span className="opacity-60">{ROLE_LABELS[m.role]}</span>
                )}
                {(isAdmin || m.user_id === user.id) && (
                  <form action={removeMember.bind(null, id, m.user_id)}>
                    <button className="text-red-600 underline">
                      {m.user_id === user.id ? "Leave" : "Remove"}
                    </button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && <Invites groupId={id} />}
    </>
  );
}

async function Invites({ groupId }: { groupId: string }) {
  const supabase = await createClient();
  const { data: invites } = await supabase
    .from("group_invites")
    .select("id, token, expires_at")
    .eq("group_id", groupId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Invite links</h2>
      <p className="text-sm opacity-70">
        Links expire after 7 days. People who use one still need your approval.
      </p>
      {invites?.map((inv) => (
        <div
          key={inv.id}
          className="flex flex-wrap items-center gap-2 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/15"
        >
          <code className="flex-1 break-all">{`${origin}/join/${inv.token}`}</code>
          <span className="opacity-60">
            until {new Date(inv.expires_at).toLocaleDateString()}
          </span>
          <form action={revokeInvite.bind(null, groupId, inv.id)}>
            <button className="text-red-600 underline">Revoke</button>
          </form>
        </div>
      ))}
      <form action={createInvite.bind(null, groupId)}>
        <button className="rounded-md bg-foreground px-4 py-2 font-medium text-background">
          New invite link
        </button>
      </form>
    </section>
  );
}
