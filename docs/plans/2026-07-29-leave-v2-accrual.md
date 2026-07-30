# Leave v2 Accrual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every employee a per-type leave policy (rate, caps, start month) and post the months they have earned — automatically, idempotently, anchored to Jalali month starts — so a balance stops being a number an admin typed once and becomes one the system maintains.

**Architecture:** The accrual decision is a **pure function** (`lib/leave/accrual.ts`) that takes a policy, the Jalali months, what is already posted, and today, and returns the ledger rows to write. It is exhaustively unit-tested, and `accrue_leave` in SQL mirrors it — the same lockstep discipline `lib/leave/workingDays.ts` already has with `compute_requested_minutes`. Nothing is scheduled: missing months are posted whenever a balance is read, made safe by a partial unique index that makes double-crediting structurally impossible, plus an admin "Post accruals now" button for visibility.

**Tech Stack:** Postgres 15 (`supabase/postgres:15.8.1.085`) · Next.js 16 App Router + TypeScript · Vitest · Playwright.

## Prerequisite

**Plan 1 must be complete** (`docs/plans/2026-07-29-leave-v2-foundations.md`). This plan assumes integer-minute
storage, `work_settings.hours_per_day`, `jalali_months` + `jalali_month_of()`, and `lib/leave/duration.ts`.
Continue on the same branch, `feat/leave-v2-hourly-accrual-replacement`.

## Global Constraints

Inherited from `docs/specs/2026-07-29-hourly-accrual-replacement-design.md` §6 and from plan 1. Every task
inherits these; re-read plan 1's "Environment" section before running anything.

- **Decisions D1, D3, D4, D6, D10, D11 are binding.** Rate and caps are **per employee**, defaulted from the
  leave type. Accrual is **lazy + idempotent** on balance read, plus an admin "Run now". The anchor is the
  **1st of each Jalali month**, with the employee's **hire month pro-rated by calendar days**. Carryover is a
  configurable cap, **default 9 days (4320 minutes)**, and the excess is **forfeited via an audited ledger
  row**, never a silent reset. Opening balances stay HR's to set. Overdraft stays **hard-blocked**.
- **Minutes are the only stored unit.** No fractional days anywhere. Conversion only via `lib/leave/duration.ts`.
- **Idempotency is enforced by the database, not by application care:** a partial unique index on
  (`employee_id`, `leave_type_id`, `entry_type`, `period_month`). Every insert uses `on conflict do nothing`.
- **Every balance read-then-write takes the advisory lock first:**
  `pg_advisory_xact_lock(hashtextextended('leave:' || <employee_id>::text, 0))`.
- **All new functions:** `SECURITY DEFINER`, `set search_path = ''`, fully-qualified names, `anon` revoked.
- **"Today" is `(now() at time zone 'Asia/Tehran')::date`**, never `current_date`.
- **Every migration must be idempotent** — there is no `db reset` here and `deploy/update.sh` replays files.
- **Apply migrations as `supabase_admin`**, never `postgres`.
- **`lib/supabase/types.ts` is hand-edited** (the CLI cannot fetch its image from here). Add new columns,
  tables, and functions by hand; `tsc --noEmit` + `next build` are the gate.
- **Map SQL dependencies with `pg_proc.prosrc`, never by grepping migrations.** This is how plan 1's contract
  migration missed `private.allocate_leave_impl` and broke employee creation.
- **Commit after every task**, on the feature branch, never `main`.

---

## File Structure

```
supabase/migrations/
  20260729130005_leave_policy.sql        NEW  policies table, leave_type defaults, period_month, forfeit enum
  20260729130006_leave_accrual_fns.sql   NEW  accrue_leave + wrappers
lib/leave/
  accrual.ts        NEW  pure planner — the ONLY place accrual rules live in TS; mirrors the SQL
lib/actions/
  leave.ts          MOD  accrual called before every balance read; getEmployeePolicies/setEmployeePolicy
  employees.ts      MOD  policy rows written at employee creation
app/[locale]/(app)/
  manage/employees/new/NewEmployeeForm.tsx      MOD  policy block beside the existing allocation block
  manage/employees/[id]/EditEmployeeForm.tsx    MOD  policy block
  manage/settings/AccrualRunner.tsx             NEW  "Post accruals now" + result summary
  manage/settings/page.tsx                      MOD  mounts AccrualRunner
messages/{fa,en}.json                           MOD  policy + accrual labels
tests/unit/accrual.test.ts                      NEW
tests/e2e/accrual.spec.ts                       NEW
```

**Responsibility boundaries.** `accrual.ts` decides *what rows should exist* and knows nothing about
Postgres, HTTP, or React. `accrue_leave` decides nothing — it reads inputs, applies the same rules, and
writes. Keeping the rules in a pure function is what makes pro-rating, cap clamping, and year-boundary
ordering testable at all; a psql-only implementation would be verified by eyeball.

---

## Task 1: Policy schema

**Files:**
- Create: `supabase/migrations/20260729130005_leave_policy.sql`
- Modify: `lib/supabase/types.ts` (by hand)

