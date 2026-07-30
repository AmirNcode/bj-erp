# TASKS

Build tracker. Status: ☐ todo · ◐ in progress · ☑ done · ⊘ blocked. Phases mirror `PLAN.md` §5.
The **detailed step-by-step implementation plan** (file-level, TDD) for Phases 0–2 lives at
[`docs/plans/2026-06-23-hr-timeoff-v1.md`](plans/2026-06-23-hr-timeoff-v1.md). Phases 3–5 get
their own plan files when reached.

> Current state: **Phases 0–6 + frontend overhaul COMPLETE — all merged to `main`; v1
> feature-complete & demo-ready, no v1 FR outstanding.** Identity/org, code+password auth, admin
> CRUD + manager edits, leave core (types/allocations/ledger/request), approval flow
> [`/manage/approvals`], FR-25 reason-private calendar [`/calendar`], role-aware home board,
> FR-23 settings + FR-7 password change + logout, FR-24 admin work/holiday editor, FR-15
> cancel-approved, and a **seeded demo** (BJ Manufacturing — 3 teams + Security, 12 users,
> `Demo!2026`). UI: shadcn/ui + brand OKLCH tokens + Rubik with Vazirmatn fallback across all
> **11 screens**, responsive `AppShell` (bottom tabs → desktop rail), lazy date picker,
> AlertDialog + toasts, Suspense/skeletons.
> **2026-06-30 polish:** account create/edit now manages PTO/annual + sick balances; logo,
> light-only lock, opaque chrome, active-tab highlight, and stronger buttons are implemented.
> **2026-07-02 production-readiness review:** ledger advisory locks, overlap + balance re-checks,
> atomic `app_set_user_roles`, employee-code validation, CSPRNG temp passwords, localized (fa/en)
> DB errors, security headers, company-timezone (Asia/Tehran) "today", RLS initplan + FK-index
> perf pass — 3 new migrations applied to the demo DB. See CHANGELOG 2026-07-02.
> **2026-07-02 nav-performance pass:** per-navigation Supabase round-trips cut 5–6 → 1–2
> (`getClaims` local JWT verification, roles-in-JWT via custom access token hook with DB
> fallback, parallel home reads, `staleTimes` 5-min client router cache + mutation-side
> `invalidateAppCache()`, Vercel `fra1` pin). Plan: `docs/plans/2026-07-02-nav-performance.md`.
> ⊘ Operator steps pending: apply migration `20260702150001_custom_access_token_hook.sql`
> to the hosted project, then enable the hook (Dashboard → Auth → Hooks).
> **Gates:** unit 103/103 · build green · e2e 21 specs (serial/CI; needs live Supabase + dev server).
> **Deploy = runbook (`docs/DEPLOY.md`), not executed.** **Next: PLAN §6 backlog** (attendance,
> shifts, …) + demo deploy. Specs/plans in `docs/specs/` + `docs/plans/`; history in
> `.superpowers/sdd/progress.md`.

## Phase 0 — Scaffold
- ☐ Init repo (git), Next.js App Router + TypeScript + Tailwind
- ☐ Add PWA (manifest, service worker, installable, persistent session)
- ☐ i18n + RTL shell (fa default / en), direction switch
- ☐ Supabase project + local CLI; env wiring (`NEXT_PUBLIC_SUPABASE_URL`, keys)
- ☐ First deploy to Vercel (boots in fa-RTL)
- ☐ Confirm `react-multi-date-picker` + date-math lib APIs via Context7, pin versions

## Phase 1 — Identity & org
- ☐ Migrations: companies, departments, profiles, user_roles, audit_log (+ enums)
- ☐ RLS + helper functions (`has_role`, `is_manager_of`, `same_team`, `can_read_all`)
- ☐ Username/password auth (admin-issued); first-login password change
- ☐ Admin console: employee CRUD, assign role(s)/team/manager
- ☐ Manager: edit direct reports (subset)

## Phase 2 — Leave core
- ☐ Migrations: work_settings, holidays, leave_types, leave_allocations, leave_requests, leave_ledger
- ☐ Server-side working-day counting function (weekend + holidays, half-day)
- ☐ Allocation → ledger; balance derivation
- ☐ Request form (type, dates via Persian/Gregorian picker, full/half), shows remaining balance

## Phase 3 — Flow & visibility ✅
- ☑ Approval (manager approve/reject; admin override); ledger consumption on approval
- ☑ Cancel pending request *(shipped in Phase 2)*
- ☑ RLS for visibility matrix (employee=team, manager/security=all read) + FR-25 reason privacy
- ☑ Calendar view scoped by viewer

