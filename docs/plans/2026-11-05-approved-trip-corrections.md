# Approved Trip Corrections and Quick Balance Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR corrects approved daily work trips (dates, per diem) with recorded history, and adds time to leave balances with a reason, a visible breakdown and a full history.

**Architecture:** Two SQL migrations add `leave_ledger.quick_add` / `created_by` and an append-only `request_corrections` table, each driven by a guarded SECURITY DEFINER RPC. Server actions wrap the RPCs. Pure helpers compute the balance breakdown and the print history. UI changes sit on Edit Employee, Manage › Requests, the print form, procurement and finance.

**Tech Stack:** Next.js App Router, TypeScript, Supabase pieces (Postgres, PostgREST, RLS), next-intl, Vitest, Playwright, psql SQL tests.

**Spec:** `docs/specs/2026-11-05-approved-trip-corrections-design.md`

## Global Constraints

- Branch from `origin/main` (`8224e81`) as `claude/approved-trip-corrections`. Work-in-progress docs carry over.
- Commit only as the plan says, on this branch, once the owner has approved execution. No push and no PR until asked.
- Migrations: new files only, edit nothing already applied. Dry-run on a clone first (CLAUDE.md "Dry-run migrations first"). The local `postgres` DB lags main, so apply FR-83's `20261106090000` before dumping `supabase/schema.sql`.
- Never commit the re-parenthesized `CONSTRAINT … CHECK` hunks a restored dump produces.
- Lock order: `private.approval_lock(company)` before `'leave:'||employee`.
- Every server action starts with `requireCaller(...)`, then `if (!c.ok) return c;`.
- `lib/supabase/types.ts` is hand-edited. Verify with `npx tsc --noEmit` and `npm run build`.
- All copy in `messages/fa.json` and `messages/en.json`. Client components use `useTranslations` or a local `useLabels()`.
- New database error strings get a rule in `lib/errors/db-error.ts` and a `fa` + `en` message.
- Leave amounts in forms: whole days + hours, never decimal days. Ledger stores minutes.
- Signature bytes never reach `audit_log` or a read RPC.
- Local DB holds the real roster: run only e2e specs that use their own `999…` users; skip `accrual.spec`.
- FR-83, FR-84 and FR-85 deploy together. No `[skip ci]` on the final code push.

## Review Focus

- HR types in an absolute field, then quick adds before Save: the field reloads to the new total and Save never undoes the add (Task 3, e2e).
- HR double-clicks Add: exactly one ledger row (Task 3, e2e).
- A reason of only spaces: refused on both quick add and correction (Tasks 1 and 4, SQL).
- Moving only the start past the current end, or sending values equal to the current ones: refused, nothing written (Task 4, SQL).
- Two corrections with an extension between them: print still shows originally signed values, changes in time order (Task 5, unit).

---

### Task 1: Quick add database layer (FR-85)

**Files:**
- Create: `supabase/migrations/20261107090000_quick_balance_add.sql`
- Create: `tests/sql/balance-add.sql`
- Modify: `lib/supabase/types.ts`, `supabase/schema.sql`

**Interfaces:**
- Produces: `leave_ledger.quick_add boolean not null default false`; `leave_ledger.created_by uuid null references profiles(id) on delete set null`; RPC `app_add_leave_balance(p_employee_id uuid, p_leave_type_id uuid, p_minutes integer, p_reason text) returns integer` (new balance).

- [ ] **Step 1: Create the branch**

```bash
git switch -c claude/approved-trip-corrections origin/main
```

- [ ] **Step 2: Write `tests/sql/balance-add.sql`**

Copy the fixture header from `tests/sql/hr-head-own-per-diem.sql`. Fixtures: admin, an `hr` holder, a plain employee, an `affects_balance` type, a non-balance type. Assertions, using `pg_temp.expect`:
- hr adds 1440 minutes: returns old + 1440; latest row has `entry_type='adjustment'`, `quick_add=true`, `note` = trimmed reason, `created_by` = hr.
- `audit_log` has `leave_balance.add` for that row.
- Own balance as hr: `42501`. Admin on own balance: allowed.
- Plain employee calling: `42501`.
- `p_minutes` 0, -60, or above one year of working minutes: `22023`.
- Reason `''`, `'   '`, or 501 characters: `22023`.
- Non-balance leave type: `22023`.
- `set_leave_balance` as hr writes `created_by` = hr and `quick_add=false`.

