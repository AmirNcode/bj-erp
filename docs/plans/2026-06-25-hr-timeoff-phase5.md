# HR / Time-Off — Phase 5 (Seed, Polish, Demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or
> superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) tracking.

**Goal:** A presentable demo — realistic seeded org data so the client logs in as each role and
sees meaningful screens, two small polish fixes, and a deploy runbook (no deploy executed).

**Architecture:** No schema/RLS/SQL changes. Seed reuses the existing guarded RPCs
(`app_create_employee`, `allocate_leave`) via an admin-authenticated Node script; config baseline in
a tracked idempotent `supabase/seed.sql`. Builds on Phases 0–4 on `feat/hr-timeoff-v1`.

**Tech Stack:** `@supabase/supabase-js` (seed script) · existing Next.js app · Playwright (e2e smoke).

## Global Constraints

- **No `service_role` secret** — seed signs in as `admin` / `Admin!2026` and calls the guarded RPCs.
- **Deterministic demo passwords** `Demo!2026`. **Idempotent** seed (skip/upsert if present).
- Demo Supabase `rimshsfkjpwlvjxbxhqm`, company `…c0`, depts `…d1`(Production Line A) `…d2`(Quality
  Control) `…d3`(Maintenance) `…d4`(Security), leave types Annual/Sick/Unpaid, weekend `{5}`.
- e2e green gate serial: `npm run test:e2e -- --workers=1`.
- **Out of scope:** actual deploy; FR-24 / FR-7 / FR-15 (Phase 6).

## Curated roster (codes demo-stable; password `Demo!2026`; names Iranian)

| code | name | dept | roles | manager |
|---|---|---|---|---|
| `m-prod` | Reza Karimi | Production Line A | manager, employee | — |
| `e-prod-1` | Ali Rezaei | Production Line A | employee | m-prod |
| `e-prod-2` | Hossein Ahmadi | Production Line A | employee | m-prod |
| `m-qc` | Maryam Hosseini | Quality Control | manager, employee | — |
| `e-qc-1` | Zahra Mohammadi | Quality Control | employee | m-qc |
| `e-qc-2` | Fatemeh Akbari | Quality Control | employee | m-qc |
| `m-maint` | Mehdi Sadeghi | Maintenance | manager, employee | — |
| `e-maint-1` | Hassan Jafari | Maintenance | employee | m-maint |
| `e-maint-2` | Saeed Bagheri | Maintenance | employee | m-maint |
| `s-sup` | Naser Ebrahimi | Security | security | — |
| `g-01` | Kazem Moradi | Security | security | s-sup |
| `g-02` | Javad Rostami | Security | security | s-sup |

Allocations (all 12): Annual 26 + Sick 10, period `2026-01-01`…`2026-12-31`.
Holidays (minimal, 2026 Gregorian, approximate + admin-editable): `2026-03-21`–`24` نوروز / Nowruz;
`2026-06-04` رحلت امام خمینی / Demise of Imam Khomeini; `2026-06-05` قیام ۱۵ خرداد / 15 Khordad.

---

### Task 5.1: Config baseline `supabase/seed.sql` (portability)

**Files:** Create `supabase/seed.sql`.

- [ ] **Step 1:** Write idempotent inserts (`on conflict do nothing`, fixed UUIDs matching the demo)
  for company `…c0` (BJ Manufacturing), the 4 departments, the 3 leave types, and `work_settings`
  (`weekend_days = {5}`). This is the **portable** baseline for a fresh self-hosted DB; it is a no-op
  against the already-seeded demo. (Employees/holidays are created by the script in 5.2, since users
  need the auth write-path.)
- [ ] **Step 2: Commit** `git commit -m "feat(seed): portable config baseline (company, depts, leave types, work settings)"`.

### Task 5.2: Seed script + run

**Files:** Create `scripts/seed-demo.mjs`. Modify `package.json` (add `"seed": "node scripts/seed-demo.mjs"`).

