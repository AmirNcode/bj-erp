# Leave v2 Hourly — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a worker request مرخصی ساعتی — a few hours off on one day, capped at 4h — on its own screen mirroring the client's BJ-F 50208 paper form, consuming the same minute-denominated balance as daily leave.

**Architecture:** `leave_requests` gains a `unit` enum plus `start_time`/`end_time`, with CHECK constraints so a malformed row cannot exist even if a function is wrong. The overlap rule becomes time-aware. Validation lives in SQL (a client cannot fabricate a duration), with a pure TS mirror for the live preview and for tests. Two thin public wrappers over one shared internal writer, matching the two paper forms.

**Tech Stack:** Postgres 15 (`supabase/postgres:15.8.1.085`) · Next.js 16 App Router + TypeScript · Vitest · Playwright.

## Prerequisite

**Plans 1 and 2 complete.** This assumes minute storage, `work_settings.hours_per_day`, `jalali_months`,
`lib/leave/duration.ts`, accrual, and `leave_ledger.seq`. Same branch,
`feat/leave-v2-hourly-accrual-replacement`.

## Global Constraints

From `docs/specs/2026-07-29-hourly-accrual-replacement-design.md` §7 plus every constraint in plans 1–2
(re-read plan 1's "Environment" section before running anything). Binding decisions:

- **D7 — the 4-hour limit is per DAY, configurable**, summed across that day's `pending` + `approved`
  hourly requests. Per-request-only would let two 4h requests take a whole day through the hourly form.
- **D8 — times are validated against a company work-hours window** in `work_settings`. Per-employee
  shift windows are shift scheduling: explicitly out of scope.
- **D9 — half-day (am/pm) stays.** It is a one-tap shortcut; hourly is the general case. Both resolve to
  minutes underneath.
- **D13 — two separate screens**, mirroring the two paper forms. Shared logic lives in the SQL writer,
  not in a shared mega-component.
- **Hourly is gated by `leave_types.allow_hourly`** — reserved since `20260623120005`, switched on here
  for annual and unpaid, left **off for sick**, exactly as the paper hourly form offers.
- **Times are stored as `time` (company-local)**, matching the dates-are-Gregorian-`DATE` convention.
  Never a `timestamptz`; there is no timezone question inside one workday.
- Minutes remain the only stored unit; conversion only through `lib/leave/duration.ts`.
- Advisory lock before any balance read-then-write; `SECURITY DEFINER` + `search_path = ''`; stable
  English error strings mapped in `lib/errors/db-error.ts` + `messages/*.json`.
- Migrations idempotent, applied as `supabase_admin`. `types.ts` hand-edited.
- Commit after every task; never on `main`.

### Accepted limitation, recorded not hidden

An am/pm half-day plus a 2h hourly request on the same date will be **refused**, because am/pm is stored
as `unit='day'` and the overlap rule treats any whole-day request as blocking. Combining them is rare and
the conservative answer is the safe one. Revisit only if the client hits it.

---

## File Structure

```
supabase/migrations/
  20260729130008_leave_hourly.sql   NEW  unit enum, times, CHECKs, work window, allow_hourly seed
  20260729130009_leave_hourly_fns.sql NEW compute_requested_minutes v2, _submit_leave + 2 wrappers
lib/leave/
  hourly.ts        NEW  pure: minutes from a time range, time-overlap, day-cap, slot generation
lib/actions/leave.ts MOD  submitHourlyRequest; work-settings loader gains the window + cap
app/[locale]/(app)/
  request/hourly/page.tsx          NEW  server component
  request/hourly/HourlyRequestForm.tsx NEW client form
  request/page.tsx                 MOD  link across to hourly
  home/HomeBoard.tsx               MOD  two request buttons
  manage/settings/WorkSettingsForm.tsx MOD work window + hourly cap fields
messages/{fa,en}.json              MOD
tests/unit/hourly.test.ts          NEW
tests/e2e/hourly.spec.ts           NEW
```

**Boundary note.** `lib/leave/hourly.ts` holds only arithmetic and predicates — no I/O, no React. The SQL
is authoritative at runtime; the TS exists for the live preview and because time-overlap logic deserves
exhaustive tests rather than a hand-check in psql.

---

## Task 1: Hourly schema

**Files:** Create `supabase/migrations/20260729130008_leave_hourly.sql`; modify `lib/supabase/types.ts`.

**Produces:** enum `public.leave_unit` (`'day'|'hour'`); `leave_requests.unit leave_unit not null default 'day'`,
`start_time time`, `end_time time`; CHECK `leave_requests_unit_shape`; `work_settings.work_start time`
(default `07:00`), `work_end time` (default `15:00`), `max_hourly_minutes_per_day int` (default 240);
`leave_types.allow_hourly = true` for annual + unpaid.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: 20260729130008_leave_hourly.sql
-- Purpose  : Schema for hourly leave / مرخصی ساعتی (spec §7.1), mirroring the
--            client's BJ-F 50208 form: one date, a from-time and a to-time.
--
-- Times are `time`, company-local, matching the dates-are-Gregorian-DATE rule:
-- there is no timezone question inside a single workday, and a timestamptz would
-- invite one.
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'leave_unit') then
    create type public.leave_unit as enum ('day', 'hour');
  end if;