**Interfaces:**
- Consumes: `jalali_months` (plan 1), `leave_ledger`, `leave_types`, `profiles`.
- Produces: table `public.employee_leave_policies` (`id` · `employee_id` · `leave_type_id` ·
  `accrual_minutes_per_month int` · `annual_cap_minutes int null` · `carryover_cap_minutes int` ·
  `accrual_start_month date` · `created_by` · `created_at` · `updated_at`), unique
  (`employee_id`,`leave_type_id`); `leave_types.default_accrual_minutes_per_month`,
  `default_annual_cap_minutes`, `default_carryover_cap_minutes`; `leave_ledger.period_month date`;
  enum value `ledger_entry.'carryover_forfeit'`; index `leave_ledger_period_uniq`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729130005_leave_policy.sql`:

```sql
-- =============================================================================
-- Migration: 20260729130005_leave_policy.sql
-- Purpose  : Per-employee leave policy + the bookkeeping monthly accrual needs
--            (spec §6.1). No accrual logic yet — that is …130006.
--
-- Decisions: rate and caps are PER EMPLOYEE, defaulted from the leave type (D1);
--            carryover cap defaults to 9 days = 4320 minutes, which is ماده ۶۶
--            of the Iranian labour code (D6).
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. A forfeited-carryover entry is its own kind, never an admin adjustment.
-- ---------------------------------------------------------------------------
alter type public.ledger_entry add value if not exists 'carryover_forfeit';

-- ---------------------------------------------------------------------------
-- 2. leave_types: company defaults that pre-fill the employee forms.
--    480 = one 8h day. Annual defaults to 1 day/month, 12 days/year — the
--    client's stated policy — but every employee can override it.
-- ---------------------------------------------------------------------------
alter table public.leave_types
  add column if not exists default_accrual_minutes_per_month int,
  add column if not exists default_annual_cap_minutes        int,
  add column if not exists default_carryover_cap_minutes     int not null default 4320;

update public.leave_types
   set default_accrual_minutes_per_month = 480,
       default_annual_cap_minutes        = 5760
 where name_en = 'Annual Leave'
   and default_accrual_minutes_per_month is null;

-- Sick leave is certified, not accrued: rate 0, no cap.
update public.leave_types
   set default_accrual_minutes_per_month = 0
 where name_en = 'Sick Leave'
   and default_accrual_minutes_per_month is null;

-- ---------------------------------------------------------------------------
-- 3. leave_ledger.period_month — which month an accrual or forfeiture belongs
--    to. NULL for every other entry type (opening allocations, consumption,
--    reversals, admin adjustments).
--
--    The partial unique index below is the whole idempotency guarantee: posting
--    the same month twice is not "unlikely", it is impossible.
-- ---------------------------------------------------------------------------
alter table public.leave_ledger
  add column if not exists period_month date;

create unique index if not exists leave_ledger_period_uniq
  on public.leave_ledger (employee_id, leave_type_id, entry_type, period_month)
  where period_month is not null;

-- Reports must read period_month, never created_at: a lazily-posted row is
-- created whenever someone happens to open a page, months after it accrued.
create index if not exists leave_ledger_period_month_idx
  on public.leave_ledger (employee_id, leave_type_id, period_month)
  where period_month is not null;

-- ---------------------------------------------------------------------------
-- 4. employee_leave_policies
-- ---------------------------------------------------------------------------
create table if not exists public.employee_leave_policies (
  id                        uuid        primary key default gen_random_uuid(),
  employee_id               uuid        not null references public.profiles(id)    on delete cascade,
  leave_type_id             uuid        not null references public.leave_types(id) on delete restrict,
  accrual_minutes_per_month int         not null default 0,
  annual_cap_minutes        int,
  carryover_cap_minutes     int         not null default 4320,
  -- Always the gregorian_start of a jalali_months row; validated in the setter.
  accrual_start_month       date        not null,
  created_by                uuid        references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint employee_leave_policies_rate_sane
    check (accrual_minutes_per_month >= 0 and accrual_minutes_per_month <= 100000),
  constraint employee_leave_policies_caps_sane
    check ((annual_cap_minutes is null or annual_cap_minutes >= 0) and carryover_cap_minutes >= 0),
  constraint employee_leave_policies_uniq
    unique (employee_id, leave_type_id)
);

create index if not exists employee_leave_policies_employee_idx
  on public.employee_leave_policies (employee_id);

create trigger employee_leave_policies_set_updated_at
  before update on public.employee_leave_policies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. RLS — mirrors leave_allocations: readable by the employee, their manager,
--    security and admin. NO client write policies; writes go through the
--    definer setter in …130006.
-- ---------------------------------------------------------------------------
alter table public.employee_leave_policies enable row level security;

drop policy if exists "employee_leave_policies_select" on public.employee_leave_policies;
create policy "employee_leave_policies_select"
  on public.employee_leave_policies for select to authenticated
  using (
    employee_id = auth.uid()
    or private.is_manager_of(auth.uid(), employee_id)
    or private.can_read_all(auth.uid())
  );
```

**On `create trigger` here:** plain `create trigger` is not idempotent, but this whole block is guarded by
`create table if not exists` only for the table. Use `create or replace trigger` (PG14+) instead — change the
statement above to `create or replace trigger` before applying.

- [ ] **Step 2: Apply it**

```bash
PW=$(docker inspect bj-erp-db-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POSTGRES_PASSWORD=' | cut -d= -f2-)
docker exec -i -e PGPASSWORD="$PW" bj-erp-db-1 psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  -f - < supabase/migrations/20260729130005_leave_policy.sql
```
Expected: no `ERROR`. Replay it; expected: still no error, and `UPDATE 0` on the seed updates.

- [ ] **Step 3: Verify the shape and the index that matters**

```bash
docker exec -e PGPASSWORD="$PW" bj-erp-db-1 psql -U supabase_admin -d postgres -c \
  "select unnest(enum_range(null::public.ledger_entry)) as ledger_entry_values;"
```
Expected: includes `carryover_forfeit`.

Prove the idempotency index actually rejects a duplicate (rolled back, so no junk):

```sql
begin;
insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, period_month, note)
select employee_id, leave_type_id, 'allocation', 480, 480, '2026-07-23', 'idx probe' from public.leave_ledger limit 1;
insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, period_month, note)
select employee_id, leave_type_id, 'allocation', 480, 960, '2026-07-23', 'idx probe 2' from public.leave_ledger limit 1;
rollback;
```
Expected: the **second insert fails** with `duplicate key value violates unique constraint "leave_ledger_period_uniq"`. If it succeeds, the index is wrong and everything downstream is unsafe — stop and fix it.

- [ ] **Step 4: Hand-edit `lib/supabase/types.ts`**

Add `employee_leave_policies` (alphabetically, after `departments`), the three `leave_types.default_*`
columns, `leave_ledger.period_month: string | null`, and `carryover_forfeit` to the `ledger_entry` enum union.

Verify: `npx --no-install tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729130005_leave_policy.sql lib/supabase/types.ts
git commit -m "feat(leave): per-employee accrual policy schema

