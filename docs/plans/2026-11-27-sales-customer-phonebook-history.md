# Sales customer phone book + change history (FR-99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log every ERP › Sales write (who / when / old → new) with History tabs + a Sales › Activity page, and turn the customer CEO + contacts into a phone book of key people with titles from a list, an activity description, and a third company type Private.

**Architecture:** New append-only table `sales_audit` written explicitly by every Sales write function through `private.sales_log` (records keep `sales_events`). Customer phone book = existing `sales_customer_contacts` (entries) + new `sales_customer_phones` (numbers) + new list `sales_contact_titles`. Two forward-only migrations (history first, phone book second, which redefines the customer functions with logging built in). UI: Next.js client components in `app/[locale]/(app)/sales/_components/`.

**Tech Stack:** Next.js 16 App Router, TypeScript, next-intl (fa default RTL + en), self-hosted Supabase (Postgres function-only API, `security definer`), Vitest, psql SQL tests.

**Spec:** `docs/specs/2026-11-27-sales-customer-phonebook-history-design.md` (read it — §11 holds the review amendments, they override earlier sections).

## Global Constraints

- Read `CLAUDE.md` first; every gotcha there applies. Worktree `/Users/amir/Workspace/bj-cust`, branch `feat/sales-customer-phonebook`. Do not commit (the lead commits).
- Migrations only in `supabase/migrations/`; frozen once any DB applied them. Dry-run on a clone (Task 0), never on db `postgres` of `bj-approvals-finance-db-1`.
- Every SQL function: `security definer`, `set search_path to ''`, schema-qualified names; `revoke all on function … from public` for every new `private.*` function (and `grant execute … to authenticated` for new `public.app_*`, matching neighbours).
- Writes re-raise `check_violation / not_null_violation / foreign_key_violation / invalid_text_representation / numeric_value_out_of_range / string_data_right_truncation` as `sales: invalid input` (errcode 22023), `unique_violation` as `sales: duplicate name` (23505).
- Lock order: `private.sales_customer_lock(company)` before any `sales_rfps` row lock.
- Readers `stable`, no writes, no locks (View as runs them read-only).
- Private customer fields: `ceo_name`, `ceo_phone`, `address`, phone book (`people`). Only `sales_customers` holders see their values — in profiles, history bodies, Activity rows, errors.
- Kinds: `government | contractor | private`. Rank / category allowed for `contractor` and `private`.
- Permission key `sales_activity`, shape `R`, needs `sales`; catalog count **37 → 38** in `tests/unit/permissions-catalog.test.ts`, `tests/sql/fr55-roles-permissions.sql`, `tests/sql/request-edit.sql`, `tests/sql/sales.sql`.
- UI: Blueprint (`docs/DESIGN.md`): `className="data-table"` on tables, tabs from `lib/ui/tabs.ts`, no `shadow-*`, no `text-[Npx]`, Save buttons `pending={…}`, `useTranslations('sales')` (namespace only reaches `/sales`), names via `customerLabel`, hide every write control under View as (`useViewAs()`).
- All copy fa + en; Farsi first. Message keys are written by Task 3 only; UI tasks never edit `messages/*.json`.

## Review Focus

1. A Sales user **without** `sales_customers` opens a customer's History after someone edited the CEO phone → sees "Private details changed", never the number (also on Activity, merge and import rows). Test: Task 2 `privacy` block.
2. Un-marking a deadline done (`app_sales_set_deadline_done(…, false)`) on an automatic deadline stays un-marked and logs one event. Test: Task 1 `deadline_done` block.
3. Editing a customer with 20 phone-book entries and changing one number logs **one** people change, not 20. Test: Task 2 `diff_people` block.
4. The old app (during deploy swap) saves a customer without `people` / `ceo_phone` / `activity` keys → those stay as they were. Test: Task 2 `swap_compat` block.
5. A Government customer with an activity description and one phone, CEO, names, address is **complete**; a Contractor with only a half pair (rank, no category) and no description is missing `category` and `grade_or_activity`. Test: Task 2 `missing` block + Task 3 unit mirror.

## Plan review amendments (2026-11-27) — OVERRIDE the task text below where they differ

