# Organization chart, personnel import v2, two-level sign-off, negative balances

**Date:** 2026-10-05
**Status:** Accepted — Q1–Q3 answered by the owner on 2026-10-05
**Plan:** [`docs/plans/2026-10-05-org-chart-and-personnel-import.md`](../plans/2026-10-05-org-chart-and-personnel-import.md)
**Module:** Shared core (departments, profiles, navigation) + HR → Time-Off (import, approvals, ledger)
**Source data:** `docs/files/Personnel_CLEAN.csv` (142 people — 141 staff plus the CEO — cleaned 2026-10-05 — Appendix A)

## Scope

The client sent its real personnel list. Loading it, and drawing the company from it, needs five
changes. They are specified together because the data drives all of them.

| # | Change | FR |
|---|---|---|
| 1 | **Organization** tab: an org chart every user can browse | FR-44 |
| 2 | **Bulk import v2**: the client's columns, supervisor + manager, opening balances in days + hours, an "as of" date | FR-45 |
| 3 | **Department codes** become 2–4 uppercase alphanumerics, created automatically on import | FR-46 |
| 4 | **Supervisor AND department manager** both sign a request | FR-47 |
| 5 | **Negative leave balances** are allowed | FR-48 |

Out of scope: per-employee balance cut-off dates (HR corrects individual balances after rollout,
owner decision 2026-10-05); the `Assembly` department merge (owner fixes the CSV later); sick-leave
opening balances (not in the client's data; still settable per employee in the UI).

## Owner decisions (2026-10-05)

| # | Question | Answer |
|---|---|---|
| D1 | Who signs a request when the employee has a supervisor? | **Supervisor and manager both.** |
| D2 | Negative balances? | **Allowed.** |
| D3 | Different balance cut-off dates in the notes column? | **Ignore for now**; HR fixes per person after rollout. |
| D4 | Workday length | **8 hours.** PTO hours never exceed 7 because 8 h rolls into a day. |
| D5 | Department codes | **2–4 chars, `A–Z 0–9`, uppercase.** Import notifies the uploader and auto-creates missing departments and codes. |
| D6 | Balance date | The uploader **picks the date** the balances were counted to. |
| D7 | Hierarchy | Department **Manager → Supervisor → individual contributor.** An employee's `manager_id` is their **supervisor if they have one**, else their manager. Supervisors hold the `manager` role. |
| D8 | Org chart visibility | **Everyone.** Opens on the viewer's own card; click up the chain and across to anyone. |

---

## 1. Organization tab (FR-44)

### Data

New `public.get_org_chart()` — `SECURITY DEFINER`, `search_path = ''`, granted to `authenticated`,
revoked from `anon`, scoped to the caller's company. Returns **active** profiles only:

`id · full_name · job_title · department_id · department_name_fa · department_name_en ·
manager_id · is_department_manager bool`

Nothing else: no personnel number, roles, balances, hire date or leave data. This is the same
pattern as `get_my_team_directory()` and **widens nothing** — every field is already visible on a
request card or the My Team card. `PERMISSIONS.md` gets a row for it.

142 rows is small: the page loads the whole set once and navigates client-side, no round trip per
click.

### Behaviour

- Route `/organization` under `(app)`. In the desktop sidebar for **every** role, after Calendar.
  On mobile it is reached from the **Profile** screen; the bottom bar stays at 4/5 items (Q2).
- **Opens focused on the viewer**: their card (name, job title, department), with the chain above
  them up to the CEO as a clickable breadcrumb, and their direct reports below.
- **Clicking any card refocuses** on that person: their chain above, their reports below. Each card
  shows a report count so the viewer knows what's underneath.
- Focus is held in the URL (`/organization?p=<id>`), so browser Back walks the path and a link can
  be shared.
- A search box jumps to anyone by name (142 people is too many to click through).
- A department manager's card carries a small "مدیر واحد" badge.
- A person whose manager is missing or inactive is shown as a **root**. The "top" view lists every
  root. Expected roots after import: the CEO, plus pre-existing accounts with no manager (e.g. the
  Liara `admin` login).
- Mobile-first: one column of cards. Desktop: the same, with reports in a grid. RTL-aware; all
  strings in `fa` + `en`.

---

## 2. Bulk import v2 (FR-45)

### Template columns

| Key | Required | Meaning |
|---|---|---|
| `full_name` | ✅ | |
| `personnel_no` | ✅ | Login username, unchanged rule. |
| `job_title` | | Display only. |
| `role` | ✅ | `manager` or `employee`. HR uploads are still clamped to `employee` in-DB. |
| `department_code` | ✅* | 2–4 `A–Z0–9`, case-insensitive on input. *May be blank if the names are given (§3). |
| `department_name_fa` | | Needed to create a department that doesn't exist yet. |
| `department_name_en` | | Same. |
| `supervisor_personnel_no` | | Direct supervisor, if any. |
| `manager_personnel_no` | | Department manager. |
| `hire_date` | | Jalali or Gregorian, unchanged parser. |
| `pto_days` | | Signed whole days of remaining annual leave. |
| `pto_hours` | | Signed hours, `0–7`, same sign as `pto_days`. |

Removed: `annual_days`, `sick_days`. Columns the importer doesn't know (the name columns, the text
balance, notes) are ignored, as today. Headers match by the latin key in parentheses, as today. The
client file's two department-name headers get renamed to the new keys (`بخش (department_name_fa)`,
`Department (department_name_en)`) when this ships.

