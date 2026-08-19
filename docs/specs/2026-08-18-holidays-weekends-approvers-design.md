# Bulk holidays, bi-weekly weekends, extensible approval steps, field-level errors

**Date:** 2026-08-18 · **Status:** frozen design record
**Requirements:** FR-39 (field-level duplicate-code error), FR-40 (holiday bulk upload),
FR-41 (weekend frequency), FR-42 (extensible approval steps)
**Depends on:** the uncommitted FR-34/35/36/37/38 work already in the tree — FR-42 in particular
edits `approval_steps` and `leave_request_approvals`, which migrations `20260818160001`–`160003`
created and which the client's server does not yet have.

## Scope

Four changes the owner asked for on 2026-08-18, in the order they were raised:

1. Creating an employee with a personnel number that is already taken shows a generic
   "unexpected error" banner. It must name the problem, on the field.
2. Official holidays need a bulk CSV upload with a downloadable template.
3. The real working week is **Friday off every week, Thursday off every other week**. The schema
   only models "these weekdays are always off".
4. Admin **and HR** must be able to add approval steps beyond the seeded manager + HR — either
   another role, or a **named person** searchable by name or personnel number.

Owner decisions taken on 2026-08-18 are marked **[owner]**.

---

## Part 1 — Duplicate personnel number is reported on the field (FR-39)

### Root cause (verified, not inferred)

The screenshot's "An unexpected error occurred" is not a UI problem. It is the **unmapped-error
fallback**.

`private.create_employee_impl` raises, with errcode `23505`:

```sql
if exists (select 1 from public.profiles
            where company_id = p_company_id and personnel_no = v_pno) then
  raise exception 'personnel number already exists' using errcode = '23505';
end if;
```

`lib/errors/db-error.ts` has rules for `employee code already exists` and for the raw
`profiles_employee_code` constraint — but **none matching `personnel number already exists`**. So
`localizeDbError` falls through every rule, logs `[db-error] unmapped:`, and returns
`dbErrors.unexpected`. Confirmed against the live local function body, not read off a migration
file (migration history contains two versions of this function; only the later one runs).

`invalid personnel number (1-10 digits)` — raised by the same function, and by
`lib/actions/employees.ts:82` before the round-trip — is unmapped for the same reason.

### Decisions

- **D1.** Fix the mapping first. Three rules are added: `personnel number already exists`,
  `invalid personnel number`, and `duplicate key value.*profiles_company_personnel_no_key`. The
  third is not redundant: the in-function `exists` check is a *pre-check*, and two concurrent
  creates can still reach the unique index. A user-facing message must exist for the path that
  actually enforces uniqueness, not only for the friendly one.
- **D2.** Errors gain an optional **field** so the form knows where to render them. Server actions
  return `{ ok: false, error, field?: 'personnel_no' }`. Everything without a `field` keeps the
  banner exactly as today — this is additive, not a rewrite of error handling.
- **D3.** The field is bound to the rule, not to the call site. `db-error.ts` is the one place that
  knows which raw message means which field, so a future action raising the same message gets the
  same placement free.
- **D4.** `NewEmployeeForm` renders a field error under the Personnel number input, with
  `aria-invalid` and `aria-describedby` on the input (NFR-7). The top banner is suppressed when the
  error is field-scoped, so the same failure is never reported twice.
- **D5.** **Not** a live availability check as the user types. The owner asked for it "when I press
  the create employee button". A keystroke-triggered probe would also leak the company's personnel
  numbering to any authenticated caller.
- **D6.** The bulk CSV import is untouched — it already reports per-row, per-field errors.

---

## Part 2 — Bulk holiday upload (FR-40)

### Decisions

- **D7.** CSV, reusing `lib/csv/parse.ts` (`parseCsv` / `buildCsv`). No new dependency — the same
  choice the credentials export and the employee import already made, and the reason FR-37's export
  is a CSV rather than a real workbook.
- **D8.** Four columns, exactly the four fields on the existing holiday form: date, Farsi name,
  English name, repeats yearly.
- **D9.** The date column accepts **Jalali or Gregorian**, disambiguated by the year: a year below
  1600 is Jalali. This is not a new convention — it is the rule `parseHireDate` already applies to
  the employee import's hire-date column, and reusing it means one behaviour for the admin to learn.
  The downloaded template carries **Jalali** examples, because every date the app displays is Jalali.
- **D10.** "Repeats yearly" accepts `yes/no`, `true/false`, `1/0`, `بله/خیر`, and empty (= no).
  Excel in a Farsi locale will not necessarily write what an English template suggests.
- **D11. [owner]** **Validate the whole file before writing anything, then overwrite duplicates.**
  A row whose date already exists updates that holiday's names and repeat flag; a new date is
  inserted. The result screen reports `X added, Y updated`. This makes re-uploading a corrected
  file the natural fix for a typo, which the skip and reject alternatives both make painful.
