# ERP › Sales — Customer phone book, activity description, Private type, change history (FR-99)

**Date:** 2026-11-27 · **Branch:** `feat/sales-customer-phonebook` (worktree `../bj-cust`, from `main` @ `bca387d`) ·
**Status:** decisions made by the owner in chat 2026-11-27 (CEO feedback on FR-98). Builds on
`2026-11-26-sales-customer-registry-design.md` (FR-98, incl. the grades amendment).

## 1. Why

- **Transparency and ownership.** The admin and CEO must see who did what in ERP › Sales: who added a
  customer, who changed it, and what changed (old → new). Nobody can blame a mistake on someone
  else, and people have a reason to do the job carefully. Sales records already keep an activity
  log (`sales_events` via `private.sales_touch`). Customers, products and Sales settings keep
  nothing today, apart from customers' `updated_at/by`.
- **A phone book per customer.** The CEO wants each company to hold a phone book of key people
  (CEO, QC manager, several project managers, …), not one CEO field plus a contacts list. It is
  the base for CRM and marketing later. Titles are picked from a list, never typed.
- **Activity description (شرح فعالیت).** Private companies often have no rank or category, so the
  form needs a free-text description of what the company does.
- **Third company type: Private (خصوصی)**, next to Government and Contractor.

## 2. Decisions (owner, 2026-11-27)

| # | Topic | Decision |
|---|---|---|
| D1 | History scope | Every write in ERP › Sales is logged with actor, time and what changed: records (as today, gaps closed), customers, products, Settings (currencies, stages, fields, general settings, customer lists, title list), Name matching / aliases, import batches (create / remove). |
| D2 | History view | **Both:** a **History** tab on each customer and each product page, and one central **Sales › Activity** page listing every change (records included), filterable by person, date range and type. |
| D3 | Who sees what | History tabs: **every Sales user** who can open the page (like the record activity log). Changes to private customer fields (CEO, CEO phone, address, phone book) show their values only to `sales_customers` holders; others see "Private details changed". The Activity page needs a new role permission **Sales: activity log** (`sales_activity`, read-only). The admin has it; the admin grants it to the CEO's role. |
| D4 | Phone book | CEO and Contacts become one section, **Key people**. The CEO is always the first entry: name (required for *complete*) + optional **direct phone**. Further entries: any number of key people, each with an optional name, a **title picked from a list**, **zero or more numbers** (each a label office / mobile / fax / other + number) and an optional email. A company-wide line (switchboard, fax) is an entry with no name and no title, shown as "Company line". |
| D5 | CEO rule | A missing CEO name does **not** block Save. The customer saves as a draft and shows **Incomplete** (unchanged FR-98 behaviour). |
| D6 | Titles list | Picked from a dropdown, **never typed**. The list is edited only in **Sales › Settings › Customer lists** (`sales_settings`): add, rename fa / en, hide, reorder. Seed (fa / en): رئیس هیئت مدیره (Chairman of the board) · قائم‌مقام مدیرعامل (Deputy CEO) · مدیر بازرگانی (Commercial manager) · مدیر تأمین (Procurement manager) · کارشناس خرید (Purchasing expert) · مدیر فنی (Technical manager) · مدیر مهندسی (Engineering manager) · مدیر پروژه (Project manager) · مدیر کنترل کیفیت (QC manager) · مدیر برنامه‌ریزی (Planning manager) · مدیر مالی (Finance manager) · دفتر / منشی (Office / secretary). |
| D7 | Activity description | Free text (شرح فعالیت), optional, available for **every type**. |
| D8 | Rank / category | Available for **Contractor and Private** (Government has none). |
| D9 | Completeness | Every type needs **at least one of** a complete rank + category pair **or** an activity description. Government can only meet it with the description. Also needs **at least one phone number** anywhere in the phone book (CEO direct line, any key person, or a company line). The other FR-98 fields stay as they are (English name, type, CEO name, province, city, address). |
| D10 | Type | `government` · `contractor` · **`private`**. |

## 3. Goals, non-goals, anti-goals

