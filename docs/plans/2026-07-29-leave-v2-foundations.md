# Leave v2 Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the leave system's stored unit from fractional days to integer minutes, and add the Jalali calendar reference table — the two foundations every later Leave v2 phase depends on, with no user-visible behaviour change beyond balances rendering as "9 روز و 4 ساعت".

**Architecture:** Expand → migrate → contract, because this runs against the client's live balances. Task 3 *adds* minutes columns and keeps them in sync with the day columns via triggers (nothing breaks, no function rewritten). Task 4 switches every app read to minutes. Task 5 rewrites the `SECURITY DEFINER` functions to write minutes natively, then drops the triggers and the day columns. Every task leaves the suite green and the app deployable.

**Tech Stack:** Postgres 17 (Supabase, self-hosted in production) · Next.js 16 App Router + TypeScript · Vitest (unit) · Playwright (e2e) · `react-date-object` 2.1.9 for Jalali generation (build-time only).

## Global Constraints

Copied from `docs/specs/2026-07-29-hourly-accrual-replacement-design.md`; every task inherits these.

- **Spec:** `docs/specs/2026-07-29-hourly-accrual-replacement-design.md` §4 (calendar) and §5 (minutes). Read both before Task 1.
- **Dates stored Gregorian.** Jalali is display-only. `jalali_months` is the single documented exception (§4) — a calendar *dimension*; no profile, request, or ledger row may store a Jalali value.
- **Canonical stored unit is integer minutes.** Fractional days must not survive Task 5 anywhere in the schema.
- **The historical conversion constant is 480** (8h × 60). It is baked into the backfill *deliberately*: history was recorded when a day meant 8 hours, and a future admin changing `hours_per_day` must not retroactively shift past balances. Never backfill from the live setting.
- **RLS is the source of truth.** The transactional tables (`leave_requests`, `leave_ledger`, `leave_allocations`) have **no client write policies** — all writes go through `SECURITY DEFINER` functions. Do not add a write policy to make a task easier.
- **Every function that reads-then-writes a balance must first take** `pg_advisory_xact_lock(hashtextextended('leave:' || <employee_id>::text, 0))`. This is the 2026-07-02 hardening; preserve it in every rewrite.
- **All SECURITY DEFINER functions use** `set search_path = ''` and fully-qualified names.
- **Error messages are stable English strings**, mapped to fa/en in `lib/errors/db-error.ts` + `messages/*.json` (`dbErrors`). Reuse existing strings verbatim where a rewrite preserves behaviour.
- **Company timezone is `Asia/Tehran`**; "today" is `(now() at time zone 'Asia/Tehran')::date`, never `current_date`.
- **Commit after every task.** Never commit to `main`; this plan runs on `feat/leave-v2-hourly-accrual-replacement`.
- **Verify library APIs against Context7 before use** — no training-data signatures.

## Environment (verified 2026-07-29 on Amir's Mac, not assumed)

The plan originally assumed a `supabase start` dev stack. That is **not** this machine. Verified facts:

| Thing | Reality |
|---|---|
| `supabase` CLI | **Not installed**, and `npx supabase` cannot install it (no network consent). So `supabase db reset` and `supabase gen types` are unavailable. |
| Local database | The self-hosted **docker-compose stack** from `deploy/` is running: `bj-erp-db-1`, `bj-erp-{app,gateway,auth,rest}-1`. Postgres port is **not published to the host** — reach it with `docker exec`, not `psql` from the host. |
| What the dev app targets | `.env.local` → `NEXT_PUBLIC_SUPABASE_URL=http://192.168.2.48:8080` (the docker gateway). The cloud project is **paused**. |
| Local data | Real rows: 27 `leave_ledger`, 3 `leave_requests`. The backfill therefore runs against actual data — a better test than an empty reset. |
| `tsx` | Not installed. Node is **v24.13.0**, which strips TypeScript types natively, so `node scripts/gen-jalali-months.mjs` can import a `.ts` module directly. |
| `react-date-object` under plain Node ESM | Subpath imports need the explicit **`.js`** extension (no `exports` map), and the package is CJS, so the default export arrives wrapped as `.default`. Both are handled in `jalaliMonths.ts`; bundler resolution (Next, vitest) is unaffected. |

**Canonical commands for this machine:**

```bash
# apply a migration (idempotent replay — the same mechanism deploy/update.sh uses)
docker exec -i bj-erp-db-1 psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -f - < supabase/migrations/<file>.sql

# query
docker exec bj-erp-db-1 psql -U postgres -d postgres -c "<sql>"
```

There is **no `db reset`** available, so migrations are replayed forward onto a database with data.
Every migration in this plan must therefore be **idempotent** (`if not exists`, `create or replace`,
guarded `update`) — which they already are, and which is also what `deploy/update.sh` requires on the
client's server.

---

## File Structure

```
supabase/migrations/
  20260729130001_jalali_calendar.sql      NEW  table + 612 generated rows
  20260729130002_leave_minutes_expand.sql NEW  minutes columns, backfill, sync triggers
  20260729130003_leave_minutes_contract.sql NEW  fns write minutes; drop triggers + day columns
lib/leave/
  jalaliMonths.ts   NEW  pure generator for the seed rows (build-time only, not imported by app code)
  duration.ts       NEW  the ONLY place days<->minutes conversion happens
  balances.ts       MOD  latestBalances reads balance_after_minutes
  workingDays.ts    MOD  countWorkingMinutes alongside countWorkingDays
scripts/
  gen-jalali-months.mjs  NEW  writes migration 01 from lib/leave/jalaliMonths.ts
lib/actions/leave.ts     MOD  balance + request reads, allocate/setBalance param rename
lib/supabase/types.ts    MOD  regenerated
app/[locale]/(app)/      MOD  HomeBoard, MyRequestsList, ApprovalQueue, NewEmployeeForm
messages/{fa,en}.json    MOD  leave.hours, leave.minutes, leave.and
tests/unit/              NEW  jalaliMonths, duration    MOD  balances, workingDays
```

**Responsibility boundaries.** `duration.ts` owns unit conversion and nothing else — no I/O, no i18n lookups (labels are passed in), so it stays trivially testable and every caller shares one implementation. `jalaliMonths.ts` is build-time only; the app never imports it at runtime, which is why 612 rows can live in Postgres instead of a JS bundle.

---

## Task 1: Jalali calendar reference table

**Files:**
- Create: `lib/leave/jalaliMonths.ts`
- Create: `tests/unit/jalaliMonths.test.ts`
- Create: `scripts/gen-jalali-months.mjs`
- Create: `supabase/migrations/20260729130001_jalali_calendar.sql` (generated, then committed)

**Interfaces:**
- Consumes: nothing.
- Produces: `buildJalaliMonths(fromYear: number, toYear: number): JalaliMonthRow[]` where
  `JalaliMonthRow = { jalaliYear: number; jalaliMonth: number; gregorianStart: string; gregorianEnd: string }`
  (both dates `YYYY-MM-DD`). SQL table `public.jalali_months (jalali_year int, jalali_month int, gregorian_start date, gregorian_end date)`, PK `(jalali_year, jalali_month)`, unique `(gregorian_start)`.

**Why property tests, not fixed expected dates:** Nowruz drifts between 20 and 21 March, and hardcoding remembered anchors is exactly how a calendar table ends up silently wrong. The library is the source of truth; the tests assert structural invariants and a round-trip.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/jalaliMonths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import DateObject from 'react-date-object';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import persian from 'react-date-object/calendars/persian';
import persian_en from 'react-date-object/locales/persian_en';
import { buildJalaliMonths } from '@/lib/leave/jalaliMonths';

const rows = buildJalaliMonths(1400, 1450);

