# CLAUDE.md — Agent Onboarding

> Read first. Tells AI assistant (or human) how project organized, what decided, how to resume
> without re-asking user.

## What this is

Unified web app for **Iranian manufacturing company**. Long-term goal: **one app, one central
database** spanning every department (HR, quality control, finance, procurement, …). Built
**module by module**, starting **HR → time-off (leave) management** — client's biggest pain is
manual, paper-based time-off process. Other client companies, if any, get **separate deploys on
separate servers** (not one shared DB); focus now is this one company.

**Status (2026-10-06):** HR → leave module live for testing on Liara. Beyond v1: leave v2
(minutes, monthly accrual, hourly, replacement, serials), work + daily errands, signed approvals,
Persian-only calendar, `hr` role, approval chain, reports, print, CSV import, org chart, bulk
personnel import (add / update / replace), department-manager approval step. What shipped:
`docs/CHANGELOG.md` · next: `docs/TASKS.md` · frozen designs: `docs/specs/`.

## Stack (decided)

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Mobile-first, responsive, SSR. |
| Hosting | **Liara** VM — testing since 2026-09-29 (client IT couldn't publish an on-prem subdomain) | Public URL **`https://bjeng.app`** (since 2026-10-06; Let's Encrypt via Caddy, DNS on Liara NS, root A → VM). SSH/VM IP `62.60.191.132`. Next.js + Postgres + GoTrue + PostgREST + Caddy, `deploy/docker-compose.yml` + `.liara.yml`. Runbook `docs/DEPLOY-LIARA.md`. |
| Hosting (retired 2026-10-04) | Vercel demo · client on-prem server | `./deploy/bj-deploy` now only runs the local Docker stack; its on-prem code paths remain. |
| Backend | **Supabase** pieces (Postgres + GoTrue + PostgREST + RLS) | Self-hosted. No Storage service. No `service_role` in app. |
| Auth | **Admin-issued username + password** | Labourers have no email. Long-lived/PWA session. |
| i18n / layout | **Farsi (fa) default, RTL** + English (en) toggle | Per-user preference. |
| Calendar | **`react-multi-date-picker`** + `react-date-object` | **Persian (Jalali) only** since 2026-08-05. Holiday CSV import still accepts Gregorian input. |
| PWA | Installable, persistent session | "Log in once, stays logged in." |

`next`/`react` pinned exactly; the rest use `^` ranges. **Always verify library APIs against
Context7 before using them** — no training-data API details.

## Non-negotiable conventions

1. **Dates** stored in Postgres as **Gregorian `DATE`/`timestamptz`** (calendar-agnostic).
   Jalali = *presentation* concern only — convert at UI edge. Never store Jalali strings.
2. **RLS is source of truth** for access control. UI hides forbidden data; Postgres
   Row-Level Security enforces. Every table touching employee data has policies.
3. **Roles** live in `user_roles` table (`admin | manager | hr | employee | security`), checked via
   `has_role()` SQL helper — not single enum column. One user may hold several.
4. **Farsi-first**: default locale `fa`, default direction RTL. All user-facing strings
   translated (`fa` + `en`).
5. **Module isolation**: future modules (QC, finance…) share auth/org/roles but own their tables
   and inject own bottom-tab navigation per user's roles.

## Repository layout

