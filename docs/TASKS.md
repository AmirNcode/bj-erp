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
> **2026-07-30 security review:** active-account RLS, manager authority, audit integrity,
> transactional password reset, hourly approval overlap, input validation, and deployment/browser
> hardening are complete locally. Evidence: `docs/SECURITY-REVIEW-2026-07-30.md`.
> ☑ Release gate closed 2026-07-31: `npm audit --omit=dev` DOES run from this Mac. Result: **3 high**,
> all transitive through `next@16.2.9` (postcss XSS + path traversal, sharp/libvips). Pre-existing on
> `main` — not introduced by any recent branch. Fix is a patch bump to `next@16.2.12`.

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

## Header, request, and employee-form UI polish (2026-08-04) ✅

- ☑ Move the Updated control from individual page headers into the shared app header, with physical
  placement before Profile in English and after Profile in Farsi/RTL
- ☑ Add the existing request-cancellation flow to Home → My Recent Requests through one shared control
- ☑ Remove replacement search/filter code; use a dropdown prompt plus a disabling No Replacement checkbox
- ☑ Replace Add Employee's native Gregorian hire-date input with the preference-aware picker; missing or
  unknown preferences default to Jalali
- ☑ Gates: TypeScript + lint clean, **38 unit files / 242 tests** passed, production build clean;
  targeted replacement/leave e2e was attempted but the local Supabase endpoint at
  `192.168.2.48:8080` was unavailable (`ECONNREFUSED` before login)

## Self-host installer (2026-07-03) ✅
- ☑ `deploy/` package: Docker Compose stack (Supabase Postgres + GoTrue + PostgREST + app +
  Caddy HTTPS gateway w/ internal CA), `install.sh` (secrets, migrations, seed, first admin,
  CA export), `package.sh` (offline bundle, all images saved), `RUNBOOK.md` (en + fa)
- ☑ App support: `output: 'standalone'`, runtime `SUPABASE_URL` override for server-side calls,
  entrypoint placeholder substitution for baked `NEXT_PUBLIC_*` values
- ☑ Architecture-separated local workflow: dedicated `linux/arm64` tags + Compose overlay on
  Apple Silicon, while production package/release remains explicitly `linux/amd64`; conversion
  reuses and verifies the existing `bj-erp_db-data` volume

## Production deploy + release pipeline (2026-07-26)
Plan `docs/plans/2026-07-26-release-pipeline.md` · guide `docs/DEPLOY-GUIDE.md`

### Guided deployment assistant (2026-08-06)

- ☑ One interactive/non-interactive `deploy/bj-deploy` entry point for local ARM64 and client AMD64
- ☑ Read-only doctor/status/logs; restart, app-only, safe update, database reset, and factory reset
- ☑ Target-specific Compose overlays/tags with runtime architecture verification for all services
- ☑ Private immutable migration ledger + known 38-migration legacy adoption + app-only manifest gate
- ☑ Verified off-server backup and exact labeled-volume/typed-phrase guards before production reset
- ☑ Detached, locked remote jobs with atomic status/log files and `resume <run-id>` after SSH loss
- ☑ Stable `/api/health` plus separate database/Auth checks executed on the target network
- ☑ Passwordless-SSH setup, Mac/phone local routing, recovery, and full command reference in
  `docs/DEPLOY-ASSISTANT.md`; cold-start design/plan preserved under `docs/specs/` and `docs/plans/`
- ◐ First live client execution — latest attempt `20260813T004921Z-b987f2` created a verified backup,
  preserved row counts, and atomically applied/recorded all three August migrations. Cutover then
  recreated stale exported `APP_VERSION=latest`, so the old image failed the new `/api/health`
  contract and was rolled back to itself; the new image never ran. The corrected controller can
  retry the verified uploaded artifact in a new run before this becomes ☑.
- ☑ **Live on the client's Ubuntu server** at `https://10.10.10.50` (LAN-only by design;
  off-site staff reach it over the company's existing corporate VPN)
- ☑ `deploy/setup-release.sh` — one-time SSH key + `bj` alias + connection multiplexing
- ☑ `deploy/release.sh` — gates, amd64 cross-build + architecture verification, resumable
  ship, remote trigger, pre-deploy backup copied back to the Mac
