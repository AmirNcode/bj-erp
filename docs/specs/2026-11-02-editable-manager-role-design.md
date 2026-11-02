# Editable Manager role (Manager becomes a preset)

**Date:** 2026-11-02 · **Status:** draft, waiting for owner review
**Trigger:** owner: HR says managers should not add employees. Make the Manager role editable in
Settings › Roles so the admin decides what managers may do.
**Requirements:** FR-74 (new). Extends FR-55 (configurable roles).
**Owner answers (2026-11-02):** full editable preset · "add employees" **off** after deploy · the
switch covers every create path.

## 1. What changes for whom

| Who | Today | After |
|---|---|---|
| Admin, Settings › Roles | Manager is fixed ("system"), no edit page | Manager is a **preset** like HR / Security / Finance: name fixed, cannot be deleted, permissions editable |
| Manager | Hard-wired: company-wide read of people, balances, calendar; can add employees to own team | Same reads, now as **editable permission rows**; Add employee **off** until admin turns it on |
| HR, other roles | — | unchanged |

## 2. Two halves of Manager

Manager does two different things today. Only the first half becomes editable.

**A. Grants (become permission rows, editable):**

| Today (hard-wired) | After (preset default) |
|---|---|
| `reads_people` via `has_role(uid,'manager')` | `people` **read** |
| `reads_balances` via `has_role(uid,'manager')` | `leave_balances` **read** |
| `reads_calendar` via `has_role(uid,'manager')` | `calendar` **read** |
| `app_create_employee` manager branch (own dept, self as manager, Employee only) | new item **`people_create_team`** (edit only), **not granted** by default |

**B. Reporting line (stays fixed, not in the matrix):**
- `is_manager_of`: edit direct reports' name + hire date, see their balances and requests.
- Sign the direct-manager and department-manager approval steps.
- Approve your own trip extension and the travel/itinerary rules that check `has_role(...,'manager')`.
- The `manager` approval step and `natural_approver`.
- Assigning Manager still needs `role_manager` edit (D5).

Reason: these come from `manager_id` / `departments.manager_id`, not from a level. Taking them away
would break the approval chain. The role editor shows them in a read-only "Always on for Manager"
card, like the admin-only card (D2).

## 3. New catalog item `people_create_team`

- Section: Employees. Levels: edit only (`E`). Label fa/en: «افزودن کارمند به تیم خود» / "Add employees to own team".
- Meaning: create a person in **your own department**, with **you as manager**, **Employee role only**
  (today's manager branch, unchanged rules).
- Dependency: needs `people` read (you must see the list to reach Add).
- Wider item `people_create` still means "any department". Holding both = `people_create` wins.
- D4 subset rule: a caller's `people_create` edit counts as covering `people_create_team`, so HR keeps
  editing managers who hold it. HR preset gets no new row.
- Not a manager-only item: the admin may give it to a custom role too. A holder without a department
  gets today's error "manager has no department" (renamed to "you have no department").

## 4. Every create path follows the switch

| Path | Today | After |
|---|---|---|
| `app_create_employee` (SQL) | `has_role(caller,'manager')` branch | `has_perm(caller,'people_create_team','edit')` branch; plain managers get "not allowed" |
| `createEmployee` action (`lib/actions/employees.ts:40`) | `roles.includes('manager') or people_create` | `people_create` or `people_create_team` |
| Add page guard (`manage/employees/new/page.tsx:121`) and Add button (`manage/employees/page.tsx:282`) | `isManager or people_create` | same as action |
| CSV / bulk import (`manage/employees/import`) | needs `people_create`; managers have no access | unchanged (team-only create is not offered in import) |

## 5. App code that reads `roles.includes('manager')`

Switch to permissions where it means a **grant**; keep the role check where it means **reporting line**.

- To permissions: Employees tab in nav (`lib/nav/tabs.ts:79`), employees list guard
  (`manage/employees/page.tsx:274-282`), employee detail guard (`manage/employees/[id]/page.tsx:82`),
  Add page + action (above).
- Keep role check: `editCapabilities.ts` (edit reports), `employees-helpers.ts:32` (name + hire date),
  calendar approve button, approver tabs, Home board, signatures, approval steps.
- Settings › Roles: Manager row gets an Edit link; `roles/[id]/page.tsx:24` already lets presets through.
  Remove `managerNote` text, or reword it to point at card B.

## 6. Migration plan (forward-only, add first)

Three files, each in its own transaction:
1. `…_people_create_team_key.sql`: add catalog key, allows (`edit`), dep (`people` read); map nothing legacy.
2. `…_manager_preset.sql`:
   - `roles.kind` `'system'` → `'preset'` for `system_key='manager'` (every company).
   - Insert role_permissions for every Manager role: `people`, `leave_balances`, `calendar` at read.
   - `reads_people` / `reads_balances` / `reads_calendar`: drop the `has_role(uid,'manager')` clause.
   - `app_create_employee`: manager branch keys on `people_create_team`.
   - Drop the unused `can_read_all` manager clause (no callers; keep function).
3. Update `lib/permissions/catalog.ts`, `lib/supabase/types.ts`, `schema.sql` dump, catalog unit test.

Old app during the swap: still checks `roles.includes('manager')` for the Add button; SQL refuses →
manager sees an error for a few seconds. Acceptable.

## 7. Tests

- SQL (`tests/sql/`): manager without the item cannot create; with it, own dept + self + Employee only;
  manager with `people` read removed loses company list but still sees and edits direct reports and signs steps;
  HR still can act on a manager holding `people_create_team`.
- Unit: catalog vs schema test, nav tab rule, `editCapabilities`.
- e2e: manager Add button hidden by default; admin turns it on → visible.

## 8. Open questions for owner

1. Card B (reporting-line powers) stays fixed. OK?
2. If admin removes `people` read from Manager, managers lose Manage › Employees (company list).
   Should they still see a "My team" list of direct reports? (Not in this change unless asked.)
3. Docs: update `PERMISSIONS.md` (roles table, preset table, D2/D5 notes), `REQUIREMENTS.md` FR-74,
   user guide on Help page.
