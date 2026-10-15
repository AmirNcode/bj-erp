# Admin-configurable roles and permissions — design

**Status:** Accepted and built, 2026-10-13 (migrations `20261013200001`..`200007`),
with the 2026-10-15 sensitive-role amendment (`20261015153112`, branch `codex/fr55-reviewed`).
FR-55. Decisions D1–D12 were agreed with Amir in chat on 2026-10-07. The implementation plan is
`docs/plans/2026-10-07-configurable-roles.md`.

**Amendments made while building** (the text below describes the built state):
- Owner decision, 2026-10-15 (`20261015153112_sensitive_role_assignment.sql`): every write permission
  is sensitive. Role creation/editing stays admin-only; sensitive saves require an explicit warning
  and confirmation, and write-capable rows carry a visible warning icon/text. Sensitive roles and
  HR/Finance identity presets can only be assigned/removed by admin. HR retains its duties but may
  assign only Employee/Manager, even with extra roles. Manager is the explicit delegated exception.
- `personnel_no` left the catalog: no screen changes a personnel number, and the login email is
  derived from it. The column stays admin-only in SQL. The catalog has 16 items from this spec
  plus four from main's FR-56..65: `absences`, `finance`, `personal_info_own`, `special_leave`
  (20 in all).
- The role-set RPC is `app_set_user_role_ids(uuid, uuid[])`. A `uuid[]` overload of
  `app_set_user_roles` would break PostgREST's resolution by argument names, so the old
  `(uuid, app_role[])` function keeps its name and now delegates.
- D4 gained identity clauses (approvers and clearance signers), D6 gained dependencies, and the
  approval-order switch moved from admin-only to `approval_steps` edit. Each is marked below.
- Owner ruling (a), 2026-10-13: the HR preset also covers Security and Finance, so D4 lets HR act
  on their holders.
- Final review, 2026-10-14:
  - D4/D5: a target's `personal_info_own` counts as covered when the caller holds
    `personal_info_own` or `personal_info` edit (`can_act_on`, `role_within`, and the TS mirror).
    Otherwise switching the self-only item on for any role would put its holders out of HR's
    reach. A role without personal-info power (say, people read only) still cannot act on them.
  - D1 transfer: when the new admin has no personnel number (the bootstrap `admin` account), the
    typed confirmation is their employee code. An old admin left with no other role keeps the
    company's Employee role.
  - Bulk create and CSV import refuse a non-zero opening balance without `leave_balances` edit, as
    the single Add Employee form already did.
  - The Reports page shows the today pulse only to admin and hr, whose pulse is company-wide.
- Independent review, 2026-10-14 (decision by Amir):
  - **Password resets are admin-only for now** (`20261013200007`). A delegated reset let one person
    sign in as an equal peer and act on their own record through them, which defeats D3. A check
    that the target cannot act back on the caller closed only that case; inactive peers,
    reset-then-promote and resetting one's own approver stayed open. So the `passwords` item left
    the catalog (19 items): `permission_keys`, `permission_allows` (the `role_permissions` CHECK
    and `app_save_role` refuse it), `permission_deps`, the TS catalog and the role editor. Stored
    grants are deleted, and `perm_level` / `role_within` read only rows the catalog allows, so a
    row that survived counts for nothing. Single reset, bulk reset, the eligibility RPC and the
    `enforce_profile_update_scope` password branch are the admin's alone; password resets join D2.
  - `private.can_reset_password(caller, target)` (`20261013200006`, now `is_admin(caller)`) is the
    one reset rule; `app_password_reset_eligible(uuid[])` feeds the Employees list so its bulk
    selection holds only accepted rows.
  - **Deferred, not closed:** impersonation through credentials a non-admin issues when CREATING
    an employee. Every creator (`people_create`, a Manager onboarding to their team, bulk create)
    chooses the initial password and can complete the first-login change themselves; a reset does
    not end the target's sessions. Example (pre-existing on main): HR creates a hire, makes them
    the only named approver, and approves HR's own request as them. The review's account-control
    policy ("D13") and issuer tracking ("Tier 2") are deferred owner decisions. **D3 is not fully
    protected**; see TASKS "FR-55 follow-ups".

## Problem

Every grant in the app is hard-coded. About 95 server actions check literal role lists
(`requireCaller({anyOf: ['admin', 'hr']})`), and about 60 SQL policies, RPCs and triggers check
`is_admin` or `has_role(uid, 'hr')`. Giving someone new access needs a migration and a release. The
client wants to hand out narrower access without a developer: a helpdesk that resets passwords, a
clerk who maintains holidays, a deputy who reads reports.