- ☑ `deploy/update.sh` — lock, preflight, verified backup, row-count assertions, pending-only
  ledgered migrations, single-container cutover, health check, automatic rollback, retention
- ☑ **Migration replay resolved (2026-08-13).** The 2026-07-31 caveat — historical migrations
  are not idempotent, so a blind replay aborted on file #1 (`20260623120001_core.sql:11`,
  bare `create type public.app_role`) against a populated database — no longer applies. Every
  path (`install.sh:175`, `update.sh:156`, `bj-deploy:591`) goes through `bj_apply_migrations`,
  which consults the `bj_deploy.schema_migrations` ledger and skips applied files by checksum.
  Each migration and its ledger row share one `--single-transaction`, so a mid-run failure
  rolls back that file only and leaves earlier ones recorded and resumable — the old
  all-or-nothing repair risk is gone. Proven live on the client: 41 consecutive skips.
- ☑ `RUNBOOK.md` update section rewritten; backup command corrected to `supabase_admin`
- ☑ **Acceptance test run (2026-08-13)**, run `20260813T020320Z-901150`: row counts identical
  before and after (profiles 3, user_roles 6, leave_requests 1, leave_ledger 7, holidays 0,
  departments 5, leave_types 3, companies 1), app/db/auth health green, pre-deploy dump taken,
  `pg_restore -l`-proven, and copied off-server
- ☐ Rehearse the rollback drill (the one part of plan Task 5 still unexercised). Cheapest now,
  while the client database holds only throwaway test data
- ☐ **Client server disk headroom** — 6.0 GiB free of 29 GiB (79% used, measured 2026-08-13)
  against the assistant's 5 GiB preflight gate. One or two more release cycles and
  `client_release_preflight` will start refusing. Prune old images/backups on the server
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

## Leave v2 — hourly, accrual, replacement, serials (2026-07-29) ☑ all five plans built, none deployed
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
- ☑ **Plan 3 — Hourly** ([plan](plans/2026-07-29-leave-v2-hourly.md))
  - ☑ `leave_unit` + times + the CHECK that makes a malformed row impossible
  - ☑ Work-hours window + per-day cap in `work_settings`, editable in Settings
  - ☑ `lib/leave/hourly.ts` (17 tests) mirrored by the SQL; one writer, two wrappers
  - ☑ `/request/hourly` screen, Home buttons, time ranges in every listing + the calendar
  - ☐ **Not yet applied to the client's server**; `allow_hourly` flips on for annual + unpaid the
    moment the migration runs, so leave the flags false there for a staged rollout
- ☑ **Plan 4 — Replacement** ([plan](plans/2026-07-29-leave-v2-replacement.md))
  - ☑ `replacement_id` + `get_replacement_candidates` (annotated, not filtered) + `get_my_cover_conflicts`
  - ☑ One shared predicate (`private.replacement_is_away`) for the read, the submit guard, and approval
  - ☑ Searchable picker on both screens; "you are covering" on Home; cover + clash on approvals
  - ☐ **Not yet applied to the client's server**
- ☑ **Plan 5 — Serials** ([plan](plans/2026-07-29-leave-v2-serials.md))
  - ☑ `leave_request_serials` counter + `company_id`/`serial_year`/`serial_seq` + backfill
  - ☑ Allocated in the writer under a counter row lock; proven across two concurrent employees
  - ☑ `lib/leave/serial.ts` (5 tests); shown on requests and approvals
  - ☐ **Not yet applied to the client's server** — this is the one plan with a MANDATORY backfill
- ☑ **Requester signatures + consent (FR-32)**
  ([spec](specs/2026-08-05-request-signatures-and-daily-date-fields-design.md))
  - ☑ Required fresh mouse/touch PNG and authorization checkbox on daily, hourly, and errand forms
  - ☑ Database-generated consent timestamp; immutable evidence retained with every request status
  - ☑ Lazy RLS-protected viewer for requester, direct manager, security, and admin; absent from the
    teammate calendar view
- ☑ **Daily date UX (FR-32)** — separate preference-aware Start date / End date pickers; hourly and
  hourly-errand forms remain single-date
