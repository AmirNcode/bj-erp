# ERP › Sales — CEO feedback round 1 (FR-94 follow-up)

**Date:** 2026-11-20 · **Branch:** `feat/erp-sales-module` (local only, not deployed) ·
**Status:** draft for owner review (builder check done 2026-11-20). Decisions below were made in chat on 2026-11-20.
Builds on `2026-11-16-sales-rfp-module-design.md` (base spec) and
`2026-11-17-sales-stage-pages-design.md` (stage pages).

## 1. Why

The CEO tried the Sales module and asked for five changes. Together they make the module work as
the place where an RFP lives: its papers are in the record, item rows start from standard product
definitions instead of free typing, and the money labels and currencies match how the company
talks. One change (the clickable title) is app-wide navigation.

1. Tapping the page title goes to that section's main page.
2. Currencies are managed in Settings (names and codes chosen by the company).
3. "Our price" reads "Our total price".
4. Each record gets a **Files** page: uploads per stage (the RFP pack on Received, etc.).
5. A **Products** page in ERP: per-product columns + default values, used by the Technical
   proposal items, so products stay standardized across projects.

**Reverses a base-spec decision:** base spec §2/§7/§12 said "no file uploads in v1". The owner
now wants uploads. §7's document checklist stays as is; files are a separate page.

## 2. Goals, non-goals, anti-goals

**Goals**
- People working on later stages find the documents from earlier stages in the record.
- Item rows for a known product start with the right columns and values; the same product reads
  the same way on every record.
- Currencies the company adds itself (e.g. Toman) work everywhere a currency is shown or picked.
- On a phone, the title is an obvious way back to the section's main page.

**Non-goals**
- Previewing files in the browser beyond what the browser does itself; versioning; folders inside
  a stage; full-text search of file contents.
- Object storage now (Liara S3 later, if needed — §6.6 keeps the door open).
- Currency conversion (still one currency per record, amounts as entered).
- Product pricing, stock, or BOM; products only shape item rows.

**Anti-goals (a failure even if it works)**
- A person without `sales_prices` reaching a price *field* (files are not restricted — §6.4).
- Changing a product rewrites an offer already sent (decided: copies, not links — §5.3).
- Files lost because the backup covered only Postgres (§6.7).
- An upload path that lets a caller read or write a file outside their company/record.

## 3. Clickable section title (all sections)

- `MobileTopBar` (`app/[locale]/(app)/_components/MobileTopBar.tsx`) renders the matched section
  name as a `Link` to that section's href from `SECTIONS` (e.g. on `/sales/<id>` → `/sales`;
  on `/manage/approvals/...` → `/manage/approvals`). No match → plain app name, not a link.
- **Looks like a button** (owner request): bordered pill-less button on the blue bar — 1px
  `border-white/40`, `rounded-md` (DESIGN.md: no `rounded-full`, no shadow), `px-2.5 py-1`,
  a chevron pointing "back to start" (left in en, right in fa; use the existing icon set and flip
  with `rtl:`), hover/active `bg-white/10`, visible focus ring. `aria-label` = "Go to <section>".
- On the section's main page itself the button stays visible (consistent target; tapping is a
  no-op reload of the list). Builder may disable it there if it looks odd — builder's call.
- Desktop: the side panel already does this; no change.

## 4. Currencies in Settings

### 4.1 Data
New table `public.sales_currencies` (functions only, like every `sales_*` table):

| column | notes |
|---|---|
| `company_id` | |
| `code` | `^[A-Za-z0-9]{1,10}$`, unique per company, **never changes once used** (it is stored on records). |
| `name_fa`, `name_en` | 1–40 chars. Shown wherever the code was shown before. |
| `symbol` | optional, ≤ 6 chars; shown after amounts if set, else the name. |
| `decimals` | 0–2, default 0 (IRR / Toman 0, USD/EUR 2). **Display only** (`f.money`); amounts stay `numeric(18,2)`, no column change. Lowering it later only hides digits on screen; stored values are untouched. |
| `active` | inactive = hidden from pickers, still shown on old records. |
| `position` | order in pickers. |

- Seed per company with today's list: IRR, EUR, USD, AED, CNY (names from current
  `messages/*.json` `sales.currency.*`).
