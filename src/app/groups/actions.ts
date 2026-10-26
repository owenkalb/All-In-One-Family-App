"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Every action re-verifies the session via getCurrentUser; RLS in the
// database is the real permission check (spec: checked on the server).

const ROLES = ["admin", "member", "child", "guest"] as const;
type Role = (typeof ROLES)[number];

export async function createGroup(formData: FormData) {
  await getCurrentUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supabase = await createClient();
  const { data: groupId, error } = await supabase.rpc("create_group", {
    group_name: name,
  });
  if (error) throw new Error(error.message);
  redirect(`/groups/${groupId}`);
}

export async function joinGroup(formData: FormData) {
  await getCurrentUser();
  const supabase = await createClient();
  const { data: groupId, error } = await supabase.rpc("join_group_by_invite", {
    invite_token: String(formData.get("token") ?? ""),
  });
  if (error) throw new Error(error.message);
  redirect(`/groups/${groupId}`);
}

export async function approveMember(groupId: string, userId: string) {
  await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("group_members")
    .update({ status: "active" })
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  refresh();
}

export async function setMemberRole(
  groupId: string,
  userId: string,
  formData: FormData,
) {
  await getCurrentUser();
  const role = String(formData.get("role")) as Role;
  if (!ROLES.includes(role)) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("group_members")
    .update({ role })
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  refresh();
}

export async function removeMember(groupId: string, userId: string) {
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  if (userId === me.id) redirect("/");
  refresh();
}

export async function createInvite(groupId: string) {
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("group_invites")
    .insert({ group_id: groupId, created_by: me.id });
  if (error) throw new Error(error.message);
  refresh();
}

export async function revokeInvite(groupId: string, inviteId: string) {
  await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("group_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("group_id", groupId);
  if (error) throw new Error(error.message);
  refresh();
}