```
CLAUDE.md                  ← you are here
app/[locale]/              Next.js App Router — (auth)/login + (app)/* authed screens
  (app)/                   home · request · calendar · profile · settings (admin) · manage/* (RBAC layout guard)
    _components/           AppShell, MainNav, PageHeader, nav-icons
    request/_components/   FormParts + useRequestForm: shared pieces of the four request forms
  (print)/print/request    printable paper form of a request
app/api/health             health endpoint (deploy checks)
components/                shared UI — ui/* (shadcn primitives), PersianDateField, StatusBadge, Skeletons
lib/                       actions/* (server actions; leave/* split by concern) · supabase/* (clients, types)
                           leave/* (pure day-count, balances, approvals) · auth/* (requireCaller) · home/* · nav/*
i18n/                      next-intl routing / navigation / request config
messages/                  fa.json (default, RTL) + en.json
supabase/                  migrations/* (history) · schema.sql (current, generated) · seed.sql · config.toml
scripts/                   seed-demo.mjs · cleanup-e2e.mjs · gen-jalali-months.mjs · dump-schema.sh
tests/                     unit/* (Vitest) · e2e/* (Playwright) · deploy/*.sh (deploy-script tests)
deploy/                    Docker stack, Caddy, bj-deploy (local Docker), liara/* (Liara release + backup)
.github/workflows/         deploy-liara.yml — push to main → test → package → deploy
proxy.ts                   middleware: Supabase session refresh + next-intl routing (Next 16 name)
docs/
  AGENT-LOG.md             MANDATORY session journal — every agent appends what it did, incl.
                           actions run against the live server. Newest first; read the top, write last.
  PLAN.md                  architecture blueprint + phased roadmap (start here for the big picture)
  REQUIREMENTS.md          numbered functional (FR-*) + non-functional (NFR-*) requirements
  DATA_MODEL.md            tables, columns, enums, ledger + day-counting logic (source of truth)
  PERMISSIONS.md           roles, visibility matrix, RLS policy descriptions (source of truth)
  TASKS.md                 open work only
  CHANGELOG.md             what changed, per release (Keep a Changelog format)
  MEMORY.md                durable lessons (gotchas that outlive a change)
  DEPLOY-LIARA.md          CURRENT host: Liara VM runbook (Docker Compose + GitHub Actions)
  DEPLOY-ASSISTANT.md      local Docker stack via ./deploy/bj-deploy (on-prem sections retired)
  specs/                   dated, frozen design records (one per module/feature)
  plans/                   active implementation plans (finished ones move to archive/)
  archive/                 retired history: old journal, plans, closed docs. Not read by default
```

## Read order for a new agent

- **Always:** this file → the newest 3 entries of **`docs/AGENT-LOG.md`** (what the last agents
  did) → `docs/TASKS.md` (open work).
- **When the task touches it:** `docs/DATA_MODEL.md` (schema, ledger maths) ·
  `docs/PERMISSIONS.md` (roles, RLS) · `docs/REQUIREMENTS.md` (FR/NFR) · the matching spec in
  `docs/specs/` · `supabase/schema.sql` (current SQL) · `docs/MEMORY.md` (lessons) · `docs/PLAN.md`.
- **Only on demand:** `docs/CHANGELOG.md`, `docs/plans/`, the deploy runbooks.
- **Never, unless the user asks:** `docs/archive/`. Root `.ignore` hides it from ripgrep search.

## How to run

```bash
npm install
cp .env.example .env.local     # fill NEXT_PUBLIC_SUPABASE_URL + ANON_KEY (public keys only)
npm run dev                    # http://localhost:3000 → boots fa-RTL at /login
```

Other commands: `npm run build` · `npm run lint` · `npm run test:unit` (Vitest) ·
`npm run test:deploy` (deploy shell tests) · `npm run test:e2e` (Playwright — needs reachable
Supabase + dev server; run serial `--workers=1`; `E2E_BASE_URL` targets an external server) ·
`npm run cleanup:e2e` (delete e2e throwaway users; teardown runs it too) · `npm run seed` (demo org) ·
`npm run schema:dump` (regenerate `supabase/schema.sql` from the local DB).
Deploying: Liara → `docs/DEPLOY-LIARA.md`; local Docker → `docs/DEPLOY-ASSISTANT.md`.
Demo-seed login (local/demo DB only): `admin` / `Admin!2026`. Liara admin password:
`.bj-deploy/liara/admin-password`.

## Gotchas

- **Push to `main` deploys to Liara** (`LIARA_DEPLOY_ENABLED=true`): audit → lint → unit →
  deploy tests → package → SSH apply. Docs-only commits: add `[skip ci]`. GitHub skips the **whole
  push** if its newest commit has `[skip ci]`, so never end a code push with one.