## Phase 4 — Home board & polish ✅
- ☑ Home status board per role (employee statuses+balances+team; manager queue+reports)
- ☑ Role-driven bottom-tab nav (Home · Request · Calendar · Profile [+ Manage])
- ☑ Settings: calendar (Persian/Gregorian) + language (fa/en) toggles, persisted
- ☑ Responsive + device detection pass; accessibility/touch-target pass

## Phase 5 — Seed & demo ✅ (deploy = runbook)
- ☑ Seed: 1 company, 3 teams + Security dept, Iranian names/roles, admin/managers/employees/security
- ☑ Seed: leave types + annual allocations; Iranian holidays (minimal placeholders, admin-editable)
- ◐ Deploy demo (runbook `docs/DEPLOY.md`; not executed); smoke-test each role e2e ☑ (`seed-roles.spec`)
- ☑ Update CHANGELOG + flip REQUIREMENTS statuses

## Phase 6 — Settings, password, cancel-approved ✅
- ☑ FR-24 admin work-settings (weekend days) + holiday add/edit/delete editor (`/manage/settings`),
  direct admin RLS writes (no migration)
- ☑ FR-7 self-service password change (in-DB current-password verify; `app_change_my_password`)
- ☑ FR-15 cancel an approved-future request with ledger `reversal`
- ☑ Docs (REQUIREMENTS/PERMISSIONS/DATA_MODEL/CHANGELOG) + SDD ledger

## Post-v1 polish ✅
- ☑ Calendar list/month toggle with highlighted off days, per-day counts, visible names, overflow
  marker, and selected-day return-to-work details
- ☑ Request-page language consistency for leave type names, date picker locale/digits, preview
  counts, balances, request-row dates, and request-row day counts
- ☑ Home **My Team** section with manager, teammates, role/title context, and upcoming time-off
- ☑ Mobile calendar month grid fixed to seven columns; Manage Employees mobile actions moved below
  the title
- ☑ App-shell tab prefetching plus a per-page update pill for manual data refresh / last-loaded time

## Self-host installer (2026-07-03) ✅
- ☑ `deploy/` package: Docker Compose stack (Supabase Postgres + GoTrue + PostgREST + app +
  Caddy HTTPS gateway w/ internal CA), `install.sh` (secrets, migrations, seed, first admin,
  CA export), `package.sh` (offline bundle, all images saved), `RUNBOOK.md` (en + fa)
- ☑ App support: `output: 'standalone'`, runtime `SUPABASE_URL` override for server-side calls,
  entrypoint placeholder substitution for baked `NEXT_PUBLIC_*` values

## Production deploy + release pipeline (2026-07-26)
Plan `docs/plans/2026-07-26-release-pipeline.md` · guide `docs/DEPLOY-GUIDE.md`
- ☑ **Live on the client's Ubuntu server** at `https://10.10.10.50` (LAN-only by design;
  off-site staff reach it over the company's existing corporate VPN)
- ☑ `deploy/setup-release.sh` — one-time SSH key + `bj` alias + connection multiplexing
- ☑ `deploy/release.sh` — gates, amd64 cross-build + architecture verification, resumable
  ship, remote trigger, pre-deploy backup copied back to the Mac
- ☑ `deploy/update.sh` — lock, preflight, verified backup, row-count assertions, idempotent
  migrations, single-container cutover, health check, automatic rollback, retention
- ☑ `RUNBOOK.md` update section rewritten; backup command corrected to `supabase_admin`
- ☐ **Run the acceptance test** (plan Task 5): first real release, verify row counts and the
  volume timestamp are unchanged, confirm login survives, rehearse the rollback drill
- ☐ Scheduled off-server backups between releases (cron `pg_dump` + periodic pull)
- ☐ Enter the real 1404–1405 Iranian holidays via `/manage/settings`; import the client's
  employee roster (CSV)

## Employee onboarding & logout UX (2026-07-13) ✅
Spec `docs/specs/2026-07-13-employee-onboarding-design.md` · plan `docs/plans/2026-07-13-employee-onboarding.md`
- ☑ Logout: bottom of profile page, outside cards, AlertDialog confirmation
- ☑ `departments.code` + `profiles.personnel_no`/`job_title`; employee codes generated in-DB
  (`prod-1042`), read-only preview in the form; dept codes editable in Manage → Settings
- ☑ Manager-scoped creation (own dept/team, employee role only, default quotas) enforced in
  `app_create_employee` v2; admin path unchanged
- ☑ Admin bulk CSV import with validation preview + one-time credentials CSV;
  bulk password regeneration on the employees list as the recovery path
- ☑ Migration `20260713120001`, unit 130/130, e2e 23/23, lint+build clean; local Docker stack
  rebuilt with the new image; landed via PR #4

