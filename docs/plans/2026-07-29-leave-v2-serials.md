# Leave v2 Serial Numbers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every leave request the human-readable **شماره** the client's paper forms carry — `1404-0042` — so HR can quote a request on the phone, write it on a file, and reference it in an insurance claim.

**Architecture:** A per-(company, Jalali year) counter table, incremented inside the existing writer under the advisory lock already held there, so numbers are gapless and concurrency-safe. Formatting lives in TS; SQL stores the two integers.

**Tech Stack:** Postgres 15 · Next.js 16 App Router + TypeScript · Vitest · Playwright.

## Prerequisite

Plans 1–4 complete. Same branch. This is the last plan of the five.

## Global Constraints

Spec §7.6 plus every constraint from plans 1–4. Specific to this one:

- **Per Jalali year, per company.** `1404-0042` resets to `1405-0001` at Nowruz, matching how the client
  files paper.
- **Gapless and concurrency-safe.** Allocation happens inside `private.submit_leave_impl`, which already
  holds `pg_advisory_xact_lock('leave:<employee>')` — but that lock is *per employee*, so it does **not**
  serialise two different employees submitting at once. The counter therefore needs its own atomicity:
  `insert … on conflict (company_id, jalali_year) do update set last_seq = last_seq + 1 returning last_seq`,
  which takes a row lock on the counter for the duration of the transaction.
- **The Jalali year comes from `jalali_months`**, never from arithmetic — plan 1 exists for this.
- **Formatting is TS-side** (`lib/leave/serial.ts`). SQL stores `serial_year` and `serial_seq` as integers;
  a display string in the database would be a presentation concern leaking into storage.
- Migrations idempotent, applied as `supabase_admin`; `types.ts` hand-edited; fa/en key trees identical.
- **`install.sh` seeds after migrations** — irrelevant here (no seeded rows change), but the rule stands.

---

## Task 1: Counter, columns, and the backfill

**Files:** Create `supabase/migrations/20260729130013_leave_serials.sql`; modify `lib/supabase/types.ts`.

**Produces:** `public.leave_request_serials (company_id uuid, jalali_year int, last_seq int, primary key (company_id, jalali_year))`;
`leave_requests.company_id uuid not null` (backfilled from the employee's profile), `serial_year int`,
`serial_seq int`; unique `(company_id, serial_year, serial_seq)`.

Notes that matter:

- **`company_id` is denormalised onto `leave_requests` deliberately** (spec §7.1): it makes the serial's
  unique index possible without a join, and shortens the company-wide manager queries FR-17 already needs.
- **Backfill order is `created_at`**, grouped by the Jalali year of `start_date`, so existing requests get
  numbers in the order they were actually filed. The counter table is then seeded to `max(serial_seq)` per
  (company, year) so new requests continue the sequence rather than colliding.
- Columns stay **nullable** for pre-existing rows only if the backfill cannot cover them; it can, so set
  `not null` after backfilling. If any row has a `start_date` outside `jalali_months`, the migration must
  **fail loudly** rather than leave a null — that is a calendar-range problem, not something to paper over.
- RLS: none needed on the counter — it is written only by the definer writer. Revoke everything from
  `anon`/`authenticated` so nothing can read or bump it directly.

- [ ] **Step 1: Write and apply**; replay; confirm the counter matches `max(serial_seq)` per year.
- [ ] **Step 2: Verify** every existing request has a serial, and that `(company, year, seq)` is unique.
- [ ] **Step 3: types.ts + `tsc --noEmit`.**
- [ ] **Step 4: Commit.**

---

## Task 2: Allocate on submit

**Files:** Create `supabase/migrations/20260729130014_leave_serial_alloc.sql`.

`private.submit_leave_impl` resolves the Jalali year of `p_start` from `jalali_months`, bumps the counter
atomically, and inserts `serial_year`/`serial_seq` alongside everything else. If the date falls outside the
seeded calendar range it raises `date outside supported calendar range` — the same string
`jalali_month_of` uses, already mapped.

- [ ] **Step 1: Write and apply**; replay.
- [ ] **Step 2: Verify by scenario** (rolled-back, jwt sub set):
  1. two consecutive submissions get consecutive `serial_seq`
  2. a request whose `start_date` is in the next Jalali year starts that year's sequence at 1
  3. **two different employees submitting concurrently get different numbers** — this is the one the
     per-employee advisory lock does not cover, so run it as two parallel `psql` processes and assert two
     distinct sequence values, not one
- [ ] **Step 3: Commit.**

---

## Task 3: Show it

**Files:** Create `lib/leave/serial.ts` + `tests/unit/serial.test.ts`; modify the reads in
`lib/actions/leave.ts`, `MyRequestsList.tsx`, `ApprovalQueue.tsx`, and the label sources.

- `formatSerial(year, seq)` → `'1404-0042'`, sequence zero-padded to 4. A separate
  `formatSerialLocalized(year, seq, locale)` shapes the digits for Farsi, because HR reads these aloud in
  Farsi but writes them on Latin-numbered forms — the plain form is what goes in a filename or a URL.
- Show it on the employee's own request rows and on approval cards, using a `data-testid="serial-<id>"`.
- Add `serial_year`/`serial_seq` to the two request reads. **Not** to `team_leave_calendar`: a teammate
  browsing the calendar has no use for someone else's paperwork number, and that view's column list stays
  narrow by FR-25 habit.

- [ ] Steps: failing test → implement → wire reads → render → labels → gates → commit.

---

## Task 4: E2E and docs

- [ ] **E2E:** extend an existing spec rather than adding a slow new one — the daily-request flow already
  submits, so assert a serial matching `/\d{4}-\d{4}/` appears on the new request row. Cheap, and it
  proves allocation end to end.
- [ ] **Docs:** DATA_MODEL (counter, columns, why `company_id` is denormalised), FR-29 in REQUIREMENTS,
  CHANGELOG, TASKS, AGENT-LOG. Mark the **whole five-plan spec complete** in TASKS.
- [ ] **Full gates**, real counts. Commit.

---

## Deployment note

The only plan here with a **mandatory backfill**: every existing request on the client's server gets a
number. Run it on a dump first and confirm the counts — `select count(*) from leave_requests where
serial_seq is null` must be 0 before the `not null` is applied, and the per-year sequences must be
contiguous from 1. Their live database has few requests today, so this is cheap now and gets more
expensive every week it waits.

## Self-Review

**Spec coverage (§7.6):** counter table (T1) · `serial_year`/`serial_seq` + `company_id` + unique index
(T1) · allocated in the writer under the lock, gapless (T2) · `1404-0042` formatting in
`lib/leave/serial.ts`, never in SQL (T3) · displayed on cards and approvals (T3).

**Risk flagged:** the advisory lock is **per employee**, so it does not serialise the counter across
employees. `on conflict do update … returning` does, by taking a row lock. Task 2 scenario 3 exists
precisely to prove that, with two real concurrent transactions — if it returns the same sequence twice,
the unique index turns a duplicate into a failed submission for a real worker.

**Type consistency:** `serialYear`/`serialSeq` in TS ↔ `serial_year`/`serial_seq` in SQL.
`formatSerial` returns Latin digits; `formatSerialLocalized` shapes them. Callers rendering to a worker
use the localized one.