- **Migrations: edit `supabase/migrations/` only.** `deploy/migrations` and `deploy/sql/seed.sql`
  are symlinks into `supabase/` (bind-mounted by `deploy/docker-compose.yml`).
- **Current SQL lives in `supabase/schema.sql`**, not the migrations (one function can have 9
  definitions there). After applying a migration locally, run `npm run schema:dump` and commit both.
- **Server actions start with `requireCaller(...)`** (`lib/auth/context.ts`): `if (!c.ok) return c;`.
- **New enum value = its own migration file.** Postgres rejects using it in the same
  transaction (see `20260818130001_hr_role_enum.sql`).
- **`lib/supabase/types.ts` is hand-edited.** `supabase gen types` image unreachable from Iran;
  verify with `tsc --noEmit` + `npm run build`.
- **A migration is frozen once any DB has applied it, local included.** Fix with a new file;
  an in-place edit makes `bj-deploy update local` refuse with `migration history changed`.
- **Migrations are forward-only and run just before the app swap.** Rollback = restore the
  pre-deploy dump; keep schema compatible with the still-running old app (add first, drop later).
- **Never hand-run SQL on a server.** Only the migration ledger (`bj_deploy.schema_migrations`)
  may change schema, so every deploy stays reproducible.
- **Local stack:** run `./deploy/bj-deploy` from the main checkout (`deploy/.env` and
  `.bj-deploy/local` are untracked, absent in worktrees). LAN URL = `APP_ORIGIN` in `deploy/.env`;
  if the Mac IP changes, edit it and recreate all containers. After migrations, restart `bj-erp-rest-1`.
- **`docs/files/` holds real personnel data. Never commit it.**
- **Local SQL that updates `profiles` needs an admin JWT** (trigger `enforce_profile_update_scope`):
  first `select set_config('request.jwt.claims','{"sub":"<admin uuid>","role":"authenticated"}',true)`.
- **`lib/leave/jalaliMonths.ts` is Node-only** (`createRequire`); importing it from app code breaks
  `npm run build`. Shared date helpers go in `lib/leave/dateConvert.ts`.
- **Approval steps: key on `step_id`, not `step_role`.** The direct-manager and department-manager
  steps both have `step_role='manager'` (`manager_scope` tells them apart).
- **e2e with `E2E_BASE_URL`:** the teardown cleanup fails; run `npm run cleanup:e2e` by hand after.
- **Local DB holds the real roster** (since 2026-10-07): run only e2e specs that use their own `999…` users; skip `accrual.spec` (posts accruals for everyone).
- **New permission grants go through `private.has_permission(uid, '<key>')`** (FR-51 seam for configurable roles), not a fresh `has_role(uid,'hr')` check.
- **Local SQL as superuser:** `postgres` is not one in the db image; use `supabase_admin` with `PGPASSWORD` from `deploy/.env` (see `tests/sql/*` header).
- More: `docs/MEMORY.md`.

## Working agreements

- **Log every session in `docs/AGENT-LOG.md` — mandatory, no exceptions.** Append an entry
  before you finish, using the template in that file. It is the running journal of who changed
  what, why, what was run against the live server, and what was left half-done. Log
  dead ends and abandoned attempts too. Multiple agents work on this repo and git alone does
  not carry the reasoning or the out-of-repo actions.
- **Plan before code.** Design → spec → plan → implement, with user review gates.
- **Commit only when user asks.**
- Keep `docs/CHANGELOG.md` (what shipped) and `docs/TASKS.md` (what's next) current as work
  lands. `docs/MEMORY.md` takes lessons that will still matter in six months. `AGENT-LOG.md` is
  always updated; these three only when they apply.
- When you discover a non-obvious convention, gotcha, or command, propose a CLAUDE.md update at
  task end. Keep entries one line. Don't add what's obvious from code.