- ☑ **Signed approvals + Persian-only calendar (FR-14 / FR-23)**
  ([spec](specs/2026-08-05-approval-signatures-persian-only-calendar-design.md))
  - ☑ Direct-manager and admin approvals require a fresh signature and explicit authorization;
    rejection remains unsigned
  - ☑ Requester, direct manager, security, and admin can lazily view requester and approver evidence
  - ☑ Remove the Gregorian preference UI and force every picker/date display to Persian/Jalali
  - ☑ Retain `profiles.calendar_pref` only for schema compatibility and constrain it to `jalali`
- ☑ **Daily work errands + paid-leave overage (FR-13 / FR-33)**
  ([spec](specs/2026-08-05-daily-work-errands-and-pto-overage-design.md))
  - ☑ Four localized request tabs: Daily leave, Hourly leave, Daily Work Errands, and renamed
    Hourly Work Errand; daily errands use separate Persian Start/End dates
  - ☑ Daily errands reuse `kind='errand'`, `unit='day'`, the errand serial/privacy model, signed
    request/approval flow, and never affect a leave balance
  - ☑ Paid daily/hourly previews show Requesting, projected Remaining Balance, and conditional
    Unpaid Time Off using configured minutes (8 hours/day by default)
  - ☑ `leave_requests.unpaid_minutes`; approval recomputes the split under the employee lock,
    consumes only the paid portion, and cancellation restores only that paid portion
  - ☑ Migration `20260806014310_daily_work_errands_pto_overage.sql` applied to the preserved local
    ARM64 database after backup and rollback dry run; **not applied to the client's AMD64 server**
  - ☑ Gates: lint, TypeScript, production build, **254 unit tests**, and focused request e2e
    (**3 passed**) on the native ARM64 stack
- ☐ Deferred, own spec: multi-step approval + حراست gate check (their forms carry 4 signatures)

## Work errand + login codes (2026-07-30) ☑ built, not deployed
Spec: [`docs/specs/2026-07-30-work-errand-and-login-codes-design.md`](specs/2026-07-30-work-errand-and-login-codes-design.md).
Third client form (BJ-F 50207) plus a clarification that the paper شماره is the personnel number.

- ☑ **Errand (FR-30)** — `request_kind` discriminator + `errand_location` on `leave_requests`,
  `leave_type_id` nullable (migration `20260730130001`)
  - ☑ Nulling the type is what keeps errands out of the ledger; approve/cancel needed no change
  - ☑ `submit_errand_request` wrapper on the shared writer; overlap with leave works for free
  - ☑ Own tracking-number sequence — counter re-keyed on `kind`
  - ☑ `/request/errand`, Home button, tagged in listings/approvals/calendar
  - ☑ `team_leave_calendar` → LEFT JOIN (an inner join would have dropped every errand)
  - ☑ `lib/leave/errand.ts` (16 unit tests) + e2e; migration executed against a throwaway PG cluster
- ☑ **Login codes (FR-31)** — `employee_code = personnel_no` (migration `20260730130002`)
  - ☑ No backfill; `prod-1042` and `1042` both log in, permanently
  - ☑ e2e reap pattern widened — bare codes would otherwise accumulate on the client's DB
  - ☑ Six e2e specs repaired
- ☑ **Departments card** — names only, member panel, Add Department moved in from Employees
  - ☑ Codes auto-generated; editing deactivated (`updateDepartmentCode` + its RLS policy kept)
  - ☑ e2e helper puts its `zz` token in the name so `cleanup-e2e.mjs` still reaps test departments
- ☑ Gates: unit **239/239**, tsc + eslint + build green, each of the 5 commits verified green alone
- ☑ **e2e run 2026-07-31 — 32 passed / 1 skipped serial.** It found two bugs nothing else could:
  the serial-index collision below, and the calendar misreporting hourly absences
- ☐ **Not applied to the client's server**, and it stacks on all of leave v2, which is also unapplied

## Pre-merge review (2026-07-31) ☑ merged to `main`
Two reviewers over the 42-commit diff, plus the first e2e run on this branch tip.

- ☑ **CRITICAL** `leave_requests_serial_uniq` had no `kind`, so **every first errand of a year
  failed** — the whole BJ-F 50207 feature was non-functional. Reproduced on a copy of live data
- ☑ **CRITICAL** the calendar rendered a 2-hour absence as a full day and printed "returns
  tomorrow" — on a surface where managers approve. Hit hourly leave too, not just errands
