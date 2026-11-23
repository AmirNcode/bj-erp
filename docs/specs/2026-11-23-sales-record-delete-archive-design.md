# ERP › Sales — Delete / Archive a record (FR-94 follow-up)

**Date:** 2026-11-23 · **Branch:** `feat/erp-sales-module` (local only, not deployed) ·
**Status:** approved by owner 2026-11-23. Decisions below were made in chat on 2026-11-23.
Builds on `2026-11-16-sales-rfp-module-design.md` (base spec), `2026-11-17-sales-stage-pages-design.md`
(stage pages) and `2026-11-20-sales-ceo-feedback-design.md` (files, currencies, products).

## 1. Why

The owner created test records (no. 1 "test", no. 2 "Wellhead") and has no way to remove them.
Today a whole record can only be *closed* (bid result Cancelled / No bid), which keeps it in
reports. The **Archived (no result)** stage exists but only the inquiry import can put a record
there, and contracts have no such stage. "Remove import batch" only removes imported records.

## 2. Decisions (owner, 2026-11-23)

| # | Question | Decision |
|---|---|---|
| D1 | Where | A **Delete / Archive** button on the **record page**, top right of the header (next to the record title). No bulk edit mode on the Records list. |
| D2 | Flow | Button opens a confirmation dialog with two choices, **Delete** and **Archive**. Admin picks one, then **Confirm**; **Cancel** closes the dialog with no change. |
| D3 | Delete | **Soft delete**: record hidden everywhere, kept in the DB, restorable by the admin. Its record number is never reused. |
| D4 | Archive | Move the record to the **Archived** stage (closed). Contracts get an Archived stage too. |
| D5 | Who | **Admin only** (built-in `admin` role). |
| D6 | Limits | Any record, whatever it holds (items, payments, bonds, files). The dialog's warning is the safeguard. |

## 3. Goals, non-goals

**Goals**
- The admin removes a test or mistaken record in three clicks from its page.
- A deleted record leaves no trace in lists, reports, metrics, customer pages, deadlines, number
  search, price history or item lookups — as if never created — but can be brought back.
- An archived record reads as closed, everywhere a closed record already reads.

**Non-goals**
- Bulk delete / archive from the Records list (D1 drops it).
- Permanent purge from the app. A hard purge stays a DB job, outside this change.
- Deleting uploaded file bytes. Files of a deleted record stay on the `sales-files` volume; they
  return with a restore.
- A new permission catalog item (D5: admin role only, so the catalog count stays 33).

## 4. UI

