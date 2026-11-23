# Sales Record Delete / Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin can archive, soft-delete and restore a whole Sales record from the record page.

**Architecture:** One migration adds `deleted_at/deleted_by` to `sales_rfps`, an Archived stage on the contract flow, three admin-only write functions, and a `deleted_at is null` filter in every list/report reader. `private.sales_rfp` refuses deleted rows, which blocks every per-record read and write in one place. UI: a header button + dialog in `RecordView`, a "Deleted" status option in the Records list, and a read-only banner with Restore.

**Tech Stack:** Next.js 16 App Router, TypeScript, self-hosted Supabase (Postgres + PostgREST), next-intl (fa/en), Vitest, Playwright.

**Spec:** `docs/specs/2026-11-23-sales-record-delete-archive-design.md` (approved 2026-11-23). Read it with this plan.

## Global Constraints

- Worktree `/Users/amir/Workspace/bj-sales`, branch `feat/erp-sales-module`. Never push. Commit per task only after the owner OKs commits for this run (ask once before Task 1); commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Migration: new file `supabase/migrations/20261123100000_sales_record_remove.sql`; never edit an older one. Dry-run on a clone of the `:3501` DB (`bj-approvals-finance-db-1`, db `postgres`) first — CLAUDE.md "Dry-run migrations first". Update `supabase/schema.sql` by diffing schema dumps of the clone before/after and patching only those hunks (ACL drift; no re-parenthesized CHECK hunks).
- SQL write pattern: admin check → `private.sales_company('sales', 'read')` → `private.sales_rfp(id, company)` (locks) → children → `private.sales_touch(rfp, kind, body)`. `security definer`, `set search_path to ''`. Read functions stay `stable`, no writes/locks.
- Admin = `private.has_role(auth.uid(), 'admin')` (built-in role) and not `private.is_test_account(auth.uid())`. No new permission key (catalog stays 33).
- Event bodies never hold price/bond values.
- `lib/supabase/types.ts` and `lib/sales/types.ts` are hand-edited; verify with `npx tsc --noEmit` and `npm run build`.
- UI copy in `messages/fa.json` + `messages/en.json` under `sales.*`; client components use `useTranslations('sales')`. Blueprint (`docs/DESIGN.md`): no `shadow-*`, tabs from `lib/ui/tabs.ts`, light only. Dialogs use `ModalContent` like other Sales dialogs.
- View as: writes fail `25006` in SQL; the button is hidden via `useViewAs()`.

---

## Task 1: Migration — columns, contract Archived stage, events

**Files:** Create `supabase/migrations/20261123100000_sales_record_remove.sql`

- [ ] `alter table public.sales_rfps add column deleted_at timestamptz, add column deleted_by uuid references auth.users(id) on delete set null;`
- [ ] `create index sales_rfps_live_idx on public.sales_rfps (company_id, record_no) where deleted_at is null;`
- [ ] Re-create `sales_events_kind_check` adding `'archived'`, `'deleted'`, `'restored'` to the current list (created, edit, stage, decision, result, comment, import, items, finance, file).
- [ ] Redefine `private.companies_seed_sales()` (copy the current body from `schema.sql`) so the contract flow also gets `('بایگانی', 'Archived', kind 'archived', code 'archived', action null)` after its last stage. Then insert that stage for every existing company whose contract flow has none (pattern: `20261117120000_sales_inquiry_import.sql` "seed: Archived stage").
- [ ] Redefine `private.sales_rfp(p_id uuid, p_company uuid, p_lock boolean default true, p_include_deleted boolean default false)`: after the select, `if not found or (r.deleted_at is not null and not p_include_deleted) then raise 'sales: not found' (P0002)`. Drop the old 3-arg signature first (`drop function private.sales_rfp(uuid, uuid, boolean)`) — check no other function depends on the exact signature (plpgsql bodies resolve at call time, so callers keep working).
- [ ] Add `private.sales_is_admin() returns boolean stable security definer`: `coalesce(private.has_role(auth.uid(), 'admin') and not private.is_test_account(auth.uid()), false)`. Revoke from public.

## Task 2: Migration — write functions

**Files:** same migration.

