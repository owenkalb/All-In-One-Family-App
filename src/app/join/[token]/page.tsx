import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { joinGroup } from "../../groups/actions";

export default function JoinPage({ params }: PageProps<"/join/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Suspense fallback={<p>Loading…</p>}>
        {params.then(({ token }) => (
          <Invite token={token} />
        ))}
      </Suspense>
    </main>
  );
}

async function Invite({ token }: { token: string }) {
  await getCurrentUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("preview_invite", { invite_token: token });
  const invite = data?.[0];

  if (!invite) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Invite not valid</h1>
        <p>This link has expired or was revoked. Ask for a new one.</p>
        <Link href="/" className="underline">
          Go home
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Join {invite.group_name}?</h1>
      <p className="opacity-70">An admin will approve your request.</p>
      <form action={joinGroup}>
        <input type="hidden" name="token" value={token} />
        <button className="w-full rounded-md bg-foreground px-4 py-2 font-medium text-background">
          Request to join
        </button>
      </form>
    </>
  );
}
