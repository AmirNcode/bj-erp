# Editable Manager role (Manager becomes a preset)

**Date:** 2026-11-02 · **Status:** draft, waiting for owner review
**Trigger:** owner: HR says managers should not add employees. Make the Manager role editable in
Settings › Roles so the admin decides what managers may do.
**Requirements:** FR-74 (new). Extends FR-55 (configurable roles).
**Owner answers (2026-11-02):** full editable preset · team switch **off** after deploy · the switch
covers every create path · switch = add **and deactivate** own team · company-wide reads become
separate switches (on by default) · anyone with direct reports **sees** them, any role; acting on them
stays with the Manager role. Docs (PERMISSIONS, REQUIREMENTS, Help guide) wait until owner says so.

## 1. What changes for whom

| Who | Today | After |
|---|---|---|
| Admin, Settings › Roles | Manager is fixed ("system"), no edit page | Manager is a **preset** like HR / Security / Finance: name fixed, cannot be deleted, permissions editable |
| Manager | Hard-wired company-wide read; can add employees to own team; cannot deactivate | Company-wide reads = three switches, **on** by default. New team switch **off**: when on, add to own team **and deactivate / reactivate** own direct reports |
| Anyone with direct reports (any role) | Sees reports only if they hold Manager | **Sees** direct reports' profile, balances, requests, whatever their role |
| HR, other roles | — | unchanged |

## 2. Two kinds of Manager power

**A. Switches (permission rows, editable in Settings › Roles):**

| Switch | Catalog item | Manager default | Replaces |
|---|---|---|---|
| Company people list | `people` read | on | `has_role(uid,'manager')` in `reads_people` |
| Company leave balances | `leave_balances` read | on | same in `reads_balances` |
| Company calendar | `calendar` read | on | same in `reads_calendar` |
| Add + deactivate own team | new **`people_team`** edit | **off** | manager branch of `app_create_employee` |

**B. Reporting line (fixed, no switch).** Comes from the org chart (`profiles.manager_id`,
`departments.manager_id`), not from a switch:
- **See** direct reports: any role (new, §4).
- **Act** on direct reports, Manager role still needed (today's `is_manager_of`): approve their leave,
  sign the direct-manager / department-manager steps, edit their name + hire date, travel trip checks.
- Assigning Manager still needs `role_manager` edit (D5).

Why no switch for B: a switch could turn off approving, and the team's requests would get stuck with
nobody to sign. To stop someone approving, change their staff's manager. The role editor shows B in
a read-only "Always on for Manager" card, like the admin-only card (D2).

## 3. New catalog item `people_team`

- Section: Employees. Levels: edit only (`E`). Label fa/en: «افزودن و غیرفعال‌کردن کارکنان تیم خود» /
  "Add and deactivate own team".
- **Add:** create a person in **your own department**, **you as manager**, **Employee role only**
  (today's manager branch rules).
- **Deactivate / reactivate:** set `active` on **your own direct reports** only. Never delete. D4 still
  applies: no acting on a report who holds more than you (e.g. an HR person reporting to you), or who
  holds admin. Never yourself (D3).
- Dependency: none (direct-reports visibility is fixed, §4). Holding `people_create` too = wider wins.
- D4 subset rule: caller's `people_create` + `people` edit count as covering `people_team`, so HR keeps
  editing managers who hold it. HR preset gets no new row.
- Any role may get it (custom roles too). A holder without a department gets "you have no department"
  on add.

## 4. Direct reports visible to any role

- New helper `private.is_direct_manager_of(uid, target)`: same company, `target.manager_id = uid`,
  caller active. No role check.
- Added to SELECT policies of `profiles` (managed subset), `leave_balances`, ledger,
  `leave_requests` (full row), approval progress reads — next to the existing `is_manager_of` clause.
- `is_manager_of` (with role) stays for every write and every signature.
- Nav: Employees tab shows for `people` read **or** anyone with direct reports. Without `people` read
  the list shows only direct reports (today's "reports" filter, forced on).

## 5. Every create / deactivate path follows the switch

| Path | Today | After |
|---|---|---|
| `app_create_employee` (SQL) | `has_role(caller,'manager')` branch | `has_perm(caller,'people_team','edit')` branch; others "not allowed" |
| `createEmployee` action (`lib/actions/employees.ts:40`) | `manager role or people_create` | `people_create or people_team` |
| Add page guard (`manage/employees/new/page.tsx:121`), Add button (`manage/employees/page.tsx:282`) | `isManager or people_create` | same as action |
| Deactivate | `people` edit via profile update trigger | also `people_team` edit + `is_direct_manager_of` + `can_act_on`, `active` column only |
| CSV / bulk import | needs `people_create`; managers no access | unchanged (no team-only import) |

## 6. App code that reads `roles.includes('manager')`

- To permissions / reporting line: nav tab (`lib/nav/tabs.ts:79`), employees list guard
  (`manage/employees/page.tsx:274-282`), detail guard (`manage/employees/[id]/page.tsx:82`), Add page +
  action, Edit page `active` toggle (`lib/employees/editCapabilities.ts`).
- Keep role check: edit reports' name + hire date (`employees-helpers.ts:32`), calendar approve button,
  approver tabs, Home board, signatures, approval steps.
- Settings › Roles: Manager row gets Edit link (`roles/[id]/page.tsx:24` already allows presets);
  `managerNote` reworded to point at card B.

## 7. Migration plan (forward-only, add first)

1. `…_people_team_key.sql`: catalog key `people_team`, allows `edit`, no deps.
2. `…_manager_preset.sql`:
   - Manager roles: `kind` `'system'` → `'preset'` (every company).
   - Insert role_permissions for every Manager role: `people`, `leave_balances`, `calendar` at read.
     No `people_team` row (off).
   - `reads_people` / `reads_balances` / `reads_calendar`: drop the `has_role(uid,'manager')` clause.
   - `is_direct_manager_of` + SELECT policy clauses (§4).
   - `app_create_employee`: branch on `people_team`.
   - `enforce_profile_update_scope`: `people_team` branch for `active` on direct reports.
   - `can_read_all`: drop the manager clause (no callers; keep function).
3. `lib/permissions/catalog.ts`, `lib/supabase/types.ts`, `schema.sql` dump, catalog unit test.

Old app during the swap: Add button still shows for managers; SQL refuses → error for a few seconds.

## 8. Tests

- SQL (`tests/sql/`): manager without `people_team` cannot add or deactivate; with it, own dept + self
  + Employee only, deactivates only own direct reports, not an HR report, not self; non-manager with
  direct reports sees them but cannot edit or sign; manager with `people` read removed still sees and
  signs for direct reports; HR still acts on a manager holding `people_team`.
- Unit: catalog vs schema, nav tab rule, `editCapabilities`.
- e2e (`999…` users): manager Add hidden by default; admin turns switch on → Add + Deactivate visible.

## 9. Open questions for owner

None. Ready for approval.
