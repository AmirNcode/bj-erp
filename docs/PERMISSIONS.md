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
| **hr** | HR staff (منابع انسانی). Reads company-wide. Adds employees to any department, but only ever as plain employees. Co-signs every request alongside the manager, and owns the reports screen. *(FR-35; added 2026-08-18.)* Since FR-51 (2026-10-07) also edits employees (not admins, not themselves), toggles the `manager` role, and creates/renames departments. |

A user may hold multiple roles (`user_roles` table). Highest applicable permission wins. An
inactive profile retains only read access to its own profile shell so the login flow can explain
the disabled state; it has no business-data access and cannot use employee-facing RPCs.

## Visibility matrix (time-off)

| Viewer | Whose time-off can they SEE | Whom can they EDIT / APPROVE |
|---|---|---|
| Employee | Own + **own team** | Self (limited profile fields) |
| Manager | **Everyone** (company-wide, read) | **Direct reports** (edit profile + approve leave) |
| Security | **Everyone** (read-only) | — |
| HR | **Everyone** (company-wide, read) | Creates employees (any department, `employee` role only); co-signs requests as a required approval step |
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
can_read_all(uid)    := is_admin(uid) OR has_role(uid,'manager')
                        OR has_role(uid,'security') OR has_role(uid,'hr')
has_permission(uid, key) -- FR-51 seam. Today: is_admin(uid) OR has_role(uid,'hr') for
                         -- 'employees.edit' | 'departments.edit' | 'accruals.run' | 'roles.manager';
                         -- any other key is false
