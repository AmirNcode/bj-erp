# AGENT LOG — running journal of what agents changed

**Every agent that touches this repository MUST append an entry here before finishing its
session.** This is not optional and not conditional on the size of the change. An agent that
edits code, config, deployment files, the database, or the live server and leaves no entry has
left the next agent blind.

## Why this file exists

`docs/CHANGELOG.md` records **what shipped**, grouped by feature, written for a release reader.
`docs/MEMORY.md` records **durable lessons** that outlive any one change. Neither answers the
question an agent actually has when it opens this folder cold:

> *Someone was here after me. What did they do, why, what state did they leave things in, and
> what is half-finished?*

This file answers that. It is chronological, session-scoped, and includes things a changelog
would never carry — commands run against the client's live server, investigations that found
nothing, decisions deliberately deferred, work left uncommitted.

## Rules for agents

1. **Append a new entry at the top of "Entries"** (reverse chronological — newest first).
2. **Write it before you end the session**, not "later". If the user ends the session early,
   log what you did up to that point.
3. **Log the failed and abandoned work too.** A dead end you already explored is worth as much
   to the next agent as a success — it stops them repeating it.
4. **Log actions taken outside the repo**: commands run on the client's server, database
   changes, anything done over SSH. These leave no git trace and are the easiest thing to lose.
5. **Be concrete.** File paths with line numbers, exact commands, exact error text. "Fixed the
   login bug" helps nobody; "`NEXT_PUBLIC_SUPABASE_URL` lacked the port, so the browser called
   :443" does.
6. **State verification honestly.** What you actually ran, and what it actually printed. If you
   did not run the tests, say you did not run the tests.
7. **Never rewrite or delete someone else's entry.** If an earlier entry turns out to be wrong,
   add a new entry that corrects it and link back.

### Where each kind of information belongs

| Information | Goes to |
|---|---|
| Everything you did this session, in order | **this file** (always) |
| A user-facing feature or fix that shipped | also `docs/CHANGELOG.md` |
| A lesson that will still matter in six months | also `docs/MEMORY.md` |
| Work now done / newly discovered work | also `docs/TASKS.md` |
| A frozen design decision for a module | also `docs/specs/<date>-<name>.md` |

This file is the one that is **always** updated. The others are updated when they apply.

### Entry template

Copy this block verbatim and fill it in.

```markdown
## YYYY-MM-DD — <short title of the session's work>

**Agent:** <model / tool, e.g. Claude Opus 5 via Claude Code>
**Branch / HEAD at start:** <branch> @ <sha>
**Trigger:** <what the user asked for, in one sentence>

**What changed**
- `path/to/file.ts:42` — what and why

**Actions outside the repo**
- <server commands, DB changes, deploys — or "none">

**Verification**
- <commands run and their actual result — or "not run, and why">

**State left behind**
- <committed? uncommitted? branch? pushed? what is unfinished or unverified>

**For the next agent**
- <traps, follow-ups, things deliberately not done>
```

---

# Entries

## 2026-08-18 (follow-up) — One shared date reader; the calendar-range error speaks

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `c778c7b`, every batch below still uncommitted
**Trigger:** Amir asked why hire dates are stored Gregorian at all, then — after that was
answered — what happens to a hire date before 1400, since real staff may predate it. Investigating
that turned up a second unmapped error. He then asked for both fixes.

**What was investigated first (no code, but the reason for the code)**

- **Hire dates before 1400 are FINE.** Verified end to end on the local database: an employee hired
  `1355/01/01` (1976, fifty years of service) was created through `app_create_employee`, stored,
  and `accrue_leave` produced the correct 2400 minutes. Conversion back to 1300 (1921) round-trips
  exactly. Two things were being conflated — converting a Persian date uses calendar arithmetic and
  works for any year, whereas `jalali_months` (1400–1450) bounds which months leave can be
  ACCRUED for. Nothing looks a hire date up in that table; `accrue_leave` only compares against it.
- **The 1400 floor bites LEAVE REQUEST dates, not hire dates.** `private.submit_leave_impl` looks
  the request's start date up in `jalali_months` to derive the serial year. Tested: a request dated
  `2020-06-01` or `2073-06-01` is refused with `date outside supported calendar range`.
- **And that message was UNMAPPED** — the same class of bug as the personnel number earlier today,
  in a different place. Back-dating a request produced "An unexpected error occurred."
- Also confirmed there is no lower bound anywhere on a hire date: no `minDate` on the picker, no
  CHECK constraint, no validation in `create_employee_impl`.

**What changed**

- `lib/leave/parseUserDate.ts` — **new**. The single point where a TYPED date becomes a stored one.
  `parseHireDate` and `parseHolidayDate` are now `export const … = parseUserDate`, keeping their
  names at the call sites. Both were near-identical copies carrying the same bug; I fixed one in
  batch B and not the other, purely because they were separate files. That is the whole argument for
  consolidating rather than patching the second copy.
- The round-trip check moves in with it: `DateObject.isValid` NORMALISES an out-of-range day and
  still returns true, so `2026-02-30` became 2026-03-02 and `1405/12/30` became `1406/01/01` — a
  whole Persian year. A naive "reject day > 30" would be wrong; 31 Shahrivar and 30 Esfand of a leap
  year are real. Only building the date and reading it back distinguishes them.
- `lib/errors/db-error.ts` — new rule for `date outside supported calendar range`, plus
  `dbErrors.dateOutOfCalendarRange` in both message files. The rule carries a NOTE that the
  translation names Farvardin 1400 and must be updated if `jalali_months` is ever widened.
- Tests: `tests/unit/parse-user-date.test.ts` **new** (12 cases); `csv-import-rows.test.ts` gains the
  rollover class, the genuine month-ends that a naive cap would break, pre-1400 hire dates, and a
  row-level assertion that a rolled date is reported as `badDate` on its line.

**Actions outside the repo**

- **Nothing against the client's server. No SSH, no VPN, no deploy.**
- Local database only, all inside rolled-back transactions: created employees hired 1976 and 2001,
  ran accrual on them, and attempted leave requests dated 2020 and 2073.

**Verification** — all actually run:

- `tsc` clean · `lint` clean · `build` clean · **unit 434/434 across 48 files** (was 418/46) ·
  **full e2e serial: 45 passed, 1 pre-existing skip** — unchanged, which is the point: both CSV
  importers have e2e coverage and the consolidation did not disturb it.
