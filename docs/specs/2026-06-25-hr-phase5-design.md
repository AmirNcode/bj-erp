# Design Spec — HR / Time-Off Phase 5 (Seed, Polish, Demo)

- **Date**: 2026-06-25
- **Status**: Approved (design). Implementation plan pending.
- **Module / phase**: HR → Time-Off, **Phase 5** (final v1 phase). Builds on Phases 0–4 on
  `feat/hr-timeoff-v1`.

Frozen point-in-time record. Living detail: `docs/PLAN.md` §5, `docs/REQUIREMENTS.md`,
`docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`.

---

## 1. Context & problem

Phases 0–4 shipped the full app. Phase 5 makes the **demo presentable**: realistic seeded org data
so the client can log in as each role and see meaningful screens, two small polish fixes, and a
**deploy runbook** (the actual Vercel deploy is the user's to run). Per the user's scope choice,
this is **seed + small polish** — the remaining v1 FRs (FR-24 admin work/holiday editor, FR-7
self-service password change, FR-15 cancel-approved-leave) are **deferred to Phase 6**.

## 2. Current demo state (verified 2026-06-25)

Demo Supabase `rimshsfkjpwlvjxbxhqm` already holds: company **BJ Manufacturing** (`…c0`); 4
departments — **Production Line A** (`…d1`), **Quality Control** (`…d2`), **Maintenance** (`…d3`),
**Security** (`…d4`, kind=security); 3 leave types — Annual (balance, half-day), Sick (balance),
Unpaid (no balance); `work_settings.weekend_days = {5}`; **0 holidays**; admin `admin` (`…a1`).
**103 profiles** exist — ~100 are throwaway users from e2e runs (codes like `lv…/emp…/mgr…/set…/
auth…/peer…/non…`). Roles present: admin, manager, employee (**no security user yet**).

## 3. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| P5-1 | Seed user creation | Sign in as **admin** + call the existing `app_create_employee` / `allocate_leave` RPCs from a script | Reuses the tested, guarded write-path; no `service_role` secret (NFR-4 portability). |
| P5-2 | Demo passwords | **Deterministic** (`Demo!2026` for all seeded users) | The client (and e2e smoke) must actually log in as each role. |
| P5-3 | Holidays | **Minimal placeholders** — a few 2026 Gregorian dates, flagged approximate, admin-editable | User choice; enough to demonstrate weekend/holiday-aware day counting. Real list later (Phase 6 admin UI). |
| P5-4 | e2e-throwaway profiles | **Deactivate** (`active = false`, non-destructive) those matching test code patterns | A clean demo employee list; reversible (no hard deletes); doesn't touch admin or curated seed. |
| P5-5 | Deploy | **Runbook only** (`docs/DEPLOY.md`); no deploy executed | Vercel CLI absent + auth is the user's; demo Supabase already live. |
| P5-6 | `/team` vs Manage | **Keep** `/team` as the manager "My Team" view; Manage→employees is the admin-wide list | Document the split as intentional; not redundant. |
| P5-7 | Org shape | Reuse company + 4 existing depts; add 1 manager + 2 employees per team + 1 security supervisor + 2 guards | Realistic, small, covers every role (incl. **security**, currently missing). |

**Deferred to Phase 6:** FR-24 (admin work-settings/holiday editor UI), FR-7 (self-service password
change), FR-15 (cancel an approved future leave).

## 4. Scope

Seed (FR-8/9 data, §5 "Seed & demo") · 2 polish fixes · deploy runbook · v1 release docs. **No new
tables / enums / RLS / SQL functions.** No actual deploy.

## 5. Architecture & components

- **Seed script** — `scripts/seed-demo.mjs` (Node + `@supabase/supabase-js`, run with `node`). Reads
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from env; signs in as `admin` /
  `Admin!2026`. Steps, each **idempotent** (skip/upsert if present):
  1. Ensure holidays (insert a few 2026 dates for company `…c0` if absent).
  2. For each curated user (stable `employee_code` not matching test patterns): if the code doesn't
     already exist, `rpc('app_create_employee', { …, p_password: 'Demo!2026', p_roles, p_department_id,
     p_manager_id })`; managers created first so reports can link `p_manager_id`.
  3. Allocate annual (26) + sick (10) per employee via `rpc('allocate_leave', …)` for the current
     period (skip if a ledger row already exists for that type).
  4. Set each team department's `manager_id` to its manager (admin-allowed update).
  5. **Deactivate** throwaway profiles: `update profiles set active=false where employee_code ~
     '^(lv|emp|mgr|set|auth|peer|non)[0-9]'` — leaves `admin` + curated seed active.
  The same config-table baseline (company, departments, leave types, work_settings) is captured in a
  tracked **`supabase/seed.sql`** (idempotent `on conflict do nothing`) for fresh self-hosted setups.
- **Curated org** (codes are demo-stable, e.g. `m-prod`, `e-prod-1`, `s-sup`, `g-01`):
  Production Line A — 1 manager + 2 employees; Quality Control — 1 manager + 2 employees;
  Maintenance — 1 manager + 2 employees; Security — 1 supervisor (security) + 2 guards (security).
  Iranian names (e.g. Reza Karimi, Maryam Hosseini, Ali Rezaei, …). Managers hold `manager`+`employee`;
  guards hold `security`.
- **Polish — balance flash** (`request/LeaveRequestForm.tsx`): a `balanceLoading` state; render a
  loading hint (not the "موجودی نامشخص / unknown" string) until `getMyBalance` resolves. The "unknown"
  copy shows only when the fetch genuinely returns no ledger.
- **Polish — `/team` split**: add a one-line note/header so `/team` reads as the manager's team view;
  no behavior change (it is already linked from Manage in Phase 4). Confirm the Phase-4 link wording.
- **Deploy runbook** — `docs/DEPLOY.md`: Vercel project link, env vars (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`), framework/build settings, `vercel login` → `vercel link` →
  `vercel env add` → `vercel deploy`, demo-Supabase pointer, and self-host parity notes (NFR-4).

## 6. Key user flows (post-seed)

1. Client logs in as a **manager** (`m-prod` / `Demo!2026`) → home board shows their team + a pending
   approvals card; `/team` lists their reports; calendar shows company-wide.
2. Logs in as an **employee** (`e-prod-1`) → balances + own requests; calendar shows their team only.
3. Logs in as **security** (`s-sup`) → calendar shows everyone (read-only); no Manage tab.

## 7. Testing

- **e2e smoke** (`tests/e2e/seed-roles.spec.ts`): assuming the seed has run, log in as the curated
  manager / employee / security users and assert role-appropriate surfaces (manager: Manage tab +
  approvals card; employee: no Manage tab, home board; security: calendar visible, no Manage tab).
  This proves the Phase 5 "done-when" (client logs in as each role, sees realistic data).
- Pure unit where natural (the seed user roster is data, not logic; the balance-loading fix is a
  small UI state — covered by the existing leave e2e remaining green).
- Full suite stays green serially (`--workers=1`).

## 8. Out of scope (Phase 5)

FR-24, FR-7, FR-15 (→ Phase 6). No actual Vercel deploy. No hourly leave, notifications, or non-HR
modules (PLAN §6). No schema/RLS/function changes.
