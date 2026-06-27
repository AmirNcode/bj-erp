# Design Spec — HR / Time-Off Phase 6 (Admin Settings, Password Change, Cancel-Approved)

- **Date**: 2026-06-25
- **Status**: Approved (design). Implementation plan pending.
- **Module / phase**: HR → Time-Off, **Phase 6** (post-v1 completion). Builds on Phases 0–5; branch
  `feat/hr-phase6`.

Frozen point-in-time record. Living detail: `docs/PLAN.md` §5, `docs/REQUIREMENTS.md`,
`docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`.

---

## 1. Context & problem

v1 (Phases 0–5) is feature-complete and demo-ready except three deferred requirements. Phase 6
closes them, leaving no v1 FR outstanding:

- **FR-24** ☐ — Admin can edit **work settings** (weekend days) and the **holiday list**. Tables
  (`work_settings`, `holidays`) exist and **already carry admin `INSERT/UPDATE/DELETE` RLS policies**
  (leave migration L159–182, guarded by `private.is_admin`); only the admin **UI** is missing.
- **FR-7** ◐ — Login is admin-issued username + password. Admin can reset a password
  (`app_set_employee_password`); the user has **no self-service password change**.
- **FR-15** ◐ — Pending-request cancellation shipped in Phase 2. Cancelling an **approved future**
  request (with balance restored) is not implemented.

No new tables, enums, or columns are required: the `ledger_entry` enum already reserves
`reversal`, and `work_settings` / `holidays` already exist. Phase 6 is **functions + actions + admin
UI + docs**, matching the established guarded-RPC convention.

## 2. Current state (verified)

- **Migrations** through `20260624090002_reason_privacy_calendar.sql`. Write-path = guarded
  `SECURITY DEFINER` RPCs; transactional/config tables are SELECT-only for clients.
- `cancel_leave_request(uuid)` (`…120006_leave_fns.sql`) cancels **pending only** (raises on any
  non-pending status); writes no ledger row (pending never consumed balance).
- `approve_leave_request(uuid)` (`…090001`) is the reference pattern for an atomic status flip +
  `consumption` ledger row with a row-count guard against double-debit.
- `app_set_employee_password(uuid, text)` (`…120004_admin_fns.sql`) is the reference pattern for an
  in-DB password write (`crypt`/`gen_salt('bf')`) + audit, no `service_role`.
- `getWorkSettings()` (`lib/actions/leave.ts`) already reads `work_settings.weekend_days` + `holidays`
  client-side → company-scoped SELECT policies exist for both tables.
- Profile/Settings UI (`app/[locale]/(app)/profile/`) holds calendar + language toggles + logout.
- `MyRequestsList.tsx` renders a Cancel button on pending requests only.
- Seeded demo: `work_settings.weekend_days = {5}` (Friday); minimal placeholder holidays; password
  `Demo!2026`.

## 3. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| P6-1 | Cancel-approved workflow (FR-15) | **Employee cancels directly**, no approval step; auto-reverse balance | User choice; least friction for the labourer. Manager exceptions still possible via admin. |
| P6-2 | Cancel-approved cutoff | Allowed only while **`start_date > current_date`** (not yet started) | User choice; "future" leave only. Full `requested_days` reverses — no partial-day math. |
| P6-3 | Cancel-approved implementation | **Extend `cancel_leave_request(uuid)`** (`create or replace`), not a new RPC | One RPC, one `cancelRequest` action, one Cancel button. Pending path unchanged. |
| P6-4 | Password change scope (FR-7) | **Settings form only**; no forced first-login gate | User choice; smallest scope, no `must_change` flag / redirect / migration. |
| P6-5 | Password change implementation | Guarded RPC **`app_change_my_password(p_current, p_new)`**, verifies current in-DB | Mirrors `app_set_employee_password`; verifies current password (client `auth.updateUser` cannot); portable, audited. |
| P6-6 | Holiday data (FR-24) | **Ship editor only**; keep current minimal placeholder seed; admin enters authoritative dates | User choice; avoids fabricating lunar/religious dates. Real 1404–1405 list entered in-app. |
| P6-7 | FR-24 write-path | **Direct admin writes via the existing RLS policies** on `work_settings`/`holidays`; no new RPC or migration | Both tables already have `is_admin`-guarded INSERT/UPDATE/DELETE policies (leave migration L159–182) — the schema's config-table convention (vs. transactional tables, which are SELECT-only + audited RPCs). Tradeoff (accepted): holiday edits write no `audit_log` row; `work_settings` self-audits via `updated_by`/`updated_at`. |
| P6-8 | FR-24 access | **Admin-only** page under `/manage`; Manager has no access | FR-24 says admin. Manage tab still shows for admin+manager; the settings page guards admin. |