## Add departments from the app (2026-07-25) ✅
- ☑ Admin-only **Add Department** button beside *Add Employee* on Manage → Employees
- ☑ `/manage/departments/new`: fa/en names, login-code prefix (auto-suggested from the English
  name), `kind`; taken codes listed; success screen links into *Add employee*
- ☑ `createDepartment` server action on the existing `departments_insert_admin` RLS policy —
  no migration; audit row + cache invalidation; shared code validation in `lib/departments/code.ts`
- ☑ fa/en messages + `dbErrors` for duplicate/invalid code and missing name
- ☑ `tests/unit/department-code.test.ts` + `tests/e2e/department.spec.ts` (test departments use
  the reserved `zz` prefix, cleaned up by `scripts/cleanup-e2e.mjs`)
- ☑ Gates: unit **139/139**, e2e **25/25** serial against the local Docker stack, lint + tsc +
  build green; landed via PR #4

## Login password field (2026-07-29) ✅
- ☑ Show/hide password toggle on `/login` (`password-toggle` testid, localized `aria-label`,
  `dir="ltr"` on the wrapper so it sits at the visual end of the field in RTL)
- ☑ Password inputs forced latin + LTR via `toLatinPassword()` (`lib/auth/passwordPolicy.ts`) —
  a Farsi keyboard was producing passwords that could never match
- ☑ Same rule applied to the change-password form, so a password can't be set that login
  refuses to accept
- ☑ Gates: unit **143/143**, e2e **26/26** serial, lint + tsc + build green (uncommitted)
- ☐ Pre-existing non-latin passwords (if any exist on the client's install) need an admin reset —
  undetectable from here, passwords are hashed

## Rejection reason + latin login fields (2026-07-29) ✅
- ☑ Optional free-text reason on reject, in both dialogs (approvals queue + calendar)
- ☑ Stored on `leave_requests.decision_note` (migration `20260729120001`) and shown to the
  employee on their own request — it was previously written to `audit_log` only, where the
  person it was written for could never read it
- ☑ Employee-code field on `/login` latin-only + LTR via `toLatinCode()`, matching the password
- ☑ Gates: unit **147/147**, e2e **26/26** serial, lint + tsc + build green
- ☐ Follow-up (user's plan): replace the free-text field with preset reasons + dropdown,
  keeping free text as the "other" case

## Leave v2 — hourly, accrual, replacement (2026-07-29) ◐
Spec: [`docs/specs/2026-07-29-hourly-accrual-replacement-design.md`](specs/2026-07-29-hourly-accrual-replacement-design.md).
Client feedback after reviewing the live app, plus their two paper forms in `docs/forms/`.
Five plans, in this order; each ships working software on its own.

- ☑ **Plan 1 — Foundations** ([plan](plans/2026-07-29-leave-v2-foundations.md))
  - ☑ `jalali_months` reference table, 612 rows generated + property-tested
  - ☑ Stored unit converted days → integer minutes (expand/backfill/contract, 3 migrations)
  - ☑ `work_settings.hours_per_day`; balances render as "۹ روز و ۴ ساعت"
  - ☑ Acceptance SQL for the client-server upgrade
  - ☐ **Not yet applied to the client's server** — see the plan's Deployment note
- ☑ **Plan 2 — Accrual** ([plan](plans/2026-07-29-leave-v2-accrual.md))
  - ☑ `employee_leave_policies` + leave-type defaults + `period_month` + the idempotency index
  - ☑ `lib/leave/accrual.ts` pure planner (15 unit tests) mirrored by `accrue_leave` in SQL
  - ☑ Lazy accrual on every balance read + submit; admin "Post accruals now" in Settings
  - ☑ Policy editor on the create and edit employee forms
  - ☑ Fixed the `created_at`-tie balance bug it exposed (`leave_ledger.seq`)
  - ☐ **Not yet applied to the client's server**; existing staff need a reviewed one-time policy
    backfill first — see the plan's Deployment note
- ☐ **Plan 3 — Hourly**: `unit` enum + `start_time`/`end_time`, company work-hours window, 4h/day
  cap, time-aware overlap, separate `/request/hourly` screen
- ☐ **Plan 4 — Replacement**: `replacement_id`, same-department searchable picker with
  availability, "you are covering X" on Home
- ☐ **Plan 5 — Serials**: per-Jalali-year request numbers (`1404-0042`)
- ☐ Deferred, documented in spec §11: signature / insurance evidence. Next step is a question for
  the client's insurer, not code
- ☐ Deferred, own spec: multi-step approval + حراست gate check (their forms carry 4 signatures)

## Backlog (post-v1, see PLAN §6)
- ☐ Notifications (push/SMS/email) once a channel is chosen
- ☐ Attendance/check-in · shift scheduling · overtime · advance/loan · payslips · announcements ·
  documents · QC / finance / procurement modules