- **D12.** Written through the **existing `holidays` admin RLS policies** — no new RPC and no new
  `SECURITY DEFINER` surface, matching how the FR-24 editor already writes. One PostgREST `upsert`
  on the `(company_id, holiday_date)` unique key sends the whole validated set as a single
  statement, so it is atomic without a wrapper function.
- **D13.** `is_recurring` stays informational, as DATA_MODEL already records: day counting matches
  exact dates because Jalali recurrence has no fixed Gregorian month-day. The upload does **not**
  expand a recurring row into future years, and the screen repeats the existing editor's warning.

---

## Part 3 — Weekend frequency (FR-41)

The HR manager's actual week: **Friday off every week, Thursday off every other week.**

### Decisions

- **D14. [owner]** **Anchor date, strict alternation.** The admin picks one reference date that
  *is* a day off; the app alternates from it indefinitely. The two alternatives were rejected with
  the owner: "1st and 3rd Thursday of the Jalali month" drifts, because a Jalali month can hold
  five Thursdays and the gap across a month boundary is then one week or three; odd/even Jalali
  week number resets at Farvardin 1, so one year-boundary week is off twice or on twice.
- **D15. [owner]** The alternating Thursday is a **full** day off, identical to Friday. Half-day
  weekdays are explicitly out of scope: weekend days are binary in both the SQL counter and its TS
  mirror, and making them fractional would touch every duration path.
