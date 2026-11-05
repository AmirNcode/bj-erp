# Approved trip corrections and quick balance add (FR-84, FR-85)

Status: approved by owner, 2026-11-05. Nothing built.

## 1. Why

HR feedback, three cases:

1. A work trip was approved with wrong dates.
2. HR forgot the per diem at their signing step, so the approved request has none.
3. Someone came back early from leave and should get the unused days or hours back.

Today an approved request can only be cancelled before it starts, or extended later by the
`errand_extensions` flow. Per diem can only be set while signing the HR step or approving an extension.

**Owner decisions (2026-11-05):**

- Early return does **not** change the request. The end date stays; HR adds the unused time to the
  person's balance.
- Regular leave dates are not corrected at all. Corrections cover work trips and per diem.
- Quick add carries a reason and raises the real balance, so the absolute field shows the new total.
  HR sees how much of a total came from quick adds, and why. Absolute-field edits carry no reason for now.
- HR's CEO-delegate question is closed: it was a configuration step. A 2-hour wait is not coming back.

## 2. Goals, non-goals, anti-goals

**Goals**

- FR-84: HR corrects the dates and per diem of an approved daily work errand, with a reason and a
  signature, keeping what was originally signed.
- FR-85: HR adds time to a leave balance with a required reason, and can read the person's full balance
  history, on Edit Employee.

**Non-goals**

- Editing regular leave, hourly leave or hourly errands.
- Changing the location, description or anything else on a request.
- Returning time automatically from a request, or linking a quick add to a request.
- A quick deduct. Deductions use the existing absolute field.
- A new SMS event. The three SMS events need pattern templates and IT's answer on the line type first.
- A payroll or period close. None exists; a correction to a past month changes that month's reports.

**Anti-goals: this fails even if it works, when**

- the original signed dates or amount disappear from the record;
- a money change reaches `/finance` with nothing to show it changed;
- HR can correct their own trip or change their own balance.

## 3. FR-84: trip correction

### Scope and rules

- Target: `status = 'approved'`, `kind = 'errand'`, `unit = 'day'`, with or without a travel booking.
- Who: `private.can_correct_trip(caller, request)`: the FR-70 gate (admin, `hr` role, or the delegate of an
  `hr` holder, never on their own request), and a delegate acts only through an `hr` holder who is not the
  traveller. No new permission.
- A correction changes start date, end date, per diem, or any mix. It must change at least one.
- `reason` is required, 1–1000 characters. A signature is required, same check as
  `app_decide_errand_extension` (`p_signature_authorized` plus PNG data URL).
- Dates: `new_start <= new_end`, either may move in either direction. No "must be in the future" rule
  and no time limit: HR finds these after the trip.
- Per diem: whole Rials, `>= 0`. `NULL` means unchanged; a correction cannot clear an amount back to
  null, HR enters 0. A corrected amount sets `per_diem_by_requester = false`.
- Refused while an extension is pending on the request: HR decides it first.
- Refused if new dates overlap, using `private.extension_overlaps(r.id, r.employee_id, new_start, new_end)`.
  Other pending and approved requests count, as do other trips' pending extensions.

Effects when dates change:

- `start_date`, `end_date` update; `requested_minutes` = `compute_requested_minutes(company, start, end,
  'full', 'day', null, null, 'errand')`. No ledger row: errands have no leave type.
- If a booking exists and `opened_at` is set: clear `done_at` and `done_by`, so procurement re-books.
- Serial number stays.

A per-diem-only correction leaves the booking alone.

### Storage

New table `request_corrections`, RLS on, **no client policies**, RPCs only, like `errand_extensions`:

`id` · `request_id` → leave_requests (cascade) · `company_id` · `old_start_date`, `new_start_date` ·
`old_end_date`, `new_end_date` · `per_diem_before`, `per_diem_after` (bigint) · `reason` ·
`corrected_by` → profiles · `corrected_at` · `signature_data` · `signature_consent_at`

Append-only. Every row keeps all six values, so unchanged fields read equal.

### RPCs

- `app_correct_trip(p_request, p_new_start, p_new_end, p_per_diem_rials, p_reason, p_signature_data,
  p_signature_authorized)`. Null `p_new_start` / `p_new_end` mean unchanged. Same shape as
  `app_decide_errand_extension`: check gate, take `private.approval_lock(company)` then the
  `'leave:'||employee` advisory lock, re-read under `for update`, re-check status. Audit action
  `trip.correct` with before/after and no signature bytes.