end $$;

alter table public.leave_requests
  add column if not exists unit       public.leave_unit not null default 'day',
  add column if not exists start_time time,
  add column if not exists end_time   time;

-- The company work-hours window (D8) and the per-day hourly cap (D7).
alter table public.work_settings
  add column if not exists work_start time not null default '07:00',
  add column if not exists work_end   time not null default '15:00',
  add column if not exists max_hourly_minutes_per_day int not null default 240;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_settings_window_sane') then
    alter table public.work_settings
      add constraint work_settings_window_sane check (work_end > work_start);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_settings_hourly_cap_sane') then
    alter table public.work_settings
      add constraint work_settings_hourly_cap_sane
      check (max_hourly_minutes_per_day > 0 and max_hourly_minutes_per_day <= 1440);
  end if;
end $$;

-- A malformed row must be impossible even if a function is wrong:
--   day  -> no times, a range, any day_part
--   hour -> both times, ONE date, end after start, day_part must be 'full'
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_unit_shape') then
    alter table public.leave_requests
      add constraint leave_requests_unit_shape check (
        (unit = 'day'  and start_time is null and end_time is null and start_date <= end_date)
        or
        (unit = 'hour' and start_time is not null and end_time is not null
                       and start_date = end_date and end_time > start_time
                       and day_part = 'full')
      );
  end if;
end $$;

create index if not exists leave_requests_hourly_day_idx
  on public.leave_requests (employee_id, start_date)
  where unit = 'hour';

-- Switch on the reserved flag. Sick leave stays daily-only: the client's hourly
-- form offers only استحقاقی and بدون حقوق.
update public.leave_types set allow_hourly = true
 where name_en in ('Annual Leave', 'Unpaid Leave') and allow_hourly = false;
update public.leave_types set allow_hourly = false
 where name_en = 'Sick Leave' and allow_hourly = true;