```
**New grants go through `has_permission`** (FR-51), so the planned admin-configurable roles can
replace its body with a table lookup instead of rewriting each policy. Older hr grants (FR-38, FR-42,
FR-43) still name `has_role(uid,'hr')` directly; they move onto it with that feature.
Widening `can_read_all` is the **entire** grant that gives `hr` company-wide read (migration
`20260818130002`). Every read path HR needs — `profiles`, `user_roles`, `leave_ledger`,
`leave_allocations`, `employee_leave_policies`, and the `team_leave_calendar` view — already routes
through it, so no policy was created or edited. `has_role` requires an **active** profile, so a
deactivated HR account loses all of it immediately; that migration asserts this rather than assuming
it. `leave_requests`' full base-row SELECT names its roles explicitly rather than using this helper,
and `hr` was added to it separately by `20260818140001` (FR-38) — so the two can be reasoned about,
and revoked, independently.
Helpers are `SECURITY DEFINER` functions (with `SET search_path = ''`) to avoid recursive RLS on
`profiles`/`user_roles`. They live in a **`private` schema** that PostgREST does **not** expose, so
they are not callable via `/rest/v1/rpc/*` by `anon`/`authenticated` (closes an info-disclosure
surface); `EXECUTE` is granted to `authenticated` only. Policies reference them as `private.<fn>`.

## Policy intent per table

### `profiles`
- **SELECT**: self · active caller + (`same_team` · `can_read_all`). The self-only inactive row is
  deliberate: it lets the app detect the disabled account and clear its Auth session.
- **UPDATE**: `is_admin` (all fields) · `has_permission(employees.edit)` (editor subset, FR-51) ·
  `is_manager_of(target)` (managed subset) · self (own limited subset: language preference,
  password handled by Auth, contact fields).
  **Column scope is enforced in the DB** by the `profiles_enforce_update_scope` BEFORE-UPDATE
  trigger (migration 0007, rewritten by `20261007130001`) — RLS is row-level only, so without the
  trigger a manager could PATCH any column of a report via the anon key. Branches, first match wins:
  admin → anything; self → `full_name`/`language_pref`/compatibility-only `calendar_pref`
  (database-constrained to `jalali`); editor on a same-company target that holds **no** `admin`
  role row (even a deactivated admin) → `full_name`/`hire_date`/`department_id`/`manager_id`/
  `job_title`/`active`; manager-of-row → `full_name`/`hire_date`. `employee_code`/`personnel_no`/
  `company_id` are admin-only. (Before FR-51 the trigger never compared `job_title` or
  `personnel_no`, so a self or manager update could change them.) `must_change_password` (FR-50) is
  admin-only too, except that `app_set_initial_password` / `app_change_my_password` clear the
  caller's own flag; they mark the transaction with `bj.password_flag_write`, a setting PostgREST
  clients cannot set. Deactivating the last active admin is
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
- **WRITE**: `is_admin` only — except `departments` INSERT/UPDATE, which admit
  `has_permission(departments.edit)` since FR-51 (`departments_insert_editor` /
  `departments_update_editor`; DELETE stays `departments_delete_admin`). The
  `departments_enforce_update_scope` trigger lets a non-admin change only `name_fa`, `name_en` and
  `manager_id`; `code` (the bulk-import key), `kind` and `company_id` stay admin-only. Since
  `20261007130002`: a non-admin may **not** change the manager of the department they belong to
  (that person signs the department-manager step on the caller's own requests, and hr can grant the
  manager role); a department manager must be a same-company profile (checked on insert and update,
  admins included); both editor policies require `company_id` = the caller's company. The FR-24 admin editor (`/settings`, admin-only since 2026-10-05) writes `work_settings` /
  `holidays` **directly** through these policies — no SECURITY DEFINER RPC needed (config tables,
  unlike transactional `leave_*`, are admin-writable by design). Same for departments: the
  admin-only *Add Department* page (`/manage/departments/new`, `createDepartment`) INSERTs
  through `departments_insert_admin`. Managers reach `/manage/*` but are redirected away from the
  department page — departments are company-wide config, not team data.
- **Bulk holiday upload (FR-40, 2026-08-18) adds no policy and no `SECURITY DEFINER` function.**
  `bulkUpsertHolidays` is one PostgREST upsert on `(company_id, holiday_date)`, written through the
  existing `holidays_insert_admin` / `holidays_update_admin` policies — an upsert needs both, and an
  admin has both. The `isAdmin` check in the action is a fast localized refusal, not the boundary.
- **Weekend frequency (FR-41, 2026-08-18) adds no policy either.** `work_settings` keeps its
  admin-only write policy; the two new columns sit behind it. `private.is_company_weekend` is a
  `SECURITY DEFINER` helper in the `private` schema — not exposed by PostgREST, `EXECUTE` granted to
  `authenticated` only, exactly like the other helpers above. It reads `work_settings`, which every
  active member may already read.

- **`departments_update_editor`** (was `departments_update_admin` until FR-51) backs
  `setDepartmentManager` (FR-47) and `renameDepartment` (FR-51): an admin or hr picks each
  department's manager and renames it on Manage › Departments. Code editing stays deactivated — the
  `updateDepartmentCode` action is still intentionally unreferenced and is not dead code.
- **Bulk import v2 (FR-45)** creates departments and sets their managers inside
  `app_bulk_create_employees` (SECURITY DEFINER). That branch is **admin-only** in SQL: an `hr`
  caller may still bulk-onboard plain employees but is refused if the file would create a
  department or assign a department manager — department config stays admin-only.
- **Department membership** is read by the `getDepartmentMembers` server action (admin or hr since
  FR-51) behind the Manage › Departments panel. It uses the existing `can_read_all` SELECT paths on `profiles`
  and `user_roles`; **no new policy and no new SECURITY DEFINER function** were added for it.

### `leave_allocations`
- **SELECT**: own · `is_manager_of` · `can_read_all`.
- **WRITE**: `is_admin` **or `hr`** since 2026-08-19 (FR-43), through `allocate_leave`. HR
  administers leave, so the opening balance and the accrual policy belong to it as well as to admin.
  The same widening covers `set_employee_leave_policy`, `set_leave_balance` and
  `accrue_employee_leave` (the last so the balances HR reads do not lag the policy HR just set).
- **Nobody but an admin may do any of it to their OWN record.** Same asymmetry as FR-36's
  self-approval rule and for the same reason. Enforced inside each function
  (`p_employee_id = auth.uid()` raises `42501`), not in the UI.
- Untouched by FR-43: role assignment, and the profile fields. `updateEmployee` still requires admin
  or manager, so the Edit Employee screen skips the profile write entirely for an HR caller rather
  than failing the whole save on it.

### `leave_requests`
- **SELECT (full base row)**: own · direct `is_manager_of` · security · admin · **hr**
  (2026-08-18, FR-38 — a deliberate FR-25 widening; HR signs and files the paper form today), with
  active-account enforcement. Same-team employees read the explicit-column `team_leave_calendar` view instead;
  they never receive private reason, location, decision-note, or signature columns.
- **INSERT / UPDATE**: no direct client policies. Daily/hourly leave and daily/hourly errand
  submission, approval, rejection, and cancellation run through guarded SECURITY DEFINER
  functions. A requester may
  cancel their own pending request, or their own approved request before it starts. Since FR-36
  (2026-08-18) deciding it is a **chain**: every active `approval_steps` row for that request's kind
  must approve before the status flips and the ledger moves — see `leave_request_approvals` below.
  Rejection by any one required approver is immediate and unilateral.
- **DELETE**: none (cancel via status; preserve history).
- **Signatures (FR-32 + FR-14)**: all four submission wrappers require the requester's PNG plus
  explicit authorization, and approval requires a separate fresh PNG and authorization from the
  deciding direct manager/admin. Each consent timestamp is generated by the database in the same
  transaction as its request/decision. Rejection stays unsigned. Stored signature data inherits the
  strict full-row SELECT scope above, is fetched only on demand, is never present in
  `team_leave_calendar`, and has no client mutation/deletion path. The approver PNG is deliberately
  omitted from audit JSON; the audit row records only authorization and its timestamp.

### HR reports (FR-37)
`/manage/reports` adds **no policy and no SECURITY DEFINER function**. Every report is a plain
SELECT over `profiles`, `leave_ledger`, `leave_types`, `leave_requests` and
`leave_request_approvals`, so the rows a caller sees are exactly the rows their existing RLS allows
— `can_read_all` (which includes `hr` since 20260818130002) is what makes them company-wide. The
`hr || admin` check in the action and on the page is a fast localized refusal, not the boundary: an
employee who reached it would still read only their own rows.

### `approval_steps` (FR-36)
- **SELECT**: any active authenticated company member. Deliberately open: the requester is shown
  which steps their request is waiting on, so this is progress information, not privileged config.
- **INSERT/UPDATE/DELETE**: `is_admin` **OR `has_role(hr)`** since 2026-08-18 (FR-42), through the
  Manage → Approval steps page (`/manage/approval-steps`, admin + hr since 2026-10-05). Like
  `work_settings` and `holidays`, this is company configuration and needs no SECURITY DEFINER
  wrapper. **This widens exactly one table**: HR still cannot edit work settings, holidays,
  departments, leave types or roles; `/settings` and `/manage/departments` redirect HR away. The order-enforcement switch stays admin-only because it writes
  `work_settings`.
- **Who may fill a NAMED step (FR-42)**: only the person in `approver_id`, and only while their
  account is active. There is **no admin override** — unlike a role step, where FR-36 deliberately
  lets an admin fill any slot so a company whose admin has no manager above them is not stuck. A
  deactivated named approver therefore blocks the step; the remedy is to change the configuration,
  which admin and HR can both now do.
- **Department-manager step (FR-47)**: `manager_scope = 'department'` on a `manager` step. It is
  filled by the requester's department manager (`departments.manager_id`, active) and applies only
  when that person is neither the requester nor the requester's direct manager — otherwise it is
  not required for that request. An admin may fill it like any role step; nobody signs their own
  request. No read policy changes: managers already read company-wide (`can_read_all`).
- `public.search_approver_candidates(text)` (SECURITY DEFINER, admin/hr-guarded, granted to
  `authenticated`, revoked from `anon`) backs the person picker. It **widens nothing** —
  `can_read_all` already gives both roles company-wide profile reads; it exists so the picker
  receives four fields instead of whole profile rows.

### `leave_request_approvals` (FR-36)
- **SELECT**: mirrors `leave_requests_select` exactly — own · direct `is_manager_of` · security ·
  admin · hr. Whoever may read a request may see who signed it. Written as an `exists` against
  `leave_requests` rather than a join, so a policy on this table never recurses through itself.
- **INSERT/UPDATE/DELETE**: **no client policy at all**, exactly like `leave_ledger`. Every row is
  written inside `approve_leave_request` / `reject_leave_request`. A client that could insert here
  could forge an approval signature.
- **Who may fill which step**: an admin may fill any outstanding step; the `manager` step needs
  `is_manager_of` (holding the manager role is not enough); any other step needs that role. A
  non-admin can never sign a step on their **own** request. When
  `work_settings.approval_order_enforced` is true, a step is refused while any lower-ordered active
  step is unapproved. All of it is enforced in SQL and mirrored, for the queue UI only, by
  `lib/leave/approvals.ts`.

### `leave_ledger`
- **SELECT**: own · `is_manager_of` · `can_read_all`.
- **INSERT**: **server-side only** (SECURITY DEFINER fns — `allocation`, paid-portion `consumption`
  on approval, paid-portion `reversal` on approved-future cancel, and `adjustment` when an admin sets
  an absolute balance via `set_leave_balance`). No direct client writes — clients must not fabricate
  balances.
- **Monthly accrual for everyone** (`accrue_all_leave`, the Departments page button) requires
  `has_permission(accruals.run)`: admin or hr since FR-51. It posts only months each policy has
  already earned.

### `audit_log`
- **SELECT**: `is_admin`.
- **INSERT/UPDATE/DELETE**: no direct client path. Owner-run change triggers record direct
  profile/config-table changes, and privileged RPCs append their own audit event inside the same
  transaction. This prevents clients from inventing events and keeps audit failure from being
  silently ignored.

### Bulk import modes (FR-49)
- `public.app_bulk_import_employees(...)` — SECURITY DEFINER, granted to `authenticated`. `add`
  mode: admin or hr (hr clamped to plain employees, no department config, as v2). `update` /
  `replace`: **admin only**, enforced in SQL. Never deactivates an admin or the caller; only the
  `manager` role follows the file (admin/hr/security untouched); deletes a department only when no
  profile, active or not, is in it. Every deactivation, reassignment, deletion and update is
  audited. The server action `importEmployees` is admin-only.

### Org chart (FR-44)
- `public.get_org_chart()` — SECURITY DEFINER, granted to `authenticated`, revoked from `anon`,
  scoped to the caller's company. Returns active profiles only: id, full name, job title,
  department (id, fa, en), manager id (NULL when the manager is inactive) and whether the person
  manages a department. Every role may call it (owner decision D8). **It widens names, titles,
  departments and reporting lines to every employee — nothing else**: no personnel number, roles,
  hire date, balances or leave data. Same pattern as `get_my_team_directory()`.

## Notes

- The "managers see everyone, edit only reports" rule = **broad read, narrow write**. Read uses
  `can_read_all`; write uses `is_manager_of`.
- `same_team` gives employees their team calendar without exposing other teams.
- Validate every policy on **self-hosted Supabase** before production cutover (NFR-4).

## Privileged admin RPCs (runtime user creation)

**HR employee creation (2026-08-18, FR-35 D4).** `app_create_employee` gained a third
authorization path and `app_bulk_create_employees` a second: an `hr` caller may choose any
department and any manager, but the role list is **overwritten in-database** to `{employee}` — in the
bulk path every CSV row's `role` column is clamped the same way. An HR account therefore cannot
create a manager, another HR, a security user, or an admin; granting authority remains admin-only.
The `hr` branch is checked **before** the manager branch so a user holding both gets the wider scope.
Audit rows record the path as `hr` / `bulk_hr`.

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

**First-login password (FR-50).** New profiles start with `must_change_password = true`;
`app_set_employee_password` and `app_bulk_set_employee_passwords` set it again (an admin resetting
their own password is not flagged). The `(app)` and `(print)` layouts send a flagged account to
`/set-password`. There `app_set_initial_password(p_new)` (authenticated only) requires the flag,
refuses the issued password (`crypt` comparison), sets the new one, clears the flag and audits
`set_initial_password`. `app_change_my_password` also refuses new = current (`20261007120001`), so
neither RPC clears the flag without a real change. The flag is a UI gate, not an RLS boundary: a flagged session's data access
is unchanged, and RLS stays the authority.

`public.set_leave_balance(p_employee_id, p_leave_type_id, p_target)` (admin-only; self-guards via
`private.is_admin(auth.uid())`, `42501` otherwise) sets an employee's **current** balance for a leave
type to an absolute value by writing an `adjustment` ledger row (audited `set_leave_balance`); additive
grants still go through `allocate_leave`. Granted to `authenticated`, revoked from `anon`. Used by the
admin employee create/edit forms.

`public.app_set_user_roles(p_user_id, p_roles)` (2026-07-02 hardening) **atomically replaces** a
user's roles in one transaction (the app previously did delete-then-insert as two client
statements — a failed insert lost all roles). Admin, who may not remove the **caller's own**
`admin` role (lockout guard, `22023`). Since FR-51 also a `has_permission(roles.manager)` holder (hr),
only to add or remove `manager`, on a same-company target that holds no `admin` and is not the
caller (`42501` otherwise). Anyone else `42501`. Audited (`set_roles`). Granted to
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

**Extended to HR (2026-08-18, FR-38).** `hr` reads the full base row — reason, errand location,
decision note and both signature images — so it can review and print the paper-equivalent form.
`team_leave_calendar` was **not** touched, so teammates are unaffected and every other role's
visibility is unchanged. This is the only widening of FR-25 since it was written, and it was made
because the client's own BJ-F 50210 / 50208 / 50207 forms already carry an
امور اداری و منابع انسانی signature box, i.e. HR physically holds the completed form today.

**Extended to signed approval (2026-08-05, FR-14).** `approver_signature_data` and
`approver_signature_consent_at` follow that identical visibility model. The old unsigned
`approve_leave_request(uuid)` endpoint is dropped; only the signed three-argument RPC is executable
by authenticated users, so the admin override cannot bypass approval evidence.