- [ ] `public.app_sales_archive(p_id uuid) returns void`: refuse `sales: not allowed` (42501) unless `private.sales_is_admin()`; company via `private.sales_company('sales','read')`; lock row; refuse `sales: stage not available` (22023) when current stage kind = `archived`; target = active stage of the record's flow with kind `archived` (none → same error); update `stage_id`, `result_at = coalesce(result_at, now())`; mark open deadlines done the same way the other closing paths do (copy from `app_sales_result`'s close branch; read it in `schema.sql`); `perform private.sales_touch(r.id, 'archived', jsonb_build_object('from_stage', <old stage id>))`. Does **not** call `sales_writable`.
- [ ] `public.app_sales_delete_record(p_id uuid) returns void`: admin check; lock; set `deleted_at = now(), deleted_by = auth.uid()`; insert a `deleted` event directly (not `sales_touch` if it bumps `updated_at` / batches — read `sales_touch` and decide; record the choice in the migration comment).
- [ ] `public.app_sales_restore_record(p_id uuid) returns void`: admin check; `private.sales_rfp(p_id, v_company, true, true)`; refuse `sales: not found` if not deleted; clear both columns; log `restored`.
- [ ] Grant execute on the three to `authenticated`; revoke from `public`, `anon`.

## Task 3: Migration — readers

**Files:** same migration. For each function, copy the **current** body from `supabase/schema.sql` and change only what is listed.