```

- [ ] **Step 2: Apply, replay, and prove the CHECK bites**

Apply as in earlier plans, replay (expect no error, `UPDATE 0`), then in a rolled-back transaction
attempt each malformed row and confirm **every one is rejected**:

1. `unit='hour'` with null times
2. `unit='hour'` spanning two dates
3. `unit='hour'` with `end_time <= start_time`
4. `unit='hour'` with `day_part='am'`
5. `unit='day'` **with** times

If any insert succeeds, the constraint is wrong — stop and fix before writing any function.

- [ ] **Step 3: types.ts** — `leave_unit` enum, the three `leave_requests` columns, the three
  `work_settings` columns. `tsc --noEmit` clean.

- [ ] **Step 4: Commit.**

---

## Task 2: Pure hourly helpers

**Files:** Create `lib/leave/hourly.ts`, `tests/unit/hourly.test.ts`.

**Produces:**

```ts
export type TimeRange = { start: string; end: string };          // 'HH:MM' or 'HH:MM:SS'
export function timeToMinutes(t: string): number;                 // '09:30' -> 570
export function minutesToTime(m: number): string;                 // 570 -> '09:30'
export function rangeMinutes(r: TimeRange): number;               // duration, 0 if reversed
export function isWithinWindow(r: TimeRange, w: TimeRange): boolean;
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean; // touching ends do NOT overlap
export function timeSlots(w: TimeRange, stepMinutes: number): string[];
export function hourlyDayTotal(existingMinutes: number, requestedMinutes: number): number;
```

Mirrors the SQL in Task 3. `rangesOverlap` uses strict inequality on both sides, so 08:00–10:00 and
10:00–12:00 are **adjacent, not overlapping** — a worker taking two separate errands in one day must not be
blocked by a boundary.

- [ ] **Step 1: Write the failing test** covering, at minimum:
  - `timeToMinutes` / `minutesToTime` round-trip, including `'09:30:00'` (Postgres returns seconds)
  - `rangeMinutes`: 2h = 120; reversed = 0; equal = 0
  - `isWithinWindow`: inside true; starting before window false; ending after false; exactly equal to the
    window true
  - `rangesOverlap`: overlapping true; adjacent (`10:00` end vs `10:00` start) **false**; contained true;
    identical true; disjoint false
  - `timeSlots('07:00'..'15:00', 30)` → 17 slots, first `07:00`, last `15:00`
  - `hourlyDayTotal(120, 120)` → 240

- [ ] **Step 2: Run it; expect failure** (unresolved import).
- [ ] **Step 3: Implement `lib/leave/hourly.ts`.** Keep it arithmetic only.
- [ ] **Step 4: Run it; expect all green.**
- [ ] **Step 5: Commit.**

---

## Task 3: SQL — duration, validation, and the two submit wrappers

**Files:** Create `supabase/migrations/20260729130009_leave_hourly_fns.sql`.

**Produces:** `compute_requested_minutes(p_company_id, p_start, p_end, p_day_part, p_unit, p_start_time, p_end_time)`;
`private.submit_leave_impl(...)`; `public.submit_leave_request(p_leave_type_id, p_start, p_end, p_day_part, p_reason)`
(unchanged signature); `public.submit_hourly_leave_request(p_leave_type_id, p_date, p_start_time, p_end_time, p_reason)`.

**Read first:** the current `submit_leave_request` in `20260729130003`. The impl below is that body
generalised — the advisory lock, the 366-day bound, the balance check, and every error string are
preserved deliberately.

- [ ] **Step 1: `compute_requested_minutes` v2**

Drop the 4-arg version and create the 7-arg one (a default-valued extension would leave two overloads
resolvable for the same call, so replace it outright and update every caller in this migration):

```
unit = 'hour'  -> start_date must be a working day; return (end_time - start_time) in minutes
day_part am/pm -> round(hours_per_day * 60 / 2) if working day else 0
otherwise      -> working_days * hours_per_day * 60
```

- [ ] **Step 2: `private.submit_leave_impl`** — one writer, both units. Order:

1. auth + company resolve; `not authenticated` / `no profile for caller`
2. dates required; `p_end - p_start > 366` → `date range too long`
3. **hourly-only validation**, each with its own stable message:
   - type must have `allow_hourly` → `this leave type cannot be taken hourly`
   - `end_time > start_time` → `end time must be after start time`
   - inside `[work_start, work_end]` → `times must fall within working hours`
   - `duration <= max_hourly_minutes_per_day` → `hourly leave exceeds the daily limit`
   - `that day's existing pending+approved hourly minutes + duration <= cap` → same message
