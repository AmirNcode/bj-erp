# Sales stage pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Sales record page's top-right buttons with clickable stage pages. Each page has Submit, which logs old → new values, and Next stage.

**Architecture:** One migration redefines `app_sales_save_record` to take the stage page and to write old → new changes into the `edit` event. A pure helper module maps stages to page content, computes the draft patch and gates Next. `RecordView` becomes a shell: a clickable stage bar, the selected stage page (`?stage=`), a footer (Submit / Next / closing actions), and Deadlines + Activity tabs.

**Tech Stack:** Next.js App Router, next-intl, Supabase RPC (plpgsql), Vitest, psql SQL tests, Playwright.

**Spec:** `docs/specs/2026-11-17-sales-stage-pages-design.md` (read it with this plan).

## Global Constraints

- Branch `feat/erp-sales-module`. Commit only when Amir asks. Code pushes go nowhere (local branch).
- Migrations are forward-only and frozen once applied. Dry-run on a clone first (CLAUDE.md "Dry-run migrations first"). Update `schema.sql` by diffing clone dumps, not with `npm run schema:dump`.
- Price fields `our_price`, `winning_bid`, `winner_name`, `total_value` never appear with values in `sales_events`.
- Every Sales write locks the record row first (`private.sales_rfp`). Read functions stay `stable`.
- New strings go in `messages/fa.json` + `messages/en.json` under `sales`. Client components use `useTranslations('sales')`.
- Follow `docs/DESIGN.md`: tabs from `lib/ui/tabs.ts`, no `shadow-*`, `data-table` on tables, light only.
- `lib/supabase/types.ts` is hand-edited for the new RPC arg.
- Leave list-row old → new for a later change (owner, 2026-11-17).

## Review Focus

1. **Unsaved draft, then another stage clicked.** Expect a confirm. Cancel keeps the draft. Test in Task 4 (unit: `isDirty`) and Task 6 (e2e).
2. **Same field changed by someone else since the page loaded.** Submit sends only the fields this user changed, so the other person's fields survive. Test in Task 1 (SQL: a patch with one key leaves the others).
3. **Caller without `sales_prices` submits Pricing or Received.** Price keys are not sent, and the ledger shows no values. Test in Task 1 (SQL: the event for a price change has `hidden`).
4. **Closed record opened by a plain `sales` editor.** Pages are read-only and no Submit shows. Test in Task 2 (unit: `pageMode`).
5. **Record on Pricing with needs quote off, Next from Technical.** Next skips Pricing to Ready to send. Test in Task 2 (unit: `nextGate`).

---

### Task 1: Migration: stage-aware save with an old → new ledger

**Files:**
- Create: `supabase/migrations/20261117100000_sales_stage_pages.sql`
- Create: `tests/sql/sales-stage-pages.sql` (copy the header helpers from `tests/sql/sales.sql:1-60`)
- Modify: `supabase/schema.sql` (patched hunks only), `lib/supabase/types.ts` (`app_sales_save_record` Args gets `p_stage?: string | null`)

**Interfaces:**
- Produces: `public.app_sales_save_record(p_id uuid, p jsonb, p_stage uuid default null) returns uuid`. Drop the 2-arg version in the same migration, then `grant execute … to authenticated` again (match the existing grant lines for it).
- Produces the event body for `kind='edit'`: `{ stage: uuid|null, fields: text[], changes: [{field, from, to} | {field, hidden: true}], side?: text[] }`. Custom keys diff per key as `custom.<key>`. `buyer` / `client` changes log the customer names (`from`/`to` = names, `field` = `buyer` / `client`), not ids. `buyer_id` / `client_id` stay out of `changes`.
- New keys `decision_reason`, `result_reason` are accepted only when `private.sales_can('sales_decide')`.
- `p_stage` must be a stage of the record's flow, otherwise `sales: invalid input`.

