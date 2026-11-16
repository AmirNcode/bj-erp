# Lunch break excluded from hourly leave (FR-93) Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hourly leave deducts `(end − start) − overlap with the company lunch block`. Lunch start +
duration are new `work_settings` columns edited in Settings › Working hours and hourly leave
(existing `work_settings` permission). A request wholly inside lunch is still valid and deducts 0.

**Spec:** `docs/specs/2026-11-16-lunch-break-design.md` — read it first.

**Tech:** Next.js 16 App Router, TypeScript, next-intl (fa default RTL + en), self-hosted Supabase
(Postgres + PostgREST), Vitest, plain-SQL tests.

## Global constraints

- `CLAUDE.md` Gotchas are binding: migrations only in `supabase/migrations/`, forward-only, frozen once
  applied to any DB except a throwaway clone; `lib/supabase/types.ts` hand-edited; every string in
  `messages/fa.json` + `messages/en.json`; UI per `docs/DESIGN.md`.
- When redefining a SQL function, start from its **current** body in `supabase/schema.sql` and change
  only the lines named here.
- **DB work on a throwaway clone** of the running local stack DB (`bj-approvals-finance-db-1`):
  ```bash
  DB=bj-approvals-finance-db-1
  psqlc() { docker exec -i $DB sh -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -v ON_ERROR_STOP=1 -U supabase_admin "$@"' -- "$@"; }
  psqlc -d postgres -c "drop database if exists lunch" -c "create database lunch"
  docker exec $DB sh -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_dump -Fc -U supabase_admin -d postgres' \
    | docker exec -i $DB sh -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_restore --no-owner -U supabase_admin -d lunch' || true
  # apply any main migrations missing from the clone first (check bj_deploy.schema_migrations)
  psqlc -d lunch < supabase/migrations/20261116120000_lunch_break.sql
  psqlc -d lunch -q < tests/sql/lunch-break.sql
  ```
  The clone holds real personnel data: print only counts/ids, never commit output. Drop it at the end.
