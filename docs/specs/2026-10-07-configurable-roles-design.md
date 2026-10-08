# Admin-configurable roles and permissions — design

**Status:** Draft for owner review, 2026-10-07. FR-55. Decisions D1–D12 were agreed with Amir in
chat on 2026-10-07. The implementation plan (`docs/plans/2026-10-07-configurable-roles.md`) is
written after this spec is approved.

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
  2. Granting or transferring admin.
  3. Approval override: filling any approval step, and signing one's own request.
  4. Bulk import in Update and Replace modes.
  5. The audit log (no screen today).
  6. Developer tools (`app_cleanup_e2e_users`).

  The role editor shows them in a read-only "Admin only" card so the admin can see what no role can
  ever hold.

### Delegation guards

- **D3 — Never on yourself.** No delegated permission acts on the holder's own record. This
  generalises the FR-43 and FR-51 D3 rules.
- **D4 — Subset rule.** `private.can_act_on(caller, target)` is true only when all of these hold:
  - target and caller are in the same company, and the target is not the caller;
  - the target holds no `admin` row, even a deactivated one;
  - for every catalog key, the target's level is at most the caller's level;
  - if the target holds `manager`, the caller holds `role_manager`;
  - if the target manages a department (`departments.manager_id`), the caller holds
    `departments` at Allowed.

  It guards every write that acts on a person: profile edit, deactivate and reactivate, personnel
  number, password reset (single and bulk), role change, personal-info edit, balance and policy
  edit, and filing a clearance form. Reads are exempt. Admin callers skip it. The relationship
  clauses close an impersonation path: a helpdesk that could reset a manager's password could sign
  in as them and approve their team's leave.

  The target's levels are computed from all their roles whether or not the target is active, so a
  deactivated account cannot be reactivated by someone below it.
- **D5 — Assignment.** A caller may add or remove a role only when every permission in that role
  is at or below the caller's own level (`role_assign`). `manager` needs `role_manager` instead.
  `employee` carries no permissions and is assignable with `role_assign`. The same check applies to
  the initial roles on Add Employee. The caller must also pass D4 on the target.
- **D6 — Dependencies.** Some items only work when another is granted, because their screens read
  through RLS. The UI raises the dependency automatically and says so; `app_save_role` rejects a
  set that breaks the map. The map below comes from the read paths of each screen.

  | Item | Needs (at least Read only) | Why |
  |---|---|---|
  | `people_create`, `personnel_no`, `passwords`, `role_manager`, `role_assign` | `people` | they live on the Employees screens |
  | `personal_info` | `people` | the personal-info list and import are keyed by person |
  | `clearance` at Allowed | `people` | the new-form setup reads `profiles` |
  | `departments` | `people` | members panel and manager picker read `profiles` |
  | `leave_balances` | `people` | balances live on the Edit Employee page |
  | `leave_accrual` | `departments` | the button is on the Departments page |
  | `leave_requests` | `people` | the archive joins `profiles` |
  | `approval_steps` | `people` | the page joins named approvers' `profiles` |
  | `reports` | `people`, `leave_balances`, `leave_requests` | reports are plain RLS selects |

  `clearance` at Read only (finance) and `calendar` need nothing: they read through SECURITY
  DEFINER RPCs and the `team_leave_calendar` view.
- **D7 — No self-appointment.** A non-admin cannot set themselves as the manager of any department.
  Otherwise someone with `departments` could take the department-manager signature on another
  department's requests. FR-51 D9 already stops them changing their own department's manager.

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
| | `personnel_no` | E | — | Change a personnel number (the login code) |
| | `passwords` | E | — | Reset passwords, bulk reset, print login slips |
| | `role_manager` | E | — | Give or remove the Manager role |
| | `role_assign` | E | — | Give or remove other roles (D5) |
| | `personal_info` | R/E | View, CSV export | Correct, CSV import |
| | `clearance` | R/E | Every clearance form | File, edit rows, cancel; default rows |
| Departments | `departments` | R/E | Departments page and members | Create, rename, set manager |
| Leave | `leave_balances` | R/E | Anyone's balances and accrual policy | Opening balance, corrections, policy |
| | `leave_accrual` | E | — | Post the monthly accrual for everyone |
| | `leave_requests` | R/E | Request archive incl. private reason, signatures, print | Cancel someone else's request |
| | `calendar` | R | Everyone's time-off on the calendar | — |
| | `reports` | R | HR reports | — |
| Approval chain | `approval_steps` | R/E | View the steps | Add, remove, reorder, turn on and off |
| Settings | `work_settings` | R/E | View | Weekly days off, working hours, hourly cap, enforce approval order |
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
| `leave_requests` | read | read | — |
| `calendar` | read | read | — |
| `reports` | read | — | — |
| `approval_steps` | edit | — | — |
| everything else | — | — | — |