### What the wizard does

1. **Upload** the CSV.
2. **Pick the balance date** (Jalali date picker, required if any row has a non-zero balance, not
   in the future). The wizard shows the consequence live: *"Balances include up to the end of
   Mehr 1405. Monthly accrual starts from 1 Aban 1405."*
3. **Validate and preview.** Errors block the import; warnings don't. New panels:
   - **Departments to be created**: code (auto-generated ones marked), Farsi and English names. The
     uploader must tick "I've checked these" before importing. This is the D5 notification.
   - **Department managers**: the manager each department will get (rule below).
   - **Warnings**: listed per row.
4. **Import**: one transaction, as today. The first bad row rolls back everything.

### Row rules

- `profiles.manager_id` = `supervisor_personnel_no` if set, else `manager_personnel_no` (D7).
- References may point **anywhere** in the file or to an existing employee. The importer sorts rows
  so managers are created first, which removes today's "list managers before their team" rule. A
  cycle is an error.
- Anyone referenced as a supervisor or manager must have `role = manager` (in the file, or already
  holding it in the DB). Otherwise it's an error.
- **Warning** if a supervisor's own manager differs from the row's `manager_personnel_no`. The
  client file has 0 of these.
- `pto_days` / `pto_hours`: integers; mixed signs are an error; `|hours| ≥ hours_per_day` is an
  error; `|days| ≤ 366`. Minutes = `(days × hours_per_day + hours) × 60`.

### Department manager derivation

For each department in the file, `departments.manager_id` = the most common `manager_personnel_no`
among its members who are **not themselves** anyone's manager. If no such member exists, the most
common value among all its members is used. A tie is an error.

If the department already has a different manager, the existing one is kept and a warning is shown.

Checked against the client file: this gives exactly the CSV's intended signers for **all 142**
rows once منصور خیری moved to `EXEC` (Q1).

### Opening balance and accrual

- A non-zero balance becomes **one `adjustment` ledger row** (signed), noted
  `opening balance as of <date>`.
- No `leave_allocations` row is written. That retires the current Gregorian Jan–Dec period bug for
  imports. The plan verifies that reports don't rely on an allocation row existing.
- Every imported employee gets the leave type's **default accrual policy**, with
  `accrual_start_month` = the first Jalali month **after** the month containing the balance date.
  This matches `accrue_leave`, which posts a month's accrual at any point during that month, so the
  balance date's own month counts as already included.

---

## 3. Department codes (FR-46)

- The format becomes `^[A-Z0-9]{2,4}$` (today `^[a-z0-9]{2,6}$`). Codes stay unique per company.
- **Migration on live data**: existing codes are uppercased. Any longer than 4 characters is
  regenerated by the generator below. Codes are not used to log in (`employee_code` =
  `personnel_no` since FR-31), so this changes nothing a user sees.
- **Generator**, shared by import and the Add Department form: uppercase latin letters and digits
  from the English name, first 4. If that collides, first 3 plus a digit. Fallback `DP` plus a digit.
- **Import resolution order** for each row:
  1. If the code exists, use that department. If the file's names differ, warn and keep the DB names.
  2. If the code is new, create the department. Both names are required. The same new code with
     different names in two rows is an error.
  3. If the code is blank, match by exact Farsi or English name. If there's no match, create the
     department with a generated code.
- The "`code` is vestigial" paragraph in `DATA_MODEL.md` is rewritten: the code is now the import
  key. The departments list shows it read-only.

---

## 4. Supervisor and manager both sign (FR-47)

### Model

- **Supervisor** = the requester's direct manager (`profiles.manager_id`). The existing `manager`
  step already means exactly this, via `is_manager_of`.
- **Department manager** = `departments.manager_id` of the requester's department. The column
  exists and nothing uses it yet. It's set by import (§2) and by a new manager picker on
  Settings → Departments (admin).

### New step kind

- `approval_steps` gets `manager_scope text` (`'direct'` | `'department'`), required when
  `role = 'manager'` and there's no named approver. Existing manager steps become `'direct'`.
- The partial unique index becomes `(company_id, role, manager_scope) where approver_id is null`.
- **When the department step applies**: only if the requester's department has a manager who is
  neither the requester nor the requester's direct manager. Otherwise it's **not required** for
  that request and the UI shows it as "لازم نیست". This rule, checked against the client file:
  - Supervised employee → supervisor + department manager. ✔
  - Employee reporting straight to the department manager → one signature. ✔
  - Department manager's own request → their own manager signs. ✔