- [ ] `app_sales_bootstrap()`: add `'remove_records', private.sales_is_admin()` to `caps`.
- [ ] `app_sales_record(p_id)`: call `private.sales_rfp(p_id, v_company, false, private.sales_is_admin())`; add `deleted_at`, `deleted_by_name` to the record JSON (via `private.sales_rfp_json` or the function itself).
- [ ] `app_sales_list_page(p)`: accept `state = 'deleted'` (only when `sales_is_admin()`, else `sales: invalid input`); `deleted` → `deleted_at is not null`, every other state → `deleted_at is null`. Return `deleted_at`, `deleted_by_name` per row.
- [ ] Add `and r.deleted_at is null` (or the table's alias) in: `app_sales_list`, `app_sales_report`, `app_sales_metrics`, `private.sales_customer_rows`, `app_sales_customer`, `app_sales_customers`, `app_sales_deadlines`, `app_sales_record_numbers`, `app_sales_find_node`, `app_sales_price_history`, `app_sales_people_to_match`, `app_sales_match_person` (counts). Grep `schema.sql` for any other reader of `sales_rfps` / `sales_deadlines` / `project_nodes` joined to a record and add the filter there too; list them in the migration header.
- [ ] Leave unfiltered on purpose: `app_sales_delete_currency`, `app_sales_delete_product` (in-use checks), `app_sales_merge_customers` (re-points deleted rows too), `app_sales_remove_batch` (hard-removes deleted rows of its batch).
- [ ] `app_sales_import` / `app_sales_import_inquiries`: where an incoming row matches an existing record, skip it when that record is deleted and count it under a new `deleted` key in the result summary.

## Task 4: Dry-run, apply, schema.sql

- [ ] Clone `:3501` DB → apply migration → run every `tests/sql/sales*.sql` against the clone → drop clone. All pass.
- [ ] Apply to the `:3501` DB (it runs this branch); restart its PostgREST.
- [ ] Patch `supabase/schema.sql` from before/after dumps.

## Task 5: SQL tests

**Files:** Create `tests/sql/sales-record-remove.sql` (copy the header/fixture style of `tests/sql/sales-files.sql`).

- [ ] Admin archives an RFP and a contract → stage kind `archived`, `archived` event, open deadlines done.
- [ ] Archive of archived → `sales: stage not available`. Non-admin with `sales_decide` and a `test-emp` user → `sales: not allowed`.
- [ ] Admin deletes → record absent from `app_sales_list_page` (open/closed/all), `app_sales_report`, `app_sales_metrics`, `app_sales_customer(s)`, `app_sales_deadlines`, `app_sales_record_numbers`, `app_sales_find_node`, `app_sales_price_history`; present in `list_page` state `deleted` for admin; state `deleted` for non-admin → `sales: invalid input`.
- [ ] After delete: `app_sales_save_record`, `app_sales_comment`, `app_sales_save_payment` → `sales: not found`; `app_sales_record` → not found for non-admin, returns with `deleted_at` for admin.
- [ ] Restore → back in lists in the same stage; restore of a live record → not found.
- [ ] Import of a row matching a deleted record → skipped, summary `deleted = 1`.
- [ ] Last section: read-only transaction → archive/delete fail `25006`.
- [ ] One assertion per statement (CLAUDE.md "SQL test assertions").

## Task 6: Types and server actions

**Files:** `lib/supabase/types.ts`, `lib/sales/types.ts`, `lib/actions/sales.ts`

- [ ] `types.ts`: Args/Returns for `app_sales_archive`, `app_sales_delete_record`, `app_sales_restore_record`.
- [ ] `lib/sales/types.ts`: `SalesCaps.remove_records: boolean`; `StageKind` gains `'archived'` if absent; record + list row gain `deleted_at: string | null`, `deleted_by_name: string | null`; `EventKind` gains `archived | deleted | restored`; list state type gains `'deleted'`; import summary gains `deleted`.
- [ ] `lib/actions/sales.ts`: `archiveSalesRecord(id)`, `deleteSalesRecord(id)`, `restoreSalesRecord(id)` — same shape as `decideSalesBid` (`requireCaller`, rpc, error mapping, `revalidatePath` of `/sales` and the record).

## Task 7: Record page button + dialog

**Files:** Create `app/[locale]/(app)/sales/_components/RemoveRecordDialog.tsx`; modify `RecordView.tsx` (header, ~line 95), `messages/fa.json`, `messages/en.json`.

- [ ] Header becomes `flex items-start justify-between`; button **Delete / Archive** (red outline) on the end side, shown when `boot.caps.remove_records && !viewAs && !r.deleted_at`. On a phone it wraps under the title.
- [ ] Dialog: title "Delete or archive record no. N — <title>"; radio group Archive / Delete with the spec §4.2 descriptions; Archive disabled + note when `r.stage_kind === 'archived'`; Delete shows the red counts line (items, payments, files from `detail`; omitted when all 0) and turns Confirm red; Confirm disabled until a choice; Cancel closes; inline error.
- [ ] Archive success → toast, `router.refresh()`. Delete success → toast, `router.push('/sales')`.
- [ ] Unit test `tests/unit/sales-remove-dialog.test.tsx` (or a pure helper `lib/sales/removeDialog.ts` + test if the repo has no component tests): confirm disabled until choice; archive disabled when archived; counts line text.

## Task 8: Deleted filter + banner + Restore

**Files:** `FilterBar.tsx` / `RecordsList.tsx` / `RecordsTable.tsx`, `RecordView.tsx`, messages.

- [ ] Status select gains **Deleted** when `boot.caps.remove_records`. In that state the Next deadline column shows "Deleted 1405/09/02 · <name>".
- [ ] `RecordView`: when `r.deleted_at`, red banner "Deleted on <date> by <name>" + **Restore** button; render the page read-only (reuse the View as read-only path: hide stage actions, edit controls, note box, uploads).
- [ ] Restore → toast, `router.refresh()`.
- [ ] `ActivityLog.tsx`: cases for `archived`, `deleted`, `restored`.

## Task 9: e2e

**Files:** Create `tests/e2e/sales-remove.spec.ts` (own `999…` users; local stack only).

- [ ] Admin opens a fresh record → Delete / Archive → Archive → Confirm → stage shows Archived.
- [ ] Second record → Delete → Confirm → lands on `/sales`, record not listed; Deleted filter lists it; open → Restore → listed again.
- [ ] Non-admin Sales user sees no button.

## Task 10: Verify + docs

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build` — all pass.
- [ ] Browser check on `:3501` as admin: dialog in fa (RTL) and en, phone width.
- [ ] Docs: `docs/CHANGELOG.md` (Unreleased › Sales), `docs/DATA_MODEL.md` (`sales_rfps.deleted_*`, contract Archived stage), `docs/PERMISSIONS.md` (admin-only record removal), `docs/TASKS.md`, `docs/AGENT-LOG.md`.
- [ ] CLAUDE.md gotchas: update the `archived` line (also entered by `app_sales_archive`); add "Deleted Sales records: `private.sales_rfp` refuses `deleted_at` rows; a new reader of `sales_rfps` must filter `deleted_at is null`."