- [ ] **Step 3: Run on a clone without the migration; expect FAIL**

Clone as in CLAUDE.md, then:
```bash
docker exec -i -e PGPASSWORD="$PGPASSWORD" bj-erp-db-1 psql -U supabase_admin -d x -f - < tests/sql/balance-add.sql
```
Expected: error, `function public.app_add_leave_balance` does not exist.

- [ ] **Step 4: Write the migration**

Adds the two columns. `app_add_leave_balance` is SECURITY DEFINER, `search_path ''`. It applies the three authority checks from `set_leave_balance` in the same order, then the checks above. Limit: `p_minutes <= 366 * private.company_minutes_per_day(company)`. Reason: `btrim`, length 1–500. Takes the `'leave:'||employee` lock. Inserts with `note = trimmed reason`, `quick_add = true`, `created_by = auth.uid()`. Replace `set_leave_balance` from `supabase/schema.sql` with only `created_by` added to its insert. Grant execute to `authenticated`, revoke from `public`, matching `set_leave_balance`'s ACL lines.

Errors raised: `'amount must be more than 0'`, `'amount is too large'`, `'a reason is required'`, `'reason is too long'`, `'this leave type has no balance'`.

- [ ] **Step 5: Run the test on the clone; expect PASS**

Expected: every line `PASS`, no `FAIL`. Also run `tests/sql/fr55-roles-permissions.sql`: same result as before the migration.

- [ ] **Step 6: Apply locally, dump, type**

Run `./deploy/bj-deploy update local` from the main checkout's stack, then `npm run schema:dump`, drop any CHECK-only hunks, restart `bj-erp-rest-1`. Add the columns and RPC to `lib/supabase/types.ts`. Run `npx tsc --noEmit`: clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261107090000_quick_balance_add.sql tests/sql/balance-add.sql lib/supabase/types.ts supabase/schema.sql
git commit -m "feat(leave): quick balance add RPC and ledger fields (FR-85)"
```

### Task 2: Balance actions and breakdown helper

**Files:**
- Create: `lib/leave/balanceBreakdown.ts`, `tests/unit/balance-breakdown.test.ts`
- Modify: `lib/actions/leave/balances.ts`, `lib/errors/db-error.ts`, `messages/fa.json`, `messages/en.json`

**Interfaces:**
- Consumes: `app_add_leave_balance` from Task 1.
- Produces:
  - `type QuickAddRow = { id: string; leaveTypeId: string; minutes: number; reason: string; at: string; byName: string | null }`
  - `type LedgerHistoryRow = { id: string; leaveTypeId: string; entryType: string; deltaMinutes: number; balanceAfterMinutes: number; note: string | null; at: string; byName: string | null; requestSerial: { year: number; seq: number } | null }`
  - `addLeaveBalance(employeeId: string, leaveTypeId: string, minutes: number, reason: string): Promise<{ ok: true; balanceMinutes: number } | DbErrorResult>`
  - `getQuickAdds(employeeId: string): Promise<{ ok: true; rows: QuickAddRow[] } | DbErrorResult>`
  - `getLeaveHistory(employeeId: string): Promise<{ ok: true; rows: LedgerHistoryRow[] } | DbErrorResult>`
  - `balanceBreakdown(balanceMinutes: number, rows: QuickAddRow[], leaveTypeId: string): { addedMinutes: number; otherMinutes: number; rows: QuickAddRow[] } | null`

- [ ] **Step 1: Write failing unit tests**

```ts
it('returns null with no quick adds for the type', () => {
  expect(balanceBreakdown(600, [row('other', 60)], 'annual')).toBeNull();
});
it('splits the total so both parts sum to the balance', () => {
  expect(balanceBreakdown(1380, [row('annual', 180)], 'annual'))
    .toMatchObject({ addedMinutes: 180, otherMinutes: 1200 });
});
it('allows a negative other part', () => {
  expect(balanceBreakdown(60, [row('annual', 180)], 'annual')?.otherMinutes).toBe(-120);
});
it('lists rows newest first', () => { /* two rows, assert order by `at` */ });
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npx vitest run tests/unit/balance-breakdown.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement the helper and the three actions**

`addLeaveBalance` requires `['leave_balances', 'edit']`, checks `Number.isSafeInteger(minutes) && minutes > 0`, calls the RPC, then `invalidateAppCache()`. Both reads require `['leave_balances', 'read']` and select `leave_ledger` directly with `profiles!leave_ledger_created_by_fkey(full_name)`. `getQuickAdds` filters `quick_add = true`. `getLeaveHistory` orders by `seq` descending, limit 200, and joins `leave_requests(serial_year, serial_seq)`.