- [ ] **Step 1: Write the failing SQL tests** in `tests/sql/sales-stage-pages.sql`. Fixtures: an editor with `sales` edit, a pricer with `sales` + `sales_prices` edit, a decider with `sales_decide`, and one bid record. Assertions (`pg_temp.expect`):
  - `edit event carries stage`: save `{"proposal_due":"2026-11-20"}` with `p_stage` = Received. The newest event has `body->>'stage'` = Received id, and `body->'changes'` = `[{"field":"proposal_due","from":<old or null>,"to":"2026-11-20"}]`.
  - `patch leaves other fields`: set `description` as the pricer, then save only `proposal_due` as the editor. `description` is unchanged.
  - `price change hidden`: the pricer saves `our_price` 100. The change is `{"field":"our_price","hidden":true}`, and `body::text` does not contain `100`.
  - `custom per key`: save `custom {"a":"x"}`. The change has field `custom.a`, from null, to "x".
  - `bond side effect`: save `needs_bond true`. The body has `side` = `["bid_bond_opened"]`.
  - `reason needs decide`: the editor's `decision_reason` is ignored (not in `changes`), and the decider's is stored.
  - `foreign stage refused`: `p_stage` = a contract stage on a bid record returns `ERROR 22023 sales: invalid input`.
  - `old 2-arg call works`: `app_sales_save_record(id, '{"title":"t2"}')` succeeds, and `body->>'stage'` is null.
- [ ] **Step 2: Clone the local DB and run the tests against the clone without the migration.** Expect a failure on the first assertion. Clone: `create database ssp`, then `pg_dump -Fc -d postgres | pg_restore -d ssp --no-owner` in `bj-erp-db-1`. First apply any `main` migrations missing locally (CLAUDE.md "Local postgres DB lags").
- [ ] **Step 3: Write the migration.** Copy the current body from `20261116200100_sales_functions.sql:389-528` and check whether `20261116210000_sales_access_fixes.sql` redefines it (use the newest). Add `p_stage`. Replace the `v_changed` block with a loop over the changed keys that builds `changes`. Add `side`.
- [ ] **Step 4: Apply it to the clone and run `tests/sql/sales-stage-pages.sql` and `tests/sql/sales.sql`.** Expect every `PASS`, no `FAIL`.
- [ ] **Step 5: Patch `supabase/schema.sql`.** Dump the schema of the clone before and after (`pg_dump -s -d ssp`), diff, and apply only the hunks for this function. Then `drop database ssp`.
- [ ] **Step 6: Commit** (only when Amir asks): `feat(erp): Sales save logs stage and old → new values`

### Task 2: Pure stage-page helpers

**Files:**
- Create: `lib/sales/stagePages.ts`
- Test: `tests/unit/sales-stage-pages.test.ts`

**Interfaces:**
- Consumes: `Stage`, `RecordRow`, `Bootstrap['caps']` from `lib/sales/types.ts`; `defaultNextStage`, `flowStages` from `lib/sales/stages.ts`.
- Produces:
  - `type PageKind = 'received'|'decision'|'technical'|'pricing'|'ready'|'submitted'|'closed'|'contract_new'|'contract_current'|'contract_hold'|'generic'`
  - `pageKind(stage: Stage): PageKind`. Seeded codes map to these. Any non-open kind maps to `closed`. A code-less stage maps to `generic`.
  - `type PageMode = 'edit'|'view'`. `pageMode(stage: Stage, record: RecordRow, stages: Stage[], caps): PageMode`. Returns `view` when: the stage is after the current one (flow position); the record is closed and `!caps.decide`; or `!caps.edit`.
  - `PAGE_FIELDS: Record<PageKind, string[]>`: record keys edited on each page, copied from spec §7 (Received: title, buyer, buyer_kind, client, customer_ref, source, received_on, project_site, description, owner_id, currency, proposal_due, needs_quote, quote_due, needs_bond, bond_due; decision: decision_reason; pricing: our_price; submitted: submitted_on, delivery_method, received_by, validity_days; contract_new: total_value, order_date, contract_start, delivery_amount, delivery_unit, delivery_text, delivery_date, prepayment, prepayment_date, addendum, owner_id; contract_current: delivery_date, owner_id). Custom record fields go on Received unless they are listed in another stage's `required`.
  - `draftPatch(original: Record<string, unknown>, draft: Record<string, unknown>): Record<string, unknown>`. Changed keys only. For `custom`, send the merged object only when a key changed.
  - `isDirty(original, draft): boolean`
  - `nextGate(record: RecordRow, stages: Stage[], caps, dirty: boolean): { target: Stage | null; blocked: null | 'dirty' | 'required' | 'right' | 'end'; missing: string[] }`. Checks `required` against **record** values (server state).

