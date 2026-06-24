# HR / Time-Off — Phase 3 (Flow & Visibility) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers/admins approve or reject leave requests (ledger debits on approval); a viewer-scoped calendar shows the company's time-off without leaking the private `reason` to teammates.

**Architecture:** Same as Phases 0–2 (see [`2026-06-23-hr-timeoff-v1.md`](2026-06-23-hr-timeoff-v1.md)). All transactional writes go through `SECURITY DEFINER` SQL functions (clients have **no** INSERT/UPDATE policies on `leave_requests`/`leave_ledger`). Access control is RLS; the UI mirrors it. The team calendar reads a reason-less **definer view** scoped by the same `own | same_team | can_read_all` logic, so one view serves every role correctly.

**Tech Stack:** Next.js 16 App Router + TS · Supabase (Postgres + RLS) · `react-multi-date-picker` / `react-date-object` (Jalali render) · Vitest (pure unit) · Playwright (e2e against the linked Supabase).

## Global Constraints

Inherited verbatim from the Phase 0–2 plan ("Global Constraints" section) — locale fa/RTL default, code+password auth, **dates stored Gregorian / Jalali render-only**, **RLS is the source of truth**, roles via `private.has_role()`, full+half day only (no hourly), weekend default `{5}`, portability (no service-role secret in the app — privileged work via self-guarded `SECURITY DEFINER` functions), **verify external APIs via Context7 before use**.

Phase-3-specific constants:
- **Migration series:** continue `supabase/migrations/` with timestamped files; regen `lib/supabase/types.ts` after each (`npx supabase gen types typescript --linked > lib/supabase/types.ts`).
- **Test commands:** unit `npm run test:unit` (Vitest, pure logic, **no DB**); e2e `npm run test:e2e` (Playwright; `webServer` runs `npm run dev` against the **linked** Supabase). Admin login fixture: code `admin`, password `Admin!2026` (see `tests/e2e/leave.spec.ts`).
- **Definer functions/views are advisor-flagged (lint 0029 / 0010) and accepted by design** — the in-function/in-view guard is the intended gate, same rationale as `app_create_employee` (see `docs/PERMISSIONS.md`). Document each.

## Pre-existing state (do NOT rebuild)

