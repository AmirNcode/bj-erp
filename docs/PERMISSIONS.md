# PERMISSIONS & VISIBILITY

Source of truth for access control. Enforced by **Postgres Row-Level Security (RLS)** — the UI
only mirrors it. Every table holding employee data has policies.

## Roles

| Role | Meaning |
|---|---|
| **admin** | The owner. Full read/write across the company. Override on any decision. |
| **manager** | Leads a team. Reads company-wide time-off; edits/approves **direct reports** only. |
| **employee** | Standard worker. Self-service + own-team visibility. |
| **security** | Security department staff. **Read-only** visibility into **everyone's** calendar, and the approved-absences board (`/absences`, FR-56). **Never an approver**: since 2026-10-12 a `security` approval step can only exist inactive. |
| **finance** | Finance (امور مالی). Signs the last step of a clearance form and reads every clearance form, including the leaver's remaining leave. Since FR-62 (2026-10-12) also reads every fully approved request with its per diem, through `finance_approved_requests()` only. *(FR-54; added 2026-10-07.)* |
| **hr** | HR staff (منابع انسانی). Reads company-wide. Adds employees to any department, but only ever as plain employees. Co-signs every request alongside the manager, and owns the reports screen. *(FR-35; added 2026-08-18.)* Since FR-51 (2026-10-07) also edits employees (not admins, not themselves), toggles the `manager` role, and creates/renames departments. Since FR-53 reads everyone's personal information and corrects it (not an admin's), with CSV export/import. |
| **Custom roles** (FR-55) | Created by the admin in Settings › Roles: an English name and a level per catalog item (Allowed / Read only / Not allowed). Assignable like any role; see *Configurable roles (FR-55)* below. Not approval-step roles (`approval_steps.role` stays on the `app_role` enum). |

**Exactly one admin** (FR-55 D1): the partial unique index `user_roles_one_admin` allows one
`user_roles` row with `role = 'admin'`. No role-assignment path adds or removes it (not
`app_set_user_role_ids`, `app_set_user_roles`, `app_create_employee` or bulk import); only
`app_transfer_admin` moves it, on the admin's own password. `security`, `hr` and `finance` are
editable presets (FR-55 D9); `admin`, `manager` and `employee` are fixed. Since FR-55 the grants
in the rows above are the presets' *default* permissions, not hard-coded roles.

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

Since FR-55 the Security and HR rows are the presets' defaults: company-wide read is the
`people`, `leave_balances`, `calendar` and `leave_requests` read items, and an admin can give any
of them to a custom role. Manager keeps its hard-wired company-wide read.

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
                        -- FR-55: no policy calls it any more; kept for the deploy window
perm_level(uid, key)     -- 0 none | 1 read | 2 edit: max over all the user's roles, active or not;
                         -- the admin gets the highest level the key allows
has_perm(uid, key, level default 'edit')
                         -- is_active(uid) AND perm_level(uid, key) >= level; an unknown level is false
reads_people(uid)        := has_role(uid,'manager') OR has_perm(uid,'people','read')
reads_balances(uid)      := has_role(uid,'manager') OR has_perm(uid,'leave_balances','read')
reads_calendar(uid)      := has_role(uid,'manager') OR has_perm(uid,'calendar','read')
can_act_on(caller, target) -- D4 subset rule: same company, not the caller, target holds no admin
                         -- row, no catalog level above the caller's, plus the manager / department-
                         -- manager / hr-or-approver / hr-finance-or-clearance-signer clauses
role_within(role_id, uid) -- D5: may uid give or remove this role? (see below)
caller_company()         -- company of the active caller; scopes config writes and role RPCs
has_permission(uid, key) -- LEGACY ALIAS, kept for the deploy window (old app, old call sites):
                         -- every key answers from the catalog; any other key is false
                         --   employees.edit      = people edit
                         --   departments.edit    = departments edit
                         --   accruals.run        = leave_accrual edit
                         --   roles.manager       = role_manager edit
                         --   personal_info.view  = personal_info read
                         --   personal_info.edit  = personal_info edit
                         --   personal_info.edit_own = personal_info_own edit
                         --   special_leave.grant = special_leave edit
                         --   separations.manage  = clearance edit
                         --   separations.view    = clearance read
                         --   settings.edit       = work_settings edit AND holidays edit
                         --   absences.view       = absences read
                         --   finance.view        = finance read