Adds employee_leave_policies (rate, annual cap, carryover cap, accrual start
month) with the leave-type defaults that pre-fill it, plus
leave_ledger.period_month and the partial unique index on
(employee, type, entry_type, period_month).

That index is the whole idempotency guarantee for lazy accrual: posting a month
twice is impossible, not merely unlikely. Verified by a rolled-back probe that
the second insert for the same month is rejected.

carryover_forfeit becomes its own ledger_entry value so a forfeiture is never
confused with an admin adjustment. Sick leave defaults to a zero rate, since
sick leave in Iran is certified rather than accrued."
```

---

## Task 2: The pure accrual planner

**Files:**
- Create: `lib/leave/accrual.ts`
- Create: `tests/unit/accrual.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:

```ts
export type AccrualPolicy = {
  accrualMinutesPerMonth: number;
  annualCapMinutes: number | null;
  carryoverCapMinutes: number;
  accrualStartMonth: string;           // YYYY-MM-DD, a jalali month start
};
export type JalaliMonth = {
  jalaliYear: number;
  jalaliMonth: number;
  gregorianStart: string;
  gregorianEnd: string;
};
export type PostedEntry = {
  periodMonth: string;
  entryType: 'allocation' | 'carryover_forfeit';
  deltaMinutes: number;
};
export type PlannedEntry = {
  periodMonth: string;
  entryType: 'allocation' | 'carryover_forfeit';
  deltaMinutes: number;                // signed: + accrual, − forfeiture
  balanceAfterMinutes: number;
};
export function planAccruals(input: {
  policy: AccrualPolicy;
  months: JalaliMonth[];               // ascending, covering start..today
  posted: PostedEntry[];
  hireDate: string | null;
  today: string;
  openingBalanceMinutes: number;
}): PlannedEntry[];
```

**The rules, in the order they must be applied per month:**

1. Skip months already posted (matched on `periodMonth` + `entryType`).
2. Skip months that end before `hireDate` — nobody accrues before they were hired.
3. At a Jalali **year boundary** (`jalaliMonth === 1`) *and* only when some earlier accrual exists, clamp the
   carried balance to `carryoverCapMinutes` and emit a `carryover_forfeit` for the excess **before** that
   month's accrual. The "earlier accrual exists" guard stops the clamp firing for an employee whose very
   first accrual month happens to be Farvardin.
4. Pro-rate the month containing `hireDate` by **calendar** days remaining:
   `round(rate × daysFromHire / daysInMonth)`.
5. Clamp so that accruals **within that Jalali year** never exceed `annualCapMinutes`. The cap counts
   accrual rows only — an opening allocation has no `periodMonth` and must not consume the year's cap.
6. Emit nothing for a month whose amount computes to 0.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/accrual.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planAccruals } from '@/lib/leave/accrual';
import type { AccrualPolicy, JalaliMonth } from '@/lib/leave/accrual';

// Four real Jalali months of 1405 (generated by plan 1's jalali_months table).
const MONTHS: JalaliMonth[] = [
  { jalaliYear: 1404, jalaliMonth: 12, gregorianStart: '2026-02-20', gregorianEnd: '2026-03-20' },
  { jalaliYear: 1405, jalaliMonth: 1, gregorianStart: '2026-03-21', gregorianEnd: '2026-04-20' },
  { jalaliYear: 1405, jalaliMonth: 2, gregorianStart: '2026-04-21', gregorianEnd: '2026-05-21' },
  { jalaliYear: 1405, jalaliMonth: 3, gregorianStart: '2026-05-22', gregorianEnd: '2026-06-21' },
];

const POLICY: AccrualPolicy = {
  accrualMinutesPerMonth: 480, // 1 day at 8h
  annualCapMinutes: 5760,      // 12 days
  carryoverCapMinutes: 4320,   // 9 days
  accrualStartMonth: '2026-03-21',
};

const base = {
  policy: POLICY,
  months: MONTHS,
  posted: [],
  hireDate: null,
  today: '2026-06-01',
  openingBalanceMinutes: 0,
};

