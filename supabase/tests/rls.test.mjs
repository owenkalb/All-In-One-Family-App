// Applies supabase/migrations/*.sql to PGlite with minimal Supabase stubs
// (auth.users, auth.uid(), anon/authenticated roles) and exercises RLS.
// Run: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../migrations/", import.meta.url);
const migration = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
const db = new PGlite({ extensions: { pgcrypto } });

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema extensions;
  create extension pgcrypto schema extensions;
  create schema auth;
  grant usage on schema auth, extensions to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);
await db.exec(migration);

const ids = {
  alice: "00000000-0000-0000-0000-00000000000a",
  bob: "00000000-0000-0000-0000-00000000000b",
  carol: "00000000-0000-0000-0000-00000000000c",
};
for (const [name, id] of Object.entries(ids)) {
  await db.query(
    "insert into auth.users values ($1, $2, $3)",
    [id, `${name}@example.com`, name === "carol" ? {} : { display_name: name.toUpperCase() }],
  );
}

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function as(who, sql, params = []) {
  await db.exec("reset role");
  if (who === "anon") {
    await db.exec("set role anon; set request.jwt.claim.sub = ''");
  } else {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ids[who]}'`);
  }
  try {
    return { rows: (await db.query(sql, params)).rows, affected: null };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("reset role");
  }
}
async function affected(who, sql, params = []) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ids[who]}'`);
  try {
    return { n: (await db.query(sql, params)).affectedRows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("reset role");
  }
}

// Profiles from signup trigger
const profiles = (await db.query("select id, display_name from public.profiles order by display_name")).rows;
check("signup trigger creates profiles", profiles.length === 3, profiles.map((p) => p.display_name).join(","));
check("display name falls back to email prefix", profiles.some((p) => p.display_name === "carol"));

// Alice creates a group
const created = await as("alice", "select public.create_group('Smiths') as id");
const gid = created.rows?.[0]?.id;
check("create_group returns id", Boolean(gid), created.error);
const aliceRole = await as("alice", "select role, status from public.group_members where group_id = $1", [gid]);
check("creator is active admin", aliceRole.rows?.[0]?.role === "admin" && aliceRole.rows?.[0]?.status === "active");

// Direct inserts blocked
check("cannot insert groups directly", Boolean((await as("bob", "insert into public.groups (name, created_by) values ('x', $1)", [ids.bob])).error));
check("cannot insert memberships directly", Boolean((await as("bob", "insert into public.group_members (group_id, user_id, role, status) values ($1, $2, 'admin', 'active')", [gid, ids.bob])).error));

// Invites
const inv = await as("alice", "insert into public.group_invites (group_id, created_by) values ($1, $2) returning token", [gid, ids.alice]);
check("admin creates invite", Boolean(inv.rows?.[0]?.token), inv.error);
const token = inv.rows?.[0]?.token;
check("invite token is url-safe", /^[A-Za-z0-9_-]{24}$/.test(token ?? ""), token);
check("member-less user cannot create invite", Boolean((await as("bob", "insert into public.group_invites (group_id, created_by) values ($1, $2)", [gid, ids.bob])).error));

// Bob before joining
check("outsider cannot see group", (await as("bob", "select * from public.groups")).rows.length === 0);
check("outsider cannot see invites", (await as("bob", "select * from public.group_invites")).rows.length === 0);
const preview = await as("bob", "select * from public.preview_invite($1)", [token]);
check("outsider can preview invite", preview.rows?.[0]?.group_name === "Smiths", preview.error);
check("bad token previews nothing", (await as("bob", "select * from public.preview_invite('nope')")).rows.length === 0);
check("bad token join fails", Boolean((await as("bob", "select public.join_group_by_invite('nope')")).error));

// Bob joins -> pending
const joined = await as("bob", "select public.join_group_by_invite($1) as id", [token]);
check("join returns group id", joined.rows?.[0]?.id === gid, joined.error);
check("pending user sees group name", (await as("bob", "select * from public.groups")).rows.length === 1);
check("pending user sees only own membership", (await as("bob", "select * from public.group_members where group_id = $1", [gid])).rows.length === 1);
check("pending user cannot see admin profile", (await as("bob", "select * from public.profiles where id = $1", [ids.alice])).rows.length === 0);
check("pending user cannot self-approve", (await affected("bob", "update public.group_members set status = 'active' where user_id = $1", [ids.bob])).n === 0);
check("rejoin is idempotent", !(await as("bob", "select public.join_group_by_invite($1)", [token])).error);

// Alice approves
check("admin approves", (await affected("alice", "update public.group_members set status = 'active' where group_id = $1 and user_id = $2", [gid, ids.bob])).n === 1);
check("member sees full roster", (await as("bob", "select * from public.group_members where group_id = $1", [gid])).rows.length === 2);
check("member sees group-mate profile", (await as("bob", "select * from public.profiles where id = $1", [ids.alice])).rows.length === 1);
check("member cannot change roles", (await affected("bob", "update public.group_members set role = 'admin' where user_id = $1", [ids.bob])).n === 0);
check("member cannot rename group", (await affected("bob", "update public.groups set name = 'x' where id = $1", [gid])).n === 0);
check("member cannot see invites", (await as("bob", "select * from public.group_invites")).rows.length === 0);
check("member cannot edit another profile", (await affected("bob", "update public.profiles set display_name = 'x' where id = $1", [ids.alice])).n === 0);
check("user can edit own profile", (await affected("bob", "update public.profiles set display_name = 'Bobby' where id = $1", [ids.bob])).n === 1);
check("cannot change immutable columns", Boolean((await as("alice", "update public.groups set created_by = $1 where id = $2", [ids.bob, gid])).error));
check("cannot move membership to another group", Boolean((await as("alice", "update public.group_members set group_id = gen_random_uuid() where user_id = $1", [ids.bob])).error));

