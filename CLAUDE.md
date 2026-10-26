@AGENTS.md

# Family App

All-in-one family/household app: shared calendar with away status, chores and
pet care, dinner RSVP, grocery list, family chat; later gift board with hidden
chat, trips, cars. Product spec: `docs/Family App — Product Spec.pdf` (if
present). Release scope: v1 = users/groups/roles, homescreen, calendar (away +
priority), family chat, chores with pet care, dinner, grocery list.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind 4), Cache Components on.
  Read `node_modules/next/dist/docs/` before using Next APIs.
- Supabase (Postgres + Auth) via `@supabase/ssr`; hosted on Vercel.
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in
  `.env.local` (gitignored) and in Vercel.

## Commands

- `npm run dev` / `npm run build` / `npm run lint`
- `npm run test:db` — applies all migrations to PGlite and runs RLS tests
- `npm run db:push` — apply migrations to the linked Supabase project
- `npm run db:types` — regenerate `src/lib/database.types.ts` (hand-written
  until the project is linked)

## Conventions

- Permissions live in Postgres RLS, not just the UI. Every group-scoped table
  uses `is_group_member(gid)` / `is_group_admin(gid)`; add RLS tests to
  `supabase/tests/rls.test.mjs` for each new table.
- Schema changes go in new files under `supabase/migrations/`. Never edit a
  migration that has been pushed to Supabase.
- Server reads/actions get the user via `getCurrentUser()` in
  `src/lib/auth.ts`. Server clients come from `src/lib/supabase/server.ts`,
  one per request.
- Components that read cookies/session or params must sit inside
  `<Suspense>` (Cache Components rule). Mutating server actions call
  `refresh()` from `next/cache`.
- Route protection and session refresh: `src/proxy.ts` (Next 16 renamed
  middleware to proxy). Public paths: `/login`, `/auth/*`.

## Environment notes (Windows)

- VS Code terminal is Windows PowerShell 5.1: no `&&`; `Set-Content`/`Out-File`
  add a BOM that breaks `package.json`. Edit files with the editor tools.
- Node lives in `C:\Program Files\nodejs`; Git Bash may need it added to PATH.