**Goals**
- The admin / CEO can answer "who created this customer, who changed what and when" from the
  customer page, and "what did person X change this week" from the Activity page.
- A customer's phone book holds every key person the staff know about, with titles from one
  controlled list, so later CRM / marketing can filter by title.
- A private company can be registered as complete without a rank.

**Non-goals**
- Undo / restore from history. The log is read-only.
- History before this release. Existing customers show "Registered before history began" plus
  what is known (`created_at`; the creator only when an import batch made it). No backfill of
  edits.
- Logging reads, sign-ins, or HR / leave changes (not ERP).
- Several CEOs. Several numbers for the CEO: the CEO has one direct line; further CEO numbers go
  in an extra entry with the CEO's name.
- Searching customers by key person or title (CRM comes later). The Customers tab search may
  match the activity description (§8).
- Changing the record activity log's look, beyond the gaps in §5.3.

**Anti-goals** (failure even if it works)
- A change that leaves no trace: any Sales write function that changes data and logs nothing.
- Private values (CEO name / phone, address, phone book) reaching a caller without `sales_customers`
  through a history body, the Activity page, an error or an export.
- A history entry that can be edited or deleted by anyone through the app.
- Free-typed titles creeping back in (no "Create …" in the title picker).
- Log writes that break View as (reads stay `stable`, no writes).

## 4. Approaches considered (history)

| Approach | Trade-off |
|---|---|
| **A. Explicit logging in every write function (chosen)** — a helper `private.sales_log(entity, id, action, body)` writes one row into a new `sales_audit` table. Customer and product writes take a *snapshot* (`jsonb`) before and after and log the field diff. Records keep `sales_events`. | One meaningful entry per user action ("Merged A into B", "Imported 120 customers"); privacy marking at write time; matches how `sales_touch` already works. Cost: every write function must call it — a SQL test asserts each `app_sales_*` / `app_project_*` write leaves a row. |
| B. Row triggers on every table (generic old/new diff) | Catches every path automatically, but noisy (the `missing` trigger, contacts replaced as a set → delete + insert rows, import = thousands of rows), loses meaning (merge, import), and `auth.uid()` is empty inside imports run as one call — no worse, but the entries say nothing a person can read. |
| C. Only `updated_by` columns + `created_by` | Cheap, but answers "who touched it last", not "what changed". Fails D1. |

Chosen: **A**. A unit-style SQL test (§10) lists every public write function and fails when one
does not log, so a future function cannot slip through.

## 5. History

### 5.1 Table `public.sales_audit` (function-only: RLS on, no grants)

| Column | Notes |
|---|---|
| `id` uuid pk, `company_id` uuid not null | |
| `at` timestamptz default `clock_timestamp()` | |
| `actor_id` uuid (null only for system jobs; none today) | |
| `entity` text check in `customer, product, settings, import` | |
| `entity_id` uuid null | customer / product id; null for settings / import-level rows. **No FK** — history outlives deleted / merged rows. |
| `entity_label` text | name snapshot at write time (shown when the entity is gone) |
| `action` text check (per entity, below) | |
| `body` jsonb default `{}` | `changes: [{field, from, to, private?}]` and action extras |

Indexes: `(company_id, at desc)`, `(company_id, entity, entity_id, at desc)`, `(company_id, actor_id, at desc)`.
Append-only: no app function updates or deletes it; a trigger refuses `update` / `delete`
(`sales: history is read-only`) except for `supabase_admin` (restores). Kept forever.

Actions:
- **customer:** `created`, `edited`, `renamed`, `merged_into` (on the removed one, `entity_label`
  keeps its name), `merged_from` (on the kept one), `imported_created`, `imported_updated`,
  `removed_by_import_undo`, `alias_added`, `alias_removed`.
- **product:** `created`, `edited`, `deleted`.
- **settings:** `currency`, `stage`, `stage_order`, `field`, `general`, `category`, `city`, `title`
  (body: `{op: created|edited|hidden|shown|deleted, name, changes}`).
- **import:** `ledger_import`, `inquiry_import`, `customer_import` (counts, file name),
  `batch_removed` (kind, counts removed / kept), `person_matched` (Name matching of an employee).

