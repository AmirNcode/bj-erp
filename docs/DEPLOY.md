# DEPLOY — Demo (Vercel) & Production (self-host)

How to deploy the HR / Time-Off app. The **demo** runs on Vercel + Supabase Cloud; **production**
runs on the company's own servers (self-hosted Supabase + Next.js). The same code targets both —
only environment variables change (NFR-4).

## Environment variables

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase project URL (demo: `https://rimshsfkjpwlvjxbxhqm.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's anon / publishable key |

Both are public (client-safe). There is **no `service_role` secret** in the app — privileged work
runs through guarded `SECURITY DEFINER` Postgres functions.

## Demo deploy (Vercel)

Prereq: a Vercel account and the Vercel CLI (`npm i -g vercel`).

```bash
vercel login
vercel link                      # link this repo to a Vercel project
vercel env add NEXT_PUBLIC_SUPABASE_URL        # paste value; choose Production + Preview
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY   # paste value; choose Production + Preview
vercel deploy                    # preview deploy → returns a URL
vercel deploy --prod             # promote to the production demo URL
```

Framework is auto-detected (Next.js); build command `next build`, output handled by Vercel. After
the first deploy, open the URL — it should boot in Farsi/RTL at `/login`.

## Database setup (fresh project)

If pointing at a **new** Supabase project (not the seeded demo):

```bash
# 1. Apply migrations (schema, RLS, functions) — supabase/migrations/*
supabase db push            # (or apply each migration via the Supabase SQL editor / MCP)

# 2. Config baseline (company, departments, leave types, work settings)
psql "$DATABASE_URL" -f supabase/seed.sql    # idempotent

# 3. Demo org (users, allocations, holidays) — needs the admin to exist first
#    Create the admin once (Supabase dashboard or app_create_employee), then:
npm run seed                # scripts/seed-demo.mjs — reads .env.local
```

The demo project is already migrated + seeded (see below); nothing to do there.

## Demo logins

Password for all seeded users: **`Demo!2026`** (admin: `Admin!2026`).

| Code | Name | Role |
|---|---|---|
| `admin` | (owner) | admin |
| `m-prod` | Reza Karimi | manager (Production Line A) |
| `m-qc` | Maryam Hosseini | manager (Quality Control) |
| `m-maint` | Mehdi Sadeghi | manager (Maintenance) |
| `e-prod-1` / `e-prod-2` | Ali Rezaei / Hossein Ahmadi | employee (Production Line A) |
| `e-qc-1` / `e-qc-2` | Zahra Mohammadi / Fatemeh Akbari | employee (Quality Control) |
| `e-maint-1` / `e-maint-2` | Hassan Jafari / Saeed Bagheri | employee (Maintenance) |
| `s-sup` | Naser Ebrahimi | security (supervisor) |
| `g-01` / `g-02` | Kazem Moradi / Javad Rostami | security (guard) |

## Production (self-host) notes

- Run **self-hosted Supabase** (Postgres + Auth + Storage) and the Next.js app on the company
  servers (Node). Point the two env vars at the self-hosted Supabase. No Vercel-only features are
  used in the data/auth layer, so the move is config-only.
- Apply the same `supabase/migrations/*` + `supabase/seed.sql`, then seed users as above.
- Validate RLS policies + auth behave identically on the self-hosted stack before cutover (NFR-4).
- Holidays are minimal placeholders for the demo — replace with the official Iranian list via the
  admin work-settings/holiday editor at `/manage/settings`.
