# Manager negative balance, pending-aware balance, approval details, Employees balances — design

**Date:** 2026-11-12 · **Status:** approved 2026-11-12 · **FR:** FR-92 (amends FR-13, FR-48,
FR-91 edit limits) · **Branch:** `feat/manager-negative-balance`

## Why

Today, when a request runs past the balance, the excess is stored as `leave_requests.unpaid_minutes`
and only the paid part reaches the ledger (FR-13). The unpaid time shows per request (request form,
Finance list + CSV, Reports, Home, print) but never on the balance, so HR has no clear picture of who
owes what. The main purpose of this change is **HR
clarity on balances**.

New rules from Amir (2026-11-12):

- **Managers borrow.** A Manager's annual leave past their balance is paid now and drives the balance
  negative. Monthly accruals pay it back. A negative carries over at Farvardin 1; HR may convert any
  of it to unpaid, per person or in bulk.
- **Employees can't go over.** A regular employee cannot request more annual leave than they have
  available. For more time off they file a separate request of the **unpaid** leave type.
- **Pending counts.** "Available" = balance − the person's own pending requests of that type.

## Decisions (Amir, 2026-11-12)

### Who and what

1. **Who may go negative:** anyone holding the built-in **Manager** role (`private.has_role(uid,
   'manager')`). No permission switch, no per-person limit, **no limit on how negative**.
2. **Security** is a subcontractor and has no time off here (FR-76 stays as is).
3. **Leave types in scope:** **annual leave, daily and hourly.** Sick leave keeps today's behaviour
   (paid up to the balance, the rest split off as unpaid). The unpaid type is unchanged (always fully
   unpaid).

### Submitting

4. **Available = balance − own pending minutes** of that leave type, for everyone (Managers and
   employees). Example: 5 days, one pending 3-day request → a new request may be at most 2 days
   (employee) or triggers the confirm dialog past 2 days (Manager).
5. **Employee over available:** the request is **refused** (form and server). The form says so and
   points to the unpaid leave type.
6. **Manager over available:** submitting opens a **confirm dialog** that states they are requesting
   X more than available, that the balance will go to −Y, and that the extra is borrowed against
   future accruals. They confirm or go back. Nothing is split off as unpaid.

### Approving

7. **The approve dialog shows the full request to every approver** (all steps, all roles), not just
   the signature box:
   - **Leave:** requester, leave type, daily/hourly, dates (and times), duration, reason, replacement;
     **balance now, other pending, available, requested, balance after approval.** An overdraft is
     shown clearly: for a Manager "balance will go to −X"; for an employee "X will be unpaid" (see 9).
   - **Work trip / errand:** requester, type, dates (and times), duration, destination / description
     as filed, then the existing per diem field and travel booking checkbox.
8. **Manager at approval:** the whole request goes to the ledger; the balance may go negative.
   `unpaid_minutes` stays 0.
9. **Employee at approval, balance dropped since submission** (for example HR lowered it): keep
   today's split — paid up to the balance, the rest recorded as unpaid. Not blocked.
10. **Warning to HR when changing a balance:** when someone with balance edit access changes a
    person's balance (quick add, set balance, opening balance) and that person has an active request
    of that type, show a warning before saving. They can still proceed.

### Edits (FR-91)

11. An approved request edited by an editor may push a **Manager's** balance (further) negative. For
    employees the FR-91 rule stays: an edit may not create or grow an unpaid part.

### Year end and converting to unpaid

12. **Farvardin 1 carries a negative balance over**, like any balance (FR-60). No action needed.
13. **Convert negative to unpaid** — a button at the top of the **Employees page** (no new sidebar
    page), for holders of `leave_balances` edit. It opens a dialog listing everyone whose annual
    balance is below zero (name, department, balance), each with a checkbox. "Select all" then
    unticking X, Y, Z covers "everyone except". Confirming shows the count and total, then for each
    selected person: the balance returns to exactly 0 through a ledger entry, the amount is recorded
    as unpaid time, and an audit row is written. Usable at any time.
14. **Part of a negative** is converted on that person's edit page, in the balance section: HR enters
    an amount (≤ the negative) and only that much becomes unpaid.
15. HR's process may change after feedback; keep this tool simple.

### Data migration

16. **Past requests by current Manager-role holders** that have an unpaid part on the annual type
    are turned into negative balance: the unpaid part moves to the ledger and `unpaid_minutes`
    becomes 0. Requests of the unpaid leave type stay unpaid. Employees' past unpaid parts stay
    unpaid. **All history** (the app has been live only since Mehr 1405, so this is a handful of
    rows). Before the deploy, a dry run lists every affected request (person, serial, minutes moved)
    for Amir/HR to see. If payroll already deducted one of them, HR converts that amount back to
    unpaid with the tool in 13–14, which avoids charging the person twice.

### Finance and Reports