- New migration drops the `^[A-Z]{3}$` CHECK on `sales_rfps.currency` and `sales_bonds.currency`
  (constraint names from `schema.sql`) and replaces it with a length check; write functions
  validate the code against active `sales_currencies` of the caller's company (re-raise as
  `sales: invalid input`). Old rows keep their codes.
- No delete in v1: a used code can only be deactivated. An unused one may be deleted.

### 4.2 UI
- Settings › Sales gets a **Currencies** section (`data-table`): code, fa name, en name, symbol,
  decimals, active, reorder. Edit needs `sales_settings`.
- `CURRENCIES` constant in `lib/sales/types.ts` and the `sales.currency.*` messages are replaced by
  `boot.currencies` from `app_sales_bootstrap()`. Every picker (`RecordForm`, stage fields, bond
  and payment dialogs) and every money display (`f.money`, Customers, Reports, CSV exports) reads
  the name/symbol/decimals from it. Unknown code (should not happen) → show the raw code.
- Ledger import (§6b base spec) maps currency text to a code by code or either name,
  case/space-insensitive; unknown → preview error, as for other unmatched values.

## 5. Products

### 5.1 What a product is
A product = a standard **family** (e.g. Gate valve) with:
- a name (fa + en), an optional code, active flag, position;
- an ordered list of **item columns** it uses — references to `sales_field_defs` rows of entity
  `item` (the existing column library), plus the built-in item columns it uses
  (`size`, `rating`, `qty`, `unit`);
- a **default value** per column (optional), typed by the column's type (`select` defaults must be
  one of its options).

Columns come from the existing library on purpose: a "Body material" column is the same column on
every product and every record, so values stay comparable and reports work across products.
Creating a new column from the Products page adds it to the library (same rules as today's
"Add column").

### 5.2 Data
- `public.sales_products` — `id, company_id, code (nullable, unique per company), name_fa,
  name_en, active, position, created/updated by/at`.
- `public.sales_product_fields` — `product_id, field (built-in key or sales_field_defs.key),
  position, default jsonb` — unique `(product_id, field)`.
- `project_nodes.product_id uuid null references sales_products on delete set null` (new column).
  `product_type` text stays: on pick it is set to the product's name in the record's language-
  neutral form (`name_en` if set else `name_fa`) — builder may instead show the product name
  from `product_id` and keep `product_type` only for imported/old rows; either keeps old rows
  readable. **Builder's call, note it in the plan.**
- New permission key? **No.** Read = `sales`; edit products = `sales_settings` (same as the
  column library). Catalog key count stays 33.

### 5.3 Using a product on an item row
- Technical proposal → Items → row editor: **Product** is a picker (search by name/code), not
  free text (owner rule: known values are picked from lists — memory `erp-predefined-inputs`).
  "None / other" stays possible for one-off items (free `product_type`).
- Picking a product: (a) adds the product's columns to the record's shown item columns
  (`sales_rfps.item_columns`) if missing; (b) fills each of those columns on that row **only where
  the row's value is empty** with the product default. Values are **copied**; later product edits
  never touch existing rows (decided).
- Changing a row's product: same as picking; values already typed stay. Clearing the product
  keeps the values.
- Child rows (parts) do not inherit the product in v1; they may pick their own.
- Activity log: "Product set to X on 8997-1".

### 5.4 Products page
- New ERP tab **Products** (`/sales/products`) beside Customers; visible to `sales` readers,
  editable by `sales_settings`. Name chosen to be found by the CEO's word.
- List (`data-table`): code, name, number of columns, used-on-items count, active.
- Product page: name fields, then an ordered list of columns with their default value editors
  (reuse `StageFields`-style typed inputs), add column (from library or new), remove, reorder.
- Deactivating hides it from pickers; rows using it keep it.

## 6. Record files

### 6.1 What the user sees
- Record view bottom tabs gain **Files** (after Activity, Deadlines) with a count.
- Grouped by stage, covering **every flow the record has been in**: a Won record that moved to
  the Contract flow still shows its bid-flow groups (Received, Technical proposal…) first, then
  the contract stages. The RFP pack must stay visible to the people running the contract.
  Each group: file name, size, uploaded by,
  date, download, delete (if allowed). Empty stage groups collapse to one line with Upload.