- [ ] **Step 1: Write the failing tests:**
  - `pageKind` maps each seeded code. A stage with kind `lost` gives `closed`, and `code null` gives `generic`.
  - `pageMode`: a future stage gives `view`; a past stage on an open record with the `sales` edit cap gives `edit`; a closed record without `decide` gives `view`.
  - `draftPatch({a:1,b:2},{a:1,b:3})` equals `{b:3}`. For a custom key change it equals `{custom:{x:'1',y:'2'}}`.
  - `nextGate`: with `dirty` true, `blocked` = `'dirty'`. From Technical with `needs_quote` false, `target.code` = `'ready'`. With a required key `received_by` empty, `blocked` = `'required'` and `missing` = `['received_by']`. From the Submitted stage, `blocked` = `'end'` (no next open stage reachable by Next, because the result closes it).
- [ ] **Step 2: Run `npx vitest run tests/unit/sales-stage-pages.test.ts`.** Expect it to FAIL (module missing).
- [ ] **Step 3: Implement `lib/sales/stagePages.ts`.** Contract Next skips `hold`: the target is the next open stage whose code is not `hold`.
- [ ] **Step 4: Run the same command.** Expect PASS.
- [ ] **Step 5: Commit** (when asked): `feat(erp): Sales stage page helpers`

### Task 3: Server action and the record page shell

**Files:**
- Modify: `lib/actions/sales.ts` (add the action), `app/[locale]/(app)/sales/_components/RecordView.tsx` (rewrite)
- Create: `app/[locale]/(app)/sales/_components/StageNav.tsx` (clickable bar), `app/[locale]/(app)/sales/_components/StageFooter.tsx`
- Modify: `messages/fa.json`, `messages/en.json` (`sales.stagePage.*`)