17a. **Payroll goes through HR, not Finance** (Amir, 2026-11-12: Finance ≠ payroll). The Finance
     list stays as it is. A new **Payroll** section in **Reports** (gated on `reports` read, so HR
     has it) shows, for a chosen Jalali month or period, per person: unpaid leave (unpaid-type
     requests + unpaid parts of requests + conversions, each with date and source) and the current
     annual balance, negatives highlighted. CSV export, so HR can pass it to payroll.
17b. **Migrated requests** (16) show 0 unpaid afterwards; the dry-run list is the record of what moved.
17c. **Bigger picture:** the app will grow modules (Sales, Finance, Engineering, Payroll, QC…). Build
     the Payroll report as a self-contained Reports tab with its own data function, so a future
     Payroll module can take it over without untangling it from leave code.

### Roles

- **HR** follows the employee rule unless the person also holds Manager.
- **Admin** is Amir's testing/setup account and never files leave: admin is not considered by the
  overdraft rule, and every new screen and action here (columns, convert tool, warnings) is
  available to admin.

### Employees page

17. **New columns after "Upcoming leave":** **Balance** (annual, may be negative), **Used this year**
    (paid annual leave taken, Jalali year to date), **Unpaid** (Jalali year to date: unpaid-type
    requests + unpaid parts of requests + converted negatives). Shown as days + hours.
18. **Visible to everyone who can open the Employees page** (Amir's call — this is wider than
    today's `leave_balances` read gate).
19. **Slightly less padding** between columns.
20. **No horizontal scroll.** When the columns don't fit, lower-priority columns hide and each row
    gets an expand control that shows the hidden columns beneath it.
21. **Phone:** rows are compact; tapping expands them to show the details (the columns) and an
    **Edit** button at the bottom that opens the edit employee page.

## Claude's calls (check these)

- **Confirm dialog wording (Manager):** "You are requesting X more than your available balance. Your
  balance will go to −Y. Monthly accruals will cover it; if it is still negative at year end, HR may
  convert it to unpaid." fa + en.
- **"Is a Manager" is checked at approval time**, not snapshotted at submission. Someone who loses
  the role before approval gets the employee split (9); someone who gains it gets the Manager rule.
- **"Active request" in the HR warning (10)** = a **pending** request of that leave type (approved ones
  already have their ledger rows and are not affected by a balance change).
- **Converted unpaid time counts toward the Jalali year of the conversion date** in the Unpaid column.
  So converting on Farvardin 5 a negative from last year shows as this year's unpaid. Simple, and
  the audit row and ledger note record what it came from.
- **Always visible columns** at narrow widths: name (first + last), Upcoming leave, Edit. Hidden first,
  right to left in reading order: Unpaid, Used this year, Hire date, Roles, Department, ID, Balance.
- **"This year" in the Used / Unpaid columns** = approved leave whose start date falls in the current
  Jalali year and is on or before today (taken, not merely booked), using the request's current
  (post-edit) values; converted unpaid time by its conversion date.
- **Annual leave** is identified the way existing SQL does it (`name_en = 'Annual Leave' and
  affects_balance`).
- **Pending for the available figure** = the requester's own pending requests of the same leave type,
  daily and hourly together (both draw on one balance).
- **Not changed:** accrual maths, the -366-workday bound on HR's `set_leave_balance`, sick and
  special leave, approval chains, signatures, print.

## What's left to the builder

- **Storing converted unpaid time** (13, 14): no request backs it. Suggested: a small table
  (employee, leave type, minutes, converted_at, converted_by, note) plus an `adjustment` ledger row of
  +minutes; or an equivalent the ledger already supports. Must feed the Unpaid column and survive
  backups like other ledger data.
- **Where the Manager rule lives:** `private.submit_leave_impl` (submit split), `private.finalize_approval_request`
  (the approval split every approve path runs through), the edit code behind `app_edit_request`
  (the "an edit cannot make leave unpaid" check), and the TS mirror
  `projectLeaveBalance` in `lib/leave/duration.ts`. Keep TS and SQL in lockstep; the server is the
  authority.
- **Data for the new columns** to callers without `leave_balances` read: a definer RPC gated on
  `people` read, returning only the three totals per person.
- **Responsive table technique** (container queries vs breakpoints), the expand control, and keeping
  the existing bulk-select checkbox column working.
- Migration (16) shape, ledger ordering/`balance_after_minutes` for the moved minutes, and the matching
  SQL tests.
- Docs: REQUIREMENTS (FR-92, amend FR-13/FR-48/FR-91), DATA_MODEL (paid/unpaid split, negative
  balances), PERMISSIONS (new RPC gate), CHANGELOG, TASKS.

## Goals / non-goals / anti-goals

- **Goal:** HR can see every balance, including negatives and unpaid time, on one page.
- **Non-goals:** sick leave overdraft; a per-person or per-role limit; a separate year-end page.
- **Anti-goals:** an employee ending up negative through a request; unpaid time that exists only on
  the paper form; any change to existing employees' historical unpaid records.
