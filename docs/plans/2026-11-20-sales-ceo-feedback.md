# Sales CEO Feedback (round 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clickable section title, company-managed currencies, "Our total price", a Products catalog that pre-fills item rows, and per-record file uploads grouped by stage.

**Architecture:** Every Sales change follows the module's pattern: `sales_*` tables with no client grants, `app_sales_*` SECURITY DEFINER functions (JSON in/out), server actions in `lib/actions/sales.ts`, pure helpers in `lib/sales/*`. Files are the one new path: Next.js route handlers under `app/api/sales/files` stream bytes to a Docker volume through `lib/files/store.ts`; SQL functions own every permission check and the metadata.

**Tech Stack:** Next.js 16 App Router, TypeScript, self-hosted Supabase (Postgres + PostgREST), next-intl (fa/en), Vitest, Playwright, Docker Compose on Liara, Caddy.

**Spec:** `docs/specs/2026-11-20-sales-ceo-feedback-design.md` (read it with this plan). Base: `docs/specs/2026-11-16-sales-rfp-module-design.md`.

## Global Constraints

- Work in the worktree `/Users/amir/Workspace/bj-sales` on `feat/erp-sales-module`. Never push. Commit per task only after the owner has OK'd commits for this run (ask once before Task 0); commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Migrations: new files only, dated `20261120…`; never edit an existing migration. After each migration, update `supabase/schema.sql` by diffing schema dumps of the branch DB before/after (CLAUDE.md: local `postgres` has ACL drift; `npm run schema:dump` is wired to `postgres`). Never commit re-parenthesized CHECK hunks.
- Dry-run each migration on a clone first (CLAUDE.md "Dry-run migrations first").
- New Sales tables: `company_id`, no grants to `anon`/`authenticated`, comment `'FR-94: … Functions only.'`. Writes: `private.sales_company(key, level)` → `private.sales_rfp(rfp, company)` (locks) → `private.sales_writable(rfp)` where the spec says → `private.sales_touch(rfp, kind, body)`. Re-raise CHECK failures as `sales: invalid input` (errcode `22023`). Read functions `stable`, no writes/locks.
- `lib/supabase/types.ts` and `lib/sales/types.ts` are hand-edited; verify with `npx tsc --noEmit` and `npm run build`.
- All UI copy in `messages/fa.json` + `messages/en.json` under `sales.*` (or `nav.*` for Task 1). Client components use `useTranslations`. Follow `docs/DESIGN.md`: `data-table`, tabs from `lib/ui/tabs.ts`, no `shadow-*`, no `rounded-full` except circles, light only.
- Known-value fields are picked from lists, never free-typed (product, currency).
- File cap: **52 428 800 bytes (50 MB)** per file, any type. Disk path `<company_id>/<rfp_id>/<file_id>`; env `FILES_DIR` (container `/data/files`, dev default `./.files`, git-ignored).
- Downloads: `Content-Disposition: attachment; filename*=UTF-8''<encoded>`, `Content-Type: application/octet-stream`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. Never inline.
- Currency code `^[A-Za-z0-9]{1,10}$`; `decimals` 0–2, display only. Seed: IRR(0), EUR(2), USD(2), AED(2), CNY(2).
- Permission catalog stays at **33** keys (no new key).
- Route handlers build redirects/links as relative paths only.
- **View as (FR-86) in SQL is not a function call:** `private.view_as_pre_request` swaps `auth.uid()` to the target and sets `transaction_read_only = on`, so any write (insert/update/delete, `select … for update`) fails with SQLSTATE **`25006`**. There is no `private.view_as_active()`; write functions need no extra check. SQL tests simulate it with `set local transaction_read_only = on;` — irreversible inside the test transaction, so it goes in the **last** section of the file (see `tests/sql/sales.sql` "read-only and isolation"). Route handlers refuse writes up front when the `VIEW_AS_COOKIE` (`lib/supabase/constants.ts`) cookie is present, and map `25006` → 403. Client components read View as with `useViewAs()` from `app/[locale]/(app)/_components/ViewAsContext.tsx`.
- **Caps in the bootstrap** (`app_sales_bootstrap()->'caps'`, TS `SalesCaps`): `edit` (sales edit), `settings` (sales_settings edit), `decide`, `prices`, `prices_edit`, `bonds`, `bonds_edit`, `reports`, `items` / `items_edit` (`project_items`). "Record writable" in the UI = `record.stage_kind === 'open' || boot.caps.decide` (mirrors `private.sales_writable`; see `ActivityLog.tsx`).
- **`sales_events.kind` has a CHECK** (`sales_events_kind_check`: created, edit, stage, decision, result, comment, import, items, finance). A new event kind needs the constraint dropped and re-added in a migration, a new `EventKind` member in `lib/sales/types.ts`, and a case in `ActivityLog.tsx` (`line()`); a new `items` action needs a case too (it calls `t('event.item_<action>')`).

## Review Focus

1. **Upload larger than declared / than 50 MB, or a client that lies about size** → handler aborts at the cap, temp file removed, row deleted; no partial file left. Test in Task 6. (The upload is a raw-body POST, not multipart as spec §6.5 says — Task 6 explains why; same steps otherwise.)
2. **File id from another company or a record the caller cannot read** (guessed UUID in `/api/sales/files/<id>`) → 404, same as missing; never a different error that confirms existence. Test in Task 5 (SQL) and Task 6 (route).
3. **File name with path parts, RTL/Persian characters, quotes or newlines** (`../../x`, `قرارداد "نهایی".pdf`) → stored name is display-only, disk key is the id, header encodes it safely. Test in Task 6.
4. **Picking a product on a row that already has typed values** → typed values stay; only empty cells get defaults; existing records untouched when the product later changes. Test in Task 4 (SQL + unit).
5. **A currency deactivated or renamed while records use it** → old records still show its name; pickers hide it; saving an old record that keeps its (inactive) code still works. Test in Task 3.

---

### Task 0: Bring `main` into the branch

**Files:** merge only; conflicts most likely in `supabase/schema.sql`, `messages/*.json`, `CLAUDE.md`, `docs/AGENT-LOG.md`, `docs/TASKS.md`, `docs/CHANGELOG.md`, `lib/permissions/catalog.ts`.

