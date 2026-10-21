# Travel booking for out-of-town work errands (procurement → finance)

Status: design draft 2026-10-20, from HR/administration's description of today's paper process
and the owner's decisions in chat; builder check done. **Approved by owner 2026-10-20.** Implemented on branch `codex/travel-booking` (PR #10); owner review amendments in §11.
Plan: `docs/plans/2026-10-20-travel-booking.md`. Traveller field list stays a placeholder until procurement confirms.
Requirement number when it lands: **FR-70** (placeholder).

## 1. Why

Out-of-town / out-of-province work trips need a plane ticket and/or a hotel. Today, after the
manager and HR/administration approve the paper errand form, the request goes to procurement
(تدارکات), who buys the ticket and hotel using the traveller's personal details, tells the
traveller the flight and hotel details, and passes a cost summary to finance. Cancellations and
extensions travel by word of mouth: manager → HR → procurement. The app already carries the
errand and its approval (FR-33), HR's per diem (FR-61) and finance's view (FR-62); this feature adds
the procurement leg so finance sees **per diem + travel + lodging** for each trip in one place.

## 2. Goals, non-goals, anti-goals

**Goals**
- HR marks which approved daily errands need travel booking; only those reach procurement.
- Procurement sees the traveller's personal details live, records transport and costs, and leaves
  the traveller a short note with the flight/hotel details.
- Finance sees per diem, flight cost, hotel cost and total per trip, and the amount lost on a
  cancelled trip.
- Extensions and cancellations follow HR's described path inside the app.

**Non-goals (v1)**
- Uploading tickets, invoices or itineraries (the stack has no file storage; invoices keep going
  to finance on paper).
- Advances (علی‌الحساب), expense claims, post-trip settlement.
- Suppliers, purchase orders, budgets, cost limits, ticket-class or hotel-tier rules.
- Company-car / driver / fleet tracking. "Company car" is just a transport value.
- Automatic rules (distance, duration) for flight vs car. HR and procurement decide that outside
  the app; procurement records the outcome.
- Shortening a trip or coming back early; cancelling a trip that has already started.
- Multi-leg itineraries and group bookings (each traveller files their own errand).
- Travel booking on hourly errands, and on leave.
- New fields on the daily errand form. Its existing **محل ماموریت** is the destination.

**Anti-goals** (would make this a failure even if it works)
- Procurement able to browse personal info beyond the few fields it needs, or beyond the trips
  it is booking.
- Procurement becoming an approval step that can reject or hold up an approved trip.
- A form or screen that asks every employee travel questions for what is usually a local errand.

## 3. Actors and permissions

- **Requester** — files a normal daily work errand (FR-33). Unchanged.
- **Direct manager** — approves as today; may **request an extension** on an approved
  travel-booked trip (§6).
- **HR** — whoever can sign the request's `hr` approval step under today's rules (hr role holders,
  their valid delegates). They tick "needs travel booking", approve extensions, and cancel
  travel-booked trips. The admin can do all of these too.
  - *Note:* today the HR preset holds `leave_requests` at **read**, so HR cannot cancel requests.
    This feature lets HR cancel **travel-booked** errands only (§7); it does not widen general
    cancel rights.
- **Procurement** — a new permission catalog item **`travel_booking`** (shape `E`, Yes/No), in a
  new **Procurement / تدارکات** section of the role editor, plus a new editable **Procurement**
  preset role holding it (like the Finance preset). Because procurement is **not** an approval
  step, it does not need an `app_role` enum value; a custom role holding `travel_booking` works
  equally. Follow the CLAUDE.md "new permission grant = a catalog item" checklist, except
  `private.can_act_on`: booking records costs on a request, it does not act on the person, and
  procurement must be able to book for senior staff (CEO, HR head, admin). Scope comes from the
  request instead (travel-booked, not closed). **No self-booking:** a `travel_booking` holder cannot
  save, finish or settle the booking on their own trip; another holder or the admin does.
  *(My call.)*
- **Finance** — unchanged `finance` read; sees the new columns.

## 4. Flow

```
Requester files daily errand
  → manager (and any other configured steps, in today's order)
  → HR step signs  ── HR ticks «نیاز به رزرو سفر» (needs travel booking)?
        no  → errand approved as today, never reaches procurement
        yes → errand APPROVED (calendar, security board, per diem as today)
              + booking opens for procurement: «در انتظار رزرو» (to book)
  → procurement books outside the app, records transport/costs/note, marks done: «رزرو شد» (booked)
  → trip appears on /finance with per diem + flight + hotel + total
```

- The request's approval status is untouched by booking: it is **approved when the approval chain
  finishes**, as today. HR is the final approver; booking is fulfilment after approval.
