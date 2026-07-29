# Design Spec — Leave v2: Hourly Leave · Monthly Accrual · Replacement

- **Date**: 2026-07-29
- **Status**: Approved (design). Implementation plan pending.
- **Module**: HR → Time-Off (Leave). Second major slice, on top of the v1 design
  (`2026-06-23-hr-timeoff-design.md`) and the onboarding slice
  (`2026-07-13-employee-onboarding-design.md`).
- **Supersedes**: FR-8's fixed "~26 working days/yr" entitlement, D7 of the v1 spec ("hourly
  deferred"), and the `*_days` unit throughout the leave schema.

This is a **frozen point-in-time record** of the approved design. Living detail belongs in
`docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`, `docs/REQUIREMENTS.md`.

---

## 1. Context & problem

The client (Behsazan Jonoob, Iranian manufacturing) reviewed the live v1 app and sent their two
paper forms — `docs/forms/daily_pto_form.jpeg` (BJ-F 50210 R0, فرم درخواست مرخصی روزانه) and
`docs/forms/hourly_pto_form.jpeg` (BJ-F 50208 R0, فرم درخواست مرخصی ساعتی). Four gaps:

1. **Hourly leave** (مرخصی ساعتی) up to 4 hours is a real, frequently used flow with its own
   printed form. v1 supports whole and half days only.
2. **Balances accrue monthly**, cumulatively through the year — v1 grants a lump annual
   allocation and never adds to it.
3. **Balances are expressed in days *and* hours.** The paper daily form has HR write
   *"متقاضی دارای مرخصی استحقاقی بمدت ــــ روز و ــــ ساعت می باشد"* — days-and-hours is the
   client's own vocabulary, not a nicety.
4. **A replacement/cover person** (جانشین on the daily form, جایگزین on the hourly form) is named
   on every request, and on the daily form that person signs.

Read from the forms and worth recording, since it shapes later work:

- The daily form's three leave types (استحقاقی / استعلاجی / بدون حقوق) map exactly onto the seeded
  annual / sick / unpaid types. The hourly form offers **only** استحقاقی and بدون حقوق — sick
  leave is never hourly.
- Both forms carry a **شماره** (serial number); HR files and refers to requests by it.
- The daily form has **four** signature blocks (درخواست کننده · جانشین · تصویب کننده · مدیر اداری
  و منابع انسانی). The hourly form has four too, but a different set — the replacement does *not*
  sign, and **حراست (security)** does. The app has one approval step. See §11 (deferred).

## 2. Decisions

