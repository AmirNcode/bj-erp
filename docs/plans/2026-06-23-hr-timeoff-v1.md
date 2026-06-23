# HR / Time-Off v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployable, mobile+desktop PWA where an admin manages employees/teams/roles and employees file balance-aware, calendar-based time-off requests that their manager approves — all enforced by Postgres RLS.

**Architecture:** Next.js App Router (TS) frontend on Vercel; Supabase (Postgres + Auth + RLS) backend. Dates stored Gregorian; Persian/Gregorian is a render-time concern. Access control lives in RLS; UI mirrors it. Server-side functions own day-counting and balance ledger so clients cannot fabricate numbers.

**Tech Stack:** Next.js (App Router) + TypeScript + Tailwind · Supabase JS + Supabase CLI (migrations) · Vitest (unit) · Playwright (e2e) · `react-multi-date-picker` (Persian+Gregorian) · `next-intl` (fa/en, RTL).

## Global Constraints

Copied from the spec; every task inherits these.

- **Locale:** Farsi (`fa`) default, **RTL**; English (`en`) toggle, LTR. Per-user preference.
- **Auth:** admin-issued **username (employee_code) + password**. **No email required.** Persistent/PWA session.
- **Dates:** stored Gregorian (`date`/`timestamptz`). **Never persist Jalali.** Jalali = display only.
- **Access control:** **RLS is the source of truth** on every employee-data table.
- **Roles:** `admin | manager | employee | security` in `user_roles`; checked via `has_role()`. Multiple roles per user allowed.
- **Granularity:** full + half day in v1. `allow_hourly` flag reserved; do not build hourly UI/math.
- **Weekend:** default `{5}` (Friday, ISO weekday); configurable. Holidays seeded + admin-editable.
- **Portability:** no proprietary cloud lock-in in data/auth — production self-hosts Supabase + Next.js with config-only change.
- **Verify external APIs via Context7 before use** (Supabase auth options, `react-multi-date-picker`, `next-intl`). Do not trust memory for signatures.

---

## File Structure (locked decisions)

```
app/
  layout.tsx                     # html dir/lang from locale; providers
  [locale]/                      # next-intl locale segment (fa default)
    (auth)/login/page.tsx        # employee_code + password form
    (app)/
      layout.tsx                 # bottom-tab shell (role-driven), session guard
      home/page.tsx              # status board (Phase 4)
      request/page.tsx           # new request (Phase 2 UI)
      calendar/page.tsx          # visibility-scoped calendar (Phase 3)
      profile/page.tsx           # settings: calendar/lang (Phase 4)
      manage/                    # admin+manager (Phase 1/3)
lib/
  supabase/{server,client}.ts    # typed Supabase clients
  auth/usernameEmail.ts          # employee_code <-> synthetic auth email mapping
  leave/workingDays.ts           # PURE day-counting (Phase 2, TDD core)
  leave/balance.ts               # ledger/balance helpers
  i18n/                          # next-intl config + messages fa.json / en.json
supabase/
  migrations/*.sql               # schema, enums, RLS, functions
  seed.sql                       # Phase 5
messages/{fa,en}.json
tests/
  unit/*.test.ts                 # Vitest
  e2e/*.spec.ts                  # Playwright
vitest.config.ts  playwright.config.ts  next.config.ts  manifest.webmanifest
```

Files that change together live together; `lib/leave/` is pure logic isolated from UI for testability.

---

# PHASE 0 — Scaffold

Deliverable: app boots in fa-RTL, deploys to Vercel, connects to Supabase, lint+test+e2e harness green.

### Task 0.1: Initialize Next.js + TypeScript + Tailwind

**Files:** Create: project root (`package.json`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `next.config.ts`, Tailwind config).

**Interfaces:** Produces: a running Next.js app on `:3000`.

- [ ] **Step 1: Scaffold non-interactively**

