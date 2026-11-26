# Plan — ERP › Sales customer registry (FR-98)

Spec: `docs/specs/2026-11-26-sales-customer-registry-design.md` (read it first; § numbers below refer to it).
Worktree `/Users/amir/Workspace/bj-cust`, branch `feat/sales-customer-registry` from `origin/main` @ `749fd45`.
Read `CLAUDE.md` Gotchas (Sales ones especially) before any task.

**Who does what.** SQL that decides security / privacy / locking is done by the lead (Opus) inline.
Data entry, the import SQL against a precise contract, tests, and UI tasks go to Sonnet subagents
with the exact files below; the lead reviews every diff before the next task. Haiku is not used
(the remaining tasks all need Farsi / RTL / SQL judgement).

| # | Task | Owner | Depends |
|---|---|---|---|
| 1 | Schema migration + permissions catalog | lead | — |
| 2 | Province + city + category seed data | Sonnet (medium) | 1 |
| 3 | Core SQL functions (customer CRUD, lists, readers, records search, fixes to existing) | lead | 1 |
| 4 | Import SQL functions | Sonnet (high) | 3 |
| 5 | SQL test file + dry-run on a clone | Sonnet (medium) → lead fixes SQL | 2–4 |
| 6 | `schema.sql`, TS types, actions, pure libs + unit tests, **all** messages fa+en | lead | 5 |
| 7 | Customer form, picker, Customers tab, Customer page | Sonnet (medium) | 6 |
| 8 | Names by locale everywhere + record form by id | Sonnet (medium) | 6 (parallel with 7) |
| 9 | Settings › Customer lists | Sonnet (medium) | 7 |
| 10 | Import dialog + template | Sonnet (medium) | 7 (parallel with 9) |
| 11 | Verify: tsc, lint, unit, build, browser on `:3501`, e2e | lead | 7–10 |
| 12 | Docs + PR + Opus review + merge | lead | 11 |

Parallel UI tasks touch disjoint files; messages are written once in Task 6 so no two agents edit
`messages/*.json`. While a parallel agent runs, `tsc` errors in files outside a task's own list are
the other agent's — ignore them.

---

## Task 1 — Schema migration (lead)

