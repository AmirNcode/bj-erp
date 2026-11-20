# CLAUDE.md — Agent Onboarding

> Read first. Tells AI assistant (or human) how project organized, what decided, how to resume
> without re-asking user.

## What this is

Unified web app for **Iranian manufacturing company**. Long-term goal: **one app, one central
database** spanning every department (HR, quality control, finance, procurement, …). Built
**module by module**, starting **HR → time-off (leave) management** — client's biggest pain is
manual, paper-based time-off process. Other client companies, if any, get **separate deploys on
separate servers** (not one shared DB); focus now is this one company.

**Status (2026-11-20):** Module #2 **ERP › Sales (FR-94)** built on branch `feat/erp-sales-module`, local only (worktree `../bj-sales`; spec `docs/specs/2026-11-16-sales-rfp-module-design.md`). **In progress: CEO feedback round 1** (title link, currencies, Our total price, Products, record Files) — spec `docs/specs/2026-11-20-sales-ceo-feedback-design.md`, plan `docs/plans/2026-11-20-sales-ceo-feedback.md` (tasks 0–9; progress in `docs/AGENT-LOG.md` top entry). HR → leave module live for testing on Liara; FR-92 (Manager negative balance) and FR-93 (lunch break not deducted from hourly leave) deployed; SMS username + API key connection and PR #17 F4/F5 pushed 2026-11-16. Beyond v1: leave v2
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
3. **Roles** live in `roles` + `role_permissions`, assigned through `user_roles.role_id` (one user may
   hold several). Built-ins `admin | manager | employee` are fixed; `hr | security | finance` are
   editable presets; admins add custom roles in Settings › Roles (FR-55). `has_role()` sees built-ins only.
4. **Farsi-first**: default locale `fa`, default direction RTL. All user-facing strings
   translated (`fa` + `en`).
5. **Module isolation**: future modules (QC, finance…) share auth/org/roles but own their tables
   and inject own bottom-tab navigation per user's roles.

## Repository layout

