# ERP › Sales — Customer registry (FR-98)

**Date:** 2026-11-26 · **Branch:** `feat/sales-customer-registry` (worktree `../bj-cust`, from `origin/main` @ `749fd45`) ·
**Status:** decisions made by the owner in chat 2026-11-26 (CEO request). Builds on
`2026-11-16-sales-rfp-module-design.md` §16.7 (customer lookup, Customers tab) and
`2026-11-20-sales-ceo-feedback-design.md` (currencies, products).

## 1. Why

The CEO wants customers registered once, properly, and then only *picked*: people mistype
company names, so the fewer free-typed fields the better (owner rule, `erp-predefined-inputs`).
Today a customer is just a name + government/contractor, created from the record form's
"Create …" shortcut. CEO's list (Farsi, verbatim intent): name — government or contractor — CEO —
contact numbers — if contractor, its rank and rank category — address; plus "the company's short
name", and while typing a name, list every company containing any typed word so a duplicate is
spotted; "the same in the main table" (the Records list).

## 2. Decisions (owner, 2026-11-26)

| # | Topic | Decision |
|---|---|---|
| D1 | Entry points | **"Add customer"** button on the Customers tab, and the existing **Create "…"** shortcut in the record form's customer picker — both open the same full form. |
| D2 | Who | New role permission **Customers: create / edit** (`sales_customers`): create, edit, and *see* contact details. |
| D3 | Names | **Farsi name** (required) + **one English field** for the English name *or* the English abbreviation (e.g. `NISOC`). No separate abbreviation field. |
| D4 | Display | Language **en** → English field, else Farsi name. Language **fa** → Farsi name. |
| D5 | Type | Government / Contractor. Contractor → **rank** (1–5) + **category**, one pair per company for now (multiple pairs may come later: keep it a single pair, but nothing should make a later child table hard). **Amended 2026-11-26 (CEO confirmed):** several pairs; the first stays on `sales_customers`, further complete pairs in `sales_customer_grades` (max 9). |
| D6 | Category | Picked from a list; **"Create …"** in the picker when the search finds none. The list is editable in Sales › Settings (rename, hide), like currencies. |
| D7 | Contacts | A phone book per company: any number of entries, each **person**, **job title**, **label** (office / mobile / fax / other), **number**, optional **email**. |
| D8 | Contact privacy | CEO, contacts and street address are visible only to `sales_customers` holders. |
| D9 | Address | **Province** and **city** picked from lists + a free-text street address. |
| D10 | Completeness | All fields are required for a *complete* customer, but anyone adding one may lack the info: the form saves with gaps (**draft**), the customer is usable on records at once and shows an **Incomplete** tag until every required field is filled. Old and imported customers are the same: incomplete until fixed; the edit form marks what is missing. |
| D11 | Uniqueness | Farsi name (existing name key) and English field are each unique per company. |
| D12 | Search | Word by word, in any order, ignoring case, spaces, ی/ک, ZWNJ, digits script — in the picker, the Customers tab search, the registration duplicate list, and the **Records** list search box. |
| D13 | Bulk import | **Import customers** from a downloadable `.xlsx` template, **one sheet**, **one contact per row** (more contacts are added by editing). New role permission **Customers: bulk import** (`sales_customers_import`). |
| D14 | Import gaps | Rows with missing / invalid fields import as **Incomplete** (the bad value is dropped and reported). |
| D15 | Import matches | A row matching an existing customer: the importer chooses **Skip**, **Update** (fill only the empty fields) or **Overwrite** (file values replace stored ones), per row with an "apply to all". |
| D16 | Import unknowns | A category or city not in the lists: the importer chooses **Create it**, **Use** an existing entry, or **Leave empty**. |
| D17 | Import undo | An import batch can be removed as a whole, like Sales imports; customers already used on a record are kept. |

## 3. Goals, non-goals

**Goals**
- A Sales user registers a customer with ~5 picks and 3–4 typed fields; nobody types a company name on a record.
- Duplicates are caught while typing (word match) before they are created.
- The CEO sees at a glance which customers still lack data (Incomplete tag + filter).
- A first customer list can be loaded from Excel in one go, with control over clashes.