- **Who may sign it**: the requester's department manager at the time of signing; an admin may sign
  any step (existing FR-36 rule); nobody signs their own request. Applicability is evaluated live at
  each signature, like the direct-manager step.
- The engine's **four** "is this step decided" tests (DATA_MODEL `leave_request_approvals`) learn
  the not-required case. `lib/leave/approvals.ts` mirrors it for the queue.
- **Rollout safety**: the migration inserts the department step **inactive**, at order 2, with HR
  moving to 3. Deploying therefore changes no in-flight request. Admin or HR activates it on the
  Approval steps page after the import. From then on, pending requests need it too; the page says
  so.
- **Print form**: the stationery's manager box keeps the direct manager (supervisor). The
  department manager's signature prints in the signature strip below the boxes, labelled
  "مدیر واحد" — the same place FR-42 extra steps print, so the client's paper layout is unchanged.
  Approvals are told apart by step id, never by role (both are `manager`).
- **Read access** needs no change: managers already read company-wide (`can_read_all`).

---

## 5. Negative balances (FR-48)

- The import may write a negative opening balance (§2).
- `set_leave_balance` accepts a negative target, bounded at `-366 × minutes_per_day`. That lets HR
  correct balances after rollout (D3). Self-change rules are unchanged.
- **Already safe**: `approve_leave_request` takes `least(minutes, greatest(balance, 0))` as paid, so
  any request against a balance at or below zero is recorded as unpaid. That's the existing overage
  behaviour, not a new rule.
- **Also safe**: carry-over forfeit only fires when balance > cap; the annual cap counts accruals,
  not balance; `minutesToDaysHours` keeps the sign on both parts.
- **To verify in the plan**: `projectLeaveBalance` (request-form preview) and every balance display
  render a negative as «منفی ۱ روز و ۴ ساعت», with the minus on the correct side in RTL.
- `DATA_MODEL.md` drops "Balance-affecting types can never go negative". It becomes: a balance may
  be negative only via opening balance or HR adjustment; requests never push it lower, because the
  excess becomes unpaid.

---

## Testing

- **Unit**: import validation (references in any order, cycle, role check, mixed signs, hours ≥ 8,
  department create/match/collision, code generator, department-manager derivation including the
  tie, balance date → accrual start month); department-step applicability (all three shapes above,
  plus no department manager); negative duration formatting.
- **SQL**: bulk create with forward references; opening adjustment signed both ways; the department
  step blocks finalisation only when applicable; inactive step changes nothing; `set_leave_balance`
  negative bound.
- **E2E**: import a small fixture with a supervisor and a new department; supervisor signs, then the
  department manager signs, then HR; org chart opens on self, clicks up and down, and search works.
- **Dry run**: import `Personnel_CLEAN.csv` into the local Docker stack, then check the counts in
  Appendix A.

## Open questions — answered 2026-10-05

- **Q1 — منصور خیری** → moved to Executive Management (`EXEC`); only the CEO signs.
- **Q2 — Mobile bottom bar** → stays at 4/5 tabs; Organization is a link on the Profile screen.
- **Q3 — Liara contents** → none of these personnel numbers or codes exist on Liara. The owner
  uploads the CSV himself after testing locally.

---

## Appendix A — CSV cleaning (2026-10-05)

Fixes applied to `Personnel_CLEAN.csv`; the pre-fix copy was kept in the session scratchpad:

| Fix | Rows |
|---|---|
| `supervisor_personnel_no` held the **manager's** number on every supervised row; recomputed from the supervisor name | 87 |
| `تیمور شیرانی` → `تیمور شیرانی سرمازه`, `علی اکبر علی جانی` → `علی اکبر علی جانی علیجانوند` (supervisor names, and their numbers filled in) | 12 |
| Those two supervisors' `role` `employee` → `manager` | 2 |
| Department code `MAR` was used by both Maintenance & Repair and Marketing; Marketing → `MKT` | 1 |
| منصور خیری moved from Administration (`ADM`) to Executive Management (`EXEC`) (Q1) | 1 |
| Saved as UTF-8 **with BOM** (like the template), so Excel shows Farsi correctly; CRLF kept | — |

Already fixed by the owner: CEO row (no manager), signed negative balances (7 rows), department
codes, `role` column, supervisor/manager number columns.

Checks after cleaning: 142 rows (141 staff + the CEO); unique names and personnel numbers; every supervisor/manager
number resolves and matches its name column; 18 managers, every one with reports, every supervisor
or manager referenced holds `manager`; each supervisor's manager equals their team's manager in 87/87
rows; no supervisor has a supervisor; no cycles; chain depth 0–4 from the CEO; 25 departments, one
code each; 7 negative balances, no mixed signs, hours ≤ 7. The CEO has a blank balance, imported
as 0.