```
CLAUDE.md                  ← you are here
app/[locale]/              Next.js App Router — (auth)/login + (app)/* authed screens
  (app)/                   home · request · calendar · profile · settings (admin) · manage/* (RBAC layout guard)
    sales/                 ERP › Sales module (FR-94): records, [id], deadlines, reports, settings (+ ledger import)
    _components/           AppShell, MainNav, PageHeader, nav-icons
    request/_components/   FormParts + useRequestForm: shared pieces of the four request forms
  (print)/print/request    printable paper form of a request
app/api/health             health endpoint (deploy checks)
components/                shared UI — ui/* (shadcn primitives), PersianDateField, StatusBadge, Skeletons
lib/                       actions/* (server actions; leave/* split by concern; sales.ts = ERP) · sales/* (ERP pure helpers, xlsx)
                           supabase/* (clients, types)
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
  DESIGN.md                "Blueprint" design system: tokens, tables, tabs, buttons, cards, phone rules
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
  `docs/PERMISSIONS.md` (roles, RLS) · `docs/DESIGN.md` (any UI work) · `docs/REQUIREMENTS.md` (FR/NFR) · the matching spec in
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
`npm run test:deploy` (all `tests/deploy/*.test.sh`; needs Docker) · `npm run test:e2e` (Playwright — needs reachable
Supabase + dev server; run serial `--workers=1`; `E2E_BASE_URL` targets an external server) ·
`npm run cleanup:e2e` (delete e2e throwaway users; teardown runs it too) · `npm run seed` (demo org) ·
`npm run schema:dump` (regenerate `supabase/schema.sql` from the local DB).
Deploying: Liara → `docs/DEPLOY-LIARA.md`; local Docker → `docs/DEPLOY-ASSISTANT.md`.
**Running the app locally = the newest live backup** (`~/Backups/bj-erp`), not demo data, unless the
owner asks for demo data. Procedure: `docs/DEPLOY-ASSISTANT.md` › "Running the app locally".
Demo-seed login (local/demo DB only): `admin` / `Admin!2026`; others `Demo!2026` (hr: `hr-101`,
finance: `4002`). `hr-101` needs `SUPABASE_SERVICE_ROLE_KEY` (local: `SERVICE_ROLE_KEY` in `deploy/.env`) when seeding. Liara admin password:
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
- **Local `postgres` DB lags `main`** (since 2026-11-02 it lacks `20261102140000`+): a dry-run clone must apply those first, or `schema:dump`-from-clone loses them.
- **Local stack:** run `./deploy/bj-deploy` from the main checkout (`deploy/.env` and
  `.bj-deploy/local` are untracked, absent in worktrees). LAN URL = `APP_ORIGIN` in `deploy/.env`;
  if the Mac IP changes, edit it and recreate all containers. After migrations, restart `bj-erp-rest-1`.
- **`docs/files/` holds real personnel data. Never commit it.**
- **Local SQL that updates `profiles` needs an admin JWT** (trigger `enforce_profile_update_scope`):
  first `select set_config('request.jwt.claims','{"sub":"<admin uuid>","role":"authenticated"}',true)`.
- **`lib/leave/jalaliMonths.ts` is Node-only** (`createRequire`); importing it from app code breaks
  `npm run build`. Shared date helpers go in `lib/leave/dateConvert.ts`.
- **Replacement confers no approval authority (FR-90):** only saved delegates (Manage › Approval steps) do; the preview's `temporary*` keys are always empty.
- **Editing approved requests = `app_edit_request` + the five `edit_*` permissions (FR-91);** `app_correct_trip` is a wrapper kept for the old app. Mirror gate changes in `lib/leave/requestEdit.ts`.
- **Approving = `approve_leave_request_steps` with the ids from `approvalBundle(progress)`** (FR-71: one signature for every step the caller holds). `approve_leave_request_v2` is only for the admin override and legacy no-chain requests.
- **SQL fixtures that change `work_settings.approval_order_enforced` need an admin JWT too** (`pg_temp.login('admin')` first), like `profiles`.
- **Reading a report vs acting on one (FR-74):** reads use `private.is_direct_manager_of` (reporting line, any role); writes and signatures use `is_manager_of` (Manager role too). The department manager reads their department's `leave_ledger` (`is_department_manager_of`) for the department step. Only `people` edit changes employees.
- **Approval steps: key on `step_id`, not `step_role`.** The direct-manager and department-manager
  steps both have `step_role='manager'` (`manager_scope` tells them apart).
- **e2e with `E2E_BASE_URL`:** the teardown cleanup fails; run `npm run cleanup:e2e` by hand after.
- **Local DB holds the real roster** (since 2026-10-07): run only e2e specs that use their own `999…` users; skip `accrual.spec` (posts accruals for everyone).
- **New permission grant = a catalog item:** SQL `private.permission_keys` / `permission_allows` / `permission_deps` + `lib/permissions/catalog.ts` (a unit test compares them with `schema.sql`); check it with `private.has_perm(uid, key, level)`, and add `private.can_act_on(caller, target)` for writes on another person. `private.has_permission(uid, '<legacy key>')` stays only as an alias for the old app — map any new legacy key there too.
- **Exactly one admin** (partial unique index `user_roles_one_admin`); it moves only via `app_transfer_admin`. SQL fixtures that insert a second admin need `drop index public.user_roles_one_admin;` right after `begin;`.
- **Separate DB for a long-lived branch** (keeps the shared local DB on main's schema): `pg_dump -Fc` db `postgres` and `pg_restore` into a new database in `bj-erp-db-1` (only pg_cron/graphql objects fail; pg_cron exists only in `postgres`), run a second GoTrue + PostgREST + gateway on it (network `bj-erp_default`, `…@db:5432/<db>`), and dump `schema.sql` with `pg_dump -d <db>` — `npm run schema:dump` is hard-wired to `postgres`.
- **Lock order: `private.approval_lock(company)` before any `'leave:'||employee` advisory lock.** Since approval delegation, a trigger takes the company lock on every write to `leave_requests`, `profiles` (active/manager/department), `departments`, `roles`, `role_permissions`, `user_roles`, `approval_steps`; a function that takes the employee lock first and then writes one of these can deadlock.
- **SQL scoping trap:** in `from unnest(arr) id where not exists (select 1 from t where t.id = id)`, the bare `id` binds to `t.id` (always true). Alias the unnest column (`unnest(arr) as v(eid)`) and compare `v.eid`.
- **Dry-run migrations first** (applying one freezes it): each `tests/sql/*` file opens and rolls back its own transaction, so it cannot share one with the migration. Clone instead: in `bj-erp-db-1`, `create database x`, `pg_dump -Fc -d postgres | pg_restore -d x --no-owner`, apply the migration to `x`, run the test files against `x`, `drop database x`.
- **`pg_restore` re-parenthesizes CHECK constraints:** a schema dump from a restored DB differs from `schema.sql` in a few `CONSTRAINT … CHECK` lines with no real change; never commit those hunks.
- **UI copy:** a `'use client'` component reads its text with `useTranslations` (or a local `useLabels()` hook); pages never build translated `labels` props — the whole catalog already reaches the client.
- **Leave amounts in forms:** minutes, edited as whole days + hours via `DaysHoursField` / `leaveAmountReader` (`EmployeeFormParts`); never a decimal-days input.
- **Local SQL as superuser:** `postgres` is not one in the db image; use `supabase_admin` with `PGPASSWORD` from `deploy/.env` (see `tests/sql/*` header).
- **plpgsql `IF` with a `CASE`:** `if x > case when … then … end then` is a syntax error (the parser stops at the first `then`). Wrap the CASE in parentheses.
- **Adding a column to `travel_bookings`** breaks SQL tests that build a `row(…)::public.travel_bookings` literal (`tests/sql/travel-booking.sql`); add the value there too.
- **Who sees approved absences = `absence_watchers` rows (FR-75), not a permission.** Edited on Manage › Approval steps (`approval_steps` edit); data via `watched_absences(from,to)`; the nav's `absencesPage` capability comes from the caller's row. The `absences` catalog item is gone.
- **Security without Employee = no requests, no accrual (FR-76).** `getCachedTimeOff` (live `user_roles`, not the claim) hides the Request tab/pages and Home cards; the DB enforces it (triggers on `leave_requests` insert/approve and `errand_extensions`; `accrue_leave` posts 0-minute rows so a later Employee role never backfills). Test fixtures that file requests for a security user must also give them `employee`.
- **Travel costs never reach the traveller:** `my_travel_itineraries()` strips per-stay `cost_rials` (`private.travel_itinerary_without_costs`); finance reads only `hotel_cost_rials` (= the stays' sum).
- **`jspdf` must stay ≥ 4.2.1:** 3.x has a critical advisory and CI runs `npm audit --omit=dev`. `html-to-image`/`jspdf` load with `import()` on click.
- **Worktrees:** a symlinked `node_modules` passes `tsc`/vitest but breaks `next build` (Turbopack refuses files outside the root); clone it with `cp -Rc ../bj/node_modules node_modules` (APFS, instant).
- **Secret columns vs CHECK errors:** a failed CHECK/NOT NULL echoes the whole row in DETAIL (to PostgREST callers and the DB log); writes to a table holding a secret must catch and re-raise by constraint name (`app_set_sms_settings`).
- **UI check without a login:** a temporary `app/[locale]/zz-…/page.tsx` (outside the route groups, so no auth layout) renders client components with fake data; delete it and `rm -rf .next/dev/types` before `tsc`.
- **View as (FR-86): `createClient()` sends `x-view-as` whenever the `bj-view-as` cookie exists; only `createRealClient()` is the admin's own identity** (session check, start, exit). Using the wrong one acts as the admin or as the person by mistake.
- **The View as hook setting (`pgrst.db_pre_request`) is a role setting, not in backups:** run `deploy/lib/sync-view-as-hook.sql` after any `pg_restore` (deploys already run it); a setting naming a missing function fails every request.
- **Route handlers must build redirects as relative `Location` paths, never from `request.nextUrl`:** behind the gateway it holds the container origin (`https://0.0.0.0:3000`).
- **`tests/e2e/view-as.spec.ts` runs only against the local Docker stack with `NEXT_PUBLIC_SUPABASE_ANON_KEY=` empty:** otherwise the global setup rewrites the real admin's language and weekend settings.
- **UI follows `docs/DESIGN.md` (Blueprint).** Every table gets `className="data-table"` (header band + row hover: mandatory); tabs come from `lib/ui/tabs.ts`, never pills; no `shadow-*`, no `rounded-[Npx]`, `rounded-full` only for circles.
- **Full-width page = `data-wide` on the page's root element** (`AppShell` lifts `max-w-6xl`); never widen just the table.
- **Light only:** `dark:` utilities are dead (`@custom-variant dark` in `globals.css`); they once followed the OS and greyed inputs.
- **Two blues:** `--sidebar` `#20409a` (logo blue: side panel, phone top bar) and `--primary` `#2E3C92` (buttons). The logo PNG's white is transparent: on blue it needs the white plate from `MainNav`.
- **Phone titles:** `MobileTopBar` shows the section name, so top-level pages pass `section` to `PageHeader`; a new nav section needs a row in its `SECTIONS` list.
- **`usePathname()` has no locale prefix in Farsi** (default locale): compare paths with and without `/${locale}` (see `AdminTabs`, `MainNav.isActive`).
- **Dev server against the isolated demo stack:** `bj-dev-isolated` in `.claude/launch.json` (:3100); sign in at `http://localhost:3501` first (the gateway's CORS rejects :3100, the cookie is shared).
- **Restoring a live dump locally:** create role `supabase_functions_admin` (NOLOGIN) on the fresh cluster first, and switch SMS off (`private.sms_settings` mode `off`, key NULL) + `cron.job` inactive BEFORE the app starts — the dump has live SMS and a real key.
- **Print signature boxes = approval steps (FR-89):** box title is `approval_steps.box_label`, snapshotted on each decision (`leave_request_approvals.box_label`); `lib/leave/paperForm.ts › stepBoxes` lays them out. Two migrations that both redefine one function must keep each other's changes (FR-88 + FR-89 both redefine `request_data_get_leave_request_signatures`).
- **Leave admin targets use `private.can_manage_leave_of` (no D4); "the HR step" is `private.is_hr_step` (role hr, or a named person holding hr).** Never test `role='hr'` on a step directly. The per diem and travel box go to ONE step only, `private.request_per_diem_step` (the first HR step); the app reads it as `hr_step` / `per_diem_allowed`.
- **A company has at most one unnamed approval step per role + scope** (`approval_steps_company_role_scope_uniq`): SQL fixtures needing two HR steps use a named step whose person holds hr.
- **Annual leave = `leave_types.manager_overdraft` (FR-92).** Seed sets it; migrations run before the seed on a fresh install, so a migration UPDATE alone leaves new stacks without it.
- **Leave rules per request come from `private.balance_rule(emp,type)`:** Manager (role at action time) → overdraft (balance may go negative); other → strict (balance − pending); non-annual balance types → split. TS mirror: `projectLeaveBalance` rule option.
- **CSV exports go through `buildCsv`, which guards formula cells with a leading `'`; `parseCsv` strips it.** Pass `{ guard: false }` only for byte-exact generated values (passwords).
- **Melipayamak has two keys (FR-78):** connection `webservice` = panel username + panel API key → `rest.payamak-panel.com` (JSON); `console` = a separate console token in the URL. A refused sign-in sets `sms_settings.auth_error` and pauses live sending until the settings are saved.
- **`sms_dispatch` handles each row in its own `begin … exception` block (F5) and retries only connect/DNS/TLS errors (F4).** Keep new per-row work inside the block; never re-queue a timeout or 5xx (it may already be delivered).
- **Hourly leave minutes = span − lunch overlap (FR-93):** `private.lunch_overlap_minutes` (TS `lunchOverlapMinutes`), cap uses net; a lunch-only leave on a working day (`private.is_working_day`) is valid at 0 and skips the one-per-day slot. Errands never subtract lunch.
- **`work_settings` time checks compare minutes (`extract(epoch …)/60`), not `time + interval`** — the latter wraps at midnight.
- **Local `postgres` has anon/ACL drift:** a raw `pg_dump` adds anon grants and 15 `tests/sql` files fail on any clone. Update `schema.sql` by diffing schema dumps of the clone before/after the migration and patching only those hunks.
- **ERP › Sales (FR-94) is function-only and hidden:** `sales_*` tables + `project_nodes` have no client grants; go through `app_sales_*` / `app_project_*` (JSON in, JSON out; types in `lib/sales/types.ts`). Caps come from `app_sales_bootstrap()`, not the token.
- **Sales record edits go through stage pages** (`?stage=<id>`, `lib/sales/stagePages.ts` maps stage `code` → page): `app_sales_save_record(p_id, p, p_stage)` logs `changes` old → new; keep price keys `hidden` there. `RecordForm` is for New record only.
- **Sales price / guarantee values must never leave for a caller without `sales_prices` / `sales_bonds`:** strip keys in the SQL function, keep them out of `sales_events` bodies and deadline labels, and re-raise CHECK failures as `sales: invalid input`.
- **Sales read functions are `stable` and must not write or lock** (View as + PostgREST run them read-only); every Sales write locks the `sales_rfps` row first (`private.sales_rfp`), then children.
- **The `sales` message namespace reaches the browser only from `sales/layout.tsx`** (root layout strips it); a client component outside `/sales` cannot use `useTranslations('sales')`. No `sales` permission → `notFound()`, never a redirect.
- **A new Sales write function calls `private.sales_writable(rfp)`** (closed record = `sales_decide` only) unless it is items or finance, which stay open on purpose.
- **Date field inside a scrolling dialog:** `<PersianDateField portal>` + a dialog content that ignores outside presses on `.rmdp-portal` (Sales: `ModalContent`); otherwise the calendar is clipped.
- **Item numbers (`project_nodes.code`) are permanent:** never decrement `node_seq` / `child_seq`, never renumber, never change `record_no`.
- **Catalog key count is asserted in three places:** `tests/unit/permissions-catalog.test.ts`, `tests/sql/fr55-roles-permissions.sql`, `tests/sql/request-edit.sql` (33 since FR-94).
- **SQL test assertions: one statement per step.** `call() and (select … from table)` in one expression may read the table before the call runs (AND reorders by cost).
- **`.xlsx` is read and written by `lib/sales/xlsx.ts` (fflate, values only)** in the browser; no spreadsheet library, no upload.
- **Sales stage kind `archived`** (imported inquiry, no result): closed, bid flow, entered only by the inquiry import or `sales_decide`; any check listing closed kinds must include it.
- **Sales import removal follows `sales_rfps.import_batches`** (every batch that wrote the row), not `import_batch_id`; a new import function must `array_append` its batch.
- **Sales customers are picked (`CustomerCombo`), never created by typing** (owner rule §16.5); `app_sales_add_customer` / `similar_customers` behind "Create …". Merge logs events without `sales_touch` (keeps batches removable).
- **Sales imports resolve `sales_name_aliases` first** (customer spelling → customer, person name → employee); merges / renames / Name matching write them. Imports keep `in_charge_text` even when an owner is set (Name matching needs it).
- **Imported results are dated by the file** (`result_at` = offer, else received date), never `now()`: metrics date a sale by order → result → offer → received.
- **Docker VM disk (15 GB) fills with build cache** after repeated `compose build app`: `docker builder prune -f` frees it; a full disk makes Postgres refuse writes.
- **`npm audit --omit=dev` is a CI gate** (`scripts/audit-gate.mjs`): a new advisory fails every deploy until upgraded (2026-11-16: next 16.4.3 → 16.4.6). Only an advisory with no fixed version may go on its `IGNORED` list, with a reason + a TASKS line (2026-11-18: picomatch GHSA-fc5q-39xc-vjpf).
- **Test roles (FR-95): any `app_role` starting with `test-` (today `test-emp`) = `private.is_test_account`, which beats every other role** — own data only, no requests. A new function that lists colleagues or files on someone's behalf must check it.
- **Own SMS mobile = `app_set_my_mobile` (FR-96), never the RLS update** (that needs `personal_info_own`). Profile is route tabs (`profile/layout.tsx`); language + password live on `/profile/account`, so e2e goes there.
- **Sales branch works in worktree `/Users/amir/Workspace/bj-sales`** (main checkout stays on `main`). The `:3501` stack's DB (`bj-approvals-finance-db-1`, db `postgres`) already holds every Sales migration + main's; dry-run new Sales migrations on a clone of it, never on the DB itself until deploying the branch there.
- **The `:3501` stack builds from the main checkout** (`.bj-deploy/approvals-finance/compose` does `cd /Users/amir/Workspace/bj`): to run the Sales branch there, build the app from `../bj-sales` (same project name/env/override files, absolute paths) — do not switch the main checkout's branch.
- **Sales files (2026-11-20 spec): bytes on volume `sales-files` (`FILES_DIR`, `/data/files`), only through `lib/files/store.ts`; SQL `app_sales_file_*` owns every check; uploads are raw-body POST + `X-File-Name` (never `formData()`, it buffers); downloads always `attachment`.** `proxy.ts` skips `/api`, so file routes refresh the session themselves.
- **Sales currencies come from `sales_currencies` (`boot.currencies`), never a constant; a code is permanent once used** (deactivate, don't delete). **Product defaults are copied into item rows on pick (`app_project_save_node`), never linked.**
- **Sales View as = read-only transaction (writes fail `25006`); there is no `private.view_as_active()`.** Route handlers refuse writes when the `bj-view-as` cookie exists; client components use `useViewAs()`.
- **New `sales_events` kinds need the `sales_events_kind_check` constraint re-created** and a case in `ActivityLog`.
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
