# PERMISSIONS & VISIBILITY

Source of truth for access control. Enforced by **Postgres Row-Level Security (RLS)** — the UI
only mirrors it. Every table holding employee data has policies.

## Roles

| Role | Meaning |
|---|---|
| **admin** | The owner. Full read/write across the company. Override on any decision. |
| **manager** | Leads a team. Reads company-wide time-off; edits/approves **direct reports** only. |
| **employee** | Standard worker. Self-service + own-team visibility. |
| **security** | Security department staff. **Read-only** visibility into **everyone's** calendar. |

A user may hold multiple roles (`user_roles` table). Highest applicable permission wins.

## Visibility matrix (time-off)

| Viewer | Whose time-off can they SEE | Whom can they EDIT / APPROVE |
|---|---|---|
| Employee | Own + **own team** | Self (limited profile fields) |
| Manager | **Everyone** (company-wide, read) | **Direct reports** (edit profile + approve leave) |
| Security | **Everyone** (read-only) | — |
| Admin | Everyone | Everyone (+ override approvals) |

## SQL helpers

```sql
has_role(uid uuid, r app_role) returns bool   -- EXISTS in user_roles
is_admin(uid)        := has_role(uid,'admin')
is_manager_of(uid, target) := EXISTS profile target WHERE target.manager_id = uid
same_team(uid, target)     := (SELECT department_id FROM profiles WHERE id=uid)
                              = (SELECT department_id FROM profiles WHERE id=target)
can_read_all(uid)    := is_admin(uid) OR has_role(uid,'manager') OR has_role(uid,'security')
```
Helpers are `SECURITY DEFINER` functions (with `SET search_path = ''`) to avoid recursive RLS on
`profiles`/`user_roles`. They live in a **`private` schema** that PostgREST does **not** expose, so
they are not callable via `/rest/v1/rpc/*` by `anon`/`authenticated` (closes an info-disclosure
surface); `EXECUTE` is granted to `authenticated` only. Policies reference them as `private.<fn>`.

## Policy intent per table

### `profiles`
- **SELECT**: self · `same_team` · `can_read_all`.
- **UPDATE**: `is_admin` (all fields) · `is_manager_of(target)` (managed subset) · self (own
  limited subset: language/calendar prefs, password handled by Auth, contact fields).
  **Column scope is enforced in the DB** by the `profiles_enforce_update_scope` BEFORE-UPDATE
  trigger (migration 0007) — RLS is row-level only, so without the trigger a manager could PATCH
  any column of a report via the anon key. Non-admins: self → `full_name`/`language_pref`/
  `calendar_pref`; manager-of-row → `full_name`/`hire_date`; `department_id`/`manager_id`/
  `active`/`employee_code`/`company_id` are admin-only.
- **INSERT / deactivate**: `is_admin` only.

### `user_roles`
- **SELECT**: self · `can_read_all`.
- **INSERT/UPDATE/DELETE**: `is_admin` only. (Only the admin changes roles.)
- **Teammate role labels** are surfaced read-only through the `get_my_team_directory()` SECURITY
  DEFINER fn (scoped to the caller's manager + same-department active colleagues) so the Home
  **My Team** card can show role/title context without granting employees broad `user_roles` read
  access. Granted to `authenticated`, revoked from `anon`.

### `departments`, `work_settings`, `holidays`, `leave_types`
- **SELECT**: any authenticated company member.
- **WRITE**: `is_admin` only. The FR-24 admin editor (`/manage/settings`) writes `work_settings` /
  `holidays` **directly** through these policies — no SECURITY DEFINER RPC needed (config tables,
  unlike transactional `leave_*`, are admin-writable by design).

### `leave_allocations`
- **SELECT**: own · `is_manager_of` · `can_read_all`.
- **WRITE**: `is_admin` (managers may be allowed later; v1 = admin sets allocations).

### `leave_requests`
- **SELECT**: own · `same_team` (so employees see their team's calendar) · `can_read_all`.
- **INSERT**: self only, `status='pending'`, for own `employee_id`.
- **UPDATE**:
  - employee may **cancel** own `pending` request, or own `approved` request not yet started
    (`start_date > current_date`) — the latter writes a `reversal` ledger row (FR-15). Cancellation
    runs through the `cancel_leave_request` SECURITY DEFINER fn.
  - `is_manager_of(employee)` may set `approved`/`rejected`.
  - `is_admin` may set any status (override).
- **DELETE**: none (cancel via status; preserve history).

### `leave_ledger`
- **SELECT**: own · `is_manager_of` · `can_read_all`.
- **INSERT**: **server-side only** (SECURITY DEFINER fns — `allocation`, `consumption` on approval,
  `reversal` on approved-future cancel, and `adjustment` when an admin sets an absolute balance via
  `set_leave_balance`). No direct client writes — clients must not fabricate balances.

### `audit_log`
- **SELECT**: `is_admin`.
- **INSERT**: `authenticated` with `WITH CHECK (actor_id = auth.uid())` — a user may only write log
  rows attributed to themselves (server actions set `actor_id` to the acting user). No
  `UPDATE`/`DELETE` policies — append-only.

## Notes

- The "managers see everyone, edit only reports" rule = **broad read, narrow write**. Read uses
  `can_read_all`; write uses `is_manager_of`.
- `same_team` gives employees their team calendar without exposing other teams.
- Validate every policy on **self-hosted Supabase** before production cutover (NFR-4).

## Privileged admin RPCs (runtime user creation)

`public.app_create_employee(...)` and `public.app_set_employee_password(...)` are `SECURITY DEFINER`
functions (search_path locked) that write to `auth.users` / `auth.identities` — work the
`authenticated` role cannot do directly. They **self-guard** with `private.is_admin(auth.uid())`
(non-admin callers get a `42501` exception) and are granted to `authenticated`, revoked from `anon`.
This is the chosen alternative to shipping a `service_role` secret into the app server — it keeps
user creation in-database and **identical on self-hosted Supabase** (portability, NFR-4).
`public.app_change_my_password(p_current, p_new)` (FR-7) follows the same pattern but **self-guards by
`auth.uid()`** — any signed-in user changes *their own* password: it verifies the current password via
`crypt` before updating `auth.users`, and is audited (`change_own_password`).

`public.set_leave_balance(p_employee_id, p_leave_type_id, p_target)` (admin-only; self-guards via
`private.is_admin(auth.uid())`, `42501` otherwise) sets an employee's **current** balance for a leave
type to an absolute value by writing an `adjustment` ledger row (audited `set_leave_balance`); additive
grants still go through `allocate_leave`. Granted to `authenticated`, revoked from `anon`. Used by the
admin employee create/edit forms.

The Supabase security advisor flags these two as exposed `SECURITY DEFINER` functions (lint 0029).
**Accepted by design** — the in-function admin check is the intended gate. Production hardening:
enable Auth "leaked password protection" (advisor `auth_leaked_password_protection`).

## FR-25 — leave `reason` is private (ENFORCED in Phase 3)

A leave request's free-text `reason` may contain medical/personal info, so **teammates must not see
it.** Enforced: `leave_requests` SELECT is restricted to own / `is_manager_of` / `security` / `admin`
(the broad `same_team` read was dropped), and the team calendar reads a reason-less
`team_leave_calendar` SECURITY DEFINER view (scoped `own | same_team | can_read_all`, pending +
approved) that never selects `reason`. Verified on the live DB: a same-team peer reads the view, not
the base row, and no UI exposes another person's reason.