### 4.1 Record page header
- New outline button **Delete / Archive** (fa: «حذف / بایگانی»), top right of the record header,
  same row as "RFP • Record no. N" (the place marked in the owner's screenshot). Red text, not a
  filled button (Blueprint: destructive = text-danger outline).
- Shown only when `boot.caps.remove_records` is true (admin) and the session is **not** in View as
  (`useViewAs()`). On a phone it sits under the title.

### 4.2 Dialog
```
 Delete or archive record no. 2 — Wellhead
 ( ) Archive   Close the record and move it to "Archived". It stays in lists
               under "Closed" and counts as archived in reports.
 ( ) Delete    Hide the record everywhere: lists, reports, deadlines, search.
               The admin can restore it later from Records › Deleted.
                                                    [Cancel]  [Confirm]
```
- Nothing selected at open; **Confirm** disabled until a choice is made.
- **Archive** is disabled (with the note "Already archived") when the record's stage kind is
  `archived`.
- Picking **Delete** shows a red line: "This record has N items, N payments, N files." (counts the
  page already has; omitted when all are 0). Confirm turns red.
- After Confirm: Archive → stay on the page, toast "Record archived", page refreshes into the
  Archived stage. Delete → toast "Record deleted", go to `/sales` (Records list).
- Errors show inline in the dialog (same pattern as other Sales dialogs, `ModalContent`).

### 4.3 Restore (admin)
- Records list status filter (Open / Closed / All) gets a fourth option **Deleted**, admin only.
  Rows show deleted date and by whom in place of Next deadline.
- Opening a deleted record shows the page read-only with a red banner "Deleted on 1405/09/02 by
  …" and a **Restore** button. All edit controls hidden (same as a View as read).
- Restore → banner gone, record back in its previous stage (delete never changes the stage).

## 5. Data

### 5.1 Columns on `sales_rfps`
- `deleted_at timestamptz` (null = live), `deleted_by uuid references auth.users`.
- Partial index `sales_rfps_live_idx on (company_id, record_no) where deleted_at is null`.
- `record_no` unique constraint unchanged → a deleted record still holds its number (D3).

### 5.2 Contract Archived stage
- Seed function adds to the contract flow: `('بایگانی', 'Archived', kind 'archived', code
  'archived')` after its last stage; the migration inserts it for existing companies (same
  pattern as `20261117120000_sales_inquiry_import.sql` §seed).
- Gotcha line changes: kind `archived` is entered by the inquiry import, `sales_decide`, **and**
  `app_sales_archive`.

### 5.3 Events
- New `sales_events` kinds `archived`, `deleted`, `restored` → re-create
  `sales_events_kind_check`; add cases in `ActivityLog`. Bodies hold only `{from_stage}` (archive)
  — no price or bond values.

## 6. Functions (one migration, `20261123…_sales_record_remove.sql`)

| Function | Does |
|---|---|
| `private.sales_is_admin()` | `private.has_role(auth.uid(), 'admin') and not private.is_test_account(auth.uid())`. |
| `public.app_sales_archive(p_id uuid)` | Admin only, else `sales: not allowed`. Locks the row (`private.sales_rfp`). Refuses if already `archived` (`sales: stage not available`). Moves to the flow's active `archived` stage, sets `result_at = now()` only if null, closes open deadlines (same as other closing paths), logs `archived`. Skips `sales_writable` on purpose (admin may archive a closed record). |
| `public.app_sales_delete_record(p_id uuid)` | Admin only. Locks the row, sets `deleted_at/by`, logs `deleted`. Idempotent: deleting a deleted record raises `sales: not found`. |
| `public.app_sales_restore_record(p_id uuid)` | Admin only. Clears `deleted_at/by`, logs `restored`. |
| `private.sales_rfp(...)` | Raises `sales: not found` when `deleted_at is not null`, **unless** new arg `p_include_deleted` is true (only `app_sales_record` for the admin and `app_sales_restore_record` pass it). This one change blocks every per-record read and write on a deleted record. |
| `app_sales_bootstrap()` | `caps.remove_records = private.sales_is_admin()`. |

### 6.1 Readers that must add `deleted_at is null`
`app_sales_list`, `app_sales_list_page` (plus a `deleted` status branch, admin only),
`app_sales_report`, `app_sales_metrics`, `private.sales_customer_rows`, `app_sales_customer`,
`app_sales_deadlines` (and any SMS/cron deadline reminder reading `sales_deadlines`),
`app_sales_record_numbers`, `app_sales_find_node`, `app_sales_price_history`,
`app_sales_people_to_match`, `app_sales_match_person`, `app_sales_merge_customers` (counts only;
it still re-points deleted rows so a restore finds the merged customer).
`app_sales_delete_currency` / `app_sales_delete_product` "in use" checks keep counting deleted
records (a restore must not find a missing currency).

### 6.2 Imports
- `app_sales_import` / `app_sales_import_inquiries`: a row matching a **deleted** record is
  skipped and counted as `deleted` in the result summary (never revived, never duplicated).
- `app_sales_remove_batch` removes deleted records of that batch too (hard delete is its job).

## 7. Security
- All three writes: `security definer`, `search_path ''`, admin check first, `private.sales_rfp`
  lock before children (existing lock order).
- View as: transaction is read-only → writes fail `25006`; the button is hidden anyway.
- A non-admin opening `/sales/<deleted id>` gets 404 (`notFound()`), same as an unknown id.

## 8. Tests
- SQL (`tests/sql/sales-record-remove.sql`): admin archives RFP and contract; non-admin and
  `test-emp` refused; archive of archived refused; delete hides the record from list, list_page,
  report, metrics, customer, deadlines, record_numbers, find_node, price_history; per-record
  calls (`save_record`, `comment`, `save_payment` …) raise not found; restore brings all back;
  import skips a deleted record; remove_batch removes a deleted imported record.
- Unit: dialog state (Confirm disabled until choice, Archive disabled when archived).
- e2e (own `999…` users, local stack only): admin deletes, restores, archives a record.

## 9. Resolved questions (owner, 2026-11-23)
1. Restore via **Records › Deleted** filter (§4.3): **keep**.
2. Un-archive: **not needed**; an archived record stays archived (admin may delete it instead).
