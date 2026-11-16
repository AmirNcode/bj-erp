# Lunch break excluded from hourly leave — design

**Date:** 2026-11-16 · **Status:** approved 2026-11-16 · **FR:** FR-93 (amends FR-57 hourly leave)
· **Branch:** `feat/lunch-break`

## Why

HR feedback: staff get a one-hour lunch break (13:00–14:00). Today an hourly leave of 12:00–15:00
counts as 3 h against the balance, though one of those hours is lunch they would have had anyway.
The lunch break must not count against the balance.

A full day stays 8 h (08:00–17:00 = 8 h work + 1 h lunch); `hours_per_day` is unchanged.

## Decisions (Amir, 2026-11-16)

1. **Setting:** lunch start + duration, edited like the weekend in **Settings › Working hours and
   hourly leave** (same card as Day starts / Day ends / Max hours per day). Default **13:00, 60 min**.
2. **Permission:** part of the existing `work_settings` item. No new catalog item; HR already holds
   `work_settings` edit.
3. **Counting:** hourly **leave** counts `(end − start) − overlap(request, lunch)` minutes.
4. **Daily cap** (`max_hourly_minutes_per_day`) and the per-day sum use the **net** minutes.
   11:00–16:00 with lunch 13–14 = 4 h net → allowed under a 4 h cap.
5. **Errands** (hourly or daily) are work time: unchanged, lunch not subtracted.
6. **Going forward only.** Stored `requested_minutes` on existing requests are never recomputed by the
   migration. (An edit after release recomputes, because an edit is a fresh count — FR-91.)
7. **A request entirely inside lunch is still valid.** It is filed, approved and listed for security
   (who is in / out of the building) like any other approved absence, but deducts **0 minutes**. The
   "must be greater than 0" refusal stays for weekends/holidays and for errands.

## Calls made by the agent (not raised by Amir)

- Duration is stored and edited in **minutes** (`lunch_minutes`, 0–180; 0 = no lunch break), so
  45 min works. The form field reads "Lunch duration (minutes)".
- The lunch block must sit inside the work window (`work_start ≤ lunch_start` and
  `lunch_start + lunch_minutes ≤ work_end`) unless `lunch_minutes = 0`. CHECK constraint + the same
  rule in `validateHourlySettings`.
- Requests may start or end inside lunch (13:30–15:00 = 1 h net). Slots are unchanged.
- The migration sets `lunch_minutes = 0` on any existing row whose window cannot hold 13:00–14:00,
  so the CHECK cannot fail on deploy (live row is 08:00–17:00, so it gets the default).
- A 0-minute (lunch-only) request does **not** take the FR-57 "one hourly leave per day" slot
  (it only logs the exit for security; the time-overlap check still applies). Spec review #3.
- A 0-minute request skips the strict available-balance check, so a person with a negative
  available balance can still log a lunch exit. Spec review #2.
- Outside the request form a 0-minute request displays as `formatDuration(0)` ("0 days"); accepted.
- Fresh installs get lunch 13:00/60 inside the default 07:00–15:00 window; intended (future clients
  set their own hours).
- A 0-minute approved request writes **no** ledger row (the approval and cancel paths already skip
  `v_paid > 0`); it still gets its audit row.

## Design

### Database (one migration, `20261116120000_lunch_break.sql`)

- `alter table public.work_settings add column lunch_start time not null default '13:00',
  add column lunch_minutes integer not null default 60;` then zero the rows that cannot hold it, then
  `CHECK work_settings_lunch_sane`, compared in minutes (a `time + interval` wraps at midnight):
  `lunch_minutes between 0 and 180 and (lunch_minutes = 0 or (lunch_start >= work_start and
  extract(epoch from lunch_start)/60 + lunch_minutes <= extract(epoch from work_end)/60))`.
- New `private.is_working_day(p_company uuid, p_date date)` (not weekend, not holiday), used by the
  0-minute exception (and free for `compute_requested_minutes`).
- New `private.lunch_overlap_minutes(p_company uuid, p_start time, p_end time) returns int`
  (STABLE, SECURITY DEFINER, `search_path ''`): overlap of `[p_start,p_end)` with the company's lunch
  block, 0 when no row / `lunch_minutes = 0`.
- `public.compute_requested_minutes`: in the `p_unit = 'hour'` leave branch (not errand), on a
  working day return `span − private.lunch_overlap_minutes(...)`.
- `private.submit_leave_impl` and `private.edit_request_impl`:
  - Daily-cap checks use net minutes (`span − lunch overlap`) instead of the raw span.
  - FR-57 one-per-day check counts only `requested_minutes > 0` rows (and in submit, only when the
    new request itself is > 0 — a lunch-only request never blocks or is blocked by the slot).
  - Strict balance check guarded by `v_minutes > 0` (submit; edit already compares growth).
  - The `v_minutes <= 0` refusal is skipped when `kind = 'leave' and unit = 'hour'` and the span is
    > 0 and the day is a working day — i.e. zero only because of lunch. Weekend/holiday hourly leave
    and every errand still refuse 0.
- `enforce_work_settings_scope` needs no change (lunch is a plain `work_settings` edit).
- Redefining `submit_leave_impl` / `edit_request_impl` / `compute_requested_minutes`: copy the
  **current** body from `supabase/schema.sql` and change only the lines above (FR-88/89/91/92 changes
  must survive).

### App

- `lib/leave/hourly.ts`: `lunchOverlapMinutes(range, lunch)` and `netHourlyMinutes(range, lunch)`
  (mirror of the SQL; unit tests).
- `WorkSettings` type + `WORK_SETTINGS_FALLBACK` (`lunchStart: '13:00'`, `lunchMinutes: 60`);
  `lib/actions/leave/reference.ts` and `lib/actions/settings.ts` read/write `lunch_start`,
  `lunch_minutes`; `validateHourlySettings` validates them.
- `WorkSettingsForm`: two fields in the "Working hours and hourly leave" card — **Lunch starts**
  (time) and **Lunch duration (minutes)**; hint text mentions the lunch break is not deducted.
- `HourlyRequestForm`: two values. `spanMinutes` (raw) drives time validation, the replacement and
  delegation queries; `netMinutes` drives `overLimit` and the balance preview
  (`spanMinutes > 0 ? netMinutes : null`). `EditRequestDialog` shows no duration: no change. When lunch is subtracted
  show "Lunch break (X) not deducted"; when net is 0 show "0 — lunch break, not deducted" and allow
  submit.
- `lib/errors/db-error.ts` maps `work_settings_lunch_sane` / "lunch break must fall within working
  hours" to fa/en.
- Every string in `messages/fa.json` + `messages/en.json`.
- `lib/supabase/types.ts` hand-edited for the two columns.

### Tests

- Unit: `hourly.test.ts` for overlap/net (before, after, straddle, inside, edges, lunch 0).
- SQL: `tests/sql/lunch-break.sql` — net counting, cap on net, 0-minute request inside lunch submits
  and approves with no ledger row, errand unchanged, weekend hourly still refused, CHECK rejects lunch
  outside window, existing request minutes untouched.

## Non-goals

- No recount of existing requests. No change to daily leave, `hours_per_day`, errands, slots, print
  layout. No per-department or per-person lunch.

## Left to the builder

- Exact copy wording (fa + en), placement of the note in the hourly form.
