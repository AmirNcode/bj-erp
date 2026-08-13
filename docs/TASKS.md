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
- ☑ `deploy/update.sh` — lock, preflight, verified backup, row-count assertions, migration
  replay, single-container cutover, health check, automatic rollback, retention.
  **Caveat (measured 2026-07-31): the migrations are NOT idempotent**, so the replay aborts on
  file #1 against a populated database — safely, but the upgrade does not happen. See below.
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

## Backlog (post-v1, see PLAN §6)
- ☐ Notifications (push/SMS/email) once a channel is chosen
- ☐ Attendance/check-in · shift scheduling · overtime · advance/loan · payslips · announcements ·
  documents · QC / finance / procurement modules
