# CHANGELOG

Format: [Keep a Changelog](https://keepachangelog.com/). This project will adopt semantic
versioning once the app is scaffolded. Until then, entries track documentation and design.

## [Unreleased]

### Added
- Project documentation scaffold: `CLAUDE.md` (agent onboarding) and `docs/` —
  `PLAN.md`, `REQUIREMENTS.md`, `DATA_MODEL.md`, `PERMISSIONS.md`, `TASKS.md`, this changelog.
- Approved v1 design spec: `docs/specs/2026-06-23-hr-timeoff-design.md` (HR / Time-Off).
- Phase 0–2 implementation plan (TDD, file-level): `docs/plans/2026-06-23-hr-timeoff-v1.md`.
- Recorded key decisions: fresh build on Next.js + Supabase reusing Frappe HR's leave data model;
  admin-issued username/password auth; Farsi-default RTL + English; full Supabase with self-host
  for production; direct-manager approval with admin override; statutory leave types + balance
  ledger; full/half-day (hourly reserved); configurable Friday weekend + seeded Iranian holidays.

### Implemented — Phase 0 (Scaffold)
- Next.js (App Router) + TypeScript + Tailwind; Vitest + Playwright harness.
- Farsi-default **RTL** via next-intl (fa/en); PWA manifest (installable, persistent session).
- Supabase project `bj-app` (eu-central-1); typed server/browser clients (`@supabase/ssr`, Next 16 async cookies).

### Implemented — Phase 1 (Identity & Org)
- Schema: `companies, departments, profiles, user_roles, audit_log` (+ enums); generated TS types.
- **RLS** on all tables; helper fns in a PostgREST-hidden `private` schema; security advisor: 0 accidental lints. Visibility matrix verified (employee→own team; manager/security→all; write-scoping correct).
- **Auth**: employee-code + password login (synthetic-email mapping), persistent session, route guard; next-intl + Supabase session refresh composed in `proxy.ts`.
- **Admin** employee CRUD: create (in-DB `SECURITY DEFINER` RPC — no service_role secret), update (role-aware column subset), roles/team/manager assignment, activate/deactivate, password reset; audit logged.
- **Manager**: "My Team" view + edit of direct reports (RLS-scoped, column-limited).
- Seed (interim): 1 company, 4 departments (3 teams + Security), 1 admin (`admin`).

### Implemented — Phase 2 (Leave core)
- Leave schema: `work_settings, holidays, leave_types, leave_allocations, leave_requests, leave_ledger` (+ enums). Transactional tables are **SELECT-only** for clients.
- Write-path via guarded `SECURITY DEFINER` functions (no client fabrication): `submit_leave_request` (computes working-days server-side + validates balance), `cancel_leave_request`, `allocate_leave`; `compute_requested_days` + `current_leave_balance` internal-only.
- Pure `countWorkingDays` (TS, weekend + holiday aware) for UI preview, mirrored by the SQL counter; parity confirmed (preview = server).
- **Request form** on `react-multi-date-picker` — Persian **or** Gregorian per `calendar_pref`, RTL; live working-day + remaining-balance preview; half-day gated by leave type. My-Requests list with cancel. Admin allocation UI.
- Seed (interim): work settings (Friday weekend) + 3 leave types (annual 26d, sick, unpaid).

### Implemented — Phase 3 (Flow & visibility)
- **Approval** via guarded `SECURITY DEFINER` fns (`approve_leave_request` / `reject_leave_request`): the direct manager — or admin (override) — approves/rejects a pending request; approval atomically writes a `consumption` ledger row (−requested_days) with a row-count guard against double-debit; both decisions audit-logged.
- **Approvals queue** UI (`/manage/approvals`, admin + manager), pending list narrowed to the viewer's reports by the pure `filterApprovable` (admin sees all).
- **FR-25 reason privacy**: `leave_requests` SELECT tightened to `own | is_manager_of | security | admin` (teammates can no longer read another's free-text `reason`); a reason-less `team_leave_calendar` `SECURITY DEFINER` view (scoped `own | same_team | can_read_all`, pending+approved) backs the calendar. Verified on the live DB (a same-team peer reads the view, not the base row).
- **Calendar** (`/calendar`, FR-22): viewer-scoped, agenda-style month view (type-colored, Jalali/Gregorian per pref), never showing `reason`.
- Migrations 0008 (approval fns) + 0009 (reason privacy + view) applied; types regenerated. Tests: unit 34/34, e2e 11/11 (added approval + calendar suites, serial/CI). FR-15 approved-future cancellation still deferred.

### Implemented — Phase 4 (Home board, Nav, Settings)
- **Role-driven bottom-tab nav** (FR-21): Home · Request · Calendar · Profile, + Manage for admin/manager (pure `tabsForRoles`); inline SVG icons, RTL, active-by-pathname, safe-area padding.
- **Home status board** (FR-20): role-aware cards — balances, recent requests, team time-off, and (managers/admins) a pending-approval card — composed by the pure `buildHomeBoard` view-model over existing reads (`getMyBalances` added).
- **Profile / Settings** (FR-23): calendar (jalali/gregorian) + language (fa/en) toggles persisted to `profiles` (`updateMyPrefs`); language switch via new `i18n/navigation.ts` (next-intl locale-aware `router.replace`); logout via `signOut`.
- **Responsive + device detection** (NFR-1, NFR-7): pure `parseDeviceType`/`isMobileWidth` + `useViewport` hook; e2e verifies no horizontal overflow at 375/1280 px and ≥44 px nav touch targets. `/team` re-surfaced from the Manage employees header.
- No schema / RLS / SQL changes. Tests: unit 54/54, e2e 14/14 (serial). Deferred to Phase 5: admin work-settings/holiday UI (FR-24), self-service password change (FR-7 tail), balance-preview race polish.

### Next
- Phase 5 — seed (3 teams + Security, Iranian names, holidays) + demo deploy.