- Checks before each commit: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`; SQL task also
  `tests/sql/lunch-break.sql` all PASS on the clone.

## Task 1 — Migration `supabase/migrations/20261116120000_lunch_break.sql`

- [ ] Add columns `lunch_start time not null default '13:00'`, `lunch_minutes integer not null
  default 60` to `public.work_settings`; comment both (FR-93).
- [ ] `update public.work_settings set lunch_minutes = 0 where not (<exact CHECK predicate, minutes form>);`
- [ ] `alter table … add constraint work_settings_lunch_sane check (lunch_minutes between 0 and 180
  and (lunch_minutes = 0 or (lunch_start >= work_start and lunch_start + make_interval(mins =>
  lunch_minutes) <= work_end)))`. Note `time + interval` wraps at midnight: also require
  `lunch_start + interval > lunch_start` or compare in minutes
  (`extract(epoch from lunch_start)/60 + lunch_minutes <= extract(epoch from work_end)/60`). Use the
  minutes form.
- [ ] `create function private.lunch_overlap_minutes(p_company uuid, p_start time, p_end time)
  returns integer language sql stable security definer set search_path = ''` — minutes of
  `[p_start,p_end)` ∩ `[lunch_start, lunch_start+lunch_minutes)`, `greatest(0, …)`, 0 when no row.
  `revoke all … from public`; grant like other private helpers (check `schema.sql` for the pattern).
- [ ] `create or replace function public.compute_requested_minutes(...)`: in the hour branch after
  the errand early-return and the working-day check, return
  `span - private.lunch_overlap_minutes(p_company_id, p_start_time, p_end_time)`.
- [ ] `create or replace function private.submit_leave_impl(...)`: the two cap checks
  (`> v_cap` on the span and `v_day_used + span > v_cap`) use the net span. The `v_minutes <= 0`
  refusal becomes: refuse unless `p_kind = 'leave' and p_unit = 'hour' and <day is working> and
  span > 0` (i.e. zero only because of lunch). Working day = `not private.is_company_weekend(...)
  and not exists holiday` (same as compute_requested_minutes).
- [ ] In submit: FR-57 one-per-day `exists` adds `and r.requested_minutes > 0` and runs only when
  the new net minutes > 0; strict balance check guarded by `v_minutes > 0`.
- [ ] Add `private.is_working_day(company, date)` and use it for the exception.
- [ ] Same changes in `private.edit_request_impl(...)` (cap checks at the hourly block; the
  `v_minutes <= 0` refusal after `compute_requested_minutes`; use `r.kind`).
- [ ] Verify approve (`private.finalize_approval_request`) and cancel already skip the ledger when
  paid = 0 (`v_paid > 0`); no change expected.

## Task 2 — SQL test `tests/sql/lunch-break.sql`

Pattern: copy the header/helpers from `tests/sql/manager-overdraft.sql` (begin … rollback, fixtures,
`pg_temp.expect`). Company with window 08:00–17:00, lunch 13:00/60, an annual type with
`allow_hourly`, an employee with balance, one approval step. Assert:
- [ ] 12:00–15:00 leave on a working day → `requested_minutes = 120`.
- [ ] 13:30–15:00 → 90; 08:00–12:00 → 240; 14:00–16:00 → 120.
- [ ] Cap 240: 11:00–16:00 (net 240) accepted; 10:00–16:00 (net 300) refused "exceeds the daily limit".
- [ ] 13:00–14:00 submits with `requested_minutes = 0`; approving it writes no ledger row and the
  balance is unchanged; status `approved`.
- [ ] Hourly errand 12:00–15:00 → 180.
- [ ] 13:00–14:00 on a weekend and on a holiday still refused (`greater than 0`).
- [ ] Employee with negative available balance can file 13:00–14:00 (0 min).
- [ ] 13:00–14:00 pending, then 15:00–17:00 same day accepted (lunch-only does not take the slot);
  two non-zero hourly leaves same day still refused.
- [ ] `lunch_minutes = 0` → 12:00–15:00 = 180.
- [ ] CHECK: updating lunch_start to 16:30 with 60 min (past 17:00) fails; 07:00 (before window) fails.
- [ ] Edit (`app_edit_request` path, as admin or HR) of an hourly leave to 12:00–15:00 → 120.
- [ ] Pre-existing request rows keep their `requested_minutes` after the migration (assert on a row
  inserted before changing lunch settings — or note that the migration contains no UPDATE on
  leave_requests).

## Task 3 — TS helpers + settings plumbing

- [ ] `lib/leave/hourly.ts`: `lunchOverlapMinutes(range: TimeRange, lunch: {start: string; minutes:
  number}): number` and `netHourlyMinutes(range, lunch)`; tests in `tests/unit/hourly.test.ts`
  (before/after/straddle/inside/edges/minutes 0/reversed range).
- [ ] `lib/leave/workSettings.ts`: `WorkSettings` gets `lunchStart: string; lunchMinutes: number`;
  fallback `'13:00'`, `60`.
- [ ] `lib/actions/leave/reference.ts` + `lib/actions/settings.ts` (`getWorkSettings`-style reader and
  `updateWorkSettings`) select / upsert `lunch_start`, `lunch_minutes`; strip seconds like
  `work_start`.
- [ ] `lib/leave/settings-validation.ts` `validateHourlySettings` takes lunch start + minutes; same
  rule as the CHECK; tests in the existing validation test file.
- [ ] `lib/supabase/types.ts`: the two columns on `work_settings` Row/Insert/Update.

## Task 4 — UI

- [ ] `app/[locale]/(app)/settings/WorkSettingsForm.tsx` (+ `settings/page.tsx` props): in the
  "Working hours and hourly leave" row add **Lunch starts** (time input) and **Lunch duration
  (minutes)** (number 0–180). Update the card hint ("…the lunch break is not deducted"). New
  `dbErrors`/validation message if lunch is outside the window.
- [ ] `app/[locale]/(app)/request/hourly/HourlyRequestForm.tsx`: `durationMinutes` = net
  keep `spanMinutes` (raw) for the time check, replacement query and delegation query (else a
  lunch-only request can never get a delegation preview); `netMinutes` for `overLimit` and
  `useLeaveBalance(selectedTypeId, spanMinutes > 0 ? netMinutes : null)`. Muted note "Lunch break
  (1h) not deducted" when overlap > 0.
- [ ] `EditRequestDialog.tsx`: no change (shows no duration; the DB is authoritative).
- [ ] `lib/errors/db-error.ts`: map the lunch CHECK / "lunch break must fall within working hours";
  `updateWorkSettings` returns that message for a lunch outside the window.
- [ ] Strings in `messages/fa.json` + `messages/en.json` (messages-parity test must pass).

## Task 5 — Verify, docs

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] Dump `schema.sql` from the clone (`pg_dump -s -d lunch`, same flags as
  `scripts/dump-schema.sh`); commit it minus CHECK re-parenthesis noise hunks.
- [ ] After merge: apply to the local stack the way earlier sessions did (pg_dump -Fc backup, then
  `bj_apply_migrations` so the ledger row is recorded, View-as hook sync, restart rest/app). Live
  gets it through CI on push to main.
- [ ] Browser check on :3501: Settings shows lunch fields and saves; hourly form shows net + note.
- [ ] Docs: `docs/REQUIREMENTS.md` FR-93, `docs/DATA_MODEL.md` (work_settings columns + counting),
  `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/AGENT-LOG.md`, CLAUDE.md gotcha line.

## Review focus

1. Redefined functions keep every FR-88..92 change (diff new body vs `schema.sql`).
2. The 0-minute exception cannot let weekend/holiday hourly leave or errands through.
3. Cap uses net in both submit and edit; TS mirror matches SQL exactly at the edges.
