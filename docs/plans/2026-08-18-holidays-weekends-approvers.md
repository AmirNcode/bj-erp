# Plan — bulk holidays, bi-weekly weekends, extensible approval steps, field errors

**Spec:** `docs/specs/2026-08-18-holidays-weekends-approvers-design.md`
**Requirements:** FR-39, FR-40, FR-41, FR-42
**Branch:** `main`, on top of the uncommitted FR-34/35/36/37/38 work already in the tree.

Four batches, ordered cheapest-and-safest first. Each ends green on the full gate:
`npx tsc --noEmit` · `npm run lint` · `npm run test:unit` · `npm run build` · the e2e suite run
**against the built container** (`E2E_BASE_URL=https://192.168.2.70:3500`), which is ~4× faster than
a long-lived `next dev` and does not produce its phantom failures.

Every migration is applied twice to the local database to prove idempotency, and every new
assertion is sabotage-checked — break the thing on purpose, watch the test fail, restore it. That
check has caught two worthless tests and one vacuous assertion in this repo already.

---

## Batch A — FR-39 duplicate personnel number, on the field

No migration. Smallest, and it fixes a bug the owner is hitting today.

1. `lib/errors/db-error.ts` — add three rules (`personnel number already exists`,
   `invalid personnel number`, `duplicate key value.*profiles_company_personnel_no_key`), and give
   `Rule` an optional `field`. `localizeDbError` returns `{ message, field }`; `dbErr` carries the
   field onto the result. Existing callers destructure `.error` and are unaffected.
2. `messages/{fa,en}.json` — `dbErrors.duplicatePersonnelNo`, `dbErrors.invalidPersonnelNo`.
   Key trees stay identical and in the same order.
3. `NewEmployeeForm.tsx` — `fieldError` state; render under the personnel input with
   `aria-invalid` / `aria-describedby`; suppress the top banner when the error is field-scoped.
4. Tests: unit cases for the three new rules and for the field mapping; an e2e that creates an
   employee, creates a second with the same personnel number, and asserts the message appears at
   the field and **not** in the banner.

**Done when** the screenshot's flow says "this personnel number is already in use" beside the field.

---

## Batch B — FR-40 bulk holiday upload

No migration. Reuses the CSV reader and the employee-import wizard shape.

1. `lib/csv/holiday-rows.ts` — new, pure: `HOLIDAY_COLUMNS`, `holidayTemplate()`,
   `parseHolidayDate` (Jalali-or-Gregorian by the `< 1600` year rule, reusing
   `parseHireDate`'s construction), `parseYesNo`, `validateHolidayRows` returning
   `{ rows, errors }` with `{ line, field, messageKey }` errors — the same shape the employee
   import's error list already uses, so the wizard's error rendering is reusable.
2. `lib/actions/settings.ts` — `bulkUpsertHolidays(rows)`: admin-guarded, one PostgREST `upsert`
   on the `(company_id, holiday_date)` key, returns `{ added, updated }`.
3. `app/[locale]/(app)/manage/settings/HolidayImportDialog.tsx` — template download, file picker,
   validation preview (per-line errors, or "X new, Y will be updated"), confirm.
4. `HolidayEditor.tsx` — a bulk-upload button beside Add.
5. Tests: unit for the parser (both calendars, all yes/no spellings, bad dates, missing columns,
   duplicate dates *inside* one file); e2e uploading a small file and asserting the rows land and a
   re-upload updates rather than duplicates.

**Done when** an admin uploads a year of holidays in one go and a corrected re-upload fixes them.

---

## Batch C — FR-41 weekend frequency

**Two migrations**, and the riskiest batch — it changes the function every request's minutes come
from. SQL is proven in rolled-back transactions *before* any UI is written.

1. `supabase/migrations/20260818170001_weekend_frequency.sql` — add
   `work_settings.biweekly_weekend_days int[] not null default '{}'` and `biweekly_anchor date`;
   create `private.is_company_weekend(company_id, date)` holding the whole rule (weekly OR
   biweekly-with-matching-parity, Saturday-anchored week grid per D17).
2. `supabase/migrations/20260818170002_weekend_frequency_counting.sql` — redefine
   `compute_requested_minutes` so all four weekend tests call the helper. The live body is the one
   in `20260806014310`; confirm that from the catalog with `pg_get_functiondef`, not by grepping
   migrations, and patch it programmatically rather than retyping it.
3. `lib/leave/weekend.ts` — `isWeekend(date, { weekendDays, biweeklyDays, anchor })`; widen
   `validateWeekendDays` to the union rule and require an anchor when biweekly days exist.
4. `lib/leave/workingDays.ts`, `lib/leave/calendarMonth.ts` (`buildCalendarMonth`,
   `nextWorkingDateAfter`) — route through it.
5. `lib/actions/leave.ts` `WorkSettings` + `lib/leave/workSettings.ts` fallback + `lib/actions/settings.ts`
   `updateWorkSettings` + `lib/supabase/types.ts` (hand-edited — the generator cannot reach its
   registry from here).
6. `WorkSettingsForm.tsx` — three-way per-weekday control and the anchor date picker.
7. Tests: unit cases for parity across a year, dates before the anchor, negative modulo, an
   anchor-less biweekly rejected, the union leaving zero working days rejected; e2e setting
   Thursday to every-other-week and asserting a request spanning two Thursdays counts one of them.

**Done when** a leave request spanning two weeks charges for one Thursday, not two.

---

## Batch D — FR-42 approval steps by role or person, editable by HR

**Two migrations.** Stacks directly on the still-undeployed `20260818160001`–`160003`.

1. `supabase/migrations/20260818180001_approval_steps_person.sql` — add
   `approval_steps.approver_id`; drop `approval_steps_company_role_uniq`; create the two partial
   unique indexes; add `leave_request_approvals.step_id`; swap its unique constraint for the
   `coalesce(step_id::text, step_role::text)` unique index; widen the `approval_steps`
   INSERT/UPDATE/DELETE policies to admin **or** hr.
2. `supabase/migrations/20260818180002_approval_chain_person_engine.sql` — redefine
   `approve_leave_request` / `reject_leave_request`: a step with an `approver_id` is fillable only
   by that person, and the recorded row carries `step_id`.
3. `lib/leave/approvals.ts` — mirror the new condition; extend `ApprovalStep` with `approverId`.
4. `lib/actions/settings.ts` — `createApprovalStep`, `deleteApprovalStep`, `searchApprovers`
   (name or personnel number over active profiles); widen the existing guards to admin ∪ hr.
5. `ApprovalStepsCard.tsx` — an **Add approval step** button below the list and above the
   "require the order to be followed" checkbox, exactly where the owner asked for it; a dialog
   choosing role *or* person; a red flag on a step whose named approver is inactive; delete.
6. `manage/settings/page.tsx` — currently admin-only; admit `hr` **to this card only**, leaving
   work settings, holidays and departments admin-only.
7. `lib/leave/paperForm.ts` + the print page — the additional-approvals strip (D30).
8. Tests: unit for person-step selection and the inactive-approver block; SQL scenarios in
   rolled-back transactions (person signs → completes; wrong person → refused; deactivated named
   approver → blocked; admin still fills any step); e2e for HR adding a step and a named person
   signing.

**Done when** admin or HR can add "this named person must sign every request" and the chain waits
for them.

---

## Deployment note

Nothing here reaches the client until it ships together with the **eight already-undeployed
migrations** from the FR-34/35/36/37/38 work. Batches C and D add four more, for twelve. The app
build and its migrations must ship in one release — deploying a build against the old schema breaks
the screens whose queries name new columns.
