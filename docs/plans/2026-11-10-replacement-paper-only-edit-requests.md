# Replacement on paper only + Edit requests permissions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A replacement never gains approval authority (FR-90), and approved requests of all four
types can be edited by roles holding per-type "edit request" permissions (FR-91).

**Architecture:** Three forward-only migrations: (A) strip temporary authority from the delegation
functions, (B) add five catalog permissions, (C) generalise `request_corrections` and add one
`app_edit_request` RPC that `app_correct_trip` delegates to. The UI replaces the trip-only Correct
dialog with one Edit dialog and removes replacement-as-delegate copy from the request forms.

**Tech Stack:** Next.js App Router + TypeScript, Postgres (plpgsql, RLS), next-intl (fa + en), Vitest,
psql SQL tests, Playwright.

**Spec:** `docs/specs/2026-11-10-replacement-paper-only-edit-requests-design.md`

## Global Constraints

- Branch `feat/form-signature-boxes` (PR #23). Commit only when the owner asks; the "commit" steps
  below mean "stop here, this is a commit boundary".
- Migrations: new files in `supabase/migrations/` only; forward-only; no RPC the running old app calls
  may change its signature (`app_correct_trip`, `submit_*_v2`, `app_request_delegation_preview`,
  `request_trip_corrections` keep name and parameters; added return columns are fine).
- A migration that redefines a function starts from that function's **current body in
  `supabase/schema.sql`**, not from an older migration (FR-88 and FR-89 both touched shared functions).
- Dry-run every migration on a cloned database before applying it to local `postgres` (CLAUDE.md ›
  "Dry-run migrations first"; the local DB lags `main`, apply `20261102140000`+ to the clone first).
  After applying: restart `bj-erp-rest-1`, `npm run schema:dump`, drop re-parenthesised CHECK hunks.
- SQL tests run as `supabase_admin` on a disposable clone, each file opens and rolls back its own
  transaction; fixtures that insert a second admin `drop index public.user_roles_one_admin;` first.
- Lock order: `private.approval_lock(company)` before `'leave:'||employee`.
- Permission checks: `private.has_perm(uid, key, 'edit')`; admin via `private.is_admin`.
- Strings in `messages/fa.json` and `messages/en.json` (parity test); client components read them with
  `useTranslations`. Amounts as days + hours. Tables `data-table`; no `shadow-*`, no `dark:`.
- `lib/supabase/types.ts` is hand-edited; verify with `npx tsc --noEmit` and `npm run build`.
- The local DB holds the real roster: SQL tests only on a clone; e2e only with `999…` users.

## Verified facts (checked 2026-11-10; do not re-derive)

- Line numbers below are for `supabase/schema.sql` at HEAD `75e5c5f`; find functions by name if they moved.
- **The local stack is the isolated project `bj-approvals-finance`** (`http://localhost:3501`, newest
  live backup, SMS off). There is no `bj-erp-*` stack: wherever this plan says `bj-erp-db-1` /
  `bj-erp-rest-1` read `bj-approvals-finance-db-1` / `bj-approvals-finance-rest-1`. Compose wrapper:
  `.bj-deploy/approvals-finance/compose`. Its `postgres` DB is at this branch's migrations (ledger top:
  `20261109130000`).
- **Builders never write to that stack's `postgres` DB.** Work on a clone, and regenerate
  `supabase/schema.sql` from the clone (the `pg_dump` command of `scripts/dump-schema.sh`, pointed at the
  clone inside `bj-approvals-finance-db-1`). The migrations are applied to `postgres` only after review,
  with `bj_apply_and_record_migration` (`deploy/lib/migrations.sh`, release tag `approvals-finance-local`).
- **Clone for dry-runs and SQL tests** (password = `POSTGRES_PASSWORD` in `.bj-deploy/approvals-finance/.env`; container `bj-approvals-finance-db-1` in place of `bj-erp-db-1` below):
  ```bash
  docker exec -e PGPASSWORD=<pw> bj-erp-db-1 psql -U supabase_admin -d postgres -c 'create database fr91'
  docker exec -e PGPASSWORD=<pw> bj-erp-db-1 sh -c 'pg_dump -Fc -U supabase_admin -d postgres | pg_restore -U supabase_admin -d fr91 --no-owner'
  docker exec -i -e PGPASSWORD=<pw> bj-erp-db-1 psql -U supabase_admin -d fr91 -v ON_ERROR_STOP=1 < supabase/migrations/<file>.sql
  docker exec -i -e PGPASSWORD=<pw> bj-erp-db-1 psql -U supabase_admin -d fr91 < tests/sql/<file>.sql
  docker exec -e PGPASSWORD=<pw> bj-erp-db-1 psql -U supabase_admin -d postgres -c 'drop database fr91'
  ```
  `pg_restore` prints errors for pg_cron/graphql objects only; that is expected. Before Task 1, check
  `select max(version) from bj_deploy.schema_migrations` in the clone and apply any migration file newer
  than it, in order.