**Interfaces:**
- Consumes: Task 2 exports; `app_sales_save_record` with `p_stage` from Task 1.
- Produces:
  - `saveSalesStagePage(id: string, stageId: string, patch: Patch): Promise<Write>` calls `rpc('app_sales_save_record', { p_id, p, p_stage })`.
  - `StageNav({ stages, current, selectedId, onSelect })`. Every open stage, plus the closed tag, is a `<button>` with `aria-current="step"` on the record's stage and `aria-pressed` on the selected one. `data-testid="sales-stage-<code>"`. On phones the bar scrolls sideways (`overflow-x-auto`, no wrap) and the footer buttons stack full width (`max-sm:h-11 max-sm:w-full`).
  - `StageFooter({ mode, dirty, gate, onSubmit, children })`. Submit (`data-testid="sales-stage-submit"`) appears only in `edit` mode and is disabled when not dirty. `children` = the closing actions (Next / Bid / No bid / Result / Reopen / Hold…). It shows the `gate.blocked` reason text.
  - In `RecordView`, the selected stage is read from `useSearchParams().get('stage')` (fallback: the record's stage; `?node=` selects the first page whose kind is `technical`). It writes with `router.replace` and keeps the other params. The draft state lives here and is passed to the page body. A dirty draft plus a stage or tab switch calls `window.confirm(t('stagePage.discard'))`. Add a `beforeunload` listener while dirty.
  - Remove the Move / Bid decision / Record result / Edit header buttons and the `Overview`, `items`, `documents`, `finance` tabs. The tabs left are `deadlines` and `activity`.

- [ ] **Step 1: Add the action, and the `types.ts` arg if not done.**
- [ ] **Step 2: Build `StageNav`, `StageFooter`, and the `RecordView` shell.** The page body for now is a placeholder `StageBody` that renders the field names from `PAGE_FIELDS` (Task 4 replaces it).
- [ ] **Step 3: Run `npx tsc --noEmit` and `npm run lint`.** Expect no errors.
- [ ] **Step 4: Commit** (when asked): `feat(erp): clickable Sales stage bar and page shell`

### Task 4: Bid-flow stage pages

**Files:**
- Create: `app/[locale]/(app)/sales/_components/StageBody.tsx` (switch on `pageKind`), `app/[locale]/(app)/sales/_components/StageFields.tsx` (field inputs reused across pages: lift the inputs from `RecordForm.tsx:150-290` into small components keyed by field name; `RecordForm` keeps working for New record by using them too)
- Modify: `RecordView.tsx` (closing actions), `messages/*.json`

**Interfaces:**
- Consumes: `ItemsTab` (pass `pricesVisible={kind==='pricing'}`: add this prop; Technical hides the price columns), `DocumentsPanel`, `FinancePanel` (guarantees only on Ready: add a `show: 'bonds'|'payments'|'both'` prop), the existing `DecideDialog` and `ResultDialog` logic (move them into `StageBody` actions), and `moveSalesStage`.
- Closing actions on the current stage:
  - `received` / `technical` / `pricing` / `ready` / `generic`: a **Next stage** button (`sales-stage-next`). It opens a small dialog with the next owner (default `defaultOwner`) and a note, then calls `moveSalesStage(id, gate.target.id, owner, note, null)`.
  - `decision`: an inline reason textarea plus **Bid** (`sales-decide-yes`) and **No bid** (`sales-decide-no`), shown only with `caps.decide`. Otherwise the text is `stagePage.decideOnly`.
  - `submitted`: **Record result** (`sales-result`), shown only with `caps.decide`.
  - `closed`: **Reopen** (`sales-reopen`, `caps.decide`). It opens the existing stage select limited to open stages.
- Read-only rendering for `view` mode uses the same field list as text, like the old Overview rows.

- [ ] **Step 1: Write `StageFields` and point `RecordForm` at it.** New record must still work.
- [ ] **Step 2: Build `StageBody` for the bid kinds and `closed`.**
- [ ] **Step 3: Run `npx tsc --noEmit`, `npm run lint` and `npm run test:unit`.** Expect PASS.
- [ ] **Step 4: Commit** (when asked): `feat(erp): Sales bid stage pages`

### Task 5: Contract stage pages, and the Activity ledger view

**Files:**
- Modify: `StageBody.tsx` (contract kinds), `RecordView.tsx` `Activity` (or move it to `_components/ActivityLog.tsx`), `messages/*.json`

**Interfaces:**
- `contract_new` shows its fields plus guarantees, plus a read-only "Bid" summary (received_on, submitted_on, bid_result) when `received_on || submitted_on`. `contract_current` shows its fields plus payments + guarantees, with actions **Finish** (`caps.decide`) and **Put on hold**. `contract_hold` has actions **Resume** (to `current`), **Finish** and **Cancel** (`caps.decide`). Finish, Cancel and hold moves go through `moveSalesStage` to the stage found by code.
- Activity `edit` line: "<actor> · <time> · on <stage name>", then one row per change, `Label: from → to`. Use the field label from `t('field.<key>')`, or the custom field label for `custom.<key>`. Dates use `f.date`, `owner_id` maps to the person name from `boot.people`, booleans show yes/no, and `hidden` shows `t('stagePage.changedHidden')`. An event without `changes` renders as today.

- [ ] **Step 1: Write a unit test for the formatter.** Put `changeText(change, ctx)` in `lib/sales/stagePages.ts`: `{field:'needs_bond',from:false,to:true}` gives `'No → Yes'` with the en labels passed in ctx, and `{field:'our_price',hidden:true}` gives ctx.hidden.
- [ ] **Step 2: Run vitest.** Expect FAIL. Implement, then run it again and expect PASS.
- [ ] **Step 3: Build the contract pages and the Activity change rows.**
- [ ] **Step 4: Run `npx tsc --noEmit`, `npm run lint` and `npm run build`.** Expect success.
- [ ] **Step 5: Commit** (when asked): `feat(erp): Sales contract stage pages and change ledger`

### Task 6: End-to-end check, browser check, docs

**Files:**
- Modify: the Sales e2e spec if one exists (`grep -l sales tests/e2e`), otherwise create `tests/e2e/sales-stage-pages.spec.ts` using its own `999…` users
- Modify: `docs/CHANGELOG.md`, `docs/TASKS.md` (follow-up: old → new on list rows), `docs/AGENT-LOG.md`, `docs/DATA_MODEL.md` (event body shape), `CLAUDE.md` (one Gotcha line: "Sales record edits go through stage pages; `app_sales_save_record` takes `p_stage`; edit events carry `changes`")

- [ ] **Step 1: e2e flow:** open a record, click `sales-stage-decision`, then `sales-stage-received`. Change proposal due and Submit. Activity shows the change with the old → new dates. Next goes to Bid decision. Bid goes to Technical. Typing in a field and clicking another stage shows the confirm, and dismissing it keeps the text. The `sales-result` button is absent on Received.
- [ ] **Step 2: Run the spec against the local stack.** Use `npx playwright test tests/e2e/<spec> --workers=1`. Expect PASS.
- [ ] **Step 3: Apply the migration to the running local stack (`./deploy/bj-deploy update local`, then restart `bj-erp-rest-1`).** Check in the browser at 1280 px and 390 px. Take screenshots for Amir.
- [ ] **Step 4: Update the docs listed above.**