- **Tick at the HR step.** Shown only on daily work errands, on the HR step's approve dialog,
  default off. Saved with HR's signature; the booking opens only when the **whole chain**
  finishes (the chain is configurable and may have steps after HR, or run out of order under
  FR-66). *(My call.)*
- **Tick after approval.** When nobody signs an HR step — the Head of HR's own errand (HR step
  exempt, FR-68), an admin override (FR-58) — or HR forgot, HR or admin can tick it on an
  already-approved daily errand until its end date has passed.
- **Untick.** HR or admin can untick until procurement first saves anything on the booking. After
  that, the path is cancellation (§7).
- **Missing personal info at the HR step.** When the box is ticked and any of the traveller's
  required fields (§5) are empty, the dialog shows a non-blocking warning listing the missing
  fields and a link to the traveller's personal info. HR may still approve. The same warning shows
  when ticking after approval.

## 5. What procurement sees and records

**Procurement list** (new page, e.g. `/procurement`, plus a Home count card): bookings grouped by
state — **To book**, **Extension: update the booking**, **Cancelled: undo the booking**, **Done**.
Each row: tracking number, traveller, destination (`errand_location`), dates, state.

**Booking detail**
- Trip: tracking number, traveller name and personnel number, department, destination,
  description (شرح ماموریت), start/end dates, approval progress, any extension reason.
- **Traveller details — read live** from `profiles` / `employee_personal_info` on every view,
  never copied, so an edit HR makes after approval shows up immediately.
  **Placeholder field list, to be confirmed with procurement:** full name, national ID, birth
  date, mobile, gender. Exactly this list drives both procurement's view and HR's
  missing-info warning (one constant, one place to change).
- Procurement records:
  - **Transport**: `flight` | `company_car` (fa: هواپیما / خودروی شرکت). Required to mark done.
  - **Flight cost** — whole Rials, ≥ 0; 0 for company car.
  - **Hotel cost** — whole Rials, ≥ 0; 0 for no hotel.
  - **Note to traveller** — short free text (flight number and time, hotel name and address).
  - **Mark done** → state «رزرو شد».
- Procurement may edit a done booking (costs, note) while the trip is not closed; every save is
  audited. *(My call.)*

**Privacy scope.** Procurement sees a traveller's details only through a SECURITY DEFINER function
for a request that has travel booking and is not closed, and only the fields in the list above. A
closed booking (done and the trip ended, or cancellation settled) still shows costs, but no
personal details. *(My call.)*

**Traveller** sees, on My Requests, the transport and procurement's note once booking is done; not
the costs. *(My call.)*

## 6. Extension

1. The **direct manager** (or admin) — or, on their **own** trip, a holder of the built-in Manager
   role (*amended 2026-10-20, §11*) — opens an approved, travel-booked trip that has not ended and
   chooses **Extend trip / تمدید ماموریت**: a new end date, later than the current one, and a
   **required reason**. Only one pending extension at a time.
2. The extra days are conflict-checked against the traveller's leave and errands, as for a new
   request. While the extension is pending, the trip stays approved for its original dates and the
   extra days show as pending.
3. **HR alone** decides the extension (owner: "HR re-approves"), even if the errand chain has
   other steps such as the CEO; no second pass through the step engine. HR sees the reason and
   **approves with a signature** or **rejects**.
   - Approve → `leave_requests.end_date` becomes the new date, so calendar, security board and
     conflict checks follow; the originally signed end date is kept on the extension record, and
     the print form shows "extended to … (reason)" under the original dates *(my call)*; HR may change the per diem;
     the booking returns to procurement as **Extension: update the booking**; procurement updates
     the hotel/flight, both costs and the note, then marks done again.
   - Reject → nothing changes; the reason and rejection stay on the request.
4. If the trip's HR step was exempt (Head of HR's own trip), the extension follows the same
   exemption: approved at once without an HR signature, recorded as exempt, and the **per diem
   stays as originally entered** (FR-68: never editable afterwards). *(Owner, 2026-10-20.)*
5. **Temporary approval delegation** tied to this trip (`approval_delegations.source_request_id`)
   is **not** extended in v1. When one exists, the extension screen and HR's approve dialog warn
   that the traveller's approvals are uncovered for the extra days. *(My call.)*
6. The extension, its reason and the signatures appear in the approval progress (FR-64) and the
   audit log. Finance sees the updated totals on the same row.

## 7. Cancellation

- **Who:** HR (via the manager's word, outside the app), the admin, or the requester (own trip,
  before it starts, as today — FR-15). Cancelling a trip that has started is out of scope.
- A pending extension is cancelled with the trip.
- **The trip always goes back to procurement** as **Cancelled: undo the booking**, even if
  procurement had not marked it done, because tickets may have been bought before anything was
  saved. Procurement cancels the bookings outside the app, then enters the **amount lost**
  (fees, non-refundable nights; whole Rials, 0 allowed — a one-click "nothing was booked" for 0)
  and an optional note, and closes it. *(My call; amends the chat playback, where an unbooked
  cancellation simply dropped out.)*