- **Triggers on `leave_requests`:** `approval_request_authority_lock` (takes the company lock),
  `approval_request_source_lifecycle`, `leave_requests_per_diem_daily_only` (per diem only on a daily
  errand: clear it in the **same** `UPDATE` that sets `unit = 'hour'`),
  `leave_requests_requester_has_time_off` (status only), `replacement_signoff_sync` (replacement_id
  only), `travel_booking_open` (status only). **None blocks changing `unit`, times or dates on an
  approved row.**
- **`approval_delegations`** has only `approval_authority_lock` (takes the lock itself); a plain
  `UPDATE … SET revoked_at` in a migration works.
- **`role_permissions`** has `role_permissions_guard` + `approval_authority_lock`. For the `hr` grant
  copy the insert pattern of the migration that granted `('procurement','travel_booking','edit')`
  (`grep -ln "'travel_booking'" supabase/migrations/`).
- **Preset seeding function:** `private.seed_company_roles(p_company uuid)` (~line 2936).
- **Travel tick = a `travel_bookings` row.** "Procurement has started" = `first_saved_at is not null or
  done_at is not null` (as `app_travel_ticks` computes `started`). `opened_at` is set as soon as the
  request is approved, so it does **not** mean started.
- **Ledger:** enum `public.ledger_entry` has `'adjustment'`; approval posts one `consumption` row of
  `-(requested_minutes - unpaid_minutes)` with `request_id` (function containing
  `'paid portion consumed on approval'`, ~line 1613). Balance = `public.current_leave_balance(employee, leave_type)`.
- **Submit checks to mirror** live in `private.submit_leave_impl` (~lines 3660–3800): hourly rules,
  one-hourly-per-day, overlap predicate, `compute_requested_minutes`.
- **`RequestReviewActions` is rendered in three places:** `manage/requests/RequestsReview.tsx:228`,
  `manage/approvals/ApprovalQueue.tsx:296` (pending rows: never editable, pass nothing new),
  `manage/approvals/ApprovalHistory.tsx:152`. `manage/requests/page.tsx` only redirects to
  `/manage/approvals`; data loads in `ApprovalsData` in `manage/approvals/page.tsx` (beside
  `getTravelTicks()`).
- **Message key layout:** role editor reads `permissions.sections.<SectionKey>` and
  `permissions.items.<PermKey>.label|description` (`en.json` ~1703–1800). Trip-correction copy is
  `travel.correction.*` (~2034). DB error keys sit beside `tripCorrectNotAllowed` (grep it in both
  message files); the regex table is `lib/errors/db-error.ts` ~line 170.
- **Form parts to reuse:** `DateRangeFields`, `TimeRangeFields` exported from
  `app/[locale]/(app)/request/_components/FormParts.tsx`.
- **Print page** already merges extensions and corrections at `print/request/[id]/page.tsx:108` and
  renders them at `:268` (`print-correction` test id).

## Suggested model per task

Tasks 1, 2, 4, 6: Sonnet (medium). Task 3 (ledger maths, locks, gate): Sonnet (high) or Opus (low).
Task 5: Sonnet (high). Each task is self-contained given this file and the spec; run them in order.

## Review Focus

1. A manager with a **pending** (not yet approved) own leave naming an eligible replacement: the
   replacement still cannot approve anything, before, during or after the dates. → Task 1 test.
2. An editor holding only `edit_leave_daily` tries daily → hourly: refused (needs both). → Task 3 test.
3. A leave edit that shrinks a request with an existing unpaid part must return paid time correctly and
   never post a positive ledger row larger than what the request consumed. → Task 3 test.
4. Legacy `request_corrections` rows (pre-migration, trip dates only) must still print and list
   correctly beside new-shape rows. → Task 5 test.
5. A role without any toggle calling the old `app_correct_trip` directly (old app, or by hand) is
   refused, including a former HR-holder's delegate. → Task 3 test.

---

### Task 1: FR-90 database — no temporary authority from a replacement

**Files:**
- Create: `supabase/migrations/20261110100000_replacement_paper_only.sql`
- Create: `tests/sql/replacement-paper-only.sql`
- Modify: `tests/sql/approval-delegation.sql` (assertions that expect a temporary grant)
- Modify: `supabase/schema.sql` (regenerated)

**Interfaces:**
- Produces: `app_request_delegation_preview(...)` unchanged signature; in its JSON `temporary` is
  always `null`, `temporary_eligible` always `false`, `temporary_delegate_name` always `null`.
  `p_temporary_ceo_authorized` on `private.enroll_request_delegation` and every `submit_*_v2` is
  accepted and ignored.