// Carol, unrelated
check("stranger sees no groups", (await as("carol", "select * from public.groups")).rows.length === 0);
check("stranger sees no memberships", (await as("carol", "select * from public.group_members")).rows.length === 0);
check("stranger sees only own profile", (await as("carol", "select * from public.profiles")).rows.length === 1);
check("anon sees no profiles", Boolean((await as("anon", "select * from public.profiles")).error) || (await as("anon", "select * from public.profiles")).rows.length === 0);
check("anon cannot call create_group", Boolean((await as("anon", "select public.create_group('x')")).error));

// Last-admin protection
check("sole admin cannot demote self", Boolean((await affected("alice", "update public.group_members set role = 'member' where user_id = $1", [ids.alice])).error));
check("sole admin cannot leave", Boolean((await affected("alice", "delete from public.group_members where user_id = $1", [ids.alice])).error));
check("admin promotes bob", (await affected("alice", "update public.group_members set role = 'admin' where user_id = $1", [ids.bob])).n === 1);
check("non-sole admin can leave", (await affected("alice", "delete from public.group_members where user_id = $1", [ids.alice])).n === 1);
check("left user no longer sees group", (await as("alice", "select * from public.groups")).rows.length === 0);

// Invite revoke / expiry
check("admin revokes invite", (await affected("bob", "update public.group_invites set revoked_at = now() where token = $1", [token])).n === 1);
check("revoked invite fails", Boolean((await as("carol", "select public.join_group_by_invite($1)", [token])).error));
const inv2 = await as("bob", "insert into public.group_invites (group_id, created_by, expires_at) values ($1, $2, now() - interval '1 minute') returning token", [gid, ids.bob]);
check("expired invite fails", Boolean((await as("carol", "select public.join_group_by_invite($1)", [inv2.rows?.[0]?.token])).error));

// Group delete cascades past the last-admin check
check("admin deletes group", (await affected("bob", "delete from public.groups where id = $1", [gid])).n === 1);
check("memberships cascade-deleted", (await db.query("select count(*)::int as n from public.group_members")).rows[0].n === 0);

// Long signup name is truncated, not rejected
const longId = "00000000-0000-0000-0000-0000000000dd";
let longErr = null;
try {
  await db.query("insert into auth.users values ($1, 'x@example.com', $2)", [longId, { display_name: "z".repeat(200) }]);
} catch (e) { longErr = e.message; }
const longName = (await db.query("select display_name from public.profiles where id = $1", [longId])).rows[0]?.display_name;
check("long signup name truncated to 80", !longErr && longName?.length === 80, longErr ?? "");

// Deleting a user who created a group and an invite
await db.exec("reset role");
const g2 = (await as("carol", "select public.create_group('Carol house') as id")).rows[0].id;
await as("carol", "insert into public.group_invites (group_id, created_by) values ($1, $2)", [g2, ids.carol]);
await as("carol", "select public.join_group_by_invite('x')");
let delErr = null;
try { await db.query("delete from auth.users where id = $1", [ids.bob]); } catch (e) { delErr = e.message; }
check("delete user who left groups", !delErr, delErr ?? "");
const g3 = (await as("alice", "select public.create_group('Alice house') as id")).rows[0].id;
await as("alice", "insert into public.group_invites (group_id, created_by) values ($1, $2)", [g3, ids.alice]);
try { await db.query("delete from auth.users where id = $1", [ids.alice]); delErr = null; } catch (e) { delErr = e.message; }
check("delete user who created a group and invite", !delErr, delErr ?? "");
check("their now-empty group is deleted", (await db.query("select 1 from public.groups where id = $1", [g3])).rows.length === 0);

// Sole admin with other members deletes account -> oldest member promoted
const daveId = "00000000-0000-0000-0000-0000000000ee";
await db.query("insert into auth.users values ($1, 'dave@example.com', '{}')", [daveId]);
ids.dave = daveId;
const g4 = (await as("dave", "select public.create_group('Dave house') as id")).rows[0].id;
const t4 = (await as("dave", "insert into public.group_invites (group_id, created_by) values ($1, $2) returning token", [g4, daveId])).rows[0].token;
await as("carol", "select public.join_group_by_invite($1)", [t4]);
await affected("dave", "update public.group_members set status = 'active' where group_id = $1 and user_id = $2", [g4, ids.carol]);
try { await db.query("delete from auth.users where id = $1", [daveId]); delErr = null; } catch (e) { delErr = e.message; }
check("sole admin with members can delete account", !delErr, delErr ?? "");
const g4rows = (await db.query("select created_by, (select role from public.group_members where group_id = g.id and user_id = $2) as carol_role from public.groups g where id = $1", [g4, ids.carol])).rows;
check("group survives, creator nulled, member promoted", g4rows[0]?.created_by === null && g4rows[0]?.carol_role === "admin", JSON.stringify(g4rows[0]));
check("normal admin demote still blocked", Boolean((await affected("carol", "update public.group_members set role = 'member' where group_id = $1 and user_id = $2", [g4, ids.carol])).error));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