- **Upload** button per stage group, and a page-level Upload that defaults to the record's current
  stage. Multiple files at once, drag-and-drop on desktop, progress per file, 50 MB cap per file
  checked in the browser and again on the server.
- Any file type. Name kept as uploaded (shown with `<bdi>`); download sends the original name.
- On the Received stage page, a short line "Upload the RFP documents in Files" links to the tab
  (the CEO's example). Builder may show the Received group inline instead — builder's call.

### 6.2 Data
`public.sales_files` (functions only):
`id, company_id, rfp_id, stage_id (the stage the file belongs to; FK `on delete restrict` —
a stage holding files cannot be deleted, only deactivated, as for records), name (≤ 255), size_bytes
(1 … 52 428 800), mime (as sent, ≤ 200, informational only), sha256, status
('pending' | 'ready'), uploaded_by, uploaded_at`. Index `(rfp_id, stage_id)`.
Deleting a file deletes the row (and the bytes, §6.5); the activity log keeps "File X deleted by Y".

### 6.3 Who may do what
| Action | Rule |
|---|---|
| See the list / download | `sales` read on the record (all files, §6.4) |
| Upload | `sales` edit and `private.sales_writable(rfp)` (closed record = no new files) |
| Delete | the uploader, or a `sales_settings` holder; also needs `sales_writable` |
| View as (FR-86) | list and download allowed; upload and delete refused |
| Test accounts (FR-95) | own data only → no Sales access, as today |

### 6.4 Prices inside files — decided: no restriction
Owner decision 2026-11-20: everyone with `sales` read on the record sees every file, including
financial offers and guarantee letters. No per-file flag, no stage rule. This knowingly accepts
that a person without `sales_prices` / `sales_bonds` can read prices inside files (the anti-goal
in §2 is narrowed to price *fields*). Adding a flag later = one column + a check in
`app_sales_file_get`/list.

### 6.5 How bytes move (approach A, chosen)
- Bytes live on a Docker volume `sales-files` mounted in the `app` container at
  `FILES_DIR=/data/files` (env, default for dev `./.files`, git-ignored). Path:
  `<company_id>/<rfp_id>/<file_id>` — never the user's file name.
- **Upload** — route handler `POST /api/sales/files` (raw request body + `X-File-Name` header — plan decision
  2026-11-20, `formData()` buffers whole files; streamed to a temp file in
  the same volume, never buffered whole in memory):
  1. `requireCaller`-style session check with `createClient()`; refuse under View as.
  2. `app_sales_file_begin(rfp, stage, name, size, mime)` → checks §6.3, inserts a `pending` row,
     returns `id` (+ company_id). Size > cap → refused before reading the body.
  3. Stream body to `<dir>/tmp/<id>`, count bytes (abort past 50 MB or past the declared size),
     hash sha256, `rename` into place.
  4. `app_sales_file_commit(id, size, sha256)` → `ready`, writes the activity event.
  Failure at any step: delete temp file; the pending row is removed by the handler, and a daily
  clean-up (`sales_files` pending > 1 day, plus orphan files with no row) catches crashes.
- **Download** — `GET /api/sales/files/<id>`: `app_sales_file_get(id)` (stable, read-only; returns
  the row only if §6.3/§6.4 allow) → stream with `Content-Disposition: attachment;
  filename*=UTF-8''…`, `Content-Type: application/octet-stream`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: private, no-store`. Never `inline` (uploaded HTML/SVG must not run on our origin).
- **Delete** — `app_sales_file_delete(id)` (checks, deletes row, logs) then the handler unlinks
  the bytes; a missing file on disk is not an error.
- Redirects/links built as relative paths (CLAUDE.md gotcha: `request.nextUrl` holds the
  container origin).
- **Must verify (Context7 / Next 16 docs):** the body-size limit `proxy.ts` (middleware) applies
  to requests it sees — either raise it for `/api/sales/files` or exclude that path from the
  proxy matcher and do the session refresh in the handler. Caddy has no default body limit;
  confirm on the Liara Caddyfile anyway, and set the handler's timeout for slow uploads.
- The app container runs as `node` with `cap_drop: ALL`: the volume must be writable by that
  user (init the directory owner in the image or entrypoint).

### 6.6 Storage interface (S3 later)
All disk access goes through `lib/files/store.ts` with `put(key, stream)`, `get(key)`,
`remove(key)`, `exists(key)`. Only the disk implementation is built now. Moving to Liara S3 later
= a second implementation + a one-off copy script; tables and routes do not change.

### 6.7 Backups, deploy, local
- `deploy/docker-compose.yml`: `sales-files` volume on `app`; same in the Liara and local
  compose overrides.
- `deploy/liara/backup.sh`: after the DB dump, `rsync` the volume into **one mirror**
  `/var/backups/bj-erp/files/` (files are write-once by id, so each run copies only new ones;
  deleted files are kept in the mirror for 30 days, then pruned). No per-run tars — full copies
  per dump would fill the disk. `pull-backups-to-mac.sh` rsyncs the same mirror (incremental
  over the slow route). Restore runbook in `docs/DEPLOY-LIARA.md` and "Running the app locally" in
  `docs/DEPLOY-ASSISTANT.md` gain the files step. A DB restored without its files shows rows
  whose download fails with "file missing" — handled, not a crash.
- Disk: note the VM's free disk in the deploy log before the first release; 50 MB × many records
  grows — TASKS line to watch it.

## 7. "Our total price"
Label only: `sales.field.our_price` → "Our total price" / «قیمت کل ما» (builder: check the
existing fa string and keep its wording style), plus every other message that names this figure
(`pricedByItems`, reports column, CSV header, list column). No data change.

## 8. Branch and migrations
- First step: merge `main` into `feat/erp-sales-module` (18 commits behind on 2026-11-20) and
  re-run unit tests, `tsc`, build. Resolve `schema.sql`, `messages/*.json`, `CLAUDE.md`,
  `docs/*` conflicts keeping both sides.
- `main` already has migrations dated 2026-11-19; the branch's are 2026-11-16/17. New migrations
  here are dated 2026-11-20+. Checked 2026-11-20: `deploy/lib/migrations.sh` applies every
  unrecorded file in name order and accepts older names, and main's 11-18/19 migrations redefine
  no function the Sales migrations touch. **No renaming needed.**
- Usual rules: functions only, JSON in/out, types in `lib/sales/types.ts`, `schema.sql` updated
  by diffing the branch DB, SQL tests in `tests/sql/`, fa + en strings, DESIGN.md.

## 9. Tests (minimum)
- SQL: currency validate/deactivate; product CRUD + copy-on-pick never overwrites typed values;
  files begin/commit/get/delete permission matrix incl. View as, closed record,
  cross-company id.
- Unit: currency formatting by decimals; product default fill; title-link section matching.
- e2e (local stack): upload a file on Received, see it from another `sales` user, delete as
  uploader, refused delete as non-uploader; 50 MB + 1 byte refused.

## 10. Decisions made in chat (2026-11-20)
| Topic | Decision |
|---|---|
| File storage | Disk on Liara VM (Docker volume); maybe Liara S3 later |
| Files vs checklist | Separate Files tab, grouped by stage; checklist unchanged |
| File rules | 50 MB, any type, uploader (or Sales admin) deletes |
| Products | Columns + default values; values copied, later product edits don't touch old rows |
| Currency | Admins add / rename / hide, free codes (e.g. Toman) |
| Title link | Every section; looks like a button |
| "Our total price" | Everywhere that figure appears |
| Price/bond files | No restriction: every `sales` reader sees every file |

## 11. Builder's calls (made in this spec, owner may override)
- Title button style and whether it is disabled on the section's main page (§3).
- Currency `symbol` + `decimals` columns (§4.1).
- Products tab name/location `/sales/products`; editing needs `sales_settings`, no new key (§5).
- `product_type` kept alongside `product_id` (§5.2); child rows don't inherit product (§5.3).
- Closed records accept no new files (§6.3).
- Downloads always as attachment, never inline (§6.5).
- Files grouped across every flow the record has been in; stage with files cannot be deleted (§6.1–6.2).
- Currency decimals 0–2, display only (§4.1).
- File backup = one rsync mirror, deleted files kept 30 days (§6.7).