- **Sabotage check: reverting the round-trip guard to bare `isValid` fails SIX tests across all
  three suites** (the shared parser's, the employee import's, the holiday import's), and all 58 pass
  when restored. The earlier version of the employee-import suite could not detect this at all —
  it tested `1404/13/01`, which the explicit month guard catches, and never probed a day overflow.
- The new error mapping was checked by calling `localizeDbError('date outside supported calendar
  range')` directly: it now returns the sentence, not the generic fallback.
- One expectation I wrote was wrong and the code was right: I asserted `1404/12/29` → `2026-03-19`;
  it is `2026-03-20`, the day before Nowruz 1405. Corrected in the test.

**State left behind**

- **Everything uncommitted**, on `main`, not pushed. Still **thirteen migrations** the client does
  not have — this follow-up added none.
- Local database and shared config untouched at the end; `npm run dev` on `http://localhost:3000`.

**For the next agent**

- **Any new place a person types a date must call `parseUserDate`.** That is the entire reason it
  exists. A third private copy would repeat this bug a third time.
- **`jalali_months` (1400–1450) is a limit on REQUEST dates, not on hire dates or on display.** If
  the client ever wants to load historical leave records, widening it is cheap —
  `scripts/gen-jalali-months.mjs` generates the seed — but the error message names Farvardin 1400
  and would need updating with it.
- The upper bound is 1450 / 2072-03-19. Not this decade's problem, but it is a hard stop, not a
  degradation.
- Amir pushed back on Gregorian storage generally. The answer given, and worth keeping: the bug was
  input validation, not storage format — `1405/12/30` does not exist in the Persian calendar either,
  so storing it as Persian text would preserve a day that never happened. Postgres has no Persian
  date type, and seven functions depend on real date arithmetic (day-by-day iteration, weekday
  extraction, date subtraction, week parity).


## 2026-08-18 (batch D) — FR-42: approval steps by role or named person, HR-configurable

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `c778c7b`, working tree carrying every uncommitted batch below
**Trigger:** Amir said "proceed with D" — the last of the four changes from the 2026-08-18 review.

**What changed**

- `20260818180001_approval_steps_person.sql` — `approval_steps.approver_id` (nullable, no
  `on delete` action), `role` widened to allow `employee` for person-steps with a CHECK that
  `employee` requires a named person, the old `unique (company_id, role)` replaced by two PARTIAL
  unique indexes (one role-step per role, one step per person), `leave_request_approvals.step_id`
  (nullable, deliberately no FK), INSERT/UPDATE/DELETE on `approval_steps` widened to admin **or
  hr**, and `public.search_approver_candidates(text)` for the picker.
- `20260818180002_approval_chain_person_engine.sql` — `approve_leave_request` and
  `reject_leave_request`, dumped from `pg_get_functiondef` and patched by a script whose every
  anchor had to match exactly once.
- `20260818180003_cleanup_e2e_approval_steps.sql` — see the bug below.
- `lib/leave/approvals.ts` — `fillableStep` now returns the STEP rather than a role; `fills()`
  keys evidence on the step with a role fallback. `lib/actions/settings.ts` gained
  `createApprovalStep`, `deleteApprovalStep`, `searchApproverCandidates` and an `isHr` context.
- `AddApprovalStepDialog.tsx` — **new**; `ApprovalStepsCard.tsx` gained the Add button (below the
  list, above the order checkbox, where Amir asked for it), a delete control, and a red flag on a
  step whose named approver is deactivated. `manage/settings/page.tsx` admits HR to that card only.
- The printed form gained an **additional-approvals strip** for steps beyond the paper's four boxes.

**Three decisions worth keeping**

1. **An admin may NOT override a named step.** My own spec draft said they could, which contradicted
   the owner's "a deactivated approver blocks" decision — a block is not a block if an admin can
   sign past it. Naming a person means that signature specifically is required; the remedy for a
   departed approver is to edit the configuration, which this batch just put in HR's reach too.
   Resolved in the spec (D28) rather than left ambiguous.
2. **Evidence keys on the STEP, not the role.** Several named people may share one role, and the
   pre-FR-42 role-only test would have let the first of them to sign complete a step the others
   never filled. This touches FOUR queries in the engine: step selection, the already-signed
   message, order enforcement, and the remaining-step count.
3. **The order switch stays admin-only.** It writes `work_settings`, whose policy is admin-only;
   admitting HR in the action would have moved a clear refusal into a database error. The card
   disables it for HR instead.

**Actions outside the repo**

- **Nothing against the client's server. No SSH, no VPN, no deploy.**
- All three migrations applied to the **local** database and applied a **second time** to prove
  idempotency. The first version of 180001 failed — `ERROR: functions in index expression must be
  marked IMMUTABLE`, because casting an enum to text is only STABLE — and was replaced by two
  partial indexes.
- Read-only SQL otherwise, in rolled-back transactions.

**Verification** — all actually run:

- `tsc` clean · `lint` clean · `build` clean · **unit 418/418 across 46 files** (was 408/45) ·
  **full e2e serial: 45 passed, 1 pre-existing skip** (was 44).
- **The engine was proven in SQL before a line of UI was written**, in rolled-back transactions: a
  named approver holding NO relevant role signed their step and the request stayed `pending`; the
  same person signing again was refused; an ADMIN signing the chain filled the **manager** step, not
  the named one, and **could not complete the chain alone** — status stayed `pending` with zero
  ledger rows; a **deactivated** named approver was refused with "not allowed to decide this
  request"; the full chain completed with exactly ONE ledger row and two distinct `step_id`s.
- The unit suite asserts those same outcomes. **Two sabotage checks, both caught:** letting an admin
  override a named step broke "an admin cannot complete the chain alone"; keying evidence on role
  only broke "two named people sharing a role each keep their own slot". Two more on the e2e:
  ignoring the named person, and blocking HR from Settings.

**A real bug the sabotage run exposed, and it was not in the feature**

`approval_steps.approver_id` has no `on delete` action by design, so a profile named in a step
cannot be deleted. `app_cleanup_e2e_users()` **hard-deletes** throwaway accounts, so a spec that
names one and then fails before its own cleanup leaves a row that blocks the reaper — for that run
and every run afterwards, since the junk account never goes away. Fixed by teaching the reaper to
drop steps naming the accounts it is about to delete (`20260818180003`), rather than by weakening
the constraint: production keeps "a named approver cannot be silently deleted". Proven with a junk
account named in a step: 1 step before, reaped 1 user, 0 steps and 0 profiles after.

**A second shared-state leak, fixed at the root this time**

Six specs failed on the first full run. Two causes, both shared company config that some specs edit
and many read: the demo admin's `language_pref` (Farsi-asserting specs depend on it since FR-34) and
`work_settings` weekend days. Per-spec cleanup does not help when a spec FAILS partway — the damage
lands on a different spec next run, which reports a confusing failure in code that is not at fault.
**`tests/e2e/global-setup.ts` is new** and restores both to baseline BEFORE the suite, so one bad run
can no longer poison every run after it. `weekend-frequency.spec` also normalizes at its own start.

`hr-role.spec` asserted that HR is bounced from `/manage/settings`. FR-42 deliberately changed that;
the boundary moved INSIDE the page, so the spec now asserts HR sees the approval card and that the
admin-only cards are **not rendered at all**.

**State left behind**

- **Everything uncommitted**, on `main`, not pushed. **THIRTEEN migrations** now exist locally that
  the client does not have: the eight from the HR/locale batch, two from FR-41, and three from FR-42.
- Local database has all of them; `approval_steps` back to the seeded manager + hr; `work_settings`
  at `{5} / {} / null`; demo admin on `fa`.
- `npm run dev` running on `http://localhost:3000`. The local container was **not** rebuilt.

**For the next agent**

- **A named approver cannot be deleted, only deactivated** — that is the FK doing its job. Any new
  code path that hard-deletes profiles needs the same treatment the e2e reaper just got.
- `private.is_company_weekend` / `lib/leave/weekend.ts` and the approval engine /
  `lib/leave/approvals.ts` are BOTH mirror pairs now. Change one, change the other.
- `fillableStep` returns the step object, not a role string. Callers read `?.role` or `?.id`.
- The printed sheet's additional-approvals strip covers steps outside the paper's four boxes. A
  person-step created with one of the box roles (the dialog never does; SQL could) prints inside that
  box instead, and two such steps would collide in `stepByRole`.
- **`parseHireDate` still has the silent date-rollover bug** — unrelated to this batch, still open.


## 2026-08-18 (later) — FR-39 field errors, FR-40 bulk holidays, FR-41 bi-weekly weekends

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `c778c7b`, working tree already carrying the whole uncommitted
FR-34/35/36/37/38 batch from the entry below
**Trigger:** Amir asked for four things after a full codebase review: (1) a duplicate employee code
should be reported on the field, not as a generic banner; (2) bulk CSV upload for official holidays
with a template; (3) the real working week is Friday off weekly **and Thursday off every other
week**; (4) admin *and HR* should be able to add approval steps, by role or by named person. He then
said "proceed with B and C" — so **batches A, B and C are built; batch D (FR-42) is designed and
planned but NOT started.**

**What changed**

- `docs/specs/2026-08-18-holidays-weekends-approvers-design.md` — **new**, decisions D1–D31, with
  the four owner decisions marked `[owner]`.
- `docs/plans/2026-08-18-holidays-weekends-approvers.md` — **new**, four batches A–D.

*Batch A — FR-39, the reported bug:*

- **Root cause was NOT a UI problem.** `private.create_employee_impl` raises
  `personnel number already exists` (errcode 23505), and `lib/errors/db-error.ts` had **no rule
  matching it**, so `localizeDbError` fell through every rule and returned `dbErrors.unexpected` —
  the exact banner in Amir's screenshot. `invalid personnel number (1-10 digits)` was unmapped for
  the same reason. Confirmed by dumping the LIVE function body from `pg_proc`, not by reading a
  migration: history holds two versions of that function and only the later one runs.
- `lib/errors/db-error.ts` — three rules added, plus an optional `field` on `Rule`, a new
  `fieldForDbError`, and `DbErrorResult`. `fieldForDbError` returns the field of the **first
  matching rule**, not the first field-carrying one, so the message and its placement can never come
  from different rules.
- `NewEmployeeForm.tsx` — field-scoped error under the personnel input with `aria-invalid` /
  `aria-describedby`, cleared on edit; the top banner is suppressed when the error has a field, so
  one failure is never reported twice.

*Batch B — FR-40 bulk holiday upload:*

- `lib/csv/holiday-rows.ts` + `tests/unit/holiday-rows.test.ts` — **new**, 30 cases. Reuses
  `lib/csv/parse.ts`; no new dependency.
- **A real bug found by writing the tests:** `react-date-object` NORMALISES an out-of-range day and
  still reports `isValid === true`. `2026-02-30` became 2026-03-02 and `1405/12/31` became
  1406/01/02. `parseHolidayDate` now confirms the parse by reading the value back. **`parseHireDate`
  in `lib/csv/import-rows.ts` has the identical bug and was deliberately NOT changed here** — it is
  the employee import's shipped behaviour and deserves its own change; a background task was filed.
- `lib/actions/settings.ts` — `bulkUpsertHolidays`: admin-only, one PostgREST upsert on
  `(company_id, holiday_date)` so the whole set lands atomically with no new RPC or policy.
- `HolidayImportDialog.tsx` — **new**; `HolidayEditor.tsx` gains the button and a shared `refresh()`.
- **Two UI defects fixed that the e2e exposed, not cosmetics:** the dialog scrolled as a whole, so
  the footer moved as the preview table mounted and a click aimed at Confirm could land on the
  overlay — silently dismissing the dialog and discarding the upload with no message. The tables now
  carry the scroll and the dialog height settles; Escape and outside-click are refused while parsed
  rows are pending.

*Batch C — FR-41 bi-weekly weekends:*

- `supabase/migrations/20260818170001_weekend_frequency.sql` — **new**.
  `work_settings.biweekly_weekend_days int[] default '{}'` + `biweekly_anchor date`, two CHECK
  constraints, and `private.is_company_weekend(company_id, date)` holding the whole rule.
- `supabase/migrations/20260818170002_weekend_frequency_counting.sql` — **new**. Body dumped from
  `pg_get_functiondef` on the live database and patched by a script whose every anchor had to match
  exactly once, per `docs/MEMORY.md`.
- **The spec said four weekend tests; there are THREE.** Hourly leave, am/pm half-day, and the daily
  loop. The daily-ERRAND branch never consulted `weekend_days` because an errand may fall on a
  weekend (FR-30/FR-33) — routing it through the helper would have silently changed errand
  durations. Spec corrected in place.
- `lib/leave/weekend.ts` — rewritten: `isWeekendDate` mirroring the SQL, widened
  `validateWeekendDays` (four reasons), `frequencyOf`. `workingDays.ts` and `calendarMonth.ts` now
  route through it. Plumbing through `lib/actions/{leave,settings}.ts`, `workSettings.ts`, and a
  hand-edited `lib/supabase/types.ts`.
- `WorkSettingsForm.tsx` — each weekday becomes a three-state native `<select>` (working / weekly /
  every other week) plus a reference-date picker shown only when some day is fortnightly. Native
  `<select>` because Playwright drives it with `selectOption` — a standing decision.

**Actions outside the repo**

- **Nothing against the client's server. No SSH, no VPN, no deploy.**
- Both new migrations applied to the **local** database and applied a **second time** to prove
  idempotency. The first version of `20260818170001` failed — Postgres forbids a subquery in a CHECK
  constraint — and its original end-assertion would have broken idempotency once an admin actually
  configured a bi-weekly day; both were fixed before it landed.
- Read-only SQL throughout otherwise, in rolled-back transactions.
- Reset the demo **admin**'s `language_pref` back to `fa` on the local database (see below). Needed
  `set_config('request.jwt.claims', …)` inside a transaction, because `auth.uid()` is NULL in a raw
  psql session and `enforce_profile_update_scope` refuses the write.
- Deleted leaked `تعطیلی گروهی%` holiday rows left by earlier failing e2e runs, and reset
  `work_settings` after two sabotage runs left it dirty. Local DB only.
- Killed the ~2.5-hour-old `next dev` (PID 47440) and started a fresh one via the preview tooling.

**Verification** — all actually run:

- `npx tsc --noEmit` clean · `npm run lint` clean · `npm run build` clean ·
  **unit 408/408 across 45 files** (was 344/43) · **full e2e serial: 44 passed, 1 pre-existing skip**
  (was 41 + 1 skip; three new specs).
- **The SQL was proven before any UI was written**, in rolled-back transactions: over one 28-day
  range, Friday-only = **24** working days, Thursday-weekly = **20**, Thursday-fortnightly = **22**,
  exactly between. Off-Thursday costs 0 as a full day, 0 as a half day and 0 hourly minutes; a
  worked Thursday costs 1 / 0.5 / 120. A daily errand across an off Thursday **and** Friday still
  counts 2 days, i.e. unchanged.
- The TS mirror asserts those same numbers, and `private.is_company_weekend` and `isWeekendDate`
  were compared case by case — **including dates on the far side of the week epoch**, where a
  floored and a truncating division disagree.
- **Four sabotage checks, all caught:** upsert→insert broke the holiday overwrite e2e; the Saturday
  week grid→Monday broke the parity test; dropping the persisted anchor and ignoring the bi-weekly
  list each broke the FR-41 e2e.
- **One sabotage was NOT caught at first and that was the useful part.** Replacing `Math.floor` with
  `Math.trunc` in the week index passed the entire suite, because every realistic date sits on the
  same side of the epoch. A case straddling 2000-01-01 was added; the sabotage then fails. The
  original test comment claimed the existing cases proved this — it was wrong and was rewritten.

**A pre-existing defect found by the full suite, NOT caused by this work**

`department.spec` (×2) and `hourly.spec` failed expecting Farsi and getting English.
`settings.spec.ts:61` deliberately left the **shared demo admin** on English and never restored it
("Back to English for the returning-user assertion after logout below" — there is no such assertion
below). Before FR-34 that was harmless because locale came only from the URL. **Since FR-34 the
stored preference is authoritative, so that account's language became shared mutable state that 17
specs implicitly depend on.** A `/fa/...` prefix is not an escape hatch either: next-intl normalises
it away before the app sees it, so the preference still wins. `settings.spec.ts` now switches back
to Farsi and asserts it before logging out. Full suite green afterwards.

**State left behind**

- **Everything uncommitted**, on `main`, not pushed, stacked on the already-uncommitted
  FR-34/35/36/37/38 batch. **Ten migrations now exist locally that the client does not have** — the
  eight from the entry below plus `20260818170001` and `20260818170002`.
- Local database: both new migrations applied; `work_settings` back at `{5} / {} / null`; holidays
  back to the original 4 rows; demo admin back on `fa`.
- `npm run dev` running fresh on `http://localhost:3000`. The local container was **not** rebuilt,
  so `https://192.168.2.70:3500` still serves the pre-batch-B/C image.
- **Batch D (FR-42 — approval steps by role or named person) is designed and planned but not
  started.** Amir said "proceed with B and C".

**For the next agent**

- **`parseHireDate` still silently rolls over impossible dates** (`2026-02-30` → 2026-03-02), which
  shifts accrual pro-rating because `hire_date` drives it. Fix mirrors `parseHolidayDate`.
- **Any spec that mutates a shared account's `language_pref` must restore it**, or it breaks
  unrelated specs that assert Farsi. This is now the second class of shared-state leak in this suite,
  after the throwaway-user one.
- The daily-errand branch of `compute_requested_minutes` deliberately ignores weekends. Do not
  "fix" it.
- `private.is_company_weekend` and `lib/leave/weekend.ts` must stay in lockstep, same standing
  contract as `compute_requested_minutes` / `countWorkingDays`.
- Sabotage-checking a *defensive* branch needs an input that actually reaches it. Realistic dates
  could not distinguish floor from trunc, so the check was vacuous until a deliberately unrealistic
  date was added.
- Batch D's migration must drop `approval_steps_company_role_uniq` and swap
  `leave_request_approvals`' unique constraint for an expression index — see the spec's D23–D31.
  That table holds backfilled real client approval evidence.


## 2026-08-18 (later) — Cold review; spec+plan for four new asks; FR-39 shipped

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `c778c7b`, carrying the entire uncommitted FR-34/35/36/37/38
working tree from the entry below (39 modified + 23 untracked paths, 8 client-unapplied migrations)
**Trigger:** Amir asked for a thorough codebase review first, then raised four changes: (1) a
duplicate employee code shows only a generic banner error and should name the field, (2) bulk upload
for official holidays with a template, (3) the real week is Friday off weekly **and Thursday off
every other week**, so weekend days need a frequency, (4) admin **and HR** should be able to add
approval steps — another role, or a specific person searchable by name / personnel number.

**Review findings worth carrying forward**

- Read order followed; gates re-run cold before touching anything: `tsc --noEmit` clean,
  `npm run lint` clean, `npm run test:unit` **344/344 across 43 files**. Local ARM64 stack up and
  healthy. A `next dev` from the previous session was already on :3000 (46 min old at the time).
- **Two stale statuses in `docs/REQUIREMENTS.md`** left by the previous session: FR-34 still ☐
  although batch 1 shipped it, and FR-35's parenthetical still said reports (FR-37) were pending
  while FR-37 was marked ☑. Both corrected. Per `docs/MEMORY.md`'s "stale docs actively mislead
  agents", flagged rather than silently patched.
- The `.claude/worktrees/peaceful-williams-9c1cf9` worktree (`claude/peaceful-williams-9c1cf9`
  @ `cce7b16`) still holds uncommitted `EmployeesTable` work from 2026-07-29, unrelated to anything
  current. Left alone.

**What changed — docs**

- `docs/specs/2026-08-18-holidays-weekends-approvers-design.md` — **new**, decisions D1–D31, with
  the four owner decisions marked **[owner]**: anchor-date strict alternation for the bi-weekly
  weekday (the "1st & 3rd Thursday" and "odd/even Jalali week" alternatives were put to him and
  rejected — the first drifts because a Jalali month can hold five Thursdays, the second resets at
  Farvardin 1); the alternating Thursday is a **full** day off; a holiday CSV row whose date already
  exists **overwrites**; and a named approver who is deactivated **blocks** the step rather than
  falling back to their role or vanishing from the chain.
- `docs/plans/2026-08-18-holidays-weekends-approvers.md` — **new**, four batches A–D, cheapest and
  safest first, each ending on the full gate.
- `docs/REQUIREMENTS.md` — FR-39 ☑, FR-40/41/42 ☐; FR-34 ☐ → ☑ plus its accepted `/fa` edge written
  in; FR-35 parenthetical corrected.
- `docs/CHANGELOG.md`, `docs/TASKS.md` — entries for batch A.

**What changed — batch A (FR-39), the only code this session**

- **The root cause was the error table, not the form.** `private.create_employee_impl` raises
  `personnel number already exists` with errcode `23505`, but `lib/errors/db-error.ts` had rules only
  for the *employee code* messages. So `localizeDbError` fell through every rule, logged
  `[db-error] unmapped:` and returned `dbErrors.unexpected` — which is exactly the banner in Amir's
  screenshot. Confirmed by reading the **live** function body out of `pg_proc`, not by grepping
  migrations: two versions of that function exist in history and only the later one runs
  (`docs/MEMORY.md`, "map SQL dependencies with the catalog").
- `lib/errors/db-error.ts` — three rules added: the raised message, the
  `profiles_company_personnel_no_key` unique-index violation, and `invalid personnel number`. The
  index rule is **not** redundant with the first: the in-function `exists` test is a pre-check, and
  two concurrent creates still race to the index, so the path that actually enforces uniqueness
  needed its own user-facing message. `Rule` gained an optional `field`; new `fieldForDbError()`
  returns the field of the **first matching rule** — not the first field-carrying one, or a message
  produced by rule 3 could be placed by rule 9's field. `dbErr` now returns `DbErrorResult`
  (`{ ok:false; error; field? }`), which is additive: every existing caller reads only `.error`.
- `lib/actions/employees.ts` — `createEmployee` returns `DbErrorResult` so the field survives to the
  client.
- `NewEmployeeForm.tsx` — `fieldError` state rendered under the personnel input with
  `aria-invalid` + `aria-describedby`, cleared on edit; the banner is suppressed when the error is
  field-scoped, so one failure is never reported twice; banner gained `data-testid="form-error"`.
- `messages/{fa,en}.json` — `dbErrors.duplicatePersonnelNo`, `dbErrors.invalidPersonnelNo`, inserted
  after `duplicateEmployeeCode`. **558 leaf keys each, identical order** (asserted, not assumed). The
  rewrite was checked not to have reformatted anything: the only removed lines in
  `git diff messages/` are the two that gained trailing commas.
- `tests/unit/db-error.test.ts` — **new**, 8 cases. `tests/e2e/duplicate-personnel.spec.ts` — **new**.

**Actions outside the repo**

- **Nothing against the client's server. No SSH, no VPN, no deploy.**
- Local only: read-only SQL against `bj-erp-db-1` (one `pg_proc` query for the live function body).
  No schema or data change. Reused the already-running `next dev`; did not restart the Docker stack.
- Playwright's `globalTeardown` deleted the throwaway `999#######` e2e users it created, on the
  **local** database.

**Verification** — all actually run:

- `tsc --noEmit` clean · `npm run lint` clean · **unit 352/352 across 44 files** (was 344/43).
- `tests/e2e/duplicate-personnel.spec.ts` passed against the running dev server in 4.5s.
- **Both new tests sabotage-checked.** With `re: /personnel number already exists/` broken to
  `/ZZZ_SABOTAGE_ZZZ/`: the unit test failed with `expected undefined to be 'personnel_no'` (2 of 8
  cases, including the statelessness case), and the e2e failed with `element(s) not found` waiting on
  `[data-testid="personnel-no-error"]`. Both green again after restoring, and the file confirmed
  restored by diff.
- **The fixed screen was rendered and looked at**, not merely asserted on: a temporary Playwright
  spec captured the field, showing "This personnel number is already in use by another employee."
  under the input. The temporary spec was deleted.
- `npm run build` **not** run this session, and the **full** e2e suite was not re-run — batch A
  touches `db-error.ts` (imported by every action) and `NewEmployeeForm`, so a full run against the
  container is worth doing before this is committed.

**State left behind**

- **Everything still uncommitted on `main`, not pushed.** Batch A adds to the pile: modified
  `lib/errors/db-error.ts`, `lib/actions/employees.ts`, `NewEmployeeForm.tsx`, `messages/{fa,en}.json`,
  four docs; new `tests/unit/db-error.test.ts`, `tests/e2e/duplicate-personnel.spec.ts`, and the
  spec + plan.
- **No new migration in batch A.** The eight undeployed migrations from the entry below are unchanged.
  Batches C and D will add four more, for twelve.
- Local stack untouched and still serving the previous session's build; the dev server was left
  running.

**For the next agent**

- **A Farsi rendering of the new message was NOT visually confirmed**, only its presence in the
  bundle with the key tree asserted identical. Reason worth knowing: the demo admin's stored
  `language_pref` is **English**, and under FR-34 that preference beats a typed `/fa/…` prefix
  (next-intl normalises `/fa/x` to `/x` before the app sees it), so `/fa/manage/employees/new`
  renders English for that account. To see Farsi, use an account whose preference is `fa` — do not
  read this as the redirect being broken.
- The e2e deliberately drives `/en/…`: an explicit prefix wins over the stored preference, so the
  asserted English text does not depend on whichever language the demo admin has saved.
- `EditEmployeeForm` was **not** given field-level errors. It does not edit `personnel_no`, so there
  is nothing for the new field to attach to. If personnel-number editing is ever added, wire it the
  same way — the mapping is already in place and needs no new rule.
- **Batch C is the risky one.** `compute_requested_minutes` repeats
  `extract(isodow from d)::int <> all (v_weekend)` in **four** places; the plan routes all four
  through one `private.is_company_weekend` helper precisely because a three-place port is how the
  `allocated_days` breakage in `docs/MEMORY.md` happened. The live body is the one in
  `20260806014310`; confirm that from the catalog and patch `pg_get_functiondef` output
  programmatically rather than retyping it.
- **Batch D swaps a unique constraint on `leave_request_approvals`**, which `20260818160002`
  backfilled with real client approval evidence — and that migration is itself still undeployed. The
  replacement index must stay valid for rows whose `step_id` is NULL.
- Amir chose **block-and-flag** for a deactivated named approver. No FK cascade is involved:
  profiles are never hard-deleted here and `private.is_active` already refuses a deactivated caller,
  so the block falls out of the existing rule rather than being new logic.


## 2026-08-18 — Dev repaired; FR-34 locale, FR-35 hr role, FR-38 print, FR-36 chain, FR-37 reports

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `c778c7b`, clean apart from the uncommitted evening-deploy entry
below (which had never been committed and is still uncommitted)
**Trigger:** Amir asked for a full codebase review, then for three things: fix `.env.local` so
`npm run dev` works, fix the language setting not sticking, and add an HR role (adds employees,
co-signs every request with the manager, gets a reports screen with an Excel download). He asked for
a plan and docs before any of the big work starts.

**What changed**

- `deploy/docker-compose.local-arm64.yml` — gateway now publishes `127.0.0.1:8080:8080`, exposing
  Caddy's existing plain-HTTP listener to the host. Loopback deliberately: that listener answers
  `Access-Control-Allow-Origin: *` to preflights and carries no TLS, so it must not reach the LAN;
  loopback also makes it immune to the Mac's DHCP lease moving, which has broken `.env.local` twice.
  Comment says explicitly never to add this to `docker-compose.yml` — the port staying unpublished is
  what keeps the listener inert on the client's server.
- `.env.local` (gitignored) — `NEXT_PUBLIC_SUPABASE_URL` → `http://127.0.0.1:8080`, and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` → the value from `deploy/.env`. **The key was the half of this bug
  nobody had noticed:** the old one is rejected by the local PostgREST with 401 (compared by SHA-256
  and then by live request — the local `ANON_KEY` returns 200, the old one 401), so fixing only the
  host would still have left dev broken. Backup of the original in `$TMPDIR/env.local.bak.87683`.
- `docs/specs/2026-08-18-hr-role-and-locale-persistence-design.md` — **new**, decisions D1–D6.
- `docs/plans/2026-08-18-hr-role-and-locale-persistence.md` — **new**, six batches, each ending green.
- `docs/REQUIREMENTS.md` — new FR-34 (language persistence), FR-35 (hr role), FR-36 (approval chain),
  FR-37 (HR reports); FR-14 annotated as amended by FR-36.
- `docs/TASKS.md` — batch tracker; batches 0 and 1 ☑, batches 2–5 ☐.
- `docs/CHANGELOG.md` — entries for the language fix and the dev-environment repair.

**Then Amir said "proceed with batch 1", so FR-34 was also built this session:**

- `lib/i18n/locale.ts` — **new**, pure, no next-intl import so the middleware can use it cheaply.
  `resolveEntryLocale` (cookie → `app_locale` claim → `fa`, ignoring junk in either),
  `localePrefixOf` (whole-segment match, so `/english` is not English), `withLocalePrefix` (leaves
  the default locale bare — returning `/fa/home` would add a pointless redirect for every Farsi
  user), `shouldRedirectToPreferredLocale`.
- `tests/unit/entry-locale.test.ts` — **new**, 18 cases, including three that assert the module's
  locale list and default cannot drift from `i18n/routing.ts`, since the duplication is deliberate.
- `proxy.ts:61-91` — captures the claims it was already fetching and, on a path with no locale
  prefix, redirects to the preferred locale. **Copies `response.cookies` onto the redirect**: step 3
  may have just rotated the session, and returning a bare `NextResponse.redirect` would drop those
  cookies and sign the user out at the exact moment they open the app.
- `lib/actions/profile.ts` — `updateMyPrefs` writes the `bj-locale` cookie in the same action as the
  database write.
- `lib/auth/usernameEmail.ts` — `signInWithCode` selects `language_pref` on its **existing**
  active-check query (no extra round-trip) and returns it.
- `app/[locale]/(auth)/login/page.tsx` — sets the cookie and pushes to the user's own locale rather
  than whichever locale the login URL happened to carry.
- `app/[locale]/page.tsx` — resolves from the profile (signed in) or the cookie (signed out). This is
  the PWA's landing route and was the single biggest source of the bug.
- `supabase/migrations/20260818120001_locale_claim.sql` — **new**. Adds `app_locale` beside
  `app_roles` in `custom_access_token_hook`. The hook runs as `supabase_auth_admin`, which no
  existing policy covers, so it needs its own read path on `profiles` — done as a **column-level**
  grant on `(id, language_pref)` plus a policy scoped to that role, deliberately narrower than the
  whole-table grant that `20260702150001` gave it on `user_roles`.
- `tests/e2e/settings.spec.ts` — extended with the actual reported bug: choose English, then enter at
  the bare `/` and at an unprefixed deep link, and assert English; then switch back and assert the
  user is not stranded on `/en`.

**Then "proceed with batch 2", so FR-35 part 1 (the `hr` role) was built as well:**

- `supabase/migrations/20260818130001_hr_role_enum.sql` — **new**, one statement, and its header says
  in capitals not to add a second one. See the enum trap above.
- `supabase/migrations/20260818130002_hr_role_access.sql` — **new**. `private.can_read_all` gains
  `has_role(uid,'hr')`, and that one helper is the entire grant: `profiles`, `user_roles`,
  `leave_ledger`, `leave_allocations`, `employee_leave_policies` and `team_leave_calendar` all already
  route through it, so no policy was created or edited. The file ends with a `do $$` block that
  **raises** if `private.has_role` ever stops requiring `is_active` — the whole role's revocability
  rests on that, so it is asserted rather than assumed. `leave_requests`' own base-row SELECT was
  deliberately **not** widened; HR joins it in the FR-36 batch, so FR-25 reason privacy is not opened
  up ahead of the feature that needs it.
- `lib/nav/tabs.ts`, `app/[locale]/(app)/manage/layout.tsx` — `hr` joins admin/manager.
- `NewEmployeeForm.tsx`, `EditEmployeeForm.tsx` — `'hr'` appended to the role lists.
- `lib/supabase/types.ts` — `app_role` union and the runtime `Constants` array, both hand-edited.
- `tests/unit/nav_tabs.test.ts` — +3 cases, including that `'hrx'` and `'HR'` grant nothing.
- `tests/e2e/hr-role.spec.ts` — **new**, 2 tests, weighted toward what HR must *not* reach.
- `tests/e2e/_helpers.ts` — `createEmployee` gains an optional `departmentIndex`. Additive; the
  default reproduces the old behaviour exactly.

**Then Amir added a requirement mid-batch — HR must see every request WITH its signatures and print
it like the paper forms — and said to proceed to batch 3. Both were built (FR-38 + FR-35 part 2):**

*Reading the client's actual forms was the highest-value thing in this session.* `docs/forms/` holds
three photographs nobody had transcribed into the docs:

- The **daily leave form is BJ-F 50210(R0)** — a code that appears nowhere in this repo's docs. FR-26
  records 50208 for hourly leave and FR-30 records 50207 for the errand; the daily form had only ever
  been named, never coded.
- **Every form carries FOUR signature boxes, and the last is always HR's**
  (امور اداری و منابع انسانی). That is direct confirmation that FR-36's "hr step" is not an
  invention — it is a box that already exists on paper and is signed today.
- **The box sets differ per form.** 50210: درخواست کننده · جانشین · تصویب کننده · مدیر اداری و منابع
  انسانی. The two hourly forms swap جانشین for حراست. Modelled per form rather than assumed uniform.
- There is **no photograph of a daily work errand form.** That request type was added at the client's
  request on 2026-08-05. It currently reuses 50207's code and boxes, on the reasoning that the
  database already numbers daily and hourly errands from one sequence (one book), and the sheet says
  so in a footnote. **Open question for the client.**

- `supabase/migrations/20260818140001_hr_reads_requests.sql` — **new**. `hr` joins
  `leave_requests_select`. This is a real **FR-25 widening**: HR now reads the private `reason`, the
  errand location, the decision note and both signature images. Justified in the migration header by
  the paper process rather than waved through. `team_leave_calendar` deliberately untouched.
- `supabase/migrations/20260818150001_hr_creates_employees.sql` — **new**. Third auth path in
  `app_create_employee`, second in `app_bulk_create_employees`. Both bodies were produced by
  **patching `pg_get_functiondef` output with a script whose every anchor had to match exactly once**,
  per `docs/MEMORY.md` — these are security-critical and a transcription slip in an untouched branch
  would be invisible in review.
- `lib/leave/paperForm.ts` + `tests/unit/paper-form.test.ts` — **new**, 13 cases. Maps a stored
  request to its form, code and box set; `leaveTypeCheckbox` ticks nothing for an unrecognised leave
  type rather than guessing, because a wrong tick on a signed document is worse than a blank one.
- `app/[locale]/(print)/` — **new route group** with its own auth guard, holding
  `print/request/[id]/page.tsx` + `PrintToolbar.tsx`. Outside `(app)` so the printed sheet carries no
  header or tab bar. Path is `/print/...`, not `/request/...`: route groups add no segment, so
  `(print)/request/[id]` would have collided with the real `/request/hourly` screens.
- `app/[locale]/(app)/manage/requests/` — **new**, `page.tsx` + `RequestsReview.tsx`. hr+admin only:
  the `/manage` layout admits managers too, and a manager has no business browsing every colleague's
  private reason.
- `lib/actions/leave.ts` — `getReviewRequests` (list, timestamps only) and `getRequestForPrint` (one
  row, both PNGs eagerly, since a printed page cannot lazy-load).
- `lib/i18n/format.ts` — `formatPersianConsentTimestamp` **moved here** from `RequestSignature.tsx`
  so a Server Component can use it without importing a `'use client'` module; re-exported from its
  old home so callers and its unit test are unaffected.
- `NewEmployeeForm` + its page — new `canChooseScope` prop (admin || hr) split out from `isAdmin`.
  HR gets the department and manager pickers but **not** role checkboxes, opening allocation, or
  accrual policy: `allocate_leave` and `set_employee_leave_policy` are admin-only in the database, so
  showing HR those fields would have built a form that fails on submit.
- `lib/actions/employees.ts`, `manage/employees/page.tsx`, `manage/employees/import/page.tsx` — admit
  `hr`; new `nav-requests` and `add-employee-link` testids.
- `messages/{fa,en}.json` — `review.*`, `print.*`, `manage.requestsLink`. 487 keys each, identical
  order.
- `docs/` — spec gains Part 3b + decisions D7–D10; REQUIREMENTS gains FR-38 and amends FR-25;
  PERMISSIONS records both the request-read widening and the HR creation paths; TASKS and CHANGELOG
  updated.

**Then "proceed with batch 4" — the configurable approval chain (FR-36), the largest single change
in this session:**

- `20260818160001_approval_chain_schema.sql` — `approval_steps` (company config: who signs, in what
  order, for which kinds) and `leave_request_approvals` (one signed decision per step, unique on
  `(request_id, step_role)`), plus `work_settings.approval_order_enforced` defaulting **false**.
  Seeds manager(1) + hr(2). `leave_request_approvals` has **no client write policy** — same posture
  as `leave_ledger`, because a client that could insert there could forge an approval.
- `20260818160002_..._backfill.sql` — one `manager` approval row per already-decided request, so
  history prints with its تصویب کننده box filled instead of looking unsigned. Idempotent; asserts it
  never produced a signed rejection.
- `20260818160003_..._engine.sql` — `approve_leave_request` fills ONE step and finalises only when
  none remain; `reject_leave_request` records a step and rejects immediately.
- `lib/leave/approvals.ts` — rewritten as the pure mirror of the SQL's step selection (31 tests).
- `lib/leave/paperForm.ts` — `signatureSourceFor` now returns a step role, so the printed form fills
  تصویب کننده from the manager step and the HR box from the hr step.
- `lib/actions/leave.ts` — `getApprovalConfig`; `getPendingApprovals` carries `signed`/`outstanding`;
  `getRequestForPrint` returns per-step approvals.
- `lib/actions/settings.ts` — `getApprovalSteps`, `updateApprovalStep`, `setApprovalOrderEnforced`.
- UI — `ApprovalStepsCard` (Manage → Settings), chain progress in `ApprovalQueue`, new dbError
  strings, `messages/{fa,en}.json` at **508 keys each, identical order**.
- `lib/supabase/types.ts` — both tables and the new column hand-added.

**Three design points worth keeping:**

1. **`leave_status` was NOT changed.** A request stays `pending` until the chain completes. That one
   decision is why every existing query, view, index, RLS policy, home card, calendar read and e2e
   assertion kept working. An intermediate status would have rippled through all of them.
2. **The advisory lock moved earlier** — before the step is chosen, not just before the ledger write.
   Two approvers signing *different* steps at the same instant would otherwise both count zero
   outstanding steps and both finalise, debiting the ledger twice.
3. **Two deliberate escape hatches:** a non-admin can never sign their own request (so the first HR
   officer to book leave cannot self-approve), but an admin can — otherwise a company whose admin has
   no manager above them could never take leave. And if an admin deactivates every step, approval
   degrades to the pre-chain single manager/admin decision instead of becoming impossible.

**Then "proceed with batch 5" — HR reports (FR-37), the last planned batch:**

- `lib/reports/reports.ts` — **new**, pure, 23 unit tests. Five builders, all returning the same
  `ReportTable`, so the screen has ONE table renderer and ONE download button instead of five of
  each. A sixth report is a builder plus a label block.
- `lib/actions/reports.ts` — **new**. `getReportData` (plain SELECTs, no new policy and no new
  SECURITY DEFINER surface) and `getReportMonths`, which reads the period options from the
  `jalali_months` table so the report's idea of a Jalali month cannot drift from the ledger's.
- `app/[locale]/(app)/manage/reports/` — **new** page + `ReportsDashboard`. hr + admin; a manager is
  redirected, since this is company-wide and their remit is their own team.
- Export reuses `buildCsv` (UTF-8 BOM) — **no new dependency**, per the owner's choice. Durations are
  **decimal days**, not "۹ روز و ۴ ساعت": these land in a spreadsheet where HR sums and sorts them,
  and a formatted string cannot be summed.
- The period is a URL parameter, so a report is linkable and reloadable and changing it re-queries
  the server rather than filtering a snapshot in the browser.
- Absence-by-department counts **approved leave only** — an errand is work, and counting it would
  overstate the time a department lost.
- `messages/{fa,en}.json` now at **556 keys each, identical order**; `manage.reportsLink` added.

**Root cause of the language bug (confirmed, not guessed)**

`profiles.language_pref` is written by Settings and read by **nothing that decides the locale** —
grep shows its only reads are the Settings dropdown's own initial value (`profile/page.tsx:85`) and
the admin employee forms. Locale comes solely from the URL. `i18n/routing.ts` sets
`localeDetection: false`, and next-intl's `resolveLocaleFromPrefix` (read via Context7, not from
memory) gates **both** the `NEXT_LOCALE` cookie and `accept-language` behind that one flag — leaving
"path prefix, else defaultLocale". With `localePrefix: 'as-needed'` Farsi has no prefix, so every
prefix-less URL is Farsi unconditionally. The dominant trigger is `manifest.ts`'s `start_url: '/'`:
the installed PWA returns an English user to Farsi on **every launch**. Verified live —
`curl localhost:3000/` → `307 → /fa/login`. That is exactly why Settings can read English (database)
while the page renders Farsi (URL); nothing ever reconciles them.

**Verified constraint that shapes the HR migrations**

Ran on the live local database inside a rolled-back transaction:
`alter type public.app_role add value if not exists 'hr'` succeeds, then referencing `'hr'` in the
same transaction fails with `unsafe use of new value "hr" of enum type app_role`. Since
`bj_apply_migrations` runs each file in one `--single-transaction`, **the enum addition must be a
migration file containing nothing else.** This would have failed on the client's server rather than
here, because the ledger skips files already applied locally.

**Actions outside the repo**

- **Nothing against the client's server. No SSH, no VPN, no deploy.**
- **Rebuilt the local ARM64 app image and redeployed the local container** at the end, so the stack
  serves all of batches 1–5 for on-device testing. Tagged `bj-erp-app:local-arm64-rollback-20260818`
  first, then `./deploy/bj-deploy update local` (backs up the DB, applies pending migrations — all
  eight already applied, so the ledger skipped them — re-runs the idempotent `seed.sql`, builds
  ARM64, recreates only the app container), and later `./deploy/bj-deploy app local` for the
  default-period fix. Row data untouched; named volumes never recreated. Then re-ran the HR spec
  against the built image with `E2E_BASE_URL=https://192.168.2.70:3500` — **8/8 passed against the
  container**, not merely against `next dev`.
- Local only: recreated `bj-erp-gateway-1` (`up -d --no-deps --pull never gateway`, project `bj-erp`,
  base + arm64 overlay). Checked first that the Caddy CA lives in the named volume `bj-erp_caddy-data`
  so the recreate could not regenerate it — confirmed afterwards, issuer still
  `Caddy Local Authority - ECC Intermediate`, so trusted phones are unaffected. DB, app, auth, rest
  containers and all named volumes untouched.
- Started `npm run dev`, verified, stopped it. Read-only SQL against the local DB throughout
  (catalog queries, one rolled-back enum test). No schema or data changed anywhere.

**Verification** — all actually run:

- Baseline before touching anything: `npx tsc --noEmit` clean · `npm run lint` clean ·
  `npm run test:unit` **254 passed / 40 files** · `npm run build` clean, 21 routes.
- Dev path proven end to end, not assumed: `OPTIONS /auth/v1/token` → **204** (Caddy's CORS block),
  `POST /auth/v1/token` with the real demo admin credential → **200** with an `app_roles: ['admin']`
  claim, and the same POST driven from the browser at `localhost:3000` with a deliberately wrong
  password → **400** — an auth rejection, not a CORS or network failure. Console showed only that 400;
  no CSP violations.
- `https://192.168.2.70:3500/fa/login` still 307, so publishing 8080 did not disturb the HTTPS site.

Batch 1:

- tsc clean · lint clean · **unit 272/272 across 41 files** (was 254/40) · build clean, 21 routes.
- **Full e2e serial: 33 passed, 1 skipped.** The skip is the pre-existing, documented
  `department.spec.ts:25` (`test.skip`, department-code editing deactivated at the client's request)
  — not caused by this work. The middleware is on every request, so the whole suite was run, not just
  the touched spec.
- **The new e2e assertions were proven to be real:** with only the `shouldRedirectToPreferredLocale`
  branch commented out of `proxy.ts`, the spec fails at
  `expect(page).toHaveURL(/\/en\/request$/) — Received "http://localhost:3000/request"`. Restored and
  re-run green. A test that passes either way would have been worthless here.
- Migration applied to the local database as `supabase_admin` and then **applied a second time** to
  prove idempotency. Claim verified live: a freshly issued token carries
  `app_roles ["admin"] / app_locale "fa"`, and inside a **rolled-back** transaction that flipped the
  stored preference, the hook returned `stored=en claim=en`. Nothing was left changed.
- Worth recording: a first attempt to flip `language_pref` with a plain `UPDATE` as `supabase_admin`
  was **refused** by `private.enforce_profile_update_scope` ("not permitted to update this profile"),
  because `auth.uid()` is NULL in a raw psql session. The trigger did its job; no data changed. Use
  `set_config('request.jwt.claims', …)` inside a transaction if you need to exercise that path.

Batch 2:

- tsc clean · lint clean · **unit 275/275 across 41 files** · build clean · **full e2e serial: 35
  passed, 1 pre-existing skip.**
- Both migrations applied to the local database and then **applied again** to prove idempotency
  (`ALTER TYPE` emits `NOTICE: enum label "hr" already exists, skipping`). Enum is now
  `admin|manager|employee|security|hr`.
- **The first version of `hr-role.spec.ts` was a false pass, and this is the useful part of this
  batch.** Sabotage-checking it — removing `'hr'` from `can_read_all` in the live database — the spec
  still went green. Cause: `createEmployee` always picks the *first* department, so the HR user and
  the subject were teammates and `profiles_select`'s `same_team` branch granted the read. The test was
  asserting `same_team`, not the new grant. Fixed by giving the helper an optional `departmentIndex`
  and putting the two users in different departments; re-sabotaged, and it now fails with
  `getByText('HR Subject').first()` not visible, then passes again once restored.
  **Generalisable: any test about company-wide visibility in this codebase must cross a department
  boundary, or `same_team` will quietly answer for it.**
- One real assertion bug found on the way: `getByText('HR Subject')` hit a strict-mode violation
  because the employees page renders every row twice (desktop table + mobile card). `.first()`, as
  `seed-roles.spec` already does.

FR-38 + batch 3:

- tsc clean · lint clean · **unit 288/288 across 42 files** · build clean · **full e2e serial: 38
  passed, 1 pre-existing skip**, then a targeted re-run of the four employee-creation specs
  (`hr-role`, `manage`, `manager-create-employee`, `bulk-import`) after the `NewEmployeeForm`
  refactor, all green.
- All four new migrations applied to the local database and **applied a second time** to prove
  idempotency.
- **The HR role clamp was verified directly in SQL, because the e2e cannot prove it.** HR's form has
  no role checkboxes, so it never sends `p_roles` and the `{employee}` default would be used even if
  the clamp were deleted. Inside a rolled-back transaction, granting `hr` to a test profile and
  calling `app_create_employee(..., p_roles => array['admin','manager'])` returned exactly
  `employee`, with the audit row recording `path = hr`. The e2e's docstring now says explicitly what
  it does and does not cover. **Re-run that SQL check if you touch the branch.**
- **A second vacuous assertion caught and fixed.** The batch-2 spec asserted
  `dept-add-employee` had count 0 on `/manage/employees` — that testid does not exist on that page at
  all, so it passed regardless. Replacing it with the real control revealed that **Add Employee was
  never admin-gated**, so batch 2 had in fact been showing HR a button that would error. Batch 3 made
  it work, which is the right resolution, but the sloppy assertion is what surfaced it.
Batch 4:

- tsc · lint · **unit 321/321 (42 files)** · build · **full e2e 39 passed / 1 pre-existing skip**.
- **The engine was proven in SQL before a line of UI was written**, in rolled-back transactions:
  manager signs → status still `pending`, zero ledger rows; HR signs → `approved` with exactly **one**
  consumption row (balance 4800 → 3840 min); a second signature from the same person → *"you have
  already signed this request"*; with order enforcement on, HR-first → *"an earlier approval is still
  required"*, then manager→HR completes. Re-run that script if you touch the engine.
- All three migrations applied twice to prove idempotency.
- **Three existing specs asserted the old one-signature contract and now fail correctly.** Updated,
  not deleted: `approval`, `hourly`, `leave`. New `approveThroughChain` helper.
- **The helper's first version silently did nothing.** It called `waitForLoadState('networkidle')`
  then counted approve buttons — but the queue streams inside a Suspense boundary, so networkidle
  resolves before the rows exist, the count came back 0, and the helper returned "complete" having
  signed one step. Two specs failed with an untouched balance. It now waits for either a row or the
  empty state before counting; the comment says not to reintroduce networkidle.
- **A second interference bug, caught only by the full suite:** `hourly.spec` grabbed
  `approve-btn-*.first()` from the admin's *company-wide* queue, so in a full run it could approve
  another spec's request. Passed alone, failed in the suite, twice. Now scoped by employee name.
  Worth checking any other `.first()` on that queue.
- `tests/unit/approvals.test.ts` was **superseded** by `approval-chain.test.ts`; its two unique edge
  cases (a manager with no reports, a null `manager_id` not matching a real id) were ported before it
  was deleted.
- `leave.spec` had no explicit `test.setTimeout` and ran on Playwright's 30s default; the second
  approval step pushed it over. Budget now stated, matching the other multi-role specs.
- The printed form was **rendered and looked at**, not just asserted on. A temporary Playwright spec
  captured `/print/request/[id]` in fa and en plus the review list; comparing against
  `docs/forms/daily_pto_form.jpeg` showed the header columns were **mirrored** — کد فرم was on the
  right where the paper has it on the left. Fixed by writing the three header cells in the paper's own
  right-to-left order, and re-captured to confirm. The temporary spec was deleted.

**State left behind**

- **Everything uncommitted**, on `main`, not pushed. Batch 5 added no migration, so **eight
  migrations** exist locally that the client does not have: `20260818120001` (locale claim), `130001` (hr enum), `130002` (hr read),
  `140001` (hr reads requests), `150001` (hr creates employees), `160001` (chain schema),
  `160002` (chain backfill), `160003` (chain engine). Changed: `proxy.ts`,
  `app/[locale]/page.tsx`, `app/[locale]/(auth)/login/page.tsx`, `lib/actions/profile.ts`,
  `lib/auth/usernameEmail.ts`, `deploy/docker-compose.local-arm64.yml`, `tests/e2e/settings.spec.ts`,
  four docs; new: `lib/i18n/locale.ts`, `tests/unit/entry-locale.test.ts`,
  `supabase/migrations/20260818120001_locale_claim.sql`, and the spec + plan. `.env.local` is
  gitignored. The evening-deploy entry below this one is still uncommitted too.
- Local stack healthy and **running today's build**: HTTPS on `https://192.168.2.70:3500` (the
  LAN/iPhone path), dev API on `http://127.0.0.1:8080`, `npm run dev` on `http://localhost:3000`
  (the Mac path). Rollback image `bj-erp-app:local-arm64-rollback-20260818` retained.
  The local database **has all three new migrations**; the client's server has none of them.
- Batches 3–5 (HR-creates-employees, approval chain, reports) are planned only.
- Batch 2 also touched `docs/PERMISSIONS.md`, `docs/DATA_MODEL.md`, `docs/REQUIREMENTS.md` (FR-3,
  FR-35 → ◐), `docs/TASKS.md`, `docs/CHANGELOG.md`.

**For the next agent**

- `npm run dev` now works, but **only from this Mac's browser** — the gateway's 8080 is bound to
  loopback. A phone on the LAN cannot reach the dev server's API; test the phone against the built
  container on `APP_ORIGIN` instead.
- `next.config.ts:allowedDevOrigins` still lists the stale `192.168.2.48`. Harmless while dev runs on
  loopback; it would need the current IP if anyone re-exposes 8080 to the LAN.
- `deploy/migrations/` is a **stale 38-file copy** last touched 2026-08-04 and missing the three
  August migrations. Nothing reads it — `bj-deploy` uses `supabase/migrations/` at all nine call sites
  and `package.sh:78` copies from there. Do not edit it, and do not "sync" it without deciding whether
  it should exist at all.
- Batch 4's backfill touches real client approval evidence. Amir has since said the client database
  holds **test data only but must be treated as production** — no wipes unless he asks for that
  specific run. He did grant one concession up front: it is fine for a schema change to **reset
  signatures on, or delete, requests that are still pending**.
- **FR-34 has an accepted edge:** under `localePrefix: 'as-needed'`, "explicitly Farsi" and
  "unspecified" are the same URL, because next-intl normalises `/fa/x` to `/x` before we ever see it.
  So a user whose preference is English cannot reach the Farsi UI by typing `/fa/...` — they land
  back on `/en/...` after two redirects. That is the preference winning, which is the point of the
  fix, but it does mean the URL is not an escape hatch for that one direction. Switching to
  `localePrefix: 'always'` would remove the ambiguity at the cost of changing every URL; only four
  e2e specs reference locale-prefixed paths, so it is cheaper than it looks if it is ever wanted.
- `(app)/layout.tsx` and `manage/layout.tsx` still redirect to `` `/${locale}/login` ``, which for
  Farsi emits `/fa/login` and then takes a second hop to `/login`. Pre-existing and harmless;
  `withLocalePrefix` from `lib/i18n/locale.ts` would remove the extra hop. Left alone deliberately —
  it was outside the batch.
- The `bj-locale` cookie is **not** cleared on logout, on purpose: a returning worker should meet the
  login page in their own language. It is overwritten at the next successful sign-in.
- **Role checkbox labels are raw English slugs** — `admin`, `manager`, `employee`, `security`, and now
  `hr` — even in the Farsi UI. Pre-existing; `hr` was added in the same style rather than translated
  alone, which would have been incoherent. Fixing it properly is blocked on `createEmployee` in
  `tests/e2e/_helpers.ts`, which finds those checkboxes **by exact label text**. Give each checkbox a
  `data-testid`, switch the helper to it, then translate — the repo already learned this lesson once
  with `.font-mono` (see `docs/MEMORY.md`).
- `manage/employees/[id]` has no explicit role guard of its own beyond the `/manage` layout, so `hr`
  can open an employee's edit page. Every write from there is refused (the actions require
  admin/manager, and `profiles_update` RLS agrees), so this is a cosmetic gap, not a hole. Worth
  tidying when batch 3 touches that screen.
- **`setManager` now exists in THREE specs** (`approval`, `errand`, `hr-role`) with differing
  timeouts. Promoting one to `_helpers.ts` would silently change another spec's behaviour, so the
  third copy was deliberate. Consolidate as its own change, with a full run.
- **The chain's SQL and `lib/leave/approvals.ts` must stay in lockstep** — same contract as
  `workingDays`/`compute_requested_minutes`. The TS version only shapes the queue UI; the SQL is
  authoritative and re-checks everything.
Batch 5:

- tsc · lint · **unit 344/344 (43 files)** · build · **full e2e 41 passed / 1 pre-existing skip**.
- **A real bug, found by the e2e rather than by reading:** PostgREST refused the self-referential
  `manager:profiles!profiles_manager_id_fkey(full_name)` embed — *"Could not find a relationship
  between 'profiles' and 'profiles' in the schema cache"* — even though that constraint name is
  correct. The screen rendered its error state instead of the dashboard. Fixed by dropping the join:
  every profile is already in the result set, so manager names are resolved in memory. One fewer
  join and one fewer failure mode. **Do not reintroduce that embed.**
- **A second bug caught by looking at the rendered page, not by a test:** the default period came out
  as Farvardin **1404** — the *previous* Jalali year. The lookup searched for "month 1 whose end is on
  or after today", which never matches mid-year, so it silently fell through to the first month on
  offer. Now anchored on the month containing today and its year: Farvardin 1405 → Mordad 1405. No
  test asserted the default, which is why only rendering it caught this.
- The CSV export test asserts the downloaded file's **header row matches the columns on screen**, and
  that the file starts with a UTF-8 BOM. A CSV whose header has drifted from the table is worse than
  no export, because nobody checks it before mailing it on.
- **The "createEmployee flake" was chased down and is NOT a code bug — it is the dev server.**
  Making the helper report its cause showed the form producing *neither* the success screen *nor* an
  error: the submit was simply going nowhere. `createEmployee` also lacked the retry that `login`
  already has for the documented cold-dev hydration race, so that was added (guarded so it cannot
  double-create: each attempt returns early if the success screen is up, and the personnel number is
  fixed outside the loop).
  That was not the whole story. The suite kept degrading run over run — 7.3m → 9.2m → 10.0m, with 1
  then 3 failures — and one of the failures was in `team.spec`'s **own private copy** of the helper,
  which my change never touched. The discriminator: the same specs run against the **built container**
  (`E2E_BASE_URL=https://192.168.2.70:3500`) passed in 24 seconds. The `next dev` process had been up
  **11 hours**.
  **Full suite against the container: 41 passed, 1 pre-existing skip, 2.6 minutes** — versus 10
  minutes and 3 failures against the stale dev server, same commit.
  **Lesson for the next agent: a long-lived `next dev` produces phantom e2e failures that look like
  application bugs. Restart it, or better, run the suite against the container with `E2E_BASE_URL` —
  it is ~4x faster and exercises the production-shaped build.**

- **The sabotage check has now caught a worthless test twice, plus a third vacuous assertion.** Do not
  skip it: break the thing on purpose, watch the test fail, put it back. Two specific traps in this
  codebase: (1) `profiles_select` grants via `same_team` OR `can_read_all`, so any company-wide
  visibility test must cross a department boundary — use `createEmployee`'s `departmentIndex`;
  (2) asserting `toHaveCount(0)` on a testid that does not exist on the page passes forever. Check the
  selector matches something in the positive case first.
- **FR-25 has been widened for the first time.** `hr` reads the private `reason`. If you are asked to
  widen it again, the bar used here was: the client's own paper form already puts that role's
  signature on the sheet. `team_leave_calendar` remains the protection for everyone else and must not
  gain reason, location, or signature columns.
- **Open question for the client, worth asking before FR-36:** is there a paper form for the *daily*
  work errand? We have photographs of BJ-F 50210 / 50208 / 50207 but nothing for that type, so it
  currently prints on the 50207 layout and the sheet admits it.
- `app_create_employee`'s branch ORDER matters: `hr` is checked before `manager`, so a user holding
  both gets the wider "any department" scope. Reversing them would silently pin HR to their own team.
- The printed sheet's `@media print` behaviour was **not** verified against a real printer or a PDF
  export — only in the browser. `print:hidden` on the toolbar and the bare `(print)` layout are the
  mechanisms; worth one manual Cmd-P before the client relies on it.

## 2026-08-17 (evening) — Third client deploy: `20260817-185601-c778c7b`, after a dropped upload

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `c778c7b`, clean tree, in sync with `origin/main`
**Trigger:** Amir's client deploy died mid-upload with `rsync(48795): error: unexpected end of file`
and he asked how to continue.

**What changed**
- No repository changes this session. Deploy operation only.

**Actions outside the repo**
- Diagnosed the failed upload without restarting it. Run `20260817T185601Z-df406f`
  (`VERSION=20260817-185601-c778c7b`) was already staged: migrations, `seed.sql`, `manifest.env`
  and `source-migrations.sha256` had all landed via `stage_remote_runtime`; only the image tarball
  was partial. `ssh bj "ls -l bj-erp-installer/"` showed **16,613,376 of ~107 MB** kept under the
  final name by rsync `--partial` (mtime shows as Jan 1 1970 while a transfer is in flight — that
  is normal, not corruption).
- Amir completed it with the same rsync bj-deploy uses, plus keepalives and a retry loop:
  `until rsync -aP --partial -e "ssh -p 2222 -o ServerAliveInterval=20 -o ServerAliveCountMax=6"
  dist/bj-erp-app-20260817-185601-c778c7b.tar.gz{,.sha256} bj:/home/behsazan/bj-erp-installer/; do
  sleep 15; done`. The remaining ~90 MB moved at **1.32 MB/s in 77 seconds** — the same link that
  had managed 14 KB/s earlier that day, so the first two-hour crawl was transient congestion, not
  the ceiling.
- Verified the transfer by hand before resuming: server `sha256sum` matched the local `.sha256`
  (`08bb028b0b21…`). This matters because the server job runs `gunzip -c "$IMAGE_TGZ" | docker load`
  (`deploy/update.sh:149`) with no checksum of its own, and only *after* it has taken a database
  backup — a truncated archive would burn that whole cycle before failing.
- `caffeinate -i ./deploy/bj-deploy resume 20260817T185601Z-df406f` then completed the deploy in
  ~63 seconds: `20260817-042022-faf3305` → `20260817-185601-c778c7b`, all 41 migrations skipped
  (none pending), health checks passed, backup
  `pre-20260817-185601-c778c7b-2026-08-18-044221.dump` (348K) verified and pulled to
  `backups/deploy-assistant/client/20260817T185601Z-df406f/`. Server auto-removed the older image
  `bj-erp-app:20260812-155950-e73ef4b`.
- **The client is using the app for real now.** Row counts moved since the morning deploy:
  profiles 3 → 4, user_roles 6 → 7, leave_ledger 7 → 12. Counts were identical before and after
  this cutover.

**Verification**
- Deploy run reported `RESULT=SUCCEEDED` with per-table integrity checks all `ok`.
- Local `git status` clean, `origin/main..main` empty — `c778c7b` is pushed and is what shipped.
- **No logged-in browser check of the deployed app was done from here**, and no e2e run against
  the client server.

**State left behind**
- Client server on `10.10.10.50:3500` runs `20260817-185601-c778c7b`. Rollback to
  `20260817-042022-faf3305` is still available; its image and the printed rollback command remain
  on the server.
- Client disk was 5.8 GiB free before this run; the assistant prunes one old image per deploy, so
  it is holding steady rather than shrinking.

**For the next agent**
- **Never answer a broken client upload by re-running `release.sh` or `bj-deploy update client`.**
  The version is `$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)`
  (`deploy/bj-deploy:134`), so a fresh invocation mints a new tarball name, throws away the partial
  transfer, rebuilds the image, and strands the prepared run. Re-run the *same* rsync, then
  `resume RUN_ID`.
- `resume` on a `PREPARED` run does not re-upload and does not re-verify the archive checksum on
  the Mac side. Verify the checksum yourself between finishing an interrupted upload and resuming.
- Two deploys in a row have now been saved by `--partial` plus `resume`. Keepalive flags
  (`ServerAliveInterval=20 ServerAliveCountMax=6`) are worth making the default in `remote_rsync`
  if this link keeps dropping — not done, deliberately, since nobody has asked for a deploy-script
  change.

## 2026-08-17 (later) — Request tabs become a dropdown on phones; everything committed and pushed

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `faf3305`, carrying the uncommitted Add/Edit Employee wording
work from the entry below plus pre-existing staged doc updates for the daily-errand home shortcut
**Trigger:** The four request tabs are cut off on a phone and need horizontal scrolling. Amir asked
what to do; I proposed a 2×2 grid, a segmented block, and shortened labels, and mocked all three at
375px. He rejected all three as "clunky and unpolished" and specified a dropdown for mobile only,
plus the chosen form's name at the top of the form. Then: commit and push to `main`.

**What changed**
- `app/[locale]/(app)/request/_components/RequestTypeSelect.tsx` — **new** client component. A
  native `<select>` whose options are keyed by route; `onChange` pushes through next-intl's
  `useRouter` inside a transition, and the select is disabled while that transition is pending so a
  second choice cannot race the first. Native on purpose: it opens the OS picker, and Playwright's
  `selectOption` needs a real `<select>` (`lib/native-select.ts` says the same).
- `app/[locale]/(app)/request/_components/RequestTypeTabs.tsx` — now renders both presentations and
  swaps them at one breakpoint. `< sm`: the dropdown, then an `h2` naming the active form in a
  `bg-card` block that supplies the card's top corners and merges into it with the same
  `-mb-px` + `z-10` trick the tabs use. `≥ sm`: the tab strip, `hidden sm:flex`.
- Per-tab classes went from `min-w-36 flex-none … sm:min-w-0 sm:flex-1` to plain
  `min-w-0 flex-1`, and `overflow-x-auto` is gone. **This is not a desktop change** — at `≥ sm` the
  `sm:` variants already won, so the computed result is identical; the mobile-only halves are now
  dead because the nav itself is hidden there.
- `docs/CHANGELOG.md` — entries for this and for the Add/Edit Employee wording pass.

**Not changed:** no message keys (`request.tabs.*` already had every label, including `label`
reused as both the select's visible label and the nav's `aria-label`), no form components, no
page files, no logic, no migration.

**Actions outside the repo**
- Pushed `main` to `origin` (github.com/AmirNcode/bj-erp). Nothing run against the client's server;
  the client is still on `20260817-042022-faf3305` and does not have any of this.

**Verification**
- `npx tsc --noEmit` clean · `npm run lint` clean · `npm run test:unit` 40 files, 254 tests passed
  · `npm run build` succeeded, all four request routes compiled.
- Confirmed the utilities the layout depends on are really emitted in
  `.next/static/chunks/038r16mwki-km.css`: `sm:hidden`, `sm:flex`, `rounded-t-xl`, `border-b-card`,
  `rounded-t-none`, `min-w-0`.
- Visual check on a **static replica** again — I cannot log in as admin, so I generated the exact
  class strings and the real `fa.json`/`en.json` labels into a page linked against the built CSS.
  At 375px, fa and en: no horizontal scroll, dropdown + form-name heading, heading merges into the
  card with no seam. At 1100px: the tab strip, unchanged. At exactly 640px the two errand labels
  wrap to two lines inside their tabs — that was already true before this change, and tabs are
  `items-stretch` so they stay equal height. **Not seen inside the authenticated app.**
- `tests/e2e/errand.spec.ts:164-170` asserts on and clicks `request-tab-dailyErrand` /
  `request-tab-errand`. Playwright runs `devices['Desktop Chrome']` (1280×720), so the strip is
  visible and those tests should be unaffected — but that is reasoning from the config, **not a
  run**; e2e was not executed this session.

**State left behind**
- Committed and pushed to `main`. Working tree clean.

**For the next agent**
- Two testids exist for the mobile path if e2e ever covers it: `request-type-select` and
  `request-type-heading`. Any mobile-viewport e2e must use those, not `request-tab-*`.
- Known cosmetic edge case, deliberately left: on `/request/hourly` when no leave type has
  `allow_hourly`, the page renders the `hourly-unavailable` paragraph (`bg-secondary/40`) instead of
  a card. On mobile the new white `bg-card` heading sits directly on top of it, so the two surfaces
  do not match. Only reachable with hourly leave switched off entirely.

## 2026-08-17 — Local stack brought up twice, daily-errand home shortcut added, second client deploy

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `f4bed65`, clean apart from modified `docs/` files
**Trigger:** Amir could not open the local Docker stack, then found the daily work errand form
missing from the home board, then deployed the fix to the client's server.

**What changed**
- `app/[locale]/(app)/home/HomeBoard.tsx:84-115` — fourth quick-action link to
  `/request/daily-errand` (`data-testid="home-request-daily-errand"`), `requestDailyErrand` added
  to the `Labels` type, grid `sm:grid-cols-3` → `sm:grid-cols-2 lg:grid-cols-4` so four buttons
  wrap 2×2 on phones. The comment above the grid used to claim one entry point per paper form and
  was wrong once the daily errand shipped.
- `app/[locale]/(app)/home/page.tsx:121` — wires `requestDailyErrand: t('requestDailyErrand')`.
- `messages/en.json:41`, `messages/fa.json:41` — `requestDailyErrand`
  ("Daily errand request" / "درخواست ماموریت روزانه").
- Committed by Amir as `faf3305`, pushed; `main` and `origin/main` are in sync.

**Investigation — three separate "it's broken" reports, none of them a code bug**
1. `https://localhost:3500` failed with `ERR_SSL_PROTOCOL_ERROR`. `deploy/caddy/Caddyfile:29`
   serves exactly one site, `https://{$APP_HOST}`, and the gateway had `APP_HOST=192.168.2.48`, so
   SNI `localhost` gets no certificate: `TLSv1.3 (IN), TLS alert, internal error (592)`. The right
   URL was the IP. Nothing to fix.
2. iPhone showed `Client sent an HTTP request to an HTTPS server.` — Safari sent plain HTTP to the
   TLS-only port because the scheme was omitted. Reproduced with
   `curl http://192.168.2.48:3500/` → 400 and that exact body.
3. The "old version without the daily errand form" was **not a stale image**. Before rebuilding I
   checked `docker exec bj-erp-app-1 ls '.next/server/app/[locale]/(app)/request/'` and the
   `daily-errand` route was already there, built 2026-08-12 15:24 (`.next/BUILD_ID` timestamp;
   the newer file mtimes come from the entrypoint's Supabase placeholder rewrite). The real cause
   was the home board only ever linking three request types.

**Actions outside the repo**
- Rebuilt `bj-erp-app:local-arm64` twice and recreated only the app container each time
  (`docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local-arm64.yml up -d
  --no-deps --force-recreate --pull never app`). Tagged `bj-erp-app:local-arm64-rollback` first.
  DB container and `bj-erp_db-data` untouched; row counts unchanged (17 profiles, 3 requests,
  5 departments).
- **Deployed to the client's server.** Run `20260817T042022Z-9f9246`, version
  `20260817-042022-faf3305`, replacing `20260813-004921-11373fe` on `10.10.10.50:3500`.
  The 107,157,961-byte image tarball took ~2 h at ~14 KB/s. The run then died at the remote
  `sudo` password prompt overnight (`Shared connection to 5.201.190.184 closed.`) leaving status
  `PREPARED`; `caffeinate -i ./deploy/bj-deploy resume 20260817T042022Z-9f9246` restarted it with
  **no re-upload** and finished in about a minute. 41 migrations all skipped as already applied —
  this release had none. Row counts identical before and after (profiles 3, user_roles 6,
  leave_requests 1, leave_ledger 7, holidays 0, departments 5, leave_types 3, companies 1).
  Backup `pre-20260817-042022-faf3305-2026-08-17-171842.dump` (324K) verified and pulled to
  `backups/deploy-assistant/client/20260817T042022Z-9f9246/`. Server auto-removed the older image
  `bj-erp-app:20260812-052250-d941970`.
- Exported the local Caddy root CA to the scratchpad for iPhone trust
  (`docker cp bj-erp-gateway-1:/data/caddy/pki/authorities/local/root.crt`). Installing it is
  Amir's own device-settings step; not done for him.
- **Edited `deploy/.env` (local only, gitignored): `APP_HOST`/`APP_ORIGIN` 192.168.2.48 →
  192.168.2.70** after the Mac's DHCP lease moved, then recreated `app`, `gateway`, and `auth`.
  The client's `.env` was not touched.

**Verification**
- `npx tsc --noEmit` exit 0; `npm run lint` clean; `npx vitest run tests/unit` **254 passed
  (40 files)**.
- Release image architecture checked before shipping: `docker image inspect
  bj-erp-app:20260817-042022-faf3305 --format '{{.Architecture}}'` → `amd64`; artifact SHA-256
  matched its recorded `.sha256` (`1faf3301248e…`).
- New bundle inside the running container greps for `home-request-daily-errand` plus both labels.
- Local endpoints after the IP change: `/login` **200**, `/request/daily-errand` **307 → login**,
  `/auth/v1/health` returns GoTrue v2.170.0.
- **e2e not run** this session, in either environment. The home board change is verified at the
  bundle level and by the client-side deploy health check, not by a logged-in browser assertion —
  the board sits behind login and I do not enter passwords.

**State left behind**
- `main` @ `faf3305`, pushed, client server running that version. Local stack healthy at
  **https://192.168.2.70:3500** (note the new IP).
- `deploy/.env` now points at 192.168.2.70. It will break again on the next DHCP change: the
  Caddy certificate name, `NEXT_PUBLIC_SUPABASE_URL`, and GoTrue's `API_EXTERNAL_URL` all come
  from `APP_HOST`/`APP_ORIGIN`. A DHCP reservation for the Mac would end this.
- Rollback on the client stays available: previous image is still on the server, command printed
  in the deploy summary.

**For the next agent**
- `./deploy/bj-deploy resume RUN_ID` genuinely resumes from `PREPARED` without re-uploading; the
  artifact and its checksum are already on the server. Do not restart a two-hour upload.
- Monitoring a client deploy from a phone works: `cd ~/bj-erp-installer && sudo ./remote-job.sh
  status|logs RUN_ID`, plus `stack-status`/`stack-logs`. Run dirs are `chmod 700` and root-owned,
  so sudo is required; the interactive gates (sudo password, backup authorization) still need the
  Mac.
- Before blaming a stale image for a missing feature, list the route inside the running container.
  Twice now the image was current and the gap was elsewhere.

## 2026-08-17 — Leave-balance "bug" diagnosed as a wording problem; Add/Edit Employee hints rewritten

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `faf3305`, clean tree
**Trigger:** Amir created an employee with 12 annual / 6 sick days, a 1-day-per-month accrual
capped at 12, and a hire date two months back. On first login the employee showed **13** annual
and **6.5** sick. He asked why, said not to change any code, then asked for clearer wording once
the cause was clear.

**Investigation — the finding, since this will be asked again**
Not a bug. Two independent credits stack:
- The days field on Add Employee is a **one-off opening allocation** —
  `NewEmployeeForm.tsx:170` → `allocateLeave` → `private.allocate_leave_impl`, which writes a
  `leave_ledger` row with **no `period_month`** (so it is NULL).
- The policy fields are a separate rule — `NewEmployeeForm.tsx:191` → `setEmployeeLeavePolicy`.

The annual cap counts accrual rows only. `20260729130006_leave_accrual_fns.sql:120-127` joins
`jalali_months on jm.gregorian_start = l.period_month`, so a NULL `period_month` can never match
and the opening 12 days never consumes the cap of 12. `lib/leave/accrual.ts:74-76` says so
explicitly, and the unit test `starts from the opening balance` locks it in (opening 2400 min +
first accrual 480 → 2880).

Why only +1 and +0.5 rather than two months' worth: `accrualStartMonth` is
`getCurrentJalaliMonthStart()`, **not** the hire date (`employees/new/page.tsx:60`), deliberate
per spec §6 D10. Today 2026-08-17 sits in Mordad 1405 (`2026-07-23`–`2026-08-22`,
`20260729130001_jalali_calendar.sql:100`), so the loop's
`gregorian_start >= accrual_start_month and <= today` window contains exactly one month. Tir
starts `2026-06-22`, before the start month, so the back-dated hire earned nothing. Mordad was
credited in full because pro-rating only fires when the hire date falls *inside* the month being
accrued. It surfaced at first login because accrual is lazy — `getMyBalances` → `accrueBeforeRead`
→ `accrue_my_leave`.

Amir's follow-up read ("set the opening balances to 0 and let the cap be the annual entitlement")
is correct, with two caveats I gave him: the first Jalali year is partial (added in Mordad → 8
days by Nowruz, not 12), and the carryover cap decides what survives Farvardin 1 — carryover 0
means unused annual is forfeited every Nowruz.

**What changed** — wording only, approved verbatim before applying. No logic, no migration.
- `messages/{fa,en}.json` — `allocTitle` reworded to "Starting balance — one-off"; `policyHint`
  reworded; five new keys: `allocHint`, `policyRateHint`, `policyAnnualCapHint`,
  `policyCarryCapHint`. The hints state the three things that actually confused him: the opening
  balance is one-off and normally 0, accrual starts from the current Jalali month rather than the
  hire date, and the yearly cap counts accrual only.
- `.../employees/new/NewEmployeeForm.tsx` — `allocHint` rendered under the section title; the
  three policy hints rendered under their inputs, wired with `aria-describedby`.
- `.../employees/[id]/EditEmployeeForm.tsx` — same three policy hints. **The policy label keys are
  shared between the two pages**, so rewording them changes Edit Employee too; the copy is phrased
  to read correctly on both ("added to their current balance", "balances set by hand do not
  count"), which is why it does not say "starting balance" — that section only exists on Add.
- Both pages' `page.tsx` thread the new label props.
- `docs/MEMORY.md` — new lesson recording the stacking model and the two D10 consequences.

**Actions outside the repo**
- None. No server, no database, no deploy.

**Verification**
- `npx tsc --noEmit` clean · `npm run lint` clean · `npm run test:unit` 40 files, 254 tests passed
  · `npm run build` succeeded.
- Visual check on a **static replica**, not the live app — I cannot log in as admin (entering
  credentials is out of bounds for me), so I generated HTML from the actual `fa.json`/`en.json`
  values, linked the real built CSS chunk, and screenshotted. Farsi RTL and English both render
  correctly at desktop and at 375px; the three hints stack to one column below `sm`.
  **These sections have not been seen inside the authenticated app.**
- Trap worth knowing for the next agent doing this: a scratchpad replica needs
  `<meta name="viewport" content="width=device-width, initial-scale=1">` or the mobile preset is
  ignored and the page lays out at 980px — my first "mobile" screenshot was wrong because of it.

**State left behind**
- Uncommitted on `main`. No dev server left running.

**For the next agent**
- The underlying model is unchanged and still surprising: opening allocation + accrual = up to
  2× the intended annual entitlement in the first year. If Amir later asks to *fix* rather than
  document it, the options are making the annual cap count opening allocations (change the join in
  `accrue_leave` and `planAccruals` in lockstep), or defaulting the opening field to 0.
- `leave_types.default_annual_quota_days` still pre-fills the opening allocation field, so the
  form's default is non-zero out of the box — that is what makes the trap easy to fall into.

## 2026-08-13 (later) — Client deployment record closed; backup is off-server

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `f4bed65` (= `origin/main` and both review refs), clean tree
**Trigger:** Completing the previous entry — the user ran the resume command it recommended.

**Actions outside the repo**

- The user ran `./deploy/bj-deploy resume 20260813T020320Z-901150` against the client. With the
  fixed path contract it replayed the stored `job.log` and downloaded the verified dump. **No
  deployment occurred**: the printed banner is the original run's log
  (`STARTED_AT=2026-08-13T02:07:52Z`, `FINISHED_AT=02:08:52Z`), its rollback line still names the
  pre-cutover `APP_VERSION=latest`, the backup filename is the original `…-053754.dump`, and rsync
  transferred exactly one file. No worker, migration, container, or database operation ran.

**Verification**

- `backups/deploy-assistant/client/20260813T020320Z-901150/pre-20260813-004921-11373fe-2026-08-13-053754.dump`
  — 330681 bytes, mode `600`, directory `700`. Recorded and recomputed SHA-256 both
  `32bd9bc8f86bdc41713bb8f6072d7f91d24bb0f48d78a544912d1162e2893d59`. The server had already proved
  the archive with `pg_restore -l` before the deploy; `pg_restore` is not on this Mac's PATH.
- `git status --porcelain` empty; `main` still at `f4bed65`.

**State left behind**

- Client is live on `20260813-004921-11373fe` with all 41 migrations applied and row counts
  unchanged (profiles 3, user_roles 6, leave_requests 1, leave_ledger 7, holidays 0, departments 5,
  leave_types 3, companies 1). The pre-deploy dump now exists off-server. This closes the open item
  in the entry below.
- This log entry is uncommitted at the time of writing.

**For the next agent**

- The backup copy holds employee records and password hashes. `backups/` is Git-ignored; move it
  only to approved encrypted storage.
- Still open from earlier sessions: no scheduled off-server backups **between** releases.

## 2026-08-13 (later still) — "Deploy the latest update": nothing to deploy; replay landmine already closed

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `f4bed65`, tree dirty only with the entry above
**Trigger:** User asked to deploy the latest update to the client, and (after being shown there was
none) chose a read-only health check plus work on the deferred migration-replay landmine.

**What was found — no deployment was needed**

- The client runs the tree of `11373fe`. `git diff --name-only 11373fe..main` touches only
  `deploy/`, `tests/deploy/`, and `docs/` — **zero** changes under `app/`, `components/`, `lib/`,
  `i18n/`, `messages/`, `supabase/`, `public/`, `next.config.ts`, `proxy.ts`, `package*.json`. The
  repo has 41 migrations and the client has 41 applied. An `update` would have rebuilt a
  byte-identical image and re-skipped every migration.
- **The migration-replay landmine recorded on 2026-07-31 is already closed**, by the 2026-08-06
  ledger work rather than by anything this session did. Every migration path —
  `install.sh:175`, `update.sh:156`, `bj-deploy:591` — calls `bj_apply_migrations`, which consults
  `bj_deploy.schema_migrations` and skips applied files by checksum, so
  `20260623120001_core.sql:11` never re-executes. No `for f in migrations/*.sql` loop remains; the
  only other `psql -f` is `bootstrap_admin.sql`, gated by `ADMIN_EXISTS`. The old all-or-nothing
  worry is also gone: each migration and its ledger row share one `--single-transaction`, so a
  mid-run failure rolls back that file alone and leaves earlier ones recorded and resumable.
- **Process note:** two greps early in this session appeared to show `install.sh` still using a bare
  replay loop and the docs still claiming idempotency. Both were wrong — the shell's working
  directory had persisted into the linked worktree
  `.claude/worktrees/peaceful-williams-9c1cf9` (checked out at `cce7b16`, an ancestor of `main`)
  from an earlier `cd`, so they read old file contents at misleading line numbers. Re-run from the
  repo root they contradict themselves. **After `cd`-ing into a worktree, `cd` back before grepping
  or you will "confirm" a bug that was fixed weeks ago.**
- That same worktree holds uncommitted app work not on `main`: `EmployeesTable.tsx` +
  `manage/employees/page.tsx` move the bulk-password-reset dialog strings to client-side
  `useTranslations` so `confirmBody` receives its `{count}` (replacing main's `.raw()` workaround),
  plus a new `tests/unit/employees-table-regen.test.tsx`. The user chose not to ship it this
  session. It is the only application change not on the client.

**What changed**

- `docs/TASKS.md` — replaced the 2026-07-31 "migrations are NOT idempotent, replay aborts on file
  #1" caveat with the resolved state; marked the release-pipeline acceptance test done with its
  measured row counts; added the unexercised rollback drill and a new client-disk item.
- `docs/MEMORY.md` — added the durable lesson behind the backup-path fix: record cross-machine
  paths canonically, because `rsync user@host:relative/path` resolves against the SSH user's home,
  and validate such values as a whitelisted single component rather than a prefix glob.

**Actions outside the repo**

- One read-only SSH probe, authorized by the user in this session, mirroring `client_doctor`'s
  non-sudo command: `hostname`/`whoami`/`uname -m`, `command -v docker|rsync|flock|curl`,
  `docker compose version`, `df -h`. Result: `behsazan-virtual-machine`, `x86_64`, Docker present,
  Compose v5.3.1, rsync/flock/curl present, **`/dev/sda3` 29 GiB total, 22 GiB used, 6.0 GiB free
  (79%)**. Nothing was written, no sudo, no containers touched.
- `sudo ./remote-job.sh stack-status` (the rest of `doctor client`) was deliberately **not** run: it
  needs a TTY password this agent cannot supply. Run `./deploy/bj-deploy doctor client` by hand for
  `docker compose ps`.

**Verification**

- Claims above come from `git diff --name-only 11373fe..main`, `grep` over `deploy/` re-run from the
  repo root, and reading `deploy/lib/migrations.sh:266-292`. No test suite was re-run: this session
  changed only Markdown.

**State left behind**

- No code changed. `docs/{AGENT-LOG,TASKS,MEMORY}.md` are modified and **uncommitted**; `main` is
  still `f4bed65`. A client release requires a clean tree (`git_release_guard`), so these must be
  committed before any future deploy.

**For the next agent**

- **Client disk is the next thing to break.** 6.0 GiB free against `CLIENT_MIN_FREE_GB=5`;
  `client_release_preflight` refuses below that. `update.sh` already keeps only 3 images and 14
  backups, so the excess is probably older untagged images — prune before the next release.
- The `20260813-004921-11373fe` image is what the client runs; do not assume `latest` means anything
  on that server.

## 2026-08-13 — Backup-path contract fix after the client update actually succeeded

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `fdc71ab` (= `origin/main`, `codex/code-review`,
`origin/codex/code-review`), clean tree
**Trigger:** `./deploy/bj-deploy retry-uploaded 20260813T004921Z-b987f2` created run
`20260813T020320Z-901150`, which **succeeded** on the server — image switched, app/db/auth health
passed, all 41 migrations already applied, row counts identical before and after — and then the Mac
controller exited with
`ERROR: server returned an unexpected backup path: ./backups/pre-20260813-004921-11373fe-2026-08-13-053754.dump`.

**What was found**

- `deploy/update.sh:43` set `BACKUP_DIR=./backups` and wrote that directory-relative
  `BACKUP_FILE` verbatim into `$BJ_RUN_DIR/backup.path` (`deploy/update.sh:129`).
- `fetch_remote_backup()` in `deploy/bj-deploy:240` accepted only `"$BJ_REMOTE_DIR"/backups/*`, so it
  refused the server's own legitimate record after the deployment had already completed.
- The relative form is not merely cosmetic: `remote_rsync "${BJ_SSH_DEST}:${path}"` resolves a
  relative remote path against the SSH user's **home**, not the installer directory, so a plain
  widening of the pattern would have fetched from the wrong place.
- `remote-job.sh:97` (`perform_backup`, the reset path) already recorded `$PWD/backups/...`, which is
  why only the update path was affected.

**What changed**

- `deploy/lib/common.sh` — added `bj_resolve_remote_backup_path REMOTE_DIR RECORDED_PATH`. It accepts
  `<remote_dir>/backups/<name>`, `./backups/<name>`, and `backups/<name>`, and prints the single
  canonical absolute path. `<name>` must be one path component of `A-Za-z0-9._-`, so `''`, `.`, `..`,
  nesting, leading `-`, spaces, `;`, `$(…)`, backticks, over-long names, arbitrary absolute paths,
  and any other remote directory are refused. A relative `REMOTE_DIR` is refused too.
- `deploy/bj-deploy:233` — `fetch_remote_backup()` resolves the recorded value through that helper
  before rsync. The validation is strictly tighter than the old prefix glob, which passed any bytes
  after `backups/` straight into a remote shell.
- `deploy/update.sh:43` — `BACKUP_DIR="$PWD/backups"` (the script already `cd`s to the installer
  directory), so future runs record a canonical absolute path.
- `tests/deploy/deploy-assistant.test.sh` — two new named cases (17 total). One is a 19-entry
  accept/reject matrix over the resolver, including the exact path from this incident, plus contract
  greps on both scripts. The other builds a fake repo with fake `ssh`/`rsync` on `PATH` and runs
  `./deploy/bj-deploy resume` against a `SUCCEEDED` update whose `backup.path` holds the relative
  form: it asserts the dump is fetched from the absolute remote location, the checksum and `600`
  mode are recorded, rsync ran exactly once, and the ssh transcript contains no
  `remote-job.sh start`/`__run`, `update.sh`, `docker`, or `pg_restore`.
- `docs/{CHANGELOG,DEPLOY-ASSISTANT}.md` and `deploy/RUNBOOK.md` — documented the backup-path
  contract and that resuming a `SUCCEEDED` run collects evidence only.

**Actions outside the repo**

- **None.** No SSH, no read-only probe, no transfer, no database or container operation, no restore,
  no migration, no deployment. The failure was reproduced entirely locally against fake `ssh`/`rsync`.

**Verification**

- Mutation check: a fake repo running `git show HEAD:deploy/bj-deploy` + `HEAD:deploy/lib/*.sh`
  against the same fixtures reproduced the incident error verbatim
  (`ERROR: server returned an unexpected backup path: ./backups/pre-x.dump`); the fixed controller
  downloads and verifies the same dump. The new test is a genuine regression test, not a tautology.
- `/bin/bash -n` passed for every deployment and deployment-test shell script.
- `npm run test:deploy` — all 17 named cases passed. `git diff --check` passed.
- `npm run lint`, `npx tsc --noEmit` passed. `npm run test:unit` — 40 files / 254 tests passed.
- `npm run build` passed (exit 0), 40 pages including `/api/health`.
- Playwright not rerun: no application, migration SQL, database contract, or browser behavior changed.

**State left behind**

- Client run `20260813T020320Z-901150` remains `SUCCEEDED` on the server and is **not** to be
  redeployed. Its verified dump
  `<installer>/backups/pre-20260813-004921-11373fe-2026-08-13-053754.dump` is still only on the
  server; the local copy under `backups/deploy-assistant/client/<run-id>/` is still missing.
- The client is running `20260813-004921-11373fe` with all 41 migrations applied.

**For the next agent**

- To finish the local record, run `./deploy/bj-deploy resume 20260813T020320Z-901150`. Read from the
  implementation: the local manifest has `ACTION=update`, so the `SUCCEEDED` branch
  (`deploy/bj-deploy:738`) prints the last 120 log lines and calls `fetch_remote_backup` — nothing
  else. It does not start a worker, run migrations, or touch containers.
- Do not resume `20260811T180522Z-519c4f`, `20260812T052250Z-291168`, `20260812T155950Z-ee1c94`, or
  `20260813T004921Z-b987f2`; all are terminal.

## 2026-08-12 — Correct app-tag cutover and reuse the verified failed-run upload

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `codex/code-review` @ `11373fe` (= `main` and both origin refs)
**Trigger:** The user supplied client run `20260813T004921Z-b987f2`, which applied all pending
migrations but failed health checks and rolled its app image back.

**What changed**

- `deploy/lib/common.sh` — added `bj_set_app_version`, which atomically updates `APP_VERSION` in
  `.env` and exports the same value in the running shell. Docker Compose gives exported variables
  precedence over `.env`; changing only the file cannot select a new image after preflight sourced
  and exported the old tag.
- `deploy/update.sh` — cutover and rollback both use `bj_set_app_version`, and the existing tag is
  validated before mutation. The failed client log said it was switching to
  `20260813-004921-11373fe` but `docker compose ps` showed `bj-erp-app:latest`: the stale exported
  value caused Compose to recreate the old image, whose August 5 build predates `/api/health`.
- `deploy/bj-deploy` — added `retry-uploaded FAILED_RUN_ID`. It accepts only a local client-update
  manifest whose remote status is terminal `FAILED:*`; verifies the local archive and checksum,
  requires the server archive/checksum to match, requires unchanged migration and seed inputs, and
  creates a **new** immutable run with current controller scripts. It does not build or transfer the
  large app archive. The retry still runs the 5 GiB preflight, source gates, new verified backup,
  migration/seed pass, app cutover, architecture/health/row-count checks, and off-server backup copy.
- `tests/deploy/deploy-assistant.test.sh` — added regression coverage for file/exported-variable
  precedence and an isolated retry dry run that proves no build/upload and refuses changed seed
  input. The suite now has 15 named deployment cases.
- `docs/{CHANGELOG,DEPLOY-ASSISTANT,DEPLOY-GUIDE,MEMORY,TASKS}.md` and `deploy/RUNBOOK.md` — recorded
  the failure semantics, Compose precedence rule, and guarded no-reupload recovery command.

**Actions outside the repo**

- The user, not this agent, ran client update `20260813T004921Z-b987f2`. It created verified server
  backup `./backups/pre-20260813-004921-11373fe-2026-08-13-043136.dump` (316 KiB); recorded pre-run
  counts `profiles:3`, `user_roles:6`, `leave_requests:1`, `leave_ledger:7`, `holidays:0`,
  `departments:5`, `leave_types:3`, `companies:1`; loaded the AMD64 release image; and atomically
  applied/recorded all three August migrations. It then recreated `bj-erp-app:latest`, not the new
  tag, failed the health contract, and recreated `latest` again as rollback. Result was `FAILED:1`.
  The new image never ran. Forward migrations remain applied; no post-run row-count phase or local
  backup download occurred because health failed first.
- This agent attempted one read-only SSH health probe, but the permission gate rejected it before a
  process or connection was created because the original no-client-contact boundary remains active.
  No SSH, server read, transfer, database change, container operation, restore, or deployment was
  performed by this agent.

**Verification**

- `/bin/bash -n` passed for every deployment and deployment-test shell script.
- `npm run test:deploy` passed all 15 named cases; `git diff --check` passed. Both ARM64-local and
  AMD64-client Compose overlays passed `docker compose ... config --quiet`.
- `npm run lint` and `npx tsc --noEmit` passed. `npm run test:unit` passed 40 files / 254 tests.
- `npm run build` passed with Next.js 16.2.9 and generated 40 pages including `/api/health`.
- Playwright was not rerun because no application, migration SQL, database contract, or browser
  behavior changed; the full current-source suite passed earlier on 2026-08-12.

**State left behind**

- The hotfix is committed and pushed through retained `codex/code-review`, then fast-forwarded into
  clean synchronized `main` without rewriting history. Exact commit is reported in the handoff.
- Failed run `20260813T004921Z-b987f2` remains terminal and immutable. Its verified 102 MiB artifact
  remains locally and is expected remotely because cleanup occurs only after success; use
  `retry-uploaded`, which revalidates both copies before starting anything.

**For the next agent**

- From final clean `main`, run
  `./deploy/bj-deploy retry-uploaded 20260813T004921Z-b987f2`. It creates and prints a new run ID;
  if monitoring disconnects after start, resume that **new** ID. Do not resume the failed ID and do
  not restore the pre-run dump unless the currently rolled-back app is demonstrably incompatible
  with the forward schema.

## 2026-08-12 — Atomic ledger-input hotfix after the first client migration attempt

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `e73ef4b` (= `origin/main`), hotfix branch
`codex/migration-ledger-atomic-hotfix`
**Trigger:** The user resumed client run `20260812T155950Z-ee1c94`; its upload completed, but the
first pending August migration failed while recording the migration ledger.

**What changed**

- `deploy/lib/migrations.sh` — kept the verified host-side migration and ledger row in one
  `--single-transaction`, but moved the variable-bearing ledger `INSERT` out of a separate `psql -c`
  argument and appended it to the same `-f -` stdin stream as the migration. PostgreSQL received the
  literal `:'filename'` token through the old `-c` path; stdin is processed by psql and expands the
  safely quoted `-v` values before sending SQL to PostgreSQL.
- `tests/deploy/deploy-assistant.test.sh` — the migration harness now rejects any `-c` argument,
  requires both migration SQL and ledger SQL in the one stdin stream, and retains the existing
  checksum, simulated-rollback, and resume assertions.
- `docs/{CHANGELOG,DEPLOY-ASSISTANT,MEMORY,TASKS}.md` — documented the corrected psql transport and
  recorded that the first live acceptance run remains incomplete.

**Actions outside the repo**

- The user, not this agent, completed and checksum-verified the 102 MiB release upload, then resumed
  client run `20260812T155950Z-ee1c94`. The worker created and validated
  `./backups/pre-20260812-155950-e73ef4b-2026-08-13-040218.dump` (316 KiB), preserved row counts
  (`profiles:3`, `user_roles:6`, `leave_requests:1`, `leave_ledger:7`, `holidays:0`,
  `departments:5`, `leave_types:3`, `companies:1`), loaded the new tagged image without starting it,
  and skipped the 38 recorded baseline migrations. The first August migration and ledger insert
  were wrapped by `--single-transaction`; the ledger syntax error caused rollback, status
  `FAILED:1`, and no app restart. The existing `latest` app remained running. No restore is indicated.
- This agent did **not** SSH to the client, transfer a bundle, modify its database, or operate its
  containers. Local only: an isolated temporary-table query against `bj-erp-db-1` proved psql
  interpolates the filename/checksum/release values when the combined input is read via `-f -`.

**Verification**

- `/bin/bash -n` passed for every deployment and deployment-test shell script.
- `npm run test:deploy` passed all 13 cases, including the new single-stdin/no-`-c` regression;
  `npm run lint` and `npx tsc --noEmit` passed.
- `npm run test:unit` passed 40 files / 254 tests. `npm run build` passed with Next.js 16.2.9 and
  generated 40 pages. The first sandboxed build was blocked only because Turbopack could not bind
  its internal worker port; the permitted rerun completed successfully.
- Playwright was not rerun: no application, migration SQL, image contents, or browser behavior
  changed. The full current-source suite had passed earlier the same day before this shell-only fix.
- `git diff --check` passed.

**State left behind**

- The focused fix and documentation are committed on the local hotfix branch, then the retained
  review branch `codex/code-review` and `main` are fast-forwarded to that commit and pushed without
  rewriting published history.
- Client run `20260812T155950Z-ee1c94` is terminal and must not be resumed. The existing client app
  and test database remain available; a new update from the corrected clean `main` is required.

**For the next agent**

- Start a new `./deploy/bj-deploy update client`; do not reuse the failed run ID. The new run will
  take another verified backup, skip the 38 baseline rows, atomically apply/record the three August
  migrations, and cut over only after all health checks pass.

## 2026-08-12 — Container-safe migration runner after the resumed client update

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `d941970` (= `origin/main`), hotfix branch
`codex/migration-stdin-hotfix`
**Trigger:** The user resumed staged client run `20260812T052250Z-291168`; it reached the first
pending August migration and failed because containerized `psql` could not open the server-host
run-directory path.

**What changed**

- `deploy/lib/migrations.sh` — changed atomic migration execution from `psql -f <host-path>` to
  `psql -f - < <host-path>`. The verified run-scoped SQL now crosses the Docker boundary through
  stdin, while the migration and its ledger `-c` remain inside one `--single-transaction` call.
- `tests/deploy/deploy-assistant.test.sh` — the fake containerized `pgexec` now rejects host file
  paths, requires non-empty migration SQL on stdin, and requires the ledger insert in the same
  invocation. Existing checksum, resume, and simulated-rollback assertions remain active.
- `docs/{CHANGELOG,DEPLOY-ASSISTANT,MEMORY}.md` — documented the container namespace boundary and
  durable `-f -`/stdin rule.

**Actions outside the repo**

- The user, not this agent, ran `./deploy/bj-deploy resume 20260812T052250Z-291168` against the
  client. The corrected worker created and validated
  `./backups/pre-20260812-052250-d941970-2026-08-12-183332.dump` (312 KiB), recorded pre-update row
  counts, loaded but did not start `bj-erp-app:20260812-052250-d941970`, and bootstrapped the private
  ledger with the verified 38-migration legacy baseline. The first August migration never executed
  and was not recorded; the old `latest` app remained running. The worker ended truthfully as
  `FAILED:1`. No restore is indicated.
- This agent did **not** SSH to the client, transfer files, modify its database, or operate its
  containers. Failed run `20260812T052250Z-291168` remains terminal and must not be resumed again.
- Local only: proved the exact `psql --single-transaction -f - -c ...` transport with read-only
  `SELECT 41` / `SELECT 42` against `bj-erp-db-1`. For current-build E2E, the guarded local Safe
  Update created verified backup
  `backups/deploy-assistant/local/20260812T152344Z-e8aeaf/postgres.dump`, skipped all 41 matching
  ledger migrations, ran the idempotent seed, built native ARM64 image
  `sha256:373e31bd987cc7c4e89063516efdea586a972706a25128978c93b7786d5e8f25`, and recreated only
  `bj-erp-app-1`.
  The local database/auth/rest/gateway containers and database volume were preserved.

**Verification**

- `/bin/bash -n` passed for every deployment/test shell script; `npm run test:deploy` passed all
  13 cases, including the new container-stdin assertion; `git diff --check` passed.
- `npm run lint` and `npx tsc --noEmit` passed; `npm run test:unit` passed 40 files / 254 tests.
- `npm run build` passed with Next.js 16.2.9 and generated 40 pages. An initial sandboxed attempt
  was correctly treated as failed because Turbopack could not bind its internal worker port; the
  authorized rerun completed successfully.
- The first dev-server E2E attempt was stopped after two login timeouts because `.env.local`
  targets unpublished local gateway port 8080 (`ECONNREFUSED`), not because of product code. A
  production-shaped local Docker run against the stale August 6 image produced 31 pass / 2 fail /
  1 skip. After the guarded current-source ARM64 rebuild, the full serial Playwright suite passed:
  **33 passed, 1 intentionally skipped**. Teardown deleted all 28 throwaway users and one test
  department.

**State left behind**

- Focused hotfix commit `504b368` is on `codex/migration-stdin-hotfix`. This log is the follow-up
  documentation commit; both commits are intended to be pushed on the retained hotfix branch,
  fast-forwarded into `main`, and pushed without rewriting history.
- Local test stack is healthy on the rebuilt ARM64 app with its existing data. Client production
  is still on `latest`; its 38-row migration ledger is now established, but none of the three
  August migrations or the new app was deployed by the failed run.

**For the next agent**

- Do not resume `20260812T052250Z-291168`. Once final clean `main` is synchronized, begin a **new**
  `./deploy/bj-deploy update client`; the clean-tree, disk, backup, migration, architecture, and
  health guards must remain intact.

## 2026-08-12 — Safe Update false-success and late disk-preflight hotfix

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `3e71818` (= `origin/main`), hotfix branch
`codex/deploy-preflight-hotfix`
**Trigger:** The user's first client Safe Update stopped for low disk after a four-hour transfer but
was incorrectly reported as successful; after reviewed cleanup left 6.9 GiB free, the user asked
what to do next while preserving the test database and login credentials.

**What changed**

- `deploy/remote-job.sh` — runs each mutating worker action in an isolated shell with active
  `errexit`, captures the real child exit code in the controller, and writes `FAILED:<code>`.
  This closes the Bash context bug where `perform_update ... || rc=$?` disabled `set -e` inside the
  function, allowing failed `update.sh` to continue into `record_installed_state` and return zero.
- `deploy/bj-deploy` — checks the client's exact available KiB over SSH before source tests, AMD64
  build, or transfer; requires 5 GiB. A successful update now requires non-empty remote backup path
  and checksum metadata, including on resume, instead of treating missing files as “no database.”
- `deploy/update.sh` — repeats the 5 GiB server preflight using exact KiB rather than rounded
  `df -BG` output and reports the measured GiB.
- `tests/deploy/deploy-assistant.test.sh` — reproduces a child update exiting 23 and proves the run
  becomes `FAILED:23`, logs the failure, and writes no installed-state files. Also guards the early
  disk-check ordering and mandatory backup metadata contract.
- `docs/{DEPLOY-ASSISTANT,DEPLOY-GUIDE,MEMORY,CHANGELOG}.md` — documented failure semantics, disk
  diagnosis, safe cleanup boundaries, non-resumable terminal failures, and the durable Bash trap.

**Actions outside the repo**

- The user ran the deployment before this hotfix. SSH setup, lint, 254 unit tests, AMD64 build, and
  transfer succeeded. Remote run `20260811T180522Z-519c4f` then stopped with only about 2.2 GiB
  usable disk space, before backup, image loading, migrations, database writes, or app cutover.
  The old worker falsely wrote `SUCCEEDED` and installed manifests; those claims do not represent
  deployed state and that run must never be resumed.
- At the user's direction, the user removed only the duplicate old installer, already-imported
  offline image archives, and failed release upload. Reported free space increased to 6.9 GiB;
  all five containers remained running and healthy, and `bj-erp_db-data` remained mounted at
  `/var/lib/docker/volumes/bj-erp_db-data/_data` (about 44 MiB).
- This agent did not connect to the client server, run SSH, transfer files, change its database, or
  operate its containers during the hotfix.

**Verification**

- `/bin/bash -n` passed for every deployment/test shell script.
- `npm run test:deploy` passed all 13 cases, including the exact false-success regression.
- `npm run lint`, `npx tsc --noEmit`, and `npm run test:unit` passed; unit result was 40 files and
  254 tests.
- `npm run build` passed with Next.js 16.2.9 and generated 40 pages. Both the local ARM64 and client
  AMD64 Compose overlays rendered successfully with `config --quiet` without starting containers.
- All 50 Markdown files passed the local-link check; `git diff --check` passed.

**State left behind**

- Hotfix commit `af0f4a7` was pushed to `origin/codex/deploy-preflight-hotfix`, fast-forwarded into
  `main`, and pushed to `origin/main` without rewriting history. This documentation-only completion
  update is also synchronized to both retained branches before handoff. Local `main` is clean and
  the next Safe Update will stage the corrected worker before starting a new remote run.

**For the next agent**

- Never resume `20260811T180522Z-519c4f`; it is a falsely terminal run from the old worker. Start a
  new `./deploy/bj-deploy update client` only from the final clean `main`. The new run overwrites the
  incorrect installed manifests only after a real successful update and preserves the existing
  database volume, users, credentials, Caddy state, and `.env` secrets.

## 2026-08-11 — Git landing completion for the reviewed August release

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `codex/code-review` @ `d4f474e`
**Trigger:** Completion of the reviewed release-preparation session recorded in the next entry.

**What changed**

- Staged all 114 reviewed paths only after the cached diff passed whitespace, artifact-name,
  private-key, and token-signature checks. Created `d4f474e` (`feat: add signed leave flows and
  guarded deployment`) and pushed `codex/code-review` to `origin` without rewriting history.
- GitHub reported no evaluated rules for `main` and no classic branch protection. Fast-forwarded
  local `main` from `4e6b6bf` to `d4f474e` and pushed the same commit to `origin/main`; no pull
  request or protection bypass was needed.
- `docs/AGENT-LOG.md` — added this documentation-only completion record. This follow-up commit is
  fast-forwarded to both the retained review branch and `main` so their final source/documentation
  content remains identical.

**Actions outside the repo**

- A stale zero-byte `.git/index.lock` dated 2026-08-09 initially blocked staging. Process and file
  checks proved no Git/GitHub process owned it; the file was moved, not deleted, to
  `/private/tmp/bj-index.lock.stale-20260809` before staging resumed.
- Pushed Git refs to GitHub. The client server was not contacted: no SSH, transfer, database change,
  deployment, Safe Update, or production container operation occurred.

**Verification**

- Immediately before the release commit, `main...origin/main` was `0 0`; the remote review branch
  did not exist; the linked Claude worktree/branch remained unchanged.
- The release commit was created from a clean cached diff, its review-branch push succeeded, and the
  first `main` fast-forward/push succeeded. The final documentation-only synchronization repeats
  `git diff --check` and verifies identical local/remote refs and an empty porcelain status.

**State left behind**

- The intended final state is clean `main`, with `main`, `origin/main`, `codex/code-review`, and
  `origin/codex/code-review` all pointing to this documentation follow-up commit. Exact final hashes
  are reported to the user after the synchronization is verified.

**For the next agent**

- The repository is ready for the guarded client Safe Update once the operator chooses to begin it.
  This session deliberately stopped before any client contact or deployment action.

## 2026-08-11 — Reviewed and prepared the pending August release for production

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` (= `origin/main`)
**Trigger:** The user authorized a complete review, validation, commit, and push of all intended
pending work, with production `main` left clean for the deployment assistant and no client deploy.

**What changed**

- Inventoried the repository before staging: 74 modified and 35 untracked paths (109 total), no
  staged or deleted paths. Confirmed `main` matched `origin/main`, created `codex/code-review` from
  that base without disturbing the working tree, and retained the linked
  `claude/peaceful-williams-9c1cf9` worktree and its branch.
- Reviewed the application, three August migrations, deployment assistant, ARM64/AMD64 overlays,
  tests, documentation, and branding. The pending paths contained no secrets, `.env` files,
  private keys, database dumps, deployment archives, Docker image archives, or temporary output.
  `.gitignore` now keeps deployment run state and manifests under `.bj-deploy/` out of Git.
- `deploy/lib/migrations.sh` — made each migration and ledger row one PostgreSQL transaction and
  strengthened the three known-August-migration adoption fingerprints to verify their complete
  catalog shape, security, grants, and relevant function bodies.
- `deploy/{bj-deploy,remote-job.sh,update.sh,install.sh}` — isolated migrations and seed data inside
  each immutable run, reverified the manifest before remote mutation, preserved transfer-owner
  access to backups/manifests, corrected custom SSH host/user/port resolution, and consistently
  selected the production AMD64 overlay for restore/rollback guidance.
- `deploy/release.sh` — replaced the superseded direct transfer path with a compatibility wrapper
  that delegates to the guarded deployment assistant. The clean-`main` safety check in
  `deploy/bj-deploy` remains intact and was neither bypassed nor weakened.
- `supabase/migrations/20260805185628_approval_signatures_persian_only.sql` — corrected the approver
  signature constraint so cancelling an approved future request preserves the signed evidence.
  Added regression coverage and strengthened the adoption fingerprint for this shape.
- `scripts/seed-demo.mjs`, E2E fixtures, `README.md`, and `docs/DEPLOY.md` — updated the obsolete RPC
  argument and legacy alphanumeric demo logins to current numeric personnel-number login codes.
- `lib/leave/signature.ts` — aligned signature validation with the database minimum length and
  removed a dead constant reported by the final lint run.
- Deployment guides, durable memory, data/permission/requirements/task documentation, and the
  changelog now describe atomic ledger/resume behavior, immutable run inputs, correct ARM64-local
  versus AMD64-client commands, and the reviewed feature set.

**Actions outside the repo**

- Fetched Git refs from `origin`; no history was rewritten and no branch was deleted.
- Used only the existing local ARM64 Docker test environment. The local database received the
  corrected pending approval-signature constraint/checksum and the numeric demo fixtures needed by
  Playwright. E2E teardown removed its temporary test users and department.
- The client server was not contacted. No client SSH connection, file transfer, database change,
  deployment bundle transfer, Safe Update, or production container operation occurred.

**Verification**

- Shell syntax: every `deploy/*.sh`, `deploy/bj-deploy`, `deploy/lib/*.sh`, and
  `tests/deploy/*.sh` file passed `/bin/bash -n`.
- `npm run lint` — passed with no errors or warnings. `npx tsc --noEmit` — passed.
- `npm run test:unit` — 40 files and 254 tests passed.
- `npm run test:deploy` — all 11 deployment-assistant cases passed, including atomic migration
  rollback/resume and immutable run-source/ownership regressions.
- `npm run build` — Next.js 16.2.9 production build passed and generated 40 pages, including
  `/request/daily-errand`, `/api/health`, the Apple icon, and the PWA manifest.
- `npx playwright test` against the local HTTPS stack — 33 passed and one intentionally skipped
  legacy department-code-editing case. An earlier run exposed the signed-cancellation constraint
  and stale demo seeder; both were fixed, their targeted tests passed, and then the entire suite
  passed.
- Local Docker doctor passed with five native ARM64 services and a healthy database/app. A local
  Compose render of the client overlay selected only the dedicated AMD64 service images plus the
  app image; it did not start or modify containers.
- All three hardened August migration fingerprints returned true against the local test database.
  English/Farsi key parity passed for 415 messages. All 50 Markdown files had valid local links;
  icon formats/dimensions were verified; `git diff --check` passed.

**State left behind**

- At the time this entry was written, the reviewed work was still on `codex/code-review`, ready for
  staging and landing. The final commit/push/merge hashes are recorded in the completion entry that
  follows this one in Git history.

**For the next agent**

- Do not weaken the clean-tree or clean-`main` production gate. The next production action is the
  guarded client Safe Update only after confirming local `main` and `origin/main` remain identical.
- Do not replay or edit historical migrations already recorded by a deployed ledger. The three
  August files were still pending for the client during this review, which is why correcting the
  constraint before their first production application was safe.

## 2026-08-11 — Production release blocked by intentional clean-tree guard

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf`
**Trigger:** The user selected Client server → Safe update in `./deploy/bj-deploy` and reported
`client releases require a clean working tree; commit or stash changes first`.

**What changed**

- `docs/AGENT-LOG.md` only — recorded the diagnosis. No deployment or application code changed.

**Actions outside the repo**

- None. The client server was not contacted and no package, SSH transfer, backup, database change,
  container change, commit, or push was made.

**Verification**

- Confirmed `deploy/bj-deploy:92-98` deliberately requires production packages to be built from a
  clean `main` worktree so the package can be tied to a reproducible commit.
- `git status --short` shows roughly 108 pending paths containing the August features, three
  migrations, deployment assistant, documentation, tests, and branding. `HEAD` remains `4e6b6bf`.
- `git diff --check` passed. Full tests were not rerun because this turn diagnosed the release gate
  and did not authorize committing or deploying the pending work.

**State left behind**

- The source remains uncommitted on `main`; nothing was staged, committed, pushed, packaged, or
  deployed. The production guard will continue to stop until the intended changes are reviewed and
  committed (or deliberately discarded/stashed).

**For the next agent**

- Do not bypass or remove the clean-tree guard. If the user wants the pending August version in
  production, validate it, commit it, push/merge it to `main`, and rerun **Safe update**. Stashing
  would package the old `4e6b6bf` version and omit the new migrations/features.

## 2026-08-07 — Deploy-readiness check; brand favicon and PWA icons replace the stock placeholders

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `4e6b6bf` (= `origin/main`), worktree dirty with 103 paths
**Trigger:** User asked whether the project is ready to deploy, asked me to verify some Supabase
commands they had run, and asked for the logo + favicon from `assets/` to be wired in and shown
running locally — explicitly **not** pushed.

**What changed**

- `app/favicon.ico` — replaced. The previous file (Jun 25, sha `2b8ad2d3…`) was the **stock
  Next.js/Vercel black-triangle favicon**; I rendered it to PNG and looked at it before
  overwriting. Now a multi-size ICO (16/32/48/64/128/256) of a BJ monogram.
- `app/apple-icon.png` — new, 180px.
- `public/icons/icon-{192,512}.png` — replaced. The previous files were **blank royal-blue
  squares** with no mark on them (verified by rendering). Now the unpadded monogram.
- `public/icons/icon-maskable-{192,512}.png` — new; same monogram inset ~10% for the Android
  maskable safe zone.
- `app/manifest.ts` — icon list now declares `purpose: 'any'` (unpadded) and `purpose: 'maskable'`
  (inset) separately. First attempt used `purpose: 'any maskable'`, which the web-app-manifest
  spec allows but Next's `MetadataRoute.Manifest` types as a single enum — `tsc` rejected it with
  TS2820. Split into four entries.
- No application logic, migration, deploy script, or route was touched.

**Icon provenance — read this before "fixing" it**

- `assets/` is **not new** (dated Jun 30) and contains **no favicon**: only `bj-logo.png` and the
  Rubik font family. The user believed they had supplied a favicon; there is no such file.
- `assets/bj-logo.png` is **byte-identical** to `public/bj-logo.png` (sha `bc5abaf9…`), which was
  already rendered by `AppShell.tsx:20` and `login/page.tsx:53`. The logo needed no work.
- The logo is a 1181×591 wordmark. Letterboxed into a square favicon it is an illegible smudge at
  16px — I rendered both candidates at 16/32/64 and showed the user the comparison. Hence the
  monogram: `#2E3C92` field, white "BJ" in Rubik Bold (`assets/Rubik/static/Rubik-Bold.ttf`).
- Generator kept at
  `/private/tmp/claude-501/-Users-amir-Workspace-bj/e412a95b-…/scratchpad/mkicons.py`. That is a
  scratch path and **will not survive**; re-derive from `public/bj-logo.png` if the icons need
  regenerating.

**Actions outside the repo**

- No client server contact, no SSH, no database write, no deploy. `https://10.10.10.50/api/health`
  is unreachable from here (no corporate VPN) — expected.
- Killed a stale orphaned `next-server` (PID 87316) left listening on port 3000 by my previous
  session; it was serving 404s because `npm run build` had replaced its dev output. Restarted
  `npm run dev` via the preview tool.
- Read-only Supabase CLI checks: `supabase projects list` (authenticated) and a local
  `docker exec … psql` count of `bj_deploy.schema_migrations`. No write.

**Verification**

- `npx tsc --noEmit` — clean (after the TS2820 fix above). `npm run lint` — clean.
- `npm run test:unit` — 40 files, 254 tests passed.
- `npm run test:deploy` — 9/9 deployment-assistant tests passed.
- `npm run build` — succeeded, 39 pages, all four request routes including
  `/[locale]/request/daily-errand`. **Note this build predates the icon changes**; `tsc` and
  `lint` were re-run after them, a full `build` was not.
- Dev server: `/favicon.ico` 200 (14685B, `image/x-icon`), `/apple-icon.png` 200,
  all four `/icons/*` 200, `/manifest.webmanifest` 200 with the four-entry icon array. Next
  emits `<link rel="icon" sizes="256x256">` and `<link rel="apple-touch-icon" sizes="180x180">`.
- **Not run: Playwright e2e.** Not run at all this session — no claim either way about it.
- Local stack: five containers up, `bj-erp-db-1` healthy, `https://192.168.2.48:3500/api/health`
  → 200, `bj_deploy.schema_migrations` holds 41 rows matching the 41 files in
  `supabase/migrations/`.

**State left behind**

- Nothing committed, staged, or pushed. `HEAD` is still `4e6b6bf` and equals `origin/main`; the
  worktree now carries ~108 uncommitted paths.
- `npm run dev` running on port 3000.

**For the next agent**

- **This repo is not deployable as it stands, and the reason is not a bug.** Roughly two weeks of
  feature work — signatures, daily errands, PTO overage, the deployment assistant, three
  migrations — exists only as uncommitted working-tree changes. `deploy/bj-deploy` refuses a
  production build from dirty or non-`main` source by design, so the first step is a reviewed
  `git diff` and a commit, not a deploy command.
- The client server is still on the pre-August schema and has never been touched by the
  assistant. Its first run must be a reviewed Safe update, per
  `docs/DEPLOY-ASSISTANT.md`.
- If the favicon is ever regenerated, keep it a monogram or another compact mark. The full
  wordmark does not survive 16px; that was measured, not assumed.

## 2026-08-06 — Safe-update migration adoption recovery and local deployment

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf`, with the uncommitted deployment-assistant and
application work described in the preceding entry
**Trigger:** The user's first local **Safe update** stopped while replaying an already-installed SQL
migration with `function "approve_leave_request" already exists`; the user supplied the full run
output and asked for the deployment failure to be handled.

**What changed**

- `deploy/lib/migrations.sh` — made first-run migration-ledger adoption resumable. The immutable
  legacy baseline still covers migrations 1–38, while missing known migrations 39–41 are now adopted
  only after each migration's complete catalog fingerprint proves its columns, constraints,
  functions, function bodies, and removal of obsolete overloads are already installed. An interrupted
  adoption can therefore resume without replaying installed DDL or trusting a single-column guess.
- `deploy/lib/migrations.sh` — corrected the fingerprint queries to read SQL from stdin without
  supplying psql's `-c` option; `-c` requires an inline command argument and caused the second safe
  update attempt to stop with `psql: option requires an argument -- 'c'` before migration or app
  cutover.
- `tests/deploy/deploy-assistant.test.sh` — added regression coverage for interrupted legacy
  adoption, complete known-migration recording, apply-once behavior, and the psql stdin/`-c`
  incompatibility.
- `docs/{MEMORY,CHANGELOG}.md` — documented the durable migration-adoption rule and the recovery fix.

**Actions outside the repo**

- No client-server SSH connection, transfer, command, database operation, or deployment was made.
- Queried only the local Docker PostgreSQL catalogs and proved that migrations 39, 40, and 41 were
  already fully installed while the new ledger initially recorded only 1–39. No business row was
  changed by that diagnosis.
- Ran `./deploy/bj-deploy update local`. Each of the three attempts made and verified a custom-format
  backup before proceeding:
  `backups/deploy-assistant/local/20260806T222756Z-b629cc/postgres.dump`,
  `20260806T223126Z-ff5aad/postgres.dump`, and
  `20260806T223235Z-1ac0af/postgres.dump`. The first two stopped safely before app cutover; the final
  run adopted ledger records 40–41, skipped all already-applied SQL, rebuilt the application natively
  for ARM64, and recreated only `bj-erp-app-1`. Database/Auth/PostgREST/Caddy containers and database
  data were preserved.

**Verification**

- `/bin/bash -n deploy/lib/migrations.sh tests/deploy/deploy-assistant.test.sh` — passed.
- `npm run test:deploy` — all deployment-assistant tests passed, including both new regressions.
- Production Docker build inside the successful Safe update — Next.js 16.2.9 compile, TypeScript,
  and all 39 generated pages passed; `/api/health` was present.
- Final local checks: `bj_deploy.schema_migrations` contains exactly 41 entries; the installed
  manifest contains 41 lines; the final three migration filenames are recorded; and
  `https://192.168.2.48:3500/api/health` returned HTTP 200 with `{"status":"ok"}`.
- Docker image inspection reported `arm64` for app, database, Auth, PostgREST, and Caddy. Compose
  reports all five services running and PostgreSQL healthy. `git diff --check` passed before the
  documentation update and is repeated at session end.

**State left behind**

- The corrected app is running locally at `https://192.168.2.48:3500`; the test database and Caddy CA
  were preserved. The three verified backups remain on the Mac.
- All source and documentation changes remain uncommitted on the already-dirty `main` worktree.
  Nothing was staged, committed, or pushed. The client server remains untouched.

**For the next agent**

- Do not replace the complete catalog fingerprints with a single sentinel column. Adoption is a
  narrow recovery path for these three known migrations; unknown missing history must still stop.
- With psql, a heredoc/stdin query must not use `-c` without an argument. Keep SQL out of argv when it
  contains values or secrets, and preserve the deployment harness regression.

## 2026-08-06 — Interactive deployment assistant implementation

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf`, with substantial pre-existing uncommitted feature,
native-ARM64 deployment, and documentation work from the preceding sessions
**Trigger:** After the design discussion, the user approved implementation of one guided program for
local ARM64 and client AMD64 restart/redeploy/update/fresh-install workflows, including resumable SSH
jobs, and required enough documentation for another agent to rebuild or recover it without any chat
context.

**What changed**

- `docs/specs/2026-08-06-interactive-deployment-assistant-design.md` and
  `docs/plans/2026-08-06-interactive-deployment-assistant.md` — complete cold-start design and
  implementation/recovery map: topology, action/data matrix, architecture and Git gates, backup and
  secret boundaries, migration contract, remote state machine, reset order, failures, acceptance
  criteria, and exact file inventory.
- `deploy/bj-deploy` — new macOS-Bash-3.2-compatible interactive/CLI entry point. Implements local
  and client doctor/status/logs, restart, manifest-gated app-only rebuild, safe update, database
  reset, factory reset, dry-run, and `resume <run-id>`. Client defaults are SSH alias `bj` backed by
  `behsazan@5.201.190.184:2222`, remote directory
  `/home/behsazan/bj-erp-installer`, and app `https://10.10.10.50:3500`.
- `deploy/remote-job.sh` — server-side detached worker with atomic status/log files, a global `flock`,
  idempotent run IDs, independent backup phase, Mac-checksum authorization gate, restart/app/update/
  reset workers, protected reset-password handoff, and reconnect states including `BACKUP_READY`,
  `BACKUP_VERIFIED`, `RESET_READY`, `RUNNING`, `SUCCEEDED`, and `FAILED:<code>`.
- `deploy/lib/{common,migrations,health}.sh` — shared target-safe Compose wrapper, validation/hashing/
  atomic-env helpers, password-safe container execution, immutable private migration ledger, known
  legacy-baseline adoption, source manifest generation, stable app/Auth/DB health checks, and running
  image architecture verification.
- `deploy/docker-compose.client-amd64.yml` — dedicated pinned `*-client-amd64` service tags and
  explicit AMD64 platforms. Integrated the preceding session's untracked local ARM64 overlay and
  preparation script; local and production paths now always supply their correct overlays.
- `deploy/install.sh`, `update.sh`, `package.sh`, and SQL/key helpers — use the target wrapper,
  pending-only migrations, `/api/health`, force-recreated app cutover, reliable admin creation after
  a DB wipe, password files/environment names instead of secrets in argv, dedicated AMD64 bundle
  tags, SHA-256 sidecars, macOS metadata-free tar creation, and inclusion of the controller/worker/
  libraries in the offline installer.
- `app/api/health/route.ts` — public no-store liveness contract returning `{status:"ok"}` outside the
  locale/session proxy. This replaces the broken assumption that `/` must return 200; Next normally
  redirects the root with 307.
- `tests/deploy/deploy-assistant.test.sh` and `npm run test:deploy` — Bash fixture coverage for
  architecture/identifier rejection, atomic `.env` edits and permissions, sorted migration hashes,
  apply-once/changed-history ledger behavior, remote run-ID idempotence, and health contract.
- `docs/DEPLOY-ASSISTANT.md` — simple operator guide covering one-time SSH setup, every action/data
  effect, local phone access, production packaging, reset guards, resume, backup privacy, migrations,
  network behavior, overrides, troubleshooting, and verification. Added pointers from the older
  runbooks and updated `MEMORY`, `TASKS`, and `CHANGELOG`.
- `deploy/setup-release.sh` and `release.sh` — corrected the outdated laptop-VPN requirement. The
  Mac uses public SSH directly; only phone/browser access to the private app route uses VPN.

**Actions outside the repo**

- No SSH connection, rsync transfer, command, file change, Docker operation, database operation, or
  health request was made against the client's server. No client VPN was used.
- Ran read-only local Docker inspection with approved access. Docker daemon reported `aarch64`; both
  local/client Compose overlay combinations rendered; the five currently running local images are
  all `linux/arm64`/`linux/arm64/v8`. No local container was restarted/recreated and no volume was
  modified.
- Ran one read-only query through the existing local PostgreSQL 15 container to prove psql
  `\getenv` and safely quoted `:'variable'` work with an inherited environment-variable name. It
  returned only the harmless literal `safe_value`; no SQL write ran and no secret was printed.
- Consulted current Docker Compose documentation through Context7 (multiple `-f` overlays,
  recreation, `--wait`, project/volume behavior), current PostgreSQL psql documentation for
  `\getenv`, current Supabase self-host/restore documentation, and current Supabase breaking-change
  notices. The PG15→PG17 and gateway transitions reinforce that ordinary releases must keep this
  project's tested infrastructure versions pinned.

**Verification**

- `npm run test:deploy` — passed all deployment fixture checks; also passed explicitly under the
  Mac's `/bin/bash` 3.2.57.
- `bash -n` under Bash 3.2 — clean for the controller, worker, install/update/package/release/setup,
  ARM64 preparation, all three libraries, and the deployment test harness.
- Both target Compose configurations rendered with `config --quiet`; read-only image inspection
  verified every existing local service is native ARM64.
- `npm run lint` — passed. `npm run test:unit` — 40 files / 254 tests passed.
- `npm run build` — first attempt hit the known sandbox-only Turbopack worker-port denial; approved
  retry outside the sandbox passed compile, TypeScript, 39 static pages, and emitted `/api/health`.
- Dummy-secret key-generation contract passed without putting the secret in argv. PostgreSQL 15
  environment-variable/quoting contract passed read-only. `git diff --check` passed.
- ShellCheck was not installed, so it could not be run. The complete AMD64 multi-GB offline package,
  destructive local reset, and any production SSH execution were deliberately not run during
  implementation; the production command itself retains architecture/checksum/test gates.

**State left behind**

- Implementation and documentation are complete but remain uncommitted on the already-dirty `main`
  worktree. Nothing was staged, committed, pushed, deployed, or migrated by this session.
- The existing local stack remains running exactly as found on native ARM64 images and its existing
  database/volumes. Its current app image predates the new `/api/health`; the endpoint becomes active
  after the user chooses a local app/update deployment.
- The client server remains untouched. Its first assistant-driven operation should be a reviewed
  Safe update or Fresh database only after all intended source changes are committed on clean
  `main`. App only intentionally refuses until an installed migration manifest exists.

**For the next agent**

- Start with `docs/DEPLOY-ASSISTANT.md`, then the dated design and plan. Do not infer missing behavior
  from this chat; those three files contain the complete contract and recovery sequence.
- Preserve all pre-existing feature changes in this dirty worktree. Do not test a destructive action
  against the local or client project without fresh explicit authorization.
- Before the first live client run, review `git diff`, commit the intended source on `main`, run
  `./deploy/setup-release.sh`, then `./deploy/bj-deploy doctor client`. The assistant will refuse a
  production build from dirty/non-main source.
- A first client Safe update adopts the verified 38-migration legacy baseline and applies the three
  current August migrations. A first local Safe update detects those already-applied columns and
  records them without replaying non-idempotent history.
- If SSH drops, use the printed `./deploy/bj-deploy resume <run-id>`. Never manually start a second
  job or bypass `BACKUP_VERIFIED`; inspect `status`/`logs` and the run manifest first.

## 2026-08-06 — Clarify direct-SSH deployment without a laptop VPN

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the preceding sessions' uncommitted feature,
deployment-design, native-ARM64, and documentation work
**Trigger:** The user clarified that the Mac can reach the client's public SSH endpoint directly,
while only the phone uses VPN to reach the private application URL, and asked whether the proposed
tool will also execute installation remotely rather than merely upload an archive.

**What changed**
- `docs/AGENT-LOG.md` only — recorded the clarified deployment connectivity model. No script,
  configuration, application code, migration, or running environment was changed.

**Actions outside the repo**
- None. No SSH connection, file transfer, client-server command, Docker command, or database action
  was run.

**Verification**
- Re-read `deploy/setup-release.sh` and `deploy/release.sh`. The existing routine-release pipeline
  already uploads with rsync and then uses `ssh -t` to execute `sudo update.sh` remotely, so the
  interactive deployment assistant can extend the same pattern to full installation and resets.
- Confirmed the VPN wording in both scripts is an outdated assumption for this user's topology. The
  deployment prerequisite should be successful direct SSH to `5.201.190.184:2222`, not a VPN.
- Confirmed the app's `10.10.10.50:3500` address and the public SSH endpoint are separate network
  paths. Because the Mac cannot reach the private app address, post-deploy HTTP/Auth checks should
  run on the client server over SSH and return their results to the Mac; the phone VPN remains only
  for the final human browser test.
- Consulted current OpenSSH documentation for remote command execution, forced TTY allocation, and
  authenticated file transfer. No tests were run because this was a design clarification only.

**State left behind**
- The intended tool remains design-only. It will perform upload plus remote execution in one Mac-side
  command; the user will not need to open a separate SSH session.
- This journal entry remains uncommitted with the existing changes on `main`; nothing was staged,
  committed, or pushed.

**For the next agent**
- Remove the VPN prerequisite/messages from the future Mac-side deployment flow and replace them
  with direct SSH preflight. Do not change the app URL: employees/testers still reach
  `https://10.10.10.50:3500` through the client's LAN/VPN.
- Use SSH key authentication or a multiplexed authenticated connection for transfers, allocate a TTY
  for sudo/admin-password prompts, never pass passwords in command arguments, and execute remote
  health checks from the server before reporting success.

## 2026-08-06 — Interactive deployment assistant design review

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the preceding sessions' uncommitted feature,
native-ARM64 deployment, local-runbook, and documentation work
**Trigger:** The user proposed replacing manual terminal-command sequences with one interactive
script covering local ARM64 and client AMD64 restarts, app redeploys, database-preserving updates,
offline SSH delivery, and destructive fresh installations, and requested brainstorming before code.

**What changed**
- `docs/AGENT-LOG.md` only — recorded this design-only review. No deployment script, Compose file,
  application source, migration, or operator documentation was implemented or modified.

**Actions outside the repo**
- None. No Docker container, image, volume, database, SSH configuration, client server, or remote
  file was touched.

**Verification**
- Read the existing deployment implementation and active design records: `deploy/install.sh`,
  `package.sh`, `prepare-local-arm64.sh`, `release.sh`, `setup-release.sh`, `update.sh`, all Compose
  variants, `docs/LOCAL_REDEPLOY.md`, and the 2026-07-25/26 deployment plans.
- Confirmed most low-level building blocks already exist: interactive offline install, AMD64 package
  creation, resumable SSH/rsync release delivery, verified pre-update backup, app rollback, and
  dedicated native ARM64 tags/Compose overlay.
- Identified design blockers to fix before adding a menu: `update.sh` expects exactly HTTP 200 from
  `/` without following the app's normal redirect; wiping only the DB volume while retaining `.env`
  makes `install.sh` reuse configuration and skip the first-admin prompt; every update currently
  replays every migration rather than using an immutable migration ledger; and AMD64 packaging uses
  canonical service tags, so a forgotten local overlay can reintroduce emulation on Apple Silicon.
- Checked current Docker Compose documentation for multiple-file overlays, `--wait`, and targeted
  recreation, plus current Supabase self-hosting/update guidance and breaking-change notices. The
  upstream PG15-to-PG17 and Kong-to-Envoy changes reinforce keeping this project's service versions
  pinned and treating infrastructure upgrades as a separate reviewed operation.
- No tests were run because the user explicitly requested design discussion before implementation.

**State left behind**
- Brainstorm/design only; no deployment assistant exists yet and no workflow was executed.
- This journal entry remains uncommitted with the existing work on `main`; nothing was staged,
  committed, or pushed.

**For the next agent**
- If the user approves the design, write a reviewed spec/plan before implementation. Prefer one
  interactive Mac-side entry point that dispatches to small local/remote operations, with both menu
  and non-interactive subcommands, rather than one monolithic destructive script.
- Preserve these proposed safety defaults: detect and verify architecture instead of trusting a
  menu choice; clean `main` for client releases; dry-run/doctor first; verified off-machine backup
  before any wipe; versioned/checksummed staging; explicit typed destructive confirmation; exact
  compose project/volume validation; no secrets in arguments/logs; and a distinct factory reset from
  a database reset that preserves the Caddy CA.
- Before wrapping the existing scripts, repair the health-check contract and fresh-admin path, then
  add deployment manifests/migration checksums so an app-only choice can be proven safe rather than
  guessed from filenames.

## 2026-08-05 — Daily work errands and paid-leave overage

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the preceding sessions' uncommitted FR-32,
signed-approval, Persian-only-calendar, and native-ARM64 deployment work
**Trigger:** Add a separate daily work-errand form, rename the existing errand tab to Hourly Work
Errand, and show/project paid leave with any excess recorded as unpaid using 8 hours per day.

**What changed**
- `app/[locale]/(app)/request/daily-errand/{page.tsx,DailyErrandRequestForm.tsx}` and
  `RequestTypeTabs.tsx` — added the fourth signed daily-errand form with Persian Start/End dates,
  required location, optional description, localized four-tab navigation, and a mobile-scrollable
  tab row; renamed the existing errand tab to Hourly Work Errand.
- `lib/leave/dailyErrand.ts`, `lib/actions/leave.ts`, `messages/{en,fa}.json`, request pages, and
  request lists — wired the daily-errand RPC and labels through the UI and show stored unpaid time on
  pending/approved requests.
- `lib/leave/duration.ts`, daily/hourly leave forms, and unit tests — added exact minute-based
  projections for Requesting, non-negative Remaining Balance, and conditional Unpaid Time Off.
- `supabase/migrations/20260806014310_daily_work_errands_pto_overage.sql` — added constrained
  `unpaid_minutes`, daily errand shape/counting/submission, authoritative paid/unpaid splitting on
  signed approval, paid-only ledger consumption, and paid-only cancellation reversal. Public RPCs
  remain authenticated-only SECURITY DEFINER functions with empty search paths.
- `tests/e2e/{_helpers.ts,errand.spec.ts,leave.spec.ts}` and unit tests — cover daily errand signed
  submission/approval and the exact 4-days-versus-3-days-4-hours overage flow.
- Requirements, data model, permissions, tasks, changelog, design, and implementation plan —
  documented FR-13/FR-33 and the preserved-data local rollout.

**Actions outside the repo**
- Backed up the preserved local database to
  `/private/tmp/bj-pre-daily-errand-pto-20260805/postgres.dump` (368302 bytes) before migration.
- A first rollback dry run as `postgres` stopped before DDL because that role did not own
  `leave_requests`; a second passwordless `supabase_admin` attempt failed authentication. Using the
  database container's configured `supabase_admin` password, the entire migration then parsed inside
  `BEGIN`/`ROLLBACK`, after which it was applied once successfully.
- Built `bj-erp-app:local-arm64` with
  `docker build --platform linux/arm64 -f deploy/Dockerfile ...` and recreated only the app using
  `deploy/docker-compose.yml` plus `deploy/docker-compose.local-arm64.yml`, `--no-deps`, and
  `--pull never`. Database container ID
  `e48c7930e3038510a10a7c83b26a6070b56721bb7cb0dc05ff0cf1949b029a07` did not change. The
  `bj-erp_db-data` volume was neither removed nor recreated. No production/client command ran.
- The in-app browser could not pass local Caddy's private certificate
  (`ERR_CERT_AUTHORITY_INVALID`), so UI verification used the project's explicitly local Playwright
  configuration with `ignoreHTTPSErrors`; the in-app browser session was then finalized.

**Verification**
- `jq empty messages/en.json messages/fa.json`, `npm run lint -- --max-warnings=0`, and
  `npx tsc --noEmit` — passed.
- `npm run test:unit` — 40 files / 254 tests passed. An earlier attempt with Vitest's unsupported
  `--runInBand` flag failed at option parsing; no test ran in that attempt.
- `npm run build` — passed after rerunning outside the filesystem sandbox because Turbopack's worker
  port was denied there; the output includes `/[locale]/request/daily-errand`.
- Focused native-stack e2e (`errand.spec.ts` + `leave.spec.ts`, one worker) — 3 passed in 23s,
  including signed daily-errand approval and an over-balance signed approval with unpaid remainder;
  cleanup removed all five throwaway users. A second mobile leave run passed in 8.9s and removed its
  one throwaway user.
- Read-only browser checks on both request routes found the correct headings/tabs, no framework
  overlay, and no console issues. Visual captures:
  `/private/tmp/bj-daily-errand-desktop.png` and `/private/tmp/bj-pto-overage-mobile.png`.
- Pre-migration business counts were profiles 5, roles 6, requests 3, ledger 10, holidays 0,
  departments 5, leave types 3, companies 1; migration checks confirmed the new column,
  constraints, function security/ACL, and no count changes. The final post-e2e audit returned those
  same counts, all five running images inspected as `linux/arm64` (`/v8` where reported), the
  preserved volume creation time remained `2026-08-04T19:54:09Z`, and the daily-errand route
  returned HTTP 200 through the local gateway.

**State left behind**
- Work remains uncommitted on `main` together with the preceding sessions' changes.
- The local stack is running with native ARM64 service images and the original `bj-erp_db-data`
  volume. Migration `20260806014310` is applied locally. The client's AMD64 production environment
  was not contacted and does not have this migration.

**For the next agent**
- Always use both Compose files for local commands. Do not run `down -v`, delete
  `bj-erp_db-data`, or use the AMD64 production packaging path for Apple-Silicon testing.
- Production deployment is a separate AMD64 operation and must include the new migration; it was
  deliberately not attempted here.

## 2026-08-05 — Signed approvals, Persian-only dates, and native ARM64 local Docker separation

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the preceding sessions' uncommitted FR-32 and
local-redeploy work
**Trigger:** Require manager/admin signatures on approval, remove Gregorian calendars everywhere,
then correct the local Docker deployment so Apple Silicon runs no AMD64-emulated service while
preserving the existing database.

**What changed**
- `supabase/migrations/20260805185628_approval_signatures_persian_only.sql` — added nullable
  historical approver-signature evidence, replaced the unsigned approval RPC with a signed
  three-argument RPC, kept decision/ledger/audit/evidence atomic, normalized profile calendar
  preferences to `jalali`, and constrained future values to Jalali.
- `lib/actions/leave.ts`, generated Supabase types, request signature components, approvals queue,
  and calendar — approval now requires a fresh mouse/touch signature plus explicit authorization;
  rejection remains unsigned; authorized viewers fetch requester and approver images lazily.
- Profile settings and all request, employee, holiday, allocation, home, approval, and calendar
  surfaces — removed the Gregorian selector/branching and use Persian pickers/display formatting.
  Stored database dates remain ISO Gregorian at the persistence boundary.
- `deploy/docker-compose.local-arm64.yml` — new Apple-Silicon-only overlay with dedicated local
  image tags and explicit `platform: linux/arm64` for Postgres, GoTrue, PostgREST, app, and Caddy.
- `deploy/prepare-local-arm64.sh` — pulls the ARM64 manifests of the existing pinned service
  versions, builds `bj-erp-app:local-arm64`, verifies every image architecture, and deliberately
  does not touch containers or volumes.
- `docs/LOCAL_REDEPLOY.md`, `docs/MEMORY.md`, `docs/CHANGELOG.md`, `docs/TASKS.md`, requirements,
  data model, permissions, and the new approval-signature design/plan — documented the signed
  approval/Persian-only contract and separated ARM64 local commands from AMD64 client releases.
- `playwright.config.ts` and e2e helpers — external local-stack URL support, private-CA handling in
  the isolated test process, ARM-local cleanup routing, Persian allocation pickers, and reliable
  below-the-fold signature drawing.

**Actions outside the repo**
- Initially rebuilt/recreated the app and applied the new migration while the four previously
  loaded service images were still AMD64. The user correctly stopped further testing and required
  native ARM64 for all local services. No production/client server action was taken.
- Audited Docker Desktop (`aarch64`) and all running images. Before correction: app was ARM64;
  Postgres, GoTrue, PostgREST, and Caddy were AMD64. Docker manifests confirmed every pinned tag
  publishes an ARM64 variant.
- Applied only `20260805185628_approval_signatures_persian_only.sql` after a verified backup at
  `/private/tmp/bj-pre-approval-signatures.pCTmtl/postgres.dump`; reloaded PostgREST and verified
  the signed function, grants, constraint, columns, calendar normalization, and unchanged counts.
- Before the architecture cutover, created and validated a fresh 365,625-byte backup at
  `/private/tmp/bj-pre-arm64-switch.KjmAs5/postgres.dump`. Recorded `bj-erp_db-data` creation time
  `2026-08-04T19:54:09Z` and all business counts.
- Prepared dedicated ARM64 images, then ran Compose with the base + ARM64 overlay and `--pull never
  --force-recreate`. This recreated containers only. No `down -v`, `volume rm`, database restore,
  or client-server command was run.

**Verification**
- `npx tsc --noEmit`: passed. `npm run lint -- --max-warnings=0`: passed.
- `npm run test:unit`: 39 files / 248 tests passed.
- `npm run build`: passed outside the sandbox after the first attempt hit a sandbox-only Turbopack
  worker-port denial. The ARM64 Docker build also completed successfully.
- External-stack Playwright: approval flow passed end-to-end (requester evidence, signed manager
  approval, separate approver viewer, rejection without approver evidence, balance debit); settings
  flow passed (no Gregorian option, language switch). Six throwaway accounts were cleaned. A final
  calendar-only run was interrupted by the user before execution completed; no test process or
  throwaway account remained.
- Current `docker compose ... images`: all five services are `linux/arm64` or `linux/arm64/v8`.
  PostgREST logs its database connection as `aarch64-unknown-linux-gnu`.
- The DB container mounts the same `bj-erp_db-data` volume with the same creation timestamp and
  mountpoint. Counts before/after are identical: profiles 3, roles 4, requests 3, ledger 5,
  holidays 0, departments 5, leave types 3, companies 1. All four requester/approver signature
  columns remain present.
- `https://192.168.2.48:3500/en/login` returned 200 and `/auth/v1/health` returned 200 after the
  native Caddy cutover. App/Auth/PostgREST logs show normal startup and schema loading.

**State left behind**
- Local stack is running entirely on native ARM64 images via the dedicated local overlay, against
  the preserved database volume and current signed-approval schema.
- Production remains explicitly AMD64 through the unchanged `deploy/package.sh` and
  `deploy/release.sh`; neither the client server nor its data was contacted.
- Work remains uncommitted on `main`, alongside the earlier uncommitted UI/FR-32 work. The user's
  existing untracked `deploy/docker-compose.local.yml` was preserved; new instructions use
  `deploy/docker-compose.local-arm64.yml` instead.

**For the next agent**
- For local Docker commands on this Mac, always combine `deploy/docker-compose.yml` with
  `deploy/docker-compose.local-arm64.yml`. Never use production canonical image tags locally.
- Running `package.sh` intentionally loads AMD64 canonical tags on the Mac, but the dedicated
  `*-local-arm64` tags remain isolated. Re-run `prepare-local-arm64.sh` only if those local tags
  were pruned.
- Never use `docker compose down -v`, remove `bj-erp_db-data`, or replay all historical migrations
  against this populated database.

## 2026-08-05 — Verify LAN-IP deployment despite macOS curl TLS failure

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the preceding sessions' uncommitted FR-32,
redeploy-documentation, and diagnostic journal changes
**Trigger:** After recreating the local stack for `192.168.2.48`, the user reported that the Step 2
curl check returned `app: 000` instead of 200.

**What changed**
- `docs/AGENT-LOG.md` only — recorded the read-only runtime diagnosis. No source, `.env`, Compose,
  certificate, container, volume, or database setting was changed.

**Actions outside the repo**
- Inspected `docker compose ps --all` and current logs after the user's full force-recreation. All
  five services are up, Postgres is healthy, Caddy publishes `0.0.0.0:3500->443`, the app reports
  ready, and Caddy successfully issued an internal certificate for `192.168.2.48`.
- Confirmed the Mac has a listener on TCP 3500. The system curl connects but fails during TLS with
  LibreSSL `CRYPTO_internal:bad decrypt`, producing curl exit 35 / HTTP code 000.
- Tested TLS 1.2 and 1.3 independently with OpenSSL; both handshakes succeeded. Sent an HTTP/1.1
  request through the successful TLS connection and received the expected 307 redirect to
  `/fa/login` with the correct IP-based CSP and alternate links.
- Repeated the complete request with Node's TLS verification disabled for this one diagnostic; it
  followed the redirect and printed `app: 200`.

**Verification**
- `.env` contains the intended values: `APP_HOST=192.168.2.48`, `APP_PORT=3500`, and
  `APP_ORIGIN=https://192.168.2.48:3500`.
- Caddy's certificate store now contains both the old `localhost` leaf and a new
  `192.168.2.48` leaf; Caddy logged `certificate obtained successfully` for the IP.
- The endpoint is reachable and the app returns 200. The failed curl result is specific to the
  Mac's LibreSSL curl path, not an application or container readiness failure.
- The recreate output also truthfully reports that the current `db`, `rest`, `auth`, and `gateway`
  images are `linux/amd64` on the `linux/arm64/v8` Mac. That warning did not stop the services, but
  native-image cleanup remains separate work if the user's no-emulation goal still applies.

**State left behind**
- The IP-configured local stack remains running and ready for phone certificate installation/testing.
- No runtime mutation was made during diagnosis. This journal entry remains uncommitted with the
  existing work on `main`; nothing was staged, committed, or pushed.

**For the next agent**
- Do not treat curl `000` as a failed app in this exact state; inspect curl's error text. Node and
  OpenSSL independently proved the gateway and app work.
- The phone must install and fully trust Caddy's exported root CA before Safari/Chrome will accept
  the IP certificate. If the phone then times out rather than showing a certificate error, check
  Wi-Fi client isolation, VPN, and macOS firewall.
- If eliminating emulation is still required, replace/re-pull the four AMD64 service images for
  arm64 and verify each image's architecture before recreating; do not conflate that with this
  already-proven endpoint response.

## 2026-08-05 — Diagnose local phone access over the Mac LAN address

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the uncommitted FR-32 implementation and local
redeploy documentation from the preceding sessions
**Trigger:** The user can open the Docker deployment at `https://localhost:3500` on the Mac but
cannot open it from a phone at the Mac's `192.168.2.48` address.

**What changed**
- `docs/AGENT-LOG.md` only — recorded the read-only network/configuration diagnosis required by the
  project working agreement. No application or deployment configuration was changed.

**Actions outside the repo**
- Inspected the local Docker stack. The gateway publishes `0.0.0.0:3500->443/tcp` and
  `[::]:3500->443/tcp`, so Docker is already listening on all Mac interfaces rather than only on
  loopback.
- Tested both `https://localhost:3500/` and `https://192.168.2.48:3500/` from the Mac with TLS
  verification deliberately disabled; both followed redirects to HTTP 200.
- Inspected the certificate served without SNI, matching the raw-IP browser path. Its only subject
  alternative name is `DNS:localhost`. A first probe that explicitly sent the IP as SNI returned no
  certificate; it made no change.
- Consulted current Docker Compose and Supabase self-hosting documentation. Both confirm that public
  URL environment changes require container recreation, not a plain restart.

**Verification**
- `deploy/.env` currently has `APP_HOST=localhost`, `APP_PORT=3500`, and
  `APP_ORIGIN=https://localhost:3500`, proving the browser bundle, Auth service, and TLS site are
  configured for the Mac-only name.
- `docker compose ps` reported all five services up and the database healthy.
- `curl -skL` returned final HTTP 200 through both hostnames from the Mac; the remaining phone-side
  requirements are a matching IP certificate/public URL, trust of the local root CA, and an
  unisolated shared Wi-Fi path.
- `ipconfig getifaddr en0` failed in the restricted process with
  `ipconfig_server_port failed (os/kern) unknown error code (44c)`; the provided IP was independently
  usable in the successful curl and TLS probes.

**State left behind**
- Running containers, volumes, database, `.env`, and certificate are unchanged. The app remains
  configured for `localhost` until the user applies the supplied phone-testing steps.
- This journal entry joins the already-uncommitted work on `main`; nothing was staged, committed, or
  pushed in this session.

**For the next agent**
- For phone testing, change all three public settings together to the LAN IP and port, recreate the
  stack so the app/Auth/Caddy receive them, export Caddy's root CA, and install/trust it on the phone.
  Do not run `docker compose down --volumes`; no data wipe is needed.
- If the Mac still returns 200 through the LAN IP but the phone cannot connect after those changes,
  check same/guest Wi-Fi client isolation, VPNs, and the macOS firewall before changing Docker.

## 2026-08-05 — Repair local signature schema and document data-preserving redeploys

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the uncommitted FR-32 implementation from the
preceding session
**Trigger:** After the schema-mismatch diagnosis, the user authorized the local fix and requested a
plain-English local app/database redeploy guide that preserves the existing database.

**What changed**
- `supabase/migrations/20260805171924_request_signatures.sql` — added an explicit
  `NOTIFY pgrst, 'reload schema'` after the column/RPC DDL so self-hosted PostgREST discovers the new
  RPC signatures without waiting for another lifecycle event.
- `docs/LOCAL_REDEPLOY.md` — added the complete developer-machine procedure: preflight, row-count
  snapshot, private `pg_dump`, archive validation, rollback image tag, Docker build, one-by-one new
  migration application over stdin, PostgREST reload, app-only recreation, health/schema/data checks,
  browser smoke test, frontend-only shortcut, and safe failure handling. Every executable step states
  its expected result and the guide explicitly forbids volume-deleting commands and bulk historical
  migration replay.
- `docs/DEPLOY.md` — linked the new local redeploy runbook from the self-host deployment section.

**Actions outside the repo**
- Created and validated the pre-migration custom-format database archive
  `/private/tmp/bj-pre-request-signatures.b08VQq` (318,209 bytes, 620 archive entries; PostgreSQL 15.8).
- Recorded pre-migration data counts: `profiles=3`, `user_roles=4`, `leave_requests=1`,
  `leave_ledger=5`, `holidays=0`, `departments=5`, `leave_types=3`, `companies=1`.
- Applied only `supabase/migrations/20260805171924_request_signatures.sql` to the persistent local
  `postgres` database with `psql -v ON_ERROR_STOP=1`. It completed with `ALTER TABLE`, `COMMENT`,
  `CREATE FUNCTION`, `DROP FUNCTION`, `REVOKE`, `GRANT`, and `NOTIFY` operation tags and no error.
- PostgREST received the notification and logged `Schema cache loaded` with 27 functions. No Docker
  service or volume was stopped, deleted, or recreated; the user's already-rebuilt app container
  remained running.
- Two initial read-only row-count commands failed before execution due shell/SQL quoting errors
  (`syntax error at or near "chr"`, then `trailing junk after numeric literal`). The corrected query
  succeeded. These failed attempts made no database change.

**Verification**
- Post-migration information-schema query returned nullable `signature_data text` and nullable
  `signature_consent_at timestamp with time zone`.
- Function-catalog query returned exactly the new argument lists for `submit_leave_request`,
  `submit_hourly_leave_request`, and `submit_errand_request`; `authenticated` has execute permission
  and `anon` does not for all three.
- Every post-migration business-table count exactly matched the pre-migration snapshot above.
- Local gateway checks: `/en/login` returned HTTP 200, `/en/request` returned the expected anonymous
  redirect HTTP 307, and `/auth/v1/health` returned GoTrue v2.170.0 health JSON.
- `npm run test:unit` — 39 files, 247 tests passed.
- `git diff --check` — clean before this journal entry; final whitespace check repeated afterward.
- No business request was submitted during verification, so the user can retry the failed request
  without a second test request affecting balances or approval queues.

**State left behind**
- The local stack is running the user's new app image against the now-current signature schema and
  refreshed PostgREST cache. Existing data and container ages are preserved; the verified backup is
  retained in `/private/tmp`.
- All FR-32 source changes, the new runbook, and this journal update remain uncommitted on `main`.

**For the next agent**
- Ask the user to retry the signed request. If it still fails, inspect only logs newer than the retry;
  the earlier missing-column/PGRST202 entries describe the now-fixed pre-migration state.
- Do not replay all historical migrations on this populated local database. Follow
  `docs/LOCAL_REDEPLOY.md` and apply only migrations not yet deployed, oldest first.

## 2026-08-05 — Local Docker request submission diagnosis

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the uncommitted FR-32 implementation from the
preceding session
**Trigger:** The user redeployed the local Docker app and reported the generic error when submitting
a signed daily leave request.

**What changed**
- `docs/AGENT-LOG.md` only — recorded this diagnosis. No application, migration, or deployment code
  was changed because the user reported the failure but did not yet authorize changing the running
  database.

**Actions outside the repo**
- Read local `docker compose` service status and the last ten minutes of `app`, `rest`, and `db` logs.
  The app container is the new image (created four minutes before inspection), while database/Auth/
  PostgREST containers and the persistent volume are 22 hours old.
- Logs prove the mismatch: `column leave_requests.signature_consent_at does not exist` and PostgREST
  `Could not find the function public.submit_leave_request(... p_signature_authorized,
  p_signature_data ...) in the schema cache`.
- Confirmed `deploy/migrations/` does not contain
  `20260805171924_request_signatures.sql`; the source migration exists only under
  `supabase/migrations/`. Recreating only `app` therefore updated frontend/server code but could not
  update the persistent database schema.
- Consulted current Supabase/PostgREST troubleshooting docs: after applying function/column DDL, use
  `NOTIFY pgrst, 'reload schema'` when an explicit schema-cache refresh is needed.

**Verification**
- Diagnosis is backed by both Next server logs and the exact failed SQL statements in Postgres logs.
- No test submission or write query was run. No migration was applied and no container was restarted.
- Unrelated existing log noise remains: the DB health probe connects without `-d postgres`, causing
  repeated harmless `database "supabase_admin" does not exist` FATAL entries while Compose still
  reports the database healthy.

**State left behind**
- Running local stack unchanged. Leave submission will continue failing until the FR-32 migration is
  applied to the persistent database and PostgREST sees the new schema.

**For the next agent**
- With user authorization, take/verify a backup, apply only
  `supabase/migrations/20260805171924_request_signatures.sql` to the local `postgres` database, reload
  PostgREST's schema cache, verify both columns and all three new RPC signatures, then submit a test
  request. Do not replay every historical migration against this populated database.

## 2026-08-05 — Separate daily dates and permanent requester signatures

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` (clean tree)
**Trigger:** The client asked for separate Start/End fields on daily leave and a required fresh
mouse/touch signature plus explicit digital-signature authorization on every request.

**What changed**
- `docs/specs/2026-08-05-request-signatures-and-daily-date-fields-design.md` and matching plan —
  froze the clarified scope: daily only gets two dates; daily/hourly/errand all require fresh ink and
  consent; this is requester evidence, not the deferred four-party paper workflow.
- `app/[locale]/(app)/request/LeaveRequestForm.tsx` — replaced the range picker with separate
  preference-aware start/end pickers, constrained End by Start, retained Gregorian conversion at the
  UI boundary, and preserved preview/balance/replacement behavior.
- `request/_components/RequestSignature.tsx`, `lib/leave/{signature,signatureLabels}.ts`, all three
  request forms/pages, and `messages/{en,fa}.json` — added one pointer-event canvas for mouse, stylus,
  and touch, Clear, a required localized authorization checkbox, reset behavior, bounded PNG
  validation, and a lazy protected viewer.
- `supabase/migrations/20260805171924_request_signatures.sql`, `lib/actions/leave.ts`, generated DB
  types, and DB-error mappings — added nullable historical signature/consent columns, a shape CHECK,
  database-generated `now()` consent, and mandatory signature parameters on all three public request
  writers. Signature attachment and request insertion are one transaction; no unsigned overload
  remains exposed.
- Requester history, the direct-manager approval queue, and manager/security/admin calendar surfaces
  now carry only consent metadata and fetch the PNG on explicit open. Existing strict base-row RLS is
  the read boundary; `team_leave_calendar` remains an explicit signature-free view.
- `tests/unit/request-signature.test.tsx` and existing e2e flows — covered validation, pointer capture,
  lazy image loading, two-vs-one date fields, SQL enforcement, mouse drawing/consent, authorized
  viewers, and the teammate metadata/image absence assertion.
- Updated `docs/{REQUIREMENTS,DATA_MODEL,PERMISSIONS,TASKS,CHANGELOG}.md` for FR-32 and corrected the
  stale permissions summary that still described the pre-FR-25 broad base-row read policy.
- Required current-doc checks were done through Context7 for `react-multi-date-picker` controlled
  fields and `minDate`, and through the Supabase documentation search for RLS/schema decisions.

**Actions outside the repo**
- None. No client server, database, deployment, Docker service, or external record was changed.
- `supabase status` was retried with the required permission after its sandboxed telemetry write
  failed; it reported `No such container: supabase_db_bj`, so the migration was not applied anywhere.
- A temporary local Next dev server was started for browser verification and stopped afterward.
  The authenticated `https://localhost:3500` tab was the older Docker image, while the changed
  `http://localhost:3000` build had no valid session and its configured backend
  `192.168.2.48:8080` returned `ECONNREFUSED`. No form was submitted and no test data was written.

**Verification**
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npm run test:unit` — **39 files, 247 tests passed** (new signature suite: 5/5).
- `npm run build` — sandboxed run failed at Turbopack CSS processing because internal port binding
  was denied; approved retry outside the sandbox compiled successfully, ran TypeScript, and generated
  all 36 static pages.
- `git diff --check` — clean. English/Farsi message parity — **402 keys each, no missing keys**.
- In-app/Chrome browser verification — browser connection and route rendering worked, but the changed
  authenticated pages were blocked by the split old-container/new-dev environment described above.
  The target e2e flows were updated but not run against a database because the configured endpoint is
  unavailable. A first message-parity shell one-liner also failed because zsh expanded a JavaScript
  template literal; the quote-safe retry produced the clean 402/402 result above.

**State left behind**
- Uncommitted changes on `main`; nothing staged, committed, pushed, deployed, or migrated.
- Feature code, migration, types, tests, translations, and docs are complete. Authenticated rendered
  behavior and live SQL execution still need a reachable up-to-date local/client stack.

**For the next agent**
- Apply `20260805171924_request_signatures.sql` before deploying the matching frontend; otherwise the
  new RPC argument contracts will not exist. Then run the updated e2e suite serially and exercise one
  mouse and one real touch signature. Do not add signature columns to `team_leave_calendar`.

## 2026-08-04 — Header refresh, Home cancellation, replacement picker, and hire calendar

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `94ee09e` (tree already had the earlier orientation entry in
`docs/AGENT-LOG.md` plus untracked `deploy/bj-root-ca.crt`, `deploy/migrations/`, and
`deploy/sql/seed.sql`; the deployment files are not mine and were not touched)
**Trigger:** The user requested four UI/UX changes: one header-level Updated control, cancellation
from Home recent requests, a simpler replacement selector, and a preference-aware Persian-default
hire-date calendar.

**What changed**
- `app/[locale]/(app)/_components/{AppShell,PageHeader}.tsx` — moved the refresh control into the
  shared sticky header and used explicit LTR/RTL direction so its physical position relative to the
  profile button matches the language. Page headers now render only title/action content.
- `app/[locale]/(app)/request/_components/RequestCancelButton.tsx`, `MyRequestsList.tsx`, and
  `home/HomeBoard.tsx` — extracted the existing cancellation behavior and reused it on Home, including
  eligibility, confirmation, server action, toast feedback, and refresh.
- `app/[locale]/(app)/request/_components/ReplacementPicker.tsx`, both leave request forms,
  `lib/leave/replacement.ts`, and `messages/{en,fa}.json` — deleted search state/filtering, changed the
  empty dropdown prompt, and added the controlled No Replacement checkbox that clears/disables it.
- `components/LazyDatePicker.tsx`, `lib/leave/calendarPicker.ts`, the three request forms, and
  `manage/employees/new/{page,NewEmployeeForm}.tsx` — centralized picker configuration, made any
  missing/unknown preference Jalali, and converted the displayed hire date to Gregorian ISO before
  calling the employee action. The old route-local lazy picker was removed.
- `tests/unit/{page-refresh-button,calendar-picker,replacement-picker,request-cancel-button}*` and
  `tests/e2e/{leave,replacement}.spec.ts` — added regression coverage and updated the browser flows for
  Home cancellation and dropdown-only replacement selection. Removed the obsolete filter unit test.
- `docs/{CHANGELOG,TASKS,AGENT-LOG}.md` — recorded the completed UI work and honest gate status.
- Followed the project-required Context7 workflow for `react-multi-date-picker` / `react-date-object`
  current controlled-value, calendar/locale, and conversion APIs before changing the picker wiring.

**Actions outside the repo**
- None. No client server, database, deployment, container, or external data was changed. The targeted
  Playwright attempt started its local web server, but authentication and cleanup could not reach the
  configured local Supabase endpoint, so no test rows were created or changed.

**Verification**
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npm run test:unit` — **38 files, 242 tests passed**.
- `npm run build` — first sandboxed run failed because Turbopack was denied permission to bind a local
  port while processing CSS (`Operation not permitted (os error 1)`); approved retry outside the
  sandbox succeeded, compiling and generating all 36 static pages.
- `git diff --check` — clean. English/Farsi message-key parity script — **385 keys match**.
- `npx playwright test tests/e2e/replacement.spec.ts tests/e2e/leave.spec.ts --workers=1` — attempted
  outside the sandbox; both specs were blocked before the changed flows because
  `192.168.2.48:8080` returned `ECONNREFUSED` during login, and cleanup hit the same unavailable
  endpoint. This is an environment failure, not a UI assertion failure.

**State left behind**
- All feature, test, and documentation changes are uncommitted on `main`; no commit was requested.
- The pre-existing untracked deployment certificate/migration/seed paths listed above remain untouched.

**For the next agent**
- The shared header group deliberately renders refresh before profile in the DOM and applies
  `dir="ltr"`/`dir="rtl"`; changing either part can reverse the requested physical placement.
- Replacement remains optional at the server boundary: the checkbox is an explicit UI choice that
  submits the existing null/empty replacement value, so no database or RPC change was needed.
- Rerun the two targeted Playwright specs when the local Supabase stack at `192.168.2.48:8080` is back.

## 2026-08-04 — UI/UX codebase orientation before the next change request

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `94ee09e` (tree already had untracked
`deploy/bj-root-ca.crt`, `deploy/migrations/`, and `deploy/sql/seed.sql`; none are mine)
**Trigger:** The user asked for a codebase review focused on UI/UX and will provide the desired
changes after the agent is ready.

**What changed**
- `docs/AGENT-LOG.md` — recorded this read-only orientation session as required by the project
  working agreement. No application, styling, test, translation, or deployment file was changed.

**Actions outside the repo**
- None. No server, database, container, deployment, browser, or external service was touched.

**Verification**
- No test suite was run because this session made no code or configuration changes.
- Read the required onboarding chain (`CLAUDE.md`, `docs/AGENT-LOG.md`, `PLAN`, `REQUIREMENTS`,
  `DATA_MODEL`, `PERMISSIONS`, the current spec, `TASKS`, and `CHANGELOG`), then inspected the
  frontend shell, theme tokens, shared primitives, route composition, primary screens, responsive
  tests, RTL/i18n constraints, and current git state.

**State left behind**
- `main` remains at `94ee09e`; only this journal entry is newly modified by this session.
- The pre-existing untracked deployment files listed above were left untouched.

**For the next agent**
- The app is Farsi-first/RTL, light-only, mobile-first, and uses a shared shadcn-style component
  layer. Preserve fa/en message parity, logical RTL utilities, existing `data-testid` contracts,
  role/RLS behavior, and the mobile-bottom-nav/desktop-side-rail split when implementing the user's
  requested UI changes.
- The three request routes share `RequestTypeTabs`. Its seamless tab/card treatment depends on the
  strip's `-mb-px` + `z-10`, the active tab's `border-b-card`, and each form/fallback using
  `rounded-t-none`.

## 2026-08-04 — Request-type tab strip on the three request screens

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `f4977f0` (tree already dirty: `docs/AGENT-LOG.md`,
`docs/MEMORY.md`, untracked `deploy/docker-compose.local.yml` — none of those are mine)
**Trigger:** The request type could only be picked from the home board. The user asked for a
type selector inside the request screens themselves — not a dropdown, styled as tabs that blend
into the form — with the home-board buttons kept and the bottom link row removed.

**What changed**
- `app/[locale]/(app)/request/_components/RequestTypeTabs.tsx` — new server component. Three
  `Link`s (daily → `/request`, hourly → `/request/hourly`, errand → `/request/errand`). Because
  each type is its own route (D13), these are links, not client tab state. The active tab gets
  `border-b-card` so its bottom border matches the card fill, and the strip is `-mb-px z-10`, so
  the tab paints over the card's top border and the seam disappears.
- `app/[locale]/(app)/request/page.tsx`, `.../hourly/page.tsx`, `.../errand/page.tsx` — strip
  rendered in the page shell (outside `Suspense`, so it is up immediately and does not shift when
  the data resolves); the bottom `<p>` cross-link rows are gone. Dropped the now-unused `Link`
  imports, `tHourly` in `request/page.tsx`, and `tErrand` in `hourly/page.tsx`.
- `.../LeaveRequestForm.tsx:217`, `.../hourly/HourlyRequestForm.tsx:213`,
  `.../errand/ErrandRequestForm.tsx:155` — `<Card className="rounded-t-none">`, so the strip owns
  the top corners. Same on the `hourly-unavailable` `<p>`, which replaces the card on that branch.
- `components/Skeletons.tsx` — `CardSkeleton`/`FormSkeleton` take an optional `className`; the
  three request pages pass `rounded-t-none` so the Suspense fallback lines up under the strip.
- `messages/{fa,en}.json` — added `request.tabs.{label,daily,hourly,errand}`. Deleted the five
  keys the removed link row used and nothing else reads: `hourly.dailyLink`, `hourly.hourlyLink`,
  `errand.leaveLink`. (`hourly.navLink` and `errand.navLink` are also unreferenced now, but they
  predate this change, so I left them.)
- `.claude/launch.json` — new, so the preview tool can start `npm run dev`. Untracked directory;
  not part of the feature.

**Actions outside the repo**
- None. No server, no database, no deploy.

**Verification**
- `npx tsc --noEmit` — clean. `npm run lint` — clean.
- `npm run test:unit` — 36 files, 239 tests passed.
- `npm run build` — succeeded; all three request routes compiled.
- Confirmed Tailwind actually emits the utilities the blend depends on, in
  `.next/static/chunks/41u9vsylrl8ca.css`: `.border-b-card{border-bottom-color:var(--card)}`,
  `.border-b-border`, `.rounded-t-lg`, `.rounded-t-none`.
- Visual check was done on a **static replica**, not the live app: I could not log in (entering
  credentials is out of bounds for me), so I served an HTML page with the real built CSS and the
  exact class strings. Confirmed at desktop and at 375px, RTL: the active tab merges into the
  card with no seam, inactive tabs read as tabs, and the Farsi labels fit on mobile. **The strip
  has not been seen inside the authenticated app.**
- No e2e run. `tests/e2e` never referenced the removed `daily-to-hourly` / `hourly-to-daily` /
  `daily-to-errand` / `hourly-to-errand` / `errand-to-daily` testids, so nothing there should
  break — but that is a grep, not a run.

**State left behind**
- All changes uncommitted on `main`, per the commit-only-when-asked rule.
- `npm run dev` left running on port 3000 by the preview tool.

**For the next agent**
- The blend is a three-part contract: strip is `-mb-px` + `z-10`, active tab is `border-b-card`,
  card is `rounded-t-none`. Break any one and a 1px seam or a double border appears.
- New testids for e2e: `request-type-tabs`, `request-tab-daily|hourly|errand`.
- Each screen still shows its own `<h1>`/`PageHeader` above the strip, so the title and the active
  tab say much the same thing. Left as-is — the user did not ask for the titles to go.

## 2026-08-03 — Local Docker stack un-wedged: emulated Caddy broke TLS; restarted from `deploy/`

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `f4977f0` (clean tree)
**Trigger:** User asked to check the app is running properly in Docker, restart it if needed, and
to be given the local URL plus database credentials for ad-hoc SQL.

**What changed**
- `deploy/.env` (gitignored, new) — local-testing config, secrets copied out of the already-running
  containers so the existing `bj-erp_db-data` volume keeps working: `POSTGRES_PASSWORD`,
  `JWT_SECRET`, `ANON_KEY` (all unchanged), `APP_HOST=192.168.2.48`, `APP_PORT=8443`,
  `APP_ORIGIN=https://192.168.2.48:8443`. No `SERVICE_ROLE_KEY` — nothing in the compose file
  consumes it.
- `deploy/docker-compose.local.yml` (new, untracked) — local-only overlay publishing Postgres on
  `127.0.0.1:5433`. Must never reach the client's server; it is not referenced by `package.sh`.

**Actions outside the repo**
- Found the stack running from `dist/bj-erp-installer/` (a **2026-07-23** package) whose `.env` and
  `docker-compose.override.yml` no longer exist on disk, so that project directory was unusable for
  `docker compose`. Containers were up but **no port was actually bound on the host**: `curl` to
  `https://192.168.2.48/` and `https://localhost/` returned exit 7, and `nc -z 127.0.0.1 443/80/8080`
  was refused, even though `HostConfig.PortBindings` listed 80/443/8080. A throwaway
  `docker run -d -p 18080:80 caddy` bound fine, so Docker Desktop itself was healthy.
- Recreated the whole stack from `deploy/` instead: `docker compose -f docker-compose.yml -f
  docker-compose.local.yml up -d --force-recreate`. Project name is pinned (`name: bj-erp`), so the
  db volume was reused — no data loss. Ports then bound, but TLS failed:
  `LibreSSL/3.3.6: error:06FFF064:digital envelope routines:CRYPTO_internal:bad decrypt` right after
  Server Hello, and Caddy's own `:8080` listener timed out from inside the container while
  `app:3000`, `rest:3000` and `auth:9999` all answered normally over the docker network.
- **Root cause: `caddy:2.8.4-alpine` was the amd64 image running under emulation on this arm64 Mac,
  and its TLS stack is broken there.** `docker pull --platform linux/arm64 caddy:2.8.4-alpine`
  (registry was reachable — the user's VPN was up) + `up -d --force-recreate gateway` fixed it
  immediately. The other three services (`supabase/postgres`, `gotrue`, `postgrest`) are still amd64
  under emulation and work fine; only Caddy is affected. `bj-erp-app:latest` is arm64 (built locally
  2026-07-31).
- Stopped the two idle `bj-erp-app-rollback-*` containers. Note `bj-erp-app-rollback-20260729`
  carries the compose `service=app` label, so every `docker compose up` starts it again; it is inert
  (the gateway proxies to the `app` alias) but noisy. `docker rm -f bj-erp-app-rollback-20260729`
  removes it without touching the rollback *image*.

**Verification**
- `https://192.168.2.48:8443/` → 307 → `https://192.168.2.48:8443/login` 200, title
  `سامانه منابع انسانی`.
- `GET /auth/v1/health` → 200, `{"version":"v2.170.0","name":"GoTrue",…}`.
- Real login: `POST /auth/v1/token?grant_type=password` with `admin@bj-app.internal` /
  `Admin!2026` returned an `access_token` carrying `"app_roles":["admin"]` — the custom access
  token hook is working.
- `GET /rest/v1/leave_types` through the gateway reached PostgREST (returned a PostgREST column
  error for a column I guessed wrong, i.e. the route and JWT path are fine).
- Schema is the **post-leave-v2** one: `jalali_months`, `leave_request_serials`,
  `employee_leave_policies` all present; 14 public tables. Row counts: 15 profiles,
  5 leave_requests. There is no `supabase_migrations` schema in this database, so applied
  migrations cannot be enumerated — the schema shape is the only evidence.
- Postgres reachable from the host on `127.0.0.1:5433` (`nc -z` succeeded). `psql` is **not
  installed on the Mac**; queries were run with `docker exec … psql` inside `bj-erp-db-1`.

**State left behind**
- Stack up and serving at **https://192.168.2.48:8443** (self-signed Caddy internal CA — browsers
  warn; `https://localhost:8443` also answers but the cert names only the IP).
- Nothing committed. `deploy/.env` is gitignored; `deploy/docker-compose.local.yml` is untracked.
- `dist/bj-erp-installer/` is still the stale 2026-07-23 package with a missing `.env`; nothing was
  repaired there.

**For the next agent**
- **Do not run this stack's gateway from an amd64 Caddy image on an arm64 Mac.** It starts, logs
  cleanly, and then fails every TLS handshake with `bad decrypt`. The packaged installer is
  deliberately amd64 for the client's server (`package.sh`), so local testing needs the arm64 pull.
- The earlier note that "`docker compose` is unusable here (`.env` is root-owned `600`)" applied to
  `dist/bj-erp-installer/`, not to `deploy/`. With `deploy/.env` present, plain compose works.
- The `APP_PORT=8443` / `APP_ORIGIN=https://192.168.2.48:8443` pair must stay in sync — the origin
  is baked into the browser bundle at container start, so changing it needs
  `up -d --force-recreate app`, not a restart.

## 2026-07-31 (later) — Local container rebuilt; deploy path checked; packaging fixed for amd64

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `d26b0cb` (straight after the merge below)
**Trigger:** User asked to rebuild the local Docker app so they could test on an iPhone, then asked
what it would take to run this on the client's server — and told me the client's install holds **no
real data**, so a fresh install is acceptable.

**What changed**
- `deploy/package.sh:24` — built with **no `--platform`** and pulled the four pinned service images
  the same way. On this arm64 Mac that yields arm64 artifacts that die on the client's amd64 server
  with `exec format error`, discovered on site because the bundle is offline. Now pins
  `linux/amd64` for the build *and* the pulls, and refuses to package unless every image verifies
  as amd64. `release.sh` already did this; `package.sh` is the **fresh-install** path and did not.
  The pulls were the sharper half — `caddy:2.8.4-alpine` is multi-arch, so a re-pull silently swaps
  a good image.
- `deploy/RUNBOOK.md`, `docs/DEPLOY.md`, `docs/TASKS.md` — all three asserted the migrations are
  idempotent. Measurably false; corrected with the actual numbers and the operational consequences.

**Actions outside the repo**
- **Rebuilt `bj-erp-app:latest`** from merged `main` (arm64, local only) and recreated
  `bj-erp-app-1`. Old image tagged `bj-erp-app:pre-errand-20260731`; old container kept stopped as
  `bj-erp-app-rollback-20260731`. `docker compose` is unusable here (`.env` is root-owned `600`, no
  passwordless sudo), so the container was recreated with `docker run`, copying env/labels off the
  running one — **network alias `app` is mandatory**, Caddy proxies to `app:3000`.
- Spun a **throwaway `supabase/postgres:15.8.1.085`** and applied all 38 migrations + `seed.sql` in
  order, as `install.sh` does. Container removed afterwards.
- Created and dropped a scratch database `bjdeploy` to measure replay behaviour.
- Stopped the `next dev` server left running earlier.

**Verification**
- **Fresh install works and is CORRECT, not merely error-free: 38/38 migrations + seed clean**, and
  the end state checks out — leave-type hourly/accrual flags (the ones migrations cannot set,
  because they run *before* the seed), 612 `jalali_months` rows, work settings, `request_kind`, the
  **kind-keyed serial index**, and a `team_leave_calendar` leaking neither reason nor errand location.
- **Replay against a populated DB fails 9 of 38**, listed in `docs/TASKS.md`. `update.sh` therefore
  aborts on file #1 — safely: app not restarted, backup intact.
- **The production container genuinely works**, not just serves HTML: ran `errand.spec.ts` and
  `hourly.spec.ts` against `https://192.168.2.48` with a throwaway Playwright config (deleted after)
  — **3 passed**, including submit → manager approves → leave balance untouched.
- The new amd64 guard was tested against a real arm64 image and rejected it.

**State left behind**
- `main` @ `8b6ad86`, **not pushed**. Working tree clean.
- Local stack runs the new arm64 image; rollback image and stopped container retained. The local DB
  carries all 38 migrations.

**For the next agent**
- **`package.sh` had never been fixed despite the arm64 landmine being known since 2026-07-25.**
  It is fixed now, but note the asymmetry that hid it: `release.sh` (incremental updates) guarded
  the build, `package.sh` (fresh installs) did not, and only the latter is used for a new install.
- The migration replay repair is **deferred, not done** — see `docs/TASKS.md`. It is not needed for
  this release because the client has no real data and is getting a fresh install. It becomes
  required the moment they do.
- A fresh install **wipes their test users and departments** and regenerates the root CA, so phones
  must re-trust it. Their install is on port **3500** — `APP_ORIGIN` must match or login breaks in
  the way the 2026-07-29 changelog entry describes.

## 2026-07-31 — Pre-merge review of the leave-v2 branch; four real bugs found and fixed; merged to main

**Agent:** Claude Opus 5 via Claude Code (two parallel review subagents, also Opus 5)
**Branch / HEAD at start:** `feat/leave-v2-hourly-accrual-replacement` @ `ba0e859`
**Trigger:** User asked what was left on the branch, and if nothing, to do a full review and
debugging pass and merge to `main` if it was safe. The client is testing the app but not yet
using it for real requests.

**What was actually left (the honest answer to the question)**
1. **`npm run test:e2e` had never been run on this branch tip.** This is what found two of the
   four bugs below.
2. **Neither of the two newest migrations had been applied anywhere real** —
   `20260730130001` had only been run against a *stub* schema on a throwaway cluster, and
   `20260730130002` had never been executed at all.
3. `npm audit` had never been run.

**Bugs found and fixed** (commits `1aa36dc`, `cb9f2c0`)

- **CRITICAL — every first errand of a Jalali year would have failed.** `20260730130001` re-keyed
  the serial *counter* to `(company_id, jalali_year, kind)` but left the unique index on
  `leave_requests` as `(company_id, serial_year, serial_seq)`, with no `kind`. The first errand
  draws seq=1 and collides with the leave request already holding seq=1:
  `duplicate key value violates unique constraint "leave_requests_serial_uniq"`. Found by e2e and
  independently reproduced by a reviewer on a `pg_dump` copy of the live DB. **The whole BJ-F 50207
  feature was non-functional.** It escaped because the earlier "validated against a real Postgres"
  check used a stub schema that never had this index — *a stub missing the constraint you are about
  to violate does not test it.*
- **CRITICAL — the calendar misreported hourly absences.** `CalendarView` never rendered
  `start_time`/`end_time`, although `20260729130010` exists solely to expose them, and it printed
  "returns \<next working day\>" unconditionally. A 09:00–11:00 absence displayed to teammates and
  managers as a full day off returning tomorrow, on a surface where managers approve. Affected
  shipped hourly leave as well as every errand.
- **IMPORTANT — `accrue_leave` silently under-credited.** Its hot-path short-circuit returns as
  soon as the current month is posted, so an admin moving `accrual_start_month` *backwards* lost
  every newly-in-range month with no error, unrepairable by "Post accruals now". Reproduced as four
  lost months. Fixed in `20260731120001`.
- **IMPORTANT — an approved errand could never be cancelled.** `cancel_leave_request` allows
  cancelling an approved request only while `start_date > today`; an errand is a same-day form, so
  that is the normal case. Fixed in `20260731120001`.
- Plus: the dialog close button's only accessible name was a hardcoded English "Close" (this branch
  was its first consumer, so it would have shipped the first untranslated string in a Farsi-first
  app); the Home cover card dropped the hourly window; `tr('confirmBody')` omits its `{count}` and
  only works via a production-only fast path in `use-intl`; two vacuous e2e assertions; a failed
  departments read rendering as an empty list.

**Actions outside the repo**
- **Applied `20260730130001` and `20260730130002` to the LOCAL Docker stack** (`bj-erp-db-1`), after
  a `pg_dump` backup (1.1 MB, in the session scratchpad). Then applied `20260731120001`. All three
  re-run cleanly (idempotency proven by a second pass). **Nothing was done to the client's server.**
- Restarted `bj-erp-rest-1` once while mis-diagnosing a PostgREST 404 (see below). No data change.
- Verified against the live DB rather than migration text: `pg_get_viewdef` on
  `team_leave_calendar` leaks none of `reason`/`decision_note`/`errand_location` and uses a LEFT
  JOIN; exactly one signature exists of each touched function; `approve_leave_request` is
  time-aware. `accrue_leave` was patched from the installed `pg_proc.prosrc` and diffed before and
  after to prove only the intended two changes landed.

**Verification**
- `npm run test:e2e` (serial): **32 passed, 1 skipped** — run twice, before and after the fixes.
  Teardown reaped 26 users and 1 department, proving the widened reap regex and the `zz`-in-the-name
  trick both work in practice.
- `npm run test:unit` **239/239**, `npx tsc --noEmit` clean, `npx eslint …` clean, `npm run build`
  clean. fa/en key trees identical.
- `npm audit --omit=dev`: **3 high**, all transitive via `next@16.2.9` (postcss XSS/path-traversal,
  sharp/libvips). **Pre-existing on `main`** — the only dependency change on this branch is the
  `supabase` CLI in devDependencies. Fix is a patch bump to `next@16.2.12`.

**State left behind**
- Branch merged to `main` with a `--no-ff` merge commit. **NOT pushed** — `origin/main` is
  unchanged and no PR was opened.
- The local Docker DB now carries all three new migrations. The app container still runs the old
  image; rebuild before testing the errand screen there.

**For the next agent**
- **The migration replay loop is broken, and it is the client's deploy path.** `deploy/update.sh`
  and `install.sh` replay *every* `migrations/*.sql` under `psql -v ON_ERROR_STOP=1` with `|| fail`.
  `20260623120001_core.sql:11` is a bare `create type public.app_role …`, which fails on any
  non-empty database — so the loop dies on file #1 and **cannot deliver these 18 migrations to the
  client's already-installed server.** Confirmed pre-existing (the 2026-07-29 entry hit the same
  wall). This branch additionally makes `20260729130002`, `20260729130013`,
  `20260624090002` and `20260623120006` unreplayable, because later migrations drop the columns and
  change the return type they reference. **Resolve this before scheduling the deploy**;
  `deploy/RUNBOOK.md:145,164` still claims the migrations are idempotent, which is not true.
- A same-day *leave* request still cannot be cancelled once approved. That is deliberate and
  unchanged; only errands were widened.
- `login.codePlaceholder` still reads `prod-1042`. Correct for every account that exists today,
  wrong for every new hire; left alone because D14 ruled out a mixed-format hint.
- I briefly mis-diagnosed a PostgREST **404** on `submit_errand_request` as a stale schema cache.
  It was not: PostgREST 404s when the caller's role lacks EXECUTE, and I had probed as `anon` while
  the function is granted to `authenticated`. The Supabase image ships `pgrst_ddl_watch` /
  `pgrst_drop_watch` event triggers, so the schema cache reloads itself after DDL and `update.sh`
  is right not to restart `rest`. Do not "fix" that.

## 2026-07-30 — Hourly work errand (BJ-F 50207); login codes lose the department prefix; Departments card

**Agent:** Claude Opus 5 via Claude Code (two parallel subagents, also Opus 5)
**Branch / HEAD at start:** `feat/leave-v2-hourly-accrual-replacement` @ `1a9589c`
**Trigger:** User supplied a third client form (`docs/forms/hourly_work_errand_form.jpeg`) to build
into the app, asked to rework the admin Departments settings card, and — mid-design — relayed a
client clarification that the شماره on all three paper forms is the requester's personnel number,
which turned into a request to drop the department prefix from login codes.

**What changed**

Five commits, `e703555` → `ad69a8f`. Each was verified green *in isolation* (see Verification).

- `docs/specs/2026-07-30-work-errand-and-login-codes-design.md` — new frozen spec, 15 numbered
  user decisions (D1–D15). Read this before touching any of the below.
- `supabase/migrations/20260730130001_work_errand.sql` — `request_kind` enum; `kind` +
  `errand_location` on `leave_requests`; `leave_type_id` made nullable;
  `leave_requests_kind_shape` CHECK; `leave_request_serials` PK re-keyed to
  `(company_id, jalali_year, kind)`; `compute_requested_minutes` and
  `private.submit_leave_impl` made kind-aware; new `public.submit_errand_request` wrapper;
  `team_leave_calendar` recreated with a **LEFT JOIN** and a `kind` column.
- `supabase/migrations/20260730130002_employee_code_no_prefix.sql` —
  `private.create_employee_impl` now sets `employee_code := personnel_no`; `app_cleanup_e2e_users`
  reaps `^999[0-9]{7}$` in addition to the legacy prefixed patterns.
- `lib/leave/errand.ts` (new, 16 unit tests), `lib/actions/leave.ts` (`submitErrandRequest` +
  `kind`/`errand_location` threaded through the three read paths), `lib/supabase/types.ts`
  (hand-edited, as always), `lib/leave/serial.ts:4` (header corrected — it claimed the serial was
  the paper form's شماره, which the client says it is not).
- `app/[locale]/(app)/request/errand/` (new screen), plus errand tagging in `MyRequestsList`,
  `ApprovalQueue`, `CalendarView`, `HomeBoard`, and the tracking-number label in the two places
  the serial renders.
- `app/[locale]/(app)/manage/settings/DepartmentsCard.tsx` + `DepartmentMembersDialog.tsx` (new),
  replacing the deleted `DepartmentCodesForm.tsx`; `getDepartmentMembers` in
  `lib/actions/departments.ts`; `createDepartment` now auto-generates the code and retries on
  `23505`; Add Department removed from `manage/employees/page.tsx:193`.
- `messages/{fa,en}.json` — new `errand` namespace, `home.requestErrand`, `leave.trackingNo`,
  reworked `manage.settings.departments`, two new `dbErrors` keys; removed
  `manage.departments.code` / `codeHint`.
- Docs: `REQUIREMENTS.md` (FR-30, FR-31, FR-29 corrected), `DATA_MODEL.md`, `PERMISSIONS.md`,
  `CHANGELOG.md`, `TASKS.md`.

**Actions outside the repo**
- None against the client's server. Nothing was deployed and no live database was touched.
- One subagent stood up a **throwaway local PostgreSQL 17 cluster** with a stub of the Supabase
  schema to execute `20260730130001` end to end (serial independence, overlap refusal, the Friday
  case, CHECK enforcement, view column list, re-run idempotency). The cluster was deleted
  afterwards.

**Verification**
- `npx tsc --noEmit` — clean. `npm run test:unit` — **36 files, 239 tests passed**.
  `npx eslint app components i18n lib tests scripts proxy.ts` — clean. `npm run build` — succeeded,
  `/[locale]/request/errand` present in the route manifest.
- `npm run lint` was **not** used: it is still polluted by generated files in the stale
  `.claude/worktrees/peaceful-williams-9c1cf9` worktree (same as the 2026-07-29 entry).
- **Each of the four code commits was checked out into a temporary worktree and independently
  typechecked and unit-tested.** The first attempt at the commit split failed this check twice —
  `tests/unit/department-code.test.ts` and the two calendar/home fixtures had been filed under the
  wrong commit — so the commits were rebuilt from `e703555` with the assignment corrected. All four
  now pass alone.
- **`npm run test:e2e` was NOT run** — it needs a reachable Supabase and a dev server, neither
  available in this session. `tests/e2e/errand.spec.ts` and the rewritten `department.spec.ts` have
  never been executed.

**State left behind**
- Five commits on `feat/leave-v2-hourly-accrual-replacement`, **not pushed**, no PR. Working tree
  clean.
- Nothing applied to the client's server. Both migrations stack on leave v2, which is itself still
  unapplied there, and the ordering matters: leave v2's serial migration must run before
  `20260730130001` re-keys the counter.

**For the next agent**
- **A correction to my own earlier reasoning, recorded because it is an easy trap.** I asserted
  that `approve_leave_request` had a live date-only overlap bug and wrote it into the spec as work
  to do. It does not. The date-only body is the **superseded** one in
  `20260729130012_leave_replacement_guard.sql`; the live definition is
  `20260730120001_security_review_fixes.sql:804-819` and is already time-aware. Two bodies for this
  function exist in the migration history — grep for the latest, not the first.
- `updateDepartmentCode` and the `departments_update_admin` RLS policy are **intentionally
  unreferenced**. Do not delete them as dead code; the client plans to revisit department codes.
- `login.codePlaceholder` still reads `prod-1042` in both locales. Correct for every account that
  exists today, wrong for every future hire. Left alone deliberately — D14 ruled out a
  login-screen hint about the two code formats. Raise it with the user rather than silently fixing.
- `scripts/cleanup-e2e.mjs` reaps throwaway departments by `code like 'zz%'`, but admins no longer
  choose a code. The e2e helper now puts its `zz####` token at the **start of the English name**,
  which is what the generator reads. If you change how codes are generated, that reap breaks
  silently on the client's own database.
- Four i18n keys are now unused but deliberately kept: `manage.departments.invalid`,
  `manage.departments.backToList`, `manage.settings.departments.invalid`,
  `manage.settings.departments.close`.

## 2026-07-30 — Review of the Codex security branch; CSP dev fix; merge to the feature branch

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `codex/code-review` @ `45af68f`
**Trigger:** The user asked for a thorough review of the Codex security fixes — confirming they do
not regress the rest of the codebase — and a merge back into the branch they were forked from
(`feat/leave-v2-hourly-accrual-replacement`) if the review came back clean.

**What changed**
- `next.config.ts` — scoped the new CSP's `script-src` to allow `'unsafe-eval'` **in development
  only**. The review's CSP applies to `next dev` as well, and React's development build uses
  `eval()` for owner stacks / callstack reconstruction, so every dev page load logged a CSP error
  and lost those debugging features. Production output is unchanged
  (`script-src 'self' 'unsafe-inline'`, verified in `.next/routes-manifest.json` after a build).

**Verification of the Codex change set (all live checks rollback-only, local stack only)**
- Inactive boundary: an inactive caller sees 1 profile shell and 0 rows across leave_requests,
  companies, calendar, leave_types, leave_ledger; `submit_leave_request` raises `account is inactive`.
- Manager authority: `is_manager_of` / `can_read_all` flip to false the moment the manager role row
  is deleted.
- Audit: `authenticated` INSERT on `audit_log` is revoked; the owner-run trigger wrote exactly one
  row for a direct profile UPDATE. Triggers confirmed on profiles/departments/work_settings/
  holidays/companies/leave_types, covering the audit inserts removed from the server actions.
- Invariants: `profiles_manager_not_self` and the last-active-admin trigger both fire.
- Hourly overlap: 09:00–10:00 and 10:00–11:00 on one date now both approve (the reported bug);
  a genuinely overlapping 11:00–13:00 vs 10:00–12:00 is still refused.
- No false failures from the new `.select('id')` zero-row guards — UPDATE/INSERT/DELETE … RETURNING
  each returned exactly 1 row under RLS for an admin.
- `revoke execute on set_updated_at()` does **not** break DML: PostgreSQL checks trigger-function
  EXECUTE at CREATE TRIGGER time, and updates on trigger-bearing tables still succeed.
- `accrue_my_leave` with zero accrual policies returns without raising, so submit's new
  fail-on-accrual-error path cannot block employees who have no policy yet.
- No leftover function overloads — every `create or replace` in the migration replaced in place.
- Deployment: live container runs as uid 1000 `node`; HTTPS response carries CSP/HSTS/COOP/CORP and
  no `X-Powered-By`; the build-time CSP placeholder is correctly rewritten by the entrypoint `sed`
  (`connect-src 'self' https://192.168.2.48`).

**Gates:** `npx tsc --noEmit` clean · `npm run lint` clean · `npm run test:unit` 35 files / 217
tests · `npm run build` passing · **`npm run test:e2e` 30/30 passing** (the review doc did not
record an e2e run; it was the main outstanding gate given how much RLS moved).

**Actions outside the repo**
- Read-only catalog queries and rollback-only role simulations against the local `bj-erp-db-1`
  container. No schema or data change was committed. The client's server at `https://10.10.10.50`
  was not touched.

**State left behind**
- `codex/code-review` merged into `feat/leave-v2-hourly-accrual-replacement` (fast-forward).
  Neither branch is pushed.
- Migration `20260730120001_security_review_fixes.sql` remains applied to the **local** stack only.

**For the next agent**
- Still open from the Codex review: `npm audit` from a network-authorized machine.
- Pre-existing bug, **not** from this change set and not fixed here: `manage/employees/page.tsx`
  calls `tr('confirmBody')` without the `{count}` argument, so next-intl throws a
  `FORMATTING_ERROR` on every bulk-password-reset dialog render; `EmployeesTable.tsx` then does its
  own `.replace('{count}', …)`. Pass `{ count }` to `tr` (or use `tr.raw`) to silence it.
- The client's server is still on the pre-minutes schema; this migration is additive on top of the
  leave-v2 set and must ship through the release runbook, not an ad-hoc DB command.

## 2026-07-30 — Full security review, fixes, and local container redeploy

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `feat/leave-v2-hourly-accrual-replacement` @ `6c37993`
**Trigger:** The user asked for a thorough bug/security review, fixes for every confirmed issue,
updated project documentation, a rebuilt local Docker app, and a commit + push.

**What changed**
- `docs/SECURITY-REVIEW-2026-07-30.md` — recorded the review scope, confirmed findings by severity,
  fixes/proof, clean checks, verification, and the blocked external registry audit.
- `supabase/migrations/20260730120001_security_review_fixes.sql` — made inactive status a real RLS
  and RPC boundary; required a live manager role for report authority; removed forgeable audit,
  direct role/profile creation, company mutation, and write-like calendar-view grants; added
  trigger-backed audits, last-admin/self-manager invariants, atomic bulk password reset with
  bcrypt-safe limits, time-aware hourly approval, and reason-length enforcement.
- `lib/actions/{employees,leave,profile,refresh,settings}.ts`,
  `lib/leave/{hourly,settings-validation}.ts`, and affected forms/pages — propagated accrual and
  zero-row failures, validated settings/dates/manager assignments, bounded refresh paths and
  password inputs, used atomic resets, and corrected hourly replacement overlap.
- `app/[locale]/(app)/layout.tsx` and `app/[locale]/(auth)/login/page.tsx` — fail closed for inactive
  users and clear an inactive login session.
- `app/[locale]/(app)/_components/PageRefreshButton.tsx` — formatted the server-rendered timestamp
  in `Asia/Tehran`; this removed production React hydration error #418 found during browser QA.
- `deploy/{Dockerfile,docker-compose.yml,install.sh}` and `next.config.ts` — non-root/capability-free
  app runtime, validated installer address input, private env-file permissions, CSP/HSTS and
  cross-origin headers, and no framework disclosure.
- `tests/unit/*`, `eslint.config.mjs`, localized messages, Supabase types, and DB error mapping —
  added regressions for the fixes and excluded hidden generated worktrees from lint.
- `docs/{MEMORY,PERMISSIONS,TASKS,CHANGELOG}.md` — captured the durable security rules, current
  permission model, remaining external audit gate, and shipped behavior.

**Actions outside the repo**
- Applied and idempotently replayed migration `20260730120001_security_review_fixes.sql` as
  `supabase_admin` against the local `bj-erp-db-1` PostgreSQL 15 container.
- Ran rollback-only live SQL role simulations proving inactive-user isolation, manager-role
  removal, non-forgeable/triggered audit, atomic password reset, and adjacent hourly approvals.
- Built `bj-erp-app:latest`, recreated only `bj-erp-app-1`, and stopped the old
  `bj-erp-app-rollback-20260729` container after Compose unexpectedly started it.
- Confirmed the current app container runs as `node` with `no-new-privileges` and all capabilities
  dropped; verified the HTTPS gateway at `https://192.168.2.48`.
- Did not touch the client's production server at `https://10.10.10.50`.
- `npm audit` was attempted, but the environment's external-data-transfer safeguard blocked the
  dependency manifest from being sent to the npm registry; the escalated attempt was rejected.
- The requested push to `https://github.com/AmirNcode/bj-erp.git` was attempted after commit
  `a697a9c`; the environment rejected it pending explicit approval of that exact destination and
  security-review payload.

**Verification**
- `npm run test:unit` — 35 files, 217 tests passed.
- `npm run lint` — passed with no findings.
- `npx tsc --noEmit` — passed.
- `npm run build` and the Docker production build — passed; 34 routes generated.
- `git diff --check` — passed.
- HTTPS smoke check — HTTP 200 with CSP, HSTS, COOP/CORP, permissions/referrer/content-type/frame
  headers and no `X-Powered-By`.
- Fresh in-app browser pass — signed-in hourly page rendered, changing 08:00–10:00 showed
  `2 hours`, and the production console contained no application errors. Remaining warnings came
  from the installed MetaMask Chrome extension, not this app.

**State left behind**
- All review/fix/doc changes are committed locally on `codex/code-review` for review before
  merging. The external-transfer safeguard rejected the push pending the user's explicit approval
  of the destination `https://github.com/AmirNcode/bj-erp.git`.
- The original `feat/leave-v2-hourly-accrual-replacement` branch was restored to its pre-review
  commit `6c37993`, so it does not contain this security-review change set.
- The rebuilt current local app is running at `https://192.168.2.48/en/login`; supporting local
  database/auth/rest/gateway containers were preserved.

**For the next agent**
- Run `npm audit` before release from a network-authorized machine and record/remediate any
  registry-backed advisory; this is the only incomplete review gate.
- The new migration is applied locally only. Production remains untouched and must receive it
  through the established release runbook, not an ad-hoc database command.

## 2026-07-29 — Leave v2: design spec + ALL FIVE PLANS implemented (minutes, calendar, accrual, hourly, replacement, serials)

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `cce7b16`, tree had untracked `docs/forms/`
**Branch created:** `feat/leave-v2-hourly-accrual-replacement`
**Trigger:** Client feedback after reviewing the live app: add hourly leave (≤4h), make PTO accrue
1 day/month cumulatively, add the replacement/cover person from their paper forms, and document
(not solve) their insurance/ink-signature concern. User asked for a thorough blueprint with
clarifying questions, then said "go ahead with implementation and commit".

**What changed**

Design (no code):
- **`docs/specs/2026-07-29-hourly-accrual-replacement-design.md`** — frozen record of 15 decisions
  the user made, then the design for all four asks. Read this before plans 2–5.
- **`docs/plans/2026-07-29-leave-v2-foundations.md`** — plan 1 of 5. The spec is deliberately split
  into five plans (foundations → accrual → hourly → replacement → serials); each ships working
  software alone.
- `docs/forms/*.jpeg` — the client's two paper forms, now tracked. Read them; they answer questions
  the spec cannot (they show a حراست signature on hourly, a جانشین signature on daily, a شماره
  serial field, and HR writing balances as "__ روز و __ ساعت").

Implementation (plan 1, all committed):
- **`20260729130001_jalali_calendar.sql`** — `jalali_months` (612 rows, 1400–1450) +
  `jalali_month_of()`. Generated by `scripts/gen-jalali-months.mjs` from `lib/leave/jalaliMonths.ts`;
  do not hand-edit rows, re-run the generator. Documented exception to CLAUDE.md convention 1.
- **`20260729130002_leave_minutes_expand.sql`** — minutes columns + backfill + sync triggers.
- **`20260729130003_leave_minutes_contract.sql`** — definer fns write minutes; day columns dropped;
  `team_leave_calendar` recreated (still no `security_invoker`, still no `reason`/`decision_note`).
- **`20260729130004_leave_minutes_allocation_impl.sql`** — the one …130003 missed. See the trap below.
- `lib/leave/duration.ts` (+ `durationLabels.ts`) — the only place days↔minutes conversion happens.
- `lib/leave/balances.ts`, `lib/actions/leave.ts`, `HomeBoard`, `MyRequestsList`, `ApprovalQueue`,
  `LeaveRequestForm`, `EditEmployeeForm`, `NewEmployeeForm`, `AllocateForm` + their pages,
  `scripts/seed-demo.mjs`, `messages/{fa,en}.json`, `lib/supabase/types.ts`.
- Docs: DATA_MODEL (units, `jalali_months`, minutes columns, counting), CHANGELOG, TASKS, CLAUDE.md
  test counts, plus `docs/plans/2026-07-29-leave-v2-foundations-acceptance.sql`.

Implementation (plan 2 — accrual, all committed):
- **`docs/plans/2026-07-29-leave-v2-accrual.md`** — the plan, executed in full.
- **`20260729130005_leave_policy.sql`** — `employee_leave_policies`, `leave_types.default_*`,
  `leave_ledger.period_month`, the `carryover_forfeit` enum value, and **the partial unique index on
  (employee, type, entry_type, period_month)** that is the entire idempotency guarantee.
- **`20260729130006_leave_accrual_fns.sql`** — `accrue_leave` + `accrue_my_leave` /
  `accrue_employee_leave` / `accrue_all_leave` / `set_employee_leave_policy`.
- **`20260729130007_leave_ledger_seq.sql`** — the `seq` bug fix described below.
- `lib/leave/accrual.ts` — the pure planner the SQL mirrors (15 unit tests).
- `lib/actions/leave.ts` — `accrueBeforeRead` on all three balance readers + submit;
  `setEmployeeLeavePolicy` / `getEmployeePolicies` / `runAllAccruals` / `getCurrentJalaliMonthStart`.
- `manage/settings/AccrualRunner.tsx` (new) + policy blocks on the create and edit employee forms.
- `tests/e2e/accrual.spec.ts` (new) — proves through the UI that running accrual twice does not
  credit twice.

**Actions outside the repo**

- **Nothing was run against the client's server at `https://10.10.10.50`.** All four migrations are
  applied ONLY to the local docker stack. The client's database is untouched and still on days.
- Local docker stack (`bj-erp-db-1`): applied all four migrations as **`supabase_admin`** with
  `PGPASSWORD` from the container env, which is what `deploy/install.sh` does. My first attempt ran
  as `postgres` and failed with `must be owner of table work_settings`; it had already created
  `jalali_months` under the wrong owner, so I dropped and re-applied it as `supabase_admin`. Check
  `pg_tables.tableowner` if anything looks off.
- `npm i -D supabase` (CLI 2.110.0) — the user approved installing it for type generation. **It
  cannot generate types on this machine** (see traps).
- `pg_dump` safety net taken to the session scratchpad before the schema changes; it is gone with
  the scratchpad now, so re-dump before doing this on the client's box.

**Verification**

- Unit: **165/165 green** (30 files). Measured pre-branch baseline: **147**. `docs/TASKS.md` had that
  right; CLAUDE.md said 103 (now corrected) and a previous session's own note said 130.
  `docs/MEMORY.md` carries no count — do not look for one there.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`: all clean.
- SQL: acceptance query returned 0 mismatches on all four columns against real rows (27 ledger, 3
  requests, 25 allocations); replaying every migration is a no-op (`UPDATE 0`, `INSERT 0 0`); a
  rolled-back probe insert proved the expand-phase trigger; after the contract migration, zero day
  columns survive and zero functions reference them (checked via `pg_proc.prosrc`, not grep).
- `npm run seed` succeeds against the renamed RPCs.
- E2E: plan 1 — **first run 25/26** (caught the days/minutes mismatch below), **second run 24/26**
  (caught the allocation-impl break), **26/26 green** after `…130004`. Plan 2 — **27/27 green** with
  the new `accrual.spec.ts`. Plan 3 — **29/29 green** with `hourly.spec.ts` (2 specs). Plan 4 — **30/30 green** with `replacement.spec.ts`. Plan 5 — **30/30 green** (its assertion rides on that spec). Final gates: unit **208/208**, e2e **30/30**. Every failure
  along the way was a real bug in my work or my test, never a flaky suite.

**State left behind**

- Branch `feat/leave-v2-hourly-accrual-replacement`, committed, **not pushed, no PR**.
- Plans 2–5 (accrual, hourly, replacement, serials) are **not written yet**. The spec is their input.
- The local docker DB is now on minutes; the client's is not. They will diverge until deployment.

Implementation (plan 3 — hourly, all committed):
- **`docs/plans/2026-07-29-leave-v2-hourly.md`** — the plan, executed in full.
- **`20260729130008_leave_hourly.sql`** — `leave_unit`, `leave_requests.unit/start_time/end_time`, the
  `leave_requests_unit_shape` CHECK, `work_settings.work_start/work_end/max_hourly_minutes_per_day`,
  and `allow_hourly` switched on for annual + unpaid (never sick).
- **`20260729130009_leave_hourly_fns.sql`** — `compute_requested_minutes` made unit-aware, plus
  `private.submit_leave_impl` behind `submit_leave_request` (unchanged signature) and
  `submit_hourly_leave_request`.
- **`20260729130010_calendar_hourly.sql`** — `team_leave_calendar` recreated with `unit`/times/minutes.
  Still no `security_invoker`, still no `reason`/`decision_note` — verified against the live column list.
- `lib/leave/hourly.ts` (17 tests), `lib/leave/formatTimeRange.ts`, `lib/leave/workSettings.ts`.
- `app/[locale]/(app)/request/hourly/*` (new screen), Home buttons, time ranges in MyRequestsList /
  ApprovalQueue, work-hours fields in `WorkSettingsForm`, `tests/e2e/hourly.spec.ts` (2 specs).

Implementation (plan 4 — replacement, all committed):
- **`docs/plans/2026-07-29-leave-v2-replacement.md`** — the plan, executed in full.
- **`20260729130011_leave_replacement.sql`** — `replacement_id` (+ CHECK it is never the requester),
  `get_replacement_candidates` (annotated, own department only, no employee argument so it cannot
  enumerate another team), `get_my_cover_conflicts`.
- **`20260729130012_leave_replacement_guard.sql`** — `private.replacement_is_away` as the ONE predicate;
  `submit_leave_impl` gains `p_replacement_id`; both wrappers extended and their 5-arg variants dropped
  so there is exactly one of each; `approve_leave_request` re-checks the cover.
- `lib/leave/replacement.ts` (6 tests), `request/_components/ReplacementPicker.tsx` (shared by both
  screens), cover name + clash flag on approvals, "You are covering" card on Home,
  `tests/e2e/replacement.spec.ts`.

Implementation (plan 5 — serials, all committed):
- **`docs/plans/2026-07-29-leave-v2-serials.md`** — the plan, executed in full.
- **`20260729130013_leave_serials.sql`** — `leave_request_serials` counter, `leave_requests.company_id`
  (denormalised on purpose) + `serial_year`/`serial_seq` + unique index, and the **backfill**: existing
  requests numbered in `created_at` order per Jalali year, with the counter seeded past it. The migration
  raises rather than leaving a null if any `start_date` sits outside `jalali_months`.
- **`20260729130014_leave_serial_alloc.sql`** — allocation inside `submit_leave_impl`, patched from
  `pg_get_functiondef` at two points only.
- `lib/leave/serial.ts` (5 tests) + serials rendered on requests and approvals; the e2e assertion was
  added to the existing replacement spec rather than paying for a new browser run.

**Plan 5's one real subtlety**

The advisory lock in the writer is `leave:<employee_id>` — **per employee**. It does not serialise the
serial counter across *different* employees, so `on conflict … do update … returning` is what provides
that, by taking a row lock on the counter for the rest of the transaction. Verified with two genuinely
parallel psql transactions from two employees: they got 4 and 5, not the same number twice. Had they
collided, the unique index would have turned it into a failed submission for a real worker.

**Plan 4's notes**

1. **The searchable picker is a filter input over a native `<select>`, not shadcn `Command`.**
   `components/ui` has no `command` primitive and adding it pulls `cmdk` through a network install this
   machine cannot do. Native selects are also what the e2e suite drives. Deviation from spec §9, recorded
   in the plan rather than substituted silently.
2. **The repo lints against synchronous `setState` inside an effect.** My first candidate-fetch cleared
   state synchronously and failed `react-hooks/set-state-in-effect`. The fix is the pattern the balance
   effect already used: keep a `candidatesFor` key and DERIVE both the list and the loading flag.
3. **The availability predicate must exist exactly once.** It is `private.replacement_is_away`, shared by
   the candidate read, the submit guard and the approval re-check. If a copy drifts, the UI offers a
   colleague the server then rejects.

**Plan 3's traps**

1. **`lib/actions/leave.ts` is a `'use server'` file, so it may only export async functions.** I put a
   shared `WORK_SETTINGS_FALLBACK` object there and the build failed page-data collection with
   *"A 'use server' file can only export async functions, found object"*. It now lives in
   `lib/leave/workSettings.ts`; the type-only import is erased at runtime. Types are fine to export
   from a server file — runtime values are not.
2. **Assert e2e outcomes, not toasts.** `getByRole('status')` for the approval toast is a race: sonner
   auto-dismisses, and the approval had in fact succeeded. Assert that the request left the queue.
3. **Don't hardcode a balance in e2e.** My first assertion expected 4.75 days and got 31.75, because
   `createEmployee` grants the leave-type default, `allocate()` adds more, and plan 2's accrual adds a
   day on top. Read the balance before the action and assert the delta.
4. **`deploy/install.sh` applies migrations BEFORE `seed.sql`**, so a migration that backfills
   `leave_types` columns matches zero rows on a fresh install. Both plan 2's accrual defaults and plan
   3's `allow_hourly` were affected: a brand-new install would have had hourly silently unavailable and
   nobody accruing. `supabase/seed.sql` now sets those columns explicitly. **Any future migration that
   updates seeded reference rows must also set them in the seed.**
5. The `team_leave_calendar` type in `types.ts` had been missing `requested_minutes` since plan 1 (my
   day-column strip caught the view too, and nothing selected it). Restored while adding the hourly
   columns — a reminder that hand-maintained types hide omissions until something selects the column.

**Plan 2's own bug find, worth understanding before touching balances**

`current_leave_balance` (and `getMyBalance`, and `latestBalances`) defined "current balance" as the
latest ledger row by `created_at`. `now()` is frozen for a transaction, so the moment accrual started
posting several months at once, every row it wrote shared one `created_at` and the tie-break fell
through to a random uuid: a true balance of 1440 read back as 960. It was **latent** before accrual —
every ledger row used to come from its own transaction — and no existing test could have caught it.
It surfaced only because the plan required asserting the SQL against the TS planner's numbers.
Fix: `leave_ledger.seq` (sequence-backed, backfilled in `created_at` order) and every reader orders
by it. **If you add a code path that writes several ledger rows in one transaction, `seq` is what
keeps the balance readable.**

**For the next agent — traps that cost real time here**

1. **Never map SQL dependencies by grepping `supabase/migrations/`.** A later migration silently
   redefines an earlier function, so the files are history, not the live schema. `20260713120001`
   had moved allocation into `private.allocate_leave_impl`; my contract migration ported the
   2026-07-02 versions and missed it, so dropping the day columns broke BOTH employee-creation paths
   with `column "allocated_days" ... does not exist`. Ask the catalog:
   `select ... from pg_proc p ... where p.prosrc ~ '(allocated_days|delta_days|requested_days|balance_after[^_])'`.
   For big functions, patch `pg_get_functiondef` output programmatically instead of retyping.
2. **`supabase gen types` does not work from here.** It pulls
   `public.ecr.aws/supabase/postgres-meta` at runtime, which this network will not deliver — the same
   constraint that killed server-side Docker builds. `lib/supabase/types.ts` is therefore
   **hand-edited**, with that fact recorded in its header. `tsc --noEmit` + `next build` are the
   substitute gate. Do not assume the CLI in devDependencies means type generation works.
3. **No `supabase db reset` and no dev stack on :54322.** The running stack is the self-hosted
   `deploy/docker-compose.yml` one, its Postgres port is unpublished, and `.env.local` points at
   `http://192.168.2.48:8080`. Apply migrations with
   `docker exec -i -e PGPASSWORD=… bj-erp-db-1 psql -U supabase_admin -d postgres -f -`. Because
   migrations replay forward onto data, **every migration must be idempotent** — same requirement
   `deploy/update.sh` has on the client's server.
4. **The stack is Postgres 15** (`supabase/postgres:15.8.1.085`), not the 17 in `config.toml`. No
   PG16+ syntax. `create or replace trigger` is fine (PG14+).
5. **`create or replace function` cannot change a return type.** `current_leave_balance` went
   numeric→int and needed an explicit `drop function` first. The plan had this wrong.
6. **E2E is not optional on this kind of change.** Both real bugs were invisible to `tsc`: the
   days/minutes mismatch in the admin balance editor (`manage.spec.ts` expected `7`, got `3360`) and
   the allocation-impl break. The typecheck did earn its keep separately, finding four consumers the
   plan's reader list had missed.
7. **`docs/plans/2026-07-29-leave-v2-foundations-acceptance.sql` must run against a dump of the
   client's database, between …130002 and …130003**, before this ships. Sections 1–2 compare day and
   minute columns, so they only work while both exist. The amd64 `package.sh --platform` landmine
   still applies.
8. Unrelated pre-existing bug noticed in passing, not fixed: the bulk-import "regenerate passwords"
   confirmation throws a next-intl `FORMATTING_ERROR` because the `count` variable is not passed to
   `برای {count} نفر رمز جدید ساخته می‌شود…`. Worth a small separate fix.

## 2026-07-29 — Rejection reason (new column); employee-code field latin-only; local stack rebuilt

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `bd8efd7`, clean tree
**Trigger:** (1) Make the login *username* field English-only + LTR like the password field.
(2) Add an optional free-text reason when rejecting a request; dropdown of presets comes later.

**What changed**

- `lib/employees/code.ts` — `toLatinCode()`; wired into `#code` on `login/page.tsx` with
  `lang="en"`, `spellCheck={false}` (it already had `dir="ltr"`). Drops spaces too — codes never
  contain one. The code becomes the synthetic auth email, so a Persian character could only ever
  produce an unmatchable login.
- **`supabase/migrations/20260729120001_reject_reason.sql` — new nullable
  `leave_requests.decision_note` (≤500 chars) + `reject_leave_request` updated to persist it.**
  `p_reason` had existed since `20260624090001` but was written **only to `audit_log`**, which
  employees cannot read — the reason was invisible to the one person it was written for. Wiring
  the existing parameter to the UI alone would have shipped a field with no reader, so the
  column was the point of the feature, not scope creep. Chose a separate column from
  `leave_requests.reason` deliberately: that one is the requester's and FR-25-private from
  peers; this one is the decider's. `team_leave_calendar` selects an explicit column list
  (`20260624090002:39-50`) so the note cannot leak through the shared calendar — checked, not
  assumed.
- `lib/actions/leave.ts` — `decision_note` added to `LeaveRequestWithType` and to the
  `getMyLeaveRequests` select; `rejectRequest` trims and caps the note, sends `undefined` when
  blank.
- `manage/approvals/ApprovalQueue.tsx`, `calendar/CalendarView.tsx` — optional `Textarea` in
  both reject dialogs (`reject-reason-*` / `cal-reject-reason-*`), per-request state in the
  queue, local state in the calendar's `DecideButtons`.
- `request/MyRequestsList.tsx` — shows the note on the employee's own rejected row
  (`decision-note-*`).
- `messages/{en,fa}.json` — `approvals.rejectReasonLabel/Placeholder`, `request.rejectedReason`;
  key trees verified identical (320 keys). `login.codePlaceholder` changed from `admin` to
  `prod-1042` at the user's request — the login page no longer names the admin account.
- `lib/supabase/types.ts` — hand-added `decision_note` to the `leave_requests` Row/Insert/Update
  (generator not run; no network to a Supabase project from here).
- Tests: `toLatinCode` unit cases; `approval.spec.ts` now types a Farsi reason and asserts the
  employee reads it back. `docs/CHANGELOG.md`, `TASKS.md`, `DATA_MODEL.md` updated.

**Actions outside the repo**
- **Local Docker stack only — nothing against the client's server, no SSH, no VPN.**
- Applied `20260729120001_reject_reason.sql` to the **local** `bj-erp-db-1` by piping it to
  `psql` over stdin. Output: `ALTER TABLE / ALTER TABLE / COMMENT / CREATE FUNCTION / REVOKE /
  GRANT`, plus a harmless "constraint does not exist, skipping" notice.
- Rebuilt `bj-erp-app` twice from the working tree (native arm64 — **local testing only, the
  server needs the amd64 cross-build via `release.sh`**) and recreated `bj-erp-app-1`.
  `docker compose` was unusable here: `.env` is root-owned `600` and there is no passwordless
  sudo, so the container was recreated with `docker run`, copying env/network/labels off the
  running container. Compose labels preserved, so `sudo docker compose up -d app` still adopts it.
- e2e teardown deleted 20 throwaway users + 1 throwaway department from the **local** DB.

**Verification**
- unit **147/147**; full e2e **26/26** serial; `npm run lint`, `npx tsc --noEmit` clean.
- Confirmed live in the local container: `#code` renders `dir="ltr" lang="en" spellCheck="false"`;
  `information_schema` reports `decision_note | text`; `/login` and `/auth/v1/health` both 200.
- The reject→read-back path is covered end-to-end by `approval.spec.ts`, not just by unit tests.

**State left behind**
- Committed to `main` and pushed.
- Local stack runs the new image; `bj-erp-app:78a324a` remains for rollback. **The local image
  predates the placeholder change** — rebuild if you want it reflected in the container.
- Temporary `pw-tmp.config.ts` at the repo root was deleted; dev server stopped.

**Flake worth knowing (pre-existing, not caused by this work)**
- `auth.spec.ts:8` failed on the first run after each `next dev` start and passed immediately
  after, twice in a row. Cause: it fills `#code` directly instead of using the retrying `login()`
  helper, so it races the first-hit compile of the **authenticated** `/home` tree. Curling
  `/home` while logged out does not warm it — the redirect never reaches the route. Either run
  the suite twice or switch that spec to the helper.

**For the next agent**
- **The client's database does not have `decision_note` yet.** It ships on the next
  `release.sh`, which replays migrations — but the app build and the migration must go together.
  Deploying the new image against the old schema breaks `/request` (the select names a column
  that does not exist).
- The reject reason is deliberately free text for now; the user plans preset options plus a
  dropdown, keeping free text as the "other" case. `decision_note` is text and unconstrained
  beyond length, so presets can be layered on without another schema change.

## 2026-07-29 — Deploy guide rewritten for the 3500 port move; password work committed

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `14ba9ac`
**Trigger:** User asked for "a new file in docs" with step-by-step deploy commands, then to
commit and push.

**What changed**

- **No new file was created.** `docs/DEPLOY-GUIDE.md` already was that file (added `e478dd6`,
  2026-07-26). A second guide would have meant two sets of instructions, one of them wrong.
  Rewrote it in place instead and told the user. **It was stale in a way that mattered:** every
  health check and the success banner hardcoded `https://10.10.10.50` — port 443, where nothing
  has listened since `14ba9ac`. Following the old guide would have reported a healthy deploy as
  broken.
- **New PART 0, and it is blocking.** `deploy/docker-compose.yml:60,65,66,112` declare
  `${APP_ORIGIN:?…}`, so compose *hard-fails* on any `.env` written before the port change. Per
  the entry below, the client's server still has such an `.env` — so **the next `release.sh`
  will stop with `set APP_ORIGIN in .env` until PART 0 is done**. `update.sh:71`'s
  `APP_ORIGIN:-https://${APP_HOST}` fallback does not save this; it only feeds that script's own
  health check, not compose.
- Rest of the rewrite: all URLs carry `:3500`; new PART 3 groups the "is it running correctly"
  checks (app 200, `/auth/v1/health` 200, five containers, live version, update log, employee
  count, recent app errors); troubleshooting gains the `set APP_ORIGIN` row and 4.6 for
  "page loads, login fails"; a rule that `APP_HOST` never carries a port; a table of where
  things live.
- `docs/AGENT-LOG.md`, `docs/MEMORY.md`, `docs/TASKS.md` — entries for the password work
  (previous session, same day) plus this one.

**Actions outside the repo**
- **None. No VPN, no SSH, nothing run against the client's server.** Every command in the guide
  was verified by reading `deploy/*.sh` and `docker-compose.yml`, not by executing it there.

**Verification**
- Every error string in the troubleshooting table grepped out of `deploy/*.sh` /
  `docker-compose.yml` — all 14 present, no invented messages.
- Success-banner text checked against `update.sh:214-217`; container names against
  `docker-compose.yml` (`db`, `auth`, `rest`, `app`, `gateway`); remote path against
  `release.sh:24`; SSH alias/host/port/user against `setup-release.sh:18-20`.
- The PART 0.3 `printf … >> .env` quoting was executed locally against a throwaway file to prove
  the escaping survives the `ssh -t bj "…"` wrapper.
- **Not verified against the live server** — no VPN from here. PART 0 is reasoned from the
  compose file, not observed on the client's machine.

**State left behind**
- Committed to `main` and pushed (see the commit below this entry's date in `git log`), together
  with the previous session's uncommitted password-field work and the previously **untracked**
  `docs/AGENT-LOG.md` + `CLAUDE.md` change — the log file itself had never been committed and
  would have been lost by any clean checkout.

**For the next agent**
- Ask whether PART 0 has been run before touching deployment. Until it has, every release fails
  at compose time, and the failure names `.env`, not the port.
- `playwright.config.ts` hardcodes `localhost:3000`, which on this Mac belongs to an unrelated
  container (`isupply-app`); `next dev` falls back to 3001 and specs 404 against the wrong app.

## 2026-07-29 — Login password field: reveal toggle + latin-only entry (first-hand record)

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `14ba9ac`, clean tree
**Trigger:** Two changes to the login page: add a show/hide password toggle, and force the
password field left-to-right and English-only, because in the Farsi UI the field was collecting
Persian characters and the entered password was wrong.

> **Supersedes the backfilled entry of the same name further down this file.** That one was a
> reconstruction from `docs/CHANGELOG.md` written by the previous agent, with "Agent",
> "Trigger", "Actions outside the repo" and independent verification recorded as *unrecorded*.
> This is the first-hand record. Its own note says to treat its detail as incomplete — that
> stands; nothing in it is wrong, it is just thin. Left in place per rule 7.

**What changed**

Root cause of the reported bug: passwords in this system are always latin (temp passwords come
from an ASCII alphabet, employee codes are latin), but nothing stopped a Farsi keyboard from
entering Persian characters. `type="password"` shows only bullets, so the user gets a failed
login with no visible reason. Direction was the smaller half of the problem; the character set
was the real one.

- `lib/auth/passwordPolicy.ts:1` — new `toLatinPassword()`: converts Persian/Arabic-Indic digits
  (reuses `toAsciiDigits` from `lib/employees/code.ts`) then drops everything outside printable
  ASCII `[^\x20-\x7E]`. Placed here, not in the page, so both password entry points share it.
- `app/[locale]/(auth)/login/page.tsx` — reveal toggle (`Eye`/`EyeOff`, lucide) as a
  `type="button"` inside the field, `data-testid="password-toggle"`, `aria-pressed`, localized
  `aria-label`. Input gets `dir="ltr" lang="en"`, `autoCapitalize/autoCorrect` off,
  `spellCheck={false}`, `pe-10`, and filters through `toLatinPassword` on change. **The wrapper
  div also carries `dir="ltr"`** — with only the input set, `end-0` resolves against the RTL page
  and the button lands on the visual left, over the start of the text.
- `app/[locale]/(app)/profile/ChangePasswordForm.tsx` — same latin/LTR treatment on all three
  fields. **Scope addition, not requested.** Filtering only the login field leaves a lockout
  path: this form accepted Persian characters, so a password set here could never be typed at
  login again. Flagged to the user as revertible.
- `messages/{en,fa}.json` — `login.showPassword` / `login.hidePassword`, inserted after
  `passwordPlaceholder` in both; key trees verified identical afterwards (317 keys, same order).
- `tests/unit/passwordPolicy.test.ts` — 4 cases for `toLatinPassword` (ASCII passthrough, both
  digit families, Persian letters dropped, RTL mark + emoji dropped).
- `tests/e2e/auth.spec.ts:32` — asserts `dir="ltr"`, that filling `رمز۱۲۳abc!` leaves `123abc!`,
  and the `password → text → password` toggle round-trip.
- `docs/CHANGELOG.md` — entry added above the port entry.

**Actions outside the repo**
- Nothing against the **client's** server. No SSH.
- Local only: started and later stopped `npm run dev`; the local `bj-erp-*` Docker stack was
  already running from a previous session and was left running.
- The Playwright global teardown ran against the **local** Docker database and deleted 20
  throwaway e2e users and 1 throwaway e2e department (the reserved `999#######` / `zz` patterns).
  Expected behaviour, local DB only, no client data touched.

**Verification** — all actually run, on the local Docker stack:
- `npm run test:unit` → **143 passed** (139 before; +4 new).
- Full e2e serial → **26 passed**, run **twice**: once before the `ChangePasswordForm` edit and
  again after it, because that edit touches a shared module.
- `npm run lint` clean · `npx tsc --noEmit` clean · `npm run build` compiled successfully.
- Live DOM check on `/fa/login` in a browser: input `dir=ltr`, `lang=en`,
  `padding-right: 40px` / `padding-left: 12px`, toggle centre right of the field centre,
  `aria-label` = `نمایش رمز عبور`. Screenshot confirmed Farsi labels still render RTL.
- **One flake, not a regression:** `auth.spec.ts` "correct credentials land on /home" failed on
  the first cold run and passed on every run after. Same cold-`next dev` hydration race already
  documented in `docs/MEMORY.md`; this spec fills `#code` directly instead of using the
  retrying `login()` helper.

**State left behind**
- **Uncommitted on `main`**, not pushed — the user commits on request. Eight files:
  `login/page.tsx`, `profile/ChangePasswordForm.tsx`, `lib/auth/passwordPolicy.ts`,
  `messages/{en,fa}.json`, `tests/e2e/auth.spec.ts`, `tests/unit/passwordPolicy.test.ts`,
  `docs/CHANGELOG.md` (plus this file and the docs below).
- A temporary `pw-tmp.config.ts` was created at the repo root for the test runs and **deleted**;
  `playwright.config.ts` was not modified. Dev server stopped.

**For the next agent**
- **`npm run test:e2e` will silently test the wrong application on this Mac.**
  `playwright.config.ts` hardcodes `localhost:3000`, but port 3000 is held by an unrelated
  container of the user's (`isupply-app`), so `next dev` falls back to **3001** and every spec
  gets 404s that look like broken routing. Check the `next dev` banner for the real port and
  point Playwright at it. The port clash is on the machine, not in the repo.
- Employees whose password already contains non-latin characters can no longer type it and need
  an admin reset. Unknowable from here — passwords are bcrypt-hashed.
- The `ChangePasswordForm` half was a deliberate scope addition; if the user rejects it, revert
  the three `onChange`/`dir` blocks and the import, and leave `toLatinPassword` in place.

## 2026-07-29 — Configurable HTTPS port; login broken by the port move

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `80d0cb4`
**Trigger:** Client's IT required the app off ports 80 and 443. The user changed the compose
`ports:` line to `'3500:443'` on the live server, after which login stopped working for the
admin and one other account.

**What changed**

Root cause: the published port lives in more places than the compose port mapping.
`NEXT_PUBLIC_SUPABASE_URL` was derived as `https://${APP_HOST}` (no port) and is substituted
into the compiled browser JS by `deploy/docker-entrypoint.sh:19` at container creation. Login is
a **browser-side** call (`lib/auth/usernameEmail.ts:26` → `lib/supabase/client.ts`), so the page
loaded fine over :3500 while every login POST went to :443 — unpublished, nothing listening.
Caddy itself was fine: it listens on 443 *inside* the container and ignores the `Host` header's
port when matching, so `'3500:443'` was correct.

- `deploy/docker-compose.yml` — `APP_ORIGIN` (full URL employees type) now feeds
  `NEXT_PUBLIC_SUPABASE_URL`, `API_EXTERNAL_URL`, `GOTRUE_SITE_URL`, `GOTRUE_URI_ALLOW_LIST`,
  declared `${APP_ORIGIN:?…}` so a `.env` missing it fails loudly rather than rendering empty
  URLs. Ports become `'${APP_PORT:-443}:443'`. Port 80 no longer published.
- `deploy/install.sh` — prompts for the HTTPS port, derives `APP_ORIGIN`, splits a port off
  `APP_HOST` if one was typed there (`APP_HOST` must stay bare — it is the TLS cert name and
  `default_sni`), and backfills `APP_PORT`/`APP_ORIGIN` into pre-existing `.env` files.
- `deploy/update.sh:141` — **second, separate bug found while investigating.** The post-deploy
  health check curled `https://${APP_HOST}/`. On any non-443 install that can never succeed, so
  every *good* deploy would have been automatically rolled back. Now uses `${APP_ORIGIN}`.
- `deploy/caddy/Caddyfile` — removed the dead `http://` redirect block (port 80 is gone);
  added a comment that the site address stays portless and why.
- `deploy/env.example`, `deploy/RUNBOOK.md` — three-value model documented; requirements list,
  phone-install steps and troubleshooting updated.
- `docs/CHANGELOG.md`, `docs/MEMORY.md` — entries added.

**Actions outside the repo**
- None. No SSH, no commands run against the client's server. The user was given the surgical
  `.env` + `sed` + `--force-recreate` sequence to run themselves; whether they ran it is not
  recorded here.

**Verification**
- `docker compose config` against a synthetic `.env` — all four public URLs render
  `https://10.10.10.50:3500`, `published: "3500"`, `target: 443`, `APP_HOST` stays bare.
- Same command against a pre-`APP_ORIGIN` `.env` — exits 1 with the intended message.
- `bash -n` clean on `install.sh` and `update.sh`; host/port normalisation exercised on
  `10.10.10.50`, `10.10.10.50:3500`, `erp.local:8443`, `erp.local`.
- Unit/e2e suites **not** run — no application code was touched, only deploy scripts and docs.

**State left behind**
- Committed as `14ba9ac` on `main`, not pushed at the time of writing.
- The client's live server still runs the **old** compose file with the hand-edited
  `'3500:443'` line. It needs either the manual fix or a new package built from this commit.

**For the next agent**
- Changing `APP_ORIGIN` requires `docker compose up -d --force-recreate app` — a plain
  `restart` reuses a container whose files were already substituted, so the old URL survives.
- Browsers cache `/_next/static/*` as `immutable`. The substitution changes chunk *contents*
  without changing filenames, so a hard reload (and clearing site data on installed PWAs) is
  required after any `APP_ORIGIN` change.
- Never put a port in `APP_HOST` — it corrupts `default_sni` and the certificate name.

## 2026-07-29 — Login password field: reveal toggle + latin-only entry

**Agent:** unrecorded (entry backfilled 2026-07-29 when this log was created)
**Branch / HEAD at start:** `main`
**Trigger:** Unrecorded.

**What changed**
- Show/hide password toggle on `/login`; password inputs forced latin-only, left-to-right, via
  `toLatinPassword()` in `lib/auth/passwordPolicy.ts`; applied to the change-password form too.
- Full detail: `docs/CHANGELOG.md` → "Login password field: reveal toggle + latin-only entry".

**Actions outside the repo** — unrecorded.

**Verification** — per the changelog: `toLatinPassword` unit cases (143 unit tests total) and an
`auth.spec.ts` case. Not independently re-run when this entry was written.

**State left behind**
- Uncommitted in the working tree at the time this log was created: `login/page.tsx`,
  `profile/ChangePasswordForm.tsx`, `lib/auth/passwordPolicy.ts`, `messages/{fa,en}.json`,
  `tests/e2e/auth.spec.ts`, `tests/unit/passwordPolicy.test.ts`.

**For the next agent**
- This entry is a reconstruction from `docs/CHANGELOG.md`, not a first-hand record — it predates
  this log. Treat its detail as incomplete. Everything after it is first-hand.
- Pre-existing non-latin passwords, if any exist in the client's database, can no longer be
  typed and need an admin reset.

## 2026-07-29 — Local Docker app restart

**Agent:** Codex
**Trigger:** User requested a restart of the currently running local Docker app for testing.

**Actions outside the repo**
- Restarted `bj-erp-app-1` (image `bj-erp-app:latest`).
- Verified `https://192.168.2.48/login` returns HTTP 200 through the local Caddy gateway.

**State left behind**
- The local app container is running. No application source or configuration was changed.

## 2026-07-29 — Hourly leave visibility diagnosis

**Agent:** Codex
**Trigger:** User could not see hourly leave in the restarted local deployment and asked whether it
was implemented.

**What was found**
- Hourly leave is implemented in the current branch: the `/request/hourly` page, request form,
  server action, SQL migrations, translations, Home/daily-request links, and unit/e2e coverage are
  present.
- The running `bj-erp-app:latest` image was created at `2026-07-29T15:13:29Z`; the hourly feature's
  commits began later, at `2026-07-29T21:34:52-04:00`.
- The running container's compiled Next.js output contains no `request/hourly` route. Restarting
  that container therefore cannot surface the feature; the image must be rebuilt and the
  application/database migrations redeployed.

**Actions outside the repo**
- Read Docker image/container metadata and inspected the app container's compiled route manifests.
  No container or database state was changed during this diagnosis.

**State left behind**
- Local Docker stack remains running on the same old image. No source or deployment changes were
  made.

## 2026-07-29 — Rebuild and local deployment of leave v2

**Agent:** Codex
**Branch / HEAD at start:** `feat/leave-v2-hourly-accrual-replacement` @ `5e26e77`
**Trigger:** User asked to rebuild the local Docker deployment, commit all pending work, and push it
so hourly leave could be tested.

**What changed**
- `package-lock.json` — added the missing npm 10 lock entry for
  `next-intl/node_modules/@swc/helpers@0.5.23`. The production Dockerfile uses npm 10.9.8;
  without this entry its clean `npm ci` stopped before the Next.js build.
- No application or database source was changed. The leave-v2 implementation was already committed
  on this branch.

**Actions outside the repo**
- Preserved the previous image as `bj-erp-app:pre-hourly-20260729`.
- Built `bj-erp-app:latest` from the current branch; image
  `sha256:d1d0364d496dd5f781841d8c299a7ecefee0181e4e4066a46f5b1c7ce0ada8cf`.
- Created and validated database backup `/private/tmp/bj-pre-leave-v2.2P7nKY` (439 KB).
- An attempted replay of all migrations stopped on the first statement (`app_role` already exists);
  it made no change. Exact schema probes then confirmed all leave-v2 migrations, including
  replacement and request serials, were already present, so no migration was required.
- Recreated only `bj-erp-app-1`, reusing the running stack's existing environment. The old app
  container is stopped as `bj-erp-app-rollback-20260729`; database/auth/rest/gateway containers and
  named volumes were not recreated.
- Verified the authenticated local flow in Chrome:
  `/home` → “درخواست مرخصی ساعتی” → `/request/hourly`; Annual and Unpaid leave were offered, and
  changing 07:00–08:00 to 07:00–09:00 updated the preview from one to two hours. No app console
  errors were present. The page was left open for the user.

**Verification**
- Docker production build passed, including TypeScript and the compiled
  `/[locale]/request/hourly` route.
- `npm run test:unit` — 34 files, 208 tests passed.
- `npx eslint app components i18n lib tests scripts proxy.ts` — passed.
- `npm run lint` is polluted by generated `.next` files in the separate
  `.claude/worktrees/peaceful-williams-9c1cf9` worktree; those generated-code failures are unrelated
  to this branch.
- Post-deploy row counts matched pre-deploy: profiles 15, leave_requests 3, leave_ledger 27,
  leave_types 3.
- `https://192.168.2.48/login` returned 200; the protected hourly route redirected unauthenticated
  requests to login as expected.

**State left behind**
- Local app is running the rebuilt `bj-erp-app:latest`; rollback image, stopped container, and
  verified database backup are retained.
- The hourly request page is open in Chrome for local testing.

---

*Entries before 2026-07-29 were never journalled. For that history use `docs/CHANGELOG.md`
(what shipped), `docs/MEMORY.md` (lessons), `.superpowers/sdd/progress.md` (task-level build
ledger), and `git log`.*

## 2026-08-11 — Local Git branch cleanup

**Agent:** Codex
**Trigger:** User requested cleanup to leave only the main branch where safe.

**What changed**
- Deleted fully merged local branches `codex/code-review` (at `1a9589c`) and
  `feat/leave-v2-hourly-accrual-replacement` (at `79e1362`). Both commits are reachable from
  `main`.
- Retained `claude/peaceful-williams-9c1cf9`: it is checked out by a linked worktree with
  uncommitted changes.
