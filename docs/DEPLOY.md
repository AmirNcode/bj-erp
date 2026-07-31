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

## Production (self-host) — the installer package

Production ships as a **single offline installer bundle** the client runs on their own Linux
server — app + database + auth, no internet, no Supabase account. Everything lives in
[`deploy/`](../deploy):

```bash
./deploy/package.sh          # on OUR machine (Docker + internet) → dist/bj-erp-installer-<v>.tar.gz
# hand the tarball to the client; on their server:
tar xzf bj-erp-installer-<v>.tar.gz && cd bj-erp-installer && sudo ./install.sh
```

- **Stack (Docker Compose, versions pinned as a tested set):** Supabase Postgres, GoTrue (auth),
  PostgREST (data API), the app (standalone Next.js build), Caddy (HTTPS gateway with a
  self-signed internal CA; phones trust the exported `bj-root-ca.crt` once).
- `install.sh` generates all secrets, applies every `supabase/migrations/*` + `seed.sql`,
  bootstraps the first admin (`deploy/sql/bootstrap_admin.sql`), and enables the roles-in-JWT
  auth hook. Secrets are preserved on a re-run — but **the migrations are not idempotent**
  (measured 2026-07-31: 9 of 38 fail against a populated database, starting at file #1), so a
  re-run over an existing database aborts on the first migration. It aborts safely and changes
  nothing. A **fresh** install applies all 38 plus the seed cleanly. See `deploy/RUNBOOK.md`.
- The app image bakes placeholder env values; the real URL/anon key are substituted at container
  start (`deploy/docker-entrypoint.sh`). Server-side code talks to the API over the internal
  plain-HTTP gateway listener (`SUPABASE_URL`), browsers over public HTTPS.
- Ops (backup/restore/update/logs), requirements, and the phone-certificate step live in
  [`deploy/RUNBOOK.md`](../deploy/RUNBOOK.md) (English + Farsi).
- After install: create employees, enter the official Iranian holidays via `/manage/settings`,
  allocate balances. Company/departments/leave types come from `seed.sql`.