```
**New grants go through `has_perm` plus `can_act_on` (FR-55)**, never a role literal. Remove the
legacy keys and the old `app_set_user_roles(uuid, app_role[])` after the FR-55 release is live
(`docs/TASKS.md`). The paragraphs below describe the pre-FR-55 helper (`can_read_all`); the
per-table sections state what each policy checks today.
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
- **SELECT**: self · active caller + (`same_team` · `reads_people`: `manager` or `people` read,
  FR-55). The self-only inactive row is deliberate: it lets the app detect the disabled account and
  clear its Auth session.
- **UPDATE** (row level, FR-55): `is_admin` (all fields) · `people` edit (editor subset, FR-51) ·
  `is_manager_of(target)` (managed subset) · self (own limited subset: language preference,
  password handled by Auth, contact fields).
  **Column scope is enforced in the DB** by the `profiles_enforce_update_scope` BEFORE-UPDATE
  trigger (migration 0007, rewritten by `20261007130001`) — RLS is row-level only, so without the
  trigger a manager could PATCH any column of a report via the anon key. Branches, first match wins:
  admin → anything; self → `full_name`/`language_pref`/compatibility-only `calendar_pref`
  (database-constrained to `jalali`); editor on a same-company target that holds **no** `admin`
  role row (even a deactivated admin) → `full_name`/`hire_date`/`department_id`/`manager_id`/
  `job_title`/`active`; manager-of-row → `full_name`/`hire_date`. `employee_code`/`personnel_no`/
  `company_id` are admin-only. **FR-55:** the editor branch is `people` edit **and**
  `can_act_on(caller, target)` (D4: same company, no admin row, nothing above the caller's levels,
  plus the relationship and identity clauses). The `passwords` branch FR-55 added is gone since
  `20261013200007`: password resets are admin-only. (Before FR-51 the trigger never compared `job_title` or
  `personnel_no`, so a self or manager update could change them.) `must_change_password` (FR-50) is
  admin-only too, except that `app_set_initial_password` / `app_change_my_password` clear the
  caller's own flag; they mark the transaction with `bj.password_flag_write`, a setting PostgREST
  clients cannot set. Deactivating the last active admin is
  rejected by a database trigger, and `manager_id = id` is prohibited by a table constraint.
- **INSERT**: no direct client path. Admin/manager creation must use `app_create_employee`, keeping
  Auth, profile, roles, allocations, and audit in one transaction.

### `user_roles`
- **SELECT**: self · `reads_people` (FR-55).
- **INSERT/UPDATE/DELETE**: no direct client path. Roles are replaced atomically through
  `app_set_user_role_ids(user, role_ids uuid[])` (FR-55; the old `app_set_user_roles(user,
  app_role[])` delegates to it for the deploy window), which audits the change. See *Privileged
  admin RPCs*. A BEFORE trigger (`user_roles_sync`) fills `role` (the enum, NULL for custom roles)
  from `roles.system_key` and refuses a role of another company.
- **Teammate role labels** are surfaced read-only through the `get_my_team_directory()` SECURITY
  DEFINER fn (scoped to the caller's manager + same-department active colleagues) so the Home
  **My Team** card can show role/title context without granting employees broad `user_roles` read
  access. Granted to `authenticated`, revoked from `anon`.

### `departments`, `work_settings`, `holidays`, `leave_types`
- **SELECT**: any active authenticated company member.
- **WRITE** (FR-55): `departments` INSERT/UPDATE need `departments` edit in the caller's company
  (`departments_insert_editor` / `departments_update_editor`; DELETE stays
  `departments_delete_admin`). `holidays` INSERT/UPDATE/DELETE need `holidays` edit and
  `work_settings` INSERT/UPDATE need `work_settings` edit, both on the caller's own company
  (`*_editor` policies); `work_settings` DELETE is admin in the caller's company
  (`work_settings_delete_admin`). `work_settings_enforce_scope` keeps `hours_per_day` admin-only and
  lets only `approval_steps` edit (or the admin) change `approval_order_enforced`, the latter
  through `app_set_approval_order_enforced`. `leave_types` stay admin-only. The pre-FR-55 text
  follows: `is_admin` only — except `departments` INSERT/UPDATE, which admit
  `has_permission(departments.edit)` since FR-51. The
  `departments_enforce_update_scope` trigger lets a non-admin change only `name_fa`, `name_en` and
  `manager_id`; `code` (the bulk-import key), `kind` and `company_id` stay admin-only. **FR-55 D7:**
  a non-admin may never set themselves as a department's manager (insert or update). Since
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
- **SELECT**: own · `is_manager_of` · `reads_balances` (`manager` or `leave_balances` read, FR-55).
- **WRITE**: since FR-55, `leave_balances` edit **and** `can_act_on(caller, target)` (admin skips
  it), through `allocate_leave`; before it, `is_admin` **or `hr`** since 2026-08-19 (FR-43). HR
  administers leave, so the opening balance and the accrual policy belong to it as well as to admin.
  The same gate covers `set_employee_leave_policy` and `set_leave_balance`;
  `accrue_employee_leave` needs `is_manager_of` or `leave_balances` read (so the balances HR reads
  do not lag the policy HR just set).
- **Nobody but an admin may do any of it to their OWN record.** Same asymmetry as FR-36's
  self-approval rule and for the same reason. Enforced inside each function
  (`p_employee_id = auth.uid()` raises `42501`), not in the UI.
- Untouched by FR-43: role assignment, and the profile fields. `updateEmployee` still requires admin
  or manager, so the Edit Employee screen skips the profile write entirely for an HR caller rather
  than failing the whole save on it.

### `leave_requests`
- **SELECT (full base row)**: own · direct `is_manager_of` · `leave_requests` read (FR-55; held by
  the admin implicitly and by the hr and security presets — HR since 2026-08-18, FR-38, a deliberate
  FR-25 widening: HR signs and files the paper form today), with active-account enforcement. Same-team employees read the explicit-column `team_leave_calendar` view instead;
  they never receive private reason, location, decision-note, or signature columns.
- **INSERT / UPDATE**: no direct client policies. Daily/hourly leave and daily/hourly errand
  submission, approval, rejection, and cancellation run through guarded SECURITY DEFINER
  functions. A requester may
  cancel their own pending request, or their own approved request before it starts. Since FR-36
  (2026-08-18) deciding it is a **chain**: every active `approval_steps` row for that request's kind
  must approve before the status flips and the ledger moves — see `leave_request_approvals` below.
  Rejection by any one required approver is immediate and unilateral.
- **DELETE**: none (cancel via status; preserve history). `cancel_leave_request` admits the owner,
  the admin, or (FR-55) `leave_requests` edit in the caller's company, never on the admin's
  request.
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
— company-wide for a caller holding the reads they need. **FR-55:** `reports` read gates the action
and page and depends (D6) on `people`, `leave_balances` and `leave_requests` read, which is what makes
the rows company-wide. The permission check in the action is a fast localized refusal, not the
boundary: an employee who reached it would still read only their own rows. The Home pulse band is
identity-scoped (admin/hr company-wide); a custom Reports-only role sees a team pulse.

### Permission keys added 2026-10-12 (FR-56/59/62)
`private.has_permission` gained `settings.edit` (admin, hr), `absences.view` (admin, security),
`finance.view` (admin, finance), and `personal_info.edit_own` (admin; FR-63). **FR-55 made them
catalog items** (legacy keys remain aliases): `absences` (read; hr, security presets), `finance`
(read; hr, finance presets), `work_settings` + `holidays` (both edit for hr; `settings.edit` needs
both) and `personal_info_own` (edit; no preset, the per-role switch "may edit own personal
information").
- `work_settings` / `holidays` INSERT/UPDATE (and `holidays` DELETE): `work_settings` / `holidays`
  edit on the caller's own company (`*_editor` policies; `work_settings` DELETE stays admin).
  `work_settings_enforce_scope` refuses a non-admin change to `hours_per_day`, and to
  `approval_order_enforced` without `approval_steps` edit.
- `public.finance_approved_requests(from, to)`: SECURITY DEFINER, requires an active caller with
  `finance` read (alias `finance.view`); caller's company; approved rows only; no signatures, no
  reason.
- The approved-absences board (`getAbsences`) needs `absences` read; rows come through
  `leave_requests_select`, hence the dependency on `people` and `leave_requests`.

### `special_leave_grants` (FR-65)
- **SELECT**: own rows, or `special_leave` edit (admin, hr preset) in the caller's company. No client
  writes.
- `app_grant_special_leave(employee, kind)` / `app_revoke_special_leave(grant)`: SECURITY DEFINER,
  guarded by `private.special_leave_target`: `special_leave` edit, same company (`P0002` otherwise),
  and for a non-admin: not on oneself, not on an admin, and `can_act_on` (FR-55 D4). The admin may
  grant to themself. Marriage: one standing grant (partial unique index), only while marital status
  is `single`.
- FR-66: hr sets `approval_order_enforced`; in FR-55 terms whoever holds `approval_steps` edit does,
  through `app_set_approval_order_enforced`. Only `hours_per_day` stays admin-only.

### `request_approval_progress(id)` (FR-64)
SECURITY DEFINER; answers only when the caller may read the request (own · direct manager ·
`leave_requests` read, as `leave_requests_select`), else `request not found`. Returns step order,
role, expected person, decision, signer name and time — no signatures, no notes.

### `approval_steps` (FR-36)
- **SELECT**: any active authenticated company member. Deliberately open: the requester is shown
  which steps their request is waiting on, so this is progress information, not privileged config.
- **INSERT/UPDATE/DELETE**: `approval_steps` edit **on the caller's own company** since FR-55
  (`approval_steps_*_config`; the admin holds it implicitly, the hr preset has it). Before that
  `is_admin` **OR `has_role(hr)`** since 2026-08-18 (FR-42), through the
  Manage → Approval steps page (`/manage/approval-steps`). Like
  `work_settings` and `holidays`, this is company configuration and needs no SECURITY DEFINER
  wrapper. **This widens exactly one table**: (Written for FR-42: since FR-59/FR-55 HR also edits work settings and holidays, and
  roles and leave types remain admin-only.) The order-enforcement switch belongs to `approval_steps`
  edit via `app_set_approval_order_enforced` (FR-55), not to `work_settings`.
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
- `public.search_approver_candidates(text)` (SECURITY DEFINER, `approval_steps` edit-guarded since
  FR-55, granted to `authenticated`, revoked from `anon`) backs the person picker. It **widens
  nothing** — `approval_steps` depends on `people` read; it exists so the picker receives four
  fields instead of whole profile rows.

### `leave_request_approvals` (FR-36)
- **SELECT**: mirrors `leave_requests_select` exactly — own · direct `is_manager_of` ·
  `leave_requests` read. Whoever may read a request may see who signed it. Written as an `exists` against
  `leave_requests` rather than a join, so a policy on this table never recurses through itself.
- **INSERT/UPDATE/DELETE**: **no client policy at all**, exactly like `leave_ledger`. Every row is
  written inside `approve_leave_request` / `reject_leave_request`. A client that could insert here
  could forge an approval signature.
- **FR-58 (2026-10-12) supersedes the admin clauses below and FR-42's "no admin override":** an
  admin fills no step as such. `approve_leave_request(..., p_override, p_per_diem_rials)` lets an
  admin sign EVERY outstanding step at once (named ones included) — automatically when they have no
  step of their own. `reject_leave_request` lets an admin reject any pending request. The
  `approval_steps_role_allowed` CHECK admits `security`/`admin` only on an inactive row.
- **Who may fill which step**: an admin may fill any outstanding step; the `manager` step needs
  `is_manager_of` (holding the manager role is not enough); any other step needs that role. A
  non-admin can never sign a step on their **own** request. When
  `work_settings.approval_order_enforced` is true, a step is refused while any lower-ordered active
  step is unapproved. All of it is enforced in SQL and mirrored, for the queue UI only, by
  `lib/leave/approvals.ts`.

### `leave_ledger`
- **SELECT**: own · `is_manager_of` · `reads_balances` (FR-55).
- **INSERT**: **server-side only** (SECURITY DEFINER fns — `allocation`, paid-portion `consumption`
  on approval, paid-portion `reversal` on approved-future cancel, and `adjustment` when an admin sets
  an absolute balance via `set_leave_balance`). No direct client writes — clients must not fabricate
  balances.
- **Monthly accrual for everyone** (`accrue_all_leave`, the Departments page button) requires
  `leave_accrual` edit (FR-55; admin, hr preset; before it `accruals.run`, FR-51). It posts only
  months each policy has already earned.

### `audit_log`
- **SELECT**: `is_admin`.
- **INSERT/UPDATE/DELETE**: no direct client path. Owner-run change triggers record direct
  profile/config-table changes, and privileged RPCs append their own audit event inside the same
  transaction. This prevents clients from inventing events and keeps audit failure from being
  silently ignored.

### `employee_personal_info` (FR-53)
- **SELECT**: own row, or `personal_info` read on a row of the caller's company. Managers, security
  and peers see nothing.
- **UPDATE** (FR-63, 2026-10-12; FR-55): own row only with `personal_info_own` edit (the per-role
  switch; no preset, the admin implicitly — the explicit exception to D3); someone else's row with
  `personal_info` edit in the caller's company **and** `can_act_on` (admin skips it; never an admin
  row, nothing above the caller's levels).
  Everyone still READS their own row (Profile › Personal information, read-only).
- **INSERT / DELETE**: no client grant. The profile trigger inserts; the FK cascade deletes.
- A before-update trigger pins `employee_id` / `company_id`; an after-update trigger audits field
  names only.
- `public.app_export_personal_info()` — SECURITY DEFINER, `personal_info` read, caller's company,
  writes `personal_info.export` (row count) to `audit_log` before returning.
- `public.app_import_personal_info(jsonb)` — SECURITY DEFINER, `personal_info` edit; rows matched by
  personnel number in the caller's company; unknown number, duplicate, unknown field, a non-admin
  caller's row for a target that fails `can_act_on` (which includes any admin), or the caller's own
  row without `personal_info_own` fails the whole call; one transaction; `personal_info.import`
  audit row.

### `user_signatures` (FR-52)
- **ALL**: owner only (`user_id = auth.uid()`, active). No other policy: admin, hr and managers
  cannot read or write anyone's saved signature.

### Clearance form (FR-54)
- Catalog item `clearance` (FR-55): edit = file, edit, edit rows, cancel, default rows
  (`separations.manage`; admin, hr preset), and the leaver must pass `can_act_on`; read = every form
  of the company (`separations.view`; admin, hr, finance preset).
- **SELECT** on `separations` / `separation_signoffs`: `private.can_read_separation(uid, id)` —
  active, same company, and `clearance` read, or the leaver, or a signer named on a row.
  `separation_units`: any active user of the company. **No INSERT/UPDATE/DELETE grants.**
- RPCs (SECURITY DEFINER, `authenticated` only): `app_create_separation` (manage; not yourself;
  `can_act_on`, so never an admin; not the last active admin; one live form), `app_update_separation` /
  `app_cancel_separation` (manage; until the account is switched off), `app_set_separation_signoffs`
  (manage; in progress; signed rows only move), `app_sign_separation_row` (the row's signer; HR row:
  any hr or admin; never the leaver), `app_sign_separation_finance` (`finance` role; never the
  leaver; after every row), `app_save_separation_units` (manage; HR row rename only),
  `app_separation_warnings` (manage), `app_separation_balances` / `app_get_separation` /
  `app_list_separations` (whoever may read the form).
- The apply job's GUC bypass in `enforce_profile_update_scope` admits only `active` true→false.

### Bulk import modes (FR-49)
- `public.app_bulk_import_employees(...)` — SECURITY DEFINER, granted to `authenticated`. `add`
  mode: admin or `people_create` (clamped to plain employees, no department config, as v2). `update` /
  `replace`: **admin only** (D2), enforced in SQL. Never deactivates an admin or the caller; only the
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

## Configurable roles (FR-55)

Design record: `docs/specs/2026-10-07-configurable-roles-design.md`. Tables: `roles`,
`role_permissions` (`docs/DATA_MODEL.md`). The admin edits roles in Settings › Roles; the editor
shows three states per item (Allowed = `edit`, Read only = `read`, Not allowed = no row).

### Catalog (19 items; `passwords` removed in `20261013200007`)

Shape: `R/E` both levels, `E` action only, `R` read only. Single source: SQL
`private.permission_keys` / `permission_allows` / `permission_deps` and `lib/permissions/catalog.ts`
(a unit test compares them with `supabase/schema.sql`).

| Section | Key | Shape | Needs (read) |
|---|---|---|---|
| Employees | `people` | R/E | — |
| | `people_create` | E | `people` |
| | `role_manager` | E | `people`, `leave_balances`, `calendar` |
| | `role_assign` | E | `people` |
| | `personal_info` | R/E | `people` |
| | `personal_info_own` | E | — |
| | `clearance` | R/E | `people` at edit |
| Departments | `departments` | R/E | `people` |
| Leave | `leave_balances` | R/E | `people` |
| | `leave_accrual` | E | `departments` |
| | `special_leave` | E | `people`, `leave_balances` |
| | `leave_requests` | R/E | `people` |
| | `calendar` | R | — |
| | `absences` | R | `people`, `leave_requests` |
| | `reports` | R | `people`, `leave_balances`, `leave_requests` |
| Finance | `finance` | R | — |
| Approval chain | `approval_steps` | R/E | `people` |
| Settings | `work_settings` | R/E | — |
| | `holidays` | R/E | — |

### Presets (seeded per company)

| Preset | Holds |
|---|---|
| **HR** | `people`, `people_create`, `role_manager`, `personal_info`, `clearance`, `departments`, `leave_balances`, `leave_accrual`, `special_leave`, `approval_steps`, `work_settings`, `holidays` at edit; `leave_requests`, `calendar`, `absences`, `reports`, `finance` at read |
| **Security** | `people`, `leave_balances`, `leave_requests`, `calendar`, `absences` at read |
| **Finance** | `clearance`, `finance` at read |

`personal_info_own` and `role_assign` are on no preset. The catalog has 19 items: `passwords` was
removed by `20261013200007` (password resets are admin-only; a stored row counts for nothing). `admin`, `manager` and
`employee` carry no permission rows (admin holds every item implicitly; manager has the hard-wired
company-wide read through `reads_*`). Presets keep their name and cannot be deleted; permissions are
editable. HR holds `work_settings`, `holidays`, `special_leave`, `absences` and `finance` read under
owner ruling (a), 2026-10-13, so the HR preset covers Security and Finance and D4 lets it act on
their holders.

### Rules (D1–D7)

- **D1 — one admin.** Index `user_roles_one_admin`; only `app_transfer_admin(target, personnel_no,
  password)` moves it (caller's password re-entered, target active, same company, not the caller).
  The migration refuses to run if more than one admin row exists. There is no recovery path for a
  locked-out admin (owner accepted).
- **D2 — locked, admin-only, never in the matrix:** create/edit/delete roles; grant or transfer
  admin; approval override (filling any step, signing one's own request); bulk import in Update and
  Replace modes; the audit log; developer tools (`app_cleanup_e2e_users`); `hours_per_day`;
  `personnel_no` / `employee_code` / `company_id`; deleting `work_settings`. The role editor shows
  them in a read-only "Admin only" card. The approval-order switch
  (`work_settings.approval_order_enforced`) is **not** locked: it follows `approval_steps` edit
  through `app_set_approval_order_enforced`.
- **D3 — never on yourself.** No delegated permission acts on the holder's own record. The explicit
  exception is `personal_info_own` (own personal information); the importer's own CSV row also
  needs it (`app_import_personal_info`, main's FR-63).
- **D4 — subset rule, `can_act_on(caller, target)`.** True only when: same company; target is not
  the caller; the target holds no `admin` row (even deactivated); for every catalog key the target's
  level is at most the caller's (computed from all the target's roles, active or not); a target
  holding `manager` needs the caller to hold `role_manager` edit (one exception to the level
  check: the target's self-only `personal_info_own` is covered by the caller's `personal_info` edit,
  so HR keeps self-service holders, while a role without personal-info edit does not); a target who manages a department
  needs `departments` edit; a target who holds `hr` or is a named approver of an active step needs
  `approval_steps` edit; a target who holds `hr` or `finance`, is a clearance unit signer, or signs a
  row of an `in_progress` / `awaiting_finance` clearance form needs `clearance` edit. The
  relationship and identity clauses stop impersonation: resetting someone's password would let you
  sign in as them and fill their steps. Manager is not an identity clause (managers sign through
  `manager_id` / `departments.manager_id`, set through `people` / `departments` edit, which D4 and D7
  guard); `security` is not one either (it cannot be an approval-step role since `20261012120003`).
  Admin callers skip it. Guards every write on a person; reads are exempt.
- **D5 — assignment, `role_within(role_id, uid)`.** `admin`: never. `manager`: `role_manager` edit.
  `employee`: `role_assign` edit (it has no rows). Otherwise `role_assign` edit and every row of the
  role at or below the caller's level (`personal_info_own` counts as covered by `personal_info`
  edit, as in D4). Granting or removing `hr` also needs `approval_steps` and
  `clearance` edit; `finance` needs `clearance` edit. The same check covers the initial roles on Add
  Employee.
- **D6 — dependencies.** Items whose screens read through RLS need other items at read (table
  above); `app_save_role` rejects a set that breaks them and the editor raises them, saying so.
- **D7 — no self-appointment as a department manager** (non-admin, insert or update). Open owner
  questions (`docs/TASKS.md`): the analogues for `people` edit, `approval_steps` edit, `clearance`
  edit and `people_create`.

### Which gate does what

| Object | Gate |
|---|---|
| Employees / Departments / Request archive / Approval steps / Reports pages | `manager` or `people` read · `departments` read · `leave_requests` read · `approval_steps` read · `reports` read |
| Finance page | `finance` read (a Manage item for callers who already have the Manage group, else a bottom tab) |
| Settings | admin, or `work_settings` read, or `holidays` read; the Roles tab is admin only |
| `app_list_roles()` | any active member (the employee forms render the role boxes) |
| `app_role_holders`, `app_save_role`, `app_delete_role`, `app_transfer_admin` | admin only |
| `app_my_permissions()` | the caller; fallback when the `app_perms` JWT claim is missing |

The `app_perms` claim (`{key: level}`, empty for an inactive user) is added by
`custom_access_token_hook` next to `app_roles`; a change reaches the app on the next token refresh
(at most an hour), RLS enforces it at once.

Known gaps (`docs/TASKS.md`): the SELECT policies on `holidays`, `work_settings` and `approval_steps`
are company-blind (fine with one company per deploy); the legacy `has_permission` keys and the old
`app_set_user_roles` signature stay until the FR-55 release is live.

## Notes

- The "managers see everyone, edit only reports" rule = **broad read, narrow write**. Read uses
  `reads_people` (FR-55; `manager` or `people` read); write uses `is_manager_of`.
- `same_team` gives employees their team calendar without exposing other teams.
- Validate every policy on **self-hosted Supabase** before production cutover (NFR-4).

## Privileged admin RPCs (runtime user creation)

**HR employee creation (2026-08-18, FR-35 D4).** `app_create_employee` gained a third
authorization path and `app_bulk_create_employees` a second: an `hr` caller may choose any
department and any manager, but the role list is **overwritten in-database** to `{employee}` — in the
bulk path every CSV row's `role` column is clamped the same way. An HR account therefore cannot
create a manager, another HR, a security user, or an admin; granting authority remains admin-only.
The `hr` branch is checked **before** the manager branch so a user holding both gets the wider scope.
Audit rows record the path as `hr` / `bulk_hr`. **FR-55:** the branch is now `people_create` edit
(any role holding it, not only `hr`); `app_create_employee` refuses `admin` on every branch and gains
an optional `p_role_ids uuid[]` that decides extra roles through `app_set_user_role_ids` (D5), so a
non-admin still cannot create someone more privileged than themselves.

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
**FR-55 review decision (2026-10-14, `20261013200006`/`200007`):** both password RPCs, and
`app_password_reset_eligible(uuid[])` (which ids the caller may bulk-reset; the Employees list uses
it for its checkboxes), accept the **admin only**, through the single rule
`private.can_reset_password(caller, target)`. A delegated reset let one person sign in as an equal
peer and act on their own record through them (D3), so the `passwords` item was withdrawn rather
than patched. **Not closed:** impersonation through credentials a non-admin issues when creating an
employee (the creator picks the initial password and can complete the first-login change), and a
reset does not end the target's existing sessions; deferred (TASKS, FR-55 follow-ups). Bulk password reset accepts 1–100 unique non-caller employees, validates the complete payload
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

`public.set_leave_balance(p_employee_id, p_leave_type_id, p_target)` (admin, or since FR-55
`leave_balances` edit plus `can_act_on`; `42501` otherwise) sets an employee's **current** balance for a leave
type to an absolute value by writing an `adjustment` ledger row (audited `set_leave_balance`); additive
grants still go through `allocate_leave`. Granted to `authenticated`, revoked from `anon`. Used by the
admin employee create/edit forms.

`public.app_set_user_roles(p_user_id, p_roles)` (2026-07-02 hardening) **atomically replaces** a
user's roles in one transaction (the app previously did delete-then-insert as two client
statements — a failed insert lost all roles). **FR-55 superseded it with**
`public.app_set_user_role_ids(p_user_id, p_role_ids uuid[])`, which the `setRoles` server action
now calls; the old signature remains for the deploy window, touches built-in rows only, keeps custom
rows and delegates to the new one. Rules of the new RPC: the admin row never changes, for anyone
(D1; `42501`); the admin may set any other role; anyone else needs `role_assign` or `role_manager`,
`can_act_on` on the target (D3, D4), and per added or removed role `role_within` (D5), plus
`approval_steps` and `clearance` edit to give or remove `hr` and `clearance` edit for `finance`.
The caller's and target's profile rows are locked in id order, as in `app_transfer_admin`. Audited
(`set_roles`). Granted to `authenticated`, revoked from `anon`.

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

*FR-55: wherever this section names "security", "admin" or "hr" as readers of the base row, read
`leave_requests` read (admin implicitly, the hr and security presets by default);
`team_leave_calendar` is scoped `own | same_team | reads_calendar` (`manager` or `calendar` read).*

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