- [ ] **Step 1: Write `tests/sql/replacement-paper-only.sql`** (header and `pg_temp.fx/login/as_scalar/expect`
  helpers copied from `tests/sql/replacement-signoff.sql`). Fixture: CEO `ceo`, managers `m` and `r`
  (both eligible approvers; `r` in another department), `s` saved delegate of `m`, employee `e`
  reporting to `m`. Assertions:
  - `m` files daily leave naming `r`, fully approved → `select count(*) from approval_delegations where source_request_id = <id>` = `0`.
  - same while `m`'s leave is still pending → `0`.
  - During `m`'s approved absence, `e` files leave: `r` calling `approve_leave_request_steps` → `ERROR 42501 …`; `m` calling it → succeeds; a second request approved by `s` (saved delegate) → succeeds.
  - `app_request_delegation_preview(..., p_replacement_id := r)` as `m` → `temporary_eligible` = `false`, `temporary` is null.
  - `ceo` files leave naming an eligible replacement with `p_temporary_ceo_authorized := false` → returns a request id (no `temporary CEO delegation authorization required`).
  - A half-day leave by `m` naming `r` with `p_delegation_preview := null` → succeeds (no `delegation preview required`).
  - `r` declines the sign-off; `m` calls `app_change_replacement(<id>, <other eligible approver>)` → succeeds.
  - A pre-existing temporary grant row inserted before the migration's revoke statement is re-run in the test (`update … set revoked_at`) → `private.effective_approval_delegate(m)` returns no row with `source_request_id`.