- ☑ **IMPORTANT** `accrue_leave` silently lost months when an admin backdated `accrual_start_month`
- ☑ **IMPORTANT** an approved errand could never be cancelled (same-day form vs a `> today` gate)
- ☑ Dialog close button was hardcoded English; Home cover card dropped the hourly window;
  `tr('confirmBody')` works only via a production-only fast path; 2 vacuous e2e assertions
- ☑ **Deploy path resolved for THIS release by doing a fresh install** (2026-07-31). The client's
  server holds no real data, so the replay bug below is sidestepped rather than fixed. Verified on a
  throwaway `supabase/postgres:15.8.1.085`: **all 38 migrations + seed apply cleanly to an empty
  database and the end state is correct** — leave-type hourly/accrual flags, 612 `jalali_months`
  rows, work settings, `request_kind`, the kind-keyed serial index, and a calendar view that leaks
  neither reason nor errand location
- ☑ `deploy/package.sh` now builds **and pulls** for `linux/amd64` and refuses to package anything
  that is not. It previously did neither, so the fresh-install bundle would have carried arm64
  images that die on the client's server with `exec format error` — discovered on site, because the
  bundle is offline. The multi-arch service images (caddy especially) were the sharper half: a
  re-pull on an arm64 Mac swaps them silently
- ☐ **STILL OPEN — migrations are not replay-safe. Must be fixed before the first incremental
  update once real data exists.** Measured 2026-07-31: replaying all 38 against a populated DB
  fails **9**, starting at file #1 (`20260623120001_core.sql:11`, bare `create type app_role`).
  Five were never guarded (`create type`/`policy`/`trigger`/`function`); four broke when this
  branch's days→minutes conversion dropped columns and the serial counter was re-keyed
  (`20260623120006`, `20260624090002`, `20260729130002`, `20260729130013`).
  - `update.sh` aborts **safely** — app not restarted, backup intact — so a failed attempt costs
    nothing today. The hazard arrives *after* a partial fix: repair files 1–5 only and the loop gets
    further in, and a mid-run failure leaves a **half-migrated schema**, which `update.sh` does not
    undo. So this is all-or-nothing: verify with a full replay against a restored dump before it
    touches their server
  - Two routes: guard the nine (mechanical, directly provable by a replay loop), or add a
    `schema_migrations` table so each file runs once (the durable fix every migration tool uses).
    Recommend the guards first, tracking table after
- ☐ `npm audit`: 3 high via `next@16.2.9` (postcss, sharp). Pre-existing on `main`; fix is a patch
  bump to `next@16.2.12`
- ☐ Withdrawn mid-design: the bulk department-code editor. Client dropped code editing instead
- ☐ Open: `login.codePlaceholder` still reads `prod-1042` — right for every existing account, wrong
  for every new hire. Left alone because changing it is the mixed-format hint D14 ruled out

## Holidays, weekends, approvers, field errors (2026-08-18) ◐ batch A landed
Spec: [`docs/specs/2026-08-18-holidays-weekends-approvers-design.md`](specs/2026-08-18-holidays-weekends-approvers-design.md) ·
plan: [`docs/plans/2026-08-18-holidays-weekends-approvers.md`](plans/2026-08-18-holidays-weekends-approvers.md)

Four changes the owner asked for on 2026-08-18. Owner decisions are recorded in the spec as
**[owner]** — bi-weekly anchoring, full-day Thursdays, overwrite-on-duplicate holiday upload, and
blocking (not falling back) when a named approver is deactivated.