- `request_trip_corrections(p_id)`: read path like `request_errand_extensions`, gated by
  `private.can_read_approval_request`. Returns dates, per diem, reason, corrector's name, time; never
  the signature.

### Procurement

`private.travel_booking_state` gains state **`corrected`**: approved, `done_at` null, and a date-changing
correction with `corrected_at >= opened_at`, when it is newer than any approved extension. Otherwise
`extension` stays. `TravelState`, `STATE_ORDER`, the list, the Home card and the `editable` check in
`procurement/[id]/page.tsx` treat `corrected` like `extension`, and show old and new dates, from a
`last_correction` key on `app_travel_booking` (procurement can't read `request_corrections`).

### Finance

`finance_requests` adds `corrected_at` (latest correction); `finance_approved_requests` only serves the previous app and stays as it is. `/finance`
shows a "Corrected" marker on the row, and the CSV gets a column. This is how finance notices a changed
per diem, since the app has no "paid" flag. Changing `RETURNS TABLE` means drop and recreate, with the
grants restored; the still-running old app reads named columns, so an added one is safe.

### Screens

- **Manage › Requests:** a **Correct** button on approved daily errands, not on the viewer's own, for
  callers who pass the gate (`getTravelTicks` already returns null for everyone else). Dialog: start,
  end (`PersianDateField`), per diem, reason, signature (saved signature supported, as in
  `ExtensionDecisionCard`).
- **Requester and approver views** (`RequestDetails`, Home details): current dates plus a line per
  correction with reason. This is how the employee learns of it.
- **Print form:** From/To and the per diem line print the **originally signed** values, then one line per
  later change, oldest first, mixing extensions and corrections. `printedTripDates` takes both lists and
  orders by time, because `approved[0].old_end_date` is wrong once a correction comes before an extension.
  It must return a signed start too. The print `key` cannot stay `e.date`, which may repeat.

## 4. FR-85: quick add and history on Edit Employee

### Layout

Inside the leave part of the form, in this order:

1. **Add to balance** (new, always open): quick add, then a collapsed **See history**.
2. **Leave balances**: collapsible, **collapsed by default**. Absolute fields hold the total; the summary
   line shows each type's total, so HR sees it without opening. See Balance breakdown below.
3. **Monthly accrual policy**: collapsible, **collapsed by default**. Fields unchanged.

Collapse with native `<details>`, as in `ImportPlanPanel.tsx`.

### Quick add

- Fields: leave type (from the form's `balances`; no choice needed when there is only one), amount via
  `DaysHoursField`-style days + hours, whole values, reason. An **Add** button, then a confirmation with
  the new balance.
- Saves at once, independent of the form's Save. The UI says so.
- Shown with `leave_balances` edit (`caps.leaveEdit`) only.
- New RPC `app_add_leave_balance(p_employee_id, p_leave_type_id, p_minutes, p_reason)`. Same gates as
  `set_leave_balance`: admin or `leave_balances` edit, never own balance unless admin, `private.can_act_on`
  for non-admins.
- Minutes `> 0`, at most one year of working minutes. Leave type must have `affects_balance`.
- Reason required, 1–500 characters. Takes the employee advisory lock, reads `current_leave_balance`,
  writes an `adjustment` row with `note = reason` and `quick_add = true`. Audit `leave_balance.add`.

### Balance breakdown

Quick add raises the real balance, so the absolute field shows the new total and Save keeps it. Under
each field that has quick adds:

> Total 23 days 7 hours: 20 days 7 hours + 3 days quick added
> +3 days · 1405/08/14 · Sara Ahmadi: returned early from 1405-0123

- Source: new `leave_ledger.quick_add boolean not null default false`. The note text can't mark these,
  and special-leave and hand-edit rows are `adjustment` too. Keeps `entry_type`, so Home is unaffected.
- Quick added = sum of that type's `quick_add` rows, all time. Other part = current balance − quick added,
  so the sum always equals the field, and may be negative.
- Loaded with the page for `leave_balances` read, through the same RLS as history.
- Shows quick adds only. Hand edits have no reason and appear in history alone.
- Limit: fixing a mistaken quick add with the absolute field leaves the +3 line up, and only the "other
  part" moves. History shows the hand edit.

### See history

- Collapsed `<details>` under quick add. Loads on first open. Shown with `leave_balances` read, so a
  read-only viewer gets history without the add fields.
- Every `leave_ledger` row for the person, newest first by `seq`, read directly (policy
  `leave_ledger_select` already allows `reads_balances`).
- Each row: Jalali date and time, leave type, entry label, signed amount in days and hours, balance
  after, and the reason on quick-add rows (other notes are internal English strings). A consumption or
  reversal row shows the request's serial. A label is
  needed for every `ledger_entry` value, `fa` and `en`.
- **Who:** new nullable `leave_ledger.created_by` → profiles, filled by `app_add_leave_balance` and
  `set_leave_balance`. HR can't read `audit_log` (admin only), so without it the history can't say who
  added time. Older rows and automatic rows show blank.
- `leave_ledger` is readable by the employee through RLS, so the reason is not private. The field's
  hint says so.

### Form traps

- **Stale field undoes a quick add.** `DaysHoursField` is uncontrolled (`defaultValue`). After a quick add
  the `balances` prop moves but the input keeps the old number, so `balanceAdjustments` sees a change and
  the next Save writes the old balance back. Key the field on `leaveTypeId` + `balanceMinutes` so it
  remounts, and cover this with an e2e test.
- **Keep inputs mounted.** The form reads them from `FormData`. `<details>` keeps them in the DOM;
  conditional rendering would drop them from the submit.
- **Errors in a closed section.** Make `open` follow state and open the section when `amountErrors` names
  one of its fields. Check browser validation can't block Save on a hidden input.
- **No nested form.** Quick add sits inside the main `<form>`: use `type="button"`, read state instead of
  `FormData`, leave its inputs unnamed, and stop Enter from submitting the main form.
- **Disabled fieldset.** The leave part sits in `<fieldset disabled={!canSaveLeave}>`. History must open
  there, so it uses `<summary>` rather than a button.

### Accepted costs of early return by balance

The request still shows the full period: calendar, approved absences and back-at-work stay on the old
end date, those days stay blocked by the overlap check, a temporary approval delegate keeps signing until
the old end date, and `unpaid_minutes` is unchanged. If the request had unpaid days HR must not credit
those. Home's "used" counts only `consumption` and `reversal`, so after an `adjustment` used stays high
and the total reads high by the same amount.

## 5. Requirement amendments

- **FR-68** ("never editable afterwards") is amended: HR or the admin may correct it. The Head of HR still
  cannot correct their own trip; another `hr` holder or the admin does.
- **FR-61:** per diem may also be set by a correction.
- **FR-70:** new `corrected` booking state.

## 6. Build order

The release ships FR-83, FR-84 and FR-85 together (owner, 2026-11-05): FR-83 is merged to main but undeployed,
so its migration goes out in the same deploy. Dry-run them in order.

1. FR-85 quick add, history and collapsible sections: independent, smallest.
2. FR-84 migration and SQL tests: table, RPCs, state, finance columns.
3. FR-84 screens: Manage dialog, details, print, procurement, finance.

Each new enum-like state stays text, so no enum migration. `lib/supabase/types.ts` is hand-edited.
Add `fa` and `en` strings. `app_correct_trip` follows the lock order in CLAUDE.md.

SQL tests in new `tests/sql/trip-correction.sql` and `tests/sql/balance-add.sql`: each gate, own trip
refused, pending extension refused, overlap refused, booking reopens on dates only, per-diem-only leaves
booking, `per_diem_by_requester` clears, hourly and leave refused, correction before and after an
extension. Unit tests for the merged `printedTripDates`. Adding a `travel_bookings` column is not needed,
so `row(…)::public.travel_bookings` literals stay valid. `tests/e2e/hr-leave-setup.spec.ts` and other specs
filling the balance or policy fields must open their section first.

## 7. Calls made without owner input

- Signature required on every correction, per diem included, because the HR step and extensions are signed.
- Daily errands only; hourly errands stay as they are.
- No time limit, and corrections allowed after the employee has left.
- Same FR-70 gate as extensions, so no `can_act_on`: HR may correct an admin's trip, as HR may already
  cancel one.
- Extensions are unchanged, and stay the manager-started path for lengthening a running trip.
- `corrected` as its own procurement state instead of reusing `extension`.
- The "Corrected" marker on `/finance`, added beyond the ask.
- Quick add is add-only, and a mistake is fixed with the absolute field.
- Breakdown counts all quick adds ever, not just this Jalali year.
- Absolute field's fixed note stays "admin balance set".
- `leave_ledger.created_by` added so history shows who changed a balance.

## 8. Left to the builder

Dialog layout, exact copy, history paging, and whether the Correct dialog is one
component with the extension card or a new one.
