# Sales module — RFP register, bid workflow, deadlines (blueprint)

Status: **built 2026-11-16** on branch `feat/erp-sales-module` (not merged, not deployed). Blueprint 2026-11-16, from the owner's description of the client's current process and his
decisions in chat. **Approved by owner 2026-11-16** (with: contract phase, ledger import + template,
engineering items table in v1; nav entry labelled "ERP"). Build decisions that refine the text
below are in **§15, which wins where they differ**. Small details stay open (§13) and get filled in
from client feedback. Requirement: **FR-94**. Plan: `docs/plans/2026-11-16-sales-rfp-module.md`.
Reviewed by two Opus subagents (spec and plan) before the build; what changed is in §15.14–§15.27.

Samples read: `erp-module/files/` (BJ11511 financial offer ×2, one customer commercial form).
Added later the same day: `B1.xlsx`, sheet "BJ Contract" (135 rows). It is the ledger of **won
contracts**, not of inquiries (§5a).

## 1. Why

Module #2 after HR. Today an RFP arrives (tender website or email), one person gives it an
internal **record ID** in an Excel register (description, bond, our price, winning bid, status,
currency…), management decides bid / no-bid, sales engineering builds a technical proposal
(sometimes with a financial quote) against a deadline, the package is printed and delivered by
hand or courier, and finance issues a bond if one is required.

Everything is siloed on laptops, email and USB sticks. Nobody can see who is working on what or
where a project stands without meetings, and past bids are not usable when pricing a new one.

## 2. Goals, non-goals, anti-goals

**Goals**
- One shared record per RFP, from arrival to result, with a clear current stage and a named
  responsible person.
- Deadlines and expirations are first-class: proposal due, quote due, bond due, offer validity
  end, bond expiry. Nothing is missed silently.