**Non-goals**
- Several rank/category pairs per company (D5: later, if the CEO confirms).
- Per-customer change history / activity log (records keep theirs; customers get `updated_at/by` only).
- Contacts in the import beyond one per row; exporting customers.
- Changing who may merge / rename / match names (stay `sales_settings`); merge only learns to keep the new fields (§4.1).
- Re-labelling names inside the activity log: `sales_events` bodies keep the name snapshot they were written with.

**Anti-goals** (failure even if it works)
- Contact details reaching a caller without `sales_customers` (JSON, events, exports, errors).
- An incomplete customer blocking a record from being saved or moved on.
- The import silently creating categories/cities or overwriting data without the importer's choice.

## 4. Data model (migration `2026111…_sales_customer_registry.sql` + an enum-free follow-up if needed)

All new tables are **function-only** like the rest of Sales (RLS on, no grants, `app_sales_*`).

**`sales_customers` — new columns** (all nullable; old rows stay valid):

| Column | Type / check | Notes |
|---|---|---|
| `name_en` | text, 1–200 after trim | D3 |
| `name_en_key` | text | `private.sales_name_key(name_en)`, set with it. Partial unique index `(company_id, name_en_key) where name_en_key is not null`. **One namespace (my call):** an English key may not equal any *other* customer's `name_key` or `name_en_key` (checked in every write function under the customer lock, §10), so a typed word resolves to one customer. |
| `ceo_name` | text 1–120 | D8 private |
| `province_code` | text → `public.iran_provinces(code)` | |
| `city_id` | uuid | composite FK `(city_id, province_code)` → `sales_cities(id, province_code)` `on delete restrict` — the city always belongs to the province |
| `address` | text 1–500 | D8 private |
| `rank` | smallint 1–5 | CHECK `kind = 'contractor' or (rank is null and category_id is null)` |
| `category_id` | uuid → `sales_contractor_categories(id)` `on delete restrict` | lists are hidden, never deleted |
| `missing` | `text[] not null` | stored completeness (below), kept by triggers |
| `import_batch_id` | uuid → `sales_import_batches(id)` `on delete set null` | only the *customer* import that **created** it (D17) |
| `updated_at`, `updated_by` | timestamptz, uuid | set by every customer write except the trigger |

**`public.iran_provinces`** (global reference, inserted by the migration — not company data, so a
fresh install gets it too; RLS on, no grants, like Sales tables): `code text pk` (2-letter, e.g. `KZ`),
`name_fa`, `name_en`, `position`. All 31 provinces.

**`public.sales_cities`** (company list): `id`, `company_id`, `province_code`, `name_fa` (1–80),
`name_key`, `name_en` (nullable), `active`, `created_at`, `created_by`; unique
`(company_id, province_code, name_key)` and unique `(id, province_code)` (target of the composite FK).
Seeded with every province's **county seats** (مراکز شهرستان, ~430 rows), written from the
builder's knowledge and spot-checked; the seed may hold mistakes, so the list is **editable in
Sales › Settings** (rename, hide, add) by `sales_settings` — a migration is frozen once applied.

**`public.sales_contractor_categories`** (company list): `id`, `company_id`, `name_fa` (1–80),
`name_key`, `name_en` (nullable, 1–80), `active`, `position`; unique `(company_id, name_key)`.
Seeded with the nine official contractor categories of the Plan and Budget Organization:
ساختمان (Building) · راه و ترابری (Road & transport) · آب (Water) · صنعت و معدن (Industry & mining) ·
تأسیسات و تجهیزات (Installations & equipment) · نفت و گاز (Oil & gas) · کشاورزی (Agriculture) ·
ارتباطات و فناوری اطلاعات (Telecom & IT) · نیرو (Power).