A1. **Deadline event body** = `{deadline: {label, kind}, done: boolean}` (kind `edit`; `label` may be null — automatic deadlines only have `kind`). `ActivityLog.tsx` (owned by **Task 5**) renders it before the generic edit case with `event.deadlineDone` «موعد «{name}» انجام شد» / "Deadline “{name}” marked done" and `event.deadlineUndone` «موعد «{name}» باز شد» / "Deadline “{name}” reopened" (`name` = label or the `deadline.kind.*` label).
A2. **Record rows on the Activity page** use simple labels: `historyLine(row)` returns a full key under the `sales` namespace — `history.action.<action>` for audit rows, `event.<kind>` for `source:'record'` rows (`edit` → `event.edit` with `count` = changes length; `comment` → text; `stage` → `history.recordStage` «جابه‌جایی مرحله» / "Stage changed"; others the existing `event.*` keys with the minimal values they need; unknown → `history.recordOther` «تغییر پرونده» / "Record changed"). No `boot` needed.
A3. **Customers tab search matches activity:** Task 2 adds `activity` to `private.sales_customer_rows` output; Task 3 adds `activity: string | null` to `CustomerSummary` and to the searched fields in `lib/sales/customers.ts` `searchCustomers`.
A4. **Task 7 also owns** `FilterBar.tsx` (Private kind option) and `CustomersList.tsx` (`useIncompleteHint` falls back to `customerMissing.unknown` for keys `t.has` doesn't know).
A5. **`customer/alias_added`** is logged wherever a customer alias row is inserted (grep `insert into public.sales_name_aliases` with kind `customer`: save_customer name change, rename, merge, Name matching) — Task 2 owns all of them.
A6. **Task 3 also edits `lib/supabase/types.ts`** (hand-edited RPC list): `app_sales_customer_history`, `app_sales_product_history`, `app_sales_activity`, `app_sales_save_title`; and adds `activity: boolean` to `SalesCaps`.
A7. **Extra messages (Task 3):** `customerImport` accepted-values help: update the existing kind help to list `خصوصی`/Private and the title help to say titles must match the list; `customerProfile.numbers` «شماره‌ها» / "Numbers"; A1 and A2 keys. Permission label at `permissions.items.sales_activity.{label, description}` (not "hint").
A8. **Product snapshot** keys: `{name_fa, name_en, code, active, position, fields}`; Task 1 product test asserts `field:'name_fa'`; `history.field.*` product keys `name_fa, name_en, code, active, position`.
A9. **Import template:** the two new columns are **appended after Email** (old 14-column order unchanged, so old templates still detect their header); header detection accepts 14 or 16 columns. Header labels are `customerImport.headers.ceo_phone` / `customerImport.headers.activity`; the `EXAMPLE` rows get both keys.
A10. **Import title decisions** use the existing `ImportListDecision` shape: request `titles: Record<string, {action:'use', id:string} | {action:'empty'}>`; SQL refuses `{action:'create'}` for titles (`sales: invalid input`); absent = empty. Preview types: `unknown.field` union adds `'title'`; row `values` adds `ceo_phone`, `activity`; `contact` becomes `CustomerImportEntry = { name: string|null; title_id: string|null; email: string|null; phones: { label; phone }[] } | null`.
A11. **Existing names:** the type is `CustomerMissingKey` (not `MissingKey`); keep the helper name `missingKeys(input)` (update its rules; no `lists` arg) instead of a new `missingOf`; `customerForm.kind` already exists — do not add it; `saveContactTitle` returns `Saved<ContactTitle>` through `duplicateOr`, like `saveSalesCategory`.
A12. **Activity gate:** `private.sales_company('sales_activity','read')` (raises `sales: not allowed`). Tests assert `sales: not allowed`.
A13. **Kind literals** outside `CustomerKind` (`lib/sales/types.ts` ~134, 355, 371; `addSalesCustomer` in `lib/actions/sales.ts`) switch to `CustomerKind`.
A14. **Each SQL test file builds its own fixtures** (Task 2's file defines its own `act` user).
A15. **Catalog counts (Task 1):** 37 → 38 in `tests/unit/permissions-catalog.test.ts` (both asserts, ~24 and ~218), `tests/sql/fr55-roles-permissions.sql`, `tests/sql/request-edit.sql`, `tests/sql/sales.sql`, **`tests/sql/sales-customer-registry.sql:135`**; `tests/sql/sales.sql:111` deps needing `sales` 7 → 8. CLAUDE.md count note → Task 9.
A16. **`private.sales_customer_missing_of`:** keep the signature and the parameter name `p_contacts integer` (`create or replace`), but callers pass the **phone count**; comment says so.
A17. **Creation source without changing `private.sales_customer`'s signature:** Task 1's `app_sales_import` / `app_sales_import_inquiries` call `set_config('bj.sales_source', '<ledger_import|inquiry_import>:<batch uuid>', true)` at their start; Task 2's `private.sales_customer` reads `current_setting('bj.sales_source', true)` (empty → `record`) for the `created` body `{source, batch_id?}` and sets `created_by`.
A18. **Hidden title rule** in `set_people`: a `title_id` is accepted when the title is active, **or** it is among the title ids used on this customer's entries **before** the save (read before the delete).
A19. **Task 2 also edits `tests/sql/sales-history.sql`** coverage lists (`app_sales_save_title` → logs, `app_sales_customer_history` → readonly).
A20. **Migration data check (Task 2 Step 4):** make a second clone `x_fr99b` from `x_fr99` after Task 1's migration, insert old-shape contacts (a Farsi title matching the seed, one matching an English seed name, one unmatched, one with null title) on two customers, apply migration 2, assert each contact has exactly one phone row and the expected title ids (unmatched one added to the list), then drop `x_fr99b`.
A21. **`app_sales_save_title`** takes `private.sales_customer_lock(company)` first (like `save_category`).
A22. **`HistoryList.tsx` is created by Task 3** (not Task 5), so Tasks 5 and 6 can run in parallel. Signature as in Task 5's Produces.
A23. **Task 4 keeps `CustomerForm`'s props unchanged** (`CustomersList`, `CustomerCombo`, `CustomerView` render it).

---

### Task 0: Clone DB for dry runs (lead) — done 2026-11-27

- [x] Docker VM disk was at 100% (`could not write init file`); `docker builder prune -f` freed 2 GB. Check `docker exec bj-approvals-finance-db-1 df -h /` before any rebuild or clone.

- [ ] `docker exec bj-approvals-finance-db-1 psql -U supabase_admin -d postgres -c "create database x_fr99"` then `docker exec bj-approvals-finance-db-1 sh -c 'pg_dump -U supabase_admin -Fc -d postgres | pg_restore -U supabase_admin -d x_fr99 --no-owner'` (only pg_cron / graphql errors allowed).
- [ ] Baseline schema dump for the later diff: `docker exec bj-approvals-finance-db-1 pg_dump -U supabase_admin -s -d x_fr99 > /private/tmp/claude-501/fr99/before.sql`.
- [ ] Run one existing test to prove the clone works: `docker exec -i bj-approvals-finance-db-1 psql -U supabase_admin -d x_fr99 -v ON_ERROR_STOP=1 < tests/sql/sales-customer-registry.sql` → ends with `ROLLBACK`, no error.

Apply a migration to the clone the same way (`< supabase/migrations/<file>`). If a migration must be fixed after applying it to `x_fr99`, drop and re-clone (`drop database x_fr99` …) — never patch the applied state by hand.

---

### Task 1: History infrastructure + logging for records, products, settings, imports (SQL)

**Files:**
- Create: `supabase/migrations/20261127100000_sales_history.sql`
- Create: `tests/sql/sales-history.sql`
- Modify: `supabase/schema.sql` (patch hunks from the clone diff), the four catalog-count files (37 → 38), `lib/permissions/catalog.ts` (key + section + shape + dep — SQL and TS must agree, `tests/unit/permissions-catalog.test.ts` compares them)

**Interfaces — Produces:**
- Table `public.sales_audit(id uuid pk default gen_random_uuid(), company_id uuid not null, at timestamptz not null default clock_timestamp(), actor_id uuid, entity text not null check (entity in ('customer','product','settings','import')), entity_id uuid, entity_label text, action text not null, body jsonb not null default '{}')`, RLS on, no grants, no FK on `company_id`; indexes `(company_id, at desc, id)`, `(company_id, entity, entity_id, at desc)`, `(company_id, actor_id, at desc)`. Trigger `sales_audit_append_only` (before update or delete, for each row) raises `sales: history is read-only` unless `current_user in ('supabase_admin','postgres')`.
- Indexes on `sales_events`: `(company_id, at desc, id)`, `(company_id, actor_id, at desc)`.
- `private.sales_log(p_company uuid, p_entity text, p_entity_id uuid, p_label text, p_action text, p_body jsonb default '{}') returns void` — inserts with `actor_id = auth.uid()`.
- `private.sales_diff(p_before jsonb, p_after jsonb, p_private text[] default '{}') returns jsonb` — array `[{field, from, to}]` over the union of top-level keys whose values differ (`is distinct from`), keys in `p_private` get `"private": true`; keys ending in `_id` are skipped when a sibling `<name>` key carries `{id,name}` (callers pass `{id,name}` objects for list refs).
- `private.sales_strip_private(p_body jsonb, p_private boolean) returns jsonb` — when `p_private` is false: recursively, every object key in `('ceo_name','ceo_phone','address','people','contacts')` is replaced by `true` under key `private_changed`, and every array element object with `"private": true` loses `from` / `to`; a body with any stripped part gets `"private_changed": true` at top level. Returns the body unchanged when `p_private`.
- `public.app_sales_product_history(p_id uuid) returns jsonb` (stable, `sales` read): array of `{id, at, actor_id, actor_name, action, body, entity_label}` newest first, max 500.
- `public.app_sales_activity(p jsonb) returns jsonb` (stable, `sales_activity` read; refuse otherwise with the module's usual `sales: forbidden`): keys `actor uuid?`, `from date?`, `to date?` (Asia/Tehran days, inclusive), `entity text?` in `record|customer|product|settings|import`, `before jsonb?` = `{at, id}` cursor. Returns `{rows: [...], next: {at,id}|null}`, 50 per page, union of `sales_events` (`source:'record'`, `entity:'record'`, `entity_id = rfp_id`, `entity_label = record_no || ' · ' || title`, `action = kind`, excluding `kind = 'import'`, excluding records with `deleted_at` unless caller is admin) and `sales_audit` (`source:'audit'`), ordered `at desc, id desc`; every row `{source, id, at, actor_id, actor_name, entity, entity_id, entity_label, action, body, exists boolean}`; bodies passed through `sales_strip_private(body, private.sales_can('sales_customers','edit'))`.
- `app_sales_bootstrap().caps.activity` = `private.sales_can('sales_activity','read')`.
- Permission `sales_activity` in `private.permission_keys`, `permission_allows` (read only), `permission_deps` (needs `sales`). No role granted.

**Logging added (redefine each function, keep all existing behaviour; copy the current body from `supabase/schema.sql`):**

| Function | Log call |
|---|---|
| `app_sales_save_product` | `product` / `created` or `edited`, body `{changes: sales_diff(before, after)}` over `{name, code, unit, active, fields…}` snapshot (`private.sales_product_snapshot(id) returns jsonb`, new) |
| `app_sales_delete_product` | `product` / `deleted`, label = name |
| `app_sales_save_currency`, `app_sales_delete_currency` | `settings` / `currency`, body `{op, name, changes}` |
| `app_sales_save_stage`, `app_sales_order_stages` | `settings` / `stage` (`{op, name, changes}`), `stage_order` (`{flow, order:[names]}`) |
| `app_sales_save_field` | `settings` / `field` |
| `app_sales_save_settings` | `settings` / `general`, `{changes}` |
| `app_sales_save_category`, `app_sales_save_city` | `settings` / `category` / `city`, `{op: created|edited|hidden|shown, name, changes}` |
| `app_sales_remove_alias`, `app_sales_match_person` | customer alias → `customer` / `alias_removed` (entity_id = target); person → `settings` / `name_match` `{op, name, profile_id, profile_name}` (match_person keeps its record events) |
| `app_sales_import`, `app_sales_import_inquiries` | one `import` / `ledger_import` / `inquiry_import` row per call, `entity_id = batch id`, body `{file, created, updated, …counts the function already returns}` |
| `app_sales_set_deadline_done` | direct `insert into public.sales_events (company_id, rfp_id, actor_id, kind, body)` kind `edit`, body `{side:'deadline_done', label, done}` — **not** `sales_touch` |

`app_sales_remove_batch` and all customer functions are Task 2's (it redefines them with logging).

- [ ] **Step 1: Write `tests/sql/sales-history.sql`** (copy the fixture header of `tests/sql/sales-customer-registry.sql`: company, admin, a `sales`-edit user `s1`, a `sales`-read-only user `r1`, a `sales_activity` user `act`). Blocks, one assertion statement each:
  - `coverage`: three literal text arrays `logs`, `readonly`, `exempt` (`exempt = {app_sales_file_begin, app_sales_file_abort}`); assert `select array_agg(proname)` of every `public.app_sales_%` / `app_project_%` function `minus` the union of the three lists is empty, and that each list name exists. (`readonly` = every `stable` one; the test also asserts every name in `readonly` has `provolatile = 's'`.)
  - `product`: s1 saves a product, edits its name, deletes it → 3 audit rows, actions `created, edited, deleted`, edited body `changes[0] = {field:'name', from:<old>, to:<new>}`.
  - `settings`: save currency, rename a category, hide a city, reorder stages → one audit row each with the expected `action` and `body->>'op'`.
  - `deadline_done`: on a record with an automatic deadline, mark done then un-mark → `done_at` null after the second call; 2 `sales_events` rows with `body->>'side' = 'deadline_done'`.
  - `activity_gate`: `r1` calling `app_sales_activity('{}')` → `ERROR` containing `sales:`; `act` gets rows; filter `entity:'product'` returns only product rows; `actor` filter returns only that actor; 60 rows → first page 50 + `next`, second page 10 + `next` null; record `import` events absent; a soft-deleted record's events absent for `act`, present for admin.
  - `append_only`: `as_scalar('s1', 'update public.sales_audit set action = ''x''')` → ERROR (no grant). Then, inside the test transaction (rolled back): `grant update, delete on public.sales_audit to authenticated;` and repeat `update` and `delete` via `as_scalar` → both `ERROR … sales: history is read-only` (the trigger, not the grant, refuses).
  - `strip`: `sales_strip_private('{"changes":[{"field":"ceo_phone","from":"1","to":"2","private":true}],"merged":{"ceo_name":"x"}}', false)` has no `"1"`/`"2"`/`"x"` text and `private_changed = true`; with `true` it is unchanged.
  - `bootstrap_cap`: `act` bootstrap `caps.activity = true`, `s1` false.
- [ ] **Step 2: Run on the clone** before the migration → fails at the first block (`sales_audit` missing).
- [ ] **Step 3: Write the migration** (one file; order: permission catalog rows, table + trigger + indexes, helpers, redefined functions, readers, bootstrap, grants/revokes).
- [ ] **Step 4: Apply to `x_fr99`, run `tests/sql/sales-history.sql` + every `tests/sql/sales*.sql` + `fr55-roles-permissions.sql` + `request-edit.sql`** → all end in `ROLLBACK` without error.
- [ ] **Step 5: Patch `supabase/schema.sql`**: `pg_dump -s` of the clone → diff against `before.sql` → apply only those hunks to `supabase/schema.sql` (skip pg_restore CHECK re-parenthesizing hunks). Save the dump as the new `before.sql` for Task 2.
- [ ] **Step 6: `lib/permissions/catalog.ts`** + `npx vitest run tests/unit/permissions-catalog.test.ts` → PASS.

---

### Task 2: Phone book, activity, Private kind, customer logging (SQL)

**Files:**
- Create: `supabase/migrations/20261127110000_sales_customer_phonebook.sql`
- Create: `tests/sql/sales-customer-phonebook.sql`
- Modify: `tests/sql/sales-customer-registry.sql` (contact inserts / assertions to the new shape; `missing` keys `contacts` → `phones`, rank/category → new rule), `tests/sql/sales-customers.sql` / `sales-name-matching.sql` only where they break, `supabase/schema.sql` (clone diff hunks)

**Interfaces — Consumes:** Task 1 `private.sales_log`, `private.sales_diff`, `private.sales_strip_private`.

**Interfaces — Produces:**
- `public.sales_contact_titles(id uuid pk, company_id uuid not null → companies, name_fa text 1–80, name_key text not null, name_en text null 1–80, active boolean not null default true, position integer not null default 0, created_at, created_by)`, unique `(company_id, name_key)`, RLS on, no grants. Seed (spec D6, in this order, position 1..12) for every company with none, and in `private.sales_ensure` for new companies (only while the company has no titles). Existing free-text `sales_customer_contacts.title` values: matched by `private.sales_name_key` against fa / en; unmatched distinct values inserted as new titles after the seed.
- `public.sales_customer_phones(id uuid pk, company_id uuid not null, contact_id uuid not null → sales_customer_contacts on delete cascade, label text not null check in (office,mobile,fax,other), phone text not null check '^\+?[0-9]{5,15}$', position integer not null)`, index `(contact_id, position)`, RLS on, no grants. Each existing contact's `(label, phone)` copied as position 1.
- `sales_customer_contacts`: `person` drop not null; add `title_id uuid → sales_contact_titles on delete restrict`; drop `title`, `label`, `phone` (after copying). Check: none — "not empty" is enforced in the writer.
- `sales_customers`: add `ceo_phone text check (ceo_phone is null or ceo_phone ~ '^\+?[0-9]{5,15}$')`, `activity text check (activity is null or char_length(btrim(activity)) between 1 and 1000)`, `created_by uuid`. Replace `sales_customers_kind_check` → `kind in ('government','contractor','private')`, `sales_customers_contractor_only` → `kind in ('contractor','private') or (rank is null and category_id is null)`. Backfill `created_by` from `sales_import_batches.created_by` via `import_batch_id`.
- `private.sales_customer_missing_of(c public.sales_customers, p_phones integer) returns text[]` (drop the old `(c, p_contacts)` one after the trigger switches): keys in order `name_en, kind, ceo_name, province, city, address, phones, rank, category, grade_or_activity` where `phones` = `c.ceo_phone is null and coalesce(p_phones,0) = 0`; `rank` = `category_id is not null and rank is null`; `category` = `rank is not null and category_id is null`; `grade_or_activity` = `not (rank is not null and category_id is not null) and c.activity is null`. `p_phones` = count of phone rows of the customer's entries. Triggers: existing `sales_customers` BEFORE trigger + AFTER trigger on contacts (delete / update customer_id) + new AFTER trigger on `sales_customer_phones` refresh the parent. Migration ends with `update sales_customers set missing = …` for all rows.
- `private.sales_customer_set_people(p_company uuid, p_customer uuid, p_people jsonb) returns void` (replaces `sales_customer_set_contacts`, which is dropped): array ≤ 50 of `{name?, title_id?, email?, phones: [{label, phone}] ≤ 5}`; entries with no name, no title and no phone are dropped; `title_id` must be an **active** title of the company **or** the title the entry already had (hidden titles stay) else `sales: invalid input`; phones via `private.sales_phone`, label default `office`; deletes + re-inserts entries and phones.
- `private.sales_customer_snapshot(p_id uuid) returns jsonb`: `{name, name_en, kind, rank, category:{id,name}, grades:[{rank, category}], province:{code,name}, city:{id,name}, address, ceo_name, ceo_phone, activity, people:[{name, title, email, phones:[{label,phone}]}]}` (names = fa).
- `private.sales_customer_log_diff(p_company uuid, p_id uuid, p_action text, p_before jsonb, p_extra jsonb default '{}')` — after-snapshot, `sales_diff(before, after, '{ceo_name,ceo_phone,address,people}')`; the `people` key is diffed per entry: `{field:'people', private:true, added:n, removed:n, changed:n, from:[changed/removed entries], to:[changed/added entries]}` (positions after save); no row written when the diff is empty and the action is `edited`.
- `private.sales_customer_profile(p_id, p_private)` returns, besides today's keys, `activity`, `created_at`, `created_by_name`, and when `p_private`: `ceo_name`, `ceo_phone`, `address`, `people: [{id, name, title_id, title_fa, title_en, title_active, email, phones:[{id,label,phone}]}]` (no `contacts` key).
- `app_sales_save_customer(p_id, p)`: keys `ceo_phone`, `activity`, `people` — **absent = keep** on update (create: absent = empty); old `contacts` key ignored; kind `private` accepted; `created_by` set on insert; logs `customer/created` (body `{changes: diff('{}', after)}`) or `edited`.
- `app_sales_add_customer`, `private.sales_customer` (record text path, ledger + inquiry import creation): set `created_by`, log `created` with `{source}` (`record|ledger_import|inquiry_import`, plus `batch_id` for imports); filling an empty kind logs `edited`.
- `app_sales_rename_customer` → `renamed` `{from, to}`; `app_sales_merge_customers` → `merged_into` on the removed id `{into_id, into_name, snapshot: <its snapshot>}` + `merged_from` on the kept id `{from_id, from_name, changes}`; merge moves entries with phones per spec §11.4, fills `ceo_phone` / `activity`, accepts `private` kind for rank/category.
- `app_sales_customer_import_preview` / `app_sales_customer_import` / `private.sales_customer_import_resolve` / `private.sales_customer_import_merge`: row cells add `ceo_phone`, `activity`; kind words add `خصوصی` / `private`; `contact_title` resolved against titles (fa / en name key) → unknown title values reported in `unknown.titles` (`{key, value, rows}`), resolved by request key `titles: {<key>: <title uuid> | null}`; absent decision = leave empty; no create. Contact person optional. The row's entry = `{name, title_id, email, phones:[{label, phone}]}` (phones empty when no valid number). Dedupe per spec §11.4. Logs: one `import/customer_import` row + `imported_created` / `imported_updated` per customer (diff) + `settings/category|city` `{op:'created', source:'import'}` for list entries it creates.
- `app_sales_remove_customer_batch` and `app_sales_remove_batch`: `import/batch_removed` `{kind, file, removed, kept}` + `customer/removed_by_import_undo` per deleted customer (label = name); `remove_batch` keeps its existing delete rule.
- `public.app_sales_save_title(p jsonb) returns jsonb` (`sales_settings` edit): `{id?, name_fa, name_en?, active?, position?}` → saved row `{id, name_fa, name_en, active, position}`; duplicate key → `sales: duplicate name`; logs `settings/title`.
- `app_sales_customer_lists()` adds `titles` (active ones ordered by position; all for `sales_settings` holders, with `active`).
- `public.app_sales_customer_history(p_id uuid) returns jsonb` (stable, `sales` read): rows of that id plus, recursively, ids found in its `merged_from` rows' `from_id`; shape as `app_sales_product_history` + `entity_id`; bodies stripped by `sales_strip_private(body, sales_can('sales_customers','edit'))`.
- `private.sales_filter_check`, `sales_customer_values`, `sales_customer_set_grades`, grades trigger: accept `private` like `contractor`.

- [ ] **Step 1: Write `tests/sql/sales-customer-phonebook.sql`** (same fixture style; holder `h` = sales + sales_customers edit, reader `r` = sales read, settings user `st`). Blocks:
  - `save`: `h` creates a customer with CEO name + `ceo_phone '09121234567'`, 3 entries (named QC manager with 2 phones; named project manager without phone; company line with a fax) → profile `people` length 3, phones 2/0/1; an all-empty entry is dropped; 6 phones in one entry → `sales: invalid input`; hidden title on a new entry → invalid; hidden title kept on an existing entry → ok.
  - `missing`: government + description + phone + rest → `missing = '{}'`; government without description → contains `grade_or_activity`; contractor rank only → contains `category` and `grade_or_activity`; contractor with description only → no `grade_or_activity`; phones only via `ceo_phone` → no `phones`; private with rank+category → no `grade_or_activity`; kind change private → government drops grades and rank.
  - `swap_compat`: update with only `{name, kind}` keys keeps `people`, `ceo_phone`, `activity`.
  - `diff_people`: customer with 20 entries; change one number → exactly 1 new audit row, `body->'changes'` has one element with `field = 'people'`, `changed = 1`.
  - `privacy`: after `h` edits `ceo_phone`, `r`'s `app_sales_customer_history` text contains neither number and has `private_changed`; `h`'s contains both; `r`'s `app_sales_customer` has no `ceo_phone` / `people` keys; same for a merge row and an import row; `act` (Task 1 fixture user with `sales_activity` but not `sales_customers`) sees no numbers in `app_sales_activity`.
  - `migration`: (data seeded **before** applying the migration is not possible inside this test) — instead assert on the clone after migration in Task 2 Step 4 with a one-off query: every pre-existing contact has exactly one phone row and its old title mapped to a title id.
  - `titles`: seed count 12 per company; `st` creates / renames / hides via `app_sales_save_title`; `h` → forbidden; duplicate name → `sales: duplicate name`; `customer_lists.titles` for `h` excludes hidden.
  - `import`: preview of rows with `خصوصی`, `ceo_phone`, `activity`, an unknown title `مدیر ارشد` → `unknown.titles` has it; import with `titles:{}` → entry without title; with the title mapped to QC manager → `title_id` set; re-import (Update) of a phone-less named entry does not duplicate it; one `import/customer_import` + per-customer rows.
  - `merge`: A (entry with phone X, entry "Ali" no phone) into B (phone X, "Ali" same title) → B gains nothing duplicate; `ceo_phone` filled from A; B's history includes A's earlier `created` row.
  - `created_by`: record save text path (old app) creating a customer → `created_by` = caller, `customer/created` with `source:'record'`.
  - `batch_undo`: customer import then `app_sales_remove_customer_batch` → `removed_by_import_undo` rows + `import/batch_removed`.
- [ ] **Step 2: Run on `x_fr99`** (Task 1 migration applied) → fails at first block.
- [ ] **Step 3: Write the migration.** Order: titles table + seed (+ map existing titles), phones table + copy, contacts columns, customers columns + checks + backfill, functions (missing_of, triggers, set_people, snapshot, log_diff, profile, values, set_grades, grades trigger, filter_check, save, add, sales_customer, rename, merge, import resolve/merge/preview/import, remove batches, save_title, lists, history, sales_ensure), drop old functions, recompute `missing`, grants/revokes.
- [ ] **Step 4: Apply to `x_fr99`; migration check query** (every old contact → 1 phone row, titles mapped); **run all `tests/sql/sales*.sql`, `fr55-roles-permissions.sql`, `request-edit.sql`** → all `ROLLBACK`, no error. Fix the registry tests for the new shape (contacts inserted as entries + phones; `missing` keys).
- [ ] **Step 5: Patch `supabase/schema.sql`** from the clone diff (as Task 1 Step 5).

---

### Task 3: TS types, actions, pure helpers, messages, unit tests

**Files:**
- Modify: `lib/sales/types.ts`, `lib/actions/sales.ts`, `lib/sales/customerForm.ts`, `lib/sales/customerImport.ts`, `lib/sales/customers.ts`, `lib/sales/ledger.ts` (kind `private`), `messages/fa.json`, `messages/en.json`
- Create: `lib/sales/history.ts`
- Test: `tests/unit/sales-customer-form.test.ts` (update), `tests/unit/sales-history.test.ts` (new), `tests/unit/sales-customer-import.test.ts` (update if it exists, else the file that tests `customerImport.ts`)

**Interfaces — Produces:**
- `CustomerKind = 'government' | 'contractor' | 'private'`; `hasGrades(kind) = kind === 'contractor' || kind === 'private'` exported from `lib/sales/customers.ts`.
- `MissingKey` adds `'phones' | 'grade_or_activity'`, removes `'contacts'`.
- `CustomerPhone = { id?: string; label: 'office'|'mobile'|'fax'|'other'; phone: string }`; `CustomerPerson = { id?: string; name: string | null; title_id: string | null; title_fa?: string; title_en?: string | null; title_active?: boolean; email: string | null; phones: CustomerPhone[] }`; `CustomerProfile` gains `ceo_phone?`, `activity`, `people?`, `created_by_name`, loses `contacts`. `CustomerInput` gains `ceo_phone`, `activity`, `people`, loses `contacts`. `ContactTitle = { id; name_fa; name_en: string|null; active: boolean; position: number }`; `CustomerLists.titles: ContactTitle[]`.
- `HistoryRow = { id: string; at: string; actor_id: string | null; actor_name: string | null; entity: 'record'|'customer'|'product'|'settings'|'import'; entity_id: string | null; entity_label: string | null; action: string; body: Record<string, unknown>; source?: 'record'|'audit'; exists?: boolean }`; `ActivityPage = { rows: HistoryRow[]; next: { at: string; id: string } | null }`; `ActivityFilters = { actor?: string; from?: string; to?: string; entity?: HistoryRow['entity']; before?: { at: string; id: string } }`.
- Actions (each `requireCaller` first, like neighbours): `getCustomerHistory(id: string): Promise<Read<HistoryRow[]>>` → `app_sales_customer_history`; `getProductHistory(id)` → `app_sales_product_history`; `listSalesActivity(f: ActivityFilters): Promise<Read<ActivityPage>>` → `app_sales_activity`; `saveContactTitle(input: { id?: string; name_fa: string; name_en?: string|null; active?: boolean; position?: number }): Promise<Read<ContactTitle>>` → `app_sales_save_title`.
- `lib/sales/customerForm.ts`: `PersonRow = { name: string; title_id: string; email: string; phones: { label: CustomerPhone['label']; phone: string }[]; companyLine: boolean }`; `emptyPerson(companyLine = false): PersonRow`; `personState(r): 'empty'|'ok'|'partial'` (partial = a phone row with label but empty/invalid number, or a number without… keep: a number that fails `/^\+?[0-9]{5,15}$/` after `normalizePhone`); `cleanPeople(rows): CustomerPerson[]` (drops empty, trims, `companyLine` → name/title null); `missingOf(input, lists)` mirror of SQL `missing` (same keys, same order); `hasPhone(ceoPhone, rows)`.
- `lib/sales/history.ts`: `historyLine(row: HistoryRow): { key: string; values: Record<string,string> }` (message key under `sales.history.action.*`), `changeList(row): { field: string; from?: unknown; to?: unknown; private?: boolean; hidden?: boolean }[]`, `isPrivateChanged(row): boolean`.
- `customerImport.ts`: template columns order — Farsi name · English name / abbreviation · Type · CEO · **CEO phone** · Province · City · Address · Rank · Category · **Activity description** · Contact person · Contact title · Phone label · Phone · Email; cell keys `ceo_phone`, `activity`; type words incl. `خصوصی`/`Private`; request type gains `titles: Record<string, string | null>`; preview type gains `unknown.titles`.
- Messages (fa / en), add under `sales`:
  - `customerKind.private`: «خصوصی» / "Private"; `customerForm.kind`: «نوع شرکت» / "Company type"; `customerForm.activity`: «شرح فعالیت» / "Description of activity"; `customerForm.activityHint`: «کار اصلی شرکت را بنویسید؛ برای شرکت بدون رتبه لازم است.» / "What the company does. Needed when it has no rank."; `customerForm.sectionPeople`: «افراد کلیدی» / "Key people"; `customerForm.ceoCard`: «مدیرعامل» / "Managing director (CEO)"; `customerForm.ceoPhone`: «تلفن مستقیم مدیرعامل (اختیاری)» / "CEO direct phone (optional)"; `customerForm.personName`: «نام» / "Name"; `customerForm.personTitle`: «سمت» / "Title"; `customerForm.noTitle`: «—» / "—"; `customerForm.hiddenTitle`: «{title} (پنهان)» / "{title} (hidden)"; `customerForm.addNumber`: «افزودن شماره» / "Add number"; `customerForm.removeNumber`: «حذف شماره» / "Remove number"; `customerForm.addPerson`: «افزودن فرد» / "Add key person"; `customerForm.addCompanyLine`: «افزودن تلفن شرکت» / "Add company line"; `customerForm.companyLine`: «تلفن شرکت» / "Company line"; `customerForm.removePerson`: «حذف» / "Remove"; `customerForm.noPeople`: «هنوز فردی ثبت نشده است.» / "No key people yet."; `customerForm.phoneInvalid`: «شماره درست نیست.» / "This number is not valid."; `customerMissing.phones`: «شماره تلفن» / "Phone number"; `customerMissing.grade_or_activity`: «رتبه و رشته یا شرح فعالیت» / "Rank & category or activity description"; `customerMissing.unknown`: «یک فیلد» / "A field".
  - `customerProfile.people`: «افراد کلیدی» / "Key people"; `customerProfile.activity`: «شرح فعالیت» / "Activity"; `customerProfile.createdBy`: «ثبت: {name} · {date}» / "Registered by {name} · {date}"; `customerProfile.tabProfile`: «مشخصات» / "Profile"; `customerProfile.tabHistory`: «سوابق تغییرات» / "History".
  - `history.*`: `title` «سوابق تغییرات» / "History"; `beforeHistory` «ثبت‌شده پیش از آغاز ثبت سوابق · {date}» / "Registered before history began · {date}"; `privateChanged` «جزئیات خصوصی تغییر کرد» / "Private details changed"; `empty` «هنوز تغییری ثبت نشده است.» / "No changes recorded yet."; `loadMore` «بیشتر» / "Load more"; `peopleChanged` «افراد کلیدی: {added} افزوده، {changed} تغییر، {removed} حذف» / "Key people: {added} added, {changed} changed, {removed} removed"; `action.created` «ایجاد شد» / "Created"; `action.edited` «ویرایش شد» / "Edited"; `action.renamed` «تغییر نام: {from} ← {to}» / "Renamed: {from} → {to}"; `action.merged_into` «در «{name}» ادغام شد» / "Merged into “{name}”"; `action.merged_from` ««{name}» در این مشتری ادغام شد» / "“{name}” was merged into this customer"; `action.imported_created` «از فایل وارد شد» / "Imported from a file"; `action.imported_updated` «با فایل به‌روز شد» / "Updated by an import"; `action.removed_by_import_undo` «با حذف ورود فایل پاک شد» / "Removed by undoing an import"; `action.alias_added` «نام مشابه افزوده شد: {name}» / "Alias added: {name}"; `action.alias_removed` «نام مشابه حذف شد: {name}» / "Alias removed: {name}"; `action.deleted` «حذف شد» / "Deleted"; `action.currency` «ارز: {name}» / "Currency: {name}"; `action.stage` «مرحله: {name}» / "Stage: {name}"; `action.stage_order` «ترتیب مراحل» / "Stage order"; `action.field` «فیلد: {name}» / "Field: {name}"; `action.general` «تنظیمات کلی» / "General settings"; `action.category` «رشته: {name}» / "Category: {name}"; `action.city` «شهر: {name}» / "City: {name}"; `action.title` «سمت: {name}» / "Title: {name}"; `action.name_match` «تطبیق نام: {name} ← {profile}» / "Name matching: {name} → {profile}"; `action.ledger_import` «ورود فایل دفتر: {file}» / "Ledger import: {file}"; `action.inquiry_import` «ورود فایل استعلام‌ها: {file}» / "Inquiry import: {file}"; `action.customer_import` «ورود فایل مشتریان: {file}» / "Customer import: {file}"; `action.batch_removed` «حذف ورود فایل: {file}» / "Import removed: {file}"; `op.created` «افزوده» / "added"; `op.edited` «ویرایش» / "edited"; `op.hidden` «پنهان» / "hidden"; `op.shown` «نمایان» / "shown"; `op.deleted` «حذف» / "deleted"; `source.record` «از فرم پرونده» / "from a record form"; `source.ledger_import` / `source.inquiry_import` / `source.import`: «از ورود فایل» / "from an import"; `field.*` for customer snapshot keys `name, name_en, kind, rank, category, grades, province, city, address, ceo_name, ceo_phone, activity, people` (reuse `customerForm` wording) and product keys `name, code, unit, active`.
  - `activityPage.*`: `title` «سوابق فروش» / "Sales activity"; `who` «چه کسی» / "Who"; `when` «زمان» / "When"; `what` «چه تغییری» / "What"; `item` «مورد» / "Item"; `anyone` «همه» / "Anyone"; `anyType` «همه موارد» / "Everything"; `entity.record` «پرونده» / "Record"; `entity.customer` «مشتری» / "Customer"; `entity.product` «کالا» / "Product"; `entity.settings` «تنظیمات» / "Settings"; `entity.import` «ورود فایل» / "Import"; `from` «از» / "From"; `to` «تا» / "To"; `gone` «(دیگر وجود ندارد)» / "(no longer exists)"; `empty` «چیزی پیدا نشد.» / "Nothing found."
  - `tabs.activity`: «سوابق» / "Activity".
  - `customerLists.titles`: «سمت‌های افراد کلیدی» / "Key-person titles"; `customerLists.addTitle`: «افزودن سمت» / "Add title".
  - `customerImport.unknownTitles`: «سمت‌های ناشناخته» / "Unknown titles"; `customerImport.titleHint`: «سمت‌ها فقط در تنظیمات افزوده می‌شوند؛ یکی را انتخاب کنید یا خالی بگذارید.» / "Titles are added only in Settings: pick one or leave it empty."; template column headers `colCeoPhone` «تلفن مدیرعامل» / "CEO phone", `colActivity` «شرح فعالیت» / "Activity description".
  - Permission labels: wherever `sales_customers_import` labels live (grep), add `sales_activity`: «فروش: سوابق تغییرات» / "Sales: activity log", hint «دیدن همه تغییرات بخش فروش و اینکه چه کسی انجام داده است.» / "See every change in Sales and who made it."
- [ ] **Step 1: Tests first** — `tests/unit/sales-history.test.ts`: `historyLine` for `renamed` gives key `action.renamed` with `{from, to}`; `changeList` of a stripped row returns `[{field:'people', private:true}]`; `isPrivateChanged` true when `body.private_changed`. `tests/unit/sales-customer-form.test.ts`: `missingOf` cases = Review Focus #5 + government/description complete + phones via CEO only; `cleanPeople` drops an empty entry and nulls name/title of a company line; `personState` partial for `'12'`. Import parsing: header detection with the new columns, `خصوصی` → `private`.
- [ ] **Step 2:** `npx vitest run tests/unit/sales-history.test.ts tests/unit/sales-customer-form.test.ts` → FAIL.
- [ ] **Step 3: Implement** types, actions, helpers, messages (both files, same key set; a unit test already compares fa/en key parity — run it).
- [ ] **Step 4:** `npx vitest run` → PASS; `npx tsc --noEmit` → only errors in UI files that still use `contacts` (Tasks 4–7 fix them).

---

### Task 4: Customer form — Key people, Private, activity (UI)

**Files:** Modify `app/[locale]/(app)/sales/_components/CustomerForm.tsx` only.

**Interfaces — Consumes:** Task 3 `PersonRow`, `emptyPerson`, `personState`, `cleanPeople`, `missingOf`, `hasGrades`, `CustomerLists.titles`, messages listed in Task 3.

- [ ] Type segmented control gets a third option Private (`customerKind.private`); grades rows render when `hasGrades(kind)`; **Activity description** textarea (maxLength 1000, `data-testid="sales-customer-form-activity"`) under the type section for every kind; the `grade_or_activity` missing note under both.
- [ ] Replace the CEO and Contacts sections with one `FormSection` **Key people**: fixed CEO card (name `sales-customer-form-ceo`, direct phone `sales-customer-form-ceo-phone`, `dir="ltr"`, `inputMode="tel"`), then entries: name, title `<Select>` (options: `noTitle` + active titles by position + the entry's own hidden title shown with `hiddenTitle`), email; numbers as sub-rows (label select + number) with Add / Remove number (max 5); Remove person; buttons **Add key person** / **Add company line** (company line hides name + title, shows `companyLine` heading). Max 50 entries. Test ids `sales-customer-form-person-{i}-name|title|email`, `…-person-{i}-phone-{j}`, `…-add-person`, `…-add-company-line`.
- [ ] Payload: `people: cleanPeople(rows)`, `ceo_phone`, `activity`; footer count from `missingOf`. Invalid number blocks Save (field marked, `phoneInvalid`).
- [ ] `npx tsc --noEmit` clean for this file; manual check in Task 8.

### Task 5: Customer page phone book + History tab; product History (UI)

**Files:** Modify `app/[locale]/(app)/sales/_components/CustomerView.tsx`, `app/[locale]/(app)/sales/customers/[id]/page.tsx`, `app/[locale]/(app)/sales/products/[id]/page.tsx`, `app/[locale]/(app)/sales/_components/ProductEditor.tsx` (only to place the history below / in a tab); Create `app/[locale]/(app)/sales/_components/HistoryList.tsx`.

**Interfaces — Consumes:** Task 3 `getCustomerHistory`, `getProductHistory`, `HistoryRow`, `historyLine`, `changeList`, `isPrivateChanged`.
**Produces:** `HistoryList({ rows, entityKind, createdAt?, showEntity? }: { rows: HistoryRow[]; entityKind: 'customer'|'product'|'mixed'; createdAt?: string; showEntity?: boolean })` — list in the ActivityLog look (line, changes "Field: old → new" with `←` in fa / `→` in en, `privateChanged` text, actor · Tehran date-time); when `entityKind === 'customer'` and no `created` row, a first line `beforeHistory` with `createdAt`. Task 6 reuses it with `showEntity` (item label + link).
- [ ] Customer page: in-page tabs Profile / History (`tabClass` / `tabListClass`, `?tab=history` search param; page fetches history only when the tab is history). Profile card: Activity line; created-by line (`createdBy`); phone book `data-table` (Name · Title · Numbers with `tel:` links and label · Email `mailto:`), CEO first (title = `ceoCard`), company lines last; Private kind label.
- [ ] Product page: History section under the editor (fetched server-side).
- [ ] `npx tsc --noEmit` clean for these files.

### Task 6: Sales › Activity page (UI)

**Files:** Create `app/[locale]/(app)/sales/activity/page.tsx`, `app/[locale]/(app)/sales/activity/loading.tsx` (copy a sibling's), `app/[locale]/(app)/sales/_components/ActivityView.tsx`; Modify `app/[locale]/(app)/sales/_components/SalesTabs.tsx` (prop `activity: boolean`, tab after Settings) and its caller in `sales/layout.tsx`; add the section to `MobileTopBar` `SECTIONS` only if Sales sub-tabs are listed there (check).

**Interfaces — Consumes:** Task 3 `listSalesActivity`, `ActivityFilters`, `HistoryList` (Task 5) with `showEntity`, `boot.caps.activity`.
- [ ] Page: `boot.caps.activity` false → `notFound()`. Filters from search params (`actor`, `from`, `to`, `entity`) via a small filter bar: person `<Select>` from `boot` people list (check `Bootstrap` for the Sales users list; else the owners list used by `FilterBar`), `PersianDateField` from / to, type select. Desktop: `data-table` When · Who · What · Item (item links to `/sales/<id>`, `/sales/customers/<id>`, `/sales/products/<id>` when `exists`, else label + `gone`); phone: `HistoryList` cards. "Load more" calls `listSalesActivity({...filters, before: next})` client-side and appends.
- [ ] `npx tsc --noEmit` clean.

### Task 7: Settings titles list + import dialog (UI)

**Files:** Modify `app/[locale]/(app)/sales/_components/CustomerListsEditor.tsx`, `app/[locale]/(app)/sales/_components/CustomerImport.tsx`.

**Interfaces — Consumes:** Task 3 `saveContactTitle`, `ContactTitle`, `CustomerLists.titles`, import types with `unknown.titles` and request `titles`.
- [ ] Lists editor: third list **Key-person titles** like categories (add with fa + optional en, rename, hide / show, reorder up / down), hidden under View as.
- [ ] Import dialog: template gets the two new columns (Task 3 order); help line lists `خصوصی` / Private; the unknown-values step lists unknown titles with only **Use existing** (title select) / **Leave empty**, sends `titles`; preview table shows the CEO phone / activity cells.
- [ ] `npx tsc --noEmit` clean; `npm run lint` clean.

---

### Task 8: Whole-app checks + local stack (lead)

- [ ] `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` (clone node_modules per CLAUDE.md, `rm -rf .next/dev/types` first) → all clean.
- [ ] `:3501`: pre-dump `pg_dump -Fc` of db `postgres` to `.bj-deploy/approvals-finance/pre-fr99-<ts>.dump`; apply both migrations with ledger rows (as previous entries did); restart `bj-approvals-finance-rest-1`; rebuild the app from `../bj-cust` (temporary `compose-cust` wrapper, like PR #36); health 200.
- [ ] Browser at `APP_ORIGIN` (LAN URL), fa + en: new customer (Private, activity, CEO phone, 2 key people, company line) → saved complete; edit one number → History shows one people change; a `sales`-only throwaway user sees "Private details changed"; Activity page filters; Settings titles add / hide; import a 3-row file with an unknown title. Delete throwaway users / data after.
- [ ] Drop clone `x_fr99`.

### Task 9: Docs, PR, review, merge, deploy (lead)

- [ ] `docs/REQUIREMENTS.md` FR-99, `docs/DATA_MODEL.md` (tables, columns, missing keys), `docs/PERMISSIONS.md` (`sales_activity`), `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/AGENT-LOG.md` entry, CLAUDE.md one-liners (history rule: every new Sales write logs via `sales_log` and is listed in `tests/sql/sales-history.sql`; phone book shape; `private` kind = grades too).
- [ ] Commit, push branch, open PR; review subagent fixes issues; re-run checks.
- [ ] Update `:3501` with the reviewed branch (rebuild + any new migration), health 200, then **stop and wait for the owner to test and confirm the merge** (owner, 2026-11-27).
- [ ] Only after the owner's OK: merge to `main` → Liara deploy; health 200 on `https://bjeng.app/api/health`.