- ☑ **Batch A — FR-39 duplicate personnel number reported on the field.** Landed 2026-08-18,
  **not yet deployed.** No migration.
  - Root cause was the **error table, not the form**: `private.create_employee_impl` raises
    `personnel number already exists` (errcode 23505) and no rule in `lib/errors/db-error.ts`
    matched it, so `localizeDbError` logged `[db-error] unmapped:` and returned
    `dbErrors.unexpected`. Verified against the **live** function body via `pg_proc`, not by
    grepping migrations — this function has two versions in history and only the later one runs.
  - Three rules added: the raised message, the `profiles_company_personnel_no_key` unique-index
    violation (**not** redundant — the in-function `exists` test is a pre-check that two concurrent
    creates can race past), and `invalid personnel number`.
  - `Rule` gained an optional `field`; new `fieldForDbError()` returns it. It takes the **first
    matching rule**, not the first field-carrying one, so the message and its placement can never
    come from two different rules.
  - `dbErr` carries `field` onto the result as `DbErrorResult`. Additive: every existing caller
    reads only `.error`, and an error with no field still renders in the banner.
  - `NewEmployeeForm` renders it under the input with `aria-invalid`/`aria-describedby`, suppresses
    the banner for field-scoped errors, and clears on edit. Banner gained `data-testid="form-error"`.
  - Tests: `tests/unit/db-error.test.ts` (8 cases, incl. that employee-code errors stay at page
    level and that repeated calls are stateless — a `g` flag would break `.test()`),
    `tests/e2e/duplicate-personnel.spec.ts`.
  - **Both tests sabotage-checked.** With the rule's regex broken, the unit test fails
    `expected undefined to be 'personnel_no'` and the e2e fails `element(s) not found` on the field
    error; both green again after restoring.
  - Deliberately **not** a live availability check as the user types — the owner asked for it on
    submit, and probing per keystroke would leak the company's personnel numbering.
  - Also flipped two stale statuses left by the previous session: FR-34 ☐ → ☑ (it shipped in
    batch 1) and FR-35's parenthetical, which still said reports were pending.
- ☐ **Batch B — FR-40 bulk holiday upload.** CSV + template, four fields, Jalali-or-Gregorian dates,
  whole-file validation then upsert. No migration.
- ☐ **Batch C — FR-41 weekend frequency.** Two migrations. `private.is_company_weekend` holds the
  rule once; `compute_requested_minutes` currently repeats its weekend test in **four** places.
  Riskiest batch — it changes the function every request's minutes come from.
- ☐ **Batch D — FR-42 approval steps by role or person, editable by HR.** Two migrations. Swaps a
  unique constraint on a table holding **real backfilled client approval evidence**.

## Bulk holidays, weekend frequency, approval steps (2026-08-18) ☑ A–D landed, none deployed

Spec `docs/specs/2026-08-18-holidays-weekends-approvers-design.md` ·
plan `docs/plans/2026-08-18-holidays-weekends-approvers.md`.
**All of it is uncommitted on `main` and none of it has reached the client.**

- ☑ **Batch A — FR-39 personnel number reported on the field.** The bug was an *unmapped* database
  message falling through to the generic "unexpected error", not a form problem. Three rules added,
  errors gained an optional `field`, `NewEmployeeForm` renders it inline with `aria-invalid`.
- ☑ **Batch B — FR-40 bulk holiday upload.** `lib/csv/holiday-rows.ts` (30 unit cases),
  `bulkUpsertHolidays`, `HolidayImportDialog`. Whole-file validation, overwrite on duplicate date,
  Jalali-or-Gregorian dates, Farsi/English yes-no.
  - ☑ **Follow-up done 2026-08-18:** both parsers consolidated into
    `lib/leave/parseUserDate.ts` with the read-back check, so `parseHireDate` no longer rolls a
    non-existent day forward. Sabotage-checked — reverting the guard fails six tests across three
    suites.
  - ☑ **`date outside supported calendar range` is now translated.** It was unmapped, so
    back-dating a leave request before Farvardin 1400 produced the generic "unexpected error".
    Investigated because Amir asked what happens to staff hired before 1400 — **hire dates turned
    out to be unaffected** (verified end to end with a 1355 hire date); the limit is on request
    dates.
  - ☐ **Optional: widen `jalali_months` below 1400** if the client ever wants to load historical
    leave records. Cheap — `scripts/gen-jalali-months.mjs` generates the seed — but the error
    message names Farvardin 1400 and must be updated with it.
- ☑ **Batch C — FR-41 weekend frequency.** Migrations `20260818170001` (columns, two CHECKs,
  `private.is_company_weekend`) and `20260818170002` (`compute_requested_minutes` routed through the
  helper at its three weekend tests). `lib/leave/weekend.ts` rewritten as the mirror;
  `WorkSettingsForm` gained a three-state per-day control plus the reference-date picker.
  - Proven in SQL before any UI: 24 → 20 → **22** working days over one 28-day range.
  - ☐ **Not applied to the client's server.**