**Seeding.** One function `private.sales_seed_customer_lists(p_company uuid)` (idempotent,
`on conflict do nothing`) inserts cities + categories. The migration calls it for every existing
company; `supabase/seed.sql` calls it after it creates its company (migrations run before the
seed on a fresh install — CLAUDE.md gotcha), and so does any other function that creates a company
(builder: grep `insert into public.companies`).

**`public.sales_customer_contacts`**: `id`, `company_id`, `customer_id` (→ customers, `on delete
cascade`), `person` (1–120), `title` (nullable, 1–80), `label` (`office|mobile|fax|other`), `phone`
(normalized: ASCII digits, optional leading `+`, 5–15 digits), `email` (nullable, ≤ 200, simple
`x@y.z` check), `position`; at most **50 contacts per customer** (checked in the writers).

**`sales_import_batches.kind`**: add `'customers'` to the check. Customer batches are **not**
Sales-import batches: bootstrap's `batches` list filters `kind <> 'customers'`, and
`app_sales_remove_batch` refuses `kind = 'customers'`.

**Completeness** is stored in `missing` and recomputed by `private.sales_customer_missing(id)`
(text[] of empty required keys, in form order: `name_en, kind, ceo_name, province, city, address,
contacts` and, when contractor, `rank, category`; `contacts` = no contact row). A BEFORE trigger on
`sales_customers` and an AFTER trigger on `sales_customer_contacts` keep it current, so every write
path (save, import, merge, rename, ledger import) is covered and list readers stay set-based.
Incomplete ⇔ `cardinality(missing) > 0`. Required in a contact row: person, label, phone (title,
email optional) — a contact row is never saved half-filled. The UI never re-derives completeness
except for live form feedback; it shows the `missing` the SQL returns.

### 4.1 Changes to existing functions

- **`app_sales_remove_batch` (blocker found in review):** today it deletes *every* unused customer
  created after the batch — that would delete hand-registered customers. Restrict the delete to
  customers with `import_batch_id is null and updated_by is null` and no contacts and no
  `ceo_name` (i.e. bare names the ledger / inquiry import made), and refuse `kind='customers'`.