describe('planAccruals', () => {
  it('posts one row per due month, with a running balance', () => {
    const rows = planAccruals(base);
    expect(rows.map((r) => r.periodMonth)).toEqual(['2026-03-21', '2026-04-21', '2026-05-22']);
    expect(rows.map((r) => r.deltaMinutes)).toEqual([480, 480, 480]);
    expect(rows.map((r) => r.balanceAfterMinutes)).toEqual([480, 960, 1440]);
    expect(rows.every((r) => r.entryType === 'allocation')).toBe(true);
  });

  it('starts from the opening balance', () => {
    const rows = planAccruals({ ...base, openingBalanceMinutes: 2400 });
    expect(rows[0].balanceAfterMinutes).toBe(2880);
  });

  it('is idempotent: already-posted months are skipped', () => {
    const rows = planAccruals({
      ...base,
      posted: [
        { periodMonth: '2026-03-21', entryType: 'allocation', deltaMinutes: 480 },
        { periodMonth: '2026-04-21', entryType: 'allocation', deltaMinutes: 480 },
      ],
      openingBalanceMinutes: 960,
    });
    expect(rows.map((r) => r.periodMonth)).toEqual(['2026-05-22']);
    expect(rows[0].balanceAfterMinutes).toBe(1440);
  });

  it('posts nothing when everything is already posted', () => {
    const posted = MONTHS.slice(1, 4).map((m) => ({
      periodMonth: m.gregorianStart,
      entryType: 'allocation' as const,
      deltaMinutes: 480,
    }));
    expect(planAccruals({ ...base, posted, openingBalanceMinutes: 1440 })).toEqual([]);
  });

  it('does not post months beyond today', () => {
    const rows = planAccruals({ ...base, today: '2026-04-25' });
    expect(rows.map((r) => r.periodMonth)).toEqual(['2026-03-21', '2026-04-21']);
  });

  it('skips months that ended before the hire date', () => {
    const rows = planAccruals({ ...base, hireDate: '2026-04-21' });
    expect(rows.map((r) => r.periodMonth)).toEqual(['2026-04-21', '2026-05-22']);
  });

  it('pro-rates the hire month by calendar days', () => {
    // Hired 2026-05-07, inside 1405-02 (2026-04-21..2026-05-21, 31 days).
    // Days from hire through month end = 15. round(480 * 15 / 31) = 232.
    const rows = planAccruals({ ...base, hireDate: '2026-05-07' });
    expect(rows[0].periodMonth).toBe('2026-04-21');
    expect(rows[0].deltaMinutes).toBe(232);
    expect(rows[1].deltaMinutes).toBe(480);
  });

  it('clamps accruals to the annual cap within a Jalali year', () => {
    const rows = planAccruals({
      ...base,
      policy: { ...POLICY, annualCapMinutes: 1000 },
    });
    expect(rows.map((r) => r.deltaMinutes)).toEqual([480, 480, 40]);
    expect(rows[2].balanceAfterMinutes).toBe(1000);
  });

  it('counts already-posted accruals against the annual cap', () => {
    const rows = planAccruals({
      ...base,
      policy: { ...POLICY, annualCapMinutes: 1000 },
      posted: [{ periodMonth: '2026-03-21', entryType: 'allocation', deltaMinutes: 480 }],
      openingBalanceMinutes: 480,
    });
    expect(rows.map((r) => r.deltaMinutes)).toEqual([480, 40]);
  });

  it('ignores the annual cap when it is null', () => {
    const rows = planAccruals({ ...base, policy: { ...POLICY, annualCapMinutes: null } });
    expect(rows.map((r) => r.deltaMinutes)).toEqual([480, 480, 480]);
  });

  it('forfeits the excess above the carryover cap at Farvardin 1', () => {
    // Accrual started the previous year, so a year boundary is crossed with a
    // balance of 6000 minutes against a 4320 cap: forfeit 1680 first.
    const rows = planAccruals({
      ...base,
      policy: { ...POLICY, accrualStartMonth: '2026-02-20' },
      posted: [{ periodMonth: '2026-02-20', entryType: 'allocation', deltaMinutes: 480 }],
      openingBalanceMinutes: 6000,
      today: '2026-04-01',
    });
    expect(rows[0]).toMatchObject({
      periodMonth: '2026-03-21',
      entryType: 'carryover_forfeit',
      deltaMinutes: -1680,
      balanceAfterMinutes: 4320,
    });
    expect(rows[1]).toMatchObject({
      periodMonth: '2026-03-21',
      entryType: 'allocation',
      deltaMinutes: 480,
      balanceAfterMinutes: 4800,
    });
  });

  it('does not forfeit when the balance is under the cap', () => {
    const rows = planAccruals({
      ...base,
      policy: { ...POLICY, accrualStartMonth: '2026-02-20' },
      posted: [{ periodMonth: '2026-02-20', entryType: 'allocation', deltaMinutes: 480 }],
      openingBalanceMinutes: 1000,
      today: '2026-04-01',
    });
    expect(rows.every((r) => r.entryType === 'allocation')).toBe(true);
  });

  it('does not forfeit on the very first accrual month, even if it is Farvardin', () => {
    const rows = planAccruals({ ...base, openingBalanceMinutes: 9999, today: '2026-04-01' });
    expect(rows).toHaveLength(1);
    expect(rows[0].entryType).toBe('allocation');
  });

  it('never re-posts a forfeiture that already exists', () => {
    const rows = planAccruals({
      ...base,
      policy: { ...POLICY, accrualStartMonth: '2026-02-20' },
      posted: [
        { periodMonth: '2026-02-20', entryType: 'allocation', deltaMinutes: 480 },
        { periodMonth: '2026-03-21', entryType: 'carryover_forfeit', deltaMinutes: -1680 },
        { periodMonth: '2026-03-21', entryType: 'allocation', deltaMinutes: 480 },
      ],
      openingBalanceMinutes: 4800,
      today: '2026-04-01',
    });
    expect(rows).toEqual([]);
  });

  it('posts nothing when the rate is zero (sick leave)', () => {
    expect(planAccruals({ ...base, policy: { ...POLICY, accrualMinutesPerMonth: 0 } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- accrual`
Expected: FAIL — `Failed to resolve import "@/lib/leave/accrual"`.

- [ ] **Step 3: Write the implementation**

Create `lib/leave/accrual.ts`:

```ts
/**
 * Pure monthly-accrual planner (spec §6.2). Decides which ledger rows *should*
 * exist for an employee/leave-type; writes nothing and knows nothing about
 * Postgres.
 *
 * MUST STAY IN LOCKSTEP with public.accrue_leave in
 * supabase/migrations/20260729130006_leave_accrual_fns.sql — same order of
 * operations, same rounding. The SQL is authoritative at runtime; this is what
 * makes the rules testable.
 */

export type AccrualPolicy = {
  accrualMinutesPerMonth: number;
  annualCapMinutes: number | null;
  carryoverCapMinutes: number;
  /** YYYY-MM-DD — the Gregorian start of a Jalali month. */
  accrualStartMonth: string;
};

export type JalaliMonth = {
  jalaliYear: number;
  jalaliMonth: number;
  gregorianStart: string;
  gregorianEnd: string;
};

export type AccrualEntryType = 'allocation' | 'carryover_forfeit';

export type PostedEntry = {
  periodMonth: string;
  entryType: AccrualEntryType;
  deltaMinutes: number;
};

export type PlannedEntry = {
  periodMonth: string;
  entryType: AccrualEntryType;
  /** Signed: positive for accrual, negative for a forfeiture. */
  deltaMinutes: number;
  balanceAfterMinutes: number;
};

const DAY_MS = 86_400_000;

function days(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
}

export function planAccruals(input: {
  policy: AccrualPolicy;
  months: JalaliMonth[];
  posted: PostedEntry[];
  hireDate: string | null;
  today: string;
  openingBalanceMinutes: number;
}): PlannedEntry[] {
  const { policy, months, posted, hireDate, today, openingBalanceMinutes } = input;

  if (policy.accrualMinutesPerMonth <= 0) return [];

  const isPosted = (periodMonth: string, entryType: AccrualEntryType) =>
    posted.some((p) => p.periodMonth === periodMonth && p.entryType === entryType);

  // Accruals already credited, per Jalali year, so the annual cap counts the
  // whole year and not just what this call adds. Keyed by the month's year, which
  // we resolve from `months` — a posted month always has a row there.
  const yearOf = new Map(months.map((m) => [m.gregorianStart, m.jalaliYear]));
  const accruedByYear = new Map<number, number>();
  for (const p of posted) {
    if (p.entryType !== 'allocation') continue;
    const y = yearOf.get(p.periodMonth);
    if (y === undefined) continue;
    accruedByYear.set(y, (accruedByYear.get(y) ?? 0) + p.deltaMinutes);
  }

  const due = months
    .filter((m) => m.gregorianStart >= policy.accrualStartMonth && m.gregorianStart <= today)
    .sort((a, b) => a.gregorianStart.localeCompare(b.gregorianStart));

  const planned: PlannedEntry[] = [];
  let balance = openingBalanceMinutes;

  for (const m of due) {
    // Nobody accrues for a month that ended before they were hired.
    if (hireDate && m.gregorianEnd < hireDate) continue;

    // Year boundary: clamp what was carried in, before crediting this month.
    // The `posted.length` guard keeps a brand-new employee whose first month is
    // Farvardin from being "carried over" into.
    const hasEarlierAccrual =
      posted.some((p) => p.entryType === 'allocation' && p.periodMonth < m.gregorianStart) ||
      planned.some((p) => p.entryType === 'allocation' && p.periodMonth < m.gregorianStart);

    if (
      m.jalaliMonth === 1 &&
      hasEarlierAccrual &&
      !isPosted(m.gregorianStart, 'carryover_forfeit') &&
      balance > policy.carryoverCapMinutes
    ) {
      const excess = balance - policy.carryoverCapMinutes;
      balance -= excess;
      planned.push({
        periodMonth: m.gregorianStart,
        entryType: 'carryover_forfeit',
        deltaMinutes: -excess,
        balanceAfterMinutes: balance,
      });
    }

    if (isPosted(m.gregorianStart, 'allocation')) continue;

    let amount = policy.accrualMinutesPerMonth;

    // Pro-rate the hire month by calendar days remaining in it.
    if (hireDate && hireDate >= m.gregorianStart && hireDate <= m.gregorianEnd) {
      const total = days(m.gregorianStart, m.gregorianEnd) + 1;
      const left = days(hireDate, m.gregorianEnd) + 1;
      amount = Math.round((policy.accrualMinutesPerMonth * left) / total);
    }

    // Annual cap applies to accruals within the Jalali year, not to the balance.
    if (policy.annualCapMinutes !== null) {
      const already = accruedByYear.get(m.jalaliYear) ?? 0;
      amount = Math.min(amount, Math.max(policy.annualCapMinutes - already, 0));
    }

    if (amount <= 0) continue;

    balance += amount;
    accruedByYear.set(m.jalaliYear, (accruedByYear.get(m.jalaliYear) ?? 0) + amount);
    planned.push({
      periodMonth: m.gregorianStart,
      entryType: 'allocation',
      deltaMinutes: amount,
      balanceAfterMinutes: balance,
    });
  }

  return planned;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit -- accrual`
Expected: PASS, 15 tests. If the pro-rating test disagrees, check the arithmetic by hand before changing the
expectation — `round(480 × 15 / 31) = 232`.

- [ ] **Step 5: Commit**

```bash
git add lib/leave/accrual.ts tests/unit/accrual.test.ts
git commit -m "feat(leave): pure monthly-accrual planner

planAccruals decides which ledger rows should exist for an employee and leave
type: due months, hire-month pro-rating by calendar days, the annual cap counted
per Jalali year, and the carryover forfeiture at Farvardin 1 applied before that
month's accrual.

Written as a pure function on purpose. The rules have enough ordering subtlety
-- forfeit before accrue, cap counts accruals not balance, skip pre-hire months,
never forfeit into a brand-new employee's first month -- that verifying them
only through psql would mean verifying them by eyeball. The SQL in the next
commit mirrors this, the same way workingDays.ts mirrors
compute_requested_minutes.

15 tests, including idempotency (already-posted months are skipped) and the
no-op case where everything is posted."
```

---

## Task 3: The SQL accrual engine

**Files:**
- Create: `supabase/migrations/20260729130006_leave_accrual_fns.sql`

**Interfaces:**
- Consumes: Task 1's schema, `jalali_months`, `current_leave_balance`.
- Produces: `public.accrue_leave(p_employee_id uuid, p_leave_type_id uuid) returns int` (internal),
  `public.accrue_my_leave() returns void`, `public.accrue_employee_leave(p_employee_id uuid) returns void`,
  `public.accrue_all_leave() returns jsonb`, and
  `public.set_employee_leave_policy(p_employee_id uuid, p_leave_type_id uuid, p_accrual_minutes_per_month int, p_annual_cap_minutes int, p_carryover_cap_minutes int, p_accrual_start_month date) returns uuid` (admin).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729130006_leave_accrual_fns.sql`. The core function mirrors
`lib/leave/accrual.ts` step for step:

```sql
-- =============================================================================
-- Migration: 20260729130006_leave_accrual_fns.sql
-- Purpose  : Lazy, idempotent monthly accrual (spec §6.2–6.4).
--
-- MIRRORS lib/leave/accrual.ts — same order of operations, same rounding. Keep
-- them in lockstep; the TS side is where the rules are unit-tested.
--
-- Not scheduled by design (D3): the client's VM is LAN-only and can be powered
-- off, so pg_cron would need catch-up logic anyway. Missing months are posted
-- whenever a balance is read, and the partial unique index from …130005 makes
-- double-crediting impossible.
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- accrue_leave — post every month this employee has earned for one leave type.
-- Returns the resulting balance in minutes. Internal: callers are the wrappers
-- below, which are the ones granted to authenticated.
-- ---------------------------------------------------------------------------
create or replace function public.accrue_leave(p_employee_id uuid, p_leave_type_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_rate      int;
  v_cap       int;
  v_carry     int;
  v_start     date;
  v_hire      date;
  v_today     date := (now() at time zone 'Asia/Tehran')::date;
  v_balance   int;
  v_m         record;
  v_amount    int;
  v_already   int;
  v_excess    int;
  v_earlier   boolean;
begin
  select accrual_minutes_per_month, annual_cap_minutes, carryover_cap_minutes, accrual_start_month
    into v_rate, v_cap, v_carry, v_start
    from public.employee_leave_policies
   where employee_id = p_employee_id and leave_type_id = p_leave_type_id;

  -- No policy, or a non-accruing type (sick): nothing to do.
  if v_rate is null or v_rate <= 0 then
    return public.current_leave_balance(p_employee_id, p_leave_type_id);
  end if;

  -- Cheap short-circuit: if the month containing today is already posted, there
  -- is nothing to do and we can skip the lock entirely. This is the hot path —
  -- it runs on every balance read.
  if exists (
    select 1 from public.leave_ledger l
     where l.employee_id = p_employee_id and l.leave_type_id = p_leave_type_id
       and l.entry_type = 'allocation' and l.period_month is not null
       and l.period_month = (select gregorian_start from public.jalali_months
                              where v_today between gregorian_start and gregorian_end)
  ) then
    return public.current_leave_balance(p_employee_id, p_leave_type_id);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  select hire_date into v_hire from public.profiles where id = p_employee_id;
  v_balance := public.current_leave_balance(p_employee_id, p_leave_type_id);

  for v_m in
    select jm.jalali_year, jm.jalali_month, jm.gregorian_start, jm.gregorian_end
      from public.jalali_months jm
     where jm.gregorian_start >= v_start
       and jm.gregorian_start <= v_today
     order by jm.gregorian_start
  loop
    -- Nobody accrues for a month that ended before they were hired.
    if v_hire is not null and v_m.gregorian_end < v_hire then
      continue;
    end if;

    -- Year boundary: clamp the carried balance BEFORE crediting this month.
    if v_m.jalali_month = 1 then
      select exists (
        select 1 from public.leave_ledger
         where employee_id = p_employee_id and leave_type_id = p_leave_type_id
           and entry_type = 'allocation' and period_month is not null
           and period_month < v_m.gregorian_start
      ) into v_earlier;

      if v_earlier and v_balance > v_carry then
        v_excess := v_balance - v_carry;
        insert into public.leave_ledger(employee_id, leave_type_id, entry_type,
                                        delta_minutes, balance_after_minutes, period_month, note)
        values (p_employee_id, p_leave_type_id, 'carryover_forfeit',
                -v_excess, v_carry, v_m.gregorian_start, 'carryover above cap forfeited')
        on conflict do nothing;
        -- Only move the running balance if we actually wrote the row.
        if found then
          v_balance := v_carry;
        end if;
      end if;
    end if;

    v_amount := v_rate;

    -- Pro-rate the hire month by calendar days remaining.
    if v_hire is not null and v_hire between v_m.gregorian_start and v_m.gregorian_end then
      v_amount := round(v_rate::numeric
                        * ((v_m.gregorian_end - v_hire) + 1)
                        / ((v_m.gregorian_end - v_m.gregorian_start) + 1));
    end if;

    -- Annual cap counts ACCRUALS in this Jalali year, not the balance. Opening
    -- allocations have a null period_month and must not consume the cap.
    if v_cap is not null then
      select coalesce(sum(l.delta_minutes), 0) into v_already
        from public.leave_ledger l
        join public.jalali_months jm on jm.gregorian_start = l.period_month
       where l.employee_id = p_employee_id and l.leave_type_id = p_leave_type_id
         and l.entry_type = 'allocation'
         and jm.jalali_year = v_m.jalali_year;
      v_amount := least(v_amount, greatest(v_cap - v_already, 0));
    end if;

    if v_amount > 0 then
      insert into public.leave_ledger(employee_id, leave_type_id, entry_type,
                                      delta_minutes, balance_after_minutes, period_month, note)
      values (p_employee_id, p_leave_type_id, 'allocation',
              v_amount, v_balance + v_amount, v_m.gregorian_start, 'monthly accrual')
      on conflict do nothing;
      if found then
        v_balance := v_balance + v_amount;
      end if;
    end if;
  end loop;

  return v_balance;
end; $$;
```

Then the wrappers and the policy setter (full bodies in the same file):

- `accrue_my_leave()` — loops the caller's own policies, calls `accrue_leave` for each. Granted to
  `authenticated`; scoped to `auth.uid()`, takes no employee argument, so it cannot touch anyone else.
- `accrue_employee_leave(p_employee_id)` — guarded by `private.is_manager_of(auth.uid(), p_employee_id) or private.is_admin(auth.uid())`.
- `accrue_all_leave()` — `private.is_admin` only; loops every active profile with a policy and returns
  `jsonb_build_object('employees', n, 'rows_posted', m)` for the admin UI's result summary.
- `set_employee_leave_policy(...)` — `private.is_admin` only; upserts on (`employee_id`,`leave_type_id`),
  **validates `p_accrual_start_month` against `jalali_months.gregorian_start`** and raises
  `accrual start month must be a jalali month start` otherwise; writes an `audit_log` row.

Grants: `revoke execute on … from public, anon` for all; `grant execute … to authenticated` for the three
wrappers and the setter. `accrue_leave` itself is revoked from `authenticated` — it takes an arbitrary
employee id and must only be reached through a guarded wrapper.

- [ ] **Step 2: Apply and verify against the TS test scenarios**

Apply as in Task 1. Then reproduce three of the unit-test scenarios in SQL against a scratch employee inside
a transaction that is **rolled back**, asserting the same numbers the TS tests assert:

1. Three due months at 480 → rows 480/480/480, balances 480/960/1440.
2. Calling `accrue_leave` twice → the second call posts nothing and returns the same balance.
3. A 1000-minute annual cap → 480/480/40.

```bash
docker exec -i -e PGPASSWORD="$PW" bj-erp-db-1 psql -U supabase_admin -d postgres <<'SQL'
begin;
-- pick any employee + the annual type, give them a policy, accrue, inspect
-- (see the plan's Step 2 notes for the full script)
rollback;
SQL
```

Expected: identical numbers to the unit tests. **If SQL and TS disagree, the lockstep is broken — fix before
continuing**; that divergence is exactly what this step exists to catch.

- [ ] **Step 3: Verify concurrency safety**

Run two `accrue_leave` calls for the same employee in parallel (two `docker exec` psql processes started
together). Expected: one posts the rows, the other posts nothing; no duplicate-key error escapes to the
caller (the `on conflict do nothing` absorbs it), and the final balance is correct — not doubled.

- [ ] **Step 4: Replay the migration** → no errors.

- [ ] **Step 5: Commit.**

---

## Task 4: Call accrual on every balance read

**Files:**
- Modify: `lib/actions/leave.ts` — `getMyBalance`, `getMyBalances`, `getEmployeeBalances`, and the submit path
- Modify: `lib/supabase/types.ts` (the new functions, by hand)

**Interfaces:**
- Consumes: Task 3's wrappers.
- Produces: no signature changes — balances simply become correct on read.

Because accrual **writes**, it must be an RPC called *before* the RLS-protected `leave_ledger` select. It can
never live inside `team_leave_calendar` or any view.

- [ ] **Step 1: Add the call to the three balance readers**

In each of `getMyBalance`, `getMyBalances` (own) and `getEmployeeBalances` (admin), immediately after the
caller context is resolved and before the ledger query:

```ts
  // Accrual is lazy (spec §6.4): post any months this employee has earned before
  // reading the balance, so the number shown is never stale. Idempotent, and a
  // no-op once the current month is posted.
  await supabase.rpc('accrue_my_leave');           // own-balance readers
  // …or, for getEmployeeBalances:
  await supabase.rpc('accrue_employee_leave', { p_employee_id: employeeId });
```

Ignore a returned error rather than failing the read: a stale balance is better than a blank page. Log it —
`if (accrualError) console.error('[accrual]', accrualError.message);` — so it is not silent.

- [ ] **Step 2: Add it to the submit path**

`submitRequest` in `lib/actions/leave.ts` must call `accrue_my_leave` before `submit_leave_request`, so a
worker whose newly-accrued day makes the request affordable is not refused by a stale balance.

- [ ] **Step 3: Verify it self-heals**

Give a scratch employee a policy with `accrual_start_month` three months back, confirm the ledger has no
accrual rows, load their Home board in the browser (or call the action from a test), then re-query: the three
months must now be posted, dated to the months they belong to, not to today.

- [ ] **Step 4: Gates** — `npm run test:unit`, `tsc --noEmit`, `npm run lint`, `npm run build`. Then commit.

---

## Task 5: Admin UI — policy editing and "Post accruals now"

**Files:**
- Modify: `app/[locale]/(app)/manage/employees/new/NewEmployeeForm.tsx` + its `page.tsx`
- Modify: `app/[locale]/(app)/manage/employees/[id]/EditEmployeeForm.tsx` + its `page.tsx`
- Create: `app/[locale]/(app)/manage/settings/AccrualRunner.tsx`
- Modify: `app/[locale]/(app)/manage/settings/page.tsx`
- Modify: `lib/actions/leave.ts` (`setEmployeeLeavePolicy`, `runAllAccruals`, `getEmployeePolicies`)
- Modify: `messages/{fa,en}.json`

**Interfaces:**
- Consumes: `set_employee_leave_policy`, `accrue_all_leave`.
- Produces: `setEmployeeLeavePolicy(input)`, `runAllAccruals()`, `getEmployeePolicies(employeeId)` server actions.

- [ ] **Step 1: Server actions** — follow the existing shape exactly: `getCallerContext()`, admin check,
  `supabase.rpc(...)`, `dbErr(error.message)` on failure, **`invalidateAppCache()` on success** (a mutating
  action that skips it leaves the actor looking at a 5-minute-stale tab — see `docs/MEMORY.md`).

- [ ] **Step 2: Policy block in the employee forms**

Beside the existing allocation block (`data-testid="alloc-section"`), add `data-testid="policy-section"` with,
per balance-affecting leave type: accrual per month (**days** input, converted with `daysToMinutes`), annual
cap (days), carryover cap (days, default 9), and accrual start month. Pre-fill from the leave-type defaults.
Annual expanded, sick collapsed at rate 0.

Keep inputs day-denominated and convert at the boundary, exactly as plan 1 did for allocations — a yearly
entitlement is naturally expressed in days, and holding form state in minutes is what stopped spurious
one-minute adjustment rows there. Add new `data-testid`s; **never rename existing ones** (`docs/MEMORY.md`:
the testid contract).

- [ ] **Step 3: `AccrualRunner`** — a card in Manage → Settings with a button calling `runAllAccruals()`,
  rendering the returned `{ employees, rows_posted }` summary and a toast, following `WorkSettingsForm`'s
  `useTransition` + `sonner` pattern.

- [ ] **Step 4: Labels** in both locales, key trees identical (fa is default; a missing key is a runtime
  formatting error, as the bulk-import `{count}` bug shows).

- [ ] **Step 5: Gates + commit.**

---

## Task 6: E2E, docs, and the deployment note

**Files:**
- Create: `tests/e2e/accrual.spec.ts`
- Modify: `docs/DATA_MODEL.md`, `docs/REQUIREMENTS.md` (FR-27), `docs/CHANGELOG.md`, `docs/TASKS.md`,
  `docs/AGENT-LOG.md`

- [ ] **Step 1: E2E spec** — admin sets a policy with a back-dated start month on a throwaway employee
  (reserved `999#######` personnel range, `nextTestPersonnelNo()`), runs "Post accruals now", and sees the
  employee's balance grow by the expected days-and-hours. Then re-run and assert it does **not** grow again —
  idempotency, proven through the UI.

- [ ] **Step 2: Docs** — `employee_leave_policies` + `period_month` + the accrual algorithm in DATA_MODEL;
  FR-27 marked done in REQUIREMENTS; CHANGELOG entry; TASKS plan-2 box ticked; an AGENT-LOG entry stating
  plainly what was and was not run against the client's server.

- [ ] **Step 3: Full gates** — unit, e2e serial (`--workers=1`), lint, tsc, build. Record the counts.

- [ ] **Step 4: Commit.**

---

## Deployment note

Same discipline as plan 1, and it now matters more: these migrations **write ledger rows**. On the client's
database, the first read after deployment will post every month back to each employee's
`accrual_start_month`. Before deploying:

1. Decide with the client what `accrual_start_month` should be for existing staff. Per D10 the answer is
   almost certainly "the month the upgrade lands", so nobody is retroactively credited a year of leave.
2. The employee-creation forms set it going forward; **existing employees need a one-time backfill** of
   policy rows. Write that as an explicit SQL script, review the row count against the staff list, and run it
   before anyone opens a balance page.
3. Rehearse on a dump, confirm balances move only by the amount you expect, and keep the dump.

## Self-Review

**Spec coverage (§6 only):**

| Spec requirement | Task |
|---|---|
| §6.1 `employee_leave_policies`, leave-type defaults | 1 |
| §6.1 `period_month` + partial unique index | 1 |
| §6.1 `carryover_forfeit` enum value | 1 |
| §6.1 RLS mirroring `leave_allocations`, no client writes | 1 |
| §6.2 due-month list, chronological | 2, 3 |
| §6.2 hire-month pro-rating by calendar days | 2, 3 |
| §6.2 annual cap clamped per Jalali year | 2, 3 |
| §6.2 advisory lock before the balance read | 3 |
| §6.3 carryover forfeiture at Farvardin 1, before that month's accrual | 2, 3 |
| §6.4 three wrappers, own/manager/admin | 3 |
| §6.4 called from every balance read + submit | 4 |
| §6.4 admin "Post accruals now" with a summary | 5 |
| D1 per-employee rate defaulted from the type | 1, 5 |
| D10 opening balance stays HR's; accrual starts from a chosen month | 1, 5, Deployment note |

**Deliberate scope exclusions:** hourly (plan 3), replacement (plan 4), serials (plan 5). Nothing here flips
`leave_types.allow_hourly`.

**Type consistency:** `accrualMinutesPerMonth` / `annualCapMinutes` / `carryoverCapMinutes` /
`accrualStartMonth` are the TS names for `accrual_minutes_per_month` / `annual_cap_minutes` /
`carryover_cap_minutes` / `accrual_start_month`. `PlannedEntry.deltaMinutes` is **signed**. `periodMonth` is
always a month's `gregorianStart`, never an arbitrary date — the unique index depends on that.

**Known risk, flagged not hidden:** `accrue_leave` runs on the balance-read path, so a read can write. The
short-circuit in Task 3 Step 1 keeps the steady-state cost to one indexed `exists` check, but if a page ever
feels slow after this lands, that is the first thing to measure.