- [ ] **Step 1:** `git -C /Users/amir/Workspace/bj-sales merge main` (18 commits). Resolve conflicts keeping both sides; for `schema.sql` take main's hunks and re-apply the branch's Sales hunks.
- [ ] **Step 2:** Set up node_modules: `cp -Rc ../bj/node_modules node_modules` (never symlink — breaks `next build`).
- [ ] **Step 3:** Branch DB: check `docker exec bj-erp-db-1 psql -U supabase_admin -lqt` for an existing Sales branch database. If none, create one per CLAUDE.md "Separate DB for a long-lived branch" and apply main's `20261118*`/`20261119*` migrations plus the branch's Sales migrations. Record the DB name in the AGENT-LOG entry.
- [ ] **Step 4:** Run `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, `npm run build`. Expected: all pass. Run `tests/sql/sales*.sql` against a clone of the branch DB. Expected: all pass.
- [ ] **Step 4b:** Check FR-95 against Sales: `private.sales_can` does not call `private.is_test_account`, so a `test-emp` user who also holds a role with `sales` would reach Sales (spec §6.3 assumes "no Sales access"). Lead decision: fixed in Task 5's migration (see there); nothing to do in Task 0.
- [ ] **Step 5:** Commit the merge (`git commit` with the default merge message + Co-Authored-By).

---

### Task 1: Clickable section title (all sections)

**Files:**
- Modify: `app/[locale]/(app)/_components/MobileTopBar.tsx`
- Create: `lib/nav/sectionFor.ts`
- Modify: `messages/en.json`, `messages/fa.json` (`nav.goTo`)
- Test: `tests/unit/section-title.test.ts`

**Interfaces:**
- Produces: `sectionFor(path: string): { href: string; key: string } | null` (moves `SECTIONS` out of the component, longest-match-first order unchanged). `path` has the locale prefix already stripped — keep the component's existing stripping (`usePathname()` has no prefix in Farsi, CLAUDE.md). Take `SECTIONS` from the post-merge `MobileTopBar.tsx` (Task 0 may have changed it).

- [ ] **Step 1: Write the failing test**

```ts
import { sectionFor } from '@/lib/nav/sectionFor';
it('maps a record page to the ERP list', () => expect(sectionFor('/sales/8f1c…-uuid')).toEqual({ href: '/sales', key: 'erp' }));
it('keeps the longest match', () => expect(sectionFor('/manage/approval-steps/x')).toEqual({ href: '/manage/approval-steps', key: 'approvalSteps' }));
it('exact root', () => expect(sectionFor('/home')).toEqual({ href: '/home', key: 'home' }));
it('no match', () => expect(sectionFor('/zz-preview')).toBeNull());
it('no false prefix', () => expect(sectionFor('/salesx')).toBeNull());
```

- [ ] **Step 2:** `npx vitest run tests/unit/section-title.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `sectionFor` in `lib/nav/sectionFor.ts`; `MobileTopBar` uses it and renders a `Link` (`/${locale}${href}`, `data-testid="mobile-section-link"`, `aria-label={t('goTo', { section })}`) styled as a button: `inline-flex items-center gap-1 rounded-md border border-white/40 px-2.5 py-1 hover:bg-white/10 active:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white` with a chevron from the existing icon set (`rtl:rotate-180`). No match → plain `<span>` with the app name. Messages: en `"goTo": "Go to {section}"`, fa `"goTo": "رفتن به {section}"`.
- [ ] **Step 4:** Test passes; `npx tsc --noEmit` clean. Visual check at 375px (fa and en) via the dev server: title has a visible border + chevron, tapping it on a record page lands on `/sales`. Screenshot.
- [ ] **Step 5:** Commit `feat(nav): section title links to the section's main page`.

---

### Task 2: "Our total price"

**Files:** Modify `messages/en.json`, `messages/fa.json` only.