```bash
npx create-next-app@latest . --ts --app --tailwind --eslint --src-dir=false --import-alias "@/*" --use-npm --yes
```

- [ ] **Step 2: Run dev server, verify boot**

Run: `npm run dev` → open `http://localhost:3000`. Expected: default page renders, no console errors. Stop server.

- [ ] **Step 3: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold Next.js + TS + Tailwind"
```

### Task 0.2: Testing harness (Vitest + Playwright)

**Files:** Create: `vitest.config.ts`, `tests/unit/smoke.test.ts`, `playwright.config.ts`, `tests/e2e/home.spec.ts`. Modify: `package.json` scripts.

**Interfaces:** Produces: `npm run test:unit`, `npm run test:e2e`.

- [ ] **Step 1: Install**

```bash
npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @playwright/test
npx playwright install --with-deps chromium
```

- [ ] **Step 2: Write a failing unit smoke test**

```ts
// tests/unit/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { add } from '@/lib/_smoke';
describe('smoke', () => { it('adds', () => expect(add(2,3)).toBe(5)); });
```

- [ ] **Step 3: Run, verify fail**

Run: `npm run test:unit` → Expected: FAIL, `Cannot find module '@/lib/_smoke'`.

- [ ] **Step 4: Minimal impl + config**

```ts
// lib/_smoke.ts
export const add = (a: number, b: number) => a + b;
```
Add `vitest.config.ts` (jsdom env, `@` alias) and `package.json` scripts: `"test:unit":"vitest run"`, `"test:e2e":"playwright test"`.

- [ ] **Step 5: Run, verify pass**

Run: `npm run test:unit` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test: add vitest + playwright harness"
```

### Task 0.3: Supabase project + typed clients + env

**Files:** Create: `lib/supabase/server.ts`, `lib/supabase/client.ts`, `.env.local`, `.env.example`. 

**Interfaces:** Produces: `createServerClient()`, `createBrowserClient()`.

- [ ] **Step 1: Init Supabase locally**

```bash
npm i @supabase/supabase-js @supabase/ssr
npx supabase init
```
Create a cloud project via the Supabase dashboard (demo). Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`; mirror keys (no values) in `.env.example`. **Verify current `@supabase/ssr` cookie API via Context7** before writing clients.

- [ ] **Step 2: Write clients** (server uses cookies for session; browser for client components). Implement per the Context7-confirmed `@supabase/ssr` pattern.

- [ ] **Step 3: Verify connection** — a temporary server action calling `supabase.auth.getSession()` returns without error.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: supabase clients + env scaffolding"
```

### Task 0.4: i18n + RTL shell (next-intl, fa default)

**Files:** Create: `lib/i18n/*`, `messages/fa.json`, `messages/en.json`, `app/[locale]/layout.tsx`. Modify: `app/layout.tsx`, `next.config.ts`.

**Interfaces:** Produces: `<html dir>` driven by locale; `useTranslations()` available.

- [ ] **Step 1:** Install + configure. **Confirm next-intl App-Router setup via Context7.**

```bash
npm i next-intl
```

- [ ] **Step 2:** `fa` is default locale; root layout sets `dir={locale==='fa'?'rtl':'ltr'}` and `lang={locale}`. Seed `messages/fa.json`/`en.json` with `{ "app": { "title": "سامانه منابع انسانی" } }` / `{ "app": { "title": "HR System" } }`.

- [ ] **Step 3: e2e test fa-RTL**

```ts
// tests/e2e/home.spec.ts
import { test, expect } from '@playwright/test';
test('default locale is fa and RTL', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
});
```

- [ ] **Step 4: Run, verify pass** — `npm run test:e2e`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: i18n + RTL shell (fa default)"`.

### Task 0.5: PWA (installable, persistent session)

**Files:** Create: `app/manifest.ts` (or `manifest.webmanifest`), `public/icons/*`, service worker registration.

