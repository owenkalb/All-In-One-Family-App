-- Users, groups and roles (spec: "Users, groups and roles").
-- Every later module scopes its rows to a group and reuses the helper
-- functions below in its RLS policies.

create type public.group_role as enum ('admin', 'member', 'child', 'guest');
create type public.membership_status as enum ('pending', 'active');

-- Profiles ------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text,
  calendar_color text not null default '#3b82f6'
    check (calendar_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

-- Create a profile whenever someone signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
             split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Groups and memberships ----------------------------------------------------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.group_role not null default 'member',
  status public.membership_status not null default 'pending',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_id_idx on public.group_members (user_id);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  token text not null unique
    default translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),
  created_by uuid not null references public.profiles (id),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS helpers ---------------------------------------------------------------
-- security definer so policies on group_members can call them without
-- recursing into their own policies.

create function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and status = 'active'
  );
$$;

create function public.is_group_admin(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
      and status = 'active' and role = 'admin'
  );
$$;

create function public.shares_group_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = other
  );
$$;

-- Keep at least one active admin in every group.
create function public.ensure_group_keeps_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid := old.group_id;
begin
  if not exists (select 1 from public.groups where id = gid) then
    return null; -- group itself is being deleted
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = gid and role = 'admin' and status = 'active'
  ) then
    raise exception 'A group must keep at least one admin';
  end if;
  return null;
end;
$$;

create constraint trigger group_keeps_admin
  after update or delete on public.group_members
  deferrable initially deferred
  for each row execute function public.ensure_group_keeps_admin();

-- RPCs ----------------------------------------------------------------------

-- Create a group and make the caller its admin in one step.
create function public.create_group(group_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into public.groups (name, created_by)
  values (trim(group_name), auth.uid())
  returning id into new_id;
  insert into public.group_members (group_id, user_id, role, status)
  values (new_id, auth.uid(), 'admin', 'active');
  return new_id;
end;
$$;

-- Redeem an invite: creates a pending membership an admin must approve.
create function public.join_group_by_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select group_id into gid
  from public.group_invites
  where token = invite_token and revoked_at is null and expires_at > now();
  if gid is null then
    raise exception 'Invite link is invalid or expired';
  end if;
  insert into public.group_members (group_id, user_id, role, status)
  values (gid, auth.uid(), 'member', 'pending')
  on conflict (group_id, user_id) do nothing;
  return gid;
end;
$$;

-- Lets someone holding an invite see which group it is for before joining.
create function public.preview_invite(invite_token text)
returns table (group_id uuid, group_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name
  from public.group_invites i
  join public.groups g on g.id = i.group_id
  where i.token = invite_token and i.revoked_at is null and i.expires_at > now();
$$;

revoke execute on function public.create_group(text) from public, anon;
revoke execute on function public.join_group_by_invite(text) from public, anon;
revoke execute on function public.preview_invite(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group_by_invite(text) to authenticated;
grant execute on function public.preview_invite(text) to authenticated;

-- Row Level Security --------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;

-- Column-level grants keep ids, owners and group_id immutable from the API.
revoke all on public.profiles, public.groups, public.group_members, public.group_invites
  from anon, authenticated;
grant select on public.profiles, public.groups, public.group_members, public.group_invites
  to authenticated;
grant update (display_name, avatar_url, calendar_color) on public.profiles to authenticated;
grant update (name) on public.groups to authenticated;
grant delete on public.groups to authenticated;
grant update (role, status) on public.group_members to authenticated;
grant delete on public.group_members to authenticated;
grant insert (group_id, created_by, expires_at) on public.group_invites to authenticated;
grant update (revoked_at) on public.group_invites to authenticated;

-- profiles: yourself, plus anyone you share a group with.
create policy "profiles: read self and group-mates" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));

create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- groups: visible to active members and to people with a pending request.
create policy "groups: read if member or pending" on public.groups
  for select to authenticated
  using (
    public.is_group_member(id)
    or exists (
      select 1 from public.group_members
      where group_id = groups.id and user_id = auth.uid()
    )
  );

create policy "groups: admins update" on public.groups
  for update to authenticated
  using (public.is_group_admin(id))
  with check (public.is_group_admin(id));

create policy "groups: admins delete" on public.groups
  for delete to authenticated
  using (public.is_group_admin(id));

-- group_members: active members see the roster; you always see your own row.
create policy "members: read roster" on public.group_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_group_member(group_id));

create policy "members: admins manage" on public.group_members
  for update to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

create policy "members: admins remove or self leave" on public.group_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_group_admin(group_id));

-- group_invites: admins only (spec: invite links expire and admins revoke).
create policy "invites: admins read" on public.group_invites
  for select to authenticated
  using (public.is_group_admin(group_id));

create policy "invites: admins create" on public.group_invites
  for insert to authenticated
  with check (public.is_group_admin(group_id) and created_by = auth.uid());

create policy "invites: admins revoke" on public.group_invites
  for update to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));