### 5.2 Customer and product diffs

`private.sales_customer_snapshot(id) returns jsonb` — every user-visible field incl. names, kind,
rank, category, further grades, province, city, address, CEO name, CEO phone, activity, phone
book (ordered list of entries `{name, title, phones:[{label, phone}], email}`). `private.sales_diff(before, after)`
returns `[{field, from, to}]` for changed keys. The phone book diffs entry by entry
(added / removed / changed, keyed by position after the save's ordering) so a long book is not
logged whole on every edit. Keys `ceo_name`, `ceo_phone`, `address`, `people` get `private: true`.
Ids (category, city, title) are logged together with their name at that moment (`{id, name}`), so a
later rename does not rewrite history.

Products: same with a product snapshot (name, code, unit, default fields, active).

### 5.3 Record gaps closed

These change a record and log nothing today: `app_sales_set_deadline_done` → a **direct**
`sales_events` insert (kind `edit`, body `{side: 'deadline_done', label, done}`), **not** `sales_touch`
(its `sales_sync_deadlines` would re-mark an un-marked automatic deadline as done — the function
skips the sync on purpose). `app_sales_remove_batch` → `sales_audit` `import/batch_removed`
(the records it deletes are gone; their own events go with them, as today). The builder checks
every function listed in §10's test and closes any further gap the same way.

### 5.4 Readers

- `app_sales_customer_history(p_id uuid)` stable, `sales` read: that customer's rows (incl.
  `merged_into` rows of customers merged into it), newest first, max 500, with `actor_name`.
- `app_sales_product_history(p_id uuid)` stable, `sales` read.
- `app_sales_activity(p jsonb)` stable, `sales_activity` read: one page (50) of **records events +
  `sales_audit`** merged by time, filters `actor`, `from`, `to` (dates, Tehran day), `entity`
  (`record | customer | product | settings | import`), keyset cursor `{at, id}`. Each row:
  `{source, at, actor_id, actor_name, entity, entity_id, entity_label, action, body, link}` where
  link is the page to open (record / customer / product) when it still exists. Record events
  carry the record number + title as label.
- **Privacy at read time:** for a caller without `sales_customers`, every change with
  `private: true` is replaced by `{field, private: true}` (no `from` / `to`), and phone book
  entry changes collapse into one `{field: 'people', private: true}`. Price keys stay hidden
  exactly as `sales_events` already does (`hidden: true`).
- Bootstrap caps gain `activity` (from `sales_activity`).

### 5.5 UI

- **Customer page:** tabs *Profile* · *History* (route tabs or in-page tabs per `lib/ui/tabs.ts`;
  builder's call). Each entry: action line, changes as "Field: old → new" (reuse the
  ActivityLog look), actor · Tehran date-time. The first line of a customer with no `created` row:
  "Registered before history began · {date}".
- **Product page:** same *History* tab.
- **Sales › Activity** tab (after Settings, only with the `activity` cap): filter bar (person
  combo from the Sales users list, date range with `PersianDateField`, type select), a
  `data-table` (When · Who · What · Item), "Load more". Phone layout: cards. View as: works
  (read-only).
- The record page's activity log shows the new deadline-done line.

## 6. Phone book data model

**`sales_customers` — new columns:** `ceo_phone` text (same normalized phone check as contacts,
nullable; private), `activity` text (1–1000 after trim, nullable; not private), `created_by` uuid
(set on every insert from now on; the migration backfills it from the creating import batch's
`created_by` where `import_batch_id` is set).

**Kind:** check becomes `kind in ('government','contractor','private')`. Contractor-only CHECK
becomes `kind in ('contractor','private') or (rank is null and category_id is null)`. The grades
trigger drops further pairs when kind leaves contractor / private.

**`public.sales_contact_titles`** (company list, like categories): `id`, `company_id`, `name_fa`
(1–80), `name_key`, `name_en` (nullable 1–80), `active`, `position`; unique `(company_id, name_key)`.
Seeded with D6 for every existing company by the migration (only when that company has no titles),
and by `private.sales_ensure` for new companies (CLAUDE.md: lists seeded once per company).

