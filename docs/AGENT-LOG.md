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