The owner wants an admin screen where roles are created and edited, each with a three-way setting
per access item (Allowed / Read only / Not allowed), laid out like the connector permissions screen
in the Claude desktop app: collapsible sections, each listing its items, each item with a three-way
segmented control.

One hard requirement: **the feature must never let a second admin come into existence**, neither
directly (granting `admin`) nor by escalation (a role that can build or impersonate an admin).

The FR-51 seam `private.has_permission(uid, key)` (D7 of `2026-10-07-hr-employee-admin-design.md`)
exists for this. This feature also closes two TASKS items: the limited helpdesk role, and the role
checkboxes that show raw English slugs.

## Decisions

### Admin

- **D1 — Exactly one admin; it moves only by transfer.**
  - A partial unique index allows at most one `user_roles` row with `role = 'admin'`. One company
    per deploy, so the index is global.
  - No path adds or removes `admin`: not `app_set_user_roles`, not `app_create_employee`, not bulk
    import.
  - `app_transfer_admin(p_target, p_personnel_no, p_password)` is the only path. The caller must be
    the admin and must re-enter their own password (checked with `crypt`, as in
    `app_change_my_password`). The typed personnel number must match the target. The target must
    be active, in the same company, and not the caller. One transaction deletes the caller's admin
    row and inserts the target's, then writes an audit row. The old admin keeps their other roles.
  - The existing last-active-admin trigger now means the admin cannot be deactivated at all; they
    transfer first.
  - The migration first asserts that at most one admin row exists. If there are more, it fails and
    the deploy stops before the app swap.
  - No recovery script for a locked-out admin (owner decision). A lockout is handled case by case.

