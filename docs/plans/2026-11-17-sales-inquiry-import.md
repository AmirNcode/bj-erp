# ERP Sales — inquiry register import + predefined inputs (FR-94 §16) Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Lead (Opus) reviews every task
> diff; Sonnet subagents implement one task each (owner's flow, memory "subagent build/review").

**Goal:** (A) import the client's inquiry register (`.csv` / `.xlsx`, ~11.4k rows) into Sales,
re-importable with the latest file, merging with contract-ledger records by number; keep the
records list fast at that size. (B) replace free-typed known-value inputs with pickers (§16.5).

**Spec:** `docs/specs/2026-11-16-sales-rfp-module-design.md` §16 (wins over earlier sections).
Data check of the real file: `erp-module/reports/` (git-ignored; client data).

**Branch:** `feat/erp-sales-module` (local, unmerged). Phase A first; B after A is reviewed.

## Global constraints

- All `CLAUDE.md` gotchas and the constraints block of `docs/plans/2026-11-16-sales-rfp-module.md`
  apply (function-only access, `sales: ` errors, `stable` reads never write, record row locked
  first, price keys stripped without `sales_prices`, `sales` strings only via `sales/layout.tsx`).
- **Never commit `erp-module/`** or any fixture made from the real file. Test fixtures are
  synthetic (invented companies, numbers 900001+).
- DB work on a throwaway clone `erp_inq` of the running local stack (CLAUDE.md "Dry-run
  migrations first"); `schema.sql` patched from the clone's before/after schema diff.
- Migrations are new files; `20261116*` / `20261117100000` / `20261117110000` are frozen.

---

## Phase A — inquiry import

### A1. Migration `supabase/migrations/20261117120000_sales_inquiry_import.sql`

- [ ] `sales_stages.kind` CHECK adds `'archived'` (drop + re-add the constraint by name; read the
      real name from `schema.sql`).
- [ ] `private.sales_ensure` (copy the latest definition, keep everything) also seeds a bid-flow
      stage `code='archived'`, `kind='archived'`, fa `بایگانی (بدون نتیجه)`, en `Archived (no result)`,
      position after `no_bid`. Insert it for every existing company that has a bid flow.
- [ ] Every function that lists closed kinds must accept `archived`: grep `'no_bid', 'cancelled', 'done'`
      in `schema.sql` (e.g. the stage-save validation at migration line ~1093) and redefine those.
- [ ] `sales_rfps.import_batches uuid[] not null default '{}'`; backfill
      `array[import_batch_id]` where not null.
- [ ] `sales_import_batches.kind text not null default 'ledger' check (kind in ('ledger','inquiry'))`
      and `closed boolean not null default true` (an inquiry batch is open while chunks arrive).
- [ ] `app_sales_import` (ledger): append its batch to `import_batches` on every row it writes
      (`array_append` when absent). No other change.
- [ ] `app_sales_remove_batch`: delete only rows with `import_batches = array[p_batch]` and not
      `edited_after_import`; on kept rows remove `p_batch` from `import_batches`; if
      `import_batch_id = p_batch` and other batches remain, set it to the last one; delete the batch
      row when no row references it.
- [ ] Fixed custom fields, created on first inquiry import if missing (entity `rfp`, keys stable):
      `inq_no` "Inquiry No." text · `inq_type` "Tender / Project" select (options Tender, Project,
      Estelam, Budget price) · `inq_status_note` "Status note" text · `inq_flag` "In charge (Y/N)" text ·
      `inq_date_text` "Inquiry date (text)" text · `inq_offer_text` "Offer date (text)" text.
      fa labels: شماره استعلام · مناقصه / پروژه · یادداشت وضعیت · مسئول (Y/N) · تاریخ استعلام (متن) · تاریخ پیشنهاد (متن).
- [ ] `public.app_sales_import_inquiries(p_batch uuid, p_file text, p_rows jsonb, p_people jsonb,
      p_cutoff date, p_last boolean) returns jsonb`:
  - `sales_settings` edit; rows ≤ 2000 per call; `p_batch` null → new batch (`kind='inquiry'`,
    `closed=false`); else must be this company's open inquiry batch; `p_last` closes it.
    Counts accumulate on the batch.
  - Row shape = `InquiryRow` (A2). Per row in its own `begin … exception` block (as the ledger).
  - Classification (§16.2, first match): contract-flow record → fill empty fields only ·
    `won` (won price or phrase won) → contract flow, stage `new` if `received_on >= p_cutoff`
    else `finish` (codes from the seed; fall back by kind) · `lost` → bid stage kind `lost` ·
    `no_bid` → `bid_decision='no_bid'`, stage kind `no_bid` · `cancelled` (phrase باطل/کنسل/لغو)
    → `bid_result='cancelled'`, stage kind `cancelled` · `received_on >= p_cutoff` → first open
    bid stage · else `archived`. **§16.6:** a LOSER price alone does not make a record lost
    when the record is already in the contract flow (rule 1 wins anyway; assert it in tests).
  - Merge (§16.3): made-in-app → skip `exists_in_app`; created by an inquiry batch → update,
    empty never overwrites, stage only while `not edited_after_import`; created by a ledger batch
    → `coalesce(existing, new)` for every field, no flow / stage change.
  - Prices only when `private.sales_can('sales_prices')`: `our_price`, `currency`; `bid_result`
    set from the classification regardless (it is not a price).
  - Owner from `p_people` (name → uuid in company) else exact name match, else `in_charge_text`.
  - Buyer: `private.sales_customer(company, buyer)`; the preview sends the confirmed merged name.
  - Event `import` with the batch; `private.sales_sync_deadlines(id, true)` only for open
    records (archived / closed create none).
  - Returns `{batch_id, created, updated, skipped, skipped_rows, by_result:{won,lost,no_bid,cancelled,open,archived}}`.
- [ ] `public.app_sales_record_numbers() returns jsonb` (stable, `sales_settings` read):
      `{app:[…], ledger:[…], inquiry:[…]}` — numbers by origin, for the preview.
- [ ] `public.app_sales_list_page(p jsonb) returns jsonb` (stable, `sales` read): filters
      `state` (open|closed|all, default open), `flow`, `stage`, `owner`, `q` (record no exact or
      `ilike` on title / buyer / client / customer_ref / description / in_charge_text / owner name),
      `limit` ≤ 500; returns `{rows:[sales_rfp_json…], total, truncated}` ordered by record_no desc.
      Add the indexes it needs (`sales_rfps(company_id, record_no desc)`, trigram not needed).
- [ ] Grants: `revoke all … from public; grant execute … to authenticated` for each new function.
- [ ] `tests/sql/sales-inquiry-import.sql` (pattern of `tests/sql/sales.sql`, own transaction,
      rollback): each §16.2 rule; re-import update + empty-never-overwrites; ledger-first then
      inquiry fills only empties; inquiry-first then ledger moves to contract; made-in-app skipped;
      duplicate rec in one call; chunked batch (two calls, `p_last`); batch removal keeps rows
      touched by another batch; price keys not written without `sales_prices`; no deadlines for
      archived; caller without `sales_settings` refused; `app_sales_list_page` filters + limit.
- [ ] Update the catalog-count assertions only if a permission key is added (none planned).

### A2. Parser `lib/sales/inquiry.ts` (pure, browser) + `tests/unit/sales-inquiry.test.ts`

- [ ] `export type InquiryRow = { rec; buyer; received_on; received_text; inquiry_no; inquiry_type;
      customer_ref; description; submitted_on; offer_text; won_price; lost_price; currency;
      phrase: 'won'|'lost'|'no_bid'|'cancelled'|null; status_note; in_charge; in_charge_flag }`.
- [ ] `parseInquiryRegister(sheet: Cell[][]): InquiryParse` — header = first of first 5 rows whose
      cells include "Record No." (header keys normalised like `ledger.ts › headerKey`); columns by
      header text (all 14 known; unknown listed). Same issue model as `LedgerIssue`
      (`rec_missing`, `rec_duplicate` = error; `bad_date`, `bad_number`, `bad_value` = warning).
      Separator rows (no rec, only Company like "شروع سال …" or a 4-digit year) are skipped silently
      and counted.
- [ ] `parseRegisterDate(text): { iso: string|null; text: string|null }` — Jalali `YYYY/MM/DD`,
      `YYYY-MM-DD`, `YYYY/MM` + `YYYY-MM` (→ day 1), two-digit year (`≥50` → 13YY, else 14YY),
      English dates (`12 May 2019`, `4 Oct 2010`, `25.6.2009`) via `parseUserDate` where it can;
      anything else → `{iso:null, text}`. Year-less `7/25` → text. Out-of-range → text + warning.
- [ ] Prices: strip `,` / spaces / Persian digits; `blank`, `-`, `?` = empty; `a + b` → warning,
      empty. WINNER (RIAL|EURO) → `won_price` + IRR|EUR; LOSER likewise. Both filled → warning,
      keep won.
- [ ] Phrases (`classifyPhrase`) over Status + In-charge text, in this order: won, lost, no_bid,
      cancelled; regexes from `erp-module/reports/check_inquiry_register.py` (`PH`), including the
      Finglish variants. In-charge cell that is a phrase is not a person (`in_charge = null`).
      `Y` / `N` → `in_charge_flag`. Phone numbers stay in the note (no extraction).
- [ ] `classifyInquiry(row, existing: 'app'|'ledger'|'inquiry'|null, cutoff)`: TS mirror of the
      SQL rules for the preview counts.
- [ ] `similarCustomerGroups(names: string[], existing: string[])`: name key (= SQL
      `sales_name_key` + strip non-letters) equal → same; Levenshtein ≤ 1 (key length 5–9) or ≤ 2
      (≥ 10) → "probably same", except when both sides have ≥ 50 rows. Export `nameKey` and
      `levenshtein` (reused in B2).
- [ ] Tests with synthetic rows: every date format above, prices, phrases (fa + Finglish),
      Y/N, separator rows, duplicates, header detection, similarity (Ahwaz/Ahvaz-style pairs
      invented: "Karun Tejarat"/"Karoon Tejarat"), classification incl. the §16.6 case.

### A3. Server actions (`lib/actions/sales.ts`) + types (`lib/sales/types.ts`, `lib/supabase/types.ts`)

- [ ] `importSalesInquiries(batchId: string|null, fileName, rows: InquiryRow[], people, cutoffIso, last)`
      → `Read<InquiryImportResult>`; ≤ 2000 rows; `requireCaller`; `invalidateAppCache()` only
      when `last`.
- [ ] `listSalesRecordNumbers()`, `listSalesRecordsPage(filters)`; keep `listSalesRecords` only
      where still needed after A5 (reports, see A5) or remove it.
- [ ] Map new `sales: …` errors in `lib/errors/db-error.ts` (`sales: batch closed` →
      `dbErrors.salesBatchClosed`).

### A4. Import UI

- [ ] `ImportPanel` gets a tab switch (`lib/ui/tabs.ts`): **Contract ledger** (existing body,
      unchanged) · **Inquiry register** (new `InquiryImport.tsx`).
- [ ] `InquiryImport`: choose `.csv` or `.xlsx` (≤ 20 MB; CSV via `lib/csv/parse.ts › parseCsv`,
      UTF-8 with BOM; xlsx via `readXlsx`, first sheet that has the header). Template button:
      `.xlsx` with the 14 headers in the register's order.
- [ ] Preview (Blueprint stat strips like the ledger preview): rows · new · update (inquiry) ·
      fill-only (ledger) · skipped (app) · errors · warnings; result counts won / lost / no bid /
      cancelled / open / archived; **cut-off** `PersianDateField` (default today − 6 months) that
      recomputes counts; the LOSER-on-contract count (§16.6) shown as a note.
- [ ] **Similar companies** section: each group with radio "same company → use <name>" (default:
      the most-used spelling, or the existing customer) / "different companies". The rows' `buyer`
      is rewritten before sending. Groups with an existing customer list it first.
- [ ] **People**: distinct in-charge names sorted by row count, `PersonPick` each (pre-matched
      exact name, as the ledger). Long list → show top 30 + "show all".
- [ ] Issues table (`data-table`, first 200 + count), as the ledger.
- [ ] Import: chunks of 1000, sequential, progress bar (`role="progressbar"`), cancel stops
      after the current chunk (batch left open; it shows in the batch list as "incomplete" and can
      be removed). Result line with `by_result`.
- [ ] Batch list shows kind (ledger / inquiry) and incomplete state.

### A5. Records list at scale

- [ ] `/sales/page.tsx` reads `searchParams` (`state, flow, stage, owner, q`) and calls
      `listSalesRecordsPage`; `RecordsList` pushes filter changes to the URL (debounced 300 ms for
      `q`) instead of filtering in memory; shows "showing 500 of N — refine the search" when
      truncated. Owner filter options come from `boot.people` (not from rows).
- [ ] `/sales/settings` uses `listSalesRecordNumbers` (no full list).
- [ ] `/sales/reports`: read `ReportsView.tsx` + `lib/sales/reports.ts`; move the aggregates it
      needs into a stable `app_sales_report(p_from date, p_to date)` (counts by stage, by result,
      by customer, win rate excluding imported / archived) so the page no longer loads every
      record. Keep CSV export working from the aggregate rows.
- [ ] Check every other `listSalesRecords` caller (`grep`); none may load all rows.

### A6. Copy, docs, verification

- [ ] `messages/fa.json` + `en.json` under `sales.import.inquiry.*`, `sales.stage.archived`,
      list truncation text. Pre-write the keys before parallel subagents (memory "fan-out").
- [ ] `npm run lint`, `tsc --noEmit`, `npm run test:unit`, SQL tests on the clone,
      `npm run build`.
- [ ] e2e `tests/e2e/sales-inquiry-import.spec.ts` with a synthetic 30-row CSV (own `999…`
      users per CLAUDE.md; numbers 900001+; removes its batch at the end).
- [ ] Local run on the newest live backup (SMS off first): import the **real** CSV and `B1.xlsx`
      in both orders on two clones; record timings and `by_result`; check the list, a record,
      Reports and Deadlines are not flooded. Nothing from this is committed.
- [ ] Docs: spec status line, `DATA_MODEL.md` (archived kind, `import_batches`, batch kind),
      `REQUIREMENTS.md` FR-94 §16 line, `CHANGELOG.md`, `TASKS.md` (client questions from the
      report), `CLAUDE.md` gotchas (one line each: archived kind; `import_batches` drives removal),
      `AGENT-LOG.md`.

### A7. Customer lookup (spec §16.7)

- [ ] SQL (in A1's migration): `app_sales_add_customer(p jsonb)` (`sales` edit; `name`, `kind`;
      refuses an existing name key → returns that id instead, `{id, existed:true}`);
      `app_sales_similar_customers(p_name text)` (stable; same key or Levenshtein ≤ 1 / ≤ 2 on the
      key without spaces, plpgsql Levenshtein unless `fuzzystrmatch` is installed; top 5).
      `app_sales_save_record` / create: buyer / client by **id** (`buyer_id`, `client_id`);
      the name path stays only for the imports.
- [ ] `_components/CustomerCombo.tsx`: combobox (input + listbox, keyboard: ↑ ↓ Enter Esc,
      `aria-activedescendant`), filters `boot.customers` by `nameKey` (from `lib/sales/inquiry.ts`);
      last option "Create "<typed>"" → `NewCustomerDialog` (name, G / C, similar names from
      `app_sales_similar_customers` with "use this one"). Used in `RecordForm` and `StageFields`
      for buyer and client; `datalist` removed.
- [ ] Unit test for the filter; e2e: type an existing name → select; type a new one → create.

### A8. Customers tab (spec §16.7)

- [ ] SQL: `app_sales_customers()` (stable, `sales` read; one row per customer with the §16.7
      columns; currency sums as `{IRR: n, EUR: n}` objects; price keys only with `sales_prices`);
      `app_sales_customer(p_id)` (tiles + per-year counts + client-of list + top words);
      `app_sales_merge_customers(p_from, p_into)` and `app_sales_rename_customer(p_id, p_name)`
      (`sales_settings` edit; merge locks every moved record row first, logs `edit` events,
      deletes `p_from`). SQL tests.
- [ ] Tab in `SalesTabs` + phone `SECTIONS` if needed; `/sales/customers/page.tsx` (table,
      search, sort client-side — customers ≈ 2k rows max) and `/sales/customers/[id]/page.tsx`
      (tiles, year bars, records via `listSalesRecordsPage({buyer})` — add `buyer` filter to
      `app_sales_list_page`), merge / rename dialogs. Copy fa + en.

---

## Phase B — predefined inputs (§16.5)

### B1. Migration `…_sales_lists.sql`

- [ ] `sales_customers.kind` CHECK adds `competitor`.
- [ ] `sales_lists (id, company_id, list text check in ('source','inquiry_type','bank',
      'deadline_type','decision_reason','result_reason','item_type'), label_fa, label_en, active,
      position, unique(company_id, list, lower(label_en)))`, RLS on, no grants; seeded per company
      (source: website, email, ستاد, estelam, other; result_reason: price, technical, delivery
      time, cancelled by customer, other; decision_reason: no capacity, out of scope, price not
      competitive, other; deadline_type: meeting, site visit, clarification, other).
- [ ] `sales_customer_sites (id, company_id, customer_id, name, unique(customer_id, lower(name)))`.
- [ ] Functions: `app_sales_lists()` (in bootstrap), `app_sales_save_list_item`,
      `app_sales_order_list`, `app_sales_add_customer(p jsonb)` (refuses a name-key duplicate,
      returns similar names from `private.sales_similar_customers(company, name)` — same key /
      Levenshtein rules as A2, needs `fuzzystrmatch`; check it exists in the image first, else a
      plpgsql Levenshtein), `app_sales_add_site`.
- [ ] Record writes take ids: `buyer_id`, `client_id`, `site_id` (keep `project_site` text for
      old rows; new column `site_id`), `winner_id`, `reason_id` + note. Old name-typing path in
      `app_sales_save_record` removed (import keeps its own name path).
- [ ] SQL tests in `tests/sql/sales-lists.sql`.

### B2. Pickers

- [ ] Customer lookup is done in A7; B2 only adds the `competitor` kind to it.
- [ ] `ListPick` for `sales_lists` lists; `SitePick` (per chosen customer, add inline via a small
      dialog).

### B3. Replace inputs

- [ ] `RecordForm`, `StageFields`: buyer, client, project site, source, currency, inquiry type.
- [ ] `StageActions`: winner (competitor pick), decision / result reason (list + note).
- [ ] `RecordPanels`: bond bank (list), deadline type (list + note), document name (template
      list + "other").
- [ ] `ItemsTab`: item type column → `ListPick` (`item_type`).
- [ ] Custom fields of type `select` already render a select — verify.

### B4. Settings › Lists

- [ ] New Settings section (tab) listing each list: add, rename, reorder, retire (never delete a
      used value). Customers: merge two customers (moves records; for the duplicates the import
      report found).

### B5. Tests, copy, docs — as A6 for the B pieces; e2e covers add-customer duplicate warning.

---

## Order and review gates

A1 → A2 (parallel with A1) → A3 → A4 + A5 + A7 + A8 (pre-write messages) → A6 → owner review on
the local stack with the real file → B1 → B2 → B3 + B4 → B5 → owner review. No merge to `main`
without the owner's OK (push to `main` deploys).
