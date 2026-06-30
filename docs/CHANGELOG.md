# CHANGELOG

Format: [Keep a Changelog](https://keepachangelog.com/). The app is built; v1 (Phases 0–6 +
frontend overhaul) is feature-complete and merged to `main`. `[Unreleased]` holds the v1 work
pending a tagged release; semantic versioning starts at the first tag.

## [Unreleased]

### Added — Navigation prefetch + manual page update pill (2026-06-30)
- **Performance/UX:** the app shell now prefetches every role-visible bottom/side-tab route after
  login so tab changes can reuse the client route cache instead of showing empty panels while each
  page fetches from scratch.
- **Manual freshness:** every app page header now includes a pill-shaped update button above the
  page title. It shows the last loaded time, invalidates the current route, and refreshes the page
  payload when tapped.

### Added — Home My Team + mobile calendar/manage polish (2026-06-30)
- **Home:** replaced the Team Time-Off card with **My Team**, showing the caller's manager,
  same-department teammates, role labels, team/title context, and each member's upcoming time off.
  Added the scoped `get_my_team_directory()` security-definer function so employees can see
  teammate role labels without broad `user_roles` access.
- **Calendar:** month view now uses explicit seven-column tracks on mobile and keeps multi-day leave
  names visible on every covered date.
- **Manage Employees:** mobile header actions now stack below the page title instead of squeezing
  beside it.

### Added — Calendar month view + locale polish (2026-06-30)
- **Calendar** now has a List/Month toggle. Month view highlights each in-month day with visible
  time-off, shows a localized per-day count badge, previews the first names with `...` overflow, and
  opens a selected-day detail panel showing who is off and the next configured working return date.
- **Request page localization:** leave-type selects, date picker locale/digits, working-day previews,
  balance previews, request-row dates, and request-row day counts now follow the user's language
  preference (English or Persian). User names remain unchanged.

### Added — UI polish + allocation at create/edit (2026-06-30)
- **Admin employee forms:** create employee now accepts initial PTO/annual and sick balances, and
  edit employee now sets current leave balances through the audited `set_leave_balance` RPC
  (`20260630120001_set_leave_balance.sql`).
- **Brand polish:** app/login logo, light-only color-scheme lock, Rubik primary font with Vazirmatn
  fallback for Persian glyphs, opaque mobile/desktop chrome, clearer active nav state, and more
  prominent primary buttons.

### Changed — Frontend Overhaul (UI/UX redesign)
- **Design system:** brand OKLCH tokens derived from the Behsazan Jonoob logo (primary `#2E3C92`),
  mapped via Tailwind v4 `@theme`; self-hosted **Rubik** font with **Vazirmatn** fallback for
  Persian glyphs; **shadcn/ui** primitives (new-york) with RTL migration. Light-only v1.
- **Responsive shell:** new `AppShell` — sticky app bar + a nav that is a bottom tab bar on mobile
  and a left side-rail on desktop (replacing the stretched-phone bottom bar); `Toaster` mounted once.
- **All 11 screens reskinned** onto Card/Input/Button/Select/Badge/Dialog primitives plus
  `StatusBadge`/`PageHeader`/`EmptyState`: login, home, request, my-requests, calendar, approvals,
  manage employees/allocations/settings, profile, team. Behavior and every `data-testid` preserved;
  FR-25 reason-privacy verified intact.
- **UX / perf:** lazy-loaded date picker (off the initial bundle); `router.refresh()` + `revalidatePath`
  instead of a full-page reload on submit; native `confirm()` → styled `AlertDialog` throughout;
  `toast` result feedback; `Suspense` + skeletons on data pages; consistent focus rings; PWA
  `theme-color` set to the brand.
- **Tooling:** e2e leave dates computed dynamically (no longer rot over time). All gates green —
  lint clean, unit 73/73, e2e 20/20 (serial), build clean. Branch `feat/frontend-overhaul`.

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

### Implemented — Phase 5 (Seed & demo) — v1 demo release
- **Demo seed** (`scripts/seed-demo.mjs`, `npm run seed`): BJ Manufacturing with 3 teams (Production Line A, Quality Control, Maintenance) + Security; 12 curated users (3 managers, 6 employees, 3 security) with Iranian names, annual + sick allocations, and minimal 2026 holidays. Idempotent; created via the guarded `app_create_employee` / `allocate_leave` RPCs (no `service_role`). Non-curated e2e-throwaway profiles deactivated → 13 active (admin + roster). Password `Demo!2026`.
- **Portable config baseline** `supabase/seed.sql` (company / departments / leave types / work settings).
- **Polish:** the request form shows a balance loading state instead of flashing "unknown"; `/team` clarified as the manager's direct-reports view.
- **Deploy runbook** `docs/DEPLOY.md` (Vercel + self-host parity); the demo deploy is the operator's to run.
- e2e smoke (`seed-roles.spec`) logs in as manager / employee / security. Suite: unit 54/54, e2e 17/17 (serial).
- **v1 is feature-complete** except FR-24 (admin work/holiday editor) and FR-7 (self-service password change), deferred to **Phase 6** with FR-15 (cancel approved leave) and the official Iranian holiday list.

### Implemented — Phase 6 (Settings, password, cancel-approved)
- **FR-15**: `cancel_leave_request` now also cancels an **approved** request whose `start_date` is in
  the future, writing a `reversal` ledger row (+requested_days) for balance-affecting types (atomic,
  row-count guarded). My Requests shows Cancel on eligible approved rows (pure `isCancellable`).
- **FR-7**: self-service password change — guarded `app_change_my_password` verifies the current
  password in-DB (`crypt`; no `service_role`); a Change-Password form on Profile/Settings.
- **FR-24**: admin work-settings (weekend days) + holiday add/edit/delete editor at
  `/manage/settings`, writing directly via the pre-existing admin RLS policies on
  `work_settings`/`holidays` (no new RPC/migration). Linked from Manage for admins only.
- Migrations `20260626120001` (cancel reversal) + `20260626120002` (password fn); types regenerated.
  No table/enum/RLS-policy changes. Tests: unit 65/65 (+11), e2e 20/20 (+3, serial).

### Next
- Official Iranian 1404–1405 holiday dataset (entered via the FR-24 editor) · demo deploy
  (`docs/DEPLOY.md`) · then PLAN §6 modules (attendance, shifts, …).