- **D16.** `weekend_days` keeps its exact current meaning and is **not** migrated. Two columns are
  added to `work_settings`:

  ```
  biweekly_weekend_days int[]  not null default '{}'
  biweekly_anchor       date   null
  ```

  A date is a weekend if its ISO weekday is in `weekend_days` **OR** (it is in
  `biweekly_weekend_days` **AND** its week has the same parity as the anchor's). The default `{}`
  makes the new branch a no-op, so every existing install — including the client's — behaves
  identically until an admin changes the setting. That is what makes this migration safe to deploy
  against live data.
- **D17. The week grid starts on Saturday, not Monday.** Parity is
  `floor((d - date '2000-01-01') / 7)`, and 2000-01-01 was a Saturday. Using the ISO Monday grid
  would split one Iranian week (Sat–Fri) across two buckets, so a Saturday and the Thursday of the
  same working week could land on opposite parities. Nothing in the current schema forced this
  choice, which is exactly why it is written down. The division is **floored, not truncated**: the
  two agree for every realistic date, which is precisely why a truncating version passed the whole
  unit suite until a case straddling the epoch was added to tell them apart.
- **D18.** The rule lives **once**, in a new `private.is_company_weekend(company_id, date)`, and
  every weekend test in `compute_requested_minutes` calls it. **Corrected during implementation:
  that function repeats `extract(isodow from d)::int <> all (v_weekend)` in THREE places, not
  four** — the hourly-leave branch, the am/pm half-day branch, and the daily loop. The daily-ERRAND
  branch returns inclusive calendar days × `hours_per_day` and never consulted `weekend_days` at
  all, because an errand may fall on a weekend or holiday (FR-30/FR-33). It stays that way; routing
  it through the helper would have quietly changed errand durations. Adding a second condition to
  copies by hand is how the port bug in `DATA_MODEL`'s "map SQL dependencies with the catalog"
  lesson happened. `countWorkingDays` in TS mirrors the helper and must stay in lockstep, same
  contract as `compute_requested_minutes` today.
- **D19.** Validation widens: the union of `weekend_days` and `biweekly_weekend_days` must leave at
  least one working weekday, and `biweekly_anchor` is required whenever `biweekly_weekend_days` is
  non-empty. A biweekly rule with no anchor has no defined parity and must be impossible to save,
  not defaulted.
- **D20.** The calendar's own weekend shading (`lib/leave/calendarMonth.ts`) and
  `nextWorkingDateAfter` take the same rule, or the grid would disagree with the balance.
- **D21.** Changing the setting affects **future counting only** — the same as changing
  `weekend_days` or the holiday list today. Approved requests keep the minutes their ledger row
  recorded; requests still pending are recomputed at approval, which is existing behaviour and not
  introduced here.
- **D22.** UI: each weekday in Work Settings gets a three-way choice — **working / off every week /
  off every other week** — replacing the current checkbox row, plus one date picker ("the next
  Thursday that is off") shown only when some day is set to every-other-week. Three states cannot
  be a checkbox, and a second parallel checkbox list would let an admin mark a day both weekly and
  biweekly.

---

## Part 4 — Approval steps by role or named person (FR-42)

Today `approval_steps` is seeded with manager + HR, `unique (company_id, role)`, admin-write only,
and the card offers order and active only. The owner wants a button to **add** a step, which may be
a role or a specific person, and wants **HR** to be able to use it.

### Decisions

- **D23.** `approval_steps` gains `approver_id uuid null references profiles(id)`. NULL means the
  step is filled by role, exactly as today. Non-NULL means **only that person** may fill it. Adding
  a nullable column keeps every seeded row and every existing query correct with no backfill.
- **D24.** `unique (company_id, role)` is dropped and replaced by two partial unique indexes:
  `(company_id, role) where approver_id is null` and `(company_id, approver_id) where approver_id
  is not null`. The old constraint would have allowed only one named person in the entire company,
  since every person-step needs some role value.
- **D25.** `leave_request_approvals` gains `step_id uuid` (nullable, **no foreign key** — the same
  reasoning that kept `step_role` unlinked: recorded evidence must not change or vanish when
  configuration is reordered or deleted). Its unique constraint becomes a unique **index** on
  `(request_id, coalesce(step_id::text, step_role::text))`. Existing rows have a NULL `step_id` and
  keep their old key, so the backfilled history stays valid.
- **D26. [owner]** **A named approver who is deactivated blocks the step.** Requests needing it stay
  pending and the Settings card flags the step in red. The alternatives were rejected: falling back
  to the role silently widens who may sign a document the company chose one named person for, and
  auto-deactivating the step silently removes a required signature from a signed paper-equivalent
  form. No FK cascade is involved — profiles are never hard-deleted here, and `private.is_active`
  already refuses a deactivated caller, so the block is a consequence of the existing rule rather
  than new logic.
- **D27.** Write access widens from `is_admin` to `is_admin OR private.has_role(uid,'hr')` on
  `approval_steps`, per the owner. Note what this does **not** do: HR still cannot edit
  `work_settings`, `holidays`, `departments`, or roles. This is one table.
- **D28.** The step-selection engine gains one condition — a step with a non-NULL `approver_id` is
  fillable **only by that person**. `lib/leave/approvals.ts` mirrors it, as it already mirrors the
  rest.

  **Resolved during implementation: an admin may NOT override a named step**, which contradicts the
  first draft of this decision. FR-36 gives an admin the escape hatch to fill any *role* step so a
  company whose admin has no manager above them is not stuck. A named step is different: the whole
  point of naming a person is that their signature specifically is required, and an admin who could
  sign in their place would make the naming advisory. It also cannot be reconciled with D26 — a
  deactivated approver does not "block" if an admin can simply sign past them. The remedy for a
  departed approver is to change the configuration, which D27 has just put in reach of both admin
  and HR, not to forge around it. Self-approval stays as FR-36 left it: nobody but an admin signs
  their own request, and a named approver is not exempt from that.
- **D28a.** Outstanding-step and remaining-step tests must key on the **step**, not its role:
  `a.step_id = s.id or (a.step_id is null and a.step_role = s.role)`. Several named people may share
  one role, and the pre-FR-42 role-only test would have treated them as a single step — the first to
  sign would complete a step the others never filled. The second arm is what keeps backfilled
  evidence matching.
- **D29.** Deleting a step is permitted. Evidence rows survive by D25, so a printed historical form
  still shows who signed.
- **D30.** **Printing.** The four boxes on BJ-F 50210 / 50208 / 50207 are the client's real
  stationery and are not changed. A step beyond those four prints in an **additional-approvals
  strip below the boxes**, labelled with the signer's name and role. The alternative — silently
  dropping a captured signature off the printed sheet — would make the print a false record.
- **D31.** The person picker searches **name or personnel number** over active company profiles, an
  existing `can_read_all` read for admin and HR. No new policy.

---

## Risks

- **FR-41 touches the duration contract.** `compute_requested_minutes` is the function every
  request's minutes come from. The mitigation is D18's single helper plus the TS mirror's existing
  unit suite, and SQL scenarios exercised in a rolled-back transaction before any UI is written —
  the method that proved the FR-36 engine.
- **FR-42 changes a unique constraint on a table holding approval evidence.** `20260818160002`
  backfilled real client decisions into `leave_request_approvals`, and that migration is itself
  still undeployed. The index swap is written to be valid for rows with a NULL `step_id`, and is
  applied *after* the backfill in filename order so a fresh install and an upgraded one converge.
- **All of this stacks on eight undeployed migrations.** Nothing here reaches the client until that
  whole set ships together; the app build and its migrations must go in one release, as they did
  for `decision_note`.

## Requirements touched

New: FR-39, FR-40, FR-41, FR-42. Amended: FR-24 (holiday editor gains bulk upload; work settings
gain frequency), FR-36 (steps may name a person; HR may configure them), FR-12 (working-day count
gains the bi-weekly rule).
