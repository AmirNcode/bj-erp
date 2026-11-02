# Manager role: read-only on people (no switches)

**Date:** 2026-11-02 · **Status:** approved by owner 2026-11-02; implemented on `claude/editable-manager-role` (unreleased)
**Trigger:** owner: HR says managers should not add employees. Owner first asked for an editable
Manager role, then (same day, round 3) chose a simpler design: Manager stays **fixed**, with **no
switches**, and may not change anything about an employee. Only HR and Admin change employees.
**Requirements:** FR-74 (new). Narrows FR-35 D4 (manager own-team onboarding) and the manager branch of
`enforce_profile_update_scope`.

**Owner answers (2026-11-02, final):**
- Manager stays a fixed role. No switches in Settings › Roles.
- Managers may **not**: add employees, edit names, edit hire date or any other detail, change time off.
- Managers **may**: see their direct reports, see those reports' balances, approve or reject requests,
  see the **company calendar** (who is off, company-wide).
- Company-wide people list and balances: **removed** for managers.
- Anyone with direct reports, **whatever their role**, sees those direct reports (round 2 answer, kept).
- Docs (PERMISSIONS, REQUIREMENTS, Help guide) wait until the owner says so.

## 1. What changes for whom

| Power | Manager today | Manager after |
|---|---|---|
| Add employees (own department) | yes | **no** |
| Edit direct report's name, hire date | yes | **no** |
| Change time off (balances, allowances, special leave) | no | no |
| See direct reports: profile, balances, requests | yes | yes |
| Approve / reject (direct-manager and department-manager steps) | yes | yes (unchanged) |
| Company calendar (who is off) | yes | yes (unchanged) |
| Company people list (Manage › Employees, everyone) | yes | **no**, list shows direct reports only |
| Company leave balances (everyone) | yes | **no** |

| Other people | After |
|---|---|
| Any role with direct reports (no Manager role) | **sees** direct reports' profile, balances, requests. Cannot approve or edit. |
| HR, Admin | unchanged; only they add and change employees |

## 2. SQL changes (one migration, forward-only)

`…_manager_read_only.sql`:
1. **`app_create_employee`**: delete the `has_role(caller,'manager')` branch. Non-admin needs
   `people_create` edit (HR). Error for others stays "admin or hr required" (reworded from
   "admin or manager role required").
2. **`private.enforce_profile_update_scope`**: delete the `is_manager_of` branch (`full_name`,
   `hire_date`). Managers fall through to "not permitted to update this profile".
3. **`profiles_update` policy**: drop its `is_manager_of` clause (the trigger already refuses; the policy
   should match).
4. **`private.reads_people`**, **`private.reads_balances`**: drop `has_role(uid,'manager')`.
   **`private.reads_calendar`** keeps it.
5. **`private.can_read_all`**: drop the manager clause (no callers; keeps the comment honest).
6. **New `private.is_direct_manager_of(uid, target)`**: caller active, same company,
   `target.manager_id = uid`. No role check. Add it next to `is_manager_of` in the SELECT policies of
   `profiles`, `leave_balances` / `leave_ledger` / `leave_allocations` / `employee_leave_policies`,
   `leave_requests`, and in `can_read_approval_request`.
7. **`accrue_employee_leave`**: swap `is_manager_of` for `is_direct_manager_of`. It only posts months
   already earned when a balance is read, so a direct manager's balance view stays current. It grants
   nothing new.
8. Kept as is: `is_manager_of` (with role) for every signature and approval step; `natural_approver`;
   travel trip-extension checks; `role_manager` deps.

Compatible with the still-running old app: old app shows Add / Edit to managers for a few seconds
during the swap, and SQL refuses with an error. Acceptable.

## 3. App changes

| Place | Change |
|---|---|
| `lib/actions/employees.ts:40` `createEmployee` | only `people_create` |
| `manage/employees/new/page.tsx:121` Add page guard | only `people_create`; remove manager-variant form code |
| `manage/employees/page.tsx:274-283` list | guard: `people` read **or** has direct reports. Without `people` read, force the "reports" filter. Add button only with `people_create`. `managerOnly` edit mode removed |
| `manage/employees/[id]/page.tsx:82` detail | guard: `people` read **or** caller is target's direct manager. Read-only for managers |
| `lib/employees/editCapabilities.ts` | drop `callerRoles.includes('manager')` edit paths and the `'manager'` note; managers see a read-only note |
| `lib/actions/employees-helpers.ts:32` | drop manager field list (`full_name`, `hire_date`) |
| `lib/nav/tabs.ts:79` Employees tab | `people` read **or** has direct reports |
| `messages/fa.json` + `en.json` | new read-only note; remove manager-only edit copy |
| Settings › Roles `managerNote` | reword: "Sees direct reports and the company calendar, approves requests. Cannot change employees." |

"Has direct reports" = one cheap `profiles` count where `manager_id = me`, read in the layout/nav
loader (RLS already lets a person see their reports after §2.6).

## 4. Tests

- **SQL** (`tests/sql/`, new `manager-read-only.sql`, inside `begin … rollback`):
  - manager: `app_create_employee` refused; update of report's `full_name` / `hire_date` refused;
  - manager sees own direct reports' profile, balances, requests; does **not** see a non-report's
    profile or balances; still sees the non-report on `team_leave_calendar`;
  - manager still approves a direct report's request, and a department manager still signs the
    department step for a non-direct report;
  - employee (no Manager role) with a direct report sees them; cannot approve; cannot edit;
  - HR still creates and edits employees.
- **Unit**: `editCapabilities`, nav tab rule.
- **e2e** (`999…` users only): manager has no Add button; Edit page read-only; list shows only reports.
- Update existing tests that expect manager own-team create or manager name/hire-date edit
  (grep `tests/` for `manager has no department`, `app_create_employee`, `managerOnly`).

## 5. Out of scope

- Editable Manager preset / switches (dropped by owner, round 3).
- Docs (`PERMISSIONS.md`, `REQUIREMENTS.md`, Help guide), until owner asks.