4. advisory lock
5. **time-aware overlap** (§7.4):
   ```sql
   exists (select 1 from public.leave_requests r
            where r.employee_id = v_uid and r.status in ('pending','approved')
              and r.start_date <= p_end and r.end_date >= p_start
              and (r.unit = 'day' or p_unit = 'day'
                   or (r.start_time < p_end_time and r.end_time > p_start_time)))
   ```
   → `overlapping leave request exists` (existing string, existing test coverage)
6. `compute_requested_minutes`; `<= 0` → the existing zero-days message
7. balance check for balance-affecting types → existing `insufficient balance` string
8. insert with `unit`, times, `requested_minutes`

Accrual note: the caller (`submitRequest`) already calls `accrue_my_leave` first, so the balance check
sees freshly-earned minutes. Do not duplicate accrual inside the writer.

- [ ] **Step 3: the two wrappers** delegating to the impl. `submit_leave_request` keeps its exact
  signature so nothing existing breaks. Grants: impl revoked from everyone, both wrappers granted to
  `authenticated`, `anon` revoked.

- [ ] **Step 4: Apply, replay, and verify by scenario** (rolled-back transaction, jwt sub set):
  1. a 2h request inside the window → one row, `requested_minutes = 120`, `unit='hour'`
  2. a second 3h request the same day → rejected, daily limit
  3. a second 2h request the same day, non-overlapping → **accepted** (total 240 = the cap)
  4. an overlapping 1h request → rejected, overlapping
  5. hourly on a weekend/holiday → rejected, zero-minutes
  6. hourly on sick leave → rejected, cannot be taken hourly
  7. times outside the window → rejected, working hours
  8. a full-day request on a date that already has an hourly one → rejected, overlapping

  Assert the **exact** error strings, since `lib/errors/db-error.ts` matches on them.

- [ ] **Step 5: Map the new errors** in `lib/errors/db-error.ts` + `dbErrors` in both locales.
- [ ] **Step 6: Commit.**

---

## Task 4: The hourly screen

**Files:** Create `app/[locale]/(app)/request/hourly/{page.tsx,HourlyRequestForm.tsx}`; modify
`lib/actions/leave.ts`, `request/page.tsx`, `home/HomeBoard.tsx`, `messages/*`.

- [ ] **Step 1: `submitHourlyRequest` action** — same shape as `submitRequest`: accrue first, call
  `submit_hourly_leave_request`, `dbErr` on failure, `invalidateAppCache()` on success.

- [ ] **Step 2: Work-settings loader** gains `workStart`, `workEnd`, `maxHourlyMinutesPerDay` (defaults
  `'07:00'`, `'15:00'`, 240 to match the columns).

- [ ] **Step 3: `/request/hourly`** — single date picker (same `LazyDatePicker`, Jalali/Gregorian per
  preference) + from/to **native `<select>`** of 30-minute slots from `timeSlots`, leave types filtered to
  `allow_hourly`, optional reason, and a live preview showing the duration via `formatDuration` and the
  remaining balance. Native selects because the e2e suite drives them with `selectOption` — a repo rule
  (`docs/MEMORY.md`), and they are the better phone control anyway.

- [ ] **Step 4: Entry points** — two buttons on Home (`درخواست روزانه` / `درخواست ساعتی`) and a link on
  the daily request screen. The bottom-nav Request tab keeps going to the daily screen; do not add a tab
  (`lib/nav/tabs.ts` is unit-tested against a fixed tab set, and a 5th tab is a nav redesign, not this).

- [ ] **Step 5: Labels** in both locales, key trees identical.
- [ ] **Step 6: Gates + commit.**

---

## Task 5: Show hourly where requests are shown

**Files:** `request/MyRequestsList.tsx`, `manage/approvals/ApprovalQueue.tsx`, `calendar/CalendarView.tsx`
(+ their label sources).