- [ ] **Step 1:** Add web app manifest (name fa/en, icons, `display: standalone`, `dir`, `lang`). Use Next.js `app/manifest.ts`.
- [ ] **Step 2:** Ensure Supabase session persists (the `@supabase/ssr` cookie clients already persist; confirm refresh keeps session).
- [ ] **Step 3: e2e:** manifest served at `/manifest.webmanifest` with 200. 
- [ ] **Step 4: Commit** — `git commit -m "feat: PWA manifest + persistent session"`.

### Task 0.6: First Vercel deploy

- [ ] **Step 1:** `npm i -g vercel` (recommend to user) → `vercel link` → set env vars (`vercel env add`).
- [ ] **Step 2:** `vercel deploy` (preview). Verify the deployed URL renders fa-RTL.
- [ ] **Step 3: Commit** any config. Tag Phase 0 done in `docs/TASKS.md` + CHANGELOG.

---

# PHASE 1 — Identity & Org

Deliverable: admin logs in, creates an employee (code+password) who can log in; roles/teams/manager assigned; RLS enforced; managers edit their reports.

### Task 1.1: Core schema migration (enums + tables)

**Files:** Create: `supabase/migrations/0001_core.sql`.

**Interfaces:** Produces tables `companies, departments, profiles, user_roles, audit_log` and enums per `docs/DATA_MODEL.md`.

- [ ] **Step 1: Write migration** — enums (`app_role`, `department_kind`) + tables with columns exactly as `docs/DATA_MODEL.md` specifies (`profiles.id uuid references auth.users`, `employee_code text unique not null`, self-FK `manager_id`, prefs defaults `fa`/`jalali`). Include `updated_at` triggers.

```sql
create type app_role as enum ('admin','manager','employee','security');
create type department_kind as enum ('team','security','office');
-- companies, departments, profiles, user_roles, audit_log ... (see DATA_MODEL.md)
```

- [ ] **Step 2: Apply** — `npx supabase db push` (or `supabase migration up` locally). Expected: success.
- [ ] **Step 3: Generate types** — `npx supabase gen types typescript --linked > lib/supabase/types.ts`.
- [ ] **Step 4: Commit** — `git commit -m "feat(db): core identity/org schema"`.

### Task 1.2: RLS helper functions

**Files:** Create: `supabase/migrations/0002_rls_helpers.sql`.

**Interfaces:** Produces SQL: `has_role(uuid,app_role) bool`, `is_admin(uuid)`, `is_manager_of(uuid,uuid)`, `same_team(uuid,uuid)`, `can_read_all(uuid)` — all `SECURITY DEFINER`, `STABLE`.

- [ ] **Step 1: Write functions** exactly per `docs/PERMISSIONS.md` §SQL helpers. `SECURITY DEFINER` to avoid recursive RLS.
- [ ] **Step 2: Apply** — `supabase db push`.
- [ ] **Step 3: Commit** — `git commit -m "feat(db): RLS helper functions"`.

### Task 1.3: RLS policies for profiles/user_roles/audit_log

**Files:** Create: `supabase/migrations/0003_rls_core.sql`. Test: `tests/unit/rls_core.test.ts` (integration vs local Supabase using two seeded JWTs).

**Interfaces:** Consumes 1.2 helpers. Produces enforced policies per `docs/PERMISSIONS.md`.

- [ ] **Step 1: Write failing integration test** — seed an admin + two employees in different teams; assert: employee A `select` on profiles returns own+same-team only; admin returns all; only admin can `insert`.
- [ ] **Step 2: Run, verify fail** (no policies yet → either all-open or all-denied). Expected: FAIL.
- [ ] **Step 3: Write policies** — `enable row level security` + SELECT/UPDATE/INSERT policies using helpers (self · same_team · can_read_all for read; is_admin/is_manager_of/self for write).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(db): RLS policies for core tables"`.

### Task 1.4: Username→email auth mapping + login

