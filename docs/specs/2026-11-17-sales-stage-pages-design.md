# Sales record — stage pages (FR-94 follow-up)

**Date:** 2026-11-17 · **Status:** draft for owner review (scope: fields now, list-row values later) · **Builds on:**
`docs/specs/2026-11-16-sales-rfp-module-design.md` (FR-94), branch `feat/erp-sales-module`.

## 1. Why

The record page (`/sales/[id]`) has a stage bar you cannot click and three top-right buttons
(Move stage, Bid decision / Record result, Edit) that confuse people and show at the wrong time:
"Record result" appears on a record still in **Received** because it only checks
`bid_decision = 'bid'` and "not closed" (`RecordView.tsx`). The owner wants the work to follow
the stages: open a stage, fill what belongs to it, submit, move on — with a ledger of who changed
what.

## 2. Goals

- The stage bar is the navigation. Clicking a stage opens that stage's page with only the
  fields and lists that belong to it.
- Each stage page has **Submit** at the bottom. Submit saves the page's field edits in one go
  and writes one ledger entry: who, when, which stage page, and every field **old → new**.
- **Next stage** moves the record to the following stage once the current stage is complete.
- The three top-right buttons are removed.
- Past stages stay editable (owner, 2026-11-17); every change is in the ledger.

## 3. Non-goals

- No batching of list edits (items tree, documents checklist, guarantees, payments, deadlines):
  those keep saving row by row (owner chose approach A, §5).
- No per-stage field ownership enforced in the database: any `sales` editor may still change any
  record field through `app_sales_save`; which page shows which field is a UI concern.
- No change to the stage engine (flows, kinds, actions, Settings › stages), to the import, or to
  reports.
- No change to the rule that price and guarantee values never enter the log.

## 4. Anti-goals

- A ledger that leaks prices to people without `sales_prices`.
- Submit overwriting someone else's edit to a field the submitter never touched.
- Losing typed edits silently when someone clicks another stage.

## 5. Approaches (decided)

- **A. Hybrid (chosen).** Record fields on a stage page are a draft until Submit; lists on the
  page save per row as today, each row change already logged with its author. Keeps the items
  tree (permanent codes, numbered on insert) reliable.
- B. Everything waits for Submit, lists included. Rejected: rewrites the items tree as an
  offline editor, bigger failure and collision surface.

## 6. The page

```
RFP · Record no. 10090                                   (no buttons here)
12 wellheads, 2 valves for NIOC
NIOC
[Received ✓]—[Bid decision ●]—[Technical proposal]—[Pricing]—[Ready to send]—[Submitted]
Stage · In charge · Our price · Next deadline        (summary strip, unchanged)

Bid decision                                    ← heading of the selected stage page
… this stage's fields / lists …
──────────────────────────────────────────────
[Submit]                         [Next stage →]   (or the stage's own closing actions)

Deadlines · Activity                            ← tabs under every stage page
```

- **Stage bar:** every active open stage of the record's flow is a button (link). Current stage
  filled, past stages marked done, future stages muted. A closed stage (Lost / No bid / Cancelled /
  Finish / Cancel) shows as a tag after the bar, as today, and is itself clickable (its page shows
  the result / reason).
- **Selected stage** is in the URL: `/sales/[id]?stage=<stage id>`; no parameter = current stage.
  `?node=` (item search) still opens the items list: it selects the stage page that holds items
  (Technical proposal, or the first page with items).
- **Future stages** open read-only (fields shown, no inputs, no Submit / Next).
- **Unsaved edits:** (changed after the final review, 2026-11-17) each stage keeps its draft until Submit, so switching
  stages or Back / Forward loses nothing; a dot marks stages with unsaved changes. Leaving the record (in-app link,
  reload, closing the tab) asks first. When the stored record changes, untouched fields follow it.