- ☑ **Batch D — FR-42 approval steps by role or named person.** Landed 2026-08-18.
  THREE migrations, not two: `180001` (schema, partial unique indexes, HR write policies,
  `search_approver_candidates`), `180002` (engine), and `180003` — the e2e reaper had to learn about
  the new foreign key, because `approval_steps.approver_id` deliberately blocks deleting a named
  approver and `app_cleanup_e2e_users()` hard-deletes throwaway accounts.
  - The `coalesce(step_id::text, step_role::text)` expression index in the plan **does not work** —
    an enum→text cast is only STABLE and an index expression must be IMMUTABLE. Two partial unique
    indexes give the same guarantee.
  - **An admin may not override a named step.** The spec's first draft said otherwise; it could not
    be reconciled with a deactivated approver blocking the step. Resolved in D28.
  - ☐ **Not applied to the client's server.**
- ☑ **Shared-state leaks fixed at the root.** `tests/e2e/global-setup.ts` is new and restores the
  demo admin's language and the weekend settings to baseline BEFORE the suite, so a spec that fails
  partway can no longer poison every later run. `hr-role.spec` updated for FR-42's moved boundary.

- ☐ **Fixed this session, worth not regressing:** `settings.spec.ts` left the shared demo admin on
  English, which since FR-34 broke every spec asserting Farsi on an unprefixed URL
  (`department.spec` ×2, `hourly.spec`). It now restores Farsi before logging out. **Any spec that
  changes a shared account's `language_pref` must restore it.**

## HR role, approval chain, language persistence (2026-08-18) ◐ planned, batch 0 landed
Spec: [`docs/specs/2026-08-18-hr-role-and-locale-persistence-design.md`](specs/2026-08-18-hr-role-and-locale-persistence-design.md) ·
plan: [`docs/plans/2026-08-18-hr-role-and-locale-persistence.md`](plans/2026-08-18-hr-role-and-locale-persistence.md)

- ☑ **Batch 0 — local dev unblocked.** `deploy/docker-compose.local-arm64.yml` publishes Caddy's
  plain-HTTP listener on `127.0.0.1:8080` (loopback only, never in `docker-compose.yml`);
  `.env.local` repointed at it **and** given the local stack's anon key, which did not match and was
  returning 401 from PostgREST. Verified end to end: preflight 204, token POST 200 with a real
  credential / 400 with a wrong one, no CSP or CORS errors, HTTPS site and Caddy CA untouched.
- ☑ **Batch 1 — FR-34 language persistence.** Landed 2026-08-18, **not yet deployed to the client.**
  Root cause confirmed against next-intl's own `resolveLocaleFromPrefix`: `localeDetection: false`
  skips cookie *and* header, so with `localePrefix: 'as-needed'` every prefix-less URL was Farsi —
  and the PWA's `start_url: '/'` made that every home-screen launch.
  - `lib/i18n/locale.ts` (new, pure) + 18 unit tests, including a guard that its locale list cannot
    drift from `i18n/routing.ts`
  - `proxy.ts` redirects a prefix-less path to the preferred locale, carrying over refreshed auth
    cookies so a rotated session is not dropped at that exact moment
  - cookie written by `updateMyPrefs` (server) and at login (client); `app_locale` JWT claim added by
    `20260818120001_locale_claim.sql` for the new-device case
  - `app/[locale]/page.tsx` resolves from the profile — the backstop for a token predating the claim
  - `accept-language` still ignored on purpose (spec D2)
  - Gates: tsc · lint · **unit 272/272 (41 files)** · build · **full e2e 33 passed / 1 pre-existing
    skip, serial**. The new e2e assertions were confirmed to **fail** with the middleware branch
    disabled, so they genuinely cover the bug.