**Phone book:** the existing `sales_customer_contacts` becomes the *entries* table (keeps its id
and rows): `person` becomes nullable, new `title_id` → `sales_contact_titles(id)` `on delete restrict`,
`label` and `phone` move to a new child table, old `title` text is migrated then dropped.

`public.sales_customer_phones`: `id`, `company_id`, `contact_id` → contacts `on delete cascade`,
`label` (office|mobile|fax|other), `phone` (normalized), `position`. Max 5 per entry, 50 entries
per customer (writers check). An entry must have a name, a title, or at least one number
(no empty entries; checked in the writer).

**Migration of existing contacts:** each row's `label` + `phone` → one phone row. Its free-text
`title` → matched by name key against the title list (fa or en); unmatched titles are **added to
the list** (active, after the seed) so nothing is lost and the admin tidies them in Settings.
Then the old columns `title`, `label`, `phone` are dropped. (Local copy: 0 contact rows; live
holds what staff entered since 2026-11-26.)

**Old app during the deploy swap:** `app_sales_save_customer` treats an absent `people` key as
"keep the phone book" and ignores the old `contacts` key; `sales_customer_profile` returns
`people` (new) and no `contacts`. The old UI briefly shows an empty contacts list — harmless, nothing
is lost.

**Completeness (`private.sales_customer_missing_of`)**, keys in form order:
`name_en, kind, ceo_name, province, city, address, phones, grade_or_activity` plus `rank` /
`category` when exactly one of the main pair is set (half pair). `phones` = no number in
`ceo_phone` nor in any phone row. `grade_or_activity` = no complete main pair (further pairs are
complete by construction) and `activity` empty. The trigger on `sales_customer_phones` (and the
existing one on contacts) refreshes the parent row. The migration recomputes `missing` for every
customer. UI labels for the new keys: *Phone number*, *Rank & category or activity description*.

**Privacy:** `ceo_phone` and the whole phone book (entries + phones) are private, like `ceo_name` /
`address` / contacts today. `activity` and titles are not private.

## 7. Customer form

Sections (`FormSection`):
1. **Names** — unchanged.
2. **Type** — Government · Contractor · **Private** (segmented). Contractor and Private show the
   rank / category rows (FR-98 grades UI). Below for every type: **Activity description**
   (textarea, 1000). The missing note for `grade_or_activity` sits under both.
3. **Address** — unchanged.
4. **Key people** (replaces "CEO" and "Contacts"):
   - First, fixed card **CEO**: name · direct phone (`dir="ltr"`, `inputMode="tel"`).
   - Then entries: name · title (`ListPick`/select from the active titles, no create; first option
     "—") · email; numbers as sub-rows (label select + number) with **Add number** / remove; **Remove person**.
   - **Add key person** and **Add company line** (an entry with name / title hidden).
   - An entry with nothing in it is dropped on save; one with a number but a bad format blocks Save
     with the field marked (as today).

Footer / draft logic unchanged ("N fields missing — will be saved as Incomplete").

**Customer page profile card:** phone book as a table (`data-table`): Name · Title · Numbers
(`tel:` links, label) · Email (`mailto:`); CEO first row with title "CEO"; company lines last.
Activity description under type / rank. Private fields as today (holders only).

## 8. Elsewhere

- **Type labels / filters / reports:** add Private everywhere kind shows (Customers tab filter,
  CustomerView, reports grouping and CSV, picker tag if any). fa خصوصی / en Private.
- **Customers tab search** also matches the activity description (word search, same fold).
- **Import template:** new columns CEO phone and Activity description; Type accepts
  خصوصی / Private; contact columns stay one entry per row (person · title · label · phone · email),
  person now optional (empty → company line), title matched against the title list by name key.
  Unknown title values: **Use existing** or **Leave empty** (no Create — D6), with the same dialog
  step as unknown categories / cities. Update / Overwrite rules unchanged; the row's contact
  becomes an entry with one phone unless that phone already exists on the customer.