- **Custom fields** are sent per changed key and merged by the database (`20261117110000_sales_custom_merge`).
- **Company type** (G / C) belongs to the company: editable only while the company has none.
- Phone: stage bar scrolls horizontally; Submit / Next become full-width, stacked.

## 7. Stage → content

Content is chosen by the stage's stable `code` (seeded stages). A stage with no code (added in
Settings) shows its `required` fields plus a note that it has no dedicated page.

### Bid flow

| Stage (`code`) | Fields (draft → Submit) | Lists (save per row) | Closing actions |
|---|---|---|---|
| Received (`received`) | title, buyer + G/C, client, customer ref, source, received on, project site, description, in charge, currency, proposal due, needs quote + quote due, needs bond + bond due, custom record fields not required by another stage | — | Next stage |
| Bid decision (`decision`) | decision reason (typed before the click; afterwards editable by Submit, `sales_decide`) | — | **Bid** (= `app_sales_decide` true; moves on as today) · **No bid** (closes). Needs `sales_decide`; without it the page explains who decides. No separate Next. |
| Technical proposal (`technical`) | — | items tree (no price columns) · documents checklist | Next stage |
| Pricing (`pricing`) | our price (typed only when no item is priced; `sales_prices` edit) | items tree with unit prices (price columns need `sales_prices`) | Next stage |
| Ready to send (`ready`) | — | documents checklist · guarantees (`sales_bonds`) | Next stage |
| Submitted (`submitted`) | submitted on, delivery method, received by, offer validity | — | **Record result**: Won / Lost / Cancelled dialog (existing `ResultDialog`, needs `sales_decide`). No Next. |
| Lost / No bid / Cancelled | read-only: result or decision, reason, winning bid + winner (prices cap) | — | **Reopen** (needs `sales_decide`, existing move back to an open stage) |

Moving **Ready to send → Submitted** with Next fills submitted on = today and validity = the
setting, as `app_sales_move_stage` already does with no submit details; the Submitted page is
where they are corrected. The quote snapshot is taken on entering Submitted, unchanged.

Pricing is skipped by Next when "needs quote" is off (existing `defaultNextStage`); its page stays
openable.

### Contract flow

| Stage (`code`) | Fields | Lists | Closing actions |
|---|---|---|---|
| New (`new`) | contract value (prices cap), order date, contract start, delivery duration / text, delivery date, prepayment + date, addendum, in charge | guarantees (`sales_bonds`) | Next stage |
| Current (`current`) | delivery date, in charge | payments · guarantees | **Finish** (`sales_decide`) · **Put on hold** |
| Hold (`hold`) | — (note via Activity) | — | **Resume** (back to Current) · **Finish** · **Cancel** (`sales_decide`) |
| Finish / Cancel | read-only | — | Reopen (`sales_decide`) |

Hold is a side state, so Next from New goes to Current (skips Hold); Hold is entered only by
"Put on hold". A won bid is the same row moved to the contract flow (`app_sales_result` changes `flow_id`), so
its bid fields are on the record: New shows them as a read-only "Bid" summary (received,
submitted, result). No link column needed.

### Everywhere

- **Next stage** = `app_sales_move_stage(id, next, owner, note)` with `defaultNextStage`. It opens
  a small confirm with the next owner (defaulting as today) and an optional note. Disabled, with
  the reason shown, when: the draft is dirty ("Submit your changes first"), a `required` field of
  the current stage is empty (names listed), or the caller lacks the right.
- Next / closing actions appear only on the **current** stage's page. A past stage's page has
  Submit only.
- **Deadlines** and **Activity** tabs sit under every stage page. The Items / Documents /
  Guarantees / Overview tabs go away (their content lives on stage pages). Guarantees & payments
  stay reachable for finance on every record via the stage that holds them.

### Closed records

A record in a closed stage (Lost / No bid / Cancelled / Finish / Cancel) opens on that stage's
page. Its earlier pages are read-only unless the caller has `sales_decide` — the existing rule
(a closed record is written only with `sales_decide`) wins over "past stages editable".
**Reopen** opens the existing stage picker limited to open stages (`app_sales_move_stage`).