- Quote line items are structured data, so past prices are searchable per item
  ("what did we quote for 3-1/16" API 10000 gate valves, and did we win?").
- Management reads status and history on a page, instead of asking for PDF / Excel reports.
- The workflow bends without a rebuild: stages, extra columns and who-sees-what change in
  Settings.
- The whole module is invisible until a role is given its permission (first: a CEO role).

**Non-goals (v1)**
- File uploads of any kind (owner decision 2026-11-16). Drawings, catalogs, inquiry files and
  the offer Excel stay on laptops. The record tracks *that* a document exists, who prepares it and
  whether it is ready (§7), not its bytes. The design leaves room for attachments later (§12).
- Typing in active and past **bids**. New RFPs are entered from go-live on. Existing
  **contracts** do come in, by importing the client's ledger (§6b), so the client has real rows
  to look at from day one.
- Generating or printing the offer document from the line items.
- Production, QC, delivery logistics, invoicing, accounting. The contract phase in v1 is the
  ledger (§6a) and the engineering items table (§6c), nothing more.
- Email / tender-website integration. Intake is typed in.
- Currency conversion. Each record has one currency; amounts are shown as entered.
- A drag-and-drop workflow builder, conditions, branches, per-field access rules.

**Anti-goals**
- Anyone without the module permission learning that it exists (nav, Home, role editor aside).
- Prices or the winning bid visible to someone who was only given status access.
- So generic that price history and reports cannot be queried with plain SQL.
- A record form so long that intake takes longer than adding an Excel row.

## 3. Approaches considered

**Flexibility**
- A. Fixed stages and columns, like leave. Lowest cost; every client tweak is a migration and a
  deploy.
- **B. Configurable core (chosen).** Core facts are real columns; stages and extra fields are
  rows edited in Settings.
- C. Full workflow builder. Everything generic; reports and price history become hard, cost high.

**Files**
- VM disk (20 GB, also holds the DB and images): rejected.
- S3-style object storage: right answer when files are needed; **deferred**, not v1.
- Chosen for v1: no uploads; a document checklist instead (§7).

**Prices**
- Files only / header totals only / **header + line items (chosen).**

## 4. Actors and permissions

New role-editor section **Sales / فروش** in the FR-55 catalog (SQL `private.permission_keys` /
`permission_allows` / `permission_deps` + `lib/permissions/catalog.ts`):

| Key | Shape | Gives |
|---|---|---|
| `sales` | RE | The module itself. Read: list, record, deadlines, activity. Edit: create and edit records, move stages, checklist, deadlines. |
| `sales_prices` | RE | Unit prices, totals, winning bid, winner. Needs `sales`. Without it these are absent from every response, not just hidden. |
| `sales_bonds` | RE | Bond details (amount, bank, number). Needs `sales`. Edit is finance's work. |
| `sales_decide` | E | Record the bid / no-bid decision and the final result. Needs `sales`. |
| `sales_reports` | R | Reports page (§9). Needs `sales`; price reports also need `sales_prices`. |
| `sales_settings` | E | Settings › Sales (stages, fields, checklist template, reminders) and the ledger import (§6b). |
| `project_items` | RE | The items table of a record (§6c). Edit is engineering's work: rows, parts, columns. Needs `sales`. |

- **No preset role gets any of these.** A migration adds the keys only. The owner creates a CEO
  role in Settings › Roles and switches them on; later the same for sales, sales engineering,
  finance.
- The admin holds every permission, as today (builder's reading of the current model; see §13).
- Nav: one **Sales** entry (tab or Manage item by the existing `FOLLOWS_GROUP` rule) shown only
  with `sales` read. Pages guard with the same permission; RLS is the authority.
- RLS on every `sales_*` table: `private.has_perm(auth.uid(), 'sales', 'read')` to read; writes
  go through `app_sales_*` functions that check the specific key. Price columns live in tables
  whose select policy also requires `sales_prices` (§5), so a status-only reader cannot fetch
  them through PostgREST.
- Stage ownership (§6) narrows who *should* act; it is not a second permission system.

## 5. Data model (module-owned tables, shared core reused)

All dates Gregorian `date` / `timestamptz`; Jalali at the UI edge. Money `numeric(18,2)` + ISO
currency code on the record. Every table carries `company_id`.

- **`sales_customers`** — name (fa/en), short code, notes, `kind` (`government | contractor`,
  the register's G / C). Picked on intake, created inline. A record names two of them: the
  **company** that buys (register: 46 distinct, e.g. Ahwaz Kala) and the **client** / end user
  (21 distinct, e.g. NISOC, PEDEC); they may be the same.
- **`sales_flows`** — a named stage set. v1 seeds one ("RFP"). A second flow later = new rows,
  same engine.
- **`sales_stages`** — `flow_id`, `position`, `name_fa`, `name_en`, `kind`
  (`open | won | lost | no_bid | cancelled`; reports group by kind, so renaming or adding stages
  never breaks them), `owner_role_id` (nullable), `required` (keys of fields that must be filled
  to leave the stage), `active`. A stage with records is retired, never deleted.
- **`sales_field_defs`** — custom fields: `entity` (`rfp | item`), `key`, labels, `type`
  (`text | number | date | select | yes_no`), `options`, `position`, `show_in_list`, `active`.
  Values live in `custom jsonb` on the row. Core columns are never custom fields.
- **`sales_rfps`** — the record:
  `record_no` (unique per company, §13), `revision`, `customer_id`, `customer_ref` (their request
  number), `source` (`website | email | other`), `title`, `description`, `received_on`,
  `flow_id`, `stage_id`, `owner_id` (who has it now), `bid_decision`
  (`pending | bid | no_bid`) + who / when / reason, `needs_quote`, `needs_bond`, `currency`,
  `result_reason`, `custom`, created/updated by and at.
- **`sales_rfp_prices`** — one row per record, readable only with `sales_prices`:
  `our_price` (sum of items, or typed when there are no items), `winning_bid`, `winner_name`.
- **`project_nodes`** — the ID tree (§5a). Quote lines are its level-1 rows:
  `product_type`, `size`, `rating`, `description`, `qty`, `unit`, `custom` (materials, end
  connection, operation… differ per product family, so they are item custom fields).
- **`sales_rfp_item_prices`** — `node_id`, `unit_price`; total is computed. Split from the nodes
  for the same reason as `sales_rfp_prices`.
- **`sales_bonds`** — `rfp_id`, `kind`, `amount`, `currency`, `bank`, `number`, `issued_on`,
  `expires_on`, `status` (`needed | requested | issued | delivered | released | expired`).
  Readable only with `sales_bonds`; the record itself shows only "bond: needed / issued / …".
- **`sales_deadlines`** — `rfp_id`, `kind` (`proposal_due | quote_due | bond_due |
  offer_valid_until | bond_expires | other`), `label`, `due_on`, `responsible_id`, `done_at`,
  `done_by`. Bond dates and offer validity write their rows automatically.
- **`sales_documents`** — the package checklist (§7).
- **`sales_events`** — append-only activity: stage moves, decision, field changes (old → new),
  comments. Price changes are logged with values visible only to `sales_prices` holders.

## 5a. Record = project; the ID tree

The record ID is not only a sales number. It names the project for its whole life, and
everything made for it carries a number built from it (owner, 2026-11-16):

```
8997            record (project)
8997-1          line 1: wellheads            ← quote line (sample offer: 11511-01)
8997-1-1        wellhead unit 1
8997-1-2        wellhead unit 2
8997-2          line 2: valves
8997-2-3        valve unit 3
8997-2-3-5      part 5 of valve unit 3
```

Target use: a part fails at the customer; from `8997-1-3-5` the company finds who tested that
part and its quality-control report.

Design:
- **`project_nodes`**: `rfp_id` (the record), `parent_id` (null for a line), `seq` (the dash
  number, unique among siblings, never reused), `code` (full number, stored, unique per company),
  `level_kind` (`line | unit | part`, more allowed), descriptive columns, `custom`. Depth is not
  fixed, so a deeper level later needs no schema change.
- It is **module-neutral** (no `sales_` prefix): sales writes the lines; later modules add units
  and parts (engineering / production) and hang their own rows on a node id (QC: test, tester,
  report). Searching a code from any page opens that node with its ancestors.
- **Numbering below the record is engineering's job** (owner, 2026-11-16), done in the items
  table (§6c). Sales may enter quote lines at bid time; they are the same level-1 rows. `seq`
  numbers are permanent: deleting a row retires its number.
- Read access follows the owning module's permission; v1: `sales` read.

**What `B1.xlsx` shows** (the contract ledger; one row per record that became an order):
- Columns: Rec · Company · Client · G/C · Request No. · Project Site · delivery duration
  (number + Day / Week / Month) · order issuance date · contract start / LOI · prepayment
  yes/no + date · delivery date · addendum · description · total value · currency
  (Euro / Rial / Dollar) · status (New / Current / Hold / Finish / Cancel) · in-charge person ·
  performance guarantee (PBG: %, form, date, amount) · advance-payment guarantees 1–4 (APG: same
  four) · payments 1–4 with dates.
- Guarantee form is one of: bank guarantee, Safteh (promissory note), cheque, none.
- Guarantees and payments are kept by named finance people (column group headers).
- No bid-phase columns here (no bid bond, our price vs winning bid, lost bids): the inquiry
  register, if it is a separate file, is still unseen.
- Consequence: record core gains `company_id` + `client_id`, `project_site`; `sales_bonds.kind`
  = `bid | performance | advance_payment`, with `form` (`bank | safteh | cheque`) and `percent`.
  The contract-phase columns map onto a **second flow** ("Contract": New → Current → Hold →
  Finish / Cancel) on the same record. **In v1** (owner, 2026-11-16): §6a–§6c.

## 6. Workflow

Seeded default flow (editable in Settings):

```
Received → Bid decision → Technical proposal → Pricing* → Ready to send → Submitted
                │                                                            │
                └── No bid                                   Won / Lost / Cancelled
* skipped when the record has "needs quote" off
```

- **Intake** — a `sales` editor creates the record: customer, their reference, description,
  source, received date, proposal deadline, needs quote / needs bond. `record_no` is assigned
  on save.
- **Bid decision** — a `sales_decide` holder chooses bid / no-bid with a reason. No-bid closes
  the record.
- **Moving stages** — forward or back one step, by a `sales` editor; the stage's required fields
  must be filled. Each move records who, when and an optional note, and sets `owner_id` (the
  mover picks the next responsible person, defaulting to a holder of the stage's owner role).
- **Bond runs beside the stages, not inside them.** "Needs bond" opens a bond row in `needed`
  and a `bond_due` deadline; finance (`sales_bonds` edit) carries it to `issued` / `delivered`.
  A proposal can reach Ready to send while the bond is still open; the record shows both.
- **Submitted** — delivery method (hand / courier), date, received-by; starts the
  `offer_valid_until` deadline from the validity period (sample: 90 days).
- **Result** — a `sales_decide` holder records won / lost / cancelled, the winning bid, the
  winner and a reason. Closed records are read-only except by `sales_decide`.

## 6a. Contract phase (v1)

- A record marked **Won** moves into the seeded **Contract** flow: New → Current → Hold →
  Finish / Cancel (the ledger's own status values; editable like any flow).
- Contract fields on the record (core columns): order issuance date, contract start / LOI date,
  delivery duration (number + day / week / month), delivery date, prepayment yes/no + date,
  addendum yes/no, total value, in-charge person.
- **Guarantees** reuse `sales_bonds`: one performance guarantee (PBG) and any number of
  advance-payment guarantees (APG), each with percent, form (bank / Safteh / cheque), date,
  amount, status. Expiry dates feed `sales_deadlines`.
- **`sales_payments`**: `rfp_id`, `seq`, `amount`, `paid_on`, note. Read and edit follow
  `sales_bonds` (finance), like the guarantees.
- A record can also be created directly in the Contract flow (order without a tracked bid, and
  every imported row).

## 6b. Importing the contract ledger (v1)

For `sales_settings` holders, Settings › Sales › Import. Input: the client's `.xlsx` in the
"BJ Contract" layout (header on row 2, `Rec` first column). The file is parsed and discarded,
never stored.

0. **Template.** A "Download template" button gives an `.xlsx` with the exact header row (and the
   group titles above it), so column names cannot be wrong. The client pastes its rows under it.
1. **Upload → preview.** Columns are matched by header text; unknown columns are listed and may
   be mapped to a custom field or skipped.
2. **Check.** Every row is validated and normalised before anything is written; problems are
   listed per row and cell. Seen in the sample: dates with spaces or `-`, `UDS` for USD,
   `Mounth`, `Yes / YES / NO`, status in mixed case, `چک` beside `Cheque`, text in percent
   cells, `#VALUE!` amounts. Known variants are normalised; the rest are warnings (cell left
   empty) and the row still imports. A missing or duplicate `Rec` blocks that row.
3. **Import.** Jalali dates → Gregorian. Companies and clients are created when new (matched by
   name, case- and space-insensitive). In-charge person is matched to a profile by name;
   unmatched names are kept as text on the record. Status → Contract-flow stage.
4. **Re-import updates by `Rec`**: rows already present are updated, new ones added, nothing is
   deleted. So the altered sample can be loaded now and the real file later.
5. Each run is a **batch** (who, when, counts). A batch can be removed while its records have had
   no manual edits; this is how test data is cleared before the real file. Removing is the only
   delete path and asks for confirmation naming the row count.

## 6c. Engineering items table (v1)

On a record, the **Items** tab is a table engineering fills in (`project_items` edit):

```
8997 — Items                                   [+ column]  [+ row]
  No.       Type       Size      Rating      Qty   (their columns…)
▾ 8997-1    Wellhead   …         …           2
     8997-1-1   Body        …
     8997-1-2   Bonnet      …                       [+ part]
▸ 8997-2    Gate valve 3-1/16"   API 10000   3
```

- One row per item of the contract; the number is assigned on save (next dash number).
- **They create the columns they need.** A new column becomes a custom field in the company's
  field library and is shown on this record; other records can show the same column, so values
  stay comparable across records.
- **Each row expands** to its own child rows (parts), with their own columns; a child row can be
  expanded again. Depth and what each level means are engineering's choice; the tree (§5a) does
  not enforce line / unit / part.
- Prices are not in this table; they stay behind `sales_prices`.
- Every row is addressable by its number: a search box finds `8997-1-3-5` from anywhere in the
  module. This is the hook the later QC module uses (test, tester, report per node).

## 7. Documents without files

The technical proposal package is a list of named documents (catalogs, drawings, certificates,
technical offer, financial offer…). Per record, each row has: name, assignee, status
(`to do | in progress | ready`), note (where it lives: "Sajad's laptop", a share path). The
starting list comes from a template in Settings; rows can be added per record. This answers "who
has what file" without storing it.

## 8. Deadlines

- Every record shows its open deadlines with days left; overdue is red, due within the warning
  window is amber.
- **Sales › Deadlines**: all open deadlines across records, soonest first, filter "mine".
- Home board: a card for the caller's own open deadlines (only for `sales` holders).
- Reminders: a daily job queues SMS through the existing outbox (`sms_outbox`, own event keys,
  inside the per-row `begin … exception` block rule) to the responsible person at configurable
  offsets (default 7, 3, 1 days before, and on the day). **Off by default**; switched on in
  Settings › Sales.
- A deadline closes when marked done, or automatically (proposal due on Submitted, bond due on
  bond issued).

## 9. Screens

- **Sales** (`/sales`, `data-wide`, `data-table`): list of records. Columns: record no, customer,
  description, stage, owner, next deadline, plus prices for `sales_prices` holders, plus custom
  fields marked "show in list". Filters: stage, kind (open / won / lost…), customer, owner, text.
  Phone: cards with record no, customer, stage, next deadline.
- **Record** (`/sales/[id]`): header (record no, customer, stage stepper, owner, deadlines
  strip); tabs from `lib/ui/tabs.ts`: Overview · Items · Documents · Bond · Deadlines · Activity.
- **Deadlines** (`/sales/deadlines`).
- **Reports** (`/sales/reports`), replacing the PDFs / Excels management asks for today:
  pipeline by stage; results by period and customer (count, win rate, value); **price history**
  (search items by type / size / rating / text → every past quote: date, customer, qty, our unit
  price, record result, winning bid); deadline performance. CSV export through `buildCsv`.
- **Settings › Sales**: stages, custom fields, document template, reminder offsets, next
  record number.
- Farsi default + English, Persian calendar, Blueprint design system, phone-readable for
  management; data entry is designed for desktop.

## 10. Flexibility: what changes where

| Change | How |
|---|---|
| Rename / add / reorder / retire a stage, change its owner role or required fields | Settings |
| New column on records or items, show it in the list | Settings (custom field) |
| Document template, reminder offsets | Settings |
| Who sees the module, prices, bonds, reports | Role editor |
| A second flow (e.g. post-win order) | New flow rows; small build for its screens |
| New core column, new report, new permission key | Migration + deploy |

## 11. Build order (each step usable on its own)

1. Permission keys, nav entry, empty module behind the toggle.
2. Customers, records, both seeded flows, list + record page, activity.
3. Contract fields, guarantees, payments; **ledger import** (so the client sees its own
   contracts early).
4. Items table: tree, custom columns, expandable parts, number search.
5. Prices on items (with the price-permission split).
6. Deadlines, Home card, reminders.
7. Bid stages in full: decision, documents checklist, submission, result.
8. Settings: stages, custom fields, templates.
9. Reports.

## 12. Later (designed for, not built)

- **Import of past bids** (the inquiry register, if one exists) and of offer line items, on the
  same import machinery as §6b.
- **QC module** on the ID tree: tests, tester, reports per node.
- **Attachments**: a `sales_files` table (metadata under RLS) + S3-style object storage with
  short-lived links; `sales_documents` rows gain a file link.
- Offer print from items; item paste / Excel import; second flow for won orders; customer and
  competitor analysis.

## 13. Open — to confirm with the client

1. `B1.xlsx` is the contract ledger. Is there a separate inquiry register (all RFPs, including
   lost and no-bid, with our price and winning bid)? Its columns drive the seeded bid stages.
2. Record number: register shows a plain running number (7078 … 11179); the offer shows
   `BJ11511M/0`. What is `M`, and when does the revision change? Until answered: running number,
   shown with the `BJ` prefix, revision `0`, next number set in Settings.
2a. Real `B1.xlsx`: same layout as the sample? Columns right of "Payment 4" (the sheet runs to
   column BO) were empty in the sample.
3. Who decides bid / no-bid, and is it one person or a sign-off chain?
4. Bond kinds they use (bid bond only, or also performance / advance payment?) and which fields
   finance needs.
5. Package document list per customer type (the template).
6. Should the admin account see the module, or must it be hidden from it too? (Today the admin
   holds everything.)
7. Reminder channel: SMS as designed, or Home board only?

## 14. Builder's calls (not owner decisions)

- Import: re-import updates by `Rec` and never deletes; removal only per batch, only untouched
  records. `.xlsx` parsing library is chosen in the plan (verify its API first).
- Engineering's new columns go into a company-wide field library, shown per record, rather than
  free columns per record (keeps cross-record search possible).
- Payments and guarantees share the finance permission `sales_bonds`.

- Prices and bond details in separate tables rather than column-hiding views.
- Bond as a parallel track, not a stage.
- Stage `kind` as the fixed vocabulary reports rely on.
- Table prefix `sales_`; route `/sales`. The ID tree is `project_nodes`, outside the prefix,
  generic depth (parent + dash number) instead of fixed line / unit / part columns.
- Reading of the owner's last note: no uploads at all in v1; management's reports become the
  Reports page.

## 15. Build decisions (2026-11-16, at planning; these win over the text above)

1. **Access is function-only, like travel booking (FR-70).** Every `sales_*` table and
   `project_nodes` has RLS on and **no** client policy or grant. All reads and writes go through
   `app_sales_*` SECURITY DEFINER functions that check `private.has_perm` and return JSON. A
   reader without `sales_prices` / `sales_bonds` gets JSON with those keys absent. Consequence:
   `sales_rfp_prices` is not a table; `our_price`, `winning_bid`, `winner_name`, `total_value`
   are columns of `sales_rfps`. Item unit prices stay in their own table (`sales_item_prices`)
   because `project_nodes` is module-neutral.
2. **Record number** is an integer, shown as in the ledger (`8997`), no prefix; node codes are
   `8997-1-3`. Next number = Settings value, default highest + 1.
3. **Two flows per company, `kind` `bid` and `contract`.** Settings edits the stages of each;
   creating further flows has no UI in v1.
4. **Stage kinds**: `open | lost | no_bid | cancelled | done`. The bid result is stored on the
   record (`bid_result`: `won | lost | cancelled`), so reports do not depend on stage names.
   **Won** moves the record to the first stage of the contract flow.
5. **Stage `action`** (nullable: `decide | quote | submit`) marks the stages with behaviour:
   leaving a `decide` stage forward needs the bid decision; a `quote` stage is skipped by default
   when "needs quote" is off; entering a `submit` stage asks for delivery details and starts the
   offer-validity deadline.
6. **Moves**: to any active stage of the record's flow (not only one step), with a note. Moving
   forward checks the current stage's required fields. Entering or leaving a closed stage
   (kind other than `open`) needs `sales_decide`.
7. **Deadlines are derived where possible.** Proposal due, quote due, bond due, offer validity,
   guarantee expiry and **contract delivery date** (`delivery_due`, added) are kept in step with
   their source fields by one function after every write; `other` deadlines are typed by hand.
8. **SMS reminders are not in v1.** SMS sending is on hold until the provider approves message
   templates (journal 2026-11-16); a new reminder text would need the same approval. v1 has the
   Deadlines page, the per-record strip and the Home card. Reminder offsets are not stored yet.
9. **Activity log stores no price values** ("prices changed" only), so it needs no per-reader
   filtering.
10. **Import parsing happens in the browser** (the file is never uploaded); the parsed rows are
    checked again by the database function. The template is generated in the browser too.
11. **Item columns per record and per depth**: `sales_rfps.item_columns` holds, per tree depth,
    the ordered column keys shown (built-in: type, size, rating, qty, unit; plus custom item
    fields). Description is always shown.
12. **Nav**: one entry labelled **ERP** → `/sales`, following the Finance / Procurement rule (a
    tab for someone with no Manage group, otherwise an item in the Manage group). Inside the
    module: Records · Deadlines · Reports · Settings tabs.
13. **Customers** are created by typing a new name on a record or by the import; no separate
    management screen in v1.

### Added after the two reviews (2026-11-16)

14. **Names.** `company_id` is the tenant everywhere. A record's buyer is `buyer_id` ("Company"
    in the ledger), its end user `client_id`; there is no `customer_id`. G / C lives on the buyer.
15. **One way to close a bid.** Lost / No bid / Cancelled stages of the bid flow are entered only
    by the decision or the result (which store the reason and `bid_result`); a plain move into
    them is refused. Reopening a closed bid (needs `sales_decide`) clears the result, and a no-bid
    decision goes back to pending. Contract Finish / Cancel are ordinary moves that need
    `sales_decide`.
16. **What was quoted is frozen at submission.** Entering a `submit` stage copies the priced item
    rows into `sales_quote_lines` for the record's revision. Price history reads those lines, so
    engineering can keep editing the item rows after the award without rewriting history.
17. **Record number** is immutable after creation (item codes are built from it). The New-record
    form shows the next number and lets the person type the real one (bids on paper already hold
    numbers above the ledger's highest).
18. **Import rules.** An empty cell never overwrites a stored value. A ledger row whose number
    belongs to a record made in the app is skipped ("exists in app"), never merged. The stage
    follows the ledger's Status only until someone edits the record here. Guarantees and payments
    the import wrote are updated in place by kind and position; what finance typed (status,
    expiry, bank) stays. A guarantee row is made only when its percent or form is filled (the
    Amount cells are formulas). `-`, `?` and `#VALUE!` are empty. The ledger's guarantee Date is
    the issue date; expiry is unknown and shows as "No expiry date" until finance fills it.
    "Yes" = bank guarantee, "No" = none, a form cell saying باطل = status `void`. Values the
    caller could not type by hand (contract value without `sales_prices`, guarantees without
    `sales_bonds`) are not written by their import either.
19. **In-charge names** are matched in the preview: each distinct ledger name gets an employee
    picker (pre-matched on an exact name); unmatched names are kept as text. In-charge = owner.
20. **Imported contracts count as won** but are left out of win-rate reports (they have no lost
    bids beside them); only bids decided in the app are counted.
21. **Old ledger dates do not flood Deadlines.** A date already past at import time is stored as
    done; a done deadline reopens only if its source date changes.
22. **Delivery duration** that is not one number ("4-12") is kept as text (`delivery_text`).
23. **Stage `code`** (stable name of a seeded stage) is what the import maps Status on, so
    renaming a stage does not break it.
24. **Tree levels are engineering's call** (owner). `level_kind` is dropped. Where unit-level
    tracing is needed, engineering adds a level (item → unit → part). Bulk "create N units /
    copy parts to all units" is not in v1.
25. **Lock order:** every write locks the record row first, then child rows.
26. **Hidden module:** a caller without `sales` gets a 404 on `/sales/*`; the `sales` strings are
    sent to the browser only by the module layout. The seven permission labels still travel in
    the role editor's strings (accepted).
27. **Accepted, on purpose:** guarantee amounts reveal the contract value to a `sales_bonds`
    holder; extra (custom) fields are visible to every Sales reader (the editors say not to use
    them for prices); someone holding Sales permissions can be edited or have a password reset
    only by a caller who holds at least the same (the existing D4 rule: in practice the admin),
    so nobody weaker can sign in as them.