Map the five Task 1 errors in `lib/errors/db-error.ts`.

- [ ] **Step 4: Run; expect PASS**

Run: `npx vitest run tests/unit/balance-breakdown.test.ts` and `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/leave/balanceBreakdown.ts tests/unit/balance-breakdown.test.ts lib/actions/leave/balances.ts lib/errors/db-error.ts messages/fa.json messages/en.json
git commit -m "feat(leave): quick add actions and balance breakdown (FR-85)"
```

### Task 3: Edit Employee leave sections

**Files:**
- Create: `app/[locale]/(app)/manage/employees/[id]/BalanceQuickAdd.tsx`, `.../[id]/BalanceHistory.tsx`, `.../[id]/BalanceBreakdownLines.tsx`, `tests/e2e/quick-balance.spec.ts`
- Modify: `.../[id]/EditEmployeeForm.tsx`, `.../[id]/page.tsx`, `tests/e2e/_helpers.ts`, `messages/fa.json`, `messages/en.json`

**Interfaces:**
- Consumes: Task 2 actions and `balanceBreakdown`.
- Produces: testids `quick-add-section`, `quick-add-amount-days`, `quick-add-amount-hours`, `quick-add-reason`, `quick-add-submit`, `balance-history`, `balance-history-row`, `balances-section`, `policy-section`, `balance-total-<slug>`, `balance-breakdown-<slug>`; helper `openLeaveSections(page)` in `tests/e2e/_helpers.ts`.

- [ ] **Step 1: Write failing e2e tests in `tests/e2e/quick-balance.spec.ts`**

Use a `999…` throwaway user. Tests:
- `sections start collapsed and show totals`: `balances-section` and `policy-section` are not `open`; `balance-total-annual` is visible with the total.
- `quick add updates the absolute field and shows why`: add 3 days with a reason; open the section; days input shows old + 3; `balance-breakdown-annual` contains the reason.
- `saving after a quick add keeps it`: quick add, change Job title, Save, reload; balance is old + 3 days and there is no `admin balance set` row in history.
- `typed but unsaved absolute value does not undo a quick add`: open the section, type a value, quick add, Save; balance is old + 3 days.
- `double click posts one row`: `dblclick` on `quick-add-submit`; history gains one row.
- `history lists the add`: open `balance-history`; first row shows the reason and the actor's name.
- `read-only viewer sees history, not the add fields` (direct manager without edit is not enough; use a role with `leave_balances` read).

- [ ] **Step 2: Run; expect FAIL**

Run: `npx playwright test tests/e2e/quick-balance.spec.ts --workers=1`. Expected: FAIL, `quick-add-section` not found.

- [ ] **Step 3: Update existing e2e helpers first**

Add `openLeaveSections(page)` and call it in `_helpers.ts` wherever `balance-days-*` or policy fields are filled, and directly in `hr-leave-setup`, `hr-role`, `manage`, `balance-days-hours`, `hr-employee-admin`, `errand`, `hourly` where they touch these fields.

- [ ] **Step 4: Implement**

- `page.tsx`: load `getQuickAdds(id)` with balances; pass `quickAdds`.
- `BalanceQuickAdd`: client component, inputs unnamed, `type="button"` Add, disabled while the transition runs, Enter key `preventDefault`. Amount via `leaveAmountReader`'s rule: whole days ≥ 0, hours `0…ceil(hoursPerDay)-1`, total > 0. After success, `router.refresh()` and show the new balance. Copy says it saves at once, and the reason field's hint says the employee can read it. Rendered only with `caps.leaveEdit`. The section holds `BalanceHistory` for anyone with `canManageLeave`.
- `BalanceHistory`: `<details>` whose first `toggle` to open calls `getLeaveHistory`. Labels for all five `ledger_entry` values.
- `EditEmployeeForm`: wrap balances and policy in `<details>` with `open` from state and a `<summary>`. The balances summary lists each type's total. Open a section when `amountErrors` has a key starting `balance_` (balances) or belonging to a policy field. **Key `DaysHoursField` as `` `${balance.leaveTypeId}-${balance.balanceMinutes}` ``** so a refreshed balance remounts it. Render `BalanceBreakdownLines` under each field.

- [ ] **Step 5: Run; expect PASS**