Answered by the user 2026-07-29 during brainstorming. All 15 are binding for implementation.

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Entitlement amount — seed says 26/yr, client said 12/yr | **Per-employee**, defaulted from the leave type | The 12 and 26 were both illustrative; the real amount is set by the admin per employee at hire. No number is hardcoded. |
| D2 | Storage unit for sub-day leave | **Integer minutes**, canonical everywhere | Exact under any workday length (7.5h shifts included); renders "9 days 4 hours" trivially. Fractional days drift once `hours_per_day` stops dividing cleanly. |
| D3 | How monthly accrual fires on a LAN-only, sometimes-off server | **Lazy + idempotent on balance read**, plus an admin "Run now" | No cron, no extension to install, self-healing after downtime. `pg_cron` would need catch-up logic anyway — i.e. this design plus a dependency. |
| D4 | Accrual anchor | **1st of each Jalali month**, first month pro-rated | Aligns with the Iranian payroll/leave year. Hire-date anniversaries would give every employee a different accrual day. |
| D5 | Multi-step approval matching the 4 paper signatures | **Keep single-step** (manager approves, admin overrides) | Own module-sized change: approval-steps table, new statuses, per-role queues. Would double this change's blast radius. Specced separately. |
| D6 | Year-end rollover | **Configurable carryover cap, default 9 days**; excess forfeited via an audited ledger row | 9 days matches ماده ۶۶ of the Iranian labour code. Forfeiture must be a visible row, never a silent reset. |
| D7 | What the 4-hour limit caps | **Per day, configurable**, summed across requests | Per-request-only lets two 4h requests take a whole day through the hourly form, bypassing the daily flow. |
| D8 | Time validation | **Company work-hours window** in `work_settings` | Makes "4 hours" meaningful against an 8-hour day and rejects nonsense times. Per-employee shift windows are shift-scheduling — out of scope. |
| D9 | Fate of the existing half-day (am/pm) | **Keep as a shortcut**, hourly is the general case | Live data and tests keep working, workers keep a one-tap option, and minutes remain the single stored unit underneath. |
| D10 | Existing hand-set balances on the live server | **HR sets the opening balance per employee** — at upgrade and at Add Employee | Nothing double-counts. The Add Employee allocation block already does this (`NewEmployeeForm` → `allocate_leave`); it gains the policy fields. |
| D11 | Taking un-accrued leave | **Hard block** (unchanged) | Existing submit/approve guards already refuse to overdraw. Unpaid leave is the escape hatch and touches no balance. |
| D12 | Serial number | **Per-Jalali-year sequence**, `1404-0042`, generated in-DB | HR quotes it on the phone, it prints on any future PDF, and it is the reference an insurance file needs. Awkward to retrofit over live history. |
| D13 | Daily vs hourly UI | **Two separate screens**, mirroring the two paper forms | Workers already know the two forms. Each screen stays simple; shared logic lives in the server functions, not the UI. |
| D14 | Replacement candidates + conflicts | **Same department, active, excluding self**; any overlapping **pending or approved** leave disqualifies | Reuses the existing team-directory scoping, so no new privacy surface. Strict on selection because a cover who is absent is not a cover. |
| D15 | Replacement consent | **Surfaced on their Home ("you are covering X"), no consent gate** | Consistent with D5's single step. With no notifications in v1, a consent gate would stall requests on an off-shift worker. |

### 2.1 A deliberate asymmetry (do not "fix" this)

D14 is strict, D-reverse is lenient, on purpose:

- **Choosing** a cover is strict — anyone with overlapping pending or approved leave is rejected.
- Being **named** as a cover never blocks that person's *own* leave request. If Reza is named as
  Ali's cover for Tuesday and then requests Tuesday off, Reza is **warned, not blocked**, and the
  clash is flagged on the manager's approval card.

Rationale: a coworker's paperwork must not silently veto someone's leave rights, but a request
should not be submitted naming a cover who is already known to be away. A future reader may see
this as inconsistent; it is intentional.

## 3. Scope

**In:** the minutes migration; monthly accrual with caps and carryover; per-employee leave policy;
hourly requests with a work-hours window and a per-day cap; the replacement field with conflict
checks and Home surfacing; per-year serial numbers; days-and-hours rendering everywhere; the
`jalali_months` reference table.

**Out (with a home):** multi-step approval and the security gate check (D5 — own spec);
electronic signature / insurance evidence (§11 — deferred, documented); notifications; per-employee
shift windows; payroll payout of forfeited leave.

## 4. The Jalali calendar table

Accrual anchors on Jalali month starts (D4), carryover triggers on Farvardin 1 (D6), and serials
key on the Jalali year (D12). Postgres has no Jalali support, and a hand-rolled conversion
algorithm inside a `SECURITY DEFINER` function doing balance math is a bad trade.

```
jalali_months
  jalali_year int · jalali_month int · gregorian_start date · gregorian_end date
  primary key (jalali_year, jalali_month)
  unique (gregorian_start)
```

Seeded for **1400–1450** (612 rows — 51 years × 12, generated once and checked into the
migration). Every date
question becomes a join instead of arithmetic:

- month containing date `d` → `where d between gregorian_start and gregorian_end`
- months due since `accrual_start_month` → `where gregorian_start between … and today`
- Jalali year of a request → the joined `jalali_year`