- **D2 — Locked, admin-only operations.** These are never in the matrix and check `is_admin`
  directly:
  1. The role editor: create, edit and delete roles.
  1a. Password resets, single and bulk (review decision 2026-10-14, `20261013200007`).
  2. Granting or transferring admin.
  3. Approval override: filling any approval step, and signing one's own request.
  4. Bulk import in Update and Replace modes.
  5. The audit log (no screen today).
  6. Developer tools (`app_cleanup_e2e_users`).
  7. `work_settings.hours_per_day`, which moves past balances (trigger
     `work_settings_enforce_scope`, main's rule).
  8. `profiles.personnel_no`, `employee_code` and `company_id`.

  The approval-order switch (`work_settings.approval_order_enforced`, main's FR-66) is **not** on
  this list. An earlier draft made it admin-only; it now belongs to `approval_steps` edit, since
  whoever edits the steps decides whether their order is enforced. A holder flips it through
  `app_set_approval_order_enforced`, and the `work_settings_enforce_scope` trigger refuses a
  change to the column from anyone without `approval_steps` edit.

  The role editor shows them in a read-only "Admin only" card so the admin can see what no role can
  ever hold.

### Delegation guards

- **D3 — Never on yourself.** No delegated permission acts on the holder's own record. This
  generalises the FR-43 and FR-51 D3 rules. The one explicit exception is `personal_info_own`
  (main's FR-63): the holder may correct their own personal information. Main's FR-63 rule stays
  in `app_import_personal_info`: a CSV row for the importer's own personnel number is refused
  unless the importer holds `personal_info_own` (the admin holds it implicitly), and every other
  row goes through `can_act_on`. Nobody else can ever edit their own row through the import.
- **D4 — Subset rule.** `private.can_act_on(caller, target)` is true only when all of these hold:
  - target and caller are in the same company, and the target is not the caller;
  - the target holds no `admin` row, even a deactivated one;
  - for every catalog key, the target's level is at most the caller's level;
  - if the target holds `manager`, the caller holds `role_manager`;
  - if the target manages a department (`departments.manager_id`), the caller holds
    `departments` at Allowed;
  - **identity clauses** (added while building): if the target holds `hr`, or is the named approver
    (`approval_steps.approver_id`) of an active step, the caller holds `approval_steps` edit; if
    the target holds `hr` or `finance`, or is a `separation_units.signer_id`, or is the
    `separation_signoffs.signer_id` of a form that is `in_progress` or `awaiting_finance`, the
    caller holds `clearance` edit. Role rows count whether or not the target is active.

  It guards every write that acts on a person: profile edit, deactivate and reactivate, password
  reset (single and bulk), role change, personal-info edit, balance and policy edit, special-leave
  grants, and filing a clearance form. Reads are exempt. Admin callers skip it. The relationship
  and identity clauses close an impersonation path: a helpdesk that could reset a manager's or an
  hr holder's password could sign in as them and approve their team's leave or sign a clearance row.
  Manager is not an identity clause because managers sign through `profiles.manager_id` and
  `departments.manager_id`. Those are set through `people` edit and `departments` edit, which D4
  and D7 already guard. `security` is not an identity either: since `20261012120003` an approval
  step may name only `manager`, `hr` or a person.

  The target's levels are computed from all their roles whether or not the target is active, so a
  deactivated account cannot be reactivated by someone below it.
- **D5 — Assignment.** Only admin may add/remove roles with any valid `edit` permission, or the
  HR/Finance identity presets. A non-admin may assign Manager with `role_manager`; Employee is
  automatic on creation and toggleable with `role_assign`. HR holders are limited to those two
  roles, even when other roles grant additional permissions. Other non-admins with `role_assign`
  may assign read-only roles within their own access. The same checks cover initial roles on Add
  Employee and the legacy enum RPC. The caller must also pass D4. `admin` moves only via D1 transfer.
- **D6 — Dependencies.** Some items only work when another is granted, because their screens read
  through RLS. The UI raises the dependency automatically and says so; `app_save_role` rejects a
  set that breaks the map. The map below comes from the read paths of each screen.

  | Item | Needs (at least Read only) | Why |
  |---|---|---|
  | `people_create`, `role_manager`, `role_assign` | `people` | they live on the Employees screens (`passwords` was here until `20261013200007` removed the item) |
  | `role_manager` | also `leave_balances`, `calendar` | a Manager reads every balance and the calendar (`reads_*`), so whoever can make one must already read them |
  | `personal_info` | `people` | the personal-info list and import are keyed by person |
  | `clearance` at Allowed | `people` | the new-form setup reads `profiles` |
  | `departments` | `people` | members panel and manager picker read `profiles` |
  | `leave_balances` | `people` | balances live on the Edit Employee page |
  | `leave_accrual` | `departments` | the button is on the Departments page |
  | `leave_requests` | `people` | the archive joins `profiles` |
  | `approval_steps` | `people` | the page joins named approvers' `profiles` |
  | `reports` | `people`, `leave_balances`, `leave_requests` | reports are plain RLS selects |
  | `absences` | `people`, `leave_requests` | the approved-absences board reads `leave_requests` joined to `profiles` |
  | `special_leave` | `people`, `leave_balances` | the card sits on Edit Employee and adds days to a balance |

  `clearance` at Read only (finance), `calendar`, `finance` and `personal_info_own` need nothing:
  they read through SECURITY DEFINER RPCs and the `team_leave_calendar` view, or (the last) act
  on the caller's own row.
- **D7 — No self-appointment.** A non-admin cannot set themselves as the manager of any department.
  Otherwise someone with `departments` could take the department-manager signature on another
  department's requests. FR-51 D9 already stops them changing their own department's manager.
  Enforced in `enforce_department_update_scope`, on insert and update. The analogues (a `people`
  editor who names themselves as a report's manager, an `approval_steps` editor who names
  themselves approver, a `clearance` editor who names themselves signer, a `people_create`
  holder who sets themselves as manager of a new hire) are not guarded; they are open questions
  for the owner (`docs/TASKS.md`).

### Scope and model

- **D8 — Company-wide only.** A granted item covers the whole company, apart from the admin and the
  holder (D3, D4). Department-scoped permissions can be added later as a fourth state.
- **D9 — Roles.**
  - System: `Admin`, `Manager`, `Employee`. Not editable, not in the matrix. Admin holds
    everything. Manager is the reporting relationship plus the hard-wired company-wide read
    (FR-17). Employee is the baseline.
  - Presets: `HR`, `Security`, `Finance`. Seeded with exactly today's grants. Permissions are
    editable; name fixed; never deletable. They keep their identity-based powers: HR co-signs as
    the `hr` approval step and signs the HR clearance row; Finance signs the clearance finance box.
  - Custom: everything the admin creates.
- **D10 — Custom roles are not approval-step roles in v1.** Approval steps stay on the `app_role`
  enum (direct manager, department manager, `hr`, `security`, or a named person).
- **D11 — Role names are English only, everywhere.** One `name` column; the Farsi UI shows it as
  is. Built-in names: `Admin`, `Manager`, `Employee`, `HR`, `Security`, `Finance`. Custom names: 1–40
  characters, latin letters, digits, space, `&`, `/` and `-`, first character a letter or digit,
  unique per company ignoring case. Section labels, item labels and descriptions stay translated
  (fa + en).
- **D12 — Deleting a custom role.** The dialog shows how many people hold it, then each holder's
  name and personnel number, with a **Copy personnel numbers** button (one per line) so the admin
  can go and re-assign them. Confirming removes the role from everyone, deletes it and audits the
  holder list. Presets and system roles cannot be deleted.

## Permission catalog

Levels: `read` < `edit`. Absence means Not allowed. In the UI, Allowed = `edit`.
**Shape:** `R/E` = both levels meaningful, `E` = action only (Read only disabled), `R` = read only
(Allowed disabled).

| Section | Key | Shape | Read only | Allowed |
|---|---|---|---|---|
| Employees | `people` | R/E | Employees list and records, read-only | Edit name, hire date, department, direct manager, job title; deactivate and reactivate |
| | `people_create` | E | — | Add employees (form, CSV import in Add mode) |
| | ~~`passwords`~~ | — | — | Removed 2026-10-14 (`20261013200007`): password resets are admin-only (D2) |
| | `role_manager` | E | — | Give or remove the Manager role |
| | `role_assign` | E | — | Give or remove other roles (D5) |
| | `personal_info` | R/E | View, CSV export | Correct, CSV import |
| | `personal_info_own` | E | — | Edit one's own personal information (FR-63; D3 exception) |
| | `clearance` | R/E | Every clearance form | File, edit rows, cancel; default rows |
| Departments | `departments` | R/E | Departments page and members | Create, rename, set manager |
| Leave | `leave_balances` | R/E | Anyone's balances and accrual policy | Opening balance, corrections, policy |
| | `leave_accrual` | E | — | Post the monthly accrual for everyone |
| | `special_leave` | E | — | Grant marriage or bereavement leave on Edit Employee (FR-65) |
| | `leave_requests` | R/E | Request archive incl. private reason, signatures, print | Cancel someone else's request |
| | `calendar` | R | Everyone's time-off on the calendar | — |
| | `absences` | R | The approved-absences board (FR-56) | — |
| | `reports` | R | HR reports | — |
| Finance | `finance` | R | Finance's list of completed approvals with per diem (FR-62) | — |
| Approval chain | `approval_steps` | R/E | View the steps | Add, remove, reorder, turn on and off, enforce the approval order |
| Settings | `work_settings` | R/E | View | Weekly days off, working hours, hourly cap (not hours per day, which stays admin-only) |
| | `holidays` | R/E | View | Add, edit, delete, CSV upload |

### Preset seeds (= today's behaviour)

| Key | HR | Security | Finance |
|---|---|---|---|
| `people` | edit | read | — |
| `people_create` | edit | — | — |
| `role_manager` | edit | — | — |
| `personal_info` | edit | — | — |
| `clearance` | edit | — | read |
| `departments` | edit | — | — |
| `leave_balances` | edit | read | — |
| `leave_accrual` | edit | — | — |
| `special_leave` | edit | — | — |
| `leave_requests` | read | read | — |
| `calendar` | read | read | — |
| `absences` | read | read | — |
| `reports` | read | — | — |
| `finance` | read | — | read |
| `approval_steps` | edit | — | — |
| `work_settings` | edit | — | — |
| `holidays` | edit | — | — |
| `role_assign`, `personal_info_own` | — | — | — |

`personal_info_own` is on no preset: the admin holds it implicitly, and the switch is per role.
HR's `work_settings`, `holidays` and `finance` rows follow main's FR-59 and FR-62; `special_leave`,
`absences` and `finance` read follow owner ruling (a) of 2026-10-13, so the HR preset covers what
Security and Finance hold and D4 lets HR act on those holders.

The data each preset can reach is unchanged. Visible differences follow from the screens now
following permissions:
- Security gains read-only access to Manage › Employees and the request archive, which show data
  their RLS already allowed.
- The "Enforce approval order" switch belongs to `approval_steps` edit (see D2), so HR keeps it.
  `hours_per_day` stays admin-only.

Behaviour changes for hr:
- D7: hr can no longer make themselves a department's manager.
- D4: hr cannot act on someone who holds a permission hr lacks. No such person exists until the
  admin creates a role hr does not cover.

## Database

All new migrations are forward-only and add first, so the app still running during a deploy keeps
working.

### Tables

- **`roles`:**
  - Columns: `id` · `company_id → companies` · `system_key app_role NULL` · `kind text`
    (`system` | `preset` | `custom`) · `name text` · `created_at` · `updated_at`.
  - Unique `(company_id, system_key)`; unique `(company_id, lower(name))`.
  - CHECK: `system_key` is not null exactly when `kind` is `system` or `preset`.
  - Seeded with six rows per company.
- **`role_permissions`:**
  - Columns: `role_id → roles on delete cascade` · `permission text` · `level text`
    (`read` | `edit`). Primary key `(role_id, permission)`.
  - CHECK: `private.permission_allows(permission, level)`, an immutable function holding the
    catalog's keys and shapes.
  - Rows are only allowed on preset and custom roles.
- **`user_roles`:**
  - New column `role_id → roles`, backfilled from the enum, then `NOT NULL`. Unique
    `(user_id, role_id)`.
  - The enum column `role` becomes nullable. A BEFORE trigger sets it from
    `roles.system_key`, so built-in rows carry the enum and custom rows carry NULL.
  - Existing readers of `user_roles.role` (`has_role`, approval steps, the JWT hook, the old app)
    keep working.
- **One-admin index:** `create unique index … on user_roles ((true)) where role = 'admin'`.

RLS on the two new tables: SELECT for active members of the company. `supabase_auth_admin` gets
SELECT for the token hook. No client INSERT, UPDATE or DELETE.

### Helpers (`private` schema, SECURITY DEFINER, `search_path = ''`, EXECUTE to `authenticated`)

- `perm_level(uid, key) → int`: 0 none, 1 read, 2 edit. It takes the maximum over all the user's
  roles, regardless of whether the user is active, and returns 2 for the admin.
- `has_perm(uid, key, level)`: `is_active(uid)`, and either `is_admin(uid)` or
  `perm_level(uid, key) >=` the requested level.
- `reads_people`, `reads_balances`, `reads_calendar(uid)`: `manager` role OR the matching read
  (`people`, `leave_balances`, `calendar`). They replace `can_read_all` in the broad-read policies.
- `has_permission(uid, text)` is kept as an alias for the legacy keys:

  | Legacy key | New key and level |
  |---|---|
  | `employees.edit` | `people` edit |
  | `departments.edit` | `departments` edit |
  | `accruals.run` | `leave_accrual` edit |
  | `roles.manager` | `role_manager` edit |
  | `personal_info.view` | `personal_info` read |
  | `personal_info.edit` | `personal_info` edit |
  | `personal_info.edit_own` | `personal_info_own` edit |
  | `special_leave.grant` | `special_leave` edit |
  | `separations.manage` | `clearance` edit |
  | `separations.view` | `clearance` read |
  | `settings.edit` | `work_settings` edit AND `holidays` edit |
  | `absences.view` | `absences` read |
  | `finance.view` | `finance` read |

  It is dropped in a later release.
- `caller_company()`: the active caller's company; scopes the config write policies and the role
  RPCs.
- `can_act_on(caller, target)`: D4.
- `role_within(role_id, uid)`: D5. True when every row of the role is at or below the user's level.
  For `manager` it checks `role_manager`. For `employee` it requires `role_assign` and is otherwise
  true (the role has no rows). For `admin` it is false. False for an unknown role or another
  company's.

### Policies and gates that change

**Broad read.** `can_read_all` splits by what is read:

| Object | New predicate |
|---|---|
| `profiles`, `user_roles` SELECT | `manager` OR `people` read |
| `leave_ledger`, `leave_allocations`, `employee_leave_policies` SELECT | `manager` OR `leave_balances` read |
| `team_leave_calendar` | `manager` OR `calendar` read |
| `leave_requests`, `leave_request_approvals` SELECT | own, `is_manager_of`, admin, OR `leave_requests` read (replaces the literal security and hr) |

**Writes.** Each gate moves to `has_perm`, with `can_act_on` wherever a person is the target:

| Object | New gate |
|---|---|
| `enforce_profile_update_scope`, editor branch | `people` edit + `can_act_on` |
| `enforce_profile_update_scope`, password branch | removed in `20261013200007`: only the admin flips `must_change_password` |
| `enforce_profile_update_scope`, `personnel_no`, `employee_code`, `company_id` | admin only, as before |
| `profiles_update` | `people` edit (row level) |
| `departments_insert_editor`, `departments_update_editor` | `departments` edit |
| `enforce_department_update_scope` | as before, plus D7 |
| `allocate_leave`, `set_leave_balance`, `set_employee_leave_policy` | `leave_balances` edit + `can_act_on` |
| `private.special_leave_target` (grant and revoke special leave) | `special_leave` edit + `can_act_on`; never on oneself or an admin unless the caller is the admin |
| `special_leave_grants` SELECT | own rows, or `special_leave` edit in the caller's company |
| `accrue_employee_leave` | `is_manager_of` OR `leave_balances` read |
| `accrue_all_leave` | `leave_accrual` |
| `approval_steps` I/U/D policies, `search_approver_candidates` | `approval_steps` edit; the I/U/D policies also require `company_id = private.caller_company()` |
| `work_settings` I/U policies | `work_settings` edit in the caller's company. `work_settings_enforce_scope` keeps `hours_per_day` admin-only and lets only `approval_steps` edit (or the admin) change `approval_order_enforced` |
| `work_settings` delete policy | admin, in the caller's company |
| `app_set_approval_order_enforced(boolean)` | `approval_steps` edit or admin; flips the switch without `work_settings` edit |
| `holidays` I/U/D policies | `holidays` edit in the caller's company |
| `employee_personal_info_select`, `app_export_personal_info` | own row, or `personal_info` read in the caller's company |
| `employee_personal_info_update`, `app_import_personal_info` | own row with `personal_info_own` edit; any other row with `personal_info` edit + `can_act_on` per row (the admin skips `can_act_on`) |
| `can_read_separation` | `clearance` read |
| `separation_manageable`, `app_save_separation_units`, `app_separation_warnings` | `clearance` edit (+ `can_act_on` on the leaver) |
| `app_set_employee_password`, `app_bulk_set_employee_passwords`, `app_password_reset_eligible` | admin only, through `private.can_reset_password` (`20261013200006`/`200007`); was `passwords` + `can_act_on` |
| `app_create_employee` | `people_create` (replaces the hr branch); new optional `p_role_ids uuid[]` checked with D5 through `app_set_user_role_ids`; never `admin` |
| `app_bulk_create_employees`, `app_bulk_import_employees` Add mode | `people_create`; Update and Replace stay admin (D2) |
| `cancel_leave_request` | owner, OR `leave_requests` edit in the caller's company and never on the admin (replaces the admin-only branch) |
| `request_approval_progress` | whoever reads the request: own, `is_manager_of`, or `leave_requests` read |
| `finance_approved_requests` | `finance` read, through the legacy alias `finance.view` |
| the approved-absences board (`getAbsences` action) | `absences` read; the rows come through `leave_requests_select` |

**Unchanged:**
- Approval signing in `approve_leave_request` / `reject_leave_request` (identity and relationship;
  the admin override stays admin per D2).
- The clearance HR row and finance box.
- `is_manager_of` and `is_department_manager_of`.
- `get_org_chart` and `get_my_team_directory`.
- `audit_log` (admin).

### RPCs (`public`, SECURITY DEFINER, granted to `authenticated`, revoked from `anon`, audited)

- `app_list_roles()`: every role of the company with kind, name, holder count and permissions.
  Readable by any active member, so the employee forms can render checkboxes.
- `app_role_holders(p_role_id)`: name and personnel number of each holder. Admin only.
- `app_save_role(p_id uuid null, p_name text, p_permissions jsonb)`: creates a custom role, or
  updates a custom or preset role. Admin only. Validates the name (D11, ignored for presets),
  catalog keys and shapes, and dependencies (D6). Replaces the permission rows. Audit:
  `role.create` / `role.update` with the before and after permissions.
- `app_delete_role(p_id)`: admin only, custom roles only. Deletes the assignments and the role.
  Audit: `role.delete` with the holder list. Returns the removed holders.
- `app_set_user_role_ids(p_user_id uuid, p_role_ids uuid[])`: the new role-set RPC (not a
  `uuid[]` overload of `app_set_user_roles`, see the amendments). Admin may set any role except
  `admin`, which must be unchanged for everyone. Otherwise: the caller needs `role_assign` or
  `role_manager`, then D3 + D4 on the target and D5 on each added or removed role, with the
  identity-preset rule for `hr` and `finance`. Locks the caller's and target's profile rows in id
  order, like `app_transfer_admin`. Audit: `set_roles` with role names. The old
  `app_set_user_roles(uuid, app_role[])` stays for the deploy window and delegates: it touches
  built-in rows only, keeps custom rows, and never changes `admin`.
- `app_set_approval_order_enforced(p_enforced boolean)`: `approval_steps` edit or admin. Upserts
  the company's `work_settings` row. Main's `work_settings_audit_change` trigger writes the audit
  row.
- `app_transfer_admin(p_target uuid, p_personnel_no text, p_password text)`: D1. Audit:
  `admin.transfer`.
- `app_my_permissions()`: `{key: level}` for the caller. Fallback when the JWT claim is missing.

### Token hook

`custom_access_token_hook` adds `app_perms` (`{key: level}`; the admin gets every key at its
highest level) next to `app_roles`. It emits empty arrays and objects for an inactive user. Like
roles, a change reaches the app on the next token refresh (at most one hour). RLS enforces it at
once.

## App

### Permission plumbing

- **`lib/permissions/catalog.ts`** (new, pure), the single TS source:
  - Sections and items: key, shape, dependencies, message keys.
  - `applyLevel(state, key, level)`: sets one item and raises its dependencies, returning which
    ones it raised.
  - `sectionSummary(state, section)`: `custom` | `allow` | `read` | `none`.
  - `applySectionBulk(state, section, choice)`: Read-only-all leaves action-only items Not allowed.
  - `isWithin(roleState, callerPerms)`.

  A unit test checks the keys and shapes against `permission_allows` in `supabase/schema.sql`.
- **`lib/auth/permissions.ts`** (new): `getCachedPermissions()` reads the `app_perms` claim, with
  `app_my_permissions()` as the fallback, cached per request. `can(perms, key, level)`.
- **`lib/auth/context.ts`:** `requireCaller({ perm: [key, level] })`, alongside `anyOf`.
  Relationship gates (manager) keep `anyOf`.

### Gates that move

Server actions in `lib/actions/{employees,departments,settings,personal-info,clearance,reports}.ts`
and `lib/actions/leave/{balances,review}.ts` switch to `perm`. This also fixes the import page
admitting hr while `importEmployees` refused them: Add mode now needs `people_create`, Update and
Replace need admin.

**Navigation (`lib/nav/tabs.ts`) and page guards:**

| Item | Visible when |
|---|---|
| Employees | `manager` OR `people` read |
| Departments | `departments` read |
| Approvals | unchanged (approvers) |
| Request archive | `leave_requests` read |
| Approval steps | `approval_steps` read |
| Reports | `reports` read |
| Absences (admin only; other holders see the board on Home) | admin |
| Finance | `finance` read: a Manage item for a caller who already has a Manage group, else a bottom tab |
| Manage group, mobile Manage tab | any of the above except Finance |
| Settings | admin OR `work_settings` read OR `holidays` read |
| Settings › Roles tab | admin |

The old HR `/manage/settings` page forwards to `/settings` for anyone who sees Settings.

Personal-info page: `personal_info` read; its import: edit. Employee import page: `people_create`.
Clearance buttons: `clearance` read / edit.

**`lib/employees/editCapabilities.ts` and `employees-helpers.ts`** mirror D3–D5 from the caller's
permissions and the target's roles. The roles come from `app_list_roles`, so the target's levels
can be computed without another call. `editableRoles` becomes the set of role ids the caller may
toggle.

**Unchanged:** approval queues, the Home pulse band and approve buttons (identity based),
calendar contents (the view decides).

### Settings › Roles (admin)

**Settings tabs.** Settings gains two tabs: **General** (today's page) and **Roles**
(`/settings/roles`).

**Roles list.** One card, one row per role:
- **Admin:** lock icon, the holder's name and personnel number, a **Transfer admin** button.
- **Manager, Employee:** muted, "Built-in, follows the reporting line" / "Everyone". No actions.
- **HR, Security, Finance:** a "Built-in" badge, holder count, **Edit**.
- **Custom roles:** holder count, **Edit**, **Delete**.
- A **New role** button in the header.

**Role editor** (`/settings/roles/new`, `/settings/roles/[id]`). Width `max-w-[900px]`, same as
Settings.
- **Name field.** English; disabled for presets.
- **One collapsible card per section, built like the reference screenshot:**
  - **Header:** a chevron; the section title; a count badge with the number of items; at the end, a
    dropdown showing the section summary (**Custom** when mixed, **Allowed**, **Read only**,
    **Not allowed**). Picking a value applies it to the whole section.
  - **Rows:** the item label, with a muted one-line description below it. At the end, a segmented
    control with three icon buttons: check-circle = Allowed, eye = Read only, ban = Not allowed.
    - The selected segment has a raised background.
    - It is a radiogroup with arrow-key navigation, and each segment has an `aria-label`.
    - A disabled segment (Read only on action-only items, Allowed on read-only items) is greyed,
      with a tooltip: "This item has no read-only level" / "This item can only be viewed".
    - Rows are separated by a hairline.
  - **Dependency notes.** When a change raises a dependency, the raised row shows a small note,
    "Turned on because Reports needs it", until the next save.
- **"Admin only" card.** A lock icon and the D2 list, no controls.
- **Save bar.** A sticky bar at the bottom with **Save** and **Cancel**. Leaving with unsaved
  changes asks first.
- **Mobile.** Below `sm` the segmented control drops under the label. Touch targets are at least
  40 px.

**Delete dialog (AlertDialog).**
- "{n} people hold this role."
- A scrollable list of name and personnel number.
- **Copy personnel numbers**, which copies them one per line and confirms with a toast.
- **Delete** (destructive) and **Cancel**.

**Transfer admin dialog.**
- Person search (`components/PersonSearch.tsx`, active people only).
- "Type their personnel number to confirm".
- "Your password".
- A warning: "You will lose admin. Only the new admin can give it back."
- On success the app refreshes the session and goes to Home.

### Employee forms

`RoleCheckboxes` lists every role from `app_list_roles`:
- It shows English names and uses `data-testid="role-<system_key or id>"`.
- Boxes outside `editableRoles` are disabled.
- The Admin box is always disabled, with the hint "Transfer it in Settings › Roles".
- Role chips in the Employees list and the side-panel role subtitle use the role names.

### Messages

`messages/fa.json` and `messages/en.json` get these namespaces:
- `roles.*`: list, editor, dialogs, admin-only card.
- `permissions.sections.*` and `permissions.items.<key>.{label,description}`.
- `permissions.levels.*` and `permissions.deps.*`.

Role names are data, not messages.

## Verification

**`tests/sql/fr55-roles-permissions.sql`** (one rolled-back transaction, red before the migration,
green after):
- **One admin.** The index refuses a second admin row. Transfer:
  - fails on a wrong password, a wrong personnel number, an inactive target, or the caller
    themselves;
  - succeeds otherwise, after which there is still exactly one admin.
- **Locked operations.** A custom role holding every catalog item at its highest level is still
  refused all of D2: saving or deleting a role, `app_transfer_admin`, filling any approval step,
  bulk Update/Replace, and reading the audit log.
- **Subset matrix.** Helpdesk (`people` read + `role_assign`, plus a stored `passwords` grant since
  `20261013200007`) is "above" hr and refused on a manager, a department manager, an hr holder,
  the admin and itself. No non-admin resets a password, with or without a stored grant.
- **Assignment.** hr gives and removes Manager. hr cannot give Helpdesk, which it does not cover.
  A `role_assign` holder gives a role inside its own set and is refused one outside it.
- **Validation.** Dependency violations, unknown keys, and invalid levels are rejected.
- **Plumbing.** The legacy `has_permission` keys still answer. The JWT hook claim has the expected
  contents. D7 holds. Deleting a role returns its holders.

**Existing SQL tests.** `tests/sql/fr51-hr-employee-admin.sql`,
`fr52-53-signature-personal-info.sql` and `fr54-clearance.sql` are rewritten where their fixtures
insert a second admin. They must stay green: that is the parity proof for the presets.

**Unit tests:** the catalog against the SQL, dependency raising, the section summary and bulk
actions, `can()`, the capabilities including D3–D5, and nav visibility.

**e2e `tests/e2e/roles.spec.ts`.** Only `999…` throwaway users:
1. The admin creates a personal-info desk (`personal_info` edit, which raises `people` read); the
   editor offers no Passwords item.
2. The admin assigns it to a throwaway user.
3. The desk edits a throwaway employee's personal information, is read-only on a throwaway
   manager, and has no reset button on either.
4. The delete dialog lists the holder's personnel number.

Specs that select role checkboxes by label (`hr-employee-admin`, `hr-role`, `team`, `_helpers`)
move to test ids. Transfer is covered in SQL only, because the local database holds the real
roster.

**Manual checks:**
- In the browser preview: the roles list and editor in fa (RTL), en, and at mobile width; the
  delete-dialog copy; the role boxes on Edit Employee.
- Log in as Ayasi (124) to confirm hr parity.

## Out of scope

- Custom roles as approval-step roles (D10).
- Department-scoped permissions (D8).
- An admin recovery script (D1).
- An audit-log screen.
- A leave-types editor (FR-8).
- The unguarded `accrue_leave(uuid, uuid)` balance read, found while inventorying. It is a separate
  task.
- Dropping the legacy `has_permission` keys and the old `app_set_user_roles` signature (next
  release).