- [ ] **Step 1:** `grep -n "our_price\|Our price\|our price\|قیمت ما" messages/*.json` and list every string naming this figure. Known today: `sales.field.our_price`, `sales.…pricedByItems`, and the `sales_prices` permission description (`"Read: unit prices, our price, …"`, line ~1905). Reports/CSV/list columns read `t('field.our_price')`, so they follow. Also `grep -rn "Our price" tests/` (e2e text selectors).
- [ ] **Step 2:** en: "Our price" → "Our total price" in each. fa: «قیمت ما» → «قیمت کل ما» (keep each string's existing wording otherwise).
- [ ] **Step 3:** `npm run test:unit` (message-key parity tests) → PASS. Grep shows no remaining "Our price" in en.
- [ ] **Step 4:** Commit `feat(sales): label our price as our total price`.

---

### Task 3: Currencies managed in Settings

**Files:**
- Create: `supabase/migrations/20261120100000_sales_currencies.sql`
- Create: `lib/sales/money.ts`
- Modify: `lib/sales/types.ts` (remove `CURRENCIES`; add `Currency`; `Bootstrap.currencies`), `lib/actions/sales.ts`, `app/[locale]/(app)/sales/layout.tsx` (currency provider), `app/[locale]/(app)/sales/_components/parts.tsx` (`useSalesFormat().money`), `SettingsView.tsx`, `RecordForm.tsx`, `StageFields.tsx` (picker + `case 'currency'` display), `StageActions.tsx` (winning-bid hint), `RecordPanels.tsx` (bond/payment hints), `CustomersList.tsx` (`customers.salesCur`/`quotedCur` labels), `MetricsStrip.tsx`, `RecordsTable.tsx`, `ReportsView.tsx` (table + CSV currency column), `lib/sales/customers.ts` (`presentCurrencies` order), `lib/sales/ledger.ts` (ledger import mapping), `ImportPanel.tsx` (passes currencies to the ledger parser), `messages/*.json` (drop `sales.currency.*`, add `sales.settings.currencies.*`), `supabase/schema.sql`, `lib/supabase/types.ts`, `tests/unit/sales-customers.test.ts`, `tests/unit/sales-ledger.test.ts`
- **Not changed:** `lib/sales/inquiry.ts` and `app_sales_import_inquiries` — the inquiry file has a Rial column and a Euro column, so its `'IRR' | 'EUR'` is structural, not a typed code (both are seeded and can only be deactivated, never deleted). `sales_payments` and `sales_quote_lines` have no currency column (they use the record's).
- Test: `tests/sql/sales-currencies.sql`, `tests/unit/sales-money.test.ts`

**Interfaces:**
- Produces (SQL): table `public.sales_currencies(company_id, code, name_fa, name_en, symbol, decimals, active, position)` PK `(company_id, code)`; `private.sales_currency_ok(p_company uuid, p_code text, p_old text default null) returns boolean` (true when `p_code` is null, equals `p_old`, or is an active code of the company); `public.app_sales_save_currency(p_code text, p jsonb) returns void` (insert when the code is new, else update names/symbol/decimals/active/position; `p` never changes the code — there is no rename; needs `sales_settings` edit; CHECK failures re-raised as `sales: invalid input`); `public.app_sales_delete_currency(p_code text) returns void` (only if unused in `sales_rfps`, `sales_bonds`; else `sales: in use`); `app_sales_bootstrap()` gains `currencies: Currency[]` (all, incl. inactive, ordered by position) — redefine it from its current `schema.sql` body, adding only that key.
  - Validation calls (the `p_old` argument): `app_sales_save_record` → `v_old.currency` (null for a new record); `app_sales_save_bond` → the stored bond's currency for an edit, the record's currency (`r.currency`, the default of a new bond) for a new one; `app_sales_import` → validate the record currency and the bond currency with `p_old` = the stored value, and keep today's shape (an invalid code is **ignored**, `coalesce` keeps the stored value — the TS preview already flags it), replacing the two `~ '^[A-Z]{3}$'` tests (record ~line 9426, bond ~9477 in `schema.sql`).
- Produces (TS): `type Currency = { code: string; name_fa: string; name_en: string; symbol: string | null; decimals: number; active: boolean; position: number }`; `formatMoney(n: number | null | undefined, code: string | null | undefined, currencies: Currency[], locale: string): string` (fraction digits = `decimals`, via `formatNumber(n, locale, { minimumFractionDigits: d, maximumFractionDigits: d })` from `lib/i18n/format.ts`); `currencyLabel(code, currencies, locale): string`; `matchCurrency(text: string, currencies: Currency[]): string | null` (code or either name, case/space-insensitive; then the ledger's existing alias table — `€`, `$`, `dollar`, `uds`, `rial(s)`, `dirham`, `yuan`, `یورو`… — kept as a fallback so old ledger files still map).
  - `useSalesFormat()` has no `boot`: add `SalesCurrenciesProvider` / `useSalesCurrencies()` (React context, in `parts.tsx` or its own file) filled in `sales/layout.tsx` from `boot.currencies`; `useSalesFormat().money` reads it, so the ~30 existing `f.money` call sites stay unchanged.
  - `presentCurrencies(rows, field, currencies: Currency[])` orders by `position`, unknown codes last (sorted).

- [ ] **Step 1: Failing SQL test** `tests/sql/sales-currencies.sql` (copy the header of `tests/sql/sales-stage-pages.sql`): assert (a) seeded five codes for the fixture company; (b) a `sales_settings` holder adds `TMN` / «تومان» / Toman, decimals 0; (c) a plain `sales` user gets `ERROR 42501` adding one; (d) `app_sales_save_record` with currency `TMN` succeeds, with `XYZ` → `ERROR 22023 sales: invalid input`; (e) deactivate `TMN` → saving the same record again unchanged succeeds (old code kept), a new record with `TMN` fails; (f) `app_sales_delete_currency('TMN')` → `sales: in use`; (g) bond with `TMN` saved via `app_sales_save_bond` succeeds before deactivation; (h) `app_sales_bootstrap()->'currencies'` includes inactive `TMN` with `active=false`; (i) a company created inside the test (insert into `public.companies`) gets the five seeded codes through the trigger. One statement per assertion step.
- [ ] **Step 2:** Run on a clone → FAIL (table missing).
- [ ] **Step 3: Migration.** Create table (checks: code regex, names 1–40, symbol ≤ 6, decimals 0–2; no grants; comment `FR-94: … Functions only.`). Seed: redefine `private.sales_ensure(p_company)` (the per-company seeder; `private.companies_seed_sales()` is only the trigger that calls it, and `app_sales_save_record` calls it too) to also `insert … on conflict do nothing` the five currencies, then `select private.sales_ensure(id) from public.companies` for existing companies (idempotent). `alter table public.sales_rfps drop constraint sales_rfps_currency_check` and `alter table public.sales_bonds drop constraint sales_bonds_currency_check`, add `currency ~ '^[A-Za-z0-9]{1,10}$'` checks under the same names. `private.sales_currency_ok`; redefine `app_sales_save_record`, `app_sales_save_bond`, `app_sales_import` to validate with it (copy their current bodies from `schema.sql`, change only the currency check — `save_record` carries the stage-page changes, keep them). In `save_record`/`save_bond` an invalid code raises `sales: invalid input` (`22023`) **before** the update. Do **not** redefine `app_sales_import_inquiries` (see "Not changed"). New save/delete functions; bootstrap adds currencies.
- [ ] **Step 4:** SQL test PASS on clone; all `tests/sql/sales*.sql` still PASS. Apply to branch DB, update `schema.sql` (diff method).
- [ ] **Step 5: Failing unit test** `tests/unit/sales-money.test.ts`: fixture `usd = {code:'USD', name_en:'US dollar', name_fa:'دلار', symbol:'$', decimals:2}`, `irr = {code:'IRR', name_en:'Rial', name_fa:'ریال', symbol:null, decimals:0}`: `formatMoney(1234.5,'USD',[usd],'en')` → `'1,234.50 $'` (symbol when set); `formatMoney(1500000,'IRR',[irr],'fa')` → `'۱٬۵۰۰٬۰۰۰ ریال'` (no symbol → `name_<locale>`, digits via the existing `formatNumber`); unknown code `'ZZZ'` → raw code; `null` → `'—'`; `matchCurrency(' toman ', withTmn)` → `'TMN'`; `matchCurrency('تومان', withTmn)` → `'TMN'`.
- [ ] **Step 6:** Implement `lib/sales/money.ts` and the currencies context; `f.money` delegates to `formatMoney`; replace every `CURRENCIES` / `` t(`currency.${…}`) `` use (`grep -rn "CURRENCIES\|currency\.\${" lib app` must return nothing). Customers column headers use `currencyLabel` instead of the raw code; the Reports CSV currency column writes the label. Pickers list `active` only, plus the record's (or bond's) current code if inactive. Ledger import (`lib/sales/ledger.ts`) maps with `matchCurrency(text, currencies)`; unknown text → a preview error like other unmatched values; update `tests/unit/sales-ledger.test.ts` and `tests/unit/sales-customers.test.ts` for the new parameters.
- [ ] **Step 7: Settings UI** — `SettingsView` Currencies section: `data-table` (code, fa, en, symbol, decimals, active toggle, up/down), Add row dialog; code read-only after save; Delete only offered for a code no record uses (the server decides; show `sales: in use` as a translated message). Edit controls only when `boot.caps.settings`. Actions `saveSalesCurrency(code, patch)`, `deleteSalesCurrency(code)` in `lib/actions/sales.ts` (`requireCaller` first).
- [ ] **Step 8:** `npm run test:unit`, `npx tsc --noEmit`, `npm run build` PASS. Browser check: add Toman in Settings, pick it on a record, amount shows «تومان».
- [ ] **Step 9:** Commit `feat(sales): company-managed currencies`.

---

### Task 4: Products catalog + item pre-fill

**Files:**
- Create: `supabase/migrations/20261120110000_sales_products.sql`
- Create: `lib/sales/products.ts`
- Create: `app/[locale]/(app)/sales/products/page.tsx`, `app/[locale]/(app)/sales/products/[id]/page.tsx`, `app/[locale]/(app)/sales/_components/ProductsList.tsx`, `app/[locale]/(app)/sales/_components/ProductEditor.tsx`, `app/[locale]/(app)/sales/_components/ProductPicker.tsx`
- Modify: `SalesTabs.tsx` (Products tab after Customers, every `sales` reader), `ItemsTab.tsx` (product picker replaces free `product_type` input; "Other" keeps free text; local `Draft` gains `product_id`; the save patch sends it), `ActivityLog.tsx` (items action `product` → `event.item_product`), `MobileTopBar` needs nothing (under `/sales`), `lib/sales/types.ts` (`NodeRow.product_id`), `lib/actions/sales.ts`, `messages/*.json`, `supabase/schema.sql`, `lib/supabase/types.ts`
- Test: `tests/sql/sales-products.sql`, `tests/unit/sales-products.test.ts`
- **Builder's call (spec §5.2), decided here:** on pick, `product_type` is overwritten with the product name, so price history, node search and quote snapshots (which read `product_type`) keep working unchanged.

**Interfaces:**
- Produces (SQL): `public.sales_products(id, company_id, code null, name_fa, name_en, active, position, created_by/at, updated_by/at)` unique `(company_id, code)`; `public.sales_product_fields(product_id, field text, position, "default" jsonb)` unique `(product_id, field)`, `field` ∈ built-ins `size|rating|qty|unit` or an active item `sales_field_defs.key` of the company (validated in the save function); `project_nodes.product_id uuid null references sales_products(id) on delete set null`.
  - `public.app_sales_products() returns jsonb` (stable; `sales` read) → `Product[]` with fields and `used_count` (number of `project_nodes` with that `product_id`).
  - `public.app_sales_save_product(p_id uuid, p jsonb) returns uuid` (`sales_settings` edit; `p = {code,name_fa,name_en,active,position,fields:[{field,default}]}`; replaces field list; validates each default against the field's type and `select` options; built-ins `size|rating|unit` take text ≤ 200/40, `qty` a number ≥ 0; CHECK/unique failures re-raised as `sales: invalid input`).
  - `public.app_sales_delete_product(p_id uuid) returns void` (only if no `project_nodes.product_id` uses it, else `sales: in use`).
  - `app_project_save_node(p_rfp, p_id, p_parent, p)` (redefine from its current body; it needs `project_items` edit and does **not** call `sales_writable` — keep that): add `product_id` to the accepted keys and to the `update … set` list. Key absent → unchanged; `null` → cleared (values stay). When it is set and differs from the stored one: the product must be of the caller's company and active (else `22023`); set `product_type` to the product name (`name_en`, else `name_fa`); **after** the patch is applied, fill each product field that is empty on the row (built-in column null/'' or `custom->key` absent/null/'') with its default; and add missing product fields to `sales_rfps.item_columns->'<depth>'`. When that key is absent, start from the effective list the UI shows (mirror `columnsForDepth` in `lib/sales/tree.ts`: own depth → depth 1 = `product_type,size,rating,qty,unit` → nearest depth ≥ 2 above → `qty,unit`), never from an empty list (and `item_columns` itself may be NULL). The single `sales_touch(rfp,'items',…)` event uses `{action:'product', code, product:<name>}` instead of `changed`/`added` when the product changed (one event per save).
- Produces (TS): `type Product = { id: string; code: string | null; name_fa: string; name_en: string; active: boolean; position: number; used_count: number; fields: { field: string; default: string | number | boolean | null }[] }`; `type ProductRowValues = { product_id?: string | null; product_type: string; size: string; rating: string; qty: number | null; unit: string; custom: CustomValues }` (the shape of `ItemsTab`'s `Draft`, which has no shared export today); `applyProductDefaults<T extends ProductRowValues>(row: T, product: Product): T` (pure; same empty rule as SQL) used by `ItemsTab` to preview before save; actions `listSalesProducts()`, `saveSalesProduct(id, patch)`, `deleteSalesProduct(id)`.

- [ ] **Step 1: Failing SQL test** `tests/sql/sales-products.sql`: (a) `sales` user cannot save a product (`42501`), `sales_settings` holder can; (b) default `'12in'` for `size` and `'WCB'` for select field `x_body` with options `{WCB,CF8M}` saves; default `'ZZZ'` for `x_body` → `22023`; (c) node with `size='6in'` typed on a record whose `item_columns` is NULL, pick product → `size` stays `6in`, `x_body` becomes `WCB`, `product_type` = product name, `item_columns->'1'` = the five built-ins plus `x_body`; one `items` event with `action='product'`; (c2) sending `product_id: null` clears it and keeps `x_body`; (d) edit product default `x_body` to `CF8M` → that node still `WCB`; (e) delete product in use → `sales: in use`; (f) product id from another company in `p.product_id` → `22023`; (g) closed record → `app_project_save_node` follows its existing writable rule (unchanged).
- [ ] **Step 2:** Run on clone → FAIL.
- [ ] **Step 3:** Migration (tables, column, functions; redefine `app_project_save_node` from its current `schema.sql` body, adding only the product branch). Apply to clone, test PASS; all `tests/sql/sales*.sql` PASS; apply to branch DB; update `schema.sql`.
- [ ] **Step 4: Failing unit test** `tests/unit/sales-products.test.ts`: with `row = {product_type:'', size:'6in', rating:'', qty:null, unit:'', custom:{}}`, `applyProductDefaults(row, gate)` → `size:'6in'`, `custom.x_body:'WCB'`, `product_id: gate.id`, `product_type:'Gate valve'`; empty string counts as empty; `0` and `false` count as filled.
- [ ] **Step 5:** Implement `lib/sales/products.ts`.
- [ ] **Step 6: UI.** Products tab (`/sales/products`; the sales layout already sets `data-wide` and returns `notFound()` without `sales`): list `data-table` (code, name, column count, used-on-items count, active). Product page: names, code, active; ordered column list with typed default editors (`CustomFieldInput` from `parts.tsx` for library columns; text/number inputs for built-ins), "Add column" picks from the item library (`boot.fields` with `entity === 'item'`) or creates one through the existing `saveSalesField` (entity `item`); edit controls only when `boot.caps.settings`. `ItemsTab` row editor: `ProductPicker` (search by name/code, active only plus the row's current product, "Other…" reveals the free `product_type` text input); on pick call `applyProductDefaults` for the draft. `ActivityLog`: `event.item_product` = "Product set to {product} on {code}" / fa.
- [ ] **Step 7:** `npm run test:unit`, `npx tsc --noEmit`, `npm run build` PASS. Browser check: create "Gate valve" with Size + Body material defaults, add an item on a record, pick it, see defaults; edit the product, the existing row is unchanged.
- [ ] **Step 8:** Commit `feat(sales): products catalog pre-fills item rows`.

---

### Task 5: Files — database

**Files:**
- Create: `supabase/migrations/20261120120000_sales_files.sql`
- Modify: `supabase/schema.sql`, `lib/supabase/types.ts`, `lib/sales/types.ts` (`SalesFile`, `RecordDetail.files`, `EventKind` gains `'file'`)
- Test: `tests/sql/sales-files.sql`

**Interfaces:**
- Produces (SQL): `public.sales_files(id, company_id, rfp_id → sales_rfps on delete cascade, stage_id → sales_stages on delete restrict, name text 1–255, size_bytes bigint 1–52428800, mime text ≤ 200, sha256 text null (`^[0-9a-f]{64}$` when set), status text 'pending'|'ready', uploaded_by → profiles on delete set null, uploaded_at timestamptz default now())`, index `(rfp_id, stage_id)`. No grants; comment `FR-94: … Functions only.`
  - Same migration: `alter table public.sales_events drop constraint sales_events_kind_check`, re-add it with `'file'` appended (Global Constraints: `sales_events.kind`).
  - `public.app_sales_file_begin(p_rfp uuid, p_stage uuid, p_name text, p_size bigint, p_mime text) returns jsonb` → `{id, company_id}`; `private.sales_company('sales','edit')` → `private.sales_rfp(p_rfp, company)` (lock) → `private.sales_writable(p_rfp)`; `p_stage` must be a stage of any flow of the company (else `22023`); size outside 1–52428800, name empty/> 255 or containing control characters → `22023`. View as needs no code: the read-only transaction refuses the lock/insert with `25006`.
  - `public.app_sales_file_commit(p_id uuid, p_size bigint, p_sha256 text) returns void` → only the uploader, only `pending`, `p_size` must equal the declared `size_bytes` (else `22023`); sets `ready` + `sha256`, logs `sales_touch(rfp,'file',{action:'add',name,stage})`. Locks the record row first (`private.sales_rfp`), then the file row.
  - `public.app_sales_file_abort(p_id uuid) returns void` → uploader deletes own `pending` row (no event).
  - `public.app_sales_file_get(p_id uuid) returns jsonb` (`stable`, no locks — runs under View as) → `{id, company_id, rfp_id, name, size_bytes}` for a `ready` row of the caller's company the caller can read (`private.sales_company()` = `sales` read); a missing id, another company's id, or a `pending` row all raise `sales: not found` (`P0002`). (A caller without `sales` gets `42501` from `sales_company`; the route maps both to 404.)
  - `public.app_sales_file_delete(p_id uuid) returns jsonb` → `{company_id, rfp_id}`; uploader or `sales_settings` holder, plus `sales_writable`; lock the record, then delete the row; logs `{action:'delete',name}`; missing/other company → `P0002`.
  - `public.app_sales_record(p_id)` gains `files: SalesFile[]` (`ready` only; `{id, stage_id, name, size_bytes, uploaded_by, uploader_name, uploaded_at, can_delete}`; `can_delete` = (uploader or `sales_settings`) and (stage kind open or `sales_decide`) and `sales` edit). Redefine from its current body, adding only this key.
  - `private.sales_files_gc() returns setof jsonb` (`{id, company_id, rfp_id}` of `pending` rows older than 1 day, deleting them) — called by the clean-up script as `supabase_admin` (Task 8); `revoke all … from public, anon, authenticated`.
  - `private.sales_file_ids() returns setof uuid` (every `sales_files.id`, any status) — for the orphan sweep in Task 8; same revokes.
  - Lead decision (FR-95): the Task 5 migration also redefines `private.sales_can` (copy its body from `schema.sql`) to return false when `private.is_test_account(auth.uid())`; add a SQL assertion in `tests/sql/sales-files.sql`: a `test-emp` user who also holds a role with `sales` gets `42501` from `app_sales_bootstrap()`.
- Produces (TS): `type SalesFile = { id: string; stage_id: string; name: string; size_bytes: number; uploaded_by: string | null; uploader_name: string | null; uploaded_at: string; can_delete: boolean }`; `RecordDetail.files: SalesFile[]`.

- [ ] **Step 1: Failing SQL test** `tests/sql/sales-files.sql`: (a) `sales` editor begins + commits a file on Received → appears in `app_sales_record(...)->'files'` for another `sales` reader; (b) reader without edit → begin `42501`; (c) size 52428801 → `22023`, size 52428800 → OK; (d) commit by a different user → `42501`; commit with a size ≠ declared → `22023`; (e) get by a `sales` reader of a second company (fixture creates one) → `P0002 sales: not found`, identical text to a random UUID; get of a `pending` row → `P0002`; (f) delete by non-uploader `sales` editor → `42501`, by `sales_settings` holder → OK, by uploader → OK; `sales_events` holds a `file` row for the add and for the delete; (g) closed record (no `sales_decide`) → begin and delete `42501`; (i) a Won record moved to the Contract flow → begin with a bid-flow stage id still OK and `files` still lists the earlier file; (j) `delete from public.sales_stages` (as superuser — no app function deletes stages) for a stage holding a file → `23503`; (k) `sales_files_gc()` removes a pending row backdated 2 days, keeps a fresh one; (h) **last section of the file**: `set local transaction_read_only = on;` then begin → `ERROR 25006`, get of a ready file → OK, `app_sales_record` → OK.
- [ ] **Step 2:** Run on clone → FAIL.
- [ ] **Step 3:** Migration. Redefine `app_sales_record` from its current body, adding `files` only.
- [ ] **Step 4:** Test PASS on clone; all `tests/sql/sales*.sql` PASS; apply to branch DB; `schema.sql` updated; types updated; `npx tsc --noEmit` PASS.
- [ ] **Step 5:** Commit `feat(sales): record files metadata and permissions`.

---

### Task 6: Files — storage and routes

**Files:**
- Create: `lib/files/store.ts`, `lib/files/diskStore.ts`, `lib/files/limits.ts`, `lib/files/contentDisposition.ts`
- Create: `app/api/sales/files/route.ts` (POST), `app/api/sales/files/[id]/route.ts` (GET, DELETE)
- Modify: `.gitignore` (`/.files/`), `.env.example` (`FILES_DIR=./.files`)
- Test: `tests/unit/files-store.test.ts`, `tests/unit/files-limits.test.ts`, `tests/unit/content-disposition.test.ts`

**Interfaces:**
- Consumes: Task 5 functions.
- Produces: `interface FileStore { put(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ size: number; sha256: string }>; get(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>; remove(key: string): Promise<void>; exists(key: string): Promise<boolean> }`; `getFileStore(): FileStore` (disk impl from `FILES_DIR`); `fileKey(companyId, rfpId, fileId): string` (each part must match the UUID pattern, else throws); `MAX_FILE_BYTES = 52_428_800`; `class TooLargeError`; `checkDeclaredSize(n: number): void`; `cleanFileName(raw: string): string` (basename after the last `/` or `\`, control characters removed, trimmed, ≤ 255 chars; empty → `'file'`); `contentDisposition(name: string): string`. `lib/files/*` is server-only (never imported by a client component).
  - **Upload wire format (decided — replaces multipart):** `POST /api/sales/files?rfp=<uuid>&stage=<uuid>` with the raw file bytes as the body, `Content-Type: application/octet-stream`, `Content-Length` (the declared size; missing → 411), `X-File-Name: encodeURIComponent(name)`, `X-File-Type: <browser mime or empty>`. `request.body` is already a stream, so no multipart parser or new dependency is needed and nothing is buffered (`request.formData()` buffers the whole body). XHR sends a `File` this way with `upload.onprogress`. The custom `X-File-Name` header also makes a cross-site form POST impossible (forces a CORS preflight that the app never answers): refuse a POST without it (400).
  - POST returns `201 { id }`; `413` too large (declared or streamed); `403` refused (View-as cookie present, `42501`, `25006`); `400` bad input (`22023`, bad UUIDs, missing header); `404` record not found (`P0002`); `401` no session.
  - Session: `createClient()` from `lib/supabase/server`, then `supabase.auth.getUser()` first — `proxy.ts` matcher excludes `/api` (confirmed), so no proxy body limit applies, but also no session refresh: `getUser()` in a route handler refreshes an expired access token and can write the cookies. No user → 401.
  - `GET /api/sales/files/<id>` — non-UUID id → 404 without a DB call; stream with headers per Global Constraints plus `Content-Length` and `Content-Security-Policy: default-src 'none'; sandbox` (as `app/api/photo/[id]/route.ts`); **any** RPC error (`P0002`, `42501`, other) → 404 with the same body; `410` when the row exists but the bytes are missing (`{ error: 'file missing' }`). Allowed under View as.
  - `DELETE /api/sales/files/<id>` — View-as cookie → 403; RPC first, then `remove(key)` (missing bytes are fine); `204`; errors mapped as POST.

- [ ] **Step 1: Failing unit tests.**
  - `files-store.test.ts` (temp dir via `fs.mkdtemp`, set as the store root): `put` writes atomically (temp then rename; no file at key if aborted); `put` with 11 bytes and `maxBytes` 10 throws `TooLargeError` and leaves nothing at the key or in `tmp/`; returned `sha256` matches `crypto` of the bytes; `get` of missing → `null`; `remove` of missing resolves; `fileKey(u1,u2,u3)` (three UUIDs) → `'u1/u2/u3'`; a part that is not a UUID (`'..'`, `'a/b'`) throws.
  - `content-disposition.test.ts`: `contentDisposition('قرارداد "نهایی".pdf')` starts with `attachment; filename="` + ASCII fallback with `"` and non-ASCII replaced by `_`, and contains `filename*=UTF-8''` + `encodeURIComponent` of the name (with `'()*` also percent-encoded, RFC 5987); newlines removed.
  - `files-limits.test.ts`: `checkDeclaredSize(52428800)` OK, `52428801` → `TooLargeError`, `0` → error; `cleanFileName('../../x.pdf')` → `'x.pdf'`, `cleanFileName('a\\b\nc.txt')` → `'bc.txt'`, `cleanFileName('')` → `'file'`.
- [ ] **Step 2:** `npx vitest run tests/unit/files-*.test.ts tests/unit/content-disposition.test.ts` → FAIL.
- [ ] **Step 3:** Implement `lib/files/*`. Disk store writes to `<FILES_DIR>/tmp/<random>` then `rename` to `<FILES_DIR>/<key>` (`mkdir -p` the parent). Counting/hashing is a `TransformStream` that throws `TooLargeError` past `maxBytes`.
- [ ] **Step 4:** Unit tests PASS.
- [ ] **Step 5:** Route handlers (`export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`). POST order: View-as cookie → 403; `getUser()` → 401; validate query UUIDs and headers; `checkDeclaredSize(Content-Length)` → 413 **before** reading the body; `app_sales_file_begin(rfp, stage, cleanFileName(decodeURIComponent(X-File-Name)), size, mime)`; `getFileStore().put(fileKey(company_id, rfp, id), request.body, size)` (the cap is the declared size, which is ≤ 50 MB; fewer bytes than declared → 400); `app_sales_file_commit(id, size, sha256)`; on any error after begin: `remove(key)` + `app_sales_file_abort(id)`. **Before writing, verify with Context7 (`/vercel/next.js`, Next 16):** that `request.body` in a Node route handler streams without buffering, and the self-hosted request timeout: Node's `http.Server.requestTimeout` defaults to 300 s, so a 50 MB upload below ~170 KB/s would be cut; find whether the standalone `server.js` exposes a setting (env or `next.config`) and record the finding + choice in the AGENT-LOG (do not patch `server.js`). Caddy (`deploy/liara/Caddyfile`) sets no body limit or timeout — confirmed; no change.
- [ ] **Step 6:** Manual check against the dev server + branch DB: upload a 1 MB and a 50 MB file (`curl --data-binary @f -H 'Content-Type: application/octet-stream' -H "X-File-Name: …"` with a session cookie), download both and `cmp` with the originals; 50 MB + 1 byte → 413 and no leftover in `.files/tmp`; a body longer than its `Content-Length` is cut by Node — instead test a client that declares 10 bytes and streams more with chunked encoding (no `Content-Length` → 411); GET with a random UUID → 404; GET as another company's user → 404; a POST without `X-File-Name` → 400.
- [ ] **Step 7:** Commit `feat(sales): file upload and download routes on disk storage`.

---

### Task 7: Files — UI

**Files:**
- Create: `app/[locale]/(app)/sales/_components/FilesTab.tsx`, `app/[locale]/(app)/sales/_components/FileUpload.tsx`
- Create: `lib/sales/files.ts`
- Modify: `RecordView.tsx` (`TabKey` gains `'files'`, tab order Activity · Deadlines · Files, count = files length; passes `onOpenFiles={() => setTab('files')}` to `StageBody`), `StageBody.tsx` (new optional prop `onOpenFiles?: () => void`; on the `received` page kind (`pageKind` in `lib/sales/stagePages.ts`) a line "Upload the RFP documents in Files" whose button calls it), `ActivityLog.tsx` (`case 'file'`: "File {name} added" / "File {name} deleted", name in `<bdi>`), `messages/*.json` (`sales.files.*`, `sales.event.file_add`, `sales.event.file_delete`, `sales.recordTabs.files`)
- Test: `tests/unit/sales-files-group.test.ts`

**Interfaces:**
- Consumes: `RecordDetail.files`, `RecordDetail.events`, `boot.flows/stages`, routes from Task 6 (raw-body POST with `X-File-Name`, see Task 6).
- Produces: `recordFlowIds(record: RecordRow, events: EventRow[], files: SalesFile[], stages: Stage[]): string[]` — the current flow, plus the flow of every stage named in `stage` events (`body.from` / `body.to`), plus the flow of every file's stage; `groupFilesByStage(files: SalesFile[], stages: Stage[], flowIds: string[], flows: Flow[]): { stage: Stage | null; files: SalesFile[] }[]` in `lib/sales/files.ts` — order: bid-flow stages first (by position), then contract-flow stages; every stage of those flows is listed; `stage: null` = the fallback "Other" group.

- [ ] **Step 1: Failing unit test**: a Won record now in the Contract flow, with a `stage` event from a bid stage, and a file on Received → `recordFlowIds` has both flows; groups list Received (with the file) before contract stages; stages without files still listed; a record with no bid history and no bid-stage files → only its own flow; a stage id unknown to `stages` → the `stage: null` "Other" group, never dropped.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `lib/sales/files.ts`. **Step 4:** PASS.
- [ ] **Step 5: UI.** `FilesTab`: per group header (stage name, count, Upload button), `data-table` rows (name in `<bdi>`, size via `formatNumber` + KB/MB, uploader, date via `f.date`, Download link `/api/sales/files/<id>` with `download`, Delete when `can_delete` with confirm dialog). Empty group = one line + Upload. Page-level Upload defaults to the current stage. `FileUpload`: multiple files, drag-and-drop on `md:` and up, browser-side 50 MB check with message, one `XMLHttpRequest` per file (`POST /api/sales/files?rfp=…&stage=…`, body = the `File`, headers per Task 6) for progress (`upload.onprogress`), refresh the record after all finish (the same reload `RecordView` uses after other writes — check how; `router.refresh()` if none); errors per file (401/403/404/411/413/400 → translated messages). Delete = `fetch(…, { method: 'DELETE' })` then reload. Hide upload/delete controls when `!boot.caps.edit`, or the record is not writable (`record.stage_kind !== 'open' && !boot.caps.decide`), or `useViewAs()` is non-null; delete also needs `file.can_delete`.
- [ ] **Step 6:** `npm run test:unit`, `npx tsc --noEmit`, `npm run build` PASS. Browser check (fa + en, 375px and desktop): upload two files on Received, see progress, download, delete one; screenshot.
- [ ] **Step 7:** Commit `feat(sales): Files tab on records`.

---

### Task 8: Files — deploy, backup, clean-up

**Files:**
- Modify: `deploy/docker-compose.yml` (named volume `sales-files` → `app:/data/files`, env `FILES_DIR: /data/files`, add `sales-files:` under top-level `volumes:`); the three overrides (`docker-compose.liara.yml`, `docker-compose.local-arm64.yml`, `docker-compose.client-amd64.yml`) do not redefine `app` volumes today (checked), so they inherit it — change them only if that is no longer true after Task 0. `deploy/Dockerfile` runtime stage (`RUN mkdir -p /data/files && chown node:node /data/files` before `USER node`; Docker copies that owner into an empty named volume on first mount), `deploy/liara/backup.sh`, `deploy/liara/pull-backups-to-mac.sh`, `docs/DEPLOY-LIARA.md`, `docs/DEPLOY-ASSISTANT.md`
- Create: `deploy/lib/files-gc.sh`, `deploy/liara/backup-files.sh`
- Test: `tests/deploy/files-volume.test.sh`, `tests/deploy/files-backup.test.sh`, `tests/deploy/liara-config.test.sh` (extend its `bash -n` line with the two new scripts)

**Interfaces:**
- Consumes: `private.sales_files_gc()` and `private.sales_file_ids()` (Task 5), disk layout (Task 6).
- Produces:
  - `deploy/liara/backup-files.sh <src_dir> <mirror_dir> <deleted_root>` — pure file logic, no Docker, no fixed paths, so it is testable: `rsync -a --delete --backup --backup-dir=<deleted_root>/<UTC date>` from `<src_dir>/` to `<mirror_dir>/` (excluding `tmp/`), then delete `<deleted_root>/*` dirs older than 30 days. Fails clearly when `rsync` is missing.
  - `backup.sh` (runs as root on the VM under `/opt/bj-erp`): after the DB dump, `bash ./lib/files-gc.sh` (best effort, `|| true` + log), then `backup-files.sh "$(docker volume inspect -f '{{ .Mountpoint }}' "${BJ_PROJECT_NAME}_sales-files")" /var/backups/bj-erp/files /var/backups/bj-erp/files-deleted` (project name from `bj_compose_init`, `deploy/lib/common.sh`).
  - `deploy/lib/files-gc.sh` (sources `common.sh`; DB via `bj_compose_with_db_password db psql -U supabase_admin`; file operations via `bj_compose exec -T app sh -c …` as `node`, so ownership stays right): remove the keys returned by `select private.sales_files_gc()`; remove `tmp/*` older than 1 day; orphan sweep = files under `<company>/<rfp>/<id>` older than 1 day whose `<id>` is not in `private.sales_file_ids()`. **Safety:** skip the orphan sweep (log why) when the id query fails or returns zero ids while files exist — a wrong/empty or freshly restored DB must never wipe the volume. Logs counts.

- [ ] **Step 1: Failing deploy tests** (they run in CI with throwaway containers like the other `tests/deploy/*.test.sh` — never the local stack, which CI does not have). `files-volume.test.sh`: `docker compose … config --format json` for base and base + each override (pattern of `liara-config.test.sh`) → `app` has a volume `sales-files` at `/data/files` and `FILES_DIR=/data/files`; the top-level `volumes` holds `sales-files`; static check that the Dockerfile's runtime stage creates and `chown`s `/data/files` before `USER node`. `files-backup.test.sh`: run `backup-files.sh` inside a throwaway container (`alpine` + `apk add --no-cache rsync bash`, scripts mounted read-only) so the host's rsync flavour (macOS openrsync) does not matter: seed `src/c/r/f1` → appears in the mirror; remove it from `src`, rerun → moved to `deleted/<date>/c/r/f1`; a `deleted/` dir with mtime 31 days ago is pruned, a 29-day one kept; `src/tmp/x` never reaches the mirror.
- [ ] **Step 2:** `npm run test:deploy` → the two new tests FAIL.
- [ ] **Step 3:** Implement compose/Dockerfile/backup/gc changes. `pull-backups-to-mac.sh` adds an incremental `rsync -a` of the VM's `files/` mirror to `$DEST/files/` (same SSH options; no `--delete`). Runbooks: restore step copies the mirror back into the volume (owner `node`, uid 1000); "Running the app locally" restores files from `~/Backups/bj-erp/files/` into the local volume or `.files/` (or skips — downloads then show "file missing"). Note in `DEPLOY-LIARA.md` that `rsync` must exist on the VM (checking it is a live-server action: leave it to the owner, list it in the AGENT-LOG).
- [ ] **Step 4:** `npm run test:deploy` PASS (all, not only new).
- [ ] **Step 5:** Record in `docs/TASKS.md`: "Watch Liara VM disk: sales files volume + backup mirror (2026-11-20)". Commit `feat(deploy): sales files volume, backup mirror and clean-up`.

---

### Task 9: End-to-end + docs

**Files:**
- Create: `tests/e2e/sales-files.spec.ts`, `tests/e2e/sales-products.spec.ts`
- Modify: `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/DATA_MODEL.md` (four tables + `project_nodes.product_id`), `docs/PERMISSIONS.md` (files rules, products/currencies edit = `sales_settings`), `docs/REQUIREMENTS.md` (FR-94 additions), `docs/specs/2026-11-16-sales-rfp-module-design.md` (§7/§12 pointer: uploads now exist, see the 2026-11-20 spec), `CLAUDE.md` (gotchas below), `docs/AGENT-LOG.md`

- [ ] **Step 1: e2e** (local Docker stack only, `999…` users, `--workers=1`): files — user A (sales edit) uploads `rfp.pdf` on Received → user B (sales read) sees and downloads it (bytes equal) → B has no Delete → A deletes it; a 50 MB + 1 byte file is refused in the browser with the size message. Products — settings user creates "Gate valve" with a Size default, sales engineer picks it on an item row, Size is filled; currency — settings user adds Toman, it appears in the record currency picker.
- [ ] **Step 2:** `npx playwright test tests/e2e/sales-files.spec.ts tests/e2e/sales-products.spec.ts --workers=1` PASS; full `npm run test:unit`, `npm run lint`, `npm run build`, all `tests/sql/sales*.sql` on a clone PASS.
- [ ] **Step 3:** CLAUDE.md gotchas (one line each): "Sales files: bytes on volume `sales-files` (`FILES_DIR`), only through `lib/files/store.ts`; SQL `app_sales_file_*` owns every check; upload is a raw-body POST with `X-File-Name`; downloads are always `attachment`." · "Currencies come from `sales_currencies` (`boot.currencies`, `useSalesFormat().money`), never a constant; codes are permanent once used." · "Product defaults are copied into item rows on pick (`app_project_save_node`), never linked." · "A new `sales_events.kind` = re-create `sales_events_kind_check` + `EventKind` + an `ActivityLog` case." · "View as in SQL = read-only transaction (`25006`); there is no view-as check function."
- [ ] **Step 4:** CHANGELOG (Unreleased → Sales), TASKS (remove done, add disk watch + "S3 store if the volume outgrows the VM"), AGENT-LOG entry (branch DB name, multipart parser choice, test results).
- [ ] **Step 5:** Commit `docs(sales): CEO feedback round 1 — tests and docs`. Do not push; report to the owner for review.