The data each preset can reach is unchanged. Two visible differences follow from the screens now
following permissions:
- Security gains read-only access to Manage › Employees and the request archive, which show data
  their RLS already allowed.
- The "Enforce approval order" switch moves under `work_settings`. It stays admin-only in practice
  because no preset has `work_settings`.

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
- `has_permission(uid, text)` is kept as an alias for the legacy keys:

  | Legacy key | New key and level |
  |---|---|
  | `employees.edit` | `people` edit |
  | `departments.edit` | `departments` edit |
  | `accruals.run` | `leave_accrual` edit |
  | `roles.manager` | `role_manager` edit |
  | `personal_info.view` | `personal_info` read |
  | `personal_info.edit` | `personal_info` edit |
  | `separations.manage` | `clearance` edit |
  | `separations.view` | `clearance` read |

  It is dropped in a later release.
- `can_act_on(caller, target)`: D4.
- `role_within(role_id, uid)`: D5. True when every row of the role is at or below the user's level.
  For `manager` it checks `role_manager`. For `employee` it is true. For `admin` it is false.

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
| `enforce_profile_update_scope`, `personnel_no` column | `personnel_no` + `can_act_on`, admin otherwise |
| `profiles_update` | `people` edit (row level) |
| `departments_insert_editor`, `departments_update_editor` | `departments` edit |
| `enforce_department_update_scope` | as before, plus D7 |
| `allocate_leave`, `set_leave_balance`, `set_employee_leave_policy` | `leave_balances` edit + `can_act_on` |
| `accrue_employee_leave` | `is_manager_of` OR `leave_balances` read |
| `accrue_all_leave` | `leave_accrual` |
| `approval_steps` I/U/D policies, `search_approver_candidates` | `approval_steps` edit |
| `work_settings` I/U/D policies | `work_settings` edit; this includes `approval_order_enforced`, so no column guard is needed |
| `holidays` I/U/D policies | `holidays` edit |
| `employee_personal_info_select`, `app_export_personal_info` | `personal_info` read |
| `employee_personal_info_update`, `app_import_personal_info` | `personal_info` edit + `can_act_on` per row |
| `can_read_separation` | `clearance` read |
| `separation_manageable`, `app_save_separation_units`, `app_separation_warnings` | `clearance` edit (+ `can_act_on` on the leaver) |
| `app_set_employee_password`, `app_bulk_set_employee_passwords` | `passwords` + `can_act_on` per target; admin unchanged |
| `app_create_employee` | `people_create` (replaces the hr branch); new optional `p_role_ids uuid[]` checked with D5; never `admin` |
| `app_bulk_create_employees`, `app_bulk_import_employees` Add mode | `people_create`; Update and Replace stay admin (D2) |
| `cancel_leave_request` | owner, OR `leave_requests` edit (replaces the admin-only branch) |

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
- `app_set_user_roles(p_user_id uuid, p_role_ids uuid[])`: the new signature. Admin may set any
  role except `admin`, which must be unchanged. Otherwise: D3 + D4 + D5 on each added or removed
  role. Audit: `set_roles` with role names. The old `(uuid, app_role[])` signature stays for the
  deploy window. It touches built-in rows only, keeps custom rows, and never changes `admin`.
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
| Manage group, mobile Manage tab | any of the above |
| Settings | admin OR `work_settings` read OR `holidays` read |
| Settings › Roles tab | admin |

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
- **Subset matrix.** Helpdesk (`people` read + `passwords`) resets an employee. It is refused on a
  manager, a department manager, an hr holder, the admin and itself.
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
1. The admin creates "Helpdesk" (`people` read + `passwords`).
2. The admin assigns it to a throwaway user.
3. Helpdesk resets a throwaway employee and has no reset button on a throwaway manager.
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