- **Merge:** moves entries with their phones (skip an entry whose numbers all already exist on
  the target), fills empty `ceo_phone` / `activity` from the removed customer, logs on both.
- **Settings › Customer lists:** third list **Key-person titles** (add, rename fa / en, hide,
  reorder), `sales_settings`. Hidden titles stay on entries that use them (shown with a
  "hidden" mark in the form, not offered for new picks).

## 9. SQL surface

| Function | Change |
|---|---|
| `app_sales_save_customer(p_id, p)` | keys `ceo_phone`, `activity`, `people` (absent = keep); kind `private`; logs `created` / `edited` with diff; sets `created_by` |
| `app_sales_add_customer` | logs `created`; sets `created_by` |
| `app_sales_rename_customer`, `app_sales_merge_customers` | log |
| `app_sales_customer_import_preview` / `_import` | new columns, title matching, unknown titles; import logs one `import/customer_import` row + per customer `imported_created` / `imported_updated` with diff |
| `app_sales_remove_customer_batch` | logs `batch_removed` + `removed_by_import_undo` per removed customer |
| `app_sales_save_title(p)` (new) | `sales_settings`; create / rename / hide / reorder; logs |
| `app_sales_customer_lists()` | + `titles` (active for everyone; all for `sales_settings`) |
| `private.sales_customer_profile` | + `ceo_phone`, `activity`, `people` (private), `created_by_name`, `created_at` |
| `app_sales_customer_history`, `app_sales_product_history`, `app_sales_activity` (new) | §5.4 |
| Every other Sales write in §10's list | call `private.sales_log` (or `sales_touch` for records) |

