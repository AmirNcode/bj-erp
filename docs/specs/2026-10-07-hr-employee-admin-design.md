# HR employee and department administration — design

**Status:** Accepted 2026-10-07 (Amir, in chat). FR-51. Amir chose to skip separate spec and plan
review gates because HR had started testing; this records the agreed design and what was built.

## Problem

HR began testing and could not do their daily work: moving people between departments, changing
direct managers and job titles, deactivating leavers, or adding and renaming departments. All of it
was admin-only in the app and in the database.

## Decisions

- **D1 — Scope of an hr caller.** On any employee who does not hold `admin`, hr may change name,
  hire date, department, direct manager and job title, and deactivate or reactivate the account.
  Personnel number, login code, password resets, bulk-import update/replace and Settings stay
  admin-only.
- **D2 — Not on admins.** An admin's record is admin-only for hr, including a deactivated admin (the
  guard checks the `user_roles` row, not `is_admin`, so hr cannot reactivate one).
- **D3 — Not on themselves.** On their own record hr keeps the self subset (name, language), like
  the existing FR-43 rule that hr cannot change their own leave balance. Stops hr choosing their own
  approver.
- **D4 — Roles: `manager` only.** hr may add or remove the `manager` role, nothing else, on a
  same-company non-admin other than themselves. Admin, hr and security stay admin-granted.
- **D5 — Departments.** hr creates departments, renames them (fa + en), sets the department
  manager, views members and posts monthly accruals. The department `code` (the bulk-import key)
  stays admin-only after creation; deleting stays admin-only.
- **D6 — Widen the existing guards (approach 1 of 3).** HR branches in the existing
  `profiles` / `departments` policies, the profile column-guard trigger, a new department column
  guard, `app_set_user_roles` and `accrue_all_leave`. One write path per field; the existing audit
  triggers log every profile and department change. Rejected: separate hr-only RPCs (two paths per
  field) and a general permissions table now (too large while HR waits; see D7).
- **D7 — A seam for configurable roles.** Every new grant calls
  `private.has_permission(uid, key)` with keys `employees.edit`, `departments.edit`,
  `accruals.run`, `roles.manager`. Today its body is "admin or hr" per key. The planned
  admin-configurable roles feature (docs/TASKS.md) replaces the body with a table lookup and moves
  the older hard-coded hr checks onto it.
- **D8 — Close the job_title / personnel_no gap.** The profile guard never compared those two
  columns, so an employee could retitle themselves or change their own personnel number, and a
  manager a report's title, through PostgREST. Both are now guarded: job title for admin and hr
  editors, personnel number admin-only.

## Database (`20261007130001_hr_employee_admin.sql`)

- `private.has_permission(uid, text)`, `EXECUTE` to `authenticated` only.
- `profiles_update` adds `has_permission(employees.edit)`. `enforce_profile_update_scope`: admin →
  anything; self → name/language; editor (same company, target holds no admin role) → name, hire
  date, department, manager, job title, active; manager-of → name, hire date. `personnel_no` added to
  the always-restricted columns.
- `departments_insert_editor` / `departments_update_editor` replace the `_admin` policies (delete
  unchanged). New trigger `departments_enforce_update_scope`: a non-admin may change only
  `name_fa`, `name_en`, `manager_id`.
- `app_set_user_roles`: hr branch — not self, same company, target holds no `admin`, symmetric
  difference of before/after ⊆ {`manager`}. Errors are 42501 with distinct messages.
- `accrue_all_leave`: guard is `has_permission(accruals.run)`.
- Only widens access, so the app version still running during a deploy keeps working.

## App

- `lib/employees/editCapabilities.ts` (pure, unit-tested) mirrors D1–D4 for the Edit Employee
  form: `profile`, `org`, `editableRoles`, `resetPassword`, `leave`, `lockedReason`.
- Edit Employee: job title field (admin + hr); department / manager / title / roles shown read-only
  with a note when hr views an admin or themselves; role checkboxes outside `editableRoles` are
  disabled; roles are written only when they changed; the "Admin actions" card is now "Account"
  (translated) and shows Reset password to admins only.
- Server actions admit hr: `updateEmployee` (column list by role), `setActive`, `setRoles`,
  `createDepartment`, `setDepartmentManager`, `getDepartmentMembers`, `runAllAccruals`; new
  `renameDepartment`.
- Departments nav item, page and Add Department page admit hr. Each row has an inline Rename.

## Verification

- `tests/sql/fr51-hr-employee-admin.sql`: 35 allowed/refused scenarios in one rolled-back
  transaction (red before the migration, green after).
- Unit: capabilities, allowed fields, nav. e2e: `tests/e2e/hr-employee-admin.spec.ts` (hr edits,
  deactivates/reactivates, toggles manager; locked on an admin and on self; creates, renames and
  assigns a manager to a department). The accrual button is not pressed in e2e (company-wide).

## Out of scope

- Admin-configurable roles and permissions (owner's next feature; D7 is its seam).
- Translating the role checkbox labels (separate TASKS item).
- hr password resets (limited helpdesk role, TASKS).