File `supabase/migrations/20261126100000_sales_customer_registry.sql`:
- `iran_provinces`, `sales_cities`, `sales_contractor_categories`, `sales_customer_contacts` (spec §4), RLS on, `revoke all … from public, anon, authenticated`.
- `sales_customers`: new columns, `name_en_key` partial unique index, composite FK to cities, contractor CHECK, `missing text[] not null default` (computed in the same migration for existing rows), `import_batch_id … on delete set null`.
- `sales_import_batches_kind_check` + `'customers'`.
- `private.sales_word_key(text)` (must equal TS `nameKey`: digits fa/ar → ascii, lower, ي→ی ك→ک, drop ZWNJ, drop every non letter/digit) and `private.sales_words(text) returns text[]`.
- `private.sales_customer_missing(uuid)` + triggers (BEFORE ins/upd on customers computing from NEW + contact count; AFTER ins/upd/del on contacts updating the parent's `missing` only — must not bump `updated_*`).
- Permission keys `sales_customers`, `sales_customers_import`: redefine `private.permission_keys/allows/deps` (copy current bodies from `schema.sql`, add the two). Transition grant: `insert into role_permissions … select role_id,'sales_customers','edit' where key='sales' and level='edit'` (check the real column names in `schema.sql`).
- `lib/permissions/catalog.ts`: `PermKey`, section `sales`, `SHAPES` (both `E`), `DEPENDENCIES`; header comment count. Count asserts 35 → 37: `tests/unit/permissions-catalog.test.ts` (2 places), `tests/sql/fr55-roles-permissions.sql:148` (`'35:3'` → check meaning), `tests/sql/request-edit.sql:214`, `tests/sql/sales.sql:102`.

## Task 2 — Seed data (Sonnet, medium)

File `supabase/migrations/20261126100100_sales_customer_seed_lists.sql`:
- `insert into public.iran_provinces(code,name_fa,name_en,position)` — all 31 provinces, 2-letter codes (lead gives the code list in the prompt).
- `create function private.sales_seed_customer_lists(p_company uuid) returns void` — inserts the 9 categories (spec §4, fa + en, positions 1–9) and the county seats of every province (Farsi official spelling, English common transliteration), `on conflict do nothing`, `name_key = private.sales_word_key(name_fa)`.
- `select private.sales_seed_customer_lists(id) from public.companies;`
- Append the same call to `supabase/seed.sql` right after the company insert.
- Self-check: every province has ≥ 1 city, its capital is present, no duplicate `name_key` within a province.

## Task 3 — Core SQL (lead)

File `supabase/migrations/20261126100200_sales_customer_functions.sql` (spec §4.1, §5, §6, §8, §10):
`app_sales_customer_lists`, `app_sales_save_customer`, `app_sales_add_customer` (wrapper),
`app_sales_save_category`, `app_sales_save_city`, `private.sales_customer_lock`,
`private.sales_customer_name_free`, changed `private.sales_customer`, `app_sales_save_record`
(ids + lock order), `app_sales_merge_customers`, `app_sales_rename_customer`,
`app_sales_remove_batch`, `app_sales_customer` (same signature), `private.sales_customer_rows`
(+ `p_private`, `name_en`, `missing`, `incomplete` filter), `private.sales_filter_check`,
`app_sales_bootstrap` (caps, customers `name_en`/`incomplete`, batches filter),
`private.sales_rfp_json`, `app_sales_list_page` (AND word search), `app_sales_deadlines`,
`app_sales_price_history`, `app_sales_metrics`, `app_sales_report` (`*_name_en`). Each redefined
function starts from its **current** body in `schema.sql`, never from an older migration.

## Task 4 — Import SQL (Sonnet, high)

File `supabase/migrations/20261126100300_sales_customer_import.sql`. Contract given in the
prompt (spec §9 + the helper names from Task 3): `app_sales_customer_import_preview(p_rows jsonb)`,
`app_sales_customer_import(p jsonb)`, `app_sales_customer_batches()`,
`app_sales_remove_customer_batch(p_id uuid)`. Must reuse Task 3 helpers for validation so the
form and the import accept exactly the same values.

## Task 5 — SQL tests (Sonnet, medium)

`tests/sql/sales-customer-registry.sql` per spec §11, same harness as `tests/sql/sales.sql`
(copy its prelude). Dry run on a clone of the `:3501` DB (CLAUDE.md "Dry-run migrations first"):
apply the four migrations, then run the new file **and** `sales*.sql`, `fr55-roles-permissions.sql`,
`request-edit.sql`. Report failures with the SQL error; the lead fixes function bugs.

## Task 6 — Glue (lead)

- `supabase/schema.sql`: diff dumps of the clone before / after the migrations, patch only those hunks.
- `lib/supabase/types.ts` (hand-edited): new functions' Args/Returns.
- `lib/sales/types.ts`: `CustomerRef` + `name_en`, `incomplete`; `CustomerProfile`, `CustomerContact`, `CustomerLists`, `CustomerImport*`; caps; `*_name_en` on rows.
- `lib/actions/sales.ts`: `getCustomerLists`, `saveSalesCustomer` (maps `sales: duplicate name` + `hint` → `{ok:false, duplicate:{id,name}}`), `saveSalesCategory`, `saveSalesCity`, import preview/commit/batches/remove.
- `lib/errors/db-error.ts`: `salesDuplicateName`, `salesUnknownCustomer`.
- `lib/sales/customerSearch.ts` (+ unit test incl. the shared fold fixture): `matchAllWords`, `matchAnyWords` (stopwords), and `filterCustomers` moved to use it; `lib/sales/customerLabel.ts`.
- `messages/fa.json` + `en.json`: every key Tasks 7–10 need (listed in their prompts), permission labels.

## Task 7 — Customer UI (Sonnet)

New `_components/CustomerForm.tsx` (dialog, spec §7), `CustomerCombo.tsx` (word search, labels,
Incomplete tag, Create → CustomerForm, `allowCreate` from `boot.caps.customers`),
`CustomersList.tsx` (Add button, tag, `incomplete` filter), `CustomerView.tsx` (profile card,
contacts, Edit), `customers/page.tsx`, `customers/[id]/page.tsx` (pass lists / caps).

## Task 8 — Names + ids (Sonnet)

`customerLabel` in RecordsTable, RecordView/RecordPanels/StageBody, DeadlinesList, ReportsView (+CSV),
`lib/sales/reports.ts` (group by id). RecordForm + StageFields + `stagePages.draftFrom` send
`buyer_id` / `client_id`.

## Task 9 — Settings › Customer lists (Sonnet)

`SettingsView.tsx` new section `customerLists`: categories and cities (by province) — add,
rename fa/en, hide/show, category order. Pattern: the currencies editor in the same file.

## Task 10 — Import dialog (Sonnet)

New `_components/CustomerImport.tsx` + `lib/sales/customerImport.ts` (template rows, header
detection, cell → value words fa/en; unit tests). Button in `CustomersList.tsx`
(`boot.caps.customers_import`).

## Task 11 — Verify (lead)

`npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`. Apply migrations to the
`:3501` DB (pre-dump first), run the branch app there, check in the browser: add a draft customer,
complete it, picker create path, English labels, records search by two words, import a 3-row file
with a match and an unknown category, remove the batch. e2e spec `tests/e2e/sales-customers.spec.ts`.

## Task 12 — Docs, PR, review, merge (lead)

REQUIREMENTS FR-98, DATA_MODEL, PERMISSIONS, CHANGELOG, TASKS, CLAUDE.md gotchas (one line each),
AGENT-LOG. PR → Opus 5.5 (high) review subagent → fix → merge (owner asked; merge deploys to Liara,
migrations run there).

---

## Changes after plan review (2026-11-26)

- **Seeding:** company lists are seeded from `private.sales_ensure(company)` (runs on every company
  insert via `companies_seed_sales`, and lazily) — guarded by "company has no category / no city
  yet" so renamed or hidden entries are never re-added. Task 2's migration only calls it for
  existing companies; **no `seed.sql` edit**. `sales_ensure` is redefined in Task 3 from its full
  current body.
- **Task 3 also redefines** `app_sales_import` (ledger) and `app_sales_import_inquiries` (customer
  lock at start, new `private.sales_customer` semantics; they never stamp `import_batch_id` on
  customers — that column is for customer imports), and `app_sales_similar_customers` (returns
  `name_en`; the registration duplicate list = client-side any-word match over `boot.customers`
  merged with this typo check).
- **`updated_by`** is stamped on create too by `app_sales_save_customer` / `app_sales_add_customer`
  (so a hand-made draft is never removed with an old import batch).
- **Old-app test:** a user with only `sales=edit` + `sales_customers` still creates a customer through
  the record save text path; old inserts `(company_id, name, name_key, kind)` with
  `on conflict … do update` pass the triggers.
- Task 1 also: `PermissionSection.tsx` `YES_NO_KEYS`, the catalog unit test's section/dependency
  assertions, `tests/e2e/_sales.ts` `SalesPerm`. Unit tests read `schema.sql`: run them only after Task 6.
- **Messages:** Task 6 creates the namespaces `sales.customerForm`, `sales.customerProfile`,
  `sales.customerImport`, `sales.customerLists` with the keys the lead can foresee; a UI agent
  adds keys **only inside its own namespace**, fa + en together. Agents run so no two edit
  `messages/*.json` at the same time.
- **Task 7 split:** 7a `CustomerForm` + `CustomerCombo` (fixes the combo's prop contract);
  7b CustomersList, CustomerView, pages. Order: 7a → (7b ∥ 8) → (9 ∥ 10). Task 9 needs only 6.
- **View as** goes into every UI prompt (Add, Edit, Import, every "Create …", Settings editors).
- **Task 4 contract** is written below once Task 3 exists (helper signatures + JSON shapes).
- **Task 11 stack:** dry-run on a clone of `bj-approvals-finance-db-1` first (check its migration
  ledger = `origin/main`'s); then pre-dump, apply to the `:3501` DB, and run the app from
  `../bj-cust` with a compose copy of `compose-sales` pointing at `bj-cust` (keeps the
  `sales-files` volume). Anything found after applying = a new migration file.
- CLAUDE.md "35 since annual borrowing" → 37.

## Task 4 contract (written after Task 3)

Helpers already in `20261126100200_sales_customer_functions.sql` (reuse, do not copy):
`private.sales_customer_lock(company)`, `private.sales_clean(text)`, `private.sales_phone(text)`,
`private.sales_customer_find(company, name) → uuid` (alias → Farsi key → English key),
`private.sales_customer_name_clash(company, key, self) → uuid`, `private.sales_customer_values(company, jsonb)
→ sales_customers row` (validates name, name_en, kind, ceo_name, province_code, city_id, address, rank, category_id;
raises `sales: invalid input`), `private.sales_customer_set_contacts` (replace all — the import must ADD one instead),
`private.sales_word_key(text)`, `private.sales_name_key(text)`.

**Input rows** (`p_rows`, array, 1–1000 objects; every value a string or absent, as read from the file):
`row` (file row number, integer), `name`, `name_en`, `kind`, `ceo_name`, `province`, `city`, `address`,
`rank`, `category`, `contact_person`, `contact_title`, `contact_label`, `phone`, `email`.

**Word lists** (compared with `sales_word_key`): kind `government|دولتی` / `contractor|پیمانکار`;
label `office|دفتر` / `mobile|موبایل|همراه` / `fax|فکس|نمابر` / `other|سایر|دیگر` (empty label + a phone → office);
province = `code`, `name_fa` or `name_en` of `iran_provinces`; city = `name_fa` / `name_en` of an **active**
`sales_cities` row of the resolved province; category = `name_fa` / `name_en` of an active category.
Rank: `1`–`5` (Persian digits allowed).

**`private.sales_customer_import_resolve(company, rows) returns jsonb`** (stable; used by both functions):
```
{ "rows": [ { "row": 3, "status": "new" | "match" | "error", "error": null | "no_name" | "duplicate_in_file",
              "match": null | {"id","name","name_en"},
              "values": {name, name_en, kind, ceo_name, province_code, city_id, address, rank, category_id},
              "contact": null | {person, title, label, phone, email},
              "dropped": [ {"field": "kind", "reason": "invalid" | "unknown" | "duplicate" | "not_contractor"} ],
              "unknown": [ {"field": "city" | "category", "key": "<word key>", "value": "<as typed>"} ],
              "incomplete": true } ],
  "unknown": { "categories": [ {"key","value","rows"} ], "cities": [ {"key","value","province_code","rows"} ] },
  "counts": { "new", "match", "error" } }
```
- Match = `sales_customer_find(name)`, else `find(name_en)`. Two file rows resolving to the same customer
  or the same new Farsi key → the later one `duplicate_in_file`.
- Bad value → left out of `values`, listed in `dropped` (rank / category on a non-contractor → `not_contractor`).
  An English name that `name_clash`es with another customer → dropped `duplicate`.
- Contact kept only when person and a valid phone (`^\+?[0-9]{5,15}$` after `sales_phone`) are present;
  bad email → dropped, contact kept without it. Any contact problem → `dropped` with field `contact`.
- `incomplete` = the row's resulting customer would still miss a required field (for a match: after the
  chosen action — preview reports it for a plain create).
- City unknown when the province resolved but no city matched; province unknown → dropped `unknown`
  (provinces are fixed). `unknown` lists are distinct by key (cities by province + key) with row counts.

**`app_sales_customer_import_preview(p_rows jsonb) returns jsonb`** — stable, gate
`private.sales_company('sales_customers_import','edit')`; returns the resolve result. No writes, no locks.

**`app_sales_customer_import(p jsonb) returns jsonb`** — gate as above; `perform sales_customer_lock`
first. `p = { file_name, rows, default_action: "skip"|"update"|"overwrite", actions: {"<row>": action},
categories: {"<key>": {"action":"create"} | {"action":"use","id":"<uuid>"} | {"action":"empty"}},
cities: {"<province_code>|<key>": same} }` (missing decision = empty).
1. Create the `create` categories / cities (same rules as `app_sales_save_category` / `_city`; an
   existing key is reused), then **re-run resolve** with the new lists + `use` mappings applied.
2. Insert a `sales_import_batches` row (`kind='customers'`, `file_name`, `created_by`, counts at the end).
3. `new` → insert the customer from `values` (through `sales_customer_values`), `import_batch_id` = batch,
   `updated_by` / `updated_at` left **null**; then add its contact.
   `match` → action `skip` | `update` (set only columns that are null now; city only together with its
   province or when the province already equals; rank / category only when the resulting kind is contractor)
   | `overwrite` (every non-empty file value replaces; `name` never changes). Validate the merged row with
   `sales_customer_values`; set `updated_at = now(), updated_by = auth.uid()`. Add the contact unless the
   customer already has that phone or 50 contacts. `error` rows → skipped.
4. Catch `check_violation | not_null_violation | foreign_key_violation | unique_violation` around writes
   and re-raise `sales: invalid input` (never echo values).
5. Return `{batch_id, created, updated, skipped, incomplete, dropped}` (`incomplete` = created/updated
   customers whose `missing` is non-empty afterwards).

**`app_sales_customer_batches() returns jsonb`** — stable, gate import: kind `customers` batches, newest
first: `{id, file_name, created_at, created_by_name, created_count, updated_count, skipped_count, remaining}`
(`remaining` = customers with this `import_batch_id`).

**`app_sales_remove_customer_batch(p_id uuid) returns jsonb`** — gate import; lock; delete customers with
this `import_batch_id` and `updated_by is null`, used by no record (buyer or client, deleted records too)
and target of no alias; delete the batch row when no customer points at it any more; return
`{removed, kept}`. Refuse a batch that is not `kind='customers'` (`sales: not found`).

Grants: `revoke all … from public, anon` + `grant execute … to authenticated` for the four public
functions; `revoke all … from public, anon, authenticated` for the private one.
