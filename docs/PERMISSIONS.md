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

A user may hold multiple roles (`user_roles` table). Highest applicable permission wins. An
inactive profile retains only read access to its own profile shell so the login flow can explain
the disabled state; it has no business-data access and cannot use employee-facing RPCs.

## Visibility matrix (time-off)

| Viewer | Whose time-off can they SEE | Whom can they EDIT / APPROVE |
|---|---|---|
| Employee | Own + **own team** | Self (limited profile fields) |
| Manager | **Everyone** (company-wide, read) | **Direct reports** (edit profile + approve leave) |
| Security | **Everyone** (read-only) | — |
| Admin | Everyone | Everyone (+ override approvals) |

## SQL helpers

```sql
is_active(uid uuid) returns bool              -- active profile exists
has_role(uid uuid, r app_role) returns bool   -- active AND EXISTS in user_roles
is_admin(uid)        := has_role(uid,'admin')
is_manager_of(uid, target) := has_role(uid,'manager')
                              AND same-company target.manager_id = uid
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
- **SELECT**: self · active caller + (`same_team` · `can_read_all`). The self-only inactive row is
  deliberate: it lets the app detect the disabled account and clear its Auth session.
- **UPDATE**: `is_admin` (all fields) · `is_manager_of(target)` (managed subset) · self (own
  limited subset: language preference, password handled by Auth, contact fields).
  **Column scope is enforced in the DB** by the `profiles_enforce_update_scope` BEFORE-UPDATE
  trigger (migration 0007) — RLS is row-level only, so without the trigger a manager could PATCH
  any column of a report via the anon key. Non-admins: self → `full_name`/`language_pref`/
  compatibility-only `calendar_pref` (database-constrained to `jalali`); manager-of-row →
  `full_name`/`hire_date`; `department_id`/`manager_id`/
  `active`/`employee_code`/`company_id` are admin-only. Deactivating the last active admin is
  rejected by a database trigger, and `manager_id = id` is prohibited by a table constraint.
- **INSERT**: no direct client path. Admin/manager creation must use `app_create_employee`, keeping
  Auth, profile, roles, allocations, and audit in one transaction.

### `user_roles`
- **SELECT**: self · `can_read_all`.
- **INSERT/UPDATE/DELETE**: no direct client path. Admins atomically replace roles through
  `app_set_user_roles`, which audits the change and prevents self-lockout.
- **Teammate role labels** are surfaced read-only through the `get_my_team_directory()` SECURITY
  DEFINER fn (scoped to the caller's manager + same-department active colleagues) so the Home
  **My Team** card can show role/title context without granting employees broad `user_roles` read
  access. Granted to `authenticated`, revoked from `anon`.

### `departments`, `work_settings`, `holidays`, `leave_types`
- **SELECT**: any active authenticated company member.
- **WRITE**: `is_admin` only. The FR-24 admin editor (`/manage/settings`) writes `work_settings` /
  `holidays` **directly** through these policies — no SECURITY DEFINER RPC needed (config tables,
  unlike transactional `leave_*`, are admin-writable by design). Same for departments: the
  admin-only *Add Department* page (`/manage/departments/new`, `createDepartment`) INSERTs
  through `departments_insert_admin`. Managers reach `/manage/*` but are redirected away from the
  department page — departments are company-wide config, not team data.
- **`departments_update_admin` is intentionally unreferenced (2026-07-30).** Admin editing of
  department codes was deactivated at the client's request. The policy and the
  `updateDepartmentCode` action stay so the feature can return without a migration — neither is
  dead code to be removed.
- **Department membership** is read by the admin-only `getDepartmentMembers` server action behind
  the Settings → Departments panel. It uses the existing `can_read_all` SELECT paths on `profiles`
  and `user_roles`; **no new policy and no new SECURITY DEFINER function** were added for it.

### `leave_allocations`
- **SELECT**: own · `is_manager_of` · `can_read_all`.
- **WRITE**: `is_admin` (managers may be allowed later; v1 = admin sets allocations).

### `leave_requests`
- **SELECT (full base row)**: own · direct `is_manager_of` · security · admin, with active-account
  enforcement. Same-team employees read the explicit-column `team_leave_calendar` view instead;
  they never receive private reason, location, decision-note, or signature columns.
- **INSERT / UPDATE**: no direct client policies. Daily/hourly leave and daily/hourly errand
  submission, approval, rejection, and cancellation run through guarded SECURITY DEFINER
  functions. A requester may
  cancel their own pending request, or their own approved request before it starts; only the direct
  manager or admin can decide it.
- **DELETE**: none (cancel via status; preserve history).
- **Signatures (FR-32 + FR-14)**: all four submission wrappers require the requester's PNG plus
  explicit authorization, and approval requires a separate fresh PNG and authorization from the
  deciding direct manager/admin. Each consent timestamp is generated by the database in the same
  transaction as its request/decision. Rejection stays unsigned. Stored signature data inherits the
  strict full-row SELECT scope above, is fetched only on demand, is never present in
  `team_leave_calendar`, and has no client mutation/deletion path. The approver PNG is deliberately
  omitted from audit JSON; the audit row records only authorization and its timestamp.

### `leave_ledger`
- **SELECT**: own · `is_manager_of` · `can_read_all`.
- **INSERT**: **server-side only** (SECURITY DEFINER fns — `allocation`, paid-portion `consumption`
  on approval, paid-portion `reversal` on approved-future cancel, and `adjustment` when an admin sets
  an absolute balance via `set_leave_balance`). No direct client writes — clients must not fabricate
  balances.

### `audit_log`
- **SELECT**: `is_admin`.
- **INSERT/UPDATE/DELETE**: no direct client path. Owner-run change triggers record direct
  profile/config-table changes, and privileged RPCs append their own audit event inside the same
  transaction. This prevents clients from inventing events and keeps audit failure from being
  silently ignored.

## Notes

- The "managers see everyone, edit only reports" rule = **broad read, narrow write**. Read uses
  `can_read_all`; write uses `is_manager_of`.
- `same_team` gives employees their team calendar without exposing other teams.
- Validate every policy on **self-hosted Supabase** before production cutover (NFR-4).

## Privileged admin RPCs (runtime user creation)

`public.app_create_employee(...)`, `public.app_set_employee_password(...)`, and
`public.app_bulk_set_employee_passwords(jsonb)` are `SECURITY DEFINER`
functions (search_path locked) that write to `auth.users` / `auth.identities` — work the
`authenticated` role cannot do directly. They **self-guard** in-DB and are granted to
`authenticated`, revoked from `anon`. Since migration `20260713120001`, `app_create_employee`
has two authorization paths: **admin** (free choice of department/manager/roles, as before) and
**manager** (every privileged input is overwritten in-DB: department forced to the caller's own,
`manager_id` forced to the caller, roles forced to `{employee}`; default leave quotas are applied
in the same transaction via `private.allocate_leave_impl`). Anyone else gets `42501`. Assigning
admin/manager/security roles therefore stays admin-only. `app_bulk_create_employees(jsonb)`
(CSV import, admin-only, all-or-nothing single transaction) reuses the same
`private.create_employee_impl`.
Bulk password reset accepts 1–100 unique non-caller employees, validates the complete payload
before updating anyone, enforces the bcrypt-safe 8–72 ASCII-character range, and succeeds or rolls
back as one transaction.
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

`public.app_set_user_roles(p_user_id, p_roles)` (2026-07-02 hardening) **atomically replaces** a
user's roles in one transaction (the app previously did delete-then-insert as two client
statements — a failed insert lost all roles). Admin-only (`42501` otherwise) and refuses to remove
the **caller's own** `admin` role (lockout guard, `22023`). Audited (`set_roles`). Granted to
`authenticated`, revoked from `anon`. The app's `setRoles` server action calls this RPC.

The Supabase security advisor flags these as exposed `SECURITY DEFINER` functions (lint 0029).
**Accepted by design** — the in-function admin check is the intended gate. Note on the advisor's
`auth_leaked_password_protection` item: it only affects GoTrue's own password endpoints, which this
app does not use (passwords are set via the in-DB RPCs above), so enabling it adds nothing here;
password strength is enforced by `lib/auth/passwordPolicy.ts` + in-DB 8–72-character checks.

## Concurrency & write-path validation (2026-07-02 hardening)

Every function that reads-then-writes `leave_ledger` (`allocate_leave`, `approve_leave_request`,
`cancel_leave_request` reversal, `set_leave_balance`) first takes
`pg_advisory_xact_lock(hashtextextended('leave:'||employee_id, 0))`, serializing all leave writes
per employee so concurrent writers cannot write stale `balance_after` values. On top of that:
`submit_leave_request` rejects ranges > 366 days and ranges overlapping the caller's own
pending/approved requests; `approve_leave_request` re-reads the request under the lock and rejects
overlap with an already-approved request. If paid leave exceeds the then-current balance, approval
consumes only the available paid minutes and atomically records the remainder in
`leave_requests.unpaid_minutes`; it never writes a negative paid balance. All RLS policies use
`(select auth.uid())` (advisor lint 0003, initplan).

## FR-25 — leave `reason` is private (ENFORCED in Phase 3)

A leave request's free-text `reason` may contain medical/personal info, so **teammates must not see
it.** Enforced: `leave_requests` SELECT is restricted to own / `is_manager_of` / `security` / `admin`
(the broad `same_team` read was dropped), and the team calendar reads a reason-less
`team_leave_calendar` SECURITY DEFINER view (scoped `own | same_team | can_read_all`, pending +
approved) that never selects `reason`. Verified on the live DB: a same-team peer reads the view, not
the base row, and no UI exposes another person's reason.

**Extended to work errands (2026-07-30/2026-08-05, FR-30/FR-33).** An hourly or daily errand's
`errand_location` (محل ماموریت) and
its description — which reuses `reason` — get the same treatment: the view's explicit column list
omits both, so teammates see that a colleague is out on an errand and nothing more. The requester,
their manager, security and admin read the base row and see everything.

The view now `LEFT JOIN`s `leave_types`. That is load-bearing, not cosmetic: an errand has a NULL
`leave_type_id`, and the previous inner join would have silently dropped every errand from the
calendar rather than failing visibly.

**Extended to signatures (2026-08-05, FR-32).** `signature_data` and
`signature_consent_at` remain base-row-only. Request lists and authorized calendar/approval surfaces
carry at most the consent timestamp; opening a signature performs a separate base-table read guarded
by the same own / direct-manager / security / admin RLS policy. Teammates cannot infer the signature
metadata from `team_leave_calendar` or fetch the image by guessing a request ID.

**Extended to signed approval (2026-08-05, FR-14).** `approver_signature_data` and
`approver_signature_consent_at` follow that identical visibility model. The old unsigned
`approve_leave_request(uuid)` endpoint is dropped; only the signed three-argument RPC is executable
by authenticated users, so the admin override cannot bypass approval evidence.