## 4. Scope

FR-24 (work-settings + holiday admin editor), FR-7 (self-service password change), FR-15
(cancel approved future leave + ledger reversal). **2 new SQL migrations (FR-15 + FR-7 functions
only; FR-24 needs none), ~3 server actions, ~4 UI components, a few pure helpers, i18n, docs.** No
tables/enums/columns/RLS-policy changes.

## 5. Architecture & components

### 5.1 FR-15 — Cancel approved future leave

- **SQL** — new migration `…_leave_cancel_approved.sql`, `create or replace function
  public.cancel_leave_request(p_id uuid)`:
  - Fetch `employee_id, status, start_date, leave_type_id, requested_days`. Guard
    `owner = auth.uid() OR private.is_admin(auth.uid())` (unchanged).
  - `status = 'pending'` → atomic flip to `cancelled` (`where id = p_id and status = 'pending'`,
    row-count guard); **no ledger row** (unchanged behaviour).
  - `status = 'approved' AND start_date > current_date` → atomic flip to `cancelled`
    (`where id = p_id and status = 'approved'`, row-count guard); for balance-affecting leave types,
    insert a **`reversal`** ledger row `delta_days = +requested_days`,
    `balance_after = current_leave_balance(emp, type) + requested_days`, note "reversal on cancel".
  - Any other case (approved-and-started/past, rejected, cancelled) → raise `22023`.
  - Audit `cancel_leave_request` with `{status_before, days, reversed: bool}`. Grants unchanged
    (authenticated, self-guarded; anon revoked).
- **TS** — pure `lib/leave/cancellable.ts → isCancellable(status, startDate, today): boolean`
  mirroring the SQL guard (pending → true; approved & start_date>today → true; else false).
  `MyRequestsList.tsx` renders Cancel on eligible rows; an approved-row cancel shows a confirm noting
  the balance will be restored. `cancelRequest` action (`lib/actions/leave.ts`) reused unchanged.

### 5.2 FR-7 — Self-service password change

- **SQL** — new migration `…_self_password_change.sql`,
  `app_change_my_password(p_current text, p_new text)` (`SECURITY DEFINER`, `search_path=''`):
  - `v_uid := auth.uid()`; raise `42501` if null.
  - Verify current: `where id = v_uid and encrypted_password = extensions.crypt(p_current,
    encrypted_password)`; if no match → raise `42501` "current password is incorrect".
  - Server-side length guard (`length(p_new) >= 8`) → raise `22023` if too short.
  - `update auth.users set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')),
    updated_at = now() where id = v_uid`. Audit `change_own_password` (no password value logged).
  - Grants: revoke anon/public; grant `authenticated`.
- **TS** — pure `lib/auth/passwordPolicy.ts → validatePassword(next, confirm)` (min length,
  confirm-match), unit-tested, shared by UI + error copy. `changeMyPassword(current, next)` action in
  `lib/actions/profile.ts`. A **Change-Password** form in `app/[locale]/(app)/profile/` (current / new
  / confirm, client validation + server-error surface, success confirmation). The current session
  stays valid after change.

### 5.3 FR-24 — Admin work-settings + holiday editor

- **SQL** — **none.** `work_settings` and `holidays` already accept admin writes through the existing
  `private.is_admin`-guarded RLS policies (leave migration L159–182).