- ☑ **Batch 2 — FR-35 `hr` role exists and reads.** Landed 2026-08-18, **not yet deployed.**
  - `20260818130001_hr_role_enum.sql` — `alter type … add value 'hr'` and **nothing else**. The split
    is mandatory: Postgres refuses to *use* a new enum value in the transaction that added it, and
    every migration file runs in one `--single-transaction`. Verified on this database.
  - `20260818130002_hr_role_access.sql` — `can_read_all` gains `hr`. That single helper **is** the
    whole grant; no policy was created or edited. It also asserts that `has_role` still requires an
    active profile, so a deactivated HR account cannot keep the access.
  - `lib/nav/tabs.ts`, `manage/layout.tsx` — hr reaches `/manage`; Settings, Allocations and
    Add-Department still bounce it, since those are company configuration.
  - `hr` added to the role checkbox lists and to the `app_role` union in the hand-maintained
    `lib/supabase/types.ts`.
  - Gates: tsc · lint · **unit 275/275** · build · **full e2e 35 passed / 1 pre-existing skip**.
  - **A first version of the e2e proved nothing and was fixed.** Both throwaway users landed in the
    same department, so `profiles_select`'s `same_team` branch granted the read and the test passed
    even with the migration reverted. `createEmployee` gained an optional `departmentIndex` (default
    unchanged) and the spec now puts them in different departments; with `hr` removed from
    `can_read_all` it now fails, as it must.
  - Known gap, deliberately not fixed here: role checkboxes render **raw English slugs**
    (`admin`/`manager`/…/`hr`) even in Farsi. Pre-existing for the other four. Translating them means
    changing `createEmployee`, which selects checkboxes **by label text** — a shared helper used by
    ~15 specs. Worth doing as its own change, with `data-testid`s per the repo's own lesson.
- ☑ **Batch 2b — FR-38 HR reads and prints every request.** Landed 2026-08-18 on the owner's request,
  **not yet deployed.**
  - `20260818140001_hr_reads_requests.sql` — `hr` joins the `leave_requests_select` policy, so HR
    reads the full base row: reason, errand location, decision note, both signature images. **This is
    a deliberate FR-25 widening**, justified by the paper process — all three client forms already
    carry an امور اداری و منابع انسانی signature box. `team_leave_calendar` untouched.
  - `/manage/requests` (hr + admin) — every request, every status, filter by status/kind/free text.
  - `/print/request/[id]` in a new `(print)` route group with its own auth guard, so the printed
    sheet carries no app chrome. Path is `/print/...` because `(print)/request/[id]` would collide
    with the real `/request/hourly` screens.
  - `lib/leave/paperForm.ts` + 13 unit tests — maps each stored request to the right form and its own
    signature boxes.
  - **Read off the photographs in `docs/forms/`:** the daily leave form is **BJ-F 50210(R0)**, a code
    not previously recorded anywhere in these docs; every form carries **four** signature boxes whose
    sets differ (50210 has جانشین and no حراست; the hourly forms are the reverse); and the fourth box
    is always HR's — direct confirmation of the FR-36 chain design.
  - Only the requester's and approver's signatures can be filled; the rest print blank for a wet
    signature, and the sheet says so.
  - ☐ **Ask the client:** is there a paper form for the *daily* work errand? We have no photograph.
    It currently reuses the 50207 layout and code, matching the single shared errand serial sequence.
- ☑ **Batch 3 — FR-35 HR adds employees.** Landed 2026-08-18, **not yet deployed.**
  - `20260818150001_hr_creates_employees.sql` — third authorization path in `app_create_employee`
    (checked **before** the manager branch, so a manager+hr user gets the wider scope) and a second in
    `app_bulk_create_employees`. Any department and any reporting line; `p_roles` overwritten to
    `{employee}`, and every CSV row's `role` column clamped the same way. Both bodies produced by
    patching `pg_get_functiondef` output rather than retyping, per `docs/MEMORY.md`.
  - `NewEmployeeForm` gained `canChooseScope` (admin || hr) alongside `isAdmin`. HR gets the
    department and manager pickers; it does **not** get role checkboxes, the opening allocation, or
    the accrual policy — `allocate_leave` and `set_employee_leave_policy` are admin-only in the
    database, so offering those fields would build a form that fails on submit. HR-created employees
    get the leave-type default quotas applied in-database instead, exactly like the manager path.
  - Clamp verified by calling the RPC directly as an HR user with `p_roles => ['admin','manager']`
    inside a rolled-back transaction: result was `employee`, audit path `hr`. **The e2e cannot prove
    this** — HR's form has no role checkboxes, so it never sends `p_roles`.
  - Gates: tsc · lint · **unit 288/288 (42 files)** · build · **full e2e 38 passed / 1 pre-existing
    skip**, plus a targeted re-run of the four employee-creation specs after the form refactor.
