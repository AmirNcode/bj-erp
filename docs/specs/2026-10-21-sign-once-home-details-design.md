# Sign once for several steps, request details on Home, finance default range

**Date:** 2026-10-21 · **Status:** approved by owner 2026-10-21 (with the Remove button added)
**Trigger:** owner's production test (regular employee → manager = Head of HR → HR → procurement → finance).
**Requirements:** FR-71 (new), FR-72 (new), FR-62 (amended).

## 1. Sign once when one person holds several steps (FR-71)

**Problem.** The employee's manager is the Head of HR, so the same person owns the direct-manager step and
the HR step. The approval queue offers one step per signature, so they open the dialog and sign twice.

**Rule.** When the caller can sign several open steps of one request, one signature approves all of them.
This covers their own steps and the steps they sign as someone's delegate (owner, 2026-10-21).

**Which steps go together.** Walk the open steps (not decided, not HR-exempt) in step order. A step goes in
the bundle when the caller may sign it now (`can_approve`), or when it is the caller's step (`is_mine`,
entitled apart from the order rule) and every open step before it is already in the bundle. So with the
approval order enforced, a step owned by someone else in between stops the bundle there; without the order
rule, every step the caller owns goes in. Pure function in `lib/leave/approval-context.ts`, unit-tested.

**Dialog.** The step picker in the approve dialog becomes a list: "You are signing as: Direct manager ·
Head of HR" (delegated steps read "on behalf of <name>"). One signature, one consent tick. The per diem field
and the travel-booking tick show when the bundle holds the HR step of an errand. The admin override stays
as it is. The reject dialog is unchanged (rejecting any step ends the request).

**Database (new migration).**
- `app_request_approval_progress`: each open step also returns `is_mine` (natural or delegated authority,
  ignoring the order rule). `per_diem_allowed` follows `is_mine` instead of `can_approve` on the HR step.
- New `public.approve_leave_request_steps(p_id, p_step_ids uuid[], p_signature_data, p_signature_authorized,
  p_per_diem_rials)`: rejects an empty or duplicate list, sorts the ids by step order and calls
  `private.decide_approval_request` once per step in one transaction (same signature on each; per diem only
  on the HR step). Each call re-checks entitlement and the order rule, so a step the caller may not sign
  fails the whole call and nothing is saved. One audit row per step, as today.
- `approve_leave_request_v2` stays for the old app during the release.

**Records.** Each step still gets its own row in `leave_request_approvals` with the same signature image, so
the print form, progress list and evidence are unchanged.

## 2. Full request details in Home's Recent requests (FR-72)

**Problem.** After procurement books the trip, the employee sees the transport and note only on the
Requests tab; Home's card shows just type, dates and an "Approval steps" toggle.

**Change.**
- Extract the detail block of `MyRequestsList` (per diem, procurement's transport and note, dates, day part
  / time, unpaid part, tracking number, cover, rejection note, approval steps, signatures) into a shared
  `RequestDetails` component; the Requests tab keeps rendering the same thing through it.
- Home's Recent card shows the summary line as now, plus a **Show more** button in place of "Approval
  steps"; it opens `RequestDetails` under the row. Home fetches `getMyTravelBookings()` for the notes.
- **Which requests stay on Home** (replaces "latest 5"): pending, approved and rejected requests until the
  day before their return-to-work day; they are gone on the return-to-work day itself (owner, 2026-10-21).
  Cancelled requests leave at once. Return-to-work day comes from `lib/leave/returnToWork.ts` (work
  settings + holidays). A pending request whose return day has passed also leaves Home (still on the
  Requests tab and in the approver's queue). When nothing is left, the card shows the empty text with a
  link to the Requests tab.
- **Same-day return (my call).** When the return-to-work point falls later the same day (hourly request,
  morning half day), the request stays through that day and leaves the next day; otherwise an hourly leave
  would vanish from Home on the very day it happens.
- **Remove from Home (owner, 2026-10-21).** A rejected request on Home gets a **Remove** button. It hides that
  request from Home for good, on every device; the Requests tab still lists it. Stored in a new table
  `public.home_dismissed_requests(request_id pk → leave_requests on delete cascade, employee_id → profiles on
  delete cascade, dismissed_at)`, own-row read under RLS, written only by
  `public.app_dismiss_home_request(p_id)` (caller's own request, status `rejected`; repeat calls are a no-op).
  A table, not a column, so the write never touches `leave_requests` and its approval-lock triggers.

## 3. Finance did not show the approved trip (FR-62 amended)

**Cause (confirmed by the owner 2026-10-21: the trip showed after picking the next month).** `/finance` lists requests whose trip dates
overlap the chosen range, and it opens on the current Jalali month. The test was on 29 Mehr 1405; a trip in
Aban falls outside Mehr, so neither section shows it until finance picks Aban. Finance needs only the
finance read permission; it is not an approval step, so no Manager role is needed.

**Change.** The default range becomes the first day of the current month to the last day of the next
month, so upcoming approved trips show at once. The range picker and CSV work as before.

## Out of scope
- Notifications to finance or procurement.
- Changing who owns which step.