- **TS** — `lib/actions/settings.ts` (server actions, admin-gated by a `roles.includes('admin')`
  check; the RLS policy is the real enforcement):
  - `getCompanyHolidays()` — SELECT the caller's company holidays.
  - `updateWorkSettings(weekendDays: number[])` — `supabase.from('work_settings').update({
    weekend_days, updated_by: uid }).eq('company_id', companyId)`. Reject input via the pure validator
    before writing.
  - `upsertHoliday({ id?, date, nameFa, nameEn, isRecurring })` — `insert` when `id` is absent, else
    `update().eq('id', id)`; `company_id` set from the caller's profile on insert.
  - `deleteHoliday(id)` — `supabase.from('holidays').delete().eq('id', id)`.
  - Pure `lib/leave/weekend.ts` — `WEEKDAYS` labels + `validateWeekendDays(days)` (every element ∈
    `1..7`, deduped, **not all 7** → at least one working day), unit-tested; used by the action and
    the form.
- **UI** — new admin page `app/[locale]/(app)/manage/settings/page.tsx` (admin guard → redirect/403)
  with `WorkSettingsForm.tsx` (Sat…Fri multi-toggle, ISO weekday ints, default `[5]`) and
  `HolidayEditor.tsx` (list shown Jalali/Gregorian per the admin's `calendar_pref`; add/edit via
  `react-multi-date-picker` honouring `calendar_pref` and **storing Gregorian**; `name_fa`,
  `name_en`, `is_recurring`; delete). Linked from the Manage section, admin-only.

### 5.4 Cross-cutting

- **2 migrations** (FR-15 cancel extension, FR-7 password fn) with sequential timestamps after
  `20260624090002`; regenerate `lib/supabase/types.ts`. FR-24 adds no migration. No
  table/enum/column changes.
- **i18n** — fa/en strings in `messages/` for the password form, settings + holiday editor, and the
  cancel-approved confirm.
- **No retroactive recompute**: changing weekend/holidays affects only *future* day-counting; already
  computed `requested_days` and booked ledger rows are untouched (pending requests keep the count
  computed at submit time; approval reads the stored value).

## 6. Key user flows

1. **Employee** opens My Requests → an approved leave starting in the future shows **Cancel**;
   confirming flips it to cancelled and restores the balance (a `reversal` ledger row). A leave that
   has already started shows no Cancel.
2. **Any user** → Profile → **Change password**: enters current + new + confirm; wrong current →
   error; success → confirmation, session stays signed in; next login uses the new password.
3. **Admin** → Manage → **Settings**: toggles weekend days (e.g. add Thursday) and adds/edits/deletes
   holidays on their preferred calendar; new requests' working-day counts reflect the change. A
   non-admin cannot reach the page.

## 7. Testing (TDD)

- **Unit** — `isCancellable` (pending/approved-future/approved-started/approved-past/rejected/
  cancelled); `validatePassword` (too short, mismatch, ok); `weekend` validation (subset, all-7
  rejected, default).
- **e2e** (serial, `--workers=1`, suite kept idempotent):
  - *Cancel-approved*: create+approve a future request for a seeded employee, employee cancels it →
    row cancelled and the annual balance returns to its prior value; restore seed state.
  - *Password change*: seeded user changes password, logs out, logs in with the new one (wrong-current
    → error path); **restore the original password** at test end to keep the suite idempotent.
  - *Admin settings*: admin adds a holiday / toggles a weekend day and sees it persist; a non-admin is
    blocked from `/manage/settings`; restore seed state.
- Full suite stays green serially.

## 8. Out of scope (Phase 6)

Forced first-login password change (P6-4); manager-approved cancellation flow (P6-1); partial/in-
progress leave cancellation (P6-2); an authoritative pre-seeded 1404–1405 holiday dataset (P6-6 — the
editor is delivered, data is entered in-app). Audit-log rows for holiday/work-settings edits (P6-7 —
config edits use direct RLS writes, matching the schema's convention; `work_settings` self-audits via
`updated_by`). No hourly leave, notifications, or non-HR modules (PLAN §6). No table/enum/RLS-policy
changes.