- ☑ **Batch 4 — FR-36 configurable approval chain.** Landed 2026-08-18, **not yet deployed.**
  - Three migrations: `20260818160001` schema + seed, `160002` backfill, `160003` engine. Split so a
    failure in one leaves the others resumable, since the ledger records each file separately.
  - `leave_status` deliberately unchanged — a request stays `pending` until the chain completes, so
    every existing query, view, index, policy and e2e assertion kept working.
  - The advisory lock moved **earlier**, before the step is chosen: two approvers signing different
    steps at the same instant would otherwise both see zero outstanding steps and both finalise,
    debiting the ledger twice.
  - Verified in SQL before any UI: manager signs → still pending, no ledger row; HR signs → approved
    with exactly one `consumption` row (4800 → 3840 min); double-sign refused; order enforcement
    refuses HR first, then allows manager→HR.
  - `lib/leave/approvals.ts` rewritten as the pure mirror of the SQL (31 unit tests). The old
    `tests/unit/approvals.test.ts` was superseded; its two unique edge cases were **ported**, not
    dropped, before deleting it.
  - UI: chain progress in the approvals queue, an admin card in Manage → Settings for order and
    activation, and the printed form now fills its تصویب کننده box from the manager step and its HR
    box from the hr step.
  - **Three existing specs asserted the old one-signature contract and were updated**, not deleted:
    `approval`, `hourly`, `leave`. New `approveThroughChain` helper.
  - Gates: tsc · lint · **unit 321/321 (42 files)** · build · **full e2e 39 passed / 1 pre-existing
    skip**.
- ☑ **Batch 5 — FR-37 HR reports + CSV export.** Landed 2026-08-18, **not yet deployed.**
  - `/manage/reports` (hr + admin; a manager is redirected). Five reports: leave balance by employee,
    requests by status, absence by department, requests waiting (with who they are waiting on, from
    the FR-36 chain), and headcount by department.
  - `lib/reports/reports.ts` — pure builders, 23 unit tests. Every builder returns the same
    `ReportTable`, so there is ONE table renderer and ONE download button rather than five of each.
  - Export is UTF-8-BOM CSV via the existing `buildCsv`. **No new dependency.** Durations export as
    decimal days, not "۹ روز و ۴ ساعت" — HR sums and sorts these in Excel, and a formatted string
    cannot be summed.
  - **No new RLS policy and no new SECURITY DEFINER function.** Everything is a plain SELECT; the
    `can_read_all` widening from batch 2 is what makes it company-wide.
  - The period is a URL parameter, so a report is linkable and reloadable and the server re-queries
    rather than filtering a snapshot in the browser. Months come from the `jalali_months` table so
    the report's idea of a Jalali month cannot drift from the ledger's.
  - One real bug found by the e2e: PostgREST refused the self-referential `manager` embed on
    `profiles` even with the correct constraint hint. Manager names are now resolved in memory from
    the profile list that was already fetched — one fewer join and one fewer failure mode.
  - Gates: tsc · lint · **unit 344/344 (43 files)** · build · **full e2e 41 passed / 1 pre-existing
    skip, run against the built container** (`E2E_BASE_URL=https://<mac-ip>:3500`).
- ☑ **e2e harness: run against the container, not a long-lived dev server.** Chasing a recurring
  `createEmployee` timeout showed the suite degrading 7.3m → 10.0m with growing phantom failures,
  including one inside `team.spec`'s own private copy of the helper. An 11-hour-old `next dev` was
  the cause: identical specs passed against the container in 24s, and the full suite there runs in
  **2.6 minutes** with everything green. `createEmployee` also gained the submit retry that `login`
  already had for the documented cold-dev hydration race.
- ☐ Tell the client: requests still pending when Batch 4 lands acquire the second signature
  requirement, so a manager may have to re-sign something they had already approved.

## Backlog (post-v1, see PLAN §6)
- ☐ Notifications (push/SMS/email) once a channel is chosen
- ☐ Attendance/check-in · shift scheduling · overtime · advance/loan · payslips · announcements ·
  documents · QC / finance / procurement modules
