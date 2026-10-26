import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string | undefined;
  displayName: string;
};

// Data Access Layer entry point: every server-side read or action that needs
// the user goes through here, so the session is verified close to the data.
export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", claims.sub)
    .single();

  return {
    id: claims.sub,
    email: claims.email,
    displayName: profile?.display_name ?? claims.email ?? "You",
  };
}
