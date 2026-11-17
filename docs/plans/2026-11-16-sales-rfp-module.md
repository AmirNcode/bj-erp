# ERP — Sales / RFP module (FR-94) Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Executed inline by the lead session
> (owner's choice, 2026-11-16).

**Goal:** A permission-hidden "ERP" module: one record per RFP / contract with configurable stages,
custom fields, deadlines, guarantees and payments, an engineering items tree with permanent dash
numbers, an import of the client's contract ledger (`B1.xlsx`) with a template, and reports.

**Architecture:** Module-owned tables (`sales_*`, plus module-neutral `project_nodes`) with RLS on
and no client policies; every read and write goes through `app_sales_*` / `app_project_*`
SECURITY DEFINER functions that check `private.has_perm` and exchange JSON (the FR-70 travel
pattern). The app layer is thin server actions over those functions, pure TS helpers in
`lib/sales/`, and client components under `app/[locale]/(app)/sales/`.

**Tech:** Next.js 16 App Router, TypeScript, next-intl (fa default RTL + en), self-hosted Supabase
(Postgres + PostgREST), Vitest, plain-SQL tests, `fflate` (zip, for `.xlsx` read/write).

**Spec:** `docs/specs/2026-11-16-sales-rfp-module-design.md` — §15 (build decisions) wins over the
earlier sections.

## Global constraints

- `CLAUDE.md` Gotchas are binding: migrations only in `supabase/migrations/`, forward-only, frozen
  once applied to any non-throwaway DB; `lib/supabase/types.ts` hand-edited; every string in
  `messages/fa.json` + `messages/en.json`; UI per `docs/DESIGN.md` (`data-table`, tabs from
  `lib/ui/tabs.ts`, no shadows, logical RTL utilities, `data-wide` for full-width pages).
- Dates: Gregorian `date` in Postgres, Jalali only in the UI (`PersianDateField`,
  `formatCalendarDate`, `parseUserDate` for typed / imported dates).
- Server actions start with `requireCaller(...)`; client components read copy with
  `useTranslations('sales')`.
- No preset role receives any new permission. The admin holds them implicitly (`perm_level`).
- Nothing in `erp-module/` is committed (client data); add it to `.gitignore`.
- No file bytes are stored or uploaded; the ledger file is parsed in the browser.
- **DB work on a throwaway clone** of the running local stack DB (`bj-approvals-finance-db-1`),
  named `erp`: `create database erp`, `pg_dump -Fc -d postgres | pg_restore --no-owner -d erp`,
  apply the migration, run `tests/sql/sales.sql`, drop it. `supabase/schema.sql` is patched from
  the schema diff of the clone before / after (never a raw dump: local ACL drift).
- Error messages raised by the new functions start with `sales: ` and are mapped in
  `lib/errors/db-error.ts` → `dbErrors.sales*` keys.

## Review focus

1. **A reader without `sales_prices` / `sales_bonds` must receive no price or guarantee values
   from any function** (list, record, deadlines labels, events, price history) — SQL test in T1.
2. **A person with no `sales` permission must get nothing**: every function raises
   `sales: not allowed`; `/sales/*` redirects home; no nav entry, no Home card — SQL test (T1),
   nav unit test (T2).
3. **Ledger files that differ from the sample**: header on row 1 instead of 2, missing or extra
   columns, duplicate or non-numeric `Rec`, Persian digits, `#VALUE!`, blank trailing rows — unit
   tests in T3; server re-check in T1 (bad `rec` skipped, never a crash).
4. **Dash numbers are permanent and unique under concurrent edits**: delete then add never reuses
   a number; two parallel adds under one parent get different numbers (parent row lock) — SQL test.
5. **Settings changes under live records**: a stage with records can be retired or renamed but
   not deleted; records keep showing it; import still maps statuses after a rename (falls back to
   stage kind) — SQL test.

---

### Task 1: Database — tables, catalog, seed, functions

**Files:**
- Create: `supabase/migrations/20261116200000_sales_module.sql`
- Create: `tests/sql/sales.sql`
- Modify: `supabase/schema.sql` (patched from clone diff)

**Tables** (all: `company_id uuid not null references public.companies`, RLS enabled,
`revoke all … from anon, authenticated`; ids `uuid default gen_random_uuid()`):

| Table | Columns beyond id / company_id |
|---|---|
| `sales_settings` | pk `company_id`; `next_record_no int`, `warn_days int default 7`, `validity_days int default 90`, `doc_template text[] default '{}'` |
| `sales_customers` | `name`, `name_key` (lower, single-spaced; unique per company), `kind` (`government|contractor`, null), `notes` |
| `sales_flows` | `kind` (`bid|contract`, unique per company), `name_fa`, `name_en` |
| `sales_stages` | `flow_id`, `position`, `name_fa`, `name_en`, `kind` (`open|lost|no_bid|cancelled|done`), `action` (`decide|quote|submit`, null), `owner_role_id` → `roles`, `required text[]`, `active` |
| `sales_field_defs` | `entity` (`rfp|item`), `key` (`^[a-z][a-z0-9_]{0,39}$`, unique per company + entity), `label_fa`, `label_en`, `type` (`text|number|date|select|yes_no`), `options text[]`, `position`, `show_in_list`, `active` |
| `sales_import_batches` | `file_name`, `created_by`, `created_at`, `created_count`, `updated_count`, `skipped_count` |
| `sales_rfps` | `record_no int` (unique per company), `revision int default 0`, `buyer_id`, `client_id` → customers, `customer_ref`, `project_site`, `source` (`website|email|other`), `title not null`, `description`, `received_on`, `flow_id`, `stage_id`, `owner_id` → profiles, `in_charge_text`, `bid_decision` (`pending|bid|no_bid`, default `pending`), `decided_by`, `decided_at`, `decision_reason`, `needs_quote`, `needs_bond`, `proposal_due`, `quote_due`, `bond_due`, `submitted_on`, `delivery_method` (`hand|courier`), `received_by`, `validity_days`, `bid_result` (`won|lost|cancelled`), `result_at`, `result_by`, `result_reason`, `currency`, `our_price`, `winning_bid`, `total_value` (all `numeric(18,2)`), `winner_name`, `order_date`, `contract_start`, `delivery_amount numeric`, `delivery_unit` (`day|week|month`), `delivery_date`, `prepayment bool`, `prepayment_date`, `addendum bool`, `custom jsonb default '{}'`, `item_columns jsonb`, `node_seq int default 0`, `import_batch_id`, `edited_after_import bool default false`, created / updated by + at |
| `project_nodes` | `rfp_id` (cascade), `parent_id` (cascade, null = level 1), `seq`, `code` (unique per company), `depth`, `child_seq int default 0`, `description`, `product_type`, `size`, `rating`, `qty numeric`, `unit`, `custom jsonb`, created / updated by + at |
| `sales_item_prices` | pk `node_id` (cascade), `unit_price numeric(18,2)` |
| `sales_bonds` | `rfp_id` (cascade), `kind` (`bid|performance|advance_payment`), `seq`, `percent numeric`, `form` (`bank|safteh|cheque`), `amount`, `currency`, `bank`, `number`, `issued_on`, `expires_on`, `status` (`needed|requested|issued|delivered|released|expired`), `note`, `imported bool` |
| `sales_payments` | `rfp_id` (cascade), `seq`, `amount`, `paid_on`, `note`, `imported bool` |
| `sales_deadlines` | `rfp_id` (cascade), `kind` (`proposal_due|quote_due|bond_due|offer_valid_until|bond_expires|delivery_due|other`), `source_id uuid`, `label`, `due_on not null`, `responsible_id`, `done_at`, `done_by`, `auto bool`; unique `(rfp_id, kind, coalesce(source_id, zero-uuid)) where auto` |
| `sales_documents` | `rfp_id` (cascade), `position`, `name`, `assignee_id`, `status` (`todo|in_progress|ready`), `note` |
| `sales_events` | `rfp_id` (cascade), `at`, `actor_id`, `kind` (`created|edit|stage|decision|result|comment|import|items|finance`), `body jsonb` |

`level_kind` from spec §5a is dropped (§6c: the tree does not enforce level meaning).

**Catalog:** redefine `private.permission_keys` (+7 keys = 33), `permission_allows`
(E: `sales_decide`, `sales_settings`; R: `sales_reports`; RE: `sales`, `sales_prices`,
`sales_bonds`, `project_items`), `permission_deps` (each of the six other keys `('<key>','read','sales')`),
starting from the current bodies in `schema.sql`. No `role_permissions` rows.

**Seed:** `private.sales_ensure(p_company uuid)` (idempotent): settings row (`next_record_no` =
1), flows, stages —
bid: Received (open) · Bid decision (open, `decide`) · Technical proposal (open) · Pricing (open,
`quote`) · Ready to send (open) · Submitted (open, `submit`) · Lost (lost) · No bid (no_bid) ·
Cancelled (cancelled); contract: New · Current · Hold (open) · Finish (done) · Cancel (cancelled).
Farsi names: دریافت‌شده · تصمیم شرکت در مناقصه · پیشنهاد فنی · قیمت‌گذاری · آماده ارسال · ارسال‌شده ·
بازنده · عدم شرکت · لغوشده / جدید · جاری · متوقف · پایان‌یافته · لغوشده. `doc_template` default:
Technical offer, Financial offer, Catalogs, Drawings, Certificates. The migration runs it for every
existing company; `app_sales_bootstrap` runs it when the settings row is missing.

**Private helpers:**
- `private.sales_company(p_key text, p_level text) returns uuid` — caller's company
  (`private.caller_company()`); raises `sales: not allowed` unless `has_perm(auth.uid(), 'sales','read')`
  **and** `has_perm(auth.uid(), p_key, p_level)`.
- `private.sales_rfp(p_id uuid, p_company uuid) returns public.sales_rfps` — row `for update`;
  raises `sales: not found` for another company's id.
- `private.sales_touch(p_rfp uuid, p_kind text, p_body jsonb)` — event row, `updated_by/at`,
  `edited_after_import = true`, then `private.sales_sync_deadlines`.
- `private.sales_sync_deadlines(p_rfp uuid)` — upserts / deletes the `auto` rows:

  | kind | exists when | due_on | done when |
  |---|---|---|---|
  | `proposal_due` | `proposal_due` set | it | `submitted_on` set or stage kind ≠ open |
  | `quote_due` | `needs_quote` and `quote_due` set | it | same |
  | `bond_due` | `needs_bond` and `bond_due` set | it | a `bid` bond is `issued|delivered|released`, or stage kind ≠ open |
  | `offer_valid_until` | `submitted_on` and `validity_days` set | sum | `bid_result` set |
  | `bond_expires` (per bond, `source_id`) | bond `expires_on` set | it | bond `released|expired` |
  | `delivery_due` | flow kind `contract` and `delivery_date` set | it | stage kind ≠ open |

  `responsible_id` = record `owner_id`. Sets `done_at` when the condition holds and it is null;
  never clears a done mark.
- `private.sales_recalc_price(p_rfp uuid)` — if any `sales_item_prices` row exists for the record,
  `our_price = sum(qty × unit_price)` over priced nodes.
- `private.sales_num(text) returns numeric`, `private.sales_date(text) returns date` — null on
  anything that does not cast (import safety).
- `private.sales_customer(p_company uuid, p_name text, p_kind text) returns uuid` — find by
  `name_key` or create; fills `kind` when it was null.

**Public functions** (all `security definer`, `set search_path to ''`, `revoke … from public, anon`,
`grant execute … to authenticated`):

| Function | Needs | Notes |
|---|---|---|
| `app_sales_bootstrap() returns jsonb` | sales R | `{caps, flows, stages, fields, customers, people, roles, settings, batches?}`; `caps` = `{edit, prices, prices_edit, bonds, bonds_edit, decide, reports, settings, items, items_edit}`; `people` = active profiles `{id, name}`; `batches` only with `sales_settings` |
| `app_sales_list() returns jsonb` | sales R | array; price keys (`our_price, winning_bid, winner_name, total_value`) only with `sales_prices` R; includes `next_deadline`, `stage_id`, `flow_kind`, `stage_kind`, names of buyer / client / owner |
| `app_sales_record(p_id uuid) returns jsonb` | sales R | `{record, nodes, bonds, payments, deadlines, documents, events}`; `nodes[].unit_price` only with prices; `bonds` full with `sales_bonds` R, otherwise `[{kind, status}]`; `payments` only with `sales_bonds` R |
| `app_sales_deadlines(p_include_done boolean default false) returns jsonb` | sales R | with record no, title, stage, responsible name |
| `app_sales_find_node(p_code text) returns jsonb` | sales R | `{rfp_id, node_id}`; a bare record number matches the record |
| `app_sales_price_history(p_q text) returns jsonb` | sales_reports R + sales_prices R | priced nodes matching type / size / rating / description (`ilike`), with record no, buyer, date, qty, unit price, currency, `bid_result`, `winning_bid`; limit 500 |
| `app_sales_save_record(p_id uuid, p jsonb) returns uuid` | sales E (closed stage: + sales_decide) | create (`p_id` null): takes `flow_kind`, assigns `record_no` = `p.record_no` or `next_record_no` (then bumps the setting past the highest), first stage of the flow, applies `doc_template` for a bid record; price keys in `p` are applied only with `sales_prices` E, ignored otherwise; `our_price` typed only while no item prices exist; raises `sales: record number taken`, `sales: title required` |
| `app_sales_move_stage(p_id uuid, p_stage uuid, p_owner uuid, p_note text, p_submit jsonb) returns void` | sales E | §15.5–6 rules; raises `sales: required fields missing`, `sales: decision required`, `sales: stage not available`; entering a `submit` stage takes `{submitted_on, delivery_method, received_by, validity_days}` (default `validity_days` from settings) |
| `app_sales_decide(p_id uuid, p_bid boolean, p_reason text) returns void` | sales_decide | bid flow only; bid → next active open stage after the current one; no-bid → first `no_bid` stage |
| `app_sales_result(p_id uuid, p_result text, p jsonb) returns void` | sales_decide | `won` → first stage of the contract flow (and `total_value` defaults to `our_price`); `lost` / `cancelled` → first stage of that kind; stores `winning_bid`, `winner_name` (prices E not required here: the decider records the result), `result_reason` |
| `app_sales_comment(p_id uuid, p_text text) returns void` | sales E | 1–2000 chars |
| `app_sales_save_bond(p_rfp uuid, p_id uuid, p jsonb) returns uuid` · `app_sales_delete_bond(p_id uuid)` | sales_bonds E | |
| `app_sales_save_payment(p_rfp uuid, p_id uuid, p jsonb) returns uuid` · `app_sales_delete_payment(p_id uuid)` | sales_bonds E | |
| `app_sales_save_deadline(p_rfp uuid, p_id uuid, p jsonb) returns uuid` · `app_sales_set_deadline_done(p_id uuid, p_done boolean)` · `app_sales_delete_deadline(p_id uuid)` | sales E | save / delete only for `auto = false`; done toggle for any |
| `app_sales_save_document(p_rfp uuid, p_id uuid, p jsonb) returns uuid` · `app_sales_delete_document(p_id uuid)` | sales E | |
| `app_project_save_node(p_rfp uuid, p_id uuid, p_parent uuid, p jsonb) returns jsonb` | project_items E | new: locks the parent node (or the record for level 1), `seq = ++child_seq / ++node_seq`, `code = parent code || '-' || seq`; returns `{id, code}` |
| `app_project_delete_node(p_id uuid) returns void` | project_items E | subtree goes; counters untouched (numbers retire) |
| `app_project_set_columns(p_rfp uuid, p_columns jsonb) returns void` | project_items E | `{"1": [...], "2": [...]}`; keys must be built-ins or active item fields |
| `app_sales_set_item_price(p_node uuid, p_price numeric) returns void` | sales_prices E | null deletes; recalculates `our_price` |
| `app_sales_save_field(p_id uuid, p jsonb) returns uuid` | sales_settings, or project_items E when `entity = 'item'` | key immutable after creation; raises `sales: field key taken` |
| `app_sales_save_stage(p_id uuid, p_flow uuid, p jsonb) returns uuid` · `app_sales_order_stages(p_flow uuid, p_ids uuid[])` | sales_settings | no delete; a flow keeps ≥ 1 active open stage (`sales: flow needs an open stage`) |
| `app_sales_save_settings(p jsonb) returns void` | sales_settings | `next_record_no` must exceed the highest existing number |
| `app_sales_import(p_file text, p_rows jsonb, p_fields jsonb) returns jsonb` | sales_settings | per row (shape in T3): bad `rec` → skipped; upsert by `record_no` into the contract flow; status → stage by `name_en` (case-insensitive) else by kind (finish → `done`, cancel → `cancelled`, else first open); buyer / client via `sales_customer`; in-charge → profile by exact normalised full name else `in_charge_text`; replaces the record's `imported` bonds and payments; `p_fields` = headers to create as `rfp` text fields; returns `{batch_id, created, updated, skipped}`; does not set `edited_after_import` |
| `app_sales_remove_batch(p_batch uuid) returns jsonb` | sales_settings | deletes the batch's created records with `edited_after_import = false`; then customers with no records; returns `{deleted, kept}` |

- [ ] **Step 1:** Write `tests/sql/sales.sql` (header and fixture helpers copied from
  `tests/sql/travel-booking.sql`; fixture company, users: `admin`, `ceo` (custom role, all seven
  keys), `viewer` (custom role, `sales` read only), `eng` (`sales` read + `project_items` edit),
  `fin` (`sales` read + `sales_bonds` edit), `nobody` (employee)). Assertions:
  - catalog: 33 keys; shapes; six deps; no preset role holds a `sales%` / `project_items` row.
  - `nobody`: each read function and `app_sales_save_record` → `ERROR … sales: not allowed`.
  - `ceo` creates a bid record → `record_no` = setting, settings bumped, 5 documents, 1 `created` event.
  - `viewer` list / record JSON: no key `our_price`, `winning_bid`, `total_value`, `unit_price`;
    bonds reduced to `kind` + `status`; `payments` absent. `ceo` sees them.
  - decide gate: move past the `decide` stage before deciding → `sales: decision required`;
    `app_sales_decide(true)` advances one stage; `viewer` deciding → not allowed.
  - `submit` stage: `proposal_due` deadline done, `offer_valid_until` = submitted + validity.
  - result `won`: flow kind `contract`, first contract stage, `bid_result = 'won'`,
    `total_value = our_price`.
  - nodes: `eng` adds two lines (`N-1`, `N-2`), a child (`N-1-1`), deletes `N-2`, adds → `N-3`;
    `viewer` add → not allowed; code unique index holds.
  - prices: `ceo` sets unit price → `our_price` = qty × price; `eng` set price → not allowed.
  - guarantees: `fin` adds a performance bond with `expires_on` → `bond_expires` deadline; status
    `released` → done.
  - settings: retire a stage that has a record → record still returns its stage; retiring the
    last active open stage → `sales: flow needs an open stage`.
  - import: 3 rows (one with `rec` null) → `{created 2, skipped 1}`; re-import with a changed
    `total_value` → `{updated 2}`, no duplicates; status `finish` maps to the `done` stage after the
    stage is renamed; edit one record, `app_sales_remove_batch` → `{deleted 1, kept 1}`.
  - company isolation: a second company's admin cannot read the first's record (`sales: not found`).
- [ ] **Step 2:** Create clone `erp`; run the test → fails (functions missing).
- [ ] **Step 3:** Write the migration as specified above.
- [ ] **Step 4:** Apply to `erp`; run `tests/sql/sales.sql` → all PASS. Run the FR-55 and travel
  SQL files on the clone to confirm the catalog change breaks nothing that passed before.
- [ ] **Step 5:** Patch `supabase/schema.sql` from the before / after schema diff of the clone.

### Task 2: Catalog, nav, types, labels

**Files:** Modify `lib/permissions/catalog.ts`, `lib/nav/tabs.ts`,
`app/[locale]/(app)/_components/{nav-icons.tsx,MobileTopBar.tsx}`, `lib/supabase/types.ts`,
`lib/errors/db-error.ts`, `messages/{fa,en}.json`, `.gitignore`;
tests `tests/unit/{permissions-catalog,nav_tabs}.test.ts`.

- [ ] **Step 1:** Tests first: catalog count 33, section order
  `[…, 'procurement', 'sales', 'approvalChain', 'settings']`, `SHAPES` for the seven keys; nav:
  `sales` read + no Manage group → tab `erp` (`/sales`); with a Manage group → Manage item `erp`;
  no `sales` → neither. Run → fail.
- [ ] **Step 2:** `PermKey` + `SECTIONS` (`{ key: 'sales', items: ['sales','sales_prices','sales_bonds','sales_decide','sales_reports','sales_settings','project_items'] }`),
  `SHAPES`, `DEPENDENCIES`. `TabKey` / `ManageKey` gain `'erp'`; `ERP_TAB`, MANAGE entry
  (`testId: 'nav-erp'`), `FOLLOWS_GROUP` gains `'erp'`; `tabsForRoles` / `manageItemsForRoles`
  treat it like procurement with `can(perms,'sales','read')`. Icon: lucide `Factory`.
  `MobileTopBar` `SECTIONS` gains `['/sales','erp']`.
- [ ] **Step 3:** `types.ts` `Functions`: one entry per function in T1 (`Returns: Json` /
  `string` / `undefined`). `db-error.ts` rules: `/^sales: (not allowed|not found|record number taken|title required|required fields missing|decision required|stage not available|field key taken|flow needs an open stage|invalid input)/`
  → `dbErrors.sales.<camelKey>`.
- [ ] **Step 4:** Copy: `nav.erp` = "ERP" (both languages);
  `permissions.sections.sales` = "ERP · Sales" / «ERP · فروش»; `permissions.items.<key>.{label,description}` ×7;
  `dbErrors.sales.*`. Run unit tests → pass.

### Task 3: Pure helpers (`lib/sales/`)

**Files:** Create `lib/sales/{types,xlsx,ledger,tree,deadlines,stages,reports}.ts`; tests
`tests/unit/sales-{xlsx,ledger,tree,deadlines,stages,reports}.test.ts`. Add `fflate` to
`dependencies` (already in `node_modules` via jspdf; read its `.d.ts` for `unzipSync`, `zipSync`,
`strToU8`, `strFromU8`).

**Interfaces produced:**
- `types.ts`: `SalesCaps`, `Stage`, `Flow`, `FieldDef`, `Customer`, `Person`, `SalesSettings`,
  `Bootstrap`, `RecordRow` (list), `RecordDetail`, `NodeRow`, `Bond`, `Payment`, `Deadline`,
  `DocumentRow`, `EventRow`, `ImportBatch` — mirrors of the JSON in T1 (price keys optional).
- `xlsx.ts`: `type Cell = string | number | null`; `readXlsx(bytes: Uint8Array): { name: string; rows: Cell[][] }[]`
  (shared strings incl. rich-text runs, inline strings, `t="str"`, booleans, `t="e"` → the error
  text, numbers; XML entities decoded; sparse rows / cells padded by `r` reference);
  `writeXlsx(sheetName: string, rows: Cell[][]): Uint8Array` (inline strings + numbers).
- `ledger.ts`: `LEDGER_GROUPS: Cell[]` and `LEDGER_HEADERS: string[]` (template rows 1 and 2,
  the sample's exact header text, 47 columns through `Payment 4`, `Date`);
  `templateRows(): Cell[][]`;
  `type LedgerRow = { rec: number; buyer: string|null; client: string|null; kind: 'government'|'contractor'|null; customer_ref: string|null; project_site: string|null; delivery_amount: number|null; delivery_unit: 'day'|'week'|'month'|null; order_date: string|null; contract_start: string|null; prepayment: boolean|null; prepayment_date: string|null; delivery_date: string|null; addendum: boolean|null; description: string|null; total_value: number|null; currency: string|null; status: string|null; in_charge: string|null; bonds: { kind: 'performance'|'advance_payment'; seq: number; percent: number|null; form: 'bank'|'safteh'|'cheque'|null; issued_on: string|null; amount: number|null }[]; payments: { seq: number; amount: number|null; paid_on: string|null }[]; custom: Record<string,string> }`;
  `type LedgerIssue = { row: number; column: string; value: string; level: 'warning'|'error'; code: 'rec_missing'|'rec_duplicate'|'bad_date'|'bad_number'|'bad_value' }`;
  `parseLedger(rows: Cell[][]): { ok: true; rows: LedgerRow[]; issues: LedgerIssue[]; unknown: string[]; missing: string[] } | { ok: false; reason: 'no_header' }`.
  Header row = first of the first 5 rows whose first non-empty cell is `Rec` (case-insensitive);
  headers matched after collapsing whitespace and lower-casing; the repeated `Bank Guarrenty…`,
  `Date`, `Amount` headers are resolved by position after their `% of …` / `Payment n` anchor.
  Normalisation: digits via `toAsciiDigits`; `-`, empty, `#VALUE!` → null; dates through
  `parseUserDate`; yes / no any case; `Mounth` → month; currency `Euro→EUR`, `Dollar|UDS|USD→USD`,
  `Rial→IRR`; form `Yes→bank`, `Safteh→safteh`, `Cheque|چک→cheque`, `No→null`; percent cell with
  text → warning; a bond is emitted when any of percent / form / amount is present; unknown
  headers' values go to `custom`. `rec_missing` / `rec_duplicate` rows are errors and excluded.
- `tree.ts`: `buildTree(nodes: NodeRow[]): TreeNode[]` (children sorted by `seq`);
  `BUILTIN_COLUMNS = ['product_type','size','rating','qty','unit'] as const`;
  `columnsForDepth(itemColumns: Record<string,string[]>|null, depth: number): string[]`
  (own depth, else nearest shallower configured depth, else depth 1 → built-ins, deeper → `['qty','unit']`).
- `deadlines.ts`: `deadlineState(dueOn: string, today: string, warnDays: number): 'overdue'|'soon'|'ok'`;
  `daysLeft(dueOn, today): number`.
- `stages.ts`: `defaultNextStage(stages: Stage[], currentId: string, needsQuote: boolean): Stage|null`
  (next active open stage by position, skipping `quote` when `needsQuote` is false).
- `reports.ts`: `pipeline(rows: RecordRow[], stages: Stage[]): { stageId: string; count: number; value: Record<string, number> }[]`
  (value per currency); `results(rows: RecordRow[], by: 'customer'|'year'): { key: string; decided: number; won: number; lost: number; winRate: number|null }[]`
  (year = Jalali year of `result_at`); `deadlinePerformance(d: Deadline[], today: string): { onTime: number; late: number; openOverdue: number }`.

- [ ] **Step 1:** Unit tests, including: xlsx round-trip (`writeXlsx` → `readXlsx`) with Persian
  text, `&`/`<`, numbers, empty cells; a hand-built workbook with shared + rich strings;
  `parseLedger(templateRows())` → `ok`, 0 rows, no `missing`; header on row 1; the sample's quirks
  (`' 1403/02/19'`, `'UDS'`, `'Mounth'`, `'چک'`, `'#VALUE!'`, `'YES-باطل شده است'`, Persian digits);
  duplicate and missing `Rec`; an extra column → `unknown` + `custom`; a missing column →
  `missing`, rows still parse; tree order and `columnsForDepth` fallbacks; deadline states at the
  boundary day; `defaultNextStage` skip; report maths incl. zero decided → `winRate null`.
  Run → fail.
- [ ] **Step 2:** Implement. Run → pass. Local check (not a committed test): parse
  `erp-module/files/B1.xlsx` with a scratch script → 135 rows, issues listed.

### Task 4: Server actions

**Files:** Create `lib/actions/sales.ts` (`'use server'`).

One thin action per T1 function, named `getSalesBootstrap`, `listSalesRecords`, `getSalesRecord`,
`listSalesDeadlines`, `findSalesNode`, `getPriceHistory`, `saveSalesRecord`, `moveSalesStage`,
`decideSalesBid`, `setSalesResult`, `addSalesComment`, `saveSalesBond`, `deleteSalesBond`,
`saveSalesPayment`, `deleteSalesPayment`, `saveSalesDeadline`, `setSalesDeadlineDone`,
`deleteSalesDeadline`, `saveSalesDocument`, `deleteSalesDocument`, `saveProjectNode`,
`deleteProjectNode`, `setProjectColumns`, `setSalesItemPrice`, `saveSalesField`, `saveSalesStage`,
`orderSalesStages`, `saveSalesSettings`, `importSalesLedger`, `removeSalesBatch`. Reads return
`{ ok: true; data: T } | DbErrorResult`; writes `{ ok: true; id?: string } | DbErrorResult` and
call `invalidateAppCache()`. `importSalesLedger(fileName, rows: LedgerRow[], fields: string[])`
re-runs nothing in TS (the DB function re-checks) but caps `rows.length ≤ 5000`.

- [ ] **Step 1:** Implement; `npx tsc --noEmit` clean.

### Task 5: Module shell, list, new record

**Files:** Create `app/[locale]/(app)/sales/{layout.tsx,page.tsx}`,
`sales/_components/{SalesTabs.tsx,RecordsList.tsx,RecordForm.tsx,CustomFieldInput.tsx,NodeSearch.tsx,format.ts}`.

- `layout.tsx`: guard `can(perms,'sales','read')` else redirect `/home`; renders `SalesTabs`
  (Records `/sales` · Deadlines · Reports (caps.reports) · Settings (caps.settings)) + `NodeSearch`
  (number box → `findSalesNode` → `/sales/[id]?node=`; "not found" inline).
- `page.tsx` (`data-wide`): bootstrap + list → `RecordsList`.
- `RecordsList`: filters (text, flow kind, stage, state open / closed, buyer, owner), `data-table`
  (record no · buyer · client · title · stage · owner · next deadline · value + currency (prices) ·
  custom `show_in_list` fields), phone cards; "New record" (caps.edit) opens `RecordForm` in a
  dialog with a flow choice (RFP / Contract).
- `RecordForm` (create + edit; used again in T6): intake fields per flow kind (bid: buyer, client,
  customer ref, title, description, source, received date, proposal due, needs quote + quote due,
  needs bond + bond due, currency; contract: + site, order / LOI / delivery dates, delivery
  duration, prepayment, addendum, total value (prices)); buyer / client as text with a `datalist`
  of customers, kind select shown for a new name; owner `PersonSearch`; custom `rfp` fields via
  `CustomFieldInput` (text / number / date / select / yes-no).
- `format.ts`: `money(n, currency, locale)`, `recordNo`, `stageName(stage, locale)`,
  `fieldLabel(def, locale)`.

- [ ] **Step 1:** Implement with all copy in `messages` (`sales.*`). `tsc` + `lint` clean.

### Task 6: Record page

**Files:** Create `sales/[id]/page.tsx`, `sales/_components/{RecordView.tsx,StageBar.tsx,MoveStageDialog.tsx,DecisionDialogs.tsx,OverviewTab.tsx,ItemsTab.tsx,DocumentsTab.tsx,FinanceTab.tsx,DeadlinesTab.tsx,ActivityTab.tsx}`.

- Header: record no, title, buyer / client, owner, `StageBar` (flow's active stages, current
  highlighted, closed kinds as a tag), deadline strip (open deadlines with days left; red / amber).
- Actions by caps: Edit (dialog with `RecordForm`), Move stage (`MoveStageDialog`: target stage
  defaulting to `defaultNextStage`, next owner, note; submit fields when the target has
  `action = 'submit'`), Decide bid / no-bid and Record result (`DecisionDialogs`, caps.decide).
- Tabs (`tabClass`): Overview (all fields read-only incl. contract block and custom fields) ·
  Items · Documents · Guarantees & payments (shown with caps.bonds, else a one-line status list) ·
  Deadlines · Activity (events + comment box).
- `ItemsTab`: expandable tree table (§6c). Per depth: description + `columnsForDepth` columns;
  inline row editor; `[+ row]` at top level, `[+ part]` under an expanded row; `[+ column]`
  (pick an existing item field or create one: label fa / en + type → `saveSalesField` then
  `setProjectColumns`); hide column; unit price + line total columns only with caps.prices
  (editable with caps.prices_edit); delete row asks for confirmation naming the code and child
  count; `?node=` expands and highlights the path.

- [ ] **Step 1:** Implement. `tsc` + `lint` clean.

### Task 7: Deadlines page and Home card

**Files:** Create `sales/deadlines/page.tsx`, `sales/_components/DeadlinesList.tsx`,
`app/[locale]/(app)/home/SalesDeadlinesCard.tsx`; modify `home/page.tsx`.

- List: open deadlines soonest first, "mine" toggle, kind filter, state colouring, mark done
  (caps.edit), link to record.
- Home card: only with `sales` read and ≥ 1 own open deadline that is overdue or within
  `warn_days`; one line "N deadlines need attention" linking to `/sales/deadlines`; styled like
  `TravelBookingCard`.

- [ ] **Step 1:** Implement.

### Task 8: Settings and import

**Files:** Create `sales/settings/page.tsx`,
`sales/_components/{StagesEditor.tsx,FieldsEditor.tsx,GeneralSettings.tsx,ImportPanel.tsx}`.

- Guard: caps.settings else redirect `/sales`.
- `StagesEditor`: per flow, rows (name fa / en, kind, action, owner role, required fields
  multi-select, active), move up / down, add.
- `FieldsEditor`: record fields and item fields (label fa / en, type, options, show in list, active).
- `GeneralSettings`: next record number, warning days, default validity days, document template.
- `ImportPanel`: Download template (`writeXlsx('BJ Contract', templateRows())` → Blob); choose
  file → `readXlsx` + `parseLedger` in the browser → summary (rows, errors, warnings), issues table
  (row, column, value, problem), unknown columns with "import as extra field" checkboxes, missing
  columns notice → Import → result counts; batches table with Remove (confirm dialog naming counts).

- [ ] **Step 1:** Implement. `tsc` + `lint` clean.

### Task 9: Reports

**Files:** Create `sales/reports/page.tsx`, `sales/_components/ReportsView.tsx`.

- Guard caps.reports. Sections: pipeline by stage (count, value per currency with prices),
  results by customer / by year, price history search (caps.prices), deadline performance. Each
  table has "Download CSV" via `buildCsv`.

- [ ] **Step 1:** Implement.

### Task 10: Verify, document, ship locally

- [ ] **Step 1:** `npm run lint`, `npm run test:unit`, `npx tsc --noEmit`, `npm run build` — all clean.
- [ ] **Step 2:** Docs: `REQUIREMENTS.md` FR-94, `DATA_MODEL.md` (module section),
  `PERMISSIONS.md` (seven keys, function-only access), `CHANGELOG.md`, `TASKS.md`, `PLAN.md`
  roadmap line, `CLAUDE.md` (status line + gotchas), `AGENT-LOG.md`.
- [ ] **Step 3:** Commit on `feat/erp-sales-module` (no push: a push to `main` deploys).
- [ ] **Step 4:** Local stack `:3501` (`bj-approvals-finance`): `pg_dump -Fc` of `postgres` to the
  scratchpad, `bj_apply_migrations`, sync View-as hook, rebuild app, restart rest,
  `/api/health` 200. As the admin JWT in SQL: `app_sales_bootstrap()` returns flows; import of the
  sample is left to the owner in the UI.

---

## After review (2026-11-16) — what the build did differently

Two Opus subagents reviewed this plan and the spec. Adopted, and built:

- **Two migration files**, not one: `20261116200000_sales_tables.sql`, `20261116200100_sales_functions.sql`.
- Read functions are `stable` and never write or lock (View as, PostgREST read-only); companies
  are seeded by an `after insert` trigger, not by the bootstrap.
- Every write locks the record row first; the parent-node lock is gone.
- CHECK / cast failures are caught and re-raised as `sales: invalid input` (no row echo with prices).
- Record number: `greatest(setting, highest + 1)` under the settings row lock; editable on create.
- Import: per-row `begin … exception`, skip reasons returned, app-created records never
  overwritten, empty cells never overwrite, in-place guarantee / payment updates, name mapping
  (`p_people`), values gated by the importer's own `sales_prices` / `sales_bonds`, stage `code`.
- `sales_quote_lines` snapshot at submission; price history reads it.
- `sales_bonds.status` gains `void`; `sales_rfps.delivery_text`; `sales_stages.code`.
- `tests/sql/fr55-roles-permissions.sql` and `request-edit.sql` now expect 33 keys.
- Error rules: one per message in `lib/errors/db-error.ts`.
- Also touched: `manage/page.tsx` labels, `PermissionSection` `YES_NO_KEYS`, both icon maps,
  `next.config.ts` (`serverActions.bodySizeLimit: '4mb'`), root layout (strips the `sales`
  namespace), `home/page.tsx`.
- `createItemColumn` server action (create a column and show it at once).

Not built (stated in spec §15): SMS reminders, a customers screen, bulk unit creation.