**Files:** Create: `lib/auth/usernameEmail.ts`, `app/[locale]/(auth)/login/page.tsx`, login server action. Test: `tests/unit/usernameEmail.test.ts`.

**Interfaces:** Produces: `codeToAuthEmail(code: string): string` (e.g. `\`${code.toLowerCase()}@hr.internal\``), `signInWithCode(code, password)`.

Rationale: Supabase Auth keys on email/phone. We assign each user a **synthetic internal email** derived from `employee_code` so labourers log in with code+password and never see an email. **Confirm current Supabase auth options via Context7** (in case username/SMS support changed).

- [ ] **Step 1: Failing test** for `codeToAuthEmail('A-100') === 'a-100@hr.internal'`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** mapping + `signInWithCode` (calls `supabase.auth.signInWithPassword({ email: codeToAuthEmail(code), password })`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Build login page** — code + password fields (fa labels), error states, redirect to `/home` on success; session guard in `(app)/layout.tsx`.
- [ ] **Step 6: e2e** — seeded user logs in, lands on home; refresh keeps session.
- [ ] **Step 7: Commit** — `git commit -m "feat(auth): code+password login via synthetic email"`.

### Task 1.5: Admin console — employee CRUD + role/team/manager assignment

**Files:** Create: `app/[locale]/(app)/manage/employees/*`, server actions `lib/actions/employees.ts`. Test: `tests/unit/employees_action.test.ts`, `tests/e2e/admin_crud.spec.ts`.

**Interfaces:** Consumes RLS + auth. Produces server actions: `createEmployee(input)` (creates auth user with synthetic email + temp password, inserts profile, assigns roles), `updateEmployee`, `setRoles`, `setTeam`, `setManager`, `deactivateEmployee` — each writes `audit_log`.

- [ ] **Step 1: Failing test** — `createEmployee` inserts a profile + a `user_roles` row + an `audit_log` row (run as admin JWT).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** actions (admin-guarded by RLS; server action also checks `is_admin`). Creating an employee returns the temp password for the admin to hand over.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Build UI** — list + create/edit forms (fa), role/team/manager selectors.
- [ ] **Step 6: e2e** — admin creates employee → new employee logs in.
- [ ] **Step 7: Commit** — `git commit -m "feat(admin): employee CRUD + role/team/manager"`.

### Task 1.6: Manager edits direct reports

**Files:** Modify: `lib/actions/employees.ts`, manage UI. Test: extend `tests/unit/employees_action.test.ts`.

- [ ] **Step 1: Failing test** — manager `updateEmployee` succeeds for a direct report, denied (RLS) for a non-report.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — UPDATE policy already allows `is_manager_of`; expose the managed subset of fields in UI for managers.
- [ ] **Step 4: Run, verify pass; Commit** — `git commit -m "feat(manager): edit direct reports"`.

---

# PHASE 2 — Leave Core

Deliverable: leave types + allocations + ledger exist; a request computes correct working-days and remaining balance server-side; employee can submit via the Persian/Gregorian picker.

### Task 2.1: Leave schema migration

**Files:** Create: `supabase/migrations/0004_leave.sql`.

**Interfaces:** Produces `work_settings, holidays, leave_types, leave_allocations, leave_requests, leave_ledger` + enums (`leave_status, day_part, ledger_entry`) per `docs/DATA_MODEL.md`.

- [ ] **Step 1:** Write migration (exact columns from DATA_MODEL; `requested_days numeric`, `allow_hourly bool default false`). - [ ] **Step 2:** Apply + regen types. - [ ] **Step 3:** Commit `feat(db): leave schema`.

### Task 2.2: Pure working-day counter (TDD core)

**Files:** Create: `lib/leave/workingDays.ts`. Test: `tests/unit/workingDays.test.ts`.

**Interfaces:** Produces: `countWorkingDays(start: string, end: string, opts: { weekendDays: number[]; holidays: string[]; dayPart: 'full'|'am'|'pm' }): number`. Pure, Gregorian-only (no Jalali needed server-side).

- [ ] **Step 1: Write failing tests** (table of cases):

```ts
import { describe, it, expect } from 'vitest';
import { countWorkingDays as c } from '@/lib/leave/workingDays';
const W = { weekendDays: [5], holidays: [] as string[] }; // Friday weekend
describe('countWorkingDays', () => {
  it('single working day = 1', () => expect(c('2026-06-23','2026-06-23',{...W,dayPart:'full'})).toBe(1));
  it('half day = 0.5', () => expect(c('2026-06-23','2026-06-23',{...W,dayPart:'am'})).toBe(0.5));
  it('skips Friday', () => expect(c('2026-06-25','2026-06-27',{...W,dayPart:'full'})).toBe(2)); // Thu,Sat count; Fri 26th skipped
  it('skips holidays', () => expect(c('2026-06-23','2026-06-24',{weekendDays:[5],holidays:['2026-06-24'],dayPart:'full'})).toBe(1));
  it('half day on weekend = 0', () => expect(c('2026-06-26','2026-06-26',{...W,dayPart:'am'})).toBe(0));
});
```

- [ ] **Step 2: Run, verify fail** — `npm run test:unit` → FAIL (module missing).
- [ ] **Step 3: Implement** — iterate dates [start,end]; a day counts if `isoWeekday ∉ weekendDays` and `dateStr ∉ holidays`; half-day returns 0.5 only when `start===end` and that day is a working day, else 0 for non-working.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(leave): working-day counter"`.

### Task 2.3: Mirror counter as a Postgres function + balance helpers

**Files:** Create: `supabase/migrations/0005_leave_fns.sql`, `lib/leave/balance.ts`. Test: `tests/unit/balance.test.ts`.

**Interfaces:** Produces SQL `compute_requested_days(start,end,day_part) returns numeric` (reads `work_settings.weekend_days` + `holidays`), and `lib/leave/balance.ts` `currentBalance(employeeId, leaveTypeId)` (latest `balance_after`).

- [ ] **Step 1:** Failing test for `currentBalance` returns latest ledger `balance_after`, 0 when none.
- [ ] **Step 2:** Verify fail. - [ ] **Step 3:** Implement SQL fn (server-trusted counting) + balance helper. - [ ] **Step 4:** Verify pass. - [ ] **Step 5:** Commit `feat(leave): server day-count fn + balance`.

### Task 2.4: Allocation → ledger

**Files:** Create: `lib/actions/leave.ts` (`allocateLeave`). Test: `tests/unit/allocate.test.ts`.

**Interfaces:** Produces: `allocateLeave({employeeId, leaveTypeId, periodStart, periodEnd, days})` → inserts `leave_allocations` + `leave_ledger` `allocation` row with `balance_after = prevBalance + days`. Admin-only (RLS).

- [ ] Failing test (allocation creates ledger row, balance increases) → verify fail → implement → verify pass → commit `feat(leave): allocation writes ledger`.

### Task 2.5: Submit request (server action + RLS + form)

**Files:** Modify: `lib/actions/leave.ts` (`submitRequest`); `app/[locale]/(app)/request/page.tsx`; `supabase/migrations/0006_rls_leave.sql`. Test: `tests/unit/submitRequest.test.ts`, `tests/e2e/request.spec.ts`.

**Interfaces:** Consumes 2.2–2.4. Produces: `submitRequest({leaveTypeId,startDate,endDate,dayPart,reason})` → server computes `requested_days` via SQL fn, validates remaining balance for balance-affecting types, inserts `leave_requests` (`status='pending'`, own `employee_id`). RLS: INSERT self-only; SELECT own·same_team·can_read_all.

- [ ] **Step 1:** Failing unit test — submitting a 2-day request stores `requested_days=2` (server-computed, ignores any client value) and `status='pending'`.
- [ ] **Step 2:** Verify fail.
- [ ] **Step 3:** Implement server action (recompute days server-side; reject if `affects_balance` and days > remaining) + RLS migration (0006) per PERMISSIONS.
- [ ] **Step 4:** Verify pass.
- [ ] **Step 5: Build request form** — `react-multi-date-picker` with `calendar`/`locale` switched by the user's `calendar_pref` (`persian`+`persian_fa` or `gregorian`+`gregorian_en`). **Confirm picker props + DateObject→ISO conversion via Context7.** Show computed days + remaining balance before submit.
- [ ] **Step 6: e2e** — employee picks dates on the Persian calendar, sees days+balance, submits; request appears as pending.
- [ ] **Step 7: Commit** — `git commit -m "feat(leave): submit request (server-validated) + picker"`.

---

# PHASES 3–5 — Outline (separate plan files)

These get their own `docs/plans/` files, written when reached so their UI builds on the picker/i18n APIs confirmed in Phase 0–2. Each remains TDD + frequent commits.

**Phase 3 — Flow & visibility**
- `approveRequest`/`rejectRequest` (manager via `is_manager_of`; admin override) → on approve, write `consumption` ledger of `-requested_days`, set `balance_after`. TDD: approval debits balance; non-manager denied.
- `cancelRequest` (employee, own pending). 
- RLS finalization for the full visibility matrix; calendar page scoped by viewer (employee=team, manager/security/admin=all). e2e per role.

**Phase 4 — Home board & polish**
- Home status board per role (employee: my requests+balances+team; manager: approval queue+reports). 
- Role-driven bottom-tab nav (Home·Request·Calendar·Profile [+Manage]). 
- Settings: calendar (jalali/gregorian) + language (fa/en) toggles persisted to `profiles`. 
- Responsive/device-detection + a11y/touch-target pass.

**Phase 5 — Seed & demo**
- `supabase/seed.sql`: 1 company, 3 teams + Security dept, Iranian names/roles, admin/managers/employees/security; leave types + annual allocations; seed Iranian 1404–1405 holidays (best-available data; admin-editable per user note). 
- Deploy demo; smoke-test each role end-to-end; flip REQUIREMENTS statuses; CHANGELOG release entry.

---

## Self-Review

**Spec coverage:** FR-1–7 (identity/org/auth) → Phase 1 T1.1–1.6. FR-8–15 (leave types/alloc/ledger/request/half-day/validation) → Phase 2 T2.1–2.5 (cancel→P3). FR-14 approval → P3. FR-16–19 visibility → T1.3 + P3. FR-20 home board → P4. FR-21 nav → P4. FR-22 calendar → P3. FR-23 settings → P4. FR-24 work/holiday settings → T2.1/2.3 + P5 seed. NFR-1 responsive/detect → P4. NFR-2 PWA → T0.5. NFR-3 RTL → T0.4. NFR-4 portability → constraints + T0.3. NFR-5 RLS/audit → T1.2/1.3/1.5. NFR-6 perf/index → DATA_MODEL indexes (apply in migrations). NFR-7 a11y → P4. NFR-8 docs → ongoing. **No uncovered FR/NFR** (hourly explicitly out of scope).

**Placeholder scan:** No "TBD/handle edge cases" steps. External-API steps cite a concrete action ("confirm via Context7" + the exact props/pattern to wire), not a vague defer.

**Type consistency:** `countWorkingDays`/`compute_requested_days` signatures match across 2.2/2.3/2.5; `codeToAuthEmail`/`signInWithCode` consistent in 1.4; `currentBalance` consistent 2.3/2.4; `requested_days` numeric everywhere.

> Note: Phases 3–5 are outlined, not yet task-detailed — they are deliberately deferred to follow-on plan files (their UI depends on Phase-0/2 Context7-confirmed component APIs). This plan (Phases 0–2) stands alone as working, testable software.