**Interfaces:** Node ESM; reads `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
`.env.local`; `signInWithPassword({ admin })`.

- [ ] **Step 1:** Write `scripts/seed-demo.mjs`:
  - `ensureUser(code, fullName, deptId, roles, managerId)` → query `profiles` by `employee_code`; if
    found return its `id`; else `rpc('app_create_employee', { p_company_id, p_employee_code: code,
    p_full_name, p_password: 'Demo!2026', p_department_id: deptId, p_roles: roles, p_manager_id })`
    and return the new id. (Managers created first so reports link `p_manager_id`.)
  - `ensureAllocation(empId, leaveTypeId, days)` → if no `leave_ledger` row exists for
    (employee, type), `rpc('allocate_leave', { p_employee_id, p_leave_type_id, p_period_start:
    '2026-01-01', p_period_end: '2026-12-31', p_days })`.
  - Insert holidays for `…c0` (skip dates already present).
  - Set each team dept's `manager_id` (`from('departments').update(...).eq('id', deptId)`).
  - Deactivate throwaways: `from('profiles').update({ active: false }).or('employee_code.like.lv%,
    employee_code.like.emp%,employee_code.like.mgr%,employee_code.like.set%,employee_code.like.auth%,
    employee_code.like.peer%,employee_code.like.non%')`. (Curated codes `m-…/e-…/s-…/g-…` + `admin`
    don't match.)
  - Log a summary; exit non-zero on any RPC error.
- [ ] **Step 2: Run** `node scripts/seed-demo.mjs` (against the demo). Expect: 12 users present, 24
  allocations, 6 holidays, dept managers set, throwaways deactivated. Re-run once → idempotent (no
  dupes, no errors).
- [ ] **Step 3: Verify** via Supabase MCP `execute_sql`: counts (active curated profiles = 13 incl.
  admin; security role present; holidays = 6; each curated employee has an Annual ledger row).
- [ ] **Step 4: Commit** `git commit -m "feat(seed): demo org (managers/employees/security), allocations, holidays + tidy test users"`.

### Task 5.3: Polish — balance-flash + `/team` split

**Files:** Modify `app/[locale]/(app)/request/LeaveRequestForm.tsx`; `app/[locale]/(app)/team/page.tsx` (note); messages if needed.

- [ ] **Step 1 (balance-flash):** Add a `balanceLoading` state set `true` before the `getMyBalance`
  call in the type-change effect and `false` on resolve. In the preview, while `balanceLoading` show a
  neutral hint (e.g. `…`) instead of the "موجودی نامشخص / unknown" copy; show "unknown" only when the
  fetch resolved with `null`. Don't change the server path.
- [ ] **Step 2 (/team note):** Add a one-line subtitle under the `/team` H1 clarifying it's the
  manager's direct-reports view (reuse `team.managerNote` or a new `team.subtitle` key, fa+en). No
  behavior change.
- [ ] **Step 3: Verify** `npm run build` + `npx eslint` changed files clean; existing leave e2e still
  green (`npm run test:e2e -- leave`).
- [ ] **Step 4: Commit** `git commit -m "fix(ui): balance-preview loading state; clarify /team view"`.

### Task 5.4: e2e smoke — seeded roles

**Files:** Create `tests/e2e/seed-roles.spec.ts`.

**Interfaces:** Consumes the seeded users (5.2 must have run). Reuse `_helpers.ts` `login`/`logout`.

- [ ] **Step 1:** Write the spec — three logins (`Demo!2026`):
  - `m-prod` → `nav-manage` visible; `home-approvals-card` visible; `/team` lists ≥1 report.
  - `e-prod-1` → `nav-manage` count 0; `home-board` visible.
  - `s-sup` → `nav-manage` count 0; `/calendar` `calendar-view` visible (security reads all).
- [ ] **Step 2: Run** `npm run test:e2e -- seed-roles` → PASS.
- [ ] **Step 3: Commit** `git commit -m "test(seed): e2e smoke — log in as each seeded role"`.

### Task 5.5: Deploy runbook + v1 release docs

**Files:** Create `docs/DEPLOY.md`. Modify `docs/REQUIREMENTS.md`, `docs/TASKS.md`, `docs/CHANGELOG.md`, `.superpowers/sdd/progress.md`, memory.

- [ ] **Step 1:** Write `docs/DEPLOY.md` — Vercel: `vercel login` → `vercel link` → set env
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) → `vercel deploy` (preview) / `--prod`;
  framework auto-detected (Next.js); demo points at the existing Supabase; self-host parity notes
  (NFR-4: same code, env-only change). Demo logins table (admin + curated roster, `Demo!2026`).
- [ ] **Step 2:** Flip `docs/REQUIREMENTS.md` **FR-8 ☑, FR-9 ☑** (seeded), and any seed-dependent
  status; FR-24/FR-7/FR-15 stay ☐ (Phase 6). `docs/TASKS.md`: tick Phase 5 (seed + holidays + smoke;
  deploy = runbook-only, note it); banner → "Phases 0–5: v1 feature-complete except FR-24/FR-7,
  demo-seeded, deploy = runbook". `docs/CHANGELOG.md`: **v1 demo** entry.
- [ ] **Step 3:** Append Phase 5 to `.superpowers/sdd/progress.md`; update memory `bj-hr-app-state.md`
  + `MEMORY.md` ("Phases 0–5; demo-seeded; deploy = runbook; FR-24/FR-7/FR-15 → Phase 6").
- [ ] **Step 4:** Final suite green: `npm run test:unit && npm run test:e2e -- --workers=1 && npm run build`.
- [ ] **Step 5: Commit** `git commit -m "docs: Phase 5 deploy runbook + v1 demo release notes"`.

---

## Self-Review

**Spec coverage:** §5 seed (org/alloc/holidays) → 5.1+5.2; demo passwords/cleanup → 5.2; balance-flash
+ /team polish → 5.3; "log in as each role, see realistic data" (done-when) → 5.4; deploy runbook +
release → 5.5. FR-8/9 seeded → 5.5 status flip. Deferred FR-24/FR-7/FR-15 → no tasks (correct).

**Placeholder scan:** No TBD. Holiday list is explicit (6 dated entries). Roster is explicit (12 rows).
The only "approximate" is the holiday dates — intentional + flagged (P5-3).

**Type/consistency:** RPC arg names (`p_company_id`, `p_employee_code`, `p_password`, `p_roles`,
`p_department_id`, `p_manager_id`; `allocate_leave` `p_employee_id`/`p_leave_type_id`/`p_period_*`/
`p_days`) match the generated `lib/supabase/types.ts`. Curated codes don't match the deactivation
`like` patterns. Seed reuses existing dept/leave-type UUIDs from §2.

**Risks:** (1) `app_create_employee` errors on duplicate code → `ensureUser` checks existence first.
(2) admin must be able to deactivate others' `active` → allowed by the profiles RLS + trigger (admin
= all columns). (3) seeded security users are the first `security`-role users — confirm the calendar
read-all path works for them (5.4 security login).