function daysBetween(a: string, b: string): number {
  return (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000;
}

describe('buildJalaliMonths', () => {
  it('produces 12 months for every year in the range', () => {
    expect(rows).toHaveLength(51 * 12);
    expect(rows[0]).toMatchObject({ jalaliYear: 1400, jalaliMonth: 1 });
    expect(rows[rows.length - 1]).toMatchObject({ jalaliYear: 1450, jalaliMonth: 12 });
  });

  it('is contiguous — each month starts the day after the previous month ends', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(daysBetween(rows[i - 1].gregorianEnd, rows[i].gregorianStart)).toBe(1);
    }
  });

  it('round-trips: each gregorianStart converts back to day 1 of that Jalali month', () => {
    for (const row of rows) {
      const [y, m, d] = row.gregorianStart.split('-').map(Number);
      const back = new DateObject({
        calendar: gregorian,
        locale: gregorian_en,
        year: y,
        month: m,
        day: d,
      }).convert(persian, persian_en);
      expect(back.year).toBe(row.jalaliYear);
      expect(back.month.number).toBe(row.jalaliMonth);
      expect(back.day).toBe(1);
    }
  });

  it('starts every Jalali year in March', () => {
    for (const row of rows.filter((r) => r.jalaliMonth === 1)) {
      expect(Number(row.gregorianStart.split('-')[1])).toBe(3);
    }
  });

  it('gives every month a plausible length', () => {
    for (const row of rows) {
      const len = daysBetween(row.gregorianStart, row.gregorianEnd) + 1;
      expect(len).toBeGreaterThanOrEqual(29);
      expect(len).toBeLessThanOrEqual(31);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- jalaliMonths`
Expected: FAIL — `Failed to resolve import "@/lib/leave/jalaliMonths"`.

- [ ] **Step 3: Write the implementation**

Create `lib/leave/jalaliMonths.ts`:

```ts
/**
 * Build-time generator for the `jalali_months` reference table (spec §4).
 *
 * NOT imported by app code — `scripts/gen-jalali-months.mjs` uses it to emit the
 * migration, and the 612 rows then live in Postgres. Accrual anchors, the
 * carryover boundary, and serial years all join against that table instead of
 * converting calendars at query time.
 */
// Subpaths carry the explicit `.js` extension and DateObject goes through an
// interop shim because this module is also imported by scripts/gen-jalali-months.mjs
// under plain Node ESM, where react-date-object (CJS, no exports map) resolves
// neither bare subpaths nor an unwrapped default. Bundler resolution (Next,
// vitest) is unaffected by both. This is why it differs from lib/leave/dateConvert.ts.
import DateObjectModule from 'react-date-object';
import persian from 'react-date-object/calendars/persian.js';
import persian_en from 'react-date-object/locales/persian_en.js';
import gregorian from 'react-date-object/calendars/gregorian.js';
import gregorian_en from 'react-date-object/locales/gregorian_en.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DateObject = ((DateObjectModule as any).default ??
  DateObjectModule) as typeof DateObjectModule;

export type JalaliMonthRow = {
  jalaliYear: number;
  jalaliMonth: number;
  /** Gregorian YYYY-MM-DD of day 1 of this Jalali month. */
  gregorianStart: string;
  /** Gregorian YYYY-MM-DD of the last day of this Jalali month. */
  gregorianEnd: string;
};

function toGregorian(jYear: number, jMonth: number, jDay: number): string {
  return new DateObject({
    calendar: persian,
    locale: persian_en,
    year: jYear,
    month: jMonth,
    day: jDay,
  })
    .convert(gregorian, gregorian_en)
    .format('YYYY-MM-DD');
}

/** Inclusive on both years. 1400–1450 yields 612 rows. */
export function buildJalaliMonths(fromYear: number, toYear: number): JalaliMonthRow[] {
  const rows: JalaliMonthRow[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (let m = 1; m <= 12; m++) {
      // toLastOfMonth() is calendar-aware: it knows Esfand is 29 or 30 days.
      const lastDay = new DateObject({
        calendar: persian,
        locale: persian_en,
        year: y,
        month: m,
        day: 1,
      }).toLastOfMonth().day;

      rows.push({
        jalaliYear: y,
        jalaliMonth: m,
        gregorianStart: toGregorian(y, m, 1),
        gregorianEnd: toGregorian(y, m, lastDay),
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- jalaliMonths`
Expected: PASS, 5 tests.

If the round-trip test fails, do **not** adjust the expectations — the generator is wrong, or `react-date-object`'s Persian calendar handling changed. Re-check the API via Context7 before touching the test.

- [ ] **Step 5: Write the migration generator**

Create `scripts/gen-jalali-months.mjs`:

```js
/**
 * Emits supabase/migrations/20260729130001_jalali_calendar.sql.
 * Run once; the generated SQL is committed. Re-run only to widen the year range.
 *
 * Usage: node scripts/gen-jalali-months.mjs
 */
import { writeFileSync } from 'node:fs';
import { buildJalaliMonths } from '../lib/leave/jalaliMonths.ts';

const FROM = 1400;
const TO = 1450;
const OUT = 'supabase/migrations/20260729130001_jalali_calendar.sql';

const rows = buildJalaliMonths(FROM, TO);

const values = rows
  .map(
    (r) =>
      `  (${r.jalaliYear}, ${r.jalaliMonth}, '${r.gregorianStart}', '${r.gregorianEnd}')`
  )
  .join(',\n');

const sql = `-- =============================================================================
-- Migration: 20260729130001_jalali_calendar.sql
-- Purpose  : Jalali calendar reference dimension (spec §4). Accrual anchors on
--            Jalali month starts, carryover fires on Farvardin 1, and request
--            serials key on the Jalali year — all three become joins instead of
--            a hand-rolled conversion algorithm inside a definer function.
--
-- DOCUMENTED EXCEPTION to CLAUDE.md convention 1 ("Jalali is presentation-only,
-- never persisted"): this is a calendar *dimension*, not user data. No profile,
-- request, or ledger row stores a Jalali value — they store Gregorian dates and
-- join here.
--
-- GENERATED by scripts/gen-jalali-months.mjs from lib/leave/jalaliMonths.ts
-- (react-date-object). Do not hand-edit rows; re-run the generator.
-- Range: ${FROM}–${TO} (${rows.length} rows).
-- =============================================================================

-- Idempotent throughout: there is no \`db reset\` on the dev machine and
-- deploy/update.sh replays every migration file on the client's server.
create table if not exists public.jalali_months (
  jalali_year     int  not null,
  jalali_month    int  not null check (jalali_month between 1 and 12),
  gregorian_start date not null,
  gregorian_end   date not null,
  primary key (jalali_year, jalali_month),
  constraint jalali_months_range check (gregorian_end >= gregorian_start)
);

create unique index if not exists jalali_months_start_uniq on public.jalali_months (gregorian_start);
create index if not exists jalali_months_span_idx on public.jalali_months (gregorian_start, gregorian_end);

insert into public.jalali_months (jalali_year, jalali_month, gregorian_start, gregorian_end) values
${values}
on conflict (jalali_year, jalali_month) do nothing;

-- Read-only reference data: every authenticated user may read it, nobody writes it
-- (not even admins — widening the range is a migration, so the rows stay verifiable).
alter table public.jalali_months enable row level security;
drop policy if exists "jalali_months_select" on public.jalali_months;
create policy "jalali_months_select"
  on public.jalali_months for select to authenticated using (true);

-- Resolve the Jalali month containing a Gregorian date. Raises rather than
-- returning null outside the seeded range: a missing join must never silently
-- become a skipped accrual.
create or replace function public.jalali_month_of(p_date date)
returns public.jalali_months
language plpgsql stable security invoker set search_path = '' as $$
declare v_row public.jalali_months;
begin
  select * into v_row from public.jalali_months
   where p_date between gregorian_start and gregorian_end;
  if v_row is null then
    raise exception 'date outside supported calendar range' using errcode = '22023';
  end if;
  return v_row;
end; $$;
`;

writeFileSync(OUT, sql);
console.log(`wrote ${OUT} (${rows.length} rows)`);
```

- [ ] **Step 6: Generate the migration and verify its shape**

Run: `node scripts/gen-jalali-months.mjs`
Expected: `wrote supabase/migrations/20260729130001_jalali_calendar.sql (612 rows)`

Node 24 strips the types in the imported `.ts` module, so no `tsx` is needed. A
`MODULE_TYPELESS_PACKAGE_JSON` warning on stderr is expected noise, not a failure.

Then: `grep -c "^  (" supabase/migrations/20260729130001_jalali_calendar.sql`
Expected: `612`

- [ ] **Step 7: Apply it locally and verify against the database**

```bash
docker exec -i bj-erp-db-1 psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -f - < supabase/migrations/20260729130001_jalali_calendar.sql
```
Expected: `CREATE TABLE`, `CREATE INDEX` ×2, `INSERT 0 612`, `ALTER TABLE`, `CREATE POLICY`, `CREATE FUNCTION` — and no `ERROR`.

```bash
docker exec bj-erp-db-1 psql -U postgres -d postgres -c \
  "select count(*) as rows, min(gregorian_start) as first, max(gregorian_end) as last from public.jalali_months;"
```
Expected: `rows = 612`, `first` in March 2021, `last` in March 2072.

Contiguity must hold in SQL too — no gaps, no overlaps:
```bash
docker exec bj-erp-db-1 psql -U postgres -d postgres -c \
  "select count(*) from (select gregorian_end, lead(gregorian_start) over (order by gregorian_start) nxt from public.jalali_months) t where nxt is not null and nxt <> gregorian_end + 1;"
```
Expected: `0`

Re-run the migration once more and confirm it is idempotent (no `db reset` exists here, and
`deploy/update.sh` replays every file on the client's server):
Expected: no error; `insert … on conflict do nothing` leaves the count at 612.

- [ ] **Step 8: Commit**

```bash
git add lib/leave/jalaliMonths.ts tests/unit/jalaliMonths.test.ts \
        scripts/gen-jalali-months.mjs \
        supabase/migrations/20260729130001_jalali_calendar.sql
git commit -m "feat(leave): jalali_months calendar reference table

Accrual anchors on Jalali month starts, carryover fires on Farvardin 1, and
request serials key on the Jalali year (spec section 4). A 612-row generated
dimension table turns all three into joins, instead of a hand-rolled calendar
conversion inside a SECURITY DEFINER function doing balance math.

Documented exception to CLAUDE.md convention 1: this is a calendar dimension,
not user data. No profile, request, or ledger row stores a Jalali value.

Rows are generated by scripts/gen-jalali-months.mjs from react-date-object.
Tests assert structural invariants and a Gregorian->Jalali round-trip rather
than memorised Nowruz dates, which drift between 20 and 21 March."
```

---

## Task 2: The duration module

**Files:**
- Create: `lib/leave/duration.ts`
- Create: `tests/unit/duration.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `minutesToDaysHours(totalMinutes: number, hoursPerDay: number): { days: number; hours: number; minutes: number }`
  - `formatDuration(totalMinutes: number, hoursPerDay: number, locale: string, labels: DurationLabels): string`
  - `daysToMinutes(days: number, hoursPerDay: number): number`
  - `type DurationLabels = { days: string; hours: string; minutes: string; and: string }`

Labels are injected rather than looked up, so the module stays pure and every caller
shares one implementation. `formatDuration` uses the existing `formatNumber` from
`lib/i18n/format.ts` for Persian digit shaping.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/duration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { minutesToDaysHours, formatDuration, daysToMinutes } from '@/lib/leave/duration';

const EN = { days: 'days', hours: 'hours', minutes: 'minutes', and: 'and' };

describe('minutesToDaysHours', () => {
  it('splits a whole number of days', () => {
    expect(minutesToDaysHours(4320, 8)).toEqual({ days: 9, hours: 0, minutes: 0 });
  });

  it('splits days plus hours — the client 9d4h case', () => {
    expect(minutesToDaysHours(4560, 8)).toEqual({ days: 9, hours: 4, minutes: 0 });
  });

  it('splits a bare part-hour', () => {
    expect(minutesToDaysHours(90, 8)).toEqual({ days: 0, hours: 1, minutes: 30 });
  });

  it('handles zero', () => {
    expect(minutesToDaysHours(0, 8)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });

  it('handles a non-integer workday', () => {
    // 7.5h day = 450 min. 1000 min = 2 days (900) + 1h40m.
    expect(minutesToDaysHours(1000, 7.5)).toEqual({ days: 2, hours: 1, minutes: 40 });
  });

  it('keeps the sign of a negative delta and splits its magnitude', () => {
    expect(minutesToDaysHours(-480, 8)).toEqual({ days: -1, hours: 0, minutes: 0 });
  });
});

describe('formatDuration', () => {
  it('omits zero parts', () => {
    expect(formatDuration(4320, 8, 'en', EN)).toBe('9 days');
    expect(formatDuration(240, 8, 'en', EN)).toBe('4 hours');
  });

  it('joins days and hours', () => {
    expect(formatDuration(4560, 8, 'en', EN)).toBe('9 days and 4 hours');
  });

  it('joins all three parts', () => {
    expect(formatDuration(4590, 8, 'en', EN)).toBe('9 days and 4 hours and 30 minutes');
  });

  it('renders zero as zero days rather than an empty string', () => {
    expect(formatDuration(0, 8, 'en', EN)).toBe('0 days');
  });

  it('shapes Persian digits', () => {
    const FA = { days: 'روز', hours: 'ساعت', minutes: 'دقیقه', and: 'و' };
    expect(formatDuration(4560, 8, 'fa', FA)).toBe('۹ روز و ۴ ساعت');
  });
});

describe('daysToMinutes', () => {
  it('converts whole and half days', () => {
    expect(daysToMinutes(9, 8)).toBe(4320);
    expect(daysToMinutes(0.5, 8)).toBe(240);
  });

  it('rounds to a whole minute', () => {
    // 1/3 of a 7.5h day = 150.0 min exactly; 1/7 of an 8h day rounds.
    expect(daysToMinutes(1 / 7, 8)).toBe(69);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- duration`
Expected: FAIL — `Failed to resolve import "@/lib/leave/duration"`.

- [ ] **Step 3: Write the implementation**

Create `lib/leave/duration.ts`:

```ts
/**
 * Days <-> minutes conversion and rendering. Minutes are the canonical stored
 * unit (spec §5); this module is the ONLY place the conversion may happen.
 *
 * Pure — no I/O, and labels are injected so it carries no i18n dependency.
 */
import { formatNumber } from '@/lib/i18n/format';

export type DurationLabels = {
  days: string;
  hours: string;
  minutes: string;
  and: string;
};

export type DurationParts = {
  days: number;
  hours: number;
  minutes: number;
};

/**
 * Splits a minute total into days/hours/minutes for display.
 * A negative total (a ledger debit) keeps its sign on the days component and
 * splits its magnitude, so -480 at an 8h day reads as -1 day, not -1d 0h with a
 * positive remainder.
 */
export function minutesToDaysHours(totalMinutes: number, hoursPerDay: number): DurationParts {
  const minutesPerDay = Math.round(hoursPerDay * 60);
  const sign = totalMinutes < 0 ? -1 : 1;
  const abs = Math.abs(Math.round(totalMinutes));

  const days = Math.floor(abs / minutesPerDay);
  const afterDays = abs - days * minutesPerDay;
  const hours = Math.floor(afterDays / 60);
  const minutes = afterDays - hours * 60;

  return { days: sign * days, hours: sign * hours, minutes: sign * minutes };
}

/** Renders "۹ روز و ۴ ساعت" / "9 days and 4 hours". Zero renders as "0 days". */
export function formatDuration(
  totalMinutes: number,
  hoursPerDay: number,
  locale: string,
  labels: DurationLabels
): string {
  const { days, hours, minutes } = minutesToDaysHours(totalMinutes, hoursPerDay);
  const parts: string[] = [];

  if (days !== 0) parts.push(`${formatNumber(days, locale)} ${labels.days}`);
  if (hours !== 0) parts.push(`${formatNumber(hours, locale)} ${labels.hours}`);
  if (minutes !== 0) parts.push(`${formatNumber(minutes, locale)} ${labels.minutes}`);

  if (parts.length === 0) return `${formatNumber(0, locale)} ${labels.days}`;
  return parts.join(` ${labels.and} `);
}

/** Only for converting admin day-denominated input (allocations) into minutes. */
export function daysToMinutes(days: number, hoursPerDay: number): number {
  return Math.round(days * hoursPerDay * 60);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- duration`
Expected: PASS, 12 tests.

- [ ] **Step 5: Add the label keys to both locales**

In `messages/en.json`, inside the `"leave"` object which currently ends with `"days": "days"`:

```json
    "days": "days",
    "hours": "hours",
    "minutes": "minutes",
    "and": "and"
```

In `messages/fa.json`, the same object currently ending with `"days": "روز"`:

```json
    "days": "روز",
    "hours": "ساعت",
    "minutes": "دقیقه",
    "and": "و"
```

- [ ] **Step 6: Verify the whole unit suite and the lint gate**

Run: `npm run test:unit`
Expected: PASS — every pre-existing test plus the new `duration` and `jalaliMonths` files. **Record the total count**; it is the baseline for the rest of this plan (CLAUDE.md says 103, `docs/MEMORY.md` says 130, a static grep says 146 — none of them has been trusted, so measure it).

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/leave/duration.ts tests/unit/duration.test.ts messages/fa.json messages/en.json
git commit -m "feat(leave): days<->minutes conversion and days-and-hours rendering

Minutes become the canonical stored unit (spec section 5), so one pure module
owns the conversion and every caller shares it. Labels are injected rather than
looked up, which keeps the module free of i18n dependencies and testable.

Renders the client's own vocabulary from the paper daily form: HR writes
'... بمدت __ روز و __ ساعت', so balances now read '9 روز و 4 ساعت'.

Negative totals keep their sign on the days component, since ledger deltas are
signed and -480 must read as -1 day."
```

---

## Task 3: Expand — minutes columns, backfill, sync triggers

**Files:**
- Create: `supabase/migrations/20260729130002_leave_minutes_expand.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks (SQL only).
- Produces: `leave_ledger.delta_minutes int not null`, `leave_ledger.balance_after_minutes int not null`, `leave_requests.requested_minutes int not null`, `leave_allocations.allocated_minutes int not null`, `work_settings.hours_per_day numeric not null default 8`. Day columns still exist and remain authoritative until Task 5.

**Why triggers instead of rewriting six functions now:** the expand phase must not change behaviour. Three three-line triggers keep the new columns correct for every write the existing functions make, so the app, the suite, and the client's server all keep working while the columns are proven. Task 5 then rewrites the functions once, natively, and drops the triggers.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729130002_leave_minutes_expand.sql`:

```sql
-- =============================================================================
-- Migration: 20260729130002_leave_minutes_expand.sql
-- Purpose  : EXPAND phase of the days -> minutes conversion (spec §5). Adds the
--            minutes columns, backfills them, and keeps them in sync with the
--            day columns via triggers. Behaviour is unchanged: the day columns
--            stay authoritative until the CONTRACT migration (…130003).
--
--            Split expand/contract deliberately: this runs against the client's
--            live balances, so the schema must be provably correct before any
--            function is rewritten or any column dropped.
--
-- Backfill constant is 480 (8h × 60) ON PURPOSE, not work_settings.hours_per_day:
-- history was recorded when a day meant 8 hours, and an admin later setting a
-- 7.5h day must not retroactively shift past balances.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. work_settings.hours_per_day — what a "day" of leave means going forward
-- ---------------------------------------------------------------------------
alter table public.work_settings
  add column if not exists hours_per_day numeric not null default 8
    constraint work_settings_hours_per_day_sane check (hours_per_day > 0 and hours_per_day <= 24);

-- ---------------------------------------------------------------------------
-- 2. Minutes columns, nullable at first so the backfill can populate them
-- ---------------------------------------------------------------------------
alter table public.leave_ledger
  add column if not exists delta_minutes         int,
  add column if not exists balance_after_minutes int;

alter table public.leave_requests
  add column if not exists requested_minutes int;

alter table public.leave_allocations
  add column if not exists allocated_minutes int;

-- ---------------------------------------------------------------------------
-- 3. Backfill. Existing values are whole days or .5, so ×480 is exact.
-- ---------------------------------------------------------------------------
update public.leave_ledger
   set delta_minutes         = round(delta_days * 480),
       balance_after_minutes = round(balance_after * 480)
 where delta_minutes is null or balance_after_minutes is null;

update public.leave_requests
   set requested_minutes = round(requested_days * 480)
 where requested_minutes is null;

update public.leave_allocations
   set allocated_minutes = round(allocated_days * 480)
 where allocated_minutes is null;

-- ---------------------------------------------------------------------------
-- 4. Now enforce NOT NULL
-- ---------------------------------------------------------------------------
alter table public.leave_ledger      alter column delta_minutes         set not null;
alter table public.leave_ledger      alter column balance_after_minutes set not null;
alter table public.leave_requests    alter column requested_minutes     set not null;
alter table public.leave_allocations alter column allocated_minutes     set not null;

-- ---------------------------------------------------------------------------
-- 5. Sync triggers. The existing definer functions write only the day columns;
--    these fill the minutes columns from them. Dropped in …130003 once the
--    functions write minutes natively.
--    Direction is days -> minutes only: days remain authoritative this phase.
-- ---------------------------------------------------------------------------
create or replace function public.leave_ledger_sync_minutes()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.delta_minutes         := round(new.delta_days * 480);
  new.balance_after_minutes := round(new.balance_after * 480);
  return new;
end; $$;

create or replace trigger leave_ledger_sync_minutes_trg
  before insert or update on public.leave_ledger
  for each row execute function public.leave_ledger_sync_minutes();

create or replace function public.leave_requests_sync_minutes()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.requested_minutes := round(new.requested_days * 480);
  return new;
end; $$;

create or replace trigger leave_requests_sync_minutes_trg
  before insert or update on public.leave_requests
  for each row execute function public.leave_requests_sync_minutes();

create or replace function public.leave_allocations_sync_minutes()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.allocated_minutes := round(new.allocated_days * 480);
  return new;
end; $$;

create or replace trigger leave_allocations_sync_minutes_trg
  before insert or update on public.leave_allocations
  for each row execute function public.leave_allocations_sync_minutes();
```

- [ ] **Step 2: Apply it locally**

```bash
docker exec -i bj-erp-db-1 psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -f - < supabase/migrations/20260729130002_leave_minutes_expand.sql
```
Expected: `ALTER TABLE` / `UPDATE` / `CREATE FUNCTION` / `CREATE TRIGGER` lines, no `ERROR`.
The `UPDATE` counts should be non-zero on the first run (27 ledger rows exist) and `UPDATE 0` on a
replay — that is the guarded backfill proving itself idempotent.

- [ ] **Step 3: Run the acceptance query — this is the gate for the whole plan**

```bash
docker exec bj-erp-db-1 psql -U postgres -d postgres -c "
select
  (select count(*) from public.leave_ledger      where balance_after_minutes <> round(balance_after * 480)) as bad_balances,
  (select count(*) from public.leave_ledger      where delta_minutes         <> round(delta_days * 480))    as bad_deltas,
  (select count(*) from public.leave_requests    where requested_minutes     <> round(requested_days * 480)) as bad_requests,
  (select count(*) from public.leave_allocations where allocated_minutes     <> round(allocated_days * 480)) as bad_allocations;"
```

Expected: all four columns `0`.

**Save this query** — §10.3 of the spec requires running it against a dump of the client's live database before this ships, and it is the same query.

- [ ] **Step 4: Prove the triggers work on a fresh write**

Run the demo seed, which allocates leave through `allocate_leave`:

```bash
npm run seed
```

Then re-run the Step 3 acceptance query.
Expected: still all `0` — the trigger populated minutes for rows written after the backfill.

- [ ] **Step 5: Verify nothing regressed**

Run: `npm run test:unit`
Expected: PASS at the baseline count from Task 2 Step 6.

Run: `npm run build`
Expected: success. The app still reads the day columns, which still exist.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260729130002_leave_minutes_expand.sql
git commit -m "feat(leave): add minutes columns and backfill (expand phase)

First half of the days -> minutes conversion (spec section 5). Adds
delta_minutes, balance_after_minutes, requested_minutes, allocated_minutes and
work_settings.hours_per_day, backfills them, and keeps them correct via three
sync triggers. Behaviour is unchanged: the day columns stay authoritative until
the contract migration.

Expand and contract are split on purpose. This runs against the client's live
balances, so the new columns are proven correct before any SECURITY DEFINER
function is rewritten or any column dropped, and every intermediate state is
deployable.

The backfill constant is a literal 480, not work_settings.hours_per_day:
history was recorded when a day meant 8 hours, and an admin later configuring a
7.5h day must not retroactively shift past balances."
```

---

## Task 4: Switch every app read to minutes

**Files:**
- Modify: `lib/supabase/types.ts` (regenerated)
- Modify: `lib/leave/balances.ts`
- Modify: `tests/unit/balances.test.ts`
- Modify: `lib/actions/leave.ts:188-245` (`LeaveRequestWithType`, `getMyLeaveRequests`, `getMyBalance`), `:401-460` (approval queue), `:505-588` (`getMyBalances`, `getEmployeeBalances`)
- Modify: `app/[locale]/(app)/home/HomeBoard.tsx:88,117`
- Modify: `app/[locale]/(app)/request/MyRequestsList.tsx:131`
- Modify: `app/[locale]/(app)/manage/approvals/ApprovalQueue.tsx:106`

**Interfaces:**
- Consumes: `formatDuration`, `minutesToDaysHours` from `lib/leave/duration.ts` (Task 2); the minutes columns from Task 3.
- Produces: `BalanceItem.balanceMinutes: number` replacing `BalanceItem.balance`; `LeaveRequestWithType.requested_minutes: number` replacing `requested_days`; a `hoursPerDay: number` field on the `WorkSettings` type already exported from `lib/actions/leave.ts`.

- [ ] **Step 1: Regenerate the database types**

Run: `npx supabase gen types typescript --local > lib/supabase/types.ts`
Expected: the file now contains `delta_minutes`, `balance_after_minutes`, `requested_minutes`, `allocated_minutes`, `hours_per_day`, and the `jalali_months` table. The day columns are still present — Task 5 removes them.

Verify: `grep -c "balance_after_minutes\|requested_minutes\|hours_per_day" lib/supabase/types.ts`
Expected: a non-zero count.

- [ ] **Step 2: Update the failing test first**

Rewrite `tests/unit/balances.test.ts` to the minutes field:

```ts
import { describe, it, expect } from 'vitest';
import { latestBalances } from '@/lib/leave/balances';

describe('latestBalances', () => {
  it('keeps the latest balance per leave type', () => {
    const rows = [
      { leave_type_id: 'a', balance_after_minutes: 12480, created_at: '2026-01-01T00:00:00Z' },
      { leave_type_id: 'a', balance_after_minutes: 11520, created_at: '2026-06-01T00:00:00Z' },
      { leave_type_id: 'b', balance_after_minutes: 4800, created_at: '2026-03-01T00:00:00Z' },
    ];
    expect(latestBalances(rows)).toEqual({ a: 11520, b: 4800 });
  });

  it('handles unsorted rows', () => {
    const rows = [
      { leave_type_id: 'a', balance_after_minutes: 11520, created_at: '2026-06-01T00:00:00Z' },
      { leave_type_id: 'a', balance_after_minutes: 12480, created_at: '2026-01-01T00:00:00Z' },
    ];
    expect(latestBalances(rows)).toEqual({ a: 11520 });
  });

  it('empty -> {}', () => expect(latestBalances([])).toEqual({}));
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:unit -- balances`
Expected: FAIL — TypeScript rejects `balance_after_minutes` because `latestBalances` still expects `balance_after`.

- [ ] **Step 4: Update `lib/leave/balances.ts`**

Replace the file body with:

```ts
/**
 * Pure leave-balance helpers. No I/O — unit-tested.
 * `BalanceItem` lives here (the neutral module) so both the home view-model
 * (lib/home/board.ts) and the getMyBalances action (lib/actions/leave.ts) can
 * import it without a circular dependency.
 *
 * Balances are integer MINUTES (spec §5). Render via lib/leave/duration.ts —
 * never divide by a workday length outside that module.
 */

export type BalanceItem = {
  leaveTypeId: string;
  name_fa: string;
  name_en: string | null;
  balanceMinutes: number;
};

/** Latest `balance_after_minutes` per leave type, from (possibly unsorted) ledger rows. */
export function latestBalances(
  rows: { leave_type_id: string; balance_after_minutes: number; created_at: string }[]
): Record<string, number> {
  const latest: Record<string, { balance: number; at: string }> = {};
  for (const r of rows) {
    const prev = latest[r.leave_type_id];
    if (!prev || r.created_at > prev.at) {
      latest[r.leave_type_id] = { balance: r.balance_after_minutes, at: r.created_at };
    }
  }
  return Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, v.balance]));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:unit -- balances`
Expected: PASS, 3 tests.

- [ ] **Step 6: Update the server actions**

In `lib/actions/leave.ts`:

1. `LeaveRequestWithType` — replace `requested_days: number;` with `requested_minutes: number;`
2. `getMyLeaveRequests` select string — replace `requested_days` with `requested_minutes`
3. `getMyBalance` — change the select and the return:

```ts
  const { data, error } = await supabase
    .from('leave_ledger')
    .select('balance_after_minutes')
    .eq('employee_id', user.id)
    .eq('leave_type_id', leaveTypeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return dbErr(error.message);

  return { ok: true, balanceMinutes: data?.balance_after_minutes ?? null };
```

Update its return type to `{ ok: true; balanceMinutes: number | null }`.

4. `getMyBalances` and `getEmployeeBalances` — the ledger select becomes
   `.select('leave_type_id, balance_after_minutes, created_at')`, and the mapped item becomes
   `balanceMinutes: byType[t.id] ?? 0`.
5. The approval-queue query near `:419` — replace `requested_days` with `requested_minutes` in
   both the select string and the row type, and in the mapped object at `:448`.
6. The `WorkSettings` type and its loader near `:315` — add `hoursPerDay`, defaulting to 8 to match
   the SQL default:

```ts
      hoursPerDay: ws?.hours_per_day ?? 8,
```

and add `hours_per_day` to that query's `select`.

- [ ] **Step 7: Update the three display sites**

`app/[locale]/(app)/home/HomeBoard.tsx` — the balance line at `:88` and the request duration at `:117`. Import the helper and the labels:

```tsx
import { formatDuration } from '@/lib/leave/duration';
```

Balance (was `{formatNumber(b.balance, locale)}`):

```tsx
{formatDuration(b.balanceMinutes, hoursPerDay, locale, durationLabels)}
```

Request duration (was `{formatNumber(r.requested_days, locale)} {labels.days}`):

```tsx
{formatDuration(r.requested_minutes, hoursPerDay, locale, durationLabels)}
```

`durationLabels` is `{ days, hours, minutes, and }` read from the `leave` message namespace by the server component that renders `HomeBoard`, and passed in alongside the existing `labels` prop; `hoursPerDay` comes from the work-settings read. Follow the file's existing pattern of passing resolved strings down as props rather than calling `useTranslations` in the client component.

Apply the identical substitution at `app/[locale]/(app)/request/MyRequestsList.tsx:131` and
`app/[locale]/(app)/manage/approvals/ApprovalQueue.tsx:106`.

- [ ] **Step 8: Update the request form's balance preview**

`app/[locale]/(app)/request/LeaveRequestForm.tsx` — `getMyBalance` now returns `balanceMinutes`, so:

- `const [balance, setBalance] = useState<number | null>(null)` becomes `balanceMinutes`
- the fetch sets `res.ok ? res.balanceMinutes : null`
- the preview line renders
  `` `${labels.remainingBalanceLabel}: ${formatDuration(effectiveBalance, hoursPerDay, locale, durationLabels)}` ``
  and drops the now-redundant `{labels.days}` suffix.

The working-days count preview keeps using `countWorkingDays` and `labels.days` — this task does not touch day counting.

- [ ] **Step 9: Verify the full gate**

Run: `npm run test:unit`
Expected: PASS at the baseline count.

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: success. A `requested_days` or `.balance` reference left anywhere will fail the type check here — that is the intended safety net.

Run: `npm run test:e2e -- --workers=1`
Expected: PASS at the baseline e2e count. Needs the local Supabase stack and a dev server; see CLAUDE.md.

- [ ] **Step 10: Commit**

```bash
git add lib/supabase/types.ts lib/leave/balances.ts tests/unit/balances.test.ts \
        lib/actions/leave.ts app/\[locale\]/\(app\)/home/HomeBoard.tsx \
        app/\[locale\]/\(app\)/request/MyRequestsList.tsx \
        app/\[locale\]/\(app\)/request/LeaveRequestForm.tsx \
        app/\[locale\]/\(app\)/manage/approvals/ApprovalQueue.tsx
git commit -m "feat(leave): read balances and durations in minutes

Switches every read path to the minutes columns and renders durations as days
and hours through lib/leave/duration.ts. Balances now display the way the
client's own paper form words them.

The day columns still exist, so this commit is deployable on its own; the
contract migration removes them next. TypeScript is the safety net here: a
missed requested_days or .balance reference fails the build rather than
silently rendering a wrong number."
```

---

## Task 5: Contract — functions write minutes, day columns dropped

**Files:**
- Create: `supabase/migrations/20260729130003_leave_minutes_contract.sql`
- Modify: `lib/actions/leave.ts` (`allocateLeave`, `setLeaveBalance` parameter renames)
- Modify: `app/[locale]/(app)/manage/employees/new/NewEmployeeForm.tsx` (allocation block sends minutes)
- Modify: `lib/leave/workingDays.ts` + `tests/unit/workingDays.test.ts` (add `countWorkingMinutes`)
- Modify: `lib/supabase/types.ts` (regenerated)
- Modify: `scripts/seed-demo.mjs`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces: SQL `compute_requested_minutes(p_company_id uuid, p_start date, p_end date, p_day_part public.day_part) returns int`; `current_leave_balance(p_employee_id uuid, p_leave_type_id uuid) returns int` (now minutes); `allocate_leave(p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_minutes int) returns uuid`; `set_leave_balance(p_employee_id uuid, p_leave_type_id uuid, p_target_minutes int) returns int`. TS: `countWorkingMinutes(start, end, opts & { hoursPerDay: number }): number`.

**Read before starting:** `supabase/migrations/20260702120001_hardening.sql` is the current definition of four of these functions, and `20260702120003_company_tz_cancel.sql` is the current `cancel_leave_request`. The rewrites below are those bodies with the unit changed — the advisory lock, the overlap guard, the 366-day bound, the error strings, and the audit rows are all preserved deliberately. Do not simplify them.

- [ ] **Step 1: Write the failing test for the TS mirror**

Append to `tests/unit/workingDays.test.ts`:

```ts
import { countWorkingMinutes } from '@/lib/leave/workingDays';

describe('countWorkingMinutes', () => {
  const opts = { weekendDays: [5], holidays: [] as string[], hoursPerDay: 8 };

  it('converts a single full working day', () => {
    // 2026-07-06 is a Monday.
    expect(countWorkingMinutes('2026-07-06', '2026-07-06', { ...opts, dayPart: 'full' })).toBe(480);
  });

  it('halves a half day', () => {
    expect(countWorkingMinutes('2026-07-06', '2026-07-06', { ...opts, dayPart: 'am' })).toBe(240);
  });

  it('skips the weekend across a range', () => {
    // Mon 2026-07-06 .. Sun 2026-07-12 = 7 days, minus Friday = 6 working days.
    expect(countWorkingMinutes('2026-07-06', '2026-07-12', { ...opts, dayPart: 'full' })).toBe(6 * 480);
  });

  it('honours a non-integer workday', () => {
    expect(
      countWorkingMinutes('2026-07-06', '2026-07-06', { ...opts, hoursPerDay: 7.5, dayPart: 'full' })
    ).toBe(450);
  });

  it('returns 0 for a reversed range', () => {
    expect(countWorkingMinutes('2026-07-12', '2026-07-06', { ...opts, dayPart: 'full' })).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- workingDays`
Expected: FAIL — `countWorkingMinutes` is not exported.

- [ ] **Step 3: Add `countWorkingMinutes`**

Append to `lib/leave/workingDays.ts`:

```ts
/**
 * Minutes equivalent of countWorkingDays, mirroring SQL compute_requested_minutes.
 * Must stay in lockstep with that function (spec §7.2).
 */
export function countWorkingMinutes(
  start: string,
  end: string,
  opts: {
    weekendDays: number[];
    holidays: string[];
    dayPart: 'full' | 'am' | 'pm';
    hoursPerDay: number;
  }
): number {
  const days = countWorkingDays(start, end, opts);
  return Math.round(days * opts.hoursPerDay * 60);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:unit -- workingDays`
Expected: PASS — the new 5 tests plus the file's existing ones.

- [ ] **Step 5: Write the contract migration**

Create `supabase/migrations/20260729130003_leave_minutes_contract.sql`:

```sql
-- =============================================================================
-- Migration: 20260729130003_leave_minutes_contract.sql
-- Purpose  : CONTRACT phase of the days -> minutes conversion (spec §5).
--            Rewrites every SECURITY DEFINER leave function to write integer
--            minutes natively, then drops the sync triggers and the day columns.
--            After this migration no fractional day survives in the schema.
--
-- Sources  : function bodies are ported from 20260702120001_hardening.sql and
--            20260702120003_company_tz_cancel.sql with the unit changed. The
--            advisory lock, overlap guard, 366-day bound, error strings, and
--            audit rows are preserved verbatim — they are the 2026-07-02
--            hardening and must not be simplified.
--
-- Breaking : allocate_leave(p_days numeric) -> allocate_leave(p_minutes int)
--            set_leave_balance(p_target numeric) -> (p_target_minutes int)
--            compute_requested_days() -> compute_requested_minutes()
--            current_leave_balance() now returns minutes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the expand-phase sync triggers — the functions write minutes now.
-- ---------------------------------------------------------------------------
drop trigger if exists leave_ledger_sync_minutes_trg      on public.leave_ledger;
drop trigger if exists leave_requests_sync_minutes_trg    on public.leave_requests;
drop trigger if exists leave_allocations_sync_minutes_trg on public.leave_allocations;
drop function if exists public.leave_ledger_sync_minutes();
drop function if exists public.leave_requests_sync_minutes();
drop function if exists public.leave_allocations_sync_minutes();

-- ---------------------------------------------------------------------------
-- 2. compute_requested_minutes — replaces compute_requested_days.
--    Reads hours_per_day from work_settings, so the same range yields different
--    minutes for a 7.5h company. Half-day = half of a workday.
-- ---------------------------------------------------------------------------
create or replace function public.compute_requested_minutes(
  p_company_id uuid, p_start date, p_end date, p_day_part public.day_part
) returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  v_weekend  int[];
  v_per_day  numeric;
  v_count    numeric := 0;
  d          date;
  v_working  boolean;
begin
  if p_end < p_start then return 0; end if;

  select weekend_days, hours_per_day into v_weekend, v_per_day
    from public.work_settings where company_id = p_company_id limit 1;
  if v_weekend is null then v_weekend := '{5}'; end if;
  if v_per_day is null then v_per_day := 8; end if;

  if p_day_part in ('am', 'pm') then
    if p_start <> p_end then return 0; end if;
    v_working := (extract(isodow from p_start)::int <> all (v_weekend))
                 and not exists (select 1 from public.holidays h
                                 where h.company_id = p_company_id and h.holiday_date = p_start);
    return case when v_working then round(v_per_day * 60 / 2) else 0 end;
  end if;

  d := p_start;
  while d <= p_end loop
    if (extract(isodow from d)::int <> all (v_weekend))
       and not exists (select 1 from public.holidays h
                       where h.company_id = p_company_id and h.holiday_date = d)
    then
      v_count := v_count + 1;
    end if;
    d := d + 1;
  end loop;

  return round(v_count * v_per_day * 60);
end; $$;

drop function if exists public.compute_requested_days(uuid, date, date, public.day_part);

-- ---------------------------------------------------------------------------
-- 3. current_leave_balance — now minutes.
-- ---------------------------------------------------------------------------
create or replace function public.current_leave_balance(p_employee_id uuid, p_leave_type_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((
    select balance_after_minutes from public.leave_ledger
    where employee_id = p_employee_id and leave_type_id = p_leave_type_id
    order by created_at desc, id desc limit 1
  ), 0);
$$;

-- ---------------------------------------------------------------------------
-- 4. allocate_leave — p_days numeric -> p_minutes int.
-- ---------------------------------------------------------------------------
drop function if exists public.allocate_leave(uuid, uuid, date, date, numeric);

create or replace function public.allocate_leave(
  p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_minutes int
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prev int; v_alloc uuid;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can allocate leave' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'allocation days must be greater than 0' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  insert into public.leave_allocations(employee_id, leave_type_id, period_start, period_end, allocated_minutes, created_by)
  values (p_employee_id, p_leave_type_id, p_period_start, p_period_end, p_minutes, auth.uid())
  returning id into v_alloc;

  v_prev := public.current_leave_balance(p_employee_id, p_leave_type_id);
  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (p_employee_id, p_leave_type_id, 'allocation', p_minutes, v_prev + p_minutes, 'allocation');

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'allocate_leave', 'leave_allocations', v_alloc,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id, 'minutes', p_minutes));
  return v_alloc;
end; $$;

-- ---------------------------------------------------------------------------
-- 5. submit_leave_request — minutes, everything else preserved.
-- ---------------------------------------------------------------------------
create or replace function public.submit_leave_request(
  p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_reason text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_minutes int; v_affects boolean; v_balance int; v_req uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id into v_company from public.profiles where id = v_uid;
  if v_company is null then raise exception 'no profile for caller' using errcode = '42501'; end if;

  if p_start is null or p_end is null then
    raise exception 'start and end dates are required' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'date range too long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));

  if exists (
    select 1 from public.leave_requests
    where employee_id = v_uid
      and status in ('pending', 'approved')
      and start_date <= p_end
      and end_date >= p_start
  ) then
    raise exception 'overlapping leave request exists' using errcode = '22023';
  end if;

  v_minutes := public.compute_requested_minutes(v_company, p_start, p_end, p_day_part);
  if v_minutes <= 0 then
    raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)' using errcode = '22023';
  end if;

  select affects_balance into v_affects from public.leave_types where id = p_leave_type_id and company_id = v_company and active;
  if v_affects is null then raise exception 'invalid or inactive leave type' using errcode = '22023'; end if;

  if v_affects then
    v_balance := public.current_leave_balance(v_uid, p_leave_type_id);
    if v_minutes > v_balance then
      raise exception 'insufficient balance: % day(s) requested, % available', v_minutes, v_balance using errcode = '22023';
    end if;
  end if;

  insert into public.leave_requests(employee_id, leave_type_id, start_date, end_date, day_part, requested_minutes, status, reason)
  values (v_uid, p_leave_type_id, p_start, p_end, p_day_part, v_minutes, 'pending', p_reason)
  returning id into v_req;
  return v_req;
end; $$;

-- ---------------------------------------------------------------------------
-- 6. approve_leave_request — minutes.
-- ---------------------------------------------------------------------------
create or replace function public.approve_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_emp     uuid;
  v_type    uuid;
  v_minutes int;
  v_status  public.leave_status;
  v_start   date;
  v_end     date;
  v_affects boolean;
  v_prev    int;
  v_rows    int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id into v_emp from public.leave_requests where id = p_id;
  if v_emp is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_emp::text, 0));

  select leave_type_id, requested_minutes, status, start_date, end_date
    into v_type, v_minutes, v_status, v_start, v_end
    from public.leave_requests where id = p_id;

  if v_status <> 'pending' then
    raise exception 'only pending requests can be approved' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.leave_requests
    where employee_id = v_emp and id <> p_id and status = 'approved'
      and start_date <= v_end and end_date >= v_start
  ) then
    raise exception 'overlapping approved leave exists' using errcode = '22023';
  end if;

  select affects_balance into v_affects from public.leave_types where id = v_type;
  if v_affects then
    v_prev := public.current_leave_balance(v_emp, v_type);
    if v_minutes > v_prev then
      raise exception 'insufficient balance: % day(s) requested, % available', v_minutes, v_prev using errcode = '22023';
    end if;
  end if;

  update public.leave_requests
     set status = 'approved', decided_by = v_uid, decided_at = now()
   where id = p_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'request was already decided' using errcode = '22023';
  end if;

  if v_affects then
    insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type, delta_minutes, balance_after_minutes, note)
    values (v_emp, v_type, p_id, 'consumption', -v_minutes, v_prev - v_minutes, 'consumption on approval');
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'approve_leave_request', 'leave_requests', p_id,
          jsonb_build_object('employee_id', v_emp, 'minutes', v_minutes, 'affects_balance', coalesce(v_affects, false)));
end; $$;

-- ---------------------------------------------------------------------------
-- 7. cancel_leave_request — minutes. Company-timezone "today" preserved.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_status  public.leave_status;
  v_start   date;
  v_type    uuid;
  v_minutes int;
  v_affects boolean;
  v_prev    int;
  v_rows    int;
  v_today   date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id into v_owner from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (v_owner = v_uid or private.is_admin(v_uid)) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_minutes
    into v_status, v_start, v_type, v_minutes
    from public.leave_requests where id = p_id;

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  elsif v_status = 'approved' and v_start > v_today then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type, delta_minutes, balance_after_minutes, note)
      values (v_owner, v_type, p_id, 'reversal', v_minutes, v_prev + v_minutes, 'reversal on cancel');
    end if;

  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled' using errcode = '22023';
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'cancel_leave_request', 'leave_requests', p_id,
          jsonb_build_object('status_before', v_status, 'minutes', v_minutes,
                             'reversed', (v_status = 'approved')));
end; $$;

-- ---------------------------------------------------------------------------
-- 8. set_leave_balance — p_target numeric -> p_target_minutes int.
-- ---------------------------------------------------------------------------
drop function if exists public.set_leave_balance(uuid, uuid, numeric);

create or replace function public.set_leave_balance(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_target_minutes int
) returns int language plpgsql security definer set search_path = '' as $$
declare
  v_current int;
  v_ledger uuid;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can set leave balance' using errcode = '42501';
  end if;

  if p_target_minutes is null or p_target_minutes < 0 then
    raise exception 'target balance must be >= 0' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);

  if v_current = p_target_minutes then
    return p_target_minutes;
  end if;

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_target_minutes - v_current, p_target_minutes, 'admin balance set')
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_leave_balance', 'leave_ledger', v_ledger,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'previous_minutes', v_current, 'target_minutes', p_target_minutes));

  return p_target_minutes;
end; $$;

-- ---------------------------------------------------------------------------
-- 9. Grants — unchanged intent: internal helpers revoked, write fns for
--    authenticated only (self-guarded), anon always revoked.
-- ---------------------------------------------------------------------------
revoke execute on function public.compute_requested_minutes(uuid, date, date, public.day_part) from public, anon, authenticated;
revoke execute on function public.current_leave_balance(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.allocate_leave(uuid, uuid, date, date, int) from public, anon;
grant  execute on function public.allocate_leave(uuid, uuid, date, date, int) to authenticated;
revoke execute on function public.submit_leave_request(uuid, date, date, public.day_part, text) from public, anon;
grant  execute on function public.submit_leave_request(uuid, date, date, public.day_part, text) to authenticated;
revoke execute on function public.approve_leave_request(uuid) from public, anon;
grant  execute on function public.approve_leave_request(uuid) to authenticated;
revoke execute on function public.cancel_leave_request(uuid) from public, anon;
grant  execute on function public.cancel_leave_request(uuid) to authenticated;
revoke execute on function public.set_leave_balance(uuid, uuid, int) from public, anon;
grant  execute on function public.set_leave_balance(uuid, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Drop the day columns. team_leave_calendar selects requested_days, so it
--     is recreated first — same shape, minutes instead of days.
-- ---------------------------------------------------------------------------
drop view if exists public.team_leave_calendar;

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
    lr.requested_minutes,
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

revoke all    on public.team_leave_calendar from public, anon;
grant  select on public.team_leave_calendar to authenticated;

alter table public.leave_ledger      drop column if exists delta_days,
                                     drop column if exists balance_after;
alter table public.leave_requests    drop column if exists requested_days;
alter table public.leave_allocations drop column if exists allocated_days;
```

**Note on the view:** it is intentionally recreated *without* `security_invoker`, so it keeps running as owner and bypassing the strict base-table RLS — the FR-25 design from `20260624090002`. `reason` and `decision_note` stay unselected. Do not add them.

- [ ] **Step 6: Apply and verify the schema is clean**

```bash
docker exec -i bj-erp-db-1 psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -f - < supabase/migrations/20260729130003_leave_minutes_contract.sql
```
Expected: no `ERROR`. Replay it once more to confirm idempotency (`drop … if exists`,
`create or replace`, `drop column if exists`).

Run — no day column may survive:
```bash
docker exec bj-erp-db-1 psql -U postgres -d postgres -c "
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and column_name in ('delta_days','balance_after','requested_days','allocated_days');"
```
Expected: `(0 rows)`

- [ ] **Step 7: Update the callers of the renamed RPCs**

`lib/actions/leave.ts`:

- `AllocateLeaveInput.days: number` → `minutes: number`; the rpc call passes `p_minutes: input.minutes`.
- `setLeaveBalance`'s input and its rpc call pass `p_target_minutes`.

`app/[locale]/(app)/manage/employees/new/NewEmployeeForm.tsx` — the allocation block at `:107`
still collects **days** from the admin (that is the right unit for a yearly entitlement); convert at
the boundary:

```tsx
import { daysToMinutes } from '@/lib/leave/duration';

const requestedAllocations = isAdmin
  ? leaveTypes
      .map((type) => ({
        typeId: type.id,
        minutes: daysToMinutes(Number(fd.get(`alloc_${type.id}`) || 0), hoursPerDay),
      }))
      .filter((allocation) => allocation.minutes > 0)
  : [];
```

`hoursPerDay` is passed into the form from its server page, read from `work_settings` the same way
`leaveTypes` already is.

`scripts/seed-demo.mjs` — `ensureAllocation(empId, leaveTypeId, days)` becomes minutes-aware:

```js
async function ensureAllocation(empId, leaveTypeId, days) {
  // ... existing ledger-exists check unchanged ...
  const { error } = await supa.rpc('allocate_leave', {
    p_employee_id: empId,
    p_leave_type_id: leaveTypeId,
    p_period_start: '2026-01-01',
    p_period_end: '2026-12-31',
    p_minutes: Math.round(days * 8 * 60),
  });
  if (error) die('allocate failed:', error);
}
```

The literal 8 is correct here: the demo seed defines its own world, and `work_settings.hours_per_day`
defaults to 8.

- [ ] **Step 8: Regenerate types and run the full gate**

Run: `npx supabase gen types typescript --local > lib/supabase/types.ts`
Expected: no `requested_days`/`balance_after`/`delta_days`/`allocated_days` anywhere.

Verify: `grep -c "requested_days\|balance_after\b\|delta_days\|allocated_days" lib/supabase/types.ts`
Expected: `0`

Run: `npm run test:unit`
Expected: PASS at the baseline count.

Run: `npm run lint && npm run build`
Expected: both succeed.

Run: `npm run seed`
Expected: succeeds against the renamed RPC.

Run: `npm run test:e2e -- --workers=1`
Expected: PASS at the baseline e2e count. The approval, cancel-approved, and overlap-error specs are the ones that exercise the rewritten functions — if any fails, the port is wrong, not the test.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260729130003_leave_minutes_contract.sql \
        lib/supabase/types.ts lib/actions/leave.ts lib/leave/workingDays.ts \
        tests/unit/workingDays.test.ts scripts/seed-demo.mjs \
        app/\[locale\]/\(app\)/manage/employees/new/NewEmployeeForm.tsx
git commit -m "feat(leave)!: store leave in integer minutes (contract phase)

Completes the days -> minutes conversion (spec section 5). The SECURITY DEFINER
functions now write minutes natively, the expand-phase sync triggers are gone,
and the day columns are dropped -- no fractional day survives in the schema.

Breaking RPC changes: allocate_leave takes p_minutes, set_leave_balance takes
p_target_minutes, compute_requested_days becomes compute_requested_minutes, and
current_leave_balance returns minutes. All callers are updated in this commit.

Function bodies are ports of the 2026-07-02 hardening with the unit changed:
the per-employee advisory lock, overlap guards, 366-day bound, error strings,
and audit rows are preserved deliberately.

team_leave_calendar is recreated for the column change, still without
security_invoker and still without reason or decision_note, per FR-25."
```

---

## Task 6: Documentation and the deployment dry-run

**Files:**
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/TASKS.md`
- Modify: `docs/AGENT-LOG.md`
- Modify: `docs/specs/2026-07-29-hourly-accrual-replacement-design.md` (row-count correction)
- Create: `docs/plans/2026-07-29-leave-v2-foundations-acceptance.sql`

**Interfaces:**
- Consumes: everything above.
- Produces: the acceptance script the client-server upgrade will run.

- [ ] **Step 1: Confirm the spec's row count is right**

The spec originally said 600 rows; 1400–1450 inclusive is 51 years × 12 = **612**. This was
corrected in the spec when the plan was written. Verify it stuck:

Run: `grep -c "612" docs/specs/2026-07-29-hourly-accrual-replacement-design.md`
Expected: `2` (§4 body and the accrual cost note). If a `600` remains, fix it.

- [ ] **Step 2: Update `docs/DATA_MODEL.md`**

- Add `jalali_months` under a new "Reference tables" heading, with the convention-1 exception and
  its rationale stated inline.
- Change the `leave_ledger`, `leave_requests`, and `leave_allocations` entries to the minutes
  columns, and state that balance = latest `balance_after_minutes`.
- Add `hours_per_day` to `work_settings`.
- Replace the "Working-day counting" pseudocode with the minutes version, and note that 480 is the
  frozen historical backfill constant while `hours_per_day` governs new writes.
- Delete the "*Hourly later*" note on `leave_requests` — hourly lands in the next plan, and the
  reserved-column sentence is now misleading.

- [ ] **Step 3: Update `docs/CHANGELOG.md` and `docs/TASKS.md`**

CHANGELOG, under `## [Unreleased]`:

```markdown
### Changed
- **Leave is now stored in integer minutes** instead of fractional days. Balances render as
  "۹ روز و ۴ ساعت", matching the wording HR uses on the paper daily form. Migration is
  expand/contract in three steps so every intermediate state is deployable
  (`20260729130002`, `20260729130003`).

### Added
- `jalali_months` calendar reference table (1400–1450) — the anchor for monthly accrual, the
  carryover boundary, and request serial years.
```

TASKS.md: add the Leave v2 phase with Foundations checked off and the four remaining plans listed
(accrual · hourly · replacement · serials).

- [ ] **Step 4: Write the acceptance script for the client upgrade**

Create `docs/plans/2026-07-29-leave-v2-foundations-acceptance.sql`:

```sql
-- Acceptance checks for the days -> minutes conversion (spec §10.3).
-- Run on a COPY of the client's live database, after 20260729130002 and BEFORE
-- 20260729130003 drops the day columns. All four counts must be 0.
select
  (select count(*) from public.leave_ledger      where balance_after_minutes <> round(balance_after * 480)) as bad_balances,
  (select count(*) from public.leave_ledger      where delta_minutes         <> round(delta_days * 480))     as bad_deltas,
  (select count(*) from public.leave_requests    where requested_minutes     <> round(requested_days * 480)) as bad_requests,
  (select count(*) from public.leave_allocations where allocated_minutes     <> round(allocated_days * 480)) as bad_allocations;

-- Every employee's current balance must be unchanged in real terms.
-- Expect (0 rows).
with latest as (
  select distinct on (employee_id, leave_type_id)
         employee_id, leave_type_id, balance_after, balance_after_minutes
    from public.leave_ledger
   order by employee_id, leave_type_id, created_at desc, id desc
)
select * from latest where balance_after_minutes <> round(balance_after * 480);

-- Calendar table sanity: 612 contiguous months.
select count(*) as month_rows from public.jalali_months;
select count(*) as gaps from (
  select gregorian_end, lead(gregorian_start) over (order by gregorian_start) nxt
    from public.jalali_months
) t where nxt is not null and nxt <> gregorian_end + 1;
```

- [ ] **Step 5: Append the session entry to `docs/AGENT-LOG.md`**

Use the template at the top of that file. Record: the three migrations, the expand/contract
deviation from the spec's single-migration wording and why, the measured baseline test counts, and
that the client-server upgrade has **not** been run.

- [ ] **Step 6: Final gate**

Run: `npm run test:unit && npm run lint && npm run build`
Expected: all three succeed.

- [ ] **Step 7: Commit**

```bash
git add docs/
git commit -m "docs(leave): record the minutes conversion and calendar table

Updates DATA_MODEL for the minutes columns, hours_per_day, and jalali_months
(including why the calendar dimension is a documented exception to the
never-persist-Jalali convention). Adds the acceptance SQL the client-server
upgrade must run against a dump before the day columns are dropped.

Corrects the spec's row count: 1400-1450 inclusive is 612 months, not 600."
```

---

## Deployment note (do not skip)

This plan ends with a **local** green build. Shipping it to the client's server at
`https://10.10.10.50` is a separate, deliberate step governed by spec §10.3:

1. Dump their database.
2. Apply `…130001` and `…130002` to a local copy of that dump.
3. Run `docs/plans/2026-07-29-leave-v2-foundations-acceptance.sql` — all counts `0`.
4. Only then apply `…130003`.
5. Rehearse the restore-from-dump rollback and time it.
6. Build the release package on **amd64** — `package.sh` has no `--platform` flag
   (`docs/MEMORY.md`), and a Mac-built arm64 image will not run on their VM.

---

## Self-Review

**Spec coverage (§4, §5 only — later phases are separate plans):**

| Spec requirement | Task |
|---|---|
| §4 `jalali_months` table, 1400–1450, join-based | 1 |
| §4 out-of-range raises `date outside supported calendar range` | 1 (`jalali_month_of`) |
| §4 documented convention-1 exception | 1 (migration header), 6 (DATA_MODEL) |
| §5.1 three tables converted to minutes | 3 (expand), 5 (contract) |
| §5.1 backfill ×480, exact | 3 |
| §5.1 RPC signature renames | 5 |
| §5.2 `lib/leave/duration.ts` with all four exports | 2 |
| §5.3 every listed reader updated | 4, 5 |
| §7.2 TS mirror kept in lockstep | 5 (`countWorkingMinutes`) |
| §10.3 acceptance query + rollback + amd64 | 3 (query), 6 (script), Deployment note |

**Deviation from the spec, deliberate:** §5.1 says the day columns are dropped "in the same
migration". This plan splits expand and contract across `…130002` and `…130003` instead. Reason: the
migration runs against the client's live balances, and the split makes every intermediate state
deployable and the conversion verifiable before anything is destroyed. Recorded here, in the
migration headers, and in the AGENT-LOG entry.

**Not in this plan, by design:** accrual (§6), hourly (§7), replacement (§8), serials (§7.6). Each
gets its own plan, in the §10.3 order. `leave_types.allow_hourly` stays `false` until the hourly
plan; nothing here flips it.

**Type consistency:** `balanceMinutes` is the field name in `BalanceItem` (Task 4) and in
`getMyBalance`'s return (Task 4) and in `HomeBoard` (Task 4) — not `balance`, not `balance_minutes`.
`requested_minutes` is the SQL column and the TS field. `hoursPerDay` is the TS prop name for SQL's
`hours_per_day`. `daysToMinutes` is used in exactly two places (Task 5: `NewEmployeeForm`, and the
seed's inline equivalent). `countWorkingMinutes` takes `hoursPerDay` inside its `opts`, matching the
existing `countWorkingDays` signature shape.
