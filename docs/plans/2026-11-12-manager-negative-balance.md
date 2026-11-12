# Manager negative balance (FR-92) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers may borrow annual leave (balance goes negative); employees are capped at balance − pending; approvers see full request details; HR sees balances/used/unpaid on Employees, converts negatives to unpaid, and gets a Payroll report.

**Architecture:** Rules live in Postgres (definer functions, RLS) with a pure TS mirror for the form preview. A new `leave_types.manager_overdraft` flag marks the types the new rules apply to (annual only). Converted unpaid time gets its own table. UI changes are client components fed by new server actions; the Payroll report is a self-contained Reports section.

**Tech Stack:** Next.js 16 App Router, TypeScript, next-intl (fa default RTL + en), Tailwind v4 (container queries built in), self-hosted Supabase (Postgres + PostgREST), Vitest, plain-SQL tests.

**Spec:** `docs/specs/2026-11-12-manager-negative-balance-design.md` — read it first. Numbers like "spec 9" refer to its numbered decisions.

## Global Constraints

- Read `CLAUDE.md` (repo root) before starting; its Gotchas are binding. Especially: migrations only in `supabase/migrations/`, forward-only, frozen once applied to any DB **except a throwaway clone**; never hand-run SQL on a server; `lib/supabase/types.ts` is hand-edited; server actions start with `requireCaller(...)` and `if (!c.ok) return c;`; lock order `private.approval_lock(company)` before the `'leave:'||employee` advisory lock.
- Every user-facing string in **both** `messages/fa.json` and `messages/en.json`. Client components read text with `useTranslations`; pages never build translated `labels` props for new UI.
- UI follows `docs/DESIGN.md`: tables `className="data-table"`, tabs from `lib/ui/tabs.ts`, no `shadow-*`, no `rounded-[Npx]`, `rounded-full` only for circles, no `dark:` utilities.
- Negative durations render with their sign via the existing `formatDuration`/`minutesToDaysHours` (`lib/leave/duration.ts`); wrap them in `<bdi>` so the minus survives RTL.
- Leave amounts are **minutes** everywhere; inputs use `DaysHoursField` (days + hours), never a decimal-days input.
- Error strings raised by SQL are stable English, mapped to fa/en in `lib/errors/db-error.ts` + `messages/*.json` (`dbErrors`), following the existing entries.
- **Who is a Manager:** `private.has_role(uid,'manager')`, checked at the moment of the action (submit / approve / edit), never snapshotted. Admin is never special-cased by the overdraft rule; every new screen/action is available to admin (gates use `private.is_admin(uid) or private.has_perm(...)` like the existing code).
- **Rule per request** (`BalanceRule`): `'overdraft'` = type has `manager_overdraft` and requester is a Manager; `'strict'` = type has `manager_overdraft`, requester not a Manager; `'split'` = any other `affects_balance` type (sick: today's behaviour); `'none'` = no balance (unpaid type, errands).
- Do not touch: accrual maths, `set_leave_balance`'s −366-workday bound, sick/special leave behaviour, approval chains, signatures, print layout, the Finance list.
- **Database work happens on a throwaway clone** of the local stack's DB (container `bj-approvals-finance-db-1`; the main `bj-erp` stack is not running). Never apply these migrations to the `postgres` database. Clone recipe (run from repo root):
  ```bash
  DB=bj-approvals-finance-db-1
  psqlc() { docker exec -i $DB sh -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -v ON_ERROR_STOP=1 -U supabase_admin "$@"' -- "$@"; }
  psqlc -d postgres -c "drop database if exists mnb" -c "create database mnb"
  docker exec $DB sh -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_dump -Fc -U supabase_admin -d postgres' \
    | docker exec -i $DB sh -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_restore --no-owner -U supabase_admin -d mnb' || true   # only pg_cron/graphql objects may fail
  psqlc -d mnb < supabase/migrations/<file>.sql      # apply a migration
  psqlc -d mnb -q < tests/sql/<file>.sql              # run a SQL test (PASS/FAIL notices)
  ```
  The clone `mnb` holds a copy of real personnel data: never print rows of it beyond counts/ids in logs, never commit output. Drop it when the plan is done (`drop database mnb`).
- Commit after each task with a conventional message (`feat:`/`fix:`/`test:`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. Never add `[skip ci]`.
- Checks before each commit: `npx tsc --noEmit` (0 errors), `npm run lint` (0 errors), `npm run test:unit` (all pass). SQL tasks also: their SQL test file all PASS on `mnb`.

## Review Focus

1. **Racing submissions** — two requests from one person at once must not both pass the available check: the pending sum is read **after** `pg_advisory_xact_lock('leave:'||uid)` in `submit_leave_impl`. (Task 1 test "pending counts".)
2. **Role change between submit and approve** — a Manager who loses the role before approval gets the employee split (paid up to balance, rest unpaid); an employee who gains it gets the full amount on the ledger. (Task 1 tests "role lost" / "role gained".)
3. **Cancelling an approved overdraft request** — the `reversal` row returns the full requested minutes (unpaid is 0), bringing the balance back up. (Task 1 test "cancel overdraft".)
4. **Employee with a negative opening balance** — available ≤ 0, so any annual request is refused, while the unpaid leave type still submits. (Task 1 tests.)
5. **Bulk convert when a person is no longer negative** (accrual landed, or converted twice) — skipped, not an error; count reflects only converted people. (Task 2 test "bulk skips non-negative".)

---

### Task 1: SQL — overdraft rule in submit, approve, edit, approval context

**Files:**
- Create: `supabase/migrations/20261112120000_manager_overdraft.sql`
- Create: `tests/sql/manager-overdraft.sql`
- Modify: `lib/supabase/types.ts` (new RPC + new column), `lib/errors/db-error.ts`, `messages/fa.json`, `messages/en.json` (`dbErrors`)

**Interfaces:**
- Produces (SQL):
  - column `public.leave_types.manager_overdraft boolean not null default false`; the migration sets it `true` where `name_en = 'Annual Leave' and affects_balance`.
  - `private.balance_rule(p_employee uuid, p_leave_type uuid) returns text` → `'overdraft'|'strict'|'split'|'none'` (see Global Constraints).
  - `private.pending_leave_minutes(p_employee uuid, p_leave_type uuid, p_exclude uuid default null) returns integer` — sum of `requested_minutes` of the employee's `status='pending'`, `kind='leave'` requests of that type, excluding `p_exclude`.
  - `public.app_my_leave_availability(p_leave_type_id uuid) returns jsonb` → `{"balance_minutes": int|null, "pending_minutes": int, "rule": text}` for `auth.uid()`; `balance_minutes` null when no ledger row (same as today's `getMyBalance`). Granted to `authenticated`.
  - Approval context (`private.request_data_app_request_approval_context`) gains keys: `balance_minutes` (requester's current balance of the type, null if no balance type), `pending_other_minutes` (`pending_leave_minutes(employee, type, request id)`), `balance_rule`. These flow into `app_approval_queue` rows automatically (it aggregates `app_request_approval_context`).
  - New error string `request exceeds available balance` (errcode 22023).

- [ ] **Step 1: Write the failing SQL test `tests/sql/manager-overdraft.sql`.** Copy the fixture/helper header of `tests/sql/balance-add.sql` (rename the temp table to `mo_fx`). Fixtures: one company (reuse the clone's company via `select id from companies limit 1` is NOT allowed — build a synthetic company, departments, profiles, leave types the way `balance-add.sql` does), annual type (`manager_overdraft=true`), sick type (`affects_balance`, `manager_overdraft=false`), unpaid type. People: `mgr` (roles employee+manager), `emp` (employee), `hr` (hr), an approver chain so `approve_leave_request_v2`/admin override can approve (follow `balance-add.sql`/`request-edit.sql` fixtures; admin override is the simplest approve path). Set balances with ledger rows. Assertions (`pg_temp.expect`), each a named case:
  - `rule mgr annual` = `overdraft`; `rule emp annual` = `strict`; `rule emp sick` = `split`; `rule emp unpaid` = `none`.
  - `pending counts`: emp balance 5 days, submits 3 days (ok), then 3 days → `ERROR 22023 request exceeds available balance`; then 2 days → ok.
  - `strict exact`: request equal to available succeeds with `unpaid_minutes = 0`.
  - `negative opening`: emp2 balance −1 day → 1-day annual refused; 1-day unpaid-type request succeeds with `unpaid_minutes = requested_minutes`.
  - `mgr over`: mgr balance 2 days submits 5 days → succeeds, `unpaid_minutes = 0`; after approval ledger `consumption` delta = −5 days, balance = −3 days, request `unpaid_minutes = 0`.
  - `cancel overdraft`: cancelling that approved future request writes a `reversal` of +5 days; balance back to 2 days.
  - `role lost`: mgr2 (balance 1 day) submits 3 days, then loses `manager` role (delete from `user_roles`), approval → `unpaid_minutes = 2 days`, consumption −1 day, balance 0.
  - `role gained`: emp3 (balance 3 days) submits 3 days, HR sets balance to 1 day, emp3 gains `manager`, approval → consumption −3 days, balance −2 days, unpaid 0.
  - `employee split at approval`: emp4 balance 3 days submits 3 days; HR sets balance 1 day; approval → unpaid 2 days, balance 0 (spec 9).
  - `sick unchanged`: mgr sick balance 1 day, 3-day sick request → approval unpaid 2 days, balance 0.
  - `edit mgr negative`: approved mgr request edited (via `app_edit_request` as an editor holding `edit_leave_daily`) to a longer range → allowed, balance more negative, unpaid stays 0.
  - `edit emp unpaid refused`: approved emp request edited longer than its balance → `an edit cannot make leave unpaid` (unchanged rule).
  - `availability rpc`: as emp, `app_my_leave_availability(annual)` returns `balance_minutes`, `pending_minutes`, `rule='strict'`.
  - `context keys`: as an approver, `app_request_approval_context(id)` has `balance_minutes`, `pending_other_minutes` (excludes the request itself), `balance_rule`.
  Durations: compute minutes with `private.company_minutes_per_day(company)`; pick dates on working days in the future (use a fixed 2027 range clear of weekends/holidays in the synthetic company).

- [ ] **Step 2: Run it on a fresh clone to see it fail.** Create `mnb` (Global Constraints recipe), run the test. Expected: FAIL/ERROR (function `private.balance_rule` does not exist).

- [ ] **Step 3: Write the migration.** Start each redefined function from its **current** body in `supabase/schema.sql` (`submit_leave_impl` ~l.3953, `finalize_approval_request` ~l.1839, `edit_request_impl` ~l.1291, `request_data_app_request_approval_context` ~l.2818) and change only:
  - `submit_leave_impl`: after the employee advisory lock and `v_minutes`, when `v_affects`: `v_rule := private.balance_rule(v_uid, p_leave_type_id)`; `'overdraft'` → `v_unpaid := 0`; `'strict'` → if `v_minutes > coalesce(v_balance,0) - private.pending_leave_minutes(v_uid, p_leave_type_id)` raise `request exceeds available balance`, else `v_unpaid := 0`; `'split'` → today's formula.
  - `finalize_approval_request`: when `v_affects` and `private.balance_rule(r.employee_id, r.leave_type_id) = 'overdraft'` → `v_paid := r.requested_minutes; v_unpaid := 0` (ledger row `consumption`, delta `-v_paid`, `balance_after = v_prev - v_paid`, note `'consumed on approval (manager overdraft)'`). Every other case unchanged (strict and split both use today's paid/unpaid split — spec 9).
  - `edit_request_impl`: in the `lt.affects_balance` branch, when rule is `overdraft` → `v_new_paid := v_minutes; v_unpaid := 0`, skip the "cannot make leave unpaid" check; else unchanged.
  - approval context: add the three keys.
  - `app_my_leave_availability`: `security definer`, `set search_path = ''`, `stable`, raises `not authenticated` (42501) when `auth.uid()` is null.
  - Keep every function's signature, owner, grants and `security definer`/`search_path` exactly as today.

- [ ] **Step 4: Apply the migration to `mnb` and rerun the test.** Expected: every line `PASS`, no `FAIL`. Also rerun `tests/sql/request-edit.sql`, `tests/sql/balance-add.sql`, `tests/sql/sign-once.sql`, `tests/sql/stranded-request.sql` on `mnb`; they must give the same result as on a clone without the migration (previous agents saw known local-drift failures only in `fr55-roles-permissions`, `hr-head-own-per-diem`, `travel-booking`, `approval-delegation`).

- [ ] **Step 5: TypeScript plumbing.** In `lib/supabase/types.ts` add `manager_overdraft: boolean` to `leave_types` Row (and `?:` in Insert/Update) and the `app_my_leave_availability` function (`Args: { p_leave_type_id: string }; Returns: Json`). Map `request exceeds available balance` in `lib/errors/db-error.ts` like neighbouring entries; copy: en "This request is more than your available balance. File the rest as unpaid leave." · fa "این درخواست بیشتر از مانده قابل استفاده شماست. بقیه را به صورت مرخصی بدون حقوق ثبت کنید." Do not touch `ApprovalContextRow`; Task 5 adds the context keys in TS.

- [ ] **Step 6: Checks + commit.** `npx tsc --noEmit && npm run lint && npm run test:unit`. Commit: `feat(leave): manager overdraft and pending-aware strict balance in SQL (FR-92)`.

---

### Task 2: SQL — unpaid conversions, Employees totals, negatives list, pending counts, payroll rows

**Files:**
- Create: `supabase/migrations/20261112120100_unpaid_conversions.sql`
- Create: `tests/sql/unpaid-conversions.sql`
- Modify: `lib/supabase/types.ts`, `lib/errors/db-error.ts`, `messages/fa.json`, `messages/en.json` (`dbErrors`)

**Interfaces:**
- Consumes: Task 1 (`manager_overdraft`).
- Produces (SQL; all `security definer`, `set search_path = ''`, granted to `authenticated`, revoked from `anon`/`public`):
  - table `public.leave_unpaid_conversions(id uuid pk default gen_random_uuid(), company_id uuid not null → companies, employee_id uuid not null → profiles on delete cascade, leave_type_id uuid not null → leave_types, minutes integer not null check (minutes > 0), ledger_id uuid not null → leave_ledger, note text check (char_length(note) <= 500), converted_by uuid → profiles on delete set null, converted_at timestamptz not null default clock_timestamp())`; index `(company_id, converted_at)`; RLS enabled, one select policy: `employee_id = auth.uid() or private.is_admin(auth.uid()) or private.has_perm(auth.uid(),'leave_balances','read') or private.has_perm(auth.uid(),'reports','read')`, scoped to the caller's company. No insert/update/delete policies (writes only through the functions below).
  - `private.annual_type(p_company uuid) returns uuid` — the active type with `manager_overdraft` (first by `name_en`); null if none.
  - `private.jalali_year_start(p_day date) returns date` — `min(gregorian_start)` of the Jalali year containing `p_day` (from `public.jalali_months`).
  - `private.convert_negative_impl(p_actor uuid, p_employee uuid, p_minutes integer, p_note text) returns integer` — takes `'leave:'||employee` lock, reads the annual balance; if balance ≥ 0 returns 0; amount = `coalesce(p_minutes, -balance)`; raises `amount must be more than 0` if ≤ 0, `amount exceeds the negative balance` if > −balance; inserts ledger `adjustment` (+amount, `balance_after = balance + amount`, note `coalesce(p_note,'converted to unpaid')`, `created_by = p_actor`), the conversion row, and `audit_log` (`action 'leave_balance.convert_unpaid'`, entity `leave_unpaid_conversions`, after `{employee_id, leave_type_id, previous_minutes, converted_minutes}`); returns amount.
  - `public.app_convert_negatives(p_employee_ids uuid[]) returns integer` — gate: `is_admin or has_perm(uid,'leave_balances','edit')`; for each id **sorted ascending** (deadlock safety): skip self unless admin, require `is_admin or can_manage_leave_of(uid, id)` (raise `not allowed to change this employee''s leave` 42501), call impl with null minutes; returns number of people converted (amount > 0).
  - `public.app_convert_negative(p_employee_id uuid, p_minutes integer, p_note text) returns integer` — same gates; balance ≥ 0 raises `balance is not negative`; returns converted minutes.
  - `public.app_negative_balances() returns table(employee_id uuid, full_name text, personnel_no text, department_name_fa text, department_name_en text, balance_minutes integer)` — gate `leave_balances` edit or admin; active profiles of the caller's company whose annual balance < 0, ordered by `full_name`.
  - `public.app_employee_leave_totals(p_ids uuid[]) returns table(employee_id uuid, balance_minutes integer, used_minutes integer, unpaid_minutes integer)` — gate `is_admin or has_perm(uid,'people','read')` (spec 18 — wider than `leave_balances` on purpose); only ids in the caller's company. `today` = `(now() at time zone 'Asia/Tehran')::date`, `ys` = `jalali_year_start(today)`. `balance` = `current_leave_balance(id, annual_type)` (null if no ledger row); `used` = sum of `requested_minutes - unpaid_minutes` of `approved` `kind='leave'` requests of the annual type with `start_date between ys and today`; `unpaid` = sum of `unpaid_minutes` of `approved` `kind='leave'` requests (any type) with `start_date between ys and today` + sum of conversion `minutes` with `(converted_at at time zone 'Asia/Tehran')::date between ys and today`. Use the requests' current (post-edit) columns.
  - `public.app_pending_leave_counts(p_employee_id uuid) returns table(leave_type_id uuid, pending_count integer, pending_minutes integer)` — gate `is_admin or has_perm(uid,'leave_balances','read')`; pending `kind='leave'` requests of that employee grouped by type.
  - `public.app_payroll_unpaid(p_from date, p_to date) returns table(employee_id uuid, full_name text, personnel_no text, department_name_fa text, department_name_en text, source text, ref text, on_date date, leave_type_name_fa text, leave_type_name_en text, unpaid_minutes integer)` — gate `is_admin or has_perm(uid,'reports','read')`; `source`: `'unpaid_type'` (approved request of a type with `not affects_balance and not is_paid`), `'unpaid_part'` (approved request of an `affects_balance` type with `unpaid_minutes > 0`), `'conversion'`; requests filtered by `start_date between p_from and p_to`, `ref` = `serial_year || '-' || lpad(serial_seq::text,4,'0')`; conversions by Tehran date of `converted_at`, `ref` null, leave type = the annual type. Caller's company only. Ordered by `full_name, on_date`.
  - Error strings: `amount exceeds the negative balance`, `balance is not negative`.

- [ ] **Step 1: Write the failing test `tests/sql/unpaid-conversions.sql`** (own fixtures, prefix `uc_fx`; synthetic company with annual/sick/unpaid types, `hr` holding `leave_balances` edit + `people` read + `reports` read via the `hr` preset role, `clerk` with only `people` read, `emp1..emp3`, a second company with `other`). Cases:
  - `bulk converts`: emp1 −2 days, emp2 −1 day, emp3 +1 day → `app_convert_negatives([emp1,emp2,emp3])` as hr returns 2; balances 0,0,+1; two conversion rows; two ledger `adjustment` rows; two audit rows.
  - `bulk skips non-negative`: calling it again returns 0, no new rows.
  - `partial`: emp1 at −3 days → `app_convert_negative(emp1, 1 day, 'x')` returns 1 day, balance −2 days; amount 5 days → `amount exceeds the negative balance`; on emp3 → `balance is not negative`.
  - `gates`: clerk calling `app_convert_negatives` → 42501; hr converting self → skipped/refused per rules; `other` company id → not converted.
  - `negatives list`: hr sees exactly the negative people of their company; clerk → 42501.
  - `totals`: clerk (people read only) gets `balance_minutes/used_minutes/unpaid_minutes` for emp1; `used` counts only this Jalali year's approved annual leave started on or before today (fixture: one request last Jalali year, one this year in the past, one future approved — only the past one this year counts); `unpaid` includes an unpaid-type request this year + an unpaid part + a conversion made today.
  - `pending counts`: two pending annual requests of emp2 → `pending_count 2`.
  - `payroll rows`: as hr, `app_payroll_unpaid(ys, today)` returns the three sources with correct `source`, minutes, `ref`; clerk → 42501.
  - `rls`: as emp2, `select count(*) from leave_unpaid_conversions` sees only own rows; as clerk sees 0.
  Approve fixture requests directly via the admin override path or by inserting approved rows the way existing SQL tests do for history (direct inserts of `status='approved'` rows are fine for totals/payroll cases).

- [ ] **Step 2: Run on `mnb` (with Task 1 applied).** Expected: errors (functions missing).
- [ ] **Step 3: Write the migration** per the Interfaces block.
- [ ] **Step 4: Apply to `mnb`; rerun.** Expected: all `PASS`. Rerun `tests/sql/manager-overdraft.sql` too: still all `PASS`.
- [ ] **Step 5: types.ts + error mapping.** Add the table (Row/Insert/Update) and the six functions to `lib/supabase/types.ts`. Map the two new errors — en "The amount is more than the negative balance." / fa "مقدار بیشتر از مانده منفی است."; en "The balance is not negative." / fa "مانده منفی نیست."
- [ ] **Step 6: Checks + commit.** `feat(leave): convert negative balances to unpaid, totals and payroll RPCs (FR-92)`.

---

### Task 3: SQL — backfill past Manager unpaid parts, dry-run script, schema.sql

**Files:**
- Create: `supabase/migrations/20261112120200_manager_overdraft_backfill.sql`
- Create: `scripts/sql/manager-overdraft-backfill-dryrun.sql`
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: Task 1 (`manager_overdraft`, `private.balance_rule`).
- Produces: no new callable objects (data-only migration).

Rules (spec 16): rows = `leave_requests` with `kind='leave'`, `unpaid_minutes > 0`, `status in ('approved','pending')`, type `manager_overdraft`, employee currently holds `manager`. For **approved** rows: post one `consumption` ledger row of `-unpaid_minutes` with `request_id`, note `'manager overdraft backfill (FR-92)'`, `balance_after = current balance - unpaid_minutes`; then `unpaid_minutes := 0`. For **pending** rows: only `unpaid_minutes := 0` (approval recomputes). Process per employee in ascending employee id, rows in `created_at, id` order; take `private.approval_lock(company)` once per company first, then each employee's `'leave:'||id` lock (lock order rule). Insert one `audit_log` row per moved request (`action 'leave_request.overdraft_backfill'`, after `{employee_id, request_id, moved_minutes}`).

- [ ] **Step 1: Write the dry-run script** `scripts/sql/manager-overdraft-backfill-dryrun.sql`: a single read-only `select` listing `employee_id, personnel_no, serial (year-seq), status, start_date, unpaid_minutes, current balance, balance after` for the rows above, plus a final totals row. Header comment: read-only; run against a restored live backup with `psqlc -d <db> < scripts/sql/...`; output contains personnel data — do not commit or paste it anywhere public. Run it only after the Task 1 and 2 migrations are applied (it reads `manager_overdraft`).
- [ ] **Step 2: Run the dry run on `mnb`.** Record only the **count** of rows and the sum of minutes (no names) for the commit message / report.
- [ ] **Step 3: Write the migration.** Then apply to `mnb`.
- [ ] **Step 4: Verify on `mnb`:** rerun the dry-run → 0 rows; for each moved request a ledger row with that `request_id` and the backfill note exists (`select count(*)` equals Step 2 count); `tests/sql/manager-overdraft.sql` and `tests/sql/unpaid-conversions.sql` still all `PASS`.
- [ ] **Step 5: Update `supabase/schema.sql`.** Make a second clone `mnb_base` (recipe, no migrations), then:
  ```bash
  docker exec $DB sh -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_dump -s --no-owner -U supabase_admin -d mnb_base' > "$SCRATCH/base.sql"
  docker exec $DB sh -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_dump -s --no-owner -U supabase_admin -d mnb' > "$SCRATCH/mig.sql"
  diff -u "$SCRATCH/base.sql" "$SCRATCH/mig.sql" > "$SCRATCH/schema.patch"; patch supabase/schema.sql < "$SCRATCH/schema.patch"
  ```
  (`$SCRATCH` = a temp dir outside the repo.) If `patch` rejects hunks because `schema.sql` carries owners, apply the same changes by hand so every new/changed object in `schema.sql` is byte-identical to `mig.sql`. Do **not** commit `CONSTRAINT … CHECK` re-parenthesization hunks (CLAUDE.md gotcha). `drop database mnb_base` after.
- [ ] **Step 6: Checks + commit.** `feat(leave): backfill manager unpaid parts into the ledger, dry-run script, schema dump (FR-92)`.

---

### Task 4: Request form — availability, strict block, Manager confirm dialog

**Files:**
- Modify: `lib/leave/duration.ts` (`projectLeaveBalance`, `LeaveBalanceProjection`)
- Modify: `lib/actions/leave/balances.ts` (`getMyBalance`)
- Modify: `app/[locale]/(app)/request/_components/useRequestForm.ts` (`useLeaveBalance`)
- Modify: `app/[locale]/(app)/request/_components/FormParts.tsx` (`LeaveBalancePreview`)
- Create: `app/[locale]/(app)/request/_components/OverdraftConfirm.tsx`
- Modify: `app/[locale]/(app)/request/LeaveRequestForm.tsx`, `app/[locale]/(app)/request/hourly/HourlyRequestForm.tsx`
- Modify: `messages/fa.json`, `messages/en.json`
- Test: `tests/unit/duration.test.ts`, create `tests/unit/overdraft-confirm.test.tsx`

**Interfaces:**
- Consumes: RPC `app_my_leave_availability(p_leave_type_id)` → `{balance_minutes:number|null, pending_minutes:number, rule:'overdraft'|'strict'|'split'|'none'}` (Task 1).
- Produces:
  - `export type BalanceRule = 'overdraft' | 'strict' | 'split' | 'none'` in `lib/leave/duration.ts`.
  - `export type LeaveBalanceProjection = { requestingMinutes: number; availableMinutes: number; remainingMinutes: number; unpaidMinutes: number; overMinutes: number; blocked: boolean; rule: BalanceRule }`.
  - `projectLeaveBalance(requestedMinutes: number, balanceMinutes: number, opts?: { pendingMinutes?: number; rule?: BalanceRule }): LeaveBalanceProjection` — defaults `pendingMinutes 0`, `rule 'split'` (keeps old callers' behaviour). `available = balance - pending`. `over = max(requested - max(available,0), 0)`.
    - `overdraft`: `remaining = balance - pending - requested` (may be negative), `unpaid 0`, `blocked false`.
    - `strict`: `remaining = max(available - requested, 0)`, `unpaid 0`, `blocked = over > 0`.
    - `split`: today's behaviour on `available`: `remaining = max(available-requested,0)`, `unpaid = over`, `blocked false`.
    - `none`: `remaining 0, unpaid 0, over 0, blocked false`.
  - `getMyBalance(leaveTypeId)` returns `{ ok: true; balanceMinutes: number|null; pendingMinutes: number; rule: BalanceRule }` (calls the RPC).
  - `useLeaveBalance(leaveTypeId, requestedMinutes)` returns `{ loading: boolean; projection: LeaveBalanceProjection | null }` using the new fields.
  - `OverdraftConfirm({ open, onOpenChange, onConfirm, overLabel, availableLabel, afterLabel }: { open: boolean; onOpenChange: (o: boolean) => void; onConfirm: () => void; overLabel: string; availableLabel: string; afterLabel: string })` — an `AlertDialog` (`components/ui/alert-dialog.tsx`), test ids `overdraft-confirm`, `overdraft-confirm-send`, `overdraft-confirm-back`.

- [ ] **Step 1: Failing unit tests** in `tests/unit/duration.test.ts` (new `describe('projectLeaveBalance rules')`), 8h day = 480 min:
  - strict: `projectLeaveBalance(3*480, 5*480, {pendingMinutes: 3*480, rule:'strict'})` → `{availableMinutes: 960, overMinutes: 480, blocked: true, unpaidMinutes: 0}`; with `2*480` requested → `blocked false, remainingMinutes 0`.
  - overdraft: `(5*480, 2*480, {rule:'overdraft'})` → `{overMinutes: 1440, remainingMinutes: -1440, unpaidMinutes: 0, blocked: false}`; with pending 480 → `remainingMinutes -1920`.
  - split: `(5*480, 2*480)` (no opts) → `{unpaidMinutes: 1440, remainingMinutes: 0, blocked: false}` (old behaviour).
  - strict with negative balance: `(480, -480, {rule:'strict'})` → `availableMinutes -480, overMinutes 480, blocked true`.
  - none: `(480, 0, {rule:'none'})` → all zero, not blocked.
- [ ] **Step 2: Run** `npx vitest run tests/unit/duration.test.ts` — FAIL.
- [ ] **Step 3: Implement** `projectLeaveBalance`/types; update `getMyBalance` and `useLeaveBalance`. Run — PASS.
- [ ] **Step 4: Preview UI** (`LeaveBalancePreview`). Keep existing test ids. Add: an "Available" line (`{testIds.balance}-available` → use `leave-available` / `hourly-available`) when `pendingMinutes > 0`, showing available and a muted "{value} in pending requests". By rule:
  - `strict` + `blocked`: red line (`text-destructive`, test id `leave-over` / `hourly-over`) with `strictOver`.
  - `overdraft` + `overMinutes > 0`: amber line (`text-amber-700`, same test ids) with `overdraftNote`; remaining shows the negative value.
  - `split`: unchanged unpaid line.
  New `useTranslations('leaveBalance')` keys (en / fa):
  - `available`: "Available" / "قابل استفاده"
  - `pendingNote`: "{value} in pending requests" / "{value} در درخواست‌های در انتظار"
  - `strictOver`: "This is {over} more than your available balance. Request at most {available}, and file the rest as unpaid leave." / "این درخواست {over} بیشتر از مانده قابل استفاده شماست. حداکثر {available} درخواست دهید و بقیه را به صورت مرخصی بدون حقوق ثبت کنید."
  - `overdraftNote`: "{over} more than your available balance. Your balance will go to {after}." / "{over} بیشتر از مانده قابل استفاده. مانده شما به {after} می‌رسد."
  - `confirmTitle`: "Request more than your balance?" / "درخواست بیش از مانده؟"
  - `confirmBody`: "You are requesting {over} more than your available balance ({available}). Your balance will go to {after}. Monthly accruals will cover it; if it is still negative at year end, HR may convert it to unpaid leave." / "شما {over} بیشتر از مانده قابل استفاده خود ({available}) درخواست می‌کنید. مانده شما به {after} می‌رسد. افزایش ماهانه مرخصی آن را جبران می‌کند؛ اگر تا پایان سال منفی بماند، منابع انسانی ممکن است آن را به مرخصی بدون حقوق تبدیل کند."
  - `confirmSend`: "Send request" / "ارسال درخواست" · `confirmBack`: "Go back" / "بازگشت"
- [ ] **Step 5: Submit flow** in both forms: if `projection?.blocked` → the submit button is disabled and `submit` is not called. If `projection?.rule === 'overdraft' && projection.overMinutes > 0` → clicking submit opens `OverdraftConfirm`; `onConfirm` runs the existing `submit(...)` call unchanged. Otherwise unchanged.
- [ ] **Step 6: Component test** `tests/unit/overdraft-confirm.test.tsx` (pattern: `tests/unit/request-cancel-button.test.tsx` for next-intl setup): renders with `open`, shows the three labels in the body, `overdraft-confirm-send` calls `onConfirm`, `overdraft-confirm-back` calls `onOpenChange(false)` and not `onConfirm`.
- [ ] **Step 7: Checks + commit.** `feat(request): pending-aware balance, strict block and manager overdraft confirm (FR-92)`.

---

### Task 5: Approve dialog — full request summary for every approver

**Files:**
- Create: `lib/leave/approvalSummary.ts`
- Create: `app/[locale]/(app)/manage/approvals/RequestSummary.tsx`
- Modify: `lib/leave/approval-context.ts` (`ApprovalContextRow`), `lib/actions/leave/approvals.ts` (`PendingApproval` + mapper ~l.222-280)
- Modify: `app/[locale]/(app)/manage/approvals/DecisionDialogs.tsx` (`ApproveDialog`), `ApprovalQueue.tsx` (~l.264), `app/[locale]/(app)/home/PendingApprovalsCard.tsx`, `app/[locale]/(app)/home/page.tsx` (~l.241-248)
- Modify: `messages/fa.json`, `messages/en.json`
- Test: create `tests/unit/approval-summary.test.ts`, `tests/unit/request-summary.test.tsx`

**Interfaces:**
- Consumes: context keys `balance_minutes: number|null`, `pending_other_minutes: number`, `balance_rule: BalanceRule` (Task 1); `BalanceRule` from `lib/leave/duration.ts` (Task 4).
- Produces:
  - `ApprovalContextRow` gains `balance_minutes: number | null; pending_other_minutes: number; balance_rule: BalanceRule`.
  - `PendingApproval` gains `unpaid_minutes: number; balance_minutes: number|null; pending_other_minutes: number; balance_rule: BalanceRule` and, if not already there, the display fields the summary needs (`employee_name`, `leave_type_name_fa/en`, `start_date`, `end_date`, `start_time`, `end_time`, `day_part`, `reason`, `replacement_name`, `errand_location`) — copy from the row in the mapper.
  - `export type BalanceFigures = { balanceMinutes: number; otherPendingMinutes: number; availableMinutes: number; requestedMinutes: number; afterMinutes: number; unpaidMinutes: number; overdraftMinutes: number }`
  - `export function balanceFigures(row: Pick<PendingApproval,'requested_minutes'|'balance_minutes'|'pending_other_minutes'|'balance_rule'>): BalanceFigures | null` — null when `balance_rule === 'none'` or `balance_minutes === null`. `available = balance - otherPending`. At approval the ledger uses the **balance** (not available): `overdraft` → `after = balance - requested`, `unpaid 0`, `overdraftMinutes = max(requested - max(balance,0), 0)`; `strict`/`split` → `paid = min(requested, max(balance,0))`, `after = balance - paid`, `unpaid = requested - paid`, `overdraftMinutes 0`.
  - `RequestSummary({ request, hoursPerDay, locale }: { request: PendingApproval; hoursPerDay: number; locale: string })` — client component, test id `approve-summary-${request.id}`.
  - `ApproveDialog` gains optional prop `summary?: React.ReactNode`, rendered at the top of the dialog body, above `SigningAs`, for override and normal approval alike.

- [ ] **Step 1: Failing tests** `tests/unit/approval-summary.test.ts` (480 min/day):
  - overdraft: requested 2400, balance 960, otherPending 0 → `after -1440, overdraftMinutes 1440, unpaid 0`.
  - strict (balance dropped): requested 1440, balance 480 → `after 0, unpaid 960`.
  - split: same numbers → same as strict.
  - otherPending shown: balance 2400, otherPending 1440 → `availableMinutes 960`, `after` = 2400 − requested (pending ignored for `after`).
  - none → `null`; `balance_minutes null` → `null`.
- [ ] **Step 2: Run — FAIL. Step 3: Implement `balanceFigures`. Run — PASS.**
- [ ] **Step 4: `RequestSummary`.** A `<dl>` grid (2 columns ≥ sm, 1 on phone; Blueprint: border, `bg-muted/40`, no shadow). Rows, each only when it has a value: requester; type (leave type name by locale, or the errand/trip badge for `kind='errand'`); dates (Jalali via the existing date formatter used in `ApprovalQueue`), times for `unit='hour'`, day part for half days; duration (`formatDuration`); location (errands); reason; replacement. Then, when `balanceFigures` is non-null, a second block: balance now, other pending (only if > 0), available, requested, balance after approval. Overdraft → amber line `overdraft`; unpaid > 0 → red line `unpaid`. Negative values in `<bdi>`. Keys `approvals.summary.*` (en / fa): `requester` "Requester"/"درخواست‌دهنده" · `type` "Type"/"نوع" · `dates` "Dates"/"تاریخ" · `time` "Time"/"ساعت" · `duration` "Duration"/"مدت" · `location` "Location"/"محل" · `reason` "Reason"/"دلیل" · `replacement` "Replacement"/"جانشین" · `balanceNow` "Balance now"/"مانده فعلی" · `otherPending` "Other pending requests"/"سایر درخواست‌های در انتظار" · `available` "Available"/"قابل استفاده" · `requested` "Requested"/"درخواستی" · `after` "Balance after approval"/"مانده پس از تأیید" · `overdraft` "{value} over the balance. The balance will go negative." / "{value} بیش از مانده. مانده منفی می‌شود." · `unpaid` "{value} will be recorded as unpaid." / "{value} بدون حقوق ثبت می‌شود."
- [ ] **Step 5: Wire it.** `ApprovalQueue` and the Home approvals card pass `summary={<RequestSummary request={req} hoursPerDay={hoursPerDay} locale={locale} />}`. Trips keep per diem + travel booking below the summary.
- [ ] **Step 6: Component test** `tests/unit/request-summary.test.tsx`: an overdraft leave row renders `approve-summary-<id>` containing the requester name, "Balance after approval" and a value with a minus sign; an errand row renders location and no balance block.
- [ ] **Step 7: Checks + commit.** `feat(approvals): full request summary with balance figures in the approve dialog (FR-92)`.

---

### Task 6: Employees page — Balance / Used / Unpaid columns, tighter padding, expandable rows

**Files:**
- Create: `lib/actions/leave/totals.ts`
- Create: `lib/employees/columns.ts`
- Modify: `app/[locale]/(app)/manage/employees/page.tsx`, `EmployeesTable.tsx`
- Modify: `messages/fa.json`, `messages/en.json`
- Test: create `tests/unit/employee-columns.test.ts`; extend `tests/unit/employees-table-reset.test.tsx` if it renders the table (keep it passing)

**Interfaces:**
- Consumes: RPC `app_employee_leave_totals(p_ids)` (Task 2).
- Produces:
  - `getEmployeeLeaveTotals(ids: string[]): Promise<{ ok: true; totals: Record<string, { balanceMinutes: number|null; usedMinutes: number; unpaidMinutes: number }> } | DbErrorResult>` — `requireCaller({ perm: ['people','read'] })`.
  - `EmployeeRow` gains `balanceLabel: string; balanceNegative: boolean; usedLabel: string; unpaidLabel: string` (labels pre-formatted with `formatDuration`; `'—'` when balance is null).
  - `lib/employees/columns.ts`: `export type EmpColumn = 'last'|'id'|'hire'|'department'|'roles'|'upcoming'|'balance'|'used'|'unpaid'|'edit'`; `export const COLUMN_SHOW: Record<EmpColumn, string>` = the Tailwind class that makes the cell visible (`hidden @xl:table-cell` …); `export const DETAIL_HIDE: Record<EmpColumn, string>` = the inverse class for the same column's entry in the expanded panel (`@xl:hidden` …); `export const EXPAND_HIDE = '@7xl:hidden'`.

Column order (after Upcoming leave, spec 17): first name · last name · ID · hire date · department · roles · upcoming leave · **balance · used this year · unpaid** · edit.
Visibility (container widths on the table wrapper, which gets `@container`): always: checkbox (if any), first name, expand toggle · `@xl` (36rem): last name, upcoming, edit · `@2xl`: balance · `@3xl`: ID · `@4xl`: department · `@5xl`: roles · `@6xl`: hire date · `@7xl`: used, unpaid. The toggle and expanded panel disappear at `@7xl`. Below `@xl` the first-name cell also shows the last name (`<span className="@xl:hidden">`), so phones see the full name.

- [ ] **Step 1: Failing test** `tests/unit/employee-columns.test.ts`: every `EmpColumn` has a `COLUMN_SHOW` and a `DETAIL_HIDE` entry; for each column the breakpoint token in both is the same (e.g. `@3xl`), `COLUMN_SHOW[c]` starts with `hidden ` and `DETAIL_HIDE[c]` ends with `:hidden`; `balance` uses `@2xl`; `used`/`unpaid` use `@7xl`.
- [ ] **Step 2: Run — FAIL. Step 3: Implement `columns.ts`. Run — PASS.**
- [ ] **Step 4: Server data.** `getEmployeeLeaveTotals`; in `page.tsx` call it with the page's ids alongside the existing queries and fill the new `EmployeeRow` fields (hours per day from the same source `page.tsx` already uses for durations, else `work_settings`).
- [ ] **Step 5: Table.** Remove `overflow-x-auto`; wrapper gets `@container`. All `px-4` in this table's `th`/`td` (including `TH` and `th` consts) → `px-3`. Apply `COLUMN_SHOW` to each column's `th` and `td`. New `th` labels from `manage.employees`: `balance` "Balance"/"مانده" · `usedThisYear` "Used this year"/"استفاده‌شده امسال" · `unpaid` "Unpaid"/"بدون حقوق". Balance cell: `text-destructive` when `balanceNegative`, value in `<bdi>`. Expand toggle: a ghost icon button (`ChevronDown`, rotates when open; `aria-expanded`; `aria-label` `showDetails` "Show details"/"نمایش جزئیات" / `hideDetails` "Hide details"/"بستن جزئیات"; test id `emp-expand-${employee_code}`) inside the first-name cell, with `EXPAND_HIDE`. Open state per row in component state (a `Set<string>`). When open, render a second `<tr>` (test id `emp-details-${employee_code}`, `EXPAND_HIDE`) with one `td colSpan={colCount}` holding a `<dl>` of every non-always column, each `dt/dd` pair carrying `DETAIL_HIDE[col]` so only columns hidden at the current width appear, plus, under `@xl` only (`@xl:hidden`), a full-width outline **Edit** button linking to `/${locale}/manage/employees/${id}` (test id `emp-details-edit-${employee_code}`). Keep `data-table` class, sorting, bulk-select and the existing `a:has-text("Edit")` link.
- [ ] **Step 6: Visual check.** Temporary page per CLAUDE.md gotcha (`app/[locale]/zz-emp/page.tsx` rendering `EmployeesTable` with 3 fake rows, one negative). In the browser pane at 375px, 768px, 1280px and 1600px: no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), expanding a row shows exactly the hidden columns, phone shows the Edit button. Delete the page and `rm -rf .next/dev/types`. Screenshots go in the task report (not the repo).
- [ ] **Step 7: Checks + commit.** `feat(employees): balance, used and unpaid columns with expandable rows (FR-92)`.

---

### Task 7: Convert negatives — Employees button, partial convert, pending warning on balance edits

**Files:**
- Create: `lib/actions/leave/unpaidConversions.ts`
- Create: `app/[locale]/(app)/manage/employees/ConvertNegativesDialog.tsx`
- Create: `app/[locale]/(app)/manage/employees/[id]/ConvertNegativeForm.tsx`
- Create: `app/[locale]/(app)/manage/employees/[id]/PendingBalanceWarning.tsx`
- Modify: `app/[locale]/(app)/manage/employees/page.tsx` (header button), `[id]/page.tsx`, `[id]/EditEmployeeForm.tsx` (balances section ~l.549-560), `[id]/BalanceQuickAdd.tsx`
- Modify: `messages/fa.json`, `messages/en.json`
- Test: create `tests/unit/convert-negatives-dialog.test.tsx`

**Interfaces:**
- Consumes: RPCs `app_negative_balances`, `app_convert_negatives`, `app_convert_negative`, `app_pending_leave_counts` (Task 2).
- Produces (all `requireCaller` first; edit gates `{ perm: ['leave_balances','edit'] }`, read gate `['leave_balances','read']`; admin passes these):
  - `getNegativeBalances(): Promise<{ ok: true; rows: { employeeId: string; fullName: string; personnelNo: string|null; departmentName: string; balanceMinutes: number }[] } | DbErrorResult>` (department name by caller locale).
  - `convertNegatives(employeeIds: string[]): Promise<{ ok: true; converted: number } | DbErrorResult>` — an empty list returns `{ ok: true, converted: 0 }` without calling the RPC.
  - `convertNegative(employeeId: string, minutes: number, note: string): Promise<{ ok: true; minutes: number } | DbErrorResult>` — integer minutes > 0 checked before the RPC.
  - `getPendingLeaveCounts(employeeId: string): Promise<{ ok: true; counts: Record<string, { count: number; minutes: number }> } | DbErrorResult>` keyed by leave type id.
  - All three writers call `revalidatePath` for the employees list and the employee page (follow `addLeaveBalance`).

- [ ] **Step 1: Failing component test** `tests/unit/convert-negatives-dialog.test.tsx` (mock the actions module with `vi.mock`): opening loads rows; "Select all" ticks all; unticking one then Convert shows a confirm with count 2 and the summed total; confirming calls `convertNegatives` with exactly the two ids; an empty list shows `empty`.
- [ ] **Step 2: Run — FAIL. Step 3: Implement actions + `ConvertNegativesDialog`. Run — PASS.**
  Dialog (`Dialog` from `components/ui/dialog.tsx`, trigger is an outline button in the page header next to the existing buttons, test id `convert-negatives-open`, shown when the caller has `leave_balances` edit or is admin): loads on open; table (`data-table`) with checkbox, name, personnel no, department, balance (red, `<bdi>`); "Select all" checkbox in the header; Convert button disabled with nothing selected; confirm step (`AlertDialog`) with count and total; on success toast/inline message `done` and `router.refresh()`. Keys `manage.employees.convert.*` (en / fa): `open` "Convert negatives to unpaid"/"تبدیل مانده منفی به بدون حقوق" · `title` same as open · `hint` "Turns the selected people's negative annual balance into unpaid leave and sets their balance to 0." / "مانده منفی مرخصی استحقاقی افراد انتخاب‌شده را به مرخصی بدون حقوق تبدیل و مانده آن‌ها را صفر می‌کند." · `empty` "No one has a negative balance." / "مانده هیچ‌کس منفی نیست." · `selectAll` "Select all"/"انتخاب همه" · `convert` "Convert"/"تبدیل" · `confirm` "Convert {count} people, {total} in total, to unpaid leave? Their balances go back to 0." / "مانده منفی {count} نفر، در مجموع {total}، به مرخصی بدون حقوق تبدیل شود؟ مانده آن‌ها صفر می‌شود." · `done` "{count} people converted." / "مانده {count} نفر تبدیل شد."
- [ ] **Step 4: Partial convert** `ConvertNegativeForm({ employeeId, balanceMinutes, hoursPerDay })` on the edit page's balance section, shown only for the annual type when `balanceMinutes < 0` and the caller can edit balances. `DaysHoursField` for the amount (max = −balance), optional note (≤ 500), Convert button → `convertNegative`; DB errors shown via `FormFeedback`. Keys `manage.employees.convertOne.*`: `title` "Convert negative balance to unpaid"/"تبدیل مانده منفی به بدون حقوق" · `amount` "Amount"/"مقدار" · `note` "Note (optional)"/"یادداشت (اختیاری)" · `submit` "Convert"/"تبدیل" · `done` "Converted to unpaid."/"به بدون حقوق تبدیل شد." The edit page needs the annual type id: pick the balance item whose type has `manager_overdraft` (extend `getEmployeeBalances`' `BalanceItem` with `managerOverdraft: boolean` — update `lib/leave/balances.ts` type and its constructors/tests).
- [ ] **Step 5: Pending warning** `PendingBalanceWarning({ count, typeName }: { count: number; typeName: string })` — amber note (`text-amber-700`, border, no shadow), test id `pending-balance-warning`; renders nothing when `count === 0`. Shown (spec 10, non-blocking) above the inputs of: each balance row in the balances `<details>` section of `EditEmployeeForm`, the `BalanceQuickAdd` form for the selected type, and `ConvertNegativeForm`. Data from `getPendingLeaveCounts` loaded in `[id]/page.tsx` next to `getEmployeeBalances` (only when the caller can manage leave). Key `manage.employees.pendingWarning`: en "This person has {count, plural, one {# pending {type} request} other {# pending {type} requests}}. Approval will use the balance you set here." · fa "این شخص {count} درخواست {type} در انتظار دارد. تأیید آن با مانده‌ای که اینجا ثبت می‌کنید انجام می‌شود."
- [ ] **Step 6: Checks + commit.** `feat(employees): convert negative balances to unpaid, pending-request warning (FR-92)`.

---

### Task 8: Reports — Payroll section

**Files:**
- Create: `lib/reports/payroll.ts`, `lib/actions/payroll.ts`
- Create: `app/[locale]/(app)/manage/reports/PayrollSection.tsx`
- Modify: `app/[locale]/(app)/manage/reports/page.tsx` (load + render below the dashboard)
- Modify: `messages/fa.json`, `messages/en.json`
- Test: create `tests/unit/payroll-report.test.ts`

**Interfaces:**
- Consumes: RPCs `app_payroll_unpaid(p_from, p_to)` and `app_employee_leave_totals(p_ids)` (Task 2); `downloadCsv`, `fileDateStamp` (`lib/csv/download.ts`); `ReportTable`, `tableToCsvRows` (`lib/reports/reports.ts`).
- Produces:
  - `export type PayrollSource = 'unpaid_type' | 'unpaid_part' | 'conversion'`
  - `export type PayrollItem = { employeeId: string; fullName: string; personnelNo: string|null; department: string; source: PayrollSource; ref: string|null; onDate: string; leaveType: string; unpaidMinutes: number }`
  - `export type PayrollPerson = { employeeId: string; fullName: string; personnelNo: string|null; department: string; unpaidMinutes: number; balanceMinutes: number|null; items: PayrollItem[] }`
  - `export function groupPayroll(items: PayrollItem[], balances: Record<string, number|null>): PayrollPerson[]` — one entry per employee (order of first appearance), `unpaidMinutes` summed, items in input order.
  - `export function payrollCsv(people: PayrollPerson[], labels: { columns: string[]; source: Record<PayrollSource,string> }, minutesPerDay: number): ReportTable` — one CSV row per item: name, personnel no, department, source label, ref, Jalali date (already formatted in `onDate`), leave type, unpaid days (decimal via `minutesToDecimalDays`), current balance days.
  - `getPayrollReport(from: string, to: string): Promise<{ ok: true; people: PayrollPerson[] } | DbErrorResult>` — `requireCaller({ perm: ['reports','read'] })`; dates formatted to Jalali for display; department/leave type names by caller locale.
  - `PayrollSection({ people, hoursPerDay, locale, rangeLabel }: {...})` — client component, test id `payroll-section`.

- [ ] **Step 1: Failing tests** `tests/unit/payroll-report.test.ts`: `groupPayroll` merges two items of one person (sum minutes, keeps both items) and keeps people in first-seen order; a person without a balance entry gets `balanceMinutes null`; `payrollCsv` returns one row per item with the header from `labels.columns`, decimal days for 720 min at 480/day = `1.5`, and the source label mapped.
- [ ] **Step 2: Run — FAIL. Step 3: Implement. Run — PASS.**
- [ ] **Step 4: Section UI.** Rendered on the Reports page below the existing dashboard, using the page's existing from/to range (same `searchParams`). A heading, a muted hint, an "Export CSV" button (`payroll-export`, file `${fileDateStamp()}-payroll.csv`), and a `data-table` with one row per person: name, personnel no, department, unpaid total, current balance (red + `<bdi>` when negative); each row expandable (same chevron pattern as Task 6, no container queries needed) to list its items (date, source, ref, type, amount). Empty → `empty`. Keys `payroll.*` (en / fa): `title` "Payroll: unpaid leave"/"حقوق و دستمزد: مرخصی بدون حقوق" · `hint` "For HR to pass to payroll. Covers {range}."/"برای ارسال منابع انسانی به واحد حقوق و دستمزد. بازه: {range}." · `export` "Export CSV"/"خروجی CSV" · `empty` "No unpaid leave in this period."/"در این بازه مرخصی بدون حقوقی نیست." · `col.name` "Name"/"نام" · `col.personnelNo` "Personnel no."/"شماره پرسنلی" · `col.department` "Department"/"واحد" · `col.unpaid` "Unpaid"/"بدون حقوق" · `col.balance` "Current balance"/"مانده فعلی" · `col.date` "Date"/"تاریخ" · `col.source` "Source"/"منشأ" · `col.ref` "Request no."/"شماره درخواست" · `col.type` "Leave type"/"نوع مرخصی" · `source.unpaid_type` "Unpaid leave request"/"درخواست مرخصی بدون حقوق" · `source.unpaid_part` "Unpaid part of a request"/"بخش بدون حقوق درخواست" · `source.conversion` "Converted from negative balance"/"تبدیل از مانده منفی"
- [ ] **Step 5: Checks + commit.** `feat(reports): payroll unpaid-leave section with CSV (FR-92)`.

---

### Task 9 (lead, not a subagent): Whole-branch verification, docs, PR

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build` — all clean.
- [ ] All three SQL test files + the regression files from Task 1 Step 4 on a fresh `mnb` with the three migrations applied; drop `mnb`.
- [ ] Docs: `docs/REQUIREMENTS.md` (FR-92; amend FR-13, FR-48, FR-91), `docs/DATA_MODEL.md` (paid/unpaid split, negative balances, `manager_overdraft`, `leave_unpaid_conversions`), `docs/PERMISSIONS.md` (new RPC gates, `app_employee_leave_totals` on `people` read), `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/AGENT-LOG.md`, `CLAUDE.md` gotchas (one line each).
- [ ] Commit docs, push branch, open PR to `main`.