An hourly request currently renders as its date and a duration, which reads as a full day to a manager
approving it. Each place that lists a request must show the **time range** when `unit='hour'`.

- [ ] **Step 1: Extend the read types** — `LeaveRequestWithType` and `PendingApproval` gain `unit`,
  `start_time`, `end_time`; add them to the selects. The calendar view already exposes `day_part`; add the
  three columns to `team_leave_calendar` **without** adding anything sensitive (FR-25: still no `reason`,
  still no `decision_note`).
- [ ] **Step 2: Render** `۰۹:۰۰–۱۱:۰۰` beside the duration for hourly rows, using `formatNumber` for digit
  shaping. Keep every existing `data-testid`.
- [ ] **Step 3: Gates + commit.**

---

## Task 6: Settings, e2e, docs

- [ ] **Step 1: `WorkSettingsForm`** gains work-start / work-end time inputs and the hourly cap (in
  **hours**, converted at the boundary), saved through `updateWorkSettings` — extend that action's
  signature and keep its weekend validation intact.
- [ ] **Step 2: `tests/e2e/hourly.spec.ts`** — a throwaway employee submits a 2h request, an admin
  approves it, the balance drops by 2h (asserted as rendered days-and-hours), and a second same-day
  request exceeding the cap is refused with the mapped Farsi error. Reserved `999#######` range.
- [ ] **Step 3: Docs** — DATA_MODEL (`unit`, times, the CHECK, the overlap rule, the work window), FR-26
  in REQUIREMENTS, CHANGELOG, TASKS, AGENT-LOG. Delete the "hourly is deferred" line from the v1 spec's
  D7 by adding a superseding note, not by editing history.
- [ ] **Step 4: Full gates** — unit, e2e serial, tsc, lint, build. Record real counts.
- [ ] **Step 5: Commit.**

---

## Deployment note

Purely additive: new nullable columns, new defaults, one new enum, two new functions. No backfill, no data
rewrite — the safest of the three plans so far. Still: apply on a dump first, confirm the existing daily
flow is untouched (the whole e2e suite, not just the hourly spec), and remember the amd64 packaging
landmine.

`allow_hourly` flips on for annual and unpaid the moment this migration runs, which is what makes the
hourly screen usable. If the client wants a staged rollout, leave the flags false on their server and flip
them per type when they are ready — the UI hides what is not enabled.

## Self-Review

**Spec coverage (§7):**

| Requirement | Task |
|---|---|
| §7.1 `unit`, times, CHECK constraints | 1 |
| §7.1 work window + per-day cap columns | 1 |
| §7.2 `compute_requested_minutes` gains unit/times | 3 |
| §7.2 TS mirror | 2 |
| §7.3 all five hourly validations | 3 |
| §7.4 time-aware overlap + the accepted am/pm limitation | 3, Constraints |
| §7.5 one internal writer + two wrappers | 3 |
| D7 cap per day, configurable | 1, 3, 6 |
| D8 company window | 1, 3, 6 |
| D9 half-day preserved | 3 (am/pm branch untouched) |
| D13 separate screens | 4 |
| `allow_hourly` gating, sick excluded | 1, 4 |

**Deliberately not here:** replacement (plan 4), serials (plan 5). Nothing in this plan touches
`replacement_id` or request numbering.

**Type consistency:** `unit` is the SQL column and the TS field, values `'day' | 'hour'`. Times are
`'HH:MM'` in TS and `time` in SQL; `timeToMinutes` tolerates the `'HH:MM:SS'` Postgres returns.
`maxHourlyMinutesPerDay` is the TS name for `max_hourly_minutes_per_day`, stored in **minutes** and edited
in **hours**.

**Risk flagged:** the overlap predicate is the one piece where a mistake silently allows double-booking
rather than erroring. Task 3 Step 4 scenarios 3, 4 and 8 exist specifically to pin it, and they must be
run against the database — `tsc` cannot see inside PL/pgSQL, which is how plan 1's allocation break got
through.