Verified in the repo at plan time:
- **Cancel (FR-15) is already shipped:** `public.cancel_leave_request(uuid)` (migration `…120006_leave_fns.sql`), `cancelRequest()` action (`lib/actions/leave.ts`), the cancel button in `MyRequestsList.tsx`, and e2e coverage (`tests/e2e/leave.spec.ts` step 9). **No task here.** (FR-15's "request cancellation of an already-approved future leave" is out of the v1 outline — deferred.)
- `leave_requests` SELECT policy currently = `own | same_team | can_read_all` (migration `…120005_leave.sql`). Task 3.5 tightens it for FR-25.
- Helpers live in schema `private`: `is_admin`, `is_manager_of(uid,target)`, `same_team`, `can_read_all`, `has_role(uid,role)` (`…120002_rls_helpers.sql`; signatures per `docs/PERMISSIONS.md`). **Confirm exact names/signatures in that migration before referencing them in 3.1/3.5.**
- `compute_requested_days`, `current_leave_balance`, `allocate_leave`, `submit_leave_request`, `cancel_leave_request` exist (`…120006_leave_fns.sql`). New approval fns mirror their style (plpgsql, `security definer set search_path = ''`, `private.*` guards, `audit_log` writes, `revoke … from anon` / `grant … to authenticated`).
- Admin `EditEmployeeForm` exposes `#department_id`, `#manager_id`, and role checkboxes → e2e can build a manager→report hierarchy. `/manage/*` layout admits `admin` **or** `manager` → `/manage/approvals` belongs there.

## Open decision (default chosen; override before 3.5 if desired)

**Who may read a request's private `reason`?** FR-25 says "the requester, **their** manager, security, and admin." Two readings:
- **(A) Strict — default in this plan:** `own | is_manager_of(target) | has_role('security') | is_admin`. A manager sees reasons only for **their own reports**; other teams' reasons stay hidden even from other managers.
- **(B) Broad:** `own | can_read_all` (any manager/security/admin sees every reason).

This plan implements **(A)** (privacy-safer, matches the literal wording). It is a **one-line change** in Task 3.5 if (B) is preferred. Either way teammates never see `reason` (they read the reason-less view).

---

## File Structure (Phase 3)

```
supabase/migrations/
  20260624090001_leave_approval_fns.sql     # approve_/reject_leave_request (definer)
  20260624090002_reason_privacy_calendar.sql# tighten leave_requests SELECT + team_leave_calendar view
lib/
  actions/leave.ts                          # + approveRequest, rejectRequest, getPendingApprovals, getCalendarEntries
  leave/approvals.ts                         # PURE: filterApprovable() (unit-tested)
app/[locale]/(app)/
  manage/approvals/page.tsx                  # server: queue (admin=all pending, manager=reports' pending)
  manage/approvals/ApprovalQueue.tsx         # client: approve/reject buttons
  manage/employees/page.tsx                  # MODIFY: add link to /manage/approvals
  calendar/page.tsx                          # server: range → getCalendarEntries
  calendar/CalendarView.tsx                  # client: month grid, type-colored chips, NO reason
messages/{fa,en}.json                        # + approvals.* and calendar.* keys
tests/
  unit/approvals.test.ts                     # filterApprovable
  e2e/approval.spec.ts                       # approve debits balance; reject; non-manager denied
  e2e/calendar.spec.ts                       # teammate sees dates not reason; manager sees all
```

Two independent vertical slices — **Slice A = Approval (Tasks 3.1–3.4)**, **Slice B = Visibility/Calendar (Tasks 3.5–3.7)** — then **3.8 docs**. Slices A and B share no code and may be batched/parallelised independently.

---

# SLICE A — APPROVAL (FR-14)

### Task 3.1: Approval write-path — SQL functions (migration)

**Files:**
- Create: `supabase/migrations/20260624090001_leave_approval_fns.sql`
- Modify (regen): `lib/supabase/types.ts`

**Interfaces:**
- Consumes: `private.is_manager_of(uuid,uuid)`, `private.is_admin(uuid)`, `public.current_leave_balance(uuid,uuid)`, tables `leave_requests`, `leave_types`, `leave_ledger`, `audit_log`.
- Produces: `public.approve_leave_request(p_id uuid) returns void`; `public.reject_leave_request(p_id uuid, p_reason text default null) returns void`. Both `authenticated`-callable, `anon` revoked.

- [ ] **Step 1: Confirm helper signatures.** Open `supabase/migrations/20260623120002_rls_helpers.sql`; verify `private.is_manager_of(uuid,uuid)` and `private.is_admin(uuid)` exist with those argument orders (manager first, target second). Adjust calls below if they differ.

- [ ] **Step 2: Write the migration.** Exact contents:

```sql
-- =============================================================================
-- Migration: 20260624090001_leave_approval_fns.sql
-- Purpose  : Approval write-path. leave_requests/leave_ledger have NO client
--            write policies; these SECURITY DEFINER functions are the only way
--            to approve/reject and to write the consumption ledger row.
-- Guard    : private.is_manager_of(approver, employee) OR private.is_admin(approver).
-- Depends  : 20260623120005_leave.sql, 20260623120006_leave_fns.sql,
--            20260623120002_rls_helpers.sql
-- Note     : Advisor lint 0029 (exposed SECURITY DEFINER fn) is accepted by
--            design — the in-function admin/manager check is the intended gate.
-- =============================================================================

create or replace function public.approve_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_emp     uuid;
  v_type    uuid;
  v_days    numeric;
  v_status  public.leave_status;
  v_affects boolean;
  v_prev    numeric;
  v_rows    int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id, leave_type_id, requested_days, status
    into v_emp, v_type, v_days, v_status
    from public.leave_requests where id = p_id;
  if v_emp is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'only pending requests can be approved' using errcode = '22023';
  end if;

  -- Atomic state transition; the status predicate guards against a concurrent
  -- double-approve so the consumption ledger is written at most once.
  update public.leave_requests
     set status = 'approved', decided_by = v_uid, decided_at = now()
   where id = p_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'request was already decided' using errcode = '22023';
  end if;

  select affects_balance into v_affects from public.leave_types where id = v_type;
  if v_affects then
    v_prev := public.current_leave_balance(v_emp, v_type);
    insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type, delta_days, balance_after, note)
    values (v_emp, v_type, p_id, 'consumption', -v_days, v_prev - v_days, 'consumption on approval');
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'approve_leave_request', 'leave_requests', p_id,
          jsonb_build_object('employee_id', v_emp, 'days', v_days, 'affects_balance', coalesce(v_affects,false)));
end; $$;

create or replace function public.reject_leave_request(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_emp uuid; v_status public.leave_status; v_rows int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id, status into v_emp, v_status from public.leave_requests where id = p_id;
  if v_emp is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'only pending requests can be rejected' using errcode = '22023';
  end if;

  update public.leave_requests
     set status = 'rejected', decided_by = v_uid, decided_at = now()
   where id = p_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  -- No ledger change (a pending request never consumed balance). Rejection note
  -- lives in the audit log only (no decision-note column on leave_requests).
  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'reject_leave_request', 'leave_requests', p_id,
          jsonb_build_object('employee_id', v_emp, 'reason', p_reason));
end; $$;

revoke execute on function public.approve_leave_request(uuid)        from public, anon;
grant  execute on function public.approve_leave_request(uuid)        to authenticated;
revoke execute on function public.reject_leave_request(uuid, text)   from public, anon;
grant  execute on function public.reject_leave_request(uuid, text)   to authenticated;
```

> ⚠️ The comment on the UPDATE contains stray non-ASCII text ("状态") — **delete it / rewrite as plain English** before saving. (Flag intentionally left so the executor proofreads the migration.)

> Note: `revoke … from public, anon` covers both pre-existing PUBLIC execute and `anon`; do not also `revoke from authenticated` before the `grant`.

- [ ] **Step 3: Apply + regen types.** Run: `npx supabase db push` (expect: migration applied). Then `npx supabase gen types typescript --linked > lib/supabase/types.ts`.

- [ ] **Step 4: SQL smoke-verify (red/green substitute — no Vitest DB harness).** Using the Supabase MCP `execute_sql` (or `psql`) against the linked project, confirm: (a) both functions exist (`select proname from pg_proc where proname in ('approve_leave_request','reject_leave_request');` → 2 rows); (b) `anon` lacks EXECUTE, `authenticated` has it (`\df+` / `has_function_privilege`). Full behavioural correctness is asserted by the e2e in Task 3.4.

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/20260624090001_leave_approval_fns.sql lib/supabase/types.ts
git commit -m "feat(db): approve/reject leave write-path (definer fns, ledger debit on approval)"
```

### Task 3.2: Approval server actions + approvable filter

**Files:**
- Create: `lib/leave/approvals.ts` (PURE). Test: `tests/unit/approvals.test.ts`.
- Modify: `lib/actions/leave.ts`.

**Interfaces:**
- Produces (pure): `filterApprovable<T extends { employee_manager_id: string | null }>(rows: T[], myProfileId: string, isAdmin: boolean): T[]` → admin ⇒ all rows; otherwise rows where `employee_manager_id === myProfileId`.
- Produces (actions): `approveRequest(id: string): Promise<{ok:true}|{ok:false;error:string}>`; `rejectRequest(id: string, reason?: string): Promise<…>`; `getPendingApprovals(): Promise<{ok:true; requests: PendingApproval[]} | {ok:false;error:string}>` where
  `PendingApproval = { id; employee_name; employee_manager_id: string|null; leave_type_name: string; start_date; end_date; day_part: DayPart; requested_days: number; reason: string|null }`.
- Consumes: `approve_leave_request` / `reject_leave_request` RPCs (3.1); RLS `leave_requests` SELECT (manager reads company-wide via `can_read_all`).

- [ ] **Step 1: Write the failing unit test** (`tests/unit/approvals.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { filterApprovable } from '@/lib/leave/approvals';

const rows = [
  { id: 'a', employee_manager_id: 'mgr-1' },
  { id: 'b', employee_manager_id: 'mgr-2' },
  { id: 'c', employee_manager_id: null },
];

describe('filterApprovable', () => {
  it('admin sees every pending row', () => {
    expect(filterApprovable(rows, 'mgr-1', true).map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('manager sees only their own reports', () => {
    expect(filterApprovable(rows, 'mgr-1', false).map(r => r.id)).toEqual(['a']);
  });
  it('manager with no reports sees nothing', () => {
    expect(filterApprovable(rows, 'mgr-9', false)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail.** `npm run test:unit` → FAIL (`Cannot find module '@/lib/leave/approvals'`).

- [ ] **Step 3: Implement the pure helper** (`lib/leave/approvals.ts`):

```ts
export function filterApprovable<T extends { employee_manager_id: string | null }>(
  rows: T[],
  myProfileId: string,
  isAdmin: boolean,
): T[] {
  if (isAdmin) return rows;
  return rows.filter((r) => r.employee_manager_id === myProfileId);
}
```

- [ ] **Step 4: Run, verify pass.** `npm run test:unit` → PASS.

- [ ] **Step 5: Add the three server actions to `lib/actions/leave.ts`.** Mirror the existing `cancelRequest`/`submitRequest` shape (`getCallerContext()`, `supabase.rpc(...)`, surface `error.message`):
  - `approveRequest(id)` → `supabase.rpc('approve_leave_request', { p_id: id })`.
  - `rejectRequest(id, reason?)` → `supabase.rpc('reject_leave_request', { p_id: id, p_reason: reason ?? null })`.
  - `getPendingApprovals()` → from `leave_requests` select `id, employee_id, start_date, end_date, day_part, requested_days, reason, profiles!leave_requests_employee_id_fkey(full_name, manager_id), leave_types(name_fa, name_en)` where `status = 'pending'`, ordered by `start_date`. Map each row to `PendingApproval` (flatten `employee_name`, `employee_manager_id`, `leave_type_name`), then `return filterApprovable(mapped, myProfileId, roles.includes('admin'))`. `myProfileId` = `user.id`.
  > Confirm the exact FK alias for the `profiles` embed against the regenerated `lib/supabase/types.ts` (PostgREST names it after the FK constraint). Adjust the `profiles!…` hint if needed.

- [ ] **Step 6: Commit.**

```bash
git add lib/leave/approvals.ts tests/unit/approvals.test.ts lib/actions/leave.ts
git commit -m "feat(leave): approve/reject actions + pending-approvals query"
```

### Task 3.3: Approvals queue UI

**Files:**
- Create: `app/[locale]/(app)/manage/approvals/page.tsx`, `app/[locale]/(app)/manage/approvals/ApprovalQueue.tsx`.
- Modify: `app/[locale]/(app)/manage/employees/page.tsx` (add a link to `/${locale}/manage/approvals`); `messages/fa.json`, `messages/en.json` (add an `approvals` namespace).

**Interfaces:** Consumes `getPendingApprovals`, `approveRequest`, `rejectRequest`. No new exports.

- [ ] **Step 1: Add i18n keys** under `approvals` in both message files: `title`, `empty`, `approve`, `reject`, `approveConfirm`, `rejectConfirm`, `employee`, `type`, `dates`, `days`, `reason`, `errorLabel`, `approved`, `rejected`. (fa = Persian, en = English; match the tone of existing keys.)

- [ ] **Step 2: Build the server page** (`page.tsx`): call `getPendingApprovals()`; on `!ok` render the error; else render `<ApprovalQueue requests={…} labels={…} locale={locale} />`. Read `locale` from `params` (Promise) as the sibling pages do. Pass `name_fa`/`name_en` selection by locale.

- [ ] **Step 3: Build the client `ApprovalQueue.tsx`** — model it on `MyRequestsList.tsx` (`'use client'`, `useState` local list + `useTransition`, `confirm()` guard, error banner). Per row show employee name · type · date range · `requested_days` · `reason` (managers/admins are allowed to see it here — this page is gated to manage roles and the row already came through RLS). Two buttons:
  - Approve → `data-testid={`approve-btn-${req.id}`}` → `approveRequest(req.id)`; on ok remove the row (or mark approved).
  - Reject → `data-testid={`reject-btn-${req.id}`}` → `rejectRequest(req.id)`; on ok remove the row.
  - Container per row: `data-testid={`approval-row-${req.id}`}`. Empty state: `data-testid="approvals-empty"`.

- [ ] **Step 4: Link it.** On `manage/employees/page.tsx`, add a visible link `→ /${locale}/manage/approvals` (and a back-link the other way is optional). Keep styling consistent with existing manage headers.

- [ ] **Step 5: Verify build + lint.** Run: `npm run build` (expect: compiles) and `npm run lint` (expect: clean). Behaviour is covered by Task 3.4.

- [ ] **Step 6: Commit.**

```bash
git add "app/[locale]/(app)/manage/approvals" "app/[locale]/(app)/manage/employees/page.tsx" messages/fa.json messages/en.json
git commit -m "feat(approvals): manager/admin approval queue UI"
```

### Task 3.4: e2e — approval flow

**Files:** Create: `tests/e2e/approval.spec.ts`.

**Interfaces:** Consumes the full stack from 3.1–3.3 + existing admin console. Reuse the `login`/`logout` helpers and the throwaway-employee creation pattern from `tests/e2e/leave.spec.ts`.

- [ ] **Step 1: Write the e2e test.** One `test()` that:
  1. Login admin (`admin`/`Admin!2026`).
  2. Create manager user `mgr<ts>` — on `/manage/employees/new` set code + name + a department; check the **manager** role checkbox. Capture temp password. (After creation, open the new employee's edit page if needed to confirm the `manager` role is set.)
  3. Create employee user `emp<ts>` in the **same department**; on the employee's edit page (`/manage/employees/<id>`) set `#manager_id` to the manager (select by option text containing `mgr<ts>`) and save. Capture temp password.
  4. Allocate ≥ 4 days of a balance-affecting leave type to `emp<ts>` (reuse the `/manage/allocations` steps from `leave.spec.ts`).
  5. Logout → login `emp<ts>`; submit a **2-working-day** request (reuse the Jalali range `1405/04/08 — 1405/04/09` proven in `leave.spec.ts`). Expect a pending row.
  6. Logout → login `mgr<ts>`; go to `/manage/approvals`; expect `approval-row-*` for the employee’s request; accept the `confirm` dialog; click `approve-btn-*`. Expect the row to disappear / re-query shows none pending.
  7. Logout → login `emp<ts>`; on `/request` the request shows **approved** (`status-badge-*` matches `/approved|تایید/i`).
  8. **Balance debit (tolerant, like `leave.spec.ts`):** re-pick the same range on `/request`; if `balance-display` shows a number it should be `alloc − 2`; tolerate the `noBalance` string for timing.
  9. **Reject path:** `emp<ts>` submits a second 2-day request → logout → `mgr<ts>` opens `/manage/approvals`, clicks `reject-btn-*` (accept dialog) → logout → `emp<ts>` sees that request **rejected**.
  10. **Authorization:** assert `mgr<ts>` could act (steps 6/9 passing proves manager-of allowed); non-manager denial is enforced by RLS+the fn guard and covered structurally (an unrelated employee has no `/manage` access at all — the layout redirects).

- [ ] **Step 2: Run, verify pass.** `npm run test:e2e -- approval.spec.ts` → PASS. (If the linked Supabase lacks a balance-affecting leave type, the allocation step falls back to the first non-empty type as in `leave.spec.ts`.)

- [ ] **Step 3: Commit.**

```bash
git add tests/e2e/approval.spec.ts
git commit -m "test(approval): e2e approve debits balance + reject flow"
```

---

# SLICE B — VISIBILITY & CALENDAR (FR-16–19, FR-22, FR-25)

### Task 3.5: Reason-privacy RLS + team calendar view (migration)

**Files:**
- Create: `supabase/migrations/20260624090002_reason_privacy_calendar.sql`
- Modify (regen): `lib/supabase/types.ts`

**Interfaces:**
- Tightens `leave_requests` SELECT to the **Decision (A)** scope.
- Produces view `public.team_leave_calendar` (NO `reason` column), SELECT-grantable to `authenticated`, self-scoped by `own | same_team | can_read_all`, rows limited to `status in ('pending','approved')`.

- [ ] **Step 1: Confirm Supabase view + RLS semantics via Context7.** Query the Supabase docs (library id resolved via Context7) for: default `security_invoker` for views, how a view bypasses base-table RLS, whether `security_barrier` is recommended, and the relevant security-advisor lint id for definer views. Use the confirmed semantics to finalise the view DDL below (the version here assumes a **definer** view — `security_invoker` left at the Postgres default `false` — that re-implements scoping in its `WHERE`).

- [ ] **Step 2: Write the migration.** Exact contents (adjust only per Step 1 / helper-signature findings):

```sql
-- =============================================================================
-- Migration: 20260624090002_reason_privacy_calendar.sql
-- Purpose  : FR-25 — a leave request's free-text `reason` is private.
--   1) Tighten leave_requests SELECT so teammates can no longer read full rows
--      (which include `reason`). Full-row read = own | is_manager_of | security | admin.
--   2) Expose a reason-LESS view `team_leave_calendar` for the team/company
--      calendar, scoped own | same_team | can_read_all, approved+pending only.
-- Depends  : 20260623120005_leave.sql, 20260623120002_rls_helpers.sql
-- Note     : `team_leave_calendar` is a SECURITY DEFINER view (advisor lint 0010)
--            — accepted by design: the WHERE clause is the access gate and it
--            omits `reason`, the column being protected.
-- =============================================================================

-- 1. Tighten full-row read on leave_requests (Decision A in the Phase 3 plan).
drop policy if exists "leave_requests_select" on public.leave_requests;
create policy "leave_requests_select"
  on public.leave_requests for select to authenticated
  using (
    employee_id = auth.uid()
    or private.is_manager_of(auth.uid(), employee_id)
    or private.has_role(auth.uid(), 'security')
    or private.is_admin(auth.uid())
  );

-- 2. Reason-less calendar view (teammates get dates + status, never `reason`).
create or replace view public.team_leave_calendar as
  select
    lr.id,
    lr.employee_id,
    p.full_name      as employee_name,
    p.department_id,
    lr.leave_type_id,
    lt.name_fa       as leave_type_name_fa,
    lt.name_en       as leave_type_name_en,
    lt.color         as leave_type_color,
    lr.start_date,
    lr.end_date,
    lr.day_part,
    lr.requested_days,
    lr.status
  from public.leave_requests lr
  join public.profiles    p  on p.id  = lr.employee_id
  join public.leave_types lt on lt.id = lr.leave_type_id
  where lr.status in ('pending', 'approved')
    and (
      lr.employee_id = auth.uid()
      or private.same_team(auth.uid(), lr.employee_id)
      or private.can_read_all(auth.uid())
    );

revoke all     on public.team_leave_calendar from public, anon;
grant  select  on public.team_leave_calendar to authenticated;
```

- [ ] **Step 3: Apply + regen types.** `npx supabase db push`; then regen `lib/supabase/types.ts`.

- [ ] **Step 4: SQL smoke-verify (via Supabase MCP `execute_sql` / psql).** As a same-team **teammate** JWT (not owner/manager/security/admin): `select count(*) from public.team_leave_calendar` returns the teammate's approved/pending rows **and the result set has no `reason` column**; `select reason from public.leave_requests where employee_id = '<other teammate>'` returns **0 rows** (full-row read now blocked). As the **owner**: full-row read still returns their own rows incl. `reason`. (If you cannot mint test JWTs easily, rely on the e2e in Task 3.7 for the teammate-can't-see-reason assertion and just confirm the view exists + grants here.)

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/20260624090002_reason_privacy_calendar.sql lib/supabase/types.ts
git commit -m "feat(db): FR-25 reason privacy — tighten leave_requests read + reason-less calendar view"
```

### Task 3.6: Calendar read action + page (FR-22)

**Files:**
- Modify: `lib/actions/leave.ts` (add `getCalendarEntries`).
- Create: `app/[locale]/(app)/calendar/page.tsx`, `app/[locale]/(app)/calendar/CalendarView.tsx`.
- Modify: `messages/fa.json`, `messages/en.json` (add a `calendar` namespace).

**Interfaces:**
- Produces: `getCalendarEntries(rangeStart: string, rangeEnd: string): Promise<{ok:true; entries: CalendarEntry[]} | {ok:false;error:string}>` where
  `CalendarEntry = { id; employee_id; employee_name; leave_type_name: string; leave_type_color: string|null; start_date; end_date; day_part: DayPart; status: 'pending'|'approved' }`. Query `team_leave_calendar` for rows overlapping `[rangeStart, rangeEnd]` (`start_date <= rangeEnd and end_date >= rangeStart`), ordered by `start_date`. The view is viewer-scoped, so every role gets the correct set automatically (employee = own + team; manager/security/admin = all). **No `reason` is ever fetched here.**

- [ ] **Step 1: Add `getCalendarEntries` to `lib/actions/leave.ts`** following the read-helper pattern (`getCallerContext`, select from `team_leave_calendar`, pick `leave_type_name_fa`/`_en` per the caller's locale — or return both and let the client choose; map to `CalendarEntry`).

- [ ] **Step 2: Add i18n keys** under `calendar`: `title`, `empty`, `legendPending`, `legendApproved`, plus month/weekday rendering (prefer `DateObject` formatting from `react-date-object` so Jalali month/day names come for free — mirror `lib/leave/dateConvert.ts`).

- [ ] **Step 3: Build the server page** (`calendar/page.tsx`): compute the current month range (default to today's month; honour optional `?month=` later), call `getCalendarEntries(rangeStart, rangeEnd)`, read the caller's `calendar_pref` (jalali|gregorian) and `locale`, render `<CalendarView entries locale calendarPref labels />`.

- [ ] **Step 4: Build `CalendarView.tsx`** (`'use client'`): a month grid (or, acceptably for v1, a grouped day-list) that places each entry on its day(s) as a chip showing `employee_name` + type, background from `leave_type_color`, with a pending/approved style distinction. Convert day cells to Jalali for display when `calendarPref==='jalali'` using `react-date-object` (the only date lib in `package.json`; **do not** add `dayjs`/`jalaali-js`). **Never render `reason`** (the type doesn't include it). Add `data-testid="calendar-view"` on the container and `data-testid={`cal-entry-${id}`}` per chip. **Confirm any `react-multi-date-picker` `<Calendar readOnly mapDays>` props via Context7 if you use that component instead of a hand-built grid.**

- [ ] **Step 5: Verify build + lint.** `npm run build` (expect compiles), `npm run lint` (expect clean). Behaviour covered by Task 3.7.

- [ ] **Step 6: Commit.**

```bash
git add lib/actions/leave.ts "app/[locale]/(app)/calendar" messages/fa.json messages/en.json
git commit -m "feat(calendar): viewer-scoped time-off calendar (reason-less)"
```

### Task 3.7: e2e — calendar visibility + reason privacy

**Files:** Create: `tests/e2e/calendar.spec.ts`.

- [ ] **Step 1: Write the e2e test.** Reuse `login`/`logout` + admin-console creation. Flow:
  1. Login admin; create two employees **in the same department**: `auth<ts>` (the requester) and `peer<ts>` (the teammate). Allocate balance to `auth<ts>`.
  2. Login `auth<ts>`; submit a request with a **distinctive reason string** e.g. `SECRET-MEDICAL-<ts>`. (Optionally have an admin/manager approve it via the Task-3.1 RPC so it shows as approved; pending also appears on the calendar.)
  3. Logout → login `peer<ts>`; go to `/calendar`. Assert `data-testid="calendar-view"` visible and a `cal-entry-*` chip referencing `auth<ts>`'s leave is present (dates/type visible).
  4. **Privacy assertion:** `await expect(page.locator('body')).not.toContainText('SECRET-MEDICAL-<ts>')` on `/calendar` (and the teammate must not be able to read it on `/request`, which only lists their own). This is the FR-25 guarantee.
  5. **Scope spot-check:** an admin (or a `security`-role user, if you create one) sees the same entry on `/calendar`; a totally unrelated-team employee does **not** see `auth<ts>`'s chip.

- [ ] **Step 2: Run, verify pass.** `npm run test:e2e -- calendar.spec.ts` → PASS.

- [ ] **Step 3: Commit.**

```bash
git add tests/e2e/calendar.spec.ts
git commit -m "test(calendar): e2e teammate sees dates not reason; scope by viewer"
```

---

# WRAP-UP

### Task 3.8: Docs, statuses, changelog, memory

**Files:** Modify: `docs/REQUIREMENTS.md`, `docs/TASKS.md`, `docs/CHANGELOG.md`, `.superpowers/sdd/progress.md`, and the auto-memory pointer (`…/memory/bj-hr-app-state.md` + `MEMORY.md`).

- [ ] **Step 1:** Flip `docs/REQUIREMENTS.md`: **FR-14 ☑**, **FR-22 ☑**, **FR-25 ☑**; **FR-16–19 ☑** (visibility now enforced end-to-end — note manager-reason scope = Decision A). FR-15 already satisfied (mark ☑ if not already).
- [ ] **Step 2:** `docs/TASKS.md`: tick Phase 3 boxes; update the "Current state" banner to "Phases 0–3 complete"; note next = Phase 4.
- [ ] **Step 3:** `docs/CHANGELOG.md`: add an entry (approval flow + ledger debit; FR-25 reason privacy + calendar; new migrations 0008/0009; new e2e suites).
- [ ] **Step 4:** Append Phase 3 outcome to `.superpowers/sdd/progress.md`; update `bj-hr-app-state.md` memory ("Phase 3 done").
- [ ] **Step 5:** Run the full suite once green: `npm run test:unit && npm run test:e2e && npm run build`.
- [ ] **Step 6: Commit.** `git commit -m "docs: mark Phase 3 (flow & visibility) complete"`.

---

## Self-Review

**Spec coverage:**
- **FR-14** (approve/reject, admin override, ledger on approval) → Tasks 3.1–3.4. Admin override = the `or private.is_admin` arm of the guard.
- **FR-15** (cancel pending) → **already shipped** (documented in "Pre-existing state"); statuses flipped in 3.8.
- **FR-16–19** (employee=team, manager/security=company read, admin=all) → enforced by `leave_requests` SELECT (3.5) + the `team_leave_calendar` scoping (3.5) + the calendar consuming it (3.6); exercised in 3.7.
- **FR-22** (viewer-scoped calendar) → 3.6, verified 3.7.
- **FR-25** (reason private) → 3.5 (tightened policy + reason-less view), verified 3.7 step 4.
- **NFR-5** (RLS + audit) → approval/reject write `audit_log` (3.1); reads stay RLS-gated. **NFR-3** (RTL/i18n) → fa+en keys in 3.3/3.6. **NFR-6** (indexed) → reuses existing `leave_requests` indexes; the calendar query uses the `(start_date,end_date)` index. **NFR-7** (a11y/touch) → full pass is Phase 4; keep buttons labelled here.
- Not in Phase 3: home board (FR-20), bottom-tab nav (FR-21), settings toggles (FR-23), work/holiday admin (FR-24) — all Phase 4/5.

**Placeholder scan:** No "TBD/handle edge cases" steps. External-API steps name the concrete check (Context7: Supabase view RLS in 3.5; picker props in 3.6). The one deliberate "fix me" is the stray non-ASCII comment in 3.1 Step 2 (flagged for proofreading).

**Type consistency:** `filterApprovable` requires `employee_manager_id` — `getPendingApprovals` maps `profiles.manager_id → employee_manager_id` (3.2). `CalendarEntry`/`PendingApproval` field names are used identically in their action and their consuming component. `approve_leave_request(uuid)` / `reject_leave_request(uuid,text)` signatures match between the migration (3.1) and the `rpc()` calls (3.2). View column names (`employee_name`, `leave_type_color`, …) match between the view DDL (3.5) and `getCalendarEntries` mapping (3.6).

**Risks / verify-at-build:** (1) helper signatures (`is_manager_of` arg order, `has_role` in `private`) — Step 3.1.1 / 3.5.2; (2) definer-view RLS semantics — Context7 in 3.5.1; (3) PostgREST FK embed alias for the `profiles` join in `getPendingApprovals` — 3.2.5; (4) the linked Supabase must have a balance-affecting leave type for the allocation e2e (existing tests already assume this).