### Next stage details

- Next uses `defaultNextStage`; from Received it goes to Bid decision (allowed while the decision
  is pending — the server's "decision required" check only blocks jumping *past* a decide stage).
- "Required fields" = the stage's `required` list from Settings, checked on **server state** (the
  draft must be submitted first). Seeded stages have none; no new defaults.
- Next never auto-submits.

## 8. Submit and the ledger

- Submit sends only the fields the user changed (patch) to `app_sales_save`, plus the stage page
  id. Untouched fields are not sent, so a colleague's concurrent edit to another field survives.
  Same field edited by two people: last Submit wins, both visible in the ledger.
- New migration redefines `app_sales_save_record` (same signature + optional `p_stage uuid`;
  old callers keep working). It also accepts `decision_reason` and `result_reason` (both need
  `sales_decide`; the decision and result themselves still change only through
  `app_sales_decide` / `app_sales_result`). Its `edit` event body becomes:

  ```json
  { "stage": "<stage id or null>",
    "fields": ["proposal_due", "our_price"],
    "changes": [ { "field": "proposal_due", "from": "2026-11-15", "to": "2026-11-16" },
                 { "field": "our_price", "hidden": true } ] }
  ```

  `fields` stays for old readers. Values are written for every field except the price ones
  (`our_price`, `winning_bid`, `winner_name`, `total_value`), which get `hidden: true` — the log
  stays readable by every Sales reader (spec decision 9). Person fields store the id; the UI shows
  the name. Customer fields store the name. Custom fields are diffed per key
  (`field: "custom.<key>"`). `prepayment` (yes/no) and delivery duration are not money and are
  logged with values. Side effects are listed in the same entry (`"side": ["bid_bond_opened"]`
  when "needs bond" opens the bond row).
- `RecordForm` stays only for **New record**; editing an existing record happens on stage pages
  only, so every edit carries its stage.
- List writes keep today's row events (who + which row). Old → new values on list rows
  (items, documents, deadlines) are **a follow-up, not this change** (owner, 2026-11-17).
- **Activity tab** shows each Submit as one entry: actor, time, "on <stage>", then the changes as
  `Field: old → new` lines (dates in Jalali, people by name, booleans as yes/no, hidden ones as
  "changed"). Old events with field names only render as today.

## 9. Constraints

- Migrations forward-only, new file; `app_sales_save` keeps its existing behaviour and locking
  (record row first). Read functions unchanged except none needed.
- `supabase/schema.sql` updated by diffing clone dumps (local DB anon drift), dry-run on a clone.
- Farsi + English strings for every new label; `sales` namespace (module layout only).
- Blueprint design: tabs from `lib/ui/tabs.ts`, no shadows, `data-table`.
- `lib/supabase/types.ts` hand-edited if the RPC signature changes.

## 10. Calls made by Claude (owner to check)

1. Stage in the URL as `?stage=<id>`, not a sub-route.
2. Future stages viewable read-only; Next / closing actions only on the current stage.
3. Bid decision page: Bid / No bid buttons are the page's closing actions (no Next).
4. Submitted page: Record result replaces Next; result dialog unchanged.
5. Closed records: earlier pages read-only without `sales_decide` (existing closed-record rule).
6. Decision / result reasons editable later by Submit with `sales_decide`; the decision and
   result themselves only through their buttons.
7. Next disabled while the draft is unsaved; never auto-submits.
8. Contract Hold handled as side buttons (Put on hold / Resume), not a Next step.
9. Overview, Items, Documents, Guarantees tabs removed; Deadlines + Activity stay under each page.
10. Custom record fields live on Received unless a stage lists them as required.
11. Price fields logged as "changed" without values.

## 11. Left to the builder

Component split, how the draft state is held, exact copy, the confirm-dialog layout, test names.