Run: `npx playwright test tests/e2e/quick-balance.spec.ts tests/e2e/hr-leave-setup.spec.ts tests/e2e/balance-days-hours.spec.ts --workers=1` then `npx vitest run tests/unit/days-hours-field.test.tsx`.

- [ ] **Step 6: Check in a browser at phone width**

Open Edit Employee at 375px in `fa` and `en`. Confirm RTL order and no horizontal scroll. Force an invalid policy amount and confirm its section opens with the error showing.

- [ ] **Step 7: Commit**

```bash
git add "app/[locale]/(app)/manage/employees/[id]" tests/e2e messages/fa.json messages/en.json
git commit -m "feat(employees): quick add, history and collapsed leave sections (FR-85)"
```

### Task 4: Trip correction database layer (FR-84)

**Files:**
- Create: `supabase/migrations/20261107100000_trip_corrections.sql`, `tests/sql/trip-correction.sql`
- Modify: `lib/supabase/types.ts`, `supabase/schema.sql`, `tests/sql/travel-booking.sql` (only if a state assertion changes)

**Interfaces:**
- Produces:
  - Table `public.request_corrections` per spec §3.
  - `app_correct_trip(p_request uuid, p_new_start date, p_new_end date, p_per_diem_rials bigint, p_reason text, p_signature_data text, p_signature_authorized boolean) returns uuid`
  - `request_trip_corrections(p_id uuid) returns table(old_start_date date, new_start_date date, old_end_date date, new_end_date date, per_diem_before bigint, per_diem_after bigint, reason text, corrected_by_name text, corrected_at timestamptz)`
  - Booking state `corrected`.
  - `app_travel_booking` JSON key `last_correction`: `{old_start_date, old_end_date, new_start_date, new_end_date, reason}` or null.
  - `finance_requests` column `corrected_at timestamptz`.

- [ ] **Step 1: Write `tests/sql/trip-correction.sql`**

Fixtures from `tests/sql/travel-booking.sql`. Assertions:
- hr corrects end later on a booked, `done` trip: dates and `requested_minutes` move, `done_at` null, `travel_booking_state` = `corrected`.
- Start moves earlier, and both move shorter: work.
- Per-diem-only: `per_diem_rials` updates, `per_diem_by_requester` false, `done_at` untouched, state stays `done`.
- Trip with no booking: works.
- Ended trip: works.
- Own trip as hr: `42501`. Plain employee: `42501`. Admin on another's trip: works.
- Pending request, cancelled request, leave request, hourly errand: `22023`.
- Pending extension on the request: `22023`.
- Overlap with another approved request: `22023`.
- Reason `'   '` or 1001 characters: `22023`.
- Missing signature, or `p_signature_authorized=false`: `22023`.
- Null dates and null per diem, and values equal to current: `22023 'nothing to correct'`, no row written.
- `p_new_start` alone after the current end: `22023`.
- Per diem -1: `22023`.
- History row keeps all six values; unchanged fields read equal.
- Correction then approved extension: state `extension`. Extension then correction: state `corrected`.
- `request_trip_corrections` for an unrelated employee: `P0002`. It returns no signature column.
- Authenticated direct select and insert on `request_corrections`: 0 rows and denied.
- `audit_log` `trip.correct` has no `signature_data`.
- `finance_requests.corrected_at` is set on the row. `app_travel_booking` returns `last_correction`.

- [ ] **Step 2: Run on a clone; expect FAIL**

Expected: error, `app_correct_trip` does not exist.

- [ ] **Step 3: Write the migration**

Create the table first, RLS on with no policies. `app_correct_trip` follows `app_decide_errand_extension`: gate with `private.is_travel_hr`, signature check, take both locks, re-read `for update`, check `status='approved' and kind='errand' and unit='day'`. Effective values: `coalesce(p_new_start, r.start_date)`, `coalesce(p_new_end, r.end_date)`, `coalesce(p_per_diem_rials, r.per_diem_rials)`. Refuse when none differ. Date-change effects as in spec §3.

Replace from `supabase/schema.sql`, changing only what is named:
- `private.travel_booking_state`: before the `extension` branch, return `corrected` when a date-changing correction has `corrected_at >= b.opened_at` and is newer than `max(decided_at)` of approved extensions.
- `private.travel_booking_open_for_details`, `app_save_travel_booking`, `app_save_travel_booking_v2`, `my_travel_pending`: add `corrected` wherever `extension` is listed.
- `app_travel_booking`: add `last_correction`.
- `finance_requests`: `drop function` then recreate with `corrected_at` last, restoring its ACL. Leave `finance_approved_requests` alone: it only serves the previous app.