- On `/finance` a cancelled travel trip shows as **cancelled** with **only the amount lost** — no
  per diem, no flight or hotel cost. A cancelled trip with 0 lost may be hidden or shown; left to
  the builder.

## 8. Finance (`/finance`, FR-62)

> **Superseded in part by §11 (owner review, 2026-10-20):** approved travel trips show at once, and
> `/finance` also lists pending requests. The text below is the original design.

- Today `finance_approved_requests(from, to)` returns `status = 'approved'` rows overlapping the
  range. Change:
  - A travel-booked trip appears **only once its booking is done** (HR: "last step, summary sent to
    finance"). While it is to-book or awaiting an extension update it does not appear (or appears
    marked "booking in progress"; left to the builder, but totals must not count it).
  - A cancelled travel trip with a settled booking appears with the amount lost.
  - New columns: transport, flight cost, hotel cost, amount lost, total (per diem + flight + hotel,
    or amount lost). Same in the CSV, and in the totals row.
- Errands without travel booking are unchanged.
- Which month an extended or cancelled trip belongs to in the range filter is left to the builder
  (trip dates are today's rule).

## 9. Data, audit, i18n

- **Data shape left to the builder.** Suggested: a `travel_bookings` row per request (state,
  transport, costs, lost amount, note, ticked_by/at, done_by/at) and an `errand_extensions` row per
  extension (new end date, reason, requested_by, decision, signer, signature). Amounts `bigint`
  Rials ≥ 0, like `per_diem_rials`. New enum values each get their own migration (CLAUDE.md).
- Writes go through guarded SECURITY DEFINER RPCs starting with permission checks; RLS stays the
  source of truth; procurement gets no direct table access to `employee_personal_info`.
- Lock order: the extension approval writes `leave_requests`; take `private.approval_lock(company)`
  before any `'leave:'||employee` lock (CLAUDE.md).
- Audit actions (names only for personal info, never values): tick/untick, booking save, done,
  extension request/approve/reject, cancel, lost amount entered.
- All strings fa + en. Suggested fa labels: «نیاز به رزرو سفر», «تدارکات», «در انتظار رزرو»,
  «رزرو شد», «تمدید ماموریت», «علت تمدید», «لغو شده – لغو رزرو», «مبلغ از دست رفته»,
  «هزینه بلیت», «هزینه هتل», «توضیح برای مسافر».
- The print form (FR-38) is unchanged in v1 apart from the extension line in §6. *(My call.)*

## 10. Open

- **Personal-info field list** (§5) — owner is confirming with procurement. Airlines may also need
  father's name or birth certificate number; both already exist in `employee_personal_info`.
  Anything not there (e.g. passport number) would add a column, HR editing and CSV-import changes.

## 11. Owner review amendments (2026-10-20, PR #10)

- **Finance sees pending and approved (FR-62/FR-70).** `/finance` lists every request in the range,
  leave and errands, in two sections: **Fully approved** and **Pending approval**, each with its own
  count and totals; the headline totals count approved only. A pending row shows the step it waits on
  as a label only (Direct manager, HR, …): no approver names, signatures or reason. An approved
  travel-booked trip shows as soon as it is approved, booked or not; costs not yet recorded show "—"
  with a **booking not finished** marker (costs procurement already saved show and count). Cancelled
  trips keep the rule above: shown once settled, amount lost only, under Fully approved. The CSV covers
  both sections with a status column (and the step waited on). New `finance_requests(from, to)`
  (migration `20261020120007`); `finance_approved_requests` stays unchanged for the old app during a
  release.
- **Manager's own trip.** A holder of the built-in Manager role may request an extension of their own
  approved, travel-booked trip (migration `20261020120008`). HR still decides; the Head of HR's exempt
  path is unchanged; the manager's direct reports never can. After a rejection, a new extension may be
  sent (one pending at a time).
- **Reject extension** asks for confirmation, like approve.
- **The Head of HR's own trips skip HR at every stage** (owner, after the security review of `…08`):
  only they see «نیاز به رزرو سفر» on their daily errand form (ticked right after submission; the
  booking opens on approval like everyone's); they extend their own trip themselves and it applies at
  once on the exempt path (§6.4), back to procurement. Accepted self-approval: they already sign their
  own requests as the CEO's delegate. Migration `20261020120010` (replaces `…09`, which refused it).
- Deferred (see `docs/TASKS.md`): an hr holder's delegate acting on that hr holder's own trip; the
  unlocked status read in `app_set_travel_booking`; HR approving an extension after the trip ended.