**Documented exception to CLAUDE.md convention 1** ("Jalali is presentation-only, never
persisted"). This is a *calendar reference dimension*, not user data: no profile, request, or
ledger row stores a Jalali value; they store Gregorian dates and join. `docs/DATA_MODEL.md` records
the exception and this rationale so it does not read as a violation.

Bounds check: any date outside 1400–1450 must raise `date outside supported calendar range`
(errcode `22023`) rather than silently returning no rows — a missing join must never become a
skipped accrual.

## 5. Unit migration: days → minutes

### 5.1 Column changes

| Table | Was | Becomes |
|---|---|---|
| `leave_ledger` | `delta_days numeric`, `balance_after numeric` | `delta_minutes int`, `balance_after_minutes int` |
| `leave_requests` | `requested_days numeric` | `requested_minutes int` |
| `leave_allocations` | `allocated_days numeric` | `allocated_minutes int` |

Backfill `× 480` (8h × 60). Existing values are whole days or `.5`, so conversion is exact — no
rounding loss and no data-dependent surprises. Old columns are **dropped** in the same migration.

Rejected: keeping the day columns as generated fallbacks for read compatibility. `hours_per_day`
is a row in `work_settings`, and a generated column cannot reference another table.

RPC parameters change with the columns — `allocate_leave(… p_days numeric)` → `p_minutes int`, and
`set_leave_balance(… p_target numeric)` → `p_target_minutes int`. Both are breaking signature
changes; the server actions in `lib/actions/leave.ts` (`AllocateLeaveInput.days`,
`setLeaveBalance`) and the Add Employee allocation block are their only callers, so the rename is
safe to do in one pass rather than shipping overloads.

### 5.2 The conversion module

New `lib/leave/duration.ts` — the **only** place days↔minutes conversion may happen:

```ts
minutesToDaysHours(minutes: number, hoursPerDay: number): { days: number; hours: number; minutes: number }
formatDuration(minutes: number, hoursPerDay: number, locale: string): string  // "۹ روز و ۴ ساعت"
daysToMinutes(days: number, hoursPerDay: number): number
hoursToMinutes(hours: number): number
```

Pure, unit-tested, no I/O. `formatDuration` omits empty parts ("۴ ساعت", not "۰ روز و ۴ ساعت") and
uses the existing `formatNumber` from `lib/i18n/format.ts` for digit shaping.

### 5.3 Every reader that must change

Found by grep; the list is exhaustive as of `cce7b16`:

- `lib/supabase/types.ts` — regenerated
- `lib/actions/leave.ts:212, 236, 245, 419, 448` — request lists and the balance read
- `lib/leave/balances.ts` — `latestBalances` reads `balance_after`
- `app/[locale]/(app)/home/HomeBoard.tsx:117`
- `app/[locale]/(app)/request/MyRequestsList.tsx:131`
- `app/[locale]/(app)/manage/approvals/ApprovalQueue.tsx:106`
- `app/[locale]/(app)/manage/employees/new/NewEmployeeForm.tsx:25, 71` + `new/page.tsx:44`
- `tests/unit/balances.test.ts`
- SQL: `compute_requested_days`, `current_leave_balance`, `allocate_leave`,
  `submit_leave_request`, `approve_leave_request`, `cancel_leave_request`, `set_leave_balance`
- `scripts/seed-demo.mjs`, `supabase/seed.sql`

## 6. Leave policy & accrual

### 6.1 Schema

```
employee_leave_policies
  id · employee_id → profiles · leave_type_id → leave_types
  accrual_minutes_per_month int not null default 0
  annual_cap_minutes        int          null      -- null = uncapped
  carryover_cap_minutes     int not null default 4320   -- 9 days × 480
  accrual_start_month       date not null            -- a jalali_months.gregorian_start
  created_by · created_at · updated_at
  unique (employee_id, leave_type_id)
```

`opening_balance_minutes` is deliberately **not** a column here: the opening position is already an
`allocation` ledger row written by `allocate_leave`, which the Add Employee form calls today. Two
records of the same fact would drift.

`leave_types` gains the defaults that pre-fill the form:
`default_accrual_minutes_per_month int` · `default_annual_cap_minutes int` ·
`default_carryover_cap_minutes int`. The existing `default_annual_quota_days numeric` is **kept
unchanged** — after this change its only job is pre-filling the opening allocation on the Add
Employee form (`NewEmployeeForm.tsx:71`). It does not drive accrual. No rename: it is already in
live data and the name still describes what it does.

`work_settings` gains: `hours_per_day numeric not null default 8` ·
`work_start time not null default '07:00'` · `work_end time not null default '15:00'` ·
`max_hourly_minutes_per_day int not null default 240`.

`leave_ledger` gains `period_month date null`, plus the index that makes double-crediting
structurally impossible:

```sql
create unique index leave_ledger_period_uniq
  on public.leave_ledger (employee_id, leave_type_id, entry_type, period_month)
  where period_month is not null;
```

`ledger_entry` gains the value `'carryover_forfeit'` so forfeitures are queryable and never
confused with admin adjustments.

RLS on `employee_leave_policies` mirrors `leave_allocations`: SELECT for own | manager-of |
`can_read_all`; **no** client write policies — writes go through a definer function.

### 6.2 `accrue_leave(p_employee_id, p_leave_type_id)`

`SECURITY DEFINER`, `search_path = ''`, idempotent. Takes the existing per-employee advisory lock
`pg_advisory_xact_lock(hashtextextended('leave:' || employee_id, 0))` before reading any balance —
same discipline as every other write path since the 2026-07-02 hardening.

1. Read the policy row; return early if absent or `accrual_minutes_per_month = 0`.
2. List `jalali_months` from `accrual_start_month` to the month containing
   `(now() at time zone 'Asia/Tehran')::date`.
3. Skip months already present in `leave_ledger` (via `period_month`).
4. Process the remainder **chronologically**. For each month:
   a. If `jalali_month = 1` **and** the employee has at least one earlier accrual row, apply the
      carryover clamp *first* (§6.3). The "earlier row" condition is what stops the clamp firing on
      an employee whose very first accrual month happens to be Farvardin.
   b. If `hire_date` falls inside this month, pro-rate by calendar days remaining:
      `round(rate × remaining_days / days_in_month)`.
   c. Clamp so the year's cumulative accrual does not exceed `annual_cap_minutes`.
   d. Insert an `allocation` row with `period_month`, `delta_minutes`, and a running
      `balance_after_minutes`. `on conflict do nothing` guards the race the index already covers.
5. Return the resulting balance.

Pro-rating uses **calendar** days, not working days — simpler to explain to a worker and it makes
the arithmetic checkable by hand against a payslip.

### 6.3 Carryover at the year boundary

When processing crosses into a new Jalali year, and the balance carried in exceeds
`carryover_cap_minutes`, insert a `carryover_forfeit` row for the excess, `period_month` = Farvardin
1 of the new year, before that month's accrual. Auditable, idempotent by the same index,
reversible by an admin `set_leave_balance` if the client disputes it.

### 6.4 Wrappers and call sites

| Function | Caller | Guard |
|---|---|---|
| `accrue_my_leave()` | balance reads for self | `auth.uid()` only |
| `accrue_employee_leave(id)` | manager/HR viewing an employee | `is_manager_of` or `is_admin` |
| `accrue_all_leave()` | Settings → "Post accruals now" | `is_admin`; returns a per-employee summary |

Called at the top of `getMyBalance`/`getMyBalances`, the Home board balance read, the manage
employee view, and inside the submit path before the balance check. Because accrual **writes**, it
must be an RPC invoked before the RLS-protected `leave_ledger` read — it can never live inside
`team_leave_calendar` or any view.

Cost is bounded: ≤ 12 rows scanned per employee per year against a 612-row indexed table.

## 7. Hourly requests

### 7.1 Schema

```
leave_unit enum ('day', 'hour')

leave_requests adds
  unit           leave_unit not null default 'day'
  start_time     time null          -- company-local, matching the date-as-DATE convention
  end_time       time null
  replacement_id uuid null → profiles(id)
  serial_year    int not null
  serial_seq     int not null
  company_id     uuid not null → companies(id)   -- backfilled from the employee's profile
  unique (company_id, serial_year, serial_seq)
```

CHECK constraints, so a malformed row cannot exist even if a function is wrong:

```sql
check (
  (unit = 'day'  and start_time is null and end_time is null and start_date <= end_date)
  or
  (unit = 'hour' and start_time is not null and end_time is not null
                 and start_date = end_date and end_time > start_time
                 and day_part = 'full')
)
```

`company_id` is denormalised deliberately: it makes the serial's unique index possible without a
join and shortens the company-wide manager queries that FR-17 already requires.

### 7.2 `compute_requested_minutes`

Replaces `compute_requested_days`. Signature gains `p_unit`, `p_start_time`, `p_end_time`.

- `unit = 'hour'` → `start_date` must be a working day; return
  `extract(epoch from (end_time - start_time)) / 60`
- `day_part in ('am','pm')` → `hours_per_day × 60 / 2`
- otherwise → `working_days × hours_per_day × 60`

The TS mirror `lib/leave/workingDays.ts` moves in lockstep, as its header already requires.

### 7.3 Validation (hourly)

Enforced server-side; the client duplicates it only for live feedback.

1. `leave_types.allow_hourly` — the existing reserved column, now live. Seeded `true` for annual and
   unpaid, `false` for sick, per the paper form.
2. Single date, and a working day (not weekend, not a holiday).
3. `start_time`/`end_time` inside `[work_start, work_end]`, `end_time > start_time`.
4. Duration ≤ `max_hourly_minutes_per_day`, **and** that day's existing hourly minutes (summed over
   the employee's own `pending` **and** `approved` hourly requests on that date) plus this request
   ≤ the same cap (D7).
5. Balance ≥ requested minutes for balance-affecting types (D11).

### 7.4 The overlap predicate

Today's check is pure date arithmetic, so two hourly requests on one day would falsely collide. It
becomes:

```sql
exists (
  select 1 from public.leave_requests r
  where r.employee_id = v_uid
    and r.status in ('pending','approved')
    and r.start_date <= p_end and r.end_date >= p_start
    and (
      r.unit = 'day' or p_unit = 'day'                       -- either side is whole-day
      or (r.start_time < p_end_time and r.end_time > p_start_time)   -- both hourly: intersect
    )
)
```

**Accepted v1 limitation:** an am half-day plus a 2h afternoon request is refused, because am/pm is
stored as `unit = 'day'`. Recorded rather than hidden; revisit if the client hits it.

### 7.5 Function structure

One internal `_submit_leave(...)` holding the shared work — lock, overlap, minutes computation,
balance, replacement validation, serial allocation, insert — with two thin public wrappers:

- `submit_leave_request(p_leave_type_id, p_start, p_end, p_day_part, p_reason, p_replacement_id)`
- `submit_hourly_leave_request(p_leave_type_id, p_date, p_start_time, p_end_time, p_reason, p_replacement_id)`

Two wrappers mirror the two screens (D13) and keep each readable; the shared body keeps the rules in
one place.

### 7.6 Serial numbers

```
leave_request_serials
  company_id · jalali_year · last_seq int
  primary key (company_id, jalali_year)
```

Allocated inside `_submit_leave` under the advisory lock via
`insert … on conflict (company_id, jalali_year) do update set last_seq = last_seq + 1 returning last_seq`
— gapless and concurrency-safe. Displayed as `{jalali_year}-{seq:0000}`; formatting lives in
`lib/leave/serial.ts`, never in SQL.

## 8. Replacement

`get_replacement_candidates(p_start, p_end, p_unit, p_start_time, p_end_time)` returns
same-department active colleagues (excluding self) with `unavailable boolean` and
`unavailable_reason text` — **not** a filtered list. A worker who cannot find their intended cover
must see *"off that day"*, not an unexplained gap. The server still hard-rejects on submit and
re-checks at approval, mirroring how the overlap guard is enforced twice.

It is `SECURITY DEFINER` with `search_path = ''` and `execute` granted to `authenticated` only
(`anon` revoked), scoped internally to `auth.uid()`'s own department — the caller passes dates, never
an employee or department id, so it cannot be used to enumerate another team.

Reverse case (§2.1): `get_my_cover_conflicts(p_start, p_end)` powers a warning on the requester's
form, and the approval card shows the same flag to the manager. No notifications needed — it renders
on screens they already open.

Home surfacing: "you are covering X on <dates>" for pending/approved requests where
`replacement_id = auth.uid()`, added to the existing Home board query in `lib/home/board.ts`.

Visibility: the replacement's name is readable by the requester, the named person, `is_manager_of`,
security, and admin. It is **not** added to `team_leave_calendar` — that view's exposed column list
stays as narrow as FR-25 made it.

## 9. UI

- **Home**: two request buttons — درخواست روزانه / درخواست ساعتی. The bottom-nav Request tab keeps
  going to the daily screen, which links across to hourly.
- **`/request/hourly`** (new): single-date picker · from/to time as **native `<select>`** of 30-minute
  slots inside the work window (phone-friendly, and consistent with the existing "native select for
  Playwright `selectOption`" rule) · leave type filtered to `allow_hourly` · replacement picker ·
  reason · live preview showing duration and remaining balance in days-and-hours.
- **Replacement picker**: shadcn `Command` inside a `Popover` with `data-testid` hooks — search is a
  hard requirement per the user's brief, so a native select will not do. Unavailable candidates
  render disabled with their reason. RTL verified.
- **Add/Edit Employee**: the existing allocation block gains a **Leave policy** section per
  balance-affecting type — accrual/month, annual cap, carryover cap, accrual start month —
  pre-filled from the leave-type defaults. Annual expanded; sick collapsed with accrual 0, since
  sick leave in Iran is certified, not accrued.
- **Manage → Settings**: work hours, hours/day, hourly cap, and "Post accruals now" with a result
  summary.
- **Everywhere a duration appears** (Home, request lists, approvals, manage): `formatDuration`.
  Serial number shown on request cards and approval cards.

## 10. Migrations, tests, risk

### 10.1 Migration order

1. `20260729130001_jalali_calendar.sql` — table + 1400–1450 seed
2. `20260729130002_leave_minutes.sql` — unit conversion; rewrites every definer function that
   touches days
3. `20260729130003_leave_policy_accrual.sql` — policies, `work_settings`/`leave_types` columns,
   accrual fns
4. `20260729130004_leave_hourly.sql` — `leave_unit`, times, CHECKs, `compute_requested_minutes`,
   submit fns, overlap rewrite
5. `20260729130005_leave_replacement.sql` — `replacement_id`, candidate + conflict RPCs
6. `20260729130006_leave_serial.sql` — counter table, generation, backfill of existing rows

Timestamps follow the last live migration (`20260729120001_reject_reason.sql`). If implementation
slips past today, renumber the whole chain to the implementation date rather than interleaving.

### 10.2 Tests

- **Unit**: duration conversion and formatting (fa/en digits); Jalali month lookup; accrual month
  list, pro-rating, annual clamp, carryover forfeit; the hourly overlap predicate; cover-conflict
  logic; serial formatting.
- **SQL/integration**: accrual called twice posts one row; concurrent accrual under the advisory
  lock; cap clamp; forfeit at a year boundary; hourly day-cap across two requests.
- **E2E**: hourly submit → approve → balance reads "x روز و y ساعت"; replacement picker marks an
  absent colleague unavailable and the server rejects them; two hourly requests exceeding 4h on one
  day blocked; serial appears on the card.
- **Regression**: the existing suites stay green (`npm run test:unit`, `npm run test:e2e`),
  `day_part` paths especially. **Capture the baseline counts by running both before touching
  anything** — the recorded numbers disagree (CLAUDE.md says 103 unit, `docs/MEMORY.md` says 130, a
  static count of the spec files gives 146), so no existing document can be trusted as the
  pass/fail bar.

All new error strings are stable English, mapped fa/en through `lib/errors/db-error.ts` +
`messages/*.json` `dbErrors`, per the existing convention.

### 10.3 Live-server risk

The client's Ubuntu VM at `https://10.10.10.50` holds real balances (deployed 2026-07-25). Before
shipping:

1. Dump their database and run the full migration chain against a local copy.
2. Written acceptance query: for every employee and type, `old_balance_days × 480 == new_balance_minutes`.
3. Rehearse the rollback (restore from dump) and time it.
4. Watch the known **amd64 cross-build landmine** — `package.sh` has no `--platform` (see
   `docs/MEMORY.md`).

Suggested shipping order: **§5 minutes → §6 accrual → §7 hourly → §8 replacement → §7.6 serial**.
Accrual before hourly is deliberate: it defines what a balance *means*, and debugging fractional
consumption against still-wrong balances is the harder order. §5+§6 can ship as one release,
§7/§8/§7.6 as a second.

## 11. Deferred: insurance evidence (client item 4)

**Not built in this change.** Recorded because the client raised it and it will drive real work.

The problem, in their words: today a worker's **ink signature** on the paper form is the company's
proof, if a worker is injured during time off and claims it happened at work, that they were
absent by their own request. A digital request with no signature weakens that position, and safety
evidence matters enormously to a manufacturer.

Options, cheapest first:

1. **Hybrid — zero legal risk.** The app generates the filled BJ-F 50208/50210 with its serial and a
   QR code; the worker signs in ink; HR scans it back and attaches it to the request (Supabase
   Storage). The legal artifact is unchanged, and the digital record becomes complete. Recommended
   interim step.
2. **Credential signature.** Re-enter the password at submit → an `audit_log` row recording
   "signed by credential". No hardware, and it binds the act to the same identity that login does.
3. **Tamper evidence.** Hash-chain request rows. What an insurer or court actually weighs is whether
   the record could have been altered afterwards — more than whether a squiggle exists.
4. **Drawn signature** captured on a phone or tablet at the HR desk. Familiar to everyone, weak on
   its own, meaningful combined with 3.
5. **The real lever — digitise the حراست gate check.** Security already signs the hourly form. A
   timestamped "left site 10:03, returned 13:58" record is far stronger evidence that an injury
   happened off-premises than any signature on a statement of *intent* to be absent. This is also
   the D5 security step, so the two should be specced together.

Legal frame: Iran's قانون تجارت الکترونیکی (1382) recognises secure electronic signatures, but
bound-to-identity plus tamper-evident beats a drawn image. **Next step is a phone call, not a
sprint: ask the client's insurer what they will accept in a claim file.** That answer decides which
of the five to build.

## 12. Requirements to add

- **FR-26** Hourly leave (مرخصی ساعتی): single date, from/to time inside the company work-hours
  window, capped per day, gated by `leave_types.allow_hourly`.
- **FR-27** Monthly accrual: per-employee rate and caps, anchored to Jalali month starts, first
  month pro-rated, cumulative within the year, carryover capped with audited forfeiture.
- **FR-28** Replacement person: optional, searchable, same department, blocked when they have
  overlapping pending or approved leave; surfaced on their Home; never a consent gate.
- **FR-29** Per-Jalali-year request serial numbers.
- **FR-30** *(deferred)* Signature / insurance evidence — see §11.
- **FR-8 amended**: entitlement is per-employee, not a fixed statutory number.
- **FR-11 amended**: hourly is delivered, not reserved.
