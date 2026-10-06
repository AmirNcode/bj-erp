# Bulk import modes: Add new · Add & update · Replace

**Date:** 2026-10-06
**Status:** Accepted — D1–D6 and O1–O3 confirmed by the owner 2026-10-06
**Plan:** [`docs/plans/2026-10-06-bulk-import-modes.md`](../plans/2026-10-06-bulk-import-modes.md)
**Module:** HR → Employees (bulk import, FR-45)
**Extends:** [`2026-10-05-org-chart-and-personnel-import-design.md`](2026-10-05-org-chart-and-personnel-import-design.md) §2
**Requirement:** FR-49 (new)

## Why

Today the import only adds. When a department already has a manager, that manager is kept. A
personnel number already in the app is an error. Nothing outside the file is touched. That was
fine for a first load. It is wrong once the HR list is re-sent as the new truth, as on
2026-10-06: the demo `QC` department kept its deactivated demo manager (Maryam Hosseini) instead of
the file's manager (Sahraei).

## Owner decisions (2026-10-06)

| # | Decision |
|---|---|
| D1 | Three modes, chosen at upload: **Add new only** · **Add & update** · **Replace**. |
| D2 | Add & update and Replace: the file **overwrites the departments it uses** (names and manager) and **updates employees already in the app**. |
| D3 | Replace: for active employees **not in the file**, the uploader chooses **Deactivate** or **Keep**: one default for everyone, with a per-person override. Admin accounts are never listed. |
| D4 | A kept person who **conflicts** with the file must get an explicit choice before importing (§4). |
| D5 | Balances of updated employees: **ask per upload** (checkbox "also overwrite balances"). |
| D6 | Replace: departments no one in the file uses are **deleted only if empty** (no employees at all, active or not). The others are kept and listed as "not deleted". |

## 1. Modes

| | Add new only | Add & update | Replace |
|---|---|---|---|
| New personnel number | create | create | create |
| Personnel number already in the app | **error** (today) | update (§2) | update (§2) |
| Departments the file uses | create if missing; existing names and manager kept | create if missing; **names + manager overwritten** | same as Add & update |
| Employees not in the file | untouched | untouched | **deactivate or keep** (§3–§4) |
| Departments the file doesn't use | untouched | untouched | **deleted if empty** (D6) |

Add new only stays the default, so the safe behaviour is what happens without a deliberate choice.
Add & update and Replace are **admin-only** (in the UI and in SQL). HR keeps Add new only.

## 2. Updating an existing employee (Add & update, Replace)

Matched by personnel number. From the file:
- full name, job title, department;
- `manager_id` = supervisor if given, else manager;
- the `manager` role is granted if the file says `manager`, and **removed** if it says `employee`.
  `admin`, `hr` and `security` are never touched;
- the login code, password and hire date (when the file's is blank) are unchanged;
- if "also overwrite balances" is ticked: the annual balance is **set** to the file's days + hours
  (one `adjustment` ledger entry, `opening balance as of <date>`, history kept), and the accrual
  start moves to the month after the balance date. Leave already recorded in the app after that
  date is not re-counted; the preview says so.

## 3. Employees not in the file (Replace)

The preview lists every active non-admin employee missing from the file, with:
- a **default** for all: *Deactivate* (pre-selected) or *Keep*;
- a per-person switch to override the default.

Deactivate = `active = false`: they can't sign in, they drop out of lists and the org chart, and
their records are kept.

## 4. Conflicts for kept people (D4)

They are recomputed live as choices change. Each blocks the import until answered.

| Conflict | Options |
|---|---|
| **Same full name as a file row** with a different personnel number (probably renumbered) | Deactivate the old record · Keep both |
| **Their supervisor/manager is deactivated** — already, or by this import | Deactivate them too · Keep with no manager · Pick a manager from the file |
| **They manage a department the file gives a different manager** | File's manager replaces them · Keep them as department manager |

Names are compared after folding Arabic ي/ك, ZWNJ and spaces, as in the org chart search.

## 5. Fix in every mode: deactivated department manager

A department whose current manager is deactivated counts as having **no manager**. The file's
manager is assigned, and the preview no longer warns that a deactivated person "will also sign".
The approval engine already skips an inactive department manager, so before this fix that
department ended up with **no** second signer.

## 6. Preview and confirmation

The wizard shows, before anything is written: the mode, counts (create / update / deactivate /
reactivate / departments created / renamed / manager changed / deleted / not deleted), each list
expandable, and the conflicts.
- **Replace** needs a final confirmation dialog stating the counts.
- The import is **one transaction**: any failure changes nothing.
- Everything is audited (`bulk_import` with mode and counts, plus a row per deactivation and
  department deletion).

## Open defaults (owner review)

- **O1 — Inactive employee who is in the file** (Add & update / Replace): **reactivate** them, and
  list them in the preview as "will be reactivated". *Alternative: leave them inactive and only
  update details.*
- **O2 — "Pick a manager from the file"** offers anyone in the file holding the manager role.
  *Alternative: anyone in the file.*
- **O3 — Approval engine and in-flight requests**: changing someone's manager or department
  manager affects their **pending** requests (the engine resolves signers live, FR-36/47). The
  preview counts the pending requests that will get a different signer. *No alternative proposed;
  confirm this is acceptable.*

## Testing

- **Unit**, on the pure plan builder:
  - each mode's create/update/error split;
  - departments overwrite vs keep;
  - missing-people defaults and overrides;
  - each conflict appears and resolves, including cascades (deactivating A creates a conflict for
    A's reports);
  - empty vs non-empty department deletion;
  - inactive department manager treated as none.
- **SQL** (in a rolled-back transaction): Replace on a fixture with every case.
- **e2e**: Add & update re-import changes a title and a department manager; Replace deactivates a
  missing person after the confirm dialog.