Errors raised: `'only an approved daily trip can be corrected'`, `'nothing to correct'`, `'an extension is waiting for HR'`, `'start date must not be after end date'`, plus the existing signature, reason, overlap and per diem strings.

- [ ] **Step 4: Run on the clone; expect PASS**

Run `tests/sql/trip-correction.sql`, `travel-booking.sql`, `travel-itinerary.sql`, `sign-once.sql`, `hr-head-own-per-diem.sql`. Expected: all `PASS`.

- [ ] **Step 5: Apply locally, dump, type**

As Task 1 Step 6. Add the table, RPCs and the finance column to `lib/supabase/types.ts`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261107100000_trip_corrections.sql tests/sql lib/supabase/types.ts supabase/schema.sql
git commit -m "feat(travel): trip corrections table and RPC (FR-84)"
```

### Task 5: Correction actions, history and print

**Files:**
- Modify: `lib/actions/travel.ts`, `lib/travel/extensions.ts`, `lib/actions/leave/review.ts`, `lib/actions/leave/progress.ts`, `lib/errors/db-error.ts`, `components/RequestProgress.tsx`, `app/[locale]/(print)/print/request/[id]/page.tsx`, `messages/fa.json`, `messages/en.json`
- Test: `tests/unit/travel-extensions.test.ts` (existing cases move to the new signature), `tests/unit/progress-extensions.test.tsx`

**Interfaces:**
- Consumes: Task 4 RPCs.
- Produces:
  - `type RequestCorrection = { old_start_date: string; new_start_date: string; old_end_date: string; new_end_date: string; per_diem_before: number | null; per_diem_after: number | null; reason: string; corrected_by_name: string; corrected_at: string }`
  - `correctTrip(input: { requestId: string; newStart: string | null; newEnd: string | null; perDiemRials: number | null; reason: string; signatureData: string; signatureAuthorized: boolean }): Promise<{ ok: true } | DbErrorResult>`
  - `printedTripDates(trip: { start: string; end: string; perDiem: number | null }, extensions: Extension[], corrections: RequestCorrection[]): { signedStart: string; signedEnd: string; signedPerDiem: number | null; changes: TripChange[] }`
  - `type TripChange = { kind: 'extension' | 'correction'; at: string; start: string; end: string; perDiem: number | null; reason: string }`

- [ ] **Step 1: Write failing unit tests**

```ts
it('with no changes prints current values', () => { /* signed = current, changes [] */ });
it('uses the first correction when it precedes an extension', () => {
  // correction end 10→12 at t1, extension 12→14 at t2
  expect(result.signedEnd).toBe('10');
  expect(result.changes.map((c) => c.kind)).toEqual(['correction', 'extension']);
});
it('uses the extension when it comes first', () => { /* signedEnd = extension.old_end_date */ });
it('keeps signed start and per diem through two corrections with an extension between', () => {});
it('ignores unapproved extensions', () => {});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npx vitest run tests/unit/travel-extensions.test.ts`.

- [ ] **Step 3: Implement**

`RequestExtension` must carry `decided_at` through `Extension` for ordering. Merge by time. Signed values come from the earliest event of each kind; signed per diem is the first correction's `per_diem_before`, else current.

`correctTrip` uses `requireCaller()`, mirrors `decideExtension` validation, then `invalidateAppCache()`. `review.ts` and `progress.ts` fetch `request_trip_corrections` beside `request_errand_extensions` and return `corrections`.

`RequestProgress`: list corrections with reason beside extensions. Print form: `fields.from`, `fields.to` and the per diem line use signed values; one line per change. Key rows on `` `${c.kind}-${c.at}` ``. Map Task 4's new errors in `db-error.ts`.

- [ ] **Step 4: Run; expect PASS**

Run: `npx vitest run tests/unit/travel-extensions.test.ts tests/unit/progress-extensions.test.tsx` and `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib components "app/[locale]/(print)" messages tests/unit
git commit -m "feat(travel): correction history on request details and print (FR-84)"
```

### Task 6: Correct dialog on Manage › Requests

**Files:**
- Create: `app/[locale]/(app)/manage/requests/CorrectTripDialog.tsx`, `tests/e2e/trip-correction.spec.ts`
- Modify: `app/[locale]/(app)/manage/requests/RequestsReview.tsx`, `messages/fa.json`, `messages/en.json`

**Interfaces:**
- Consumes: `correctTrip`.
- Produces: testids `correct-trip-<id>`, `correct-start`, `correct-end`, `correct-per-diem`, `correct-reason`, `correct-submit`.

- [ ] **Step 1: Write failing e2e tests**

With `999…` users: as hr, add a per diem to an approved daily errand with none and see it on the row's print form; correct the end date of a trip and see old signed date plus the correction line on print; no Correct button on the viewer's own trip, on hourly errands, on leave, or for a viewer without HR access; a pending extension shows the mapped error.

- [ ] **Step 2: Run; expect FAIL**

Run: `npx playwright test tests/e2e/trip-correction.spec.ts --workers=1`.

- [ ] **Step 3: Implement**

Show the button when `travelTicks !== null`, `r.kind==='errand'`, `r.unit==='day'`, `r.status==='approved'`, `r.employee_id !== viewerId`. Dialog prefilled with current values, `PersianDateField` for dates, `parseRials` for per diem, `Textarea` reason, `RequestSignatureFields` with `signatureLabelsFrom(tSignature, 'approverTitle')`. Send `null` for an unchanged field.

- [ ] **Step 4: Run; expect PASS**

Also check the dialog at 375px in `fa`.

- [ ] **Step 5: Commit**

```bash
git add "app/[locale]/(app)/manage/requests" tests/e2e/trip-correction.spec.ts messages
git commit -m "feat(manage): correct approved trips from Requests (FR-84)"
```

### Task 7: Procurement and finance

**Files:**
- Modify: `lib/actions/travel.ts`, `app/[locale]/(app)/procurement/ProcurementList.tsx`, `app/[locale]/(app)/procurement/[id]/page.tsx`, `app/[locale]/(app)/home/TravelBookingCard.tsx`, `app/[locale]/(app)/finance/FinanceList.tsx`, `messages/fa.json`, `messages/en.json`
- Test: `tests/e2e/trip-correction.spec.ts`

**Interfaces:**
- Consumes: state `corrected`, `last_correction`, `corrected_at`.
- Produces: `TravelState` includes `'corrected'`; testids `procurement-correction-note`, `finance-corrected-<id>`.

- [ ] **Step 1: Add failing e2e tests**

A done booking whose dates are corrected appears under its own group on `/procurement`, shows old and new dates and the reason, and can be re-saved to `done`. A per-diem correction marks the row "Corrected" on `/finance`, and the exported CSV has the column.

- [ ] **Step 2: Run; expect FAIL**

- [ ] **Step 3: Implement**

Add `corrected` to `TravelState` and to `STATE_ORDER` after `extension`. Treat it as `extension` in the Home card's `waiting` filter and the `editable` check. `bookingOpen` in `FinanceList` already covers it. Add the marker and a `t('csv.corrected')` column with the corrected date.

- [ ] **Step 4: Run; expect PASS**

Run: `npx playwright test tests/e2e/trip-correction.spec.ts --workers=1`.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/travel.ts "app/[locale]/(app)/procurement" "app/[locale]/(app)/home/TravelBookingCard.tsx" "app/[locale]/(app)/finance" messages tests/e2e
git commit -m "feat(travel): corrected state for procurement and finance (FR-84)"
```

### Task 8: Docs and full verification

**Files:**
- Modify: `docs/REQUIREMENTS.md`, `docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`, `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/AGENT-LOG.md`, `docs/MEMORY.md` (only if a new lasting lesson came up)

- [ ] **Step 1: Update docs**

Add FR-84 and FR-85; amend FR-61, FR-68 and FR-70 per spec §5. `DATA_MODEL.md`: `request_corrections`, the two ledger columns, state `corrected`. `PERMISSIONS.md`: both RPCs' gates. `TASKS.md`: one owner step after deploy (tell HR about quick add and correction). Keep the FR-83 note that it ships in this release.

- [ ] **Step 2: Run everything**

```bash
npm run lint
```
```bash
npx tsc --noEmit
```
```bash
npm run test:unit
```
```bash
npm run build
```
```bash
npm run test:deploy
```
Then every `tests/sql/*` on a fresh clone, and `npm run cleanup:e2e`. Expected: all pass, except the known `approval-delegation.sql` clone failure, compared against a clone without these migrations.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: FR-84 and FR-85 requirements, data model and changelog"
```