- **`private.sales_customer(company, text, kind)`** (record save's text path, both imports): match
  `name_key`, then `name_en_key`, then aliases. It still creates a bare customer for the **imports**
  only; the record save path creates only when the caller holds `sales_customers` (old app during
  deploy), otherwise `sales: unknown customer`.
- **`app_sales_save_record`** accepts `buyer_id` / `client_id` (uuid of a company customer, or
  null to clear); the new UI sends ids only — never a label (an English label would otherwise
  create a duplicate). `buyer` / `client` text stays for the old app. `RecordForm` and
  `stagePages.draftFrom` switch to ids.
- **`app_sales_merge_customers`**: before deleting `p_from`, move its contacts (skip same phone, cap
  50) and fill `p_into`'s empty fields from it (names never overwritten); add an alias for
  `p_from`'s English key too.
- **`app_sales_rename_customer`**: also enforces the one-namespace rule.
- **Every new or changed write** catches `check_violation` / `not_null_violation` /
  `unique_violation` and re-raises a fixed `sales: invalid input` (or `sales: duplicate name`) —
  `ceo_name` / `address` would otherwise be echoed in DETAIL (CLAUDE.md gotcha). Import per-row
  problems name the field, never echo stored values.

## 5. Permissions

| Key | Shape | Needs | Grants |
|---|---|---|---|
| `sales_customers` | E | `sales` | create + edit customers, create categories / cities from pickers, see CEO / contacts / street address |
| `sales_customers_import` | E | `sales_customers` | the import dialog, its batches and their removal |

Usual four places (SQL `permission_keys/allows/deps`, `lib/permissions/catalog.ts` +
section `sales`, labels fa/en, the four count asserts 35 → **37**). `app_sales_bootstrap().caps`
gains `customers` and `customers_import`. Editing the category list in Settings stays
`sales_settings`.

**Transition (my call):** the migration grants `sales_customers = edit` to every role that today
holds `sales = edit` — they could create customers before, so nothing is taken away silently;
the admin narrows it in Roles. `sales_customers_import` is granted to nobody (admin has everything).

Built-ins: the admin passes every `has_perm` check; no preset (hr, finance, security) gets the new keys.
`permission_allows`: both keys are edit-only (shape E). Deps: `sales_customers` needs `sales`;
`sales_customers_import` needs `sales_customers` (presence, as the SQL dep check tests).

**Privacy rule (D8):** `ceo_name`, `address` and contacts appear only in
`app_sales_customer` (detail), `app_sales_save_customer`'s result and the import preview / matches,
each only for `sales_customers` holders (`private.sales_customer_rows` gets a `p_private` flag).
No reader uses `to_jsonb(<customer row>)`; bootstrap, records, deadlines, reports and events never
carry them. A duplicate-name error returns only the other customer's id and name. `missing` keys
are not private (it only says *that* a field is empty).

## 6. Search (D12)

One rule everywhere, mirrored in TS (`lib/sales/customerSearch.ts`) and SQL
(`private.sales_words(text) returns text[]`):

- Split the typed text on whitespace; fold each word with `nameKey` (lowercase, ی/ک, drop ZWNJ
  and punctuation, Persian/Arabic digits → ASCII); drop empty words. The SQL fold
  `private.sales_word_key(text)` must equal the TS `nameKey` exactly (the existing SQL
  `sales_name_key` keeps spaces and digits, so it is **not** reused for words); a shared fixture
  of tricky strings is asserted in both the unit and the SQL test. The searched side is folded the
  same way (`sales_word_key(name)`, never raw `ilike` on the stored text).
- **Picker, Customers tab, Records list: every word must occur** (substring) in at least one
  searched field; order free. A customer's searched fields: Farsi name, English field.
  Picker ranking stays: exact → prefix → contains.
- **Registration duplicate list** (the form's name fields): **any word** of ≥ 2 characters, ignoring
  generic words (`شرکت`, `سهامی`, `خاص`, `عام`, `company`, `co`, `ltd`, `inc`, `group`, `گروه`),
  ranked by number of words matched, then the existing typo check (`app_sales_similar_customers`)
  merged in; at most 8 shown, each with "Use this one" (record form) or "Open" (Customers tab).
- **Records list search** (`app_sales_list_page` `q`): AND over words; each word matches title,
  customer ref, description, in-charge text, buyer/client Farsi or English name, or owner name.
  A single all-digit `q` still also matches the record number exactly.

## 7. Customer form (`CustomerForm`, one component in a scrolling dialog)

Opened from: Customers tab **Add customer** (needs `customers` cap), Customer page **Edit**, and the
picker's **Create "…"** (prefills the Farsi name; picking "Use this one" returns that customer).
Hidden under View as (`useViewAs()`).

Sections (`FormSection`, required fields marked):
1. **Names** — Farsi name, English name / abbreviation; under them the live duplicate list (§6).
2. **Type** — Government / Contractor (segmented). Contractor reveals **Rank** (select 1–5) and
   **Category** (combo with "Create …" → small confirm with fa + optional en name).
3. **CEO** — full name.
4. **Address** — Province (select), City (combo filtered by province, "Create …"), street address (textarea).
5. **Contacts** — rows of person · title · label (select) · number (`dir="ltr"`, `inputMode="tel"`) ·
   email (optional); add / remove rows; at least one row is needed for *complete*.

Footer: when anything required is empty, a line *"N fields missing — will be saved as Incomplete"*
and the button reads **Save as draft**; otherwise **Save**. Only the Farsi name blocks saving.
Errors: duplicate Farsi / English name → field error naming the existing customer with "Open".
Edit form opened on an incomplete customer highlights the missing fields (red border + note).

## 8. Where customers appear

- **Customers tab:** **Add customer** + **Import customers** buttons (by cap); an **Incomplete**
  tag next to the name; a **Missing data** filter option (`?incomplete=1`); search per §6; names per D4.
- **Customer page:** profile card (type, rank · category, province · city; for holders CEO,
  address, contacts with `tel:` / `mailto:` links); **Edit** for holders; Incomplete tag listing
  missing fields.
- **Picker** (record form / stage pages): names per D4, Incomplete tag on options, word search;
  `allowCreate` only with the `customers` cap.
- **Everywhere a customer name is shown**: SQL readers also return the English field and the UI
  picks with one helper `customerLabel({name, name_en}, locale)`. Readers (found in review):
  `private.sales_rfp_json` (record + list rows: `buyer_name_en`, `client_name_en`),
  `app_sales_deadlines`, `app_sales_customer` (incl. `client_of`), `private.sales_customer_rows`,
  `app_sales_price_history` (quote lines), `app_sales_metrics` (`decided`), `app_sales_report`,
  bootstrap `customers`. UI: RecordsTable, RecordView / panels, DeadlinesList, CustomersList,
  CustomerView, CustomerCombo, ReportsView (screen + CSV), `lib/sales/reports.ts` grouping
  (group by id, label by locale). Activity-log `changes` bodies keep their stored snapshot.
- **View as** (read-only transaction): hide Add / Edit / Import, the pickers' "Create …" for
  customers, categories and cities, and the Settings list editors (`useViewAs()`).

## 9. Bulk import (D13–D17)

**Template** (`Download template` in the import dialog; generated in the browser by
`writeXlsx`, values only, one sheet): header row in the current language + one example row.
Columns, fixed order: Farsi name · English name / abbreviation · Type · CEO · Province · City ·
Address · Rank · Category · Contact person · Contact title · Phone label · Phone · Email.
Type / label cells accept the Farsi or English word (`دولتی`/`Government`, `دفتر`/`Office`, …);
Province / City / Category match by name key against fa or en names. A help line under the
download button lists the accepted values.

**Flow** (dialog on the Customers tab, `customers_import` cap):
1. Pick `.xlsx` → `readXlsx` in the browser → rows (header row skipped when it matches either
   language) → `app_sales_customer_import_preview(rows)`.
2. Preview (stable SQL, no writes) returns per row: `new | match | error` (error only = no Farsi
   name or > 1000 rows total), the matched customer (by Farsi key or English key), dropped
   invalid values (`{row, field, value, reason}`), and the **unknown** category / city values
   (distinct, with row counts and, for a city, its province).
3. Dialog steps: **Unknown values** — per value: Create · Use existing (picker) · Leave empty
   (D16) → **Matches** — one choice for all matches (Skip / Update / Overwrite, default Skip) with
   a per-row override (D15) → **Summary** (n new, n updated, n skipped, n incomplete) → **Import**.
   Matching resolves `sales_name_aliases` first, then Farsi key, then English key (one namespace,
   §4); two file rows resolving to the same customer → the second is reported and skipped.
4. `app_sales_customer_import(p)` re-validates everything server-side (never trusts the preview),
   creates the chosen categories / cities, inserts / updates in one transaction, writes a batch
   (`kind='customers'`, counts), returns counts. Created rows get `import_batch_id`; updated rows
   only `updated_at/by`. A match decided as Update fills only empty columns and adds the row's
   contact unless the same phone exists; Overwrite replaces with the non-empty file values (empty
   file cells never erase; Farsi name never changes) and adds the contact likewise.
5. **Recent imports** list in the dialog: file, date, counts, **Remove** →
   `app_sales_remove_customer_batch(id)`: deletes customers *created* by the batch that no record
   uses (buyer or client, incl. deleted records), no alias targets (from a merge or Name matching)
   and nobody edited since (`updated_by` null after import); returns removed / kept. Updates made
   by the batch are not reverted (said in the confirm text). The batch row goes when nothing
   points at it (`on delete set null` covers kept customers).

## 10. SQL surface (all `security definer`, `search_path ''`, JSON in/out, `sales: invalid input` re-raise on CHECK)

| Function | Gate | Notes |
|---|---|---|
| `app_sales_customer_lists()` stable | `sales` read | provinces, active cities, active categories (+ all categories for `sales_settings`) |
| `app_sales_save_customer(p_id uuid, p jsonb)` | `sales_customers` | create (`p_id` null) or update; contacts replaced as a set; returns `{id,name,name_en,kind,missing}` + private fields; duplicate → exception message `sales: duplicate name` with `hint` = JSON `{id,name}` of the other customer (nothing else) |
| `app_sales_add_customer(p)` | `sales_customers` | kept for the still-running old app during deploy; thin wrapper, still returns `{id, existed, name, kind}` |
| `app_sales_save_category(p)` | create: `sales_customers`; rename / hide / reorder: `sales_settings` | |
| `app_sales_save_city(p)` | create: `sales_customers`; rename / hide: `sales_settings` | province + fa (+ en) |
| `app_sales_customer(p_id uuid)` (existing detail, **same signature** — a 2-arg version would add an overload and break the old app) | `sales` read | + profile fields, `missing`, contacts only for holders |
| `app_sales_customers(p)` / `private.sales_customer_rows` | `sales` read | + `name_en`, `missing`; new filter key `incomplete` added to `sales_filter_check` but **not** to `sales_filtered` (else zero-record incomplete customers would vanish) |
| `app_sales_bootstrap()` | | customers gain `name_en`, `incomplete`; caps `customers`, `customers_import` |
| `app_sales_list_page(p)` (Records list; UI `RecordsList`) and other readers returning names | | `*_name_en`; AND word search (§6) |
| `app_sales_customer_import_preview(p_rows jsonb)` stable | `sales_customers_import` | ≤ 1000 rows |
| `app_sales_customer_import(p jsonb)` | `sales_customers_import` | rows + decisions + list choices + file name |
| `app_sales_customer_batches()` stable / `app_sales_remove_customer_batch(p_id)` | `sales_customers_import` | |

Reads stay `stable` and lock-free (View as). Writes to customers do not touch `sales_rfps`, so no
record lock is needed; every customer write (save, add, rename, merge, import, city / category
create) takes `pg_advisory_xact_lock(hashtext('sales-customers:'||company))` first, so the
one-namespace name check cannot race. **Lock order: customer lock before any `sales_rfps` row
lock.** Merge takes it first, then updates records. `app_sales_save_record` takes it at its very
start (before `private.sales_rfp` locks the row) only when `p` has the text keys `buyer` / `client`
(the only path that may create); the id path needs no customer lock. The imports already create
customers before touching records; they take it at their start.

**Settings › Customer lists** (new section beside Currencies, `sales_settings`): categories and
cities — add, rename (fa / en), hide; cities grouped by province.

## 11. Testing

- `tests/sql/sales-customer-registry.sql` (new; `sales-customers.sql` already exists for the
  Customers tab): save create/update/contacts, `missing` via triggers, contractor CHECK,
  one-namespace uniqueness, a `sales`-only caller gets **no** CEO / address / contacts from
  bootstrap, `app_sales_customer`, `app_sales_customers`, records, and the duplicate error;
  category/city create gates, import preview/commit (skip/update/overwrite, unknown value choices,
  bad values → incomplete, aliases), customer batch removal keeps used / edited customers,
  **removing an older ledger batch keeps registered customers**, `app_sales_remove_batch` refuses a
  customer batch, record save by `buyer_id`, merge keeps contacts, word search in the Records list
  (shared fold fixture), the transition grant. Count asserts 35 → 37 in the four files.
- Unit: `customerSearch` (AND / ANY / stopwords / digits), import parsing (header detection,
  fa/en value words), `customerLabel`, completeness mirror, permissions catalog.
- e2e (`tests/e2e/sales-customers.spec.ts`, own `999…` data): add a draft customer → Incomplete
  tag → edit to complete → tag gone; picker "Create …" path; import a small file with a match.
- Dry-run the migration on a clone of the `:3501` DB (CLAUDE.md procedure) before anything else.

## 12. Left to the builder

Exact column widths and tag styling (Blueprint `DESIGN.md`); province codes; message wording
beyond the strings named here (fa + en, Farsi first); whether the Customers tab word search runs
client-side (current) or server-side.