All new writes: `security definer`, `search_path ''`, `requireCaller` on the TS side, customer lock
before any record lock (FR-98 rule), `check_violation` / `not_null_violation` / `unique_violation`
re-raised as `sales: invalid input` (CEO phone / address would echo in DETAIL). Revoke PUBLIC
EXECUTE on every new `private.*` helper (PR #36 lesson).

**Permission** `sales_activity`: shape `R`, needs `sales`; the four catalog places; count asserts
**37 → 38** in the four files; labels fa «سوابق تغییرات فروش» / en "Sales: activity log". Granted to
nobody by the migration (admin has everything).

## 10. Testing

- SQL `tests/sql/sales-customer-phonebook.sql` (new): save with people / phones / company line;
  empty entry dropped; 5-number cap; title must be active & same company; `missing` for every
  type (government + description complete; contractor with activity only complete; half pair;
  phones from CEO line only); Private kind with rank; kind change drops grades; contacts
  migration (title matched / created; phone moved); privacy: `sales`-only caller gets no
  `ceo_phone` / people from every reader and from history bodies; import with title + CEO phone +
  activity + Private type; merge moves phones.
- SQL `tests/sql/sales-history.sql` (new): each write function leaves exactly the expected audit
  row (list of every `app_sales_*` / `app_project_*` function that writes; the test fails when a
  new write function is missing from both the "logs" and the "read-only" list — catches future
  gaps); diff contents; private stripping; `sales_activity` gate; keyset paging; `update` /
  `delete` on `sales_audit` refused; View as read of history works (stable).
- Count asserts 37 → 38 in the four files; existing `sales-customer-registry.sql` updated for the
  moved contact columns and new `missing` keys.
- Unit: completeness mirror (`lib/sales/customerForm.ts`), people payload / partial-entry rules,
  diff label formatting, import parsing of the new columns, permissions catalog.
- Browser check on `:3501` (Farsi + English): form, profile card, history tab, Activity page, Settings titles.
- Dry-run the migration on a clone of the `:3501` DB first (CLAUDE.md procedure).

## 11. Review amendments (spec review, 2026-11-27 — builder's calls, marked as such)

1. **Customers created outside the customer screens** (`private.sales_customer` from record save's
   text path, ledger import, inquiry import) also set `created_by` and log `customer/created`
   (body `{source: 'record'|'ledger_import'|'inquiry_import', batch_id?}`); filling an empty `kind`
   there logs `edited`. One row per customer is fine (a few hundred at most per import).
2. **Activity page noise:** record events of kind `import` are **left out** of the Activity page;
   the `import/ledger_import` / `inquiry_import` audit row (counts, file) stands for them. The record
   page still shows its own import line.
3. **Merged customers:** `merged_into` body stores `{into_id, into_name}`; `merged_from` stores
   `{from_id, from_name}`. The kept customer's History tab shows the merged customers' **whole**
   history too (recursive over `merged_from` rows, so chains A→B→C work), each row labelled with
   the name it had.
4. **Phone book dedupe** (merge and import Update / Overwrite): an entry with numbers is skipped
   when every one of its numbers already exists on the target; an entry without numbers is skipped
   when the target has an entry with the same name key and title. Caps (50 entries, 5 numbers) apply.
5. **Person aliases / Name matching** of employees: `entity = 'settings'`, `action = 'name_match'`
   (body `{name, profile_id, profile_name, op: added|removed}`), `entity_id` = profile id.
6. **Kind `private` is hard-coded as contractor in more places:** `sales_customer_values`,
   `sales_customer_set_grades`, `sales_customer_import_merge`, `sales_customer_import_resolve`
   (type words + `v_eff_kind`), `sales_filter_check`, `app_sales_add_customer`,
   `app_sales_merge_customers`, `private.sales_customer`, `sales_customer_missing_of`; TS
   `CustomerKind` (`lib/sales/types.ts`), `lib/sales/customers.ts`, `lib/sales/ledger.ts`. All must
   accept `private` (rank / category allowed for contractor **and** private).
7. **Every function touching the dropped contact columns** is redefined and has a SQL test that
   calls it: `sales_customer_set_contacts` (→ `sales_customer_set_people`), `sales_customer_import_resolve`,
   `app_sales_customer_import`, `app_sales_merge_customers`, `sales_customer_profile`,
   `sales_customer_missing_trg` / `_of` (now counts phones), `app_sales_remove_batch`,
   `app_sales_remove_customer_batch`. `tests/sql/sales-customer-registry.sql` and
   `tests/unit/sales-customer-form.test.ts` are updated for the new shape.
8. **More writes to log:** categories / cities created by `app_sales_customer_import` (settings
   `category` / `city`, `op: created`, `source: 'import'`); customers deleted by
   `app_sales_remove_batch` (`removed_by_import_undo`).
9. **History coverage test has three lists:** *logs*, *read-only*, *exempt* (`app_sales_file_begin`,
   `app_sales_file_abort`: pending upload rows, no user-visible change). A write function in none
   of them fails the test.
10. **§1 correction:** products already keep `created_by/updated_by`, categories / cities keep
    `created_by`; they still had no history of *what* changed.
11. **Indexes on `sales_events`:** `(company_id, at desc, id)` and `(company_id, actor_id, at desc)`.
12. **Soft-deleted records:** the Activity page hides events of records with `deleted_at` set unless
    the caller is the admin (same rule as the record page).
13. **Append-only:** `sales_audit.company_id` has **no FK** (history outlives anything); the trigger
    refuses `update` / `delete` from every role except `supabase_admin` / `postgres` (maintenance).
14. **Privacy over the whole body:** the read-time strip walks every key named `ceo_name`,
    `ceo_phone`, `address`, `people`, `contacts` and every change marked `private`, wherever it is
    in the body (merge, import diffs included). Tests cover merge and import rows.
15. **Deploy swap:** absent `ceo_phone` / `activity` / `people` keys = keep; an import request
    without title decisions treats unknown titles as *leave empty*; unknown `missing` keys render
    as a generic "field missing" label (no crash).
16. **Diff snapshots** are taken after the customer lock and the row `FOR UPDATE` (import: inside
    its existing lock, per matched row).

## 12. Left to the builder

Exact layout of the Key people cards on phone vs desktop (Blueprint `DESIGN.md`); history entry
wording beyond the actions named here; whether Customer page tabs are route tabs or in-page;
migration file split (enum-free, so one file is fine unless a step needs its own transaction).