- [ ] **Step 2: Run on a clone without the migration.** `psql -d <clone> -f tests/sql/replacement-paper-only.sql` → expect `FAIL` on the first assertion (count is `1`).
- [ ] **Step 3: Write the migration.** `create or replace` from the current `schema.sql` bodies:
  - `private.enroll_request_delegation`: delete the `day_part<>'full' … delegation preview required` check and the whole `if r.replacement_id is not null and private.delegate_eligible(…) then … end if;` block that inserts into `approval_delegations`. Keep the policy snapshot and the CEO-delegate auto-approval part.
  - `public.app_request_delegation_preview`: `v_temporary := false`; keep every JSON key.
  - `public.app_change_replacement`: delete the `replacement is the temporary approval delegate` refusal.
  - `update public.approval_delegations set revoked_at = now() where source_request_id is not null and revoked_at is null;` (the table's own trigger takes the company lock).
  - Leave `private.approval_source_lifecycle` untouched: with no un-revoked source grants it does nothing.
  - Leave `get_replacement_candidates` and the replacement check in `private.submit_leave_impl` as they are (picker population unchanged).
- [ ] **Step 4: Apply to the clone, run** `tests/sql/replacement-paper-only.sql`, `approval-delegation.sql`, `replacement-signoff.sql`, `sign-once.sql`, `stranded-request.sql` → every line `PASS`. Update only the `approval-delegation.sql` assertions that asserted temporary authority; each changed assertion now asserts its absence.
- [ ] **Step 5: Apply to local `postgres`, restart `bj-erp-rest-1`, `npm run schema:dump`.** `git diff supabase/schema.sql` shows only the three functions.
- [ ] **Step 6: Commit boundary** — `feat(delegation): a replacement never gains approval authority (FR-90)`.

### Task 2: FR-90 request forms — remove replacement-as-delegate copy

**Files:**
- Modify: `app/[locale]/(app)/request/_components/RequestDelegationFields.tsx`
- Modify: `app/[locale]/(app)/request/_components/useRequestForm.ts` (lines ~150–215)
- Modify: `lib/leave/delegation.ts` (comment only: `temporary*` fields are always empty since FR-90)
- Modify: `messages/en.json`, `messages/fa.json` (`delegation.*`)
- Test: `tests/unit/request-delegation.test.tsx`

**Interfaces:**
- Consumes: Task 1's preview JSON.
- Produces: `DelegationSubmissionInput.temporaryCeoAuthorized` stays in the type and is always `false`
  (`lib/actions/leave/requests.ts` is untouched).

- [ ] **Step 1: Update `tests/unit/request-delegation.test.tsx`.** New/changed cases:
  - approver with a saved delegate → text of `delegation.savedContinues` shown; with a replacement picked the same line shows (no `workCoverFallback`).
  - approver without a saved delegate → no `…-approval-cover` and no `…-no-approval-delegate` test id in the document; the return-to-work line still renders.
  - a preview with `is_ceo: true, temporary_eligible: true` (stale old shape) → no `…-temporary-ceo-authorized` checkbox, and `submitBlocker` is null.
  - CEO-delegate case (`auto_approval_eligible: true`) unchanged: consent checkbox required.
- [ ] **Step 2: Run** `npx vitest run tests/unit/request-delegation.test.tsx` → the new cases fail.
- [ ] **Step 3: Implement.** In `RequestDelegationFields`: `concernsApprover = (preview.can_approve && !!preview.saved) || preview.auto_approval_eligible`; the cover box renders only `savedContinues`; delete the temporary branch, the amber warning, the `configureDelegate` / `contactAdmin` lines, the temporary CEO checkbox, and the `hasReplacement` prop (remove it at the call sites). In `useRequestDelegation`: delete `temporaryConsent` state and the `temporaryConsentRequired` blocker; return `temporaryCeoAuthorized: false`.
- [ ] **Step 4: Messages.** Delete from `delegation` in both files: `temporary`, `temporaryConditions`, `savedResumes`, `noSavedFallback`, `workCoverFallback`, `noDelegateWarning`, `workCoverWarning`, `configureDelegate`, `contactAdmin`, `temporaryCeoAuthorization`, `temporaryConsentRequired` (grep each key first; keep any still used elsewhere, e.g. by `DelegationPanel`). Set `replacementHint` to en `"Choose who covers your work while you are away. The replacement signs the form; your approvals stay with you."` / fa `«کسی را که در نبود شما کارتان را پوشش می‌دهد انتخاب کنید. جانشین فرم را امضا می‌کند؛ تأییدها با خود شما می‌ماند.»`
- [ ] **Step 5: Run** `npx vitest run tests/unit/request-delegation.test.tsx tests/unit/messages-parity.test.ts tests/unit/replacement-picker.test.tsx && npx tsc --noEmit` → pass.
- [ ] **Step 6: Commit boundary** — `feat(request): replacement field no longer talks about approvals (FR-90)`.

### Task 3: FR-91 database — permissions, storage, `app_edit_request`

**Files:**
- Create: `supabase/migrations/20261110110000_edit_request_permissions.sql`
- Create: `supabase/migrations/20261110120000_request_edit.sql`
- Create: `tests/sql/request-edit.sql`
- Modify: `tests/sql/trip-correction.sql` (gate expectations), `tests/sql/fr55-roles-permissions.sql` if it counts keys
- Modify: `supabase/schema.sql` (regenerated)

**Interfaces:**
- Produces (SQL):
  - Permission keys `edit_leave_daily`, `edit_leave_hourly`, `edit_errand_daily`, `edit_errand_hourly`, `edit_requests_own`; each allows only level `edit`; each has dep row `(<key>,'read','leave_requests')`.
  - `private.request_edit_key(p_kind public.request_kind, p_unit public.leave_unit) returns text` — `'edit_' || p_kind || '_' || case p_unit when 'day' then 'daily' else 'hourly' end`.
  - `private.can_edit_request(p_uid uuid, p_request uuid, p_new_unit public.leave_unit) returns boolean` — same company and active caller, and: admin; or holds the key of the request's current type **and** of `(kind, p_new_unit)`, and (`employee_id <> p_uid` or holds `edit_requests_own`).
  - `public.app_edit_request(p_request uuid, p_unit public.leave_unit, p_start date, p_end date, p_day_part public.day_part, p_start_time time, p_end_time time, p_per_diem_rials bigint, p_reason text, p_signature_data text, p_signature_authorized boolean) returns uuid` (the `request_corrections.id`). All shape parameters are the full target values; `p_per_diem_rials` null = unchanged.
  - `public.app_my_request_edit_types() returns text[]` — the catalog keys among the five the caller holds (admin: all five).
  - `request_corrections` new columns: `old_unit`, `new_unit` (`leave_unit`, not null, default `'day'`), `old_day_part`, `new_day_part` (`day_part`, not null, default `'full'`), `old_start_time`, `new_start_time`, `old_end_time`, `new_end_time` (`time`, null), `minutes_before`, `minutes_after` (`integer`, null on legacy rows).
  - `request_trip_corrections(p_id)` and `private.request_data_request_trip_corrections(p_id, p_print)` return those ten columns after the existing ones (drop + recreate, grants restored).
  - Error messages (errcode `22023` unless noted): `not allowed to edit this request` (42501), `only an approved request can be edited`, `nothing to edit`, `an edit cannot make leave unpaid`, `procurement has started booking this trip`, plus the existing submit messages reused verbatim: `overlapping leave request exists`, `hourly leave exceeds the daily limit`, `only one hourly leave per day`, `times must fall within working hours`, `end time must be after start time`, `this leave type cannot be taken hourly`, `an extension is waiting for HR`, `signature is required`, `a reason is required`, `reason is too long`, `per diem must be 0 or more`, `requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)`.

- [ ] **Step 1: Write `tests/sql/request-edit.sql`.** Fixture: admin, role `ed_all` (four type keys), role `ed_daily` (`edit_leave_daily` only), role `ed_own` (four + `edit_requests_own`), plain `hr`-preset holder, a delegate of that holder with no toggle, employee `e` with 5 days annual balance (480-minute days), work hours 07:00–15:00, cap 240. Assertions, one `expect` each:
  - **Gate:** no toggle → `ERROR 42501 not allowed to edit this request`; `ed_daily` editing dates of a daily leave → ok; `ed_daily` daily→hourly → 42501; `ed_all` on own approved request → 42501; `ed_own` on own → ok; admin on own → ok; pending / rejected / cancelled request → `only an approved request can be edited`; other company → 42501.
  - **Old path:** the delegate (no toggle) calling `app_correct_trip` → `ERROR 42501`; the `hr` preset holder (granted by migration) → ok; `app_correct_trip` on an hourly errand → still `only an approved daily trip can be corrected`.
  - **Daily leave shrink** 3 days → 2 days: `requested_minutes` 960; ledger gains one `adjustment` row `+480` with `request_id` set; `current_leave_balance` up by 480; `request_corrections` row has `minutes_before` 1440, `minutes_after` 960, `old_unit`=`new_unit`=`day`.
  - **Daily leave grow** within balance: ledger `adjustment` row negative by the difference.
  - **Grow past balance:** → `an edit cannot make leave unpaid`; nothing written.
  - **Shrink with unpaid part** (request 7 days filed on a 5-day balance: paid 2400, unpaid 960; edit to 6 days): `unpaid_minutes` 480, no ledger row; edit to 4 days: `unpaid_minutes` 0, ledger `+480`.
  - **Non-balance leave type** (unpaid type): `unpaid_minutes` = new minutes, no ledger row.
  - **Daily → hourly leave** (1 day → 09:00–11:00): `unit` `hour`, `day_part` `full`, times set, `requested_minutes` 120, ledger `+360`; replacement and all signature columns unchanged; `leave_request_approvals` rows unchanged (count and `decided_at`).
  - **Hourly → daily leave:** balance check as above; a leave type with `allow_hourly = false` daily→hourly → `this leave type cannot be taken hourly`.
  - **Hourly limits:** 5 hours → `hourly leave exceeds the daily limit`; outside 07:00–15:00 → `times must fall within working hours`; another hourly leave that day → `only one hourly leave per day`.
  - **Overlap:** new range touching another pending or approved request of `e` → `overlapping leave request exists`; the request's own old range does not count.
  - **Trip → hourly errand:** `per_diem_rials` null, `per_diem_by_requester` false, row records `per_diem_before`; with `travel_bookings.opened_at` set → `procurement has started booking this trip` when the trip's `travel_bookings` row has `first_saved_at` or `done_at` set; with a pending extension → `an extension is waiting for HR`; a ticked but not started booking row is deleted.
  - **Hourly errand → trip** with `p_per_diem_rials := 500000`: `unit` `day`, per diem saved, no ledger row.
  - **Trip dates via `app_edit_request`:** behaves as `app_correct_trip` (booking `done_at` cleared when opened).
  - **Validation:** identical target → `nothing to edit`; empty reason, 1001-char reason, bad signature → their messages; `audit_log` row `request.edit` holds no `data:image`.
  - **Catalog:** inserting `role_permissions(permission='edit_leave_daily', level='read')` is refused; the `hr` preset role has the four type keys and not `edit_requests_own`; `private.seed_role_presets`-style function for a new company grants the same.
  - **`app_my_request_edit_types()`:** `ed_daily` → `{edit_leave_daily}`; admin → all five; plain employee → `{}`.
- [ ] **Step 2: Run on a clone** → `FAIL` (function `app_edit_request` does not exist).
- [ ] **Step 3: Migration `…110000_edit_request_permissions.sql`.** Redefine `private.permission_keys()` (26 keys), `permission_allows` (five new keys in the edit-only list), `permission_deps()` (five new rows), the preset-seeding function (the one containing `('procurement','travel_booking','edit')`; add the four `hr` rows), and insert the four keys for every existing role with `system_key = 'hr'`. Add `private.request_edit_key`, `private.can_edit_request`, `public.app_my_request_edit_types` (grant execute to `authenticated`). No legacy `has_permission` mapping (the old app has no such key).
- [ ] **Step 4: Migration `…120000_request_edit.sql`.**
  - `alter table public.request_corrections add column …` as in Interfaces; relax nothing else.
  - `private.edit_request_impl(p_uid uuid, p_request uuid, p_unit, p_start, p_end, p_day_part, p_start_time, p_end_time, p_per_diem_rials, p_reason, p_signature_data, p_signature_authorized) returns uuid`, `security definer`, `search_path ''`. Order: read row → gate → validate signature/reason → `approval_lock` → employee advisory lock → re-read `for update` → re-check gate and `status = 'approved'` → shape rules → checks → write. Shape rules: errand day = no times, `day_part` `full`; hour (either kind) = `p_start = p_end`, times required, `day_part` `full`; leave day = no times. Per diem: only when the target is an errand day; trip → hourly clears it. Minutes via `public.compute_requested_minutes(company, start, end, day_part, unit, start_time, end_time, kind)`. Overlap: the predicate of `private.submit_leave_impl` with `r.id <> p_request`, plus `private.extension_overlaps` for a day-unit errand target. Hourly-leave rules: the same statements as `submit_leave_impl`, excluding the request itself.
  - Balance algorithm (leave type with `affects_balance`):

    ```
    old_paid   := requested_minutes - unpaid_minutes          -- what the request consumed
    available  := greatest(current_leave_balance, 0) + old_paid
    new_paid   := least(new_minutes, available)
    new_unpaid := new_minutes - new_paid
    if new_unpaid > unpaid_minutes then raise 'an edit cannot make leave unpaid'
    delta      := old_paid - new_paid                         -- >0 returns time
    if delta <> 0 then insert leave_ledger(entry_type 'adjustment', delta_minutes delta,
                         balance_after_minutes current+delta, request_id, note 'request edited')
    ```
    Leave type without `affects_balance` and not paid: `unpaid_minutes := new_minutes`; otherwise `0`.
  - Write: insert the `request_corrections` row (all before/after values), update `leave_requests` (`start_date, end_date, unit, day_part, start_time, end_time, requested_minutes, unpaid_minutes, per_diem_rials, per_diem_by_requester`), booking handling as `app_correct_trip` does today for date changes (day → day only), on trip → hourly delete the not-started `travel_bookings` row, audit `request.edit` with before/after and no signature bytes.
  - `public.app_edit_request(...)` = `private.edit_request_impl(auth.uid(), …)`; grant to `authenticated`.
  - `public.app_correct_trip` (same signature): keep its `only an approved daily trip can be corrected` pre-check, then call the impl with `p_unit 'day'`, `coalesce(p_new_start, start_date)`, `coalesce(p_new_end, end_date)`, `'full'`, null times.
  - Drop `private.can_correct_trip` after replacing its two uses.
  - Recreate `private.request_data_request_trip_corrections` and `public.request_trip_corrections` with the added columns; restore grants; check the print-JSON function that aggregates it (`schema.sql` ~7086) still compiles.
- [ ] **Step 5: Apply both to the clone; run** `request-edit.sql`, `trip-correction.sql`, `travel-booking.sql`, `travel-itinerary.sql`, `fr55-roles-permissions.sql`, `balance-add.sql`, `hr-head-own-per-diem.sql` → all `PASS`. In `trip-correction.sql` change only gate expectations (delegate now refused; own-trip refusal message is now `not allowed to edit this request`).
- [ ] **Step 6: Apply to local `postgres`, restart `bj-erp-rest-1`, `npm run schema:dump`.**
- [ ] **Step 7: Commit boundary** — `feat(requests): per-type edit permissions and app_edit_request (FR-91)`.

### Task 4: FR-91 catalog, types, server action

**Files:**
- Modify: `lib/permissions/catalog.ts`
- Modify: `messages/en.json`, `messages/fa.json` (role editor: section label + five items, same key layout as `travel_booking` at `en.json:1791` and the `sections` maps at `:1445` / `:1705`)
- Modify: `lib/supabase/types.ts` (`app_edit_request`, `app_my_request_edit_types`, `request_trip_corrections` row, `request_corrections` table)
- Create: `lib/leave/requestEdit.ts`
- Create: `lib/actions/leave/edit.ts`
- Modify: `lib/errors/db-error.ts` (+ `tests/unit/db-error.test.ts`)
- Modify: `lib/actions/travel.ts` (delete `correctTrip`)
- Test: `tests/unit/permissions-catalog.test.ts`, `tests/unit/role-editor.test.tsx`, `tests/unit/permission-section.test.tsx`, create `tests/unit/request-edit.test.ts`

**Interfaces:**
- Consumes: Task 3 RPCs.
- Produces:
  - `PermKey` gains the five keys; `SectionKey` gains `'requestEdits'`; `SECTIONS` gains `{ key: 'requestEdits', items: ['edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly','edit_requests_own'] }` placed after `leave`; `SHAPES` all `'E'`; `DEPENDENCIES` five rows `{ key, keyLevel: 'read', needs: 'leave_requests' }`.
  - `lib/leave/requestEdit.ts`:
    ```ts
    export type EditKey = 'edit_leave_daily' | 'edit_leave_hourly' | 'edit_errand_daily' | 'edit_errand_hourly' | 'edit_requests_own';
    export type RequestShape = { kind: 'leave' | 'errand'; unit: 'day' | 'hour' };
    export function editKeyFor(s: RequestShape): EditKey;
    /** Units the viewer may save this request as; empty = no Edit button. */
    export function editableUnits(
      r: RequestShape & { status: string; employee_id: string },
      viewer: { id: string; keys: readonly EditKey[] }
    ): ('day' | 'hour')[];
    ```
    The admin needs no flag: `app_my_request_edit_types()` returns all five keys for an admin.
    Rules mirror `private.can_edit_request`: approved only; own request needs `edit_requests_own`; current-type key required; the other unit is offered only with that key too. Current unit first in the result.
  - `lib/actions/leave/edit.ts`:
    ```ts
    export async function getRequestEditKeys(): Promise<EditKey[]>;            // [] on error
    export async function editRequest(input: {
      requestId: string; unit: 'day' | 'hour'; start: string; end: string;
      dayPart: 'full' | 'am' | 'pm'; startTime: string | null; endTime: string | null;
      perDiemRials: number | null; reason: string; signatureData: string; signatureAuthorized: boolean;
    }): Promise<{ ok: true } | DbErrorResult>;
    ```
    Both start with `requireCaller()`; `editRequest` ends with `invalidateAppCache()`.

- [ ] **Step 1: Tests first.** `permissions-catalog.test.ts`: `ALL_KEYS` length `26`; the SQL-match cases pass unchanged against the new dump. `request-edit.test.ts` for `editableUnits`: pending → `[]`; own without own-key → `[]`; own with it → units; all five keys on own daily leave → `['day','hour']`; only daily key on daily leave → `['day']`; both leave keys on hourly leave → `['hour','day']`; leave keys on an errand → `[]`. `db-error.test.ts`: `not allowed to edit this request` → `requestEditNotAllowed`; `only an approved request can be edited` → `requestEditNotApproved`; `nothing to edit` → `requestEditNothing`; `an edit cannot make leave unpaid` → `requestEditUnpaid`; `procurement has started booking this trip` → `requestEditBookingStarted`. Remove the `tripCorrectNotAllowed` and `tripCorrectNothing` rows and their messages (those texts are no longer raised); keep `tripCorrectWrongRequest`, `tripCorrectExtensionWaiting`, `tripCorrectDates`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/permissions-catalog.test.ts tests/unit/request-edit.test.ts tests/unit/db-error.test.ts` → fail.
- [ ] **Step 3: Implement** catalog, `requestEdit.ts`, action, types, error mappings, messages. Role-editor copy (en; write natural Farsi equivalents): section `"Edit requests"`; `"Edit daily leave"` / `"Edit hourly leave"` / `"Edit daily work trips"` / `"Edit hourly work errands"`, each described `"Change the dates or times of an approved request of this type. Switching between daily and hourly needs both permissions."`; the trip one adds `"Includes the per diem."`; `"Edit own requests"` — `"Lets the holder edit their own approved requests, for the types they may edit."` Error copy (en): `requestEditNotAllowed` "You are not allowed to edit this request." · `requestEditNotApproved` "Only an approved request can be edited." · `requestEditNothing` "Nothing was changed." · `requestEditUnpaid` "This change needs more leave than the balance holds. An edit cannot make leave unpaid." · `requestEditBookingStarted` "Procurement has already started booking this trip, so it cannot become an hourly errand." 
- [ ] **Step 4: Run** the three files plus `role-editor`, `permission-section`, `permissions-can`, `edit-capabilities`, `messages-parity`, then `npx tsc --noEmit` → pass (expect compile errors only in `CorrectTripDialog.tsx`, fixed in Task 5; if so run `tsc` at the end of Task 5).
- [ ] **Step 5: Commit boundary** together with Task 5.

### Task 5: FR-91 UI — Edit dialog, request details, print lines

**Files:**
- Create: `app/[locale]/(app)/manage/requests/EditRequestDialog.tsx`
- Delete: `app/[locale]/(app)/manage/requests/CorrectTripDialog.tsx`
- Modify: `app/[locale]/(app)/manage/requests/RequestReviewActions.tsx`, `RequestsReview.tsx`; `app/[locale]/(app)/manage/approvals/page.tsx`, `ApprovalHistory.tsx`
- Modify: `lib/travel/extensions.ts` (`RequestCorrection` type + `printedTripDates`; delete `canCorrectTrip`)
- Create: `lib/leave/requestChanges.ts`
- Modify: `lib/actions/leave/progress.ts`, `app/[locale]/(app)/request/_components/RequestDetails.tsx`, `app/[locale]/(print)/print/request/[id]/page.tsx`
- Modify: `messages/en.json`, `messages/fa.json`
- Test: create `tests/unit/request-changes.test.ts`, `tests/unit/edit-request-dialog.test.tsx`; update `tests/unit/requests-review-travel.test.tsx`, `tests/unit/paper-form.test.ts`, `tests/unit/progress-extensions.test.tsx`, `tests/unit/procurement-corrected.test.tsx`

**Interfaces:**
- Consumes: `editableUnits`, `EditKey`, `editRequest`, `getRequestEditKeys` (Task 4).
- Produces:
  - `RequestCorrection` gains `old_unit, new_unit, old_day_part, new_day_part, old_start_time, new_start_time, old_end_time, new_end_time, minutes_before, minutes_after` (times and minutes nullable).
  - `lib/leave/requestChanges.ts`:
    ```ts
    export type RequestSnapshot = { unit: 'day'|'hour'; start: string; end: string; dayPart: 'full'|'am'|'pm';
      startTime: string|null; endTime: string|null; minutes: number|null; perDiem: number|null };
    export type RequestChange = { at: string; by: string|null; reason: string; before: RequestSnapshot; after: RequestSnapshot };
    /** Signed (first `before`, or the current request when no edits) and every later edit, oldest first. */
    export function requestChanges(current: RequestSnapshot, corrections: RequestCorrection[]):
      { signed: RequestSnapshot; changes: RequestChange[] };
    ```
  - `RequestReviewActions` props: optional `editKeys?: readonly EditKey[]` (default `[]`); Edit no longer depends on `travelTicks`; the early `return null` for the viewer's own row stays for tick and cancel but not for Edit. `ReviewActionRequest` additionally picks `day_part`, `start_time`, `end_time`.
  - New message namespace `requestEdit` (en; write natural Farsi): `open` "Edit" · `title` "Edit this request" · `body` "Change the dates or times. The signed form keeps its original values and lists this edit." · `unitDay` "Daily" · `unitHour` "Hourly" · `date` "Date" · `reason` "Reason for the edit" · `reasonRequired` "Write why this request is being edited." · `submit` "Save edit" · `historyTitle` "Edits" · `line` "{before} → {after}" · `by` "Edited by {name} on {date}" · `printLine` "Edited to {after}". Per diem label, hint and invalid text: reuse `travel.correction.perDiemLabel|perDiemHint|perDiemInvalid`. Delete the `travel.correction` keys that only `CorrectTripDialog` used (grep each before deleting).

- [ ] **Step 1: Tests first.**
  - `request-changes.test.ts`: no corrections → `signed` = current, `changes` = `[]`; two edits out of order in input → sorted, `signed` = oldest `before`; legacy row (`minutes_before` null, units default `day`) → snapshot with `minutes: null`; a day→hour edit → `before.unit` `day`, `after.unit` `hour` with times.
  - `edit-request-dialog.test.tsx`: daily leave, units `['day']` → no daily/hourly switch, start + end + day-part fields, no per diem; units `['day','hour']` → switch; choosing hourly shows one date + two time fields and hides day part; daily trip → per diem field; hourly errand → none; Save disabled until something changed, reason non-empty and signature present; submit calls `editRequest` with the full target shape (assert the exact object).
  - `requests-review-travel.test.tsx`: Edit button on an approved daily leave for `editKeys ['edit_leave_daily']`; none with `[]` or when the prop is omitted; none on a pending row; own row only when `editKeys` also has `edit_requests_own`.
  - `paper-form.test.ts` / print: a leave with one edit prints the signed dates and one change line; a trip with an extension and an edit keeps today's order.
- [ ] **Step 2: Run them** → fail.
- [ ] **Step 3: Implement.** `EditRequestDialog` follows `CorrectTripDialog`'s structure (dialog, `PersianDateField`, saved-signature support, error line) and reuses the time inputs and day-part control from `request/_components/FormParts`. Button label `Edit` / «ویرایش». `ApprovalsData` in `manage/approvals/page.tsx` loads `getRequestEditKeys()` in the same `Promise.all` as `getTravelTicks()` and passes `editKeys` to `ApprovalHistory` (→ `RequestReviewActions`) and to `RequestsReview` wherever it is rendered; `ApprovalQueue` passes nothing. `RequestDetails` and Home details: one line per change (`before → after`, reason, editor, time) using `requestChanges` and the existing date / time / days-hours formatters. Print page: all four forms print `signed` values in the body, then the change lines under it (trips keep `printedTripDates`, now tolerant of the wider row); a request whose type changed prints on the form of its current type.
- [ ] **Step 4: Run** `npm run test:unit`, `npx tsc --noEmit`, `npm run lint` → pass.
- [ ] **Step 5: Browser check on the local stack** (live-backup DB, SMS off): as the local test account with a temporary custom role, edit one approved request of a `999…` e2e user or use the isolated demo stack (`bj-dev-isolated`); confirm dialog, details line and print form in fa and en; screenshot.
- [ ] **Step 6: Commit boundary** — `feat(requests): edit approved requests of all four types (FR-91)`.

### Task 6: e2e, full verification, docs

**Files:**
- Modify: `tests/e2e/hr-role.spec.ts` (Correct → Edit), create `tests/e2e/request-edit.spec.ts` (own `999…` users)
- Modify: `docs/REQUIREMENTS.md`, `docs/PERMISSIONS.md`, `docs/DATA_MODEL.md`, `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/AGENT-LOG.md`, `CLAUDE.md` (gotchas), move this plan to `docs/archive/` when done

- [ ] **Step 1: `request-edit.spec.ts`:** a `999…` HR user edits a `999…` employee's approved daily leave to hourly; the employee's request page shows the edit line; a `999…` user without the toggle sees no Edit button.
- [ ] **Step 2: Run** `npm run lint && npx tsc --noEmit && npm run test:unit && npm run build`, the SQL test files of Tasks 1 and 3 on a fresh clone of the migrated local DB, and `npx playwright test tests/e2e/request-edit.spec.ts tests/e2e/hr-role.spec.ts --workers=1`; then `npm run cleanup:e2e`. All green.
- [ ] **Step 3: Docs.** REQUIREMENTS: FR-28 amendment (replacement confers nothing), strike the "temporary authority" sentences in the delegation amendment, FR-84 gate note, new FR-90 and FR-91. PERMISSIONS: "Temporary authority" paragraph removed, trip-corrections gate rewritten, five keys in the catalog table. DATA_MODEL: `request_corrections` columns, ledger `adjustment` on edit. CHANGELOG, TASKS, AGENT-LOG entry. CLAUDE.md one-liners: "Replacement confers no approval authority (FR-90); only saved delegates do" and "Editing approved requests = `app_edit_request` + `edit_*` keys; `app_correct_trip` is a wrapper kept for the old app".
- [ ] **Step 4: Commit boundary** — `docs: FR-90, FR-91` with `[skip ci]` only if it is not the last commit of the push.
