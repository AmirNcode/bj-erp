# Replacement on paper only, and the Edit requests permissions — design

**Date:** 2026-11-10 · **Status:** approved 2026-11-10 · **FR:** FR-90 (amends FR-28), FR-91
(replaces the FR-84 gate) · **Branch:** `feat/form-signature-boxes` (PR #23)

## Why

New information from HR, 2026-11-10:

1. **A replacement (جانشین) is not an approval delegate.** A manager on leave still opens the app and
   approves or rejects their direct reports' requests. The replacement is a name on the paper form.
   Today (approval delegation amendment) a replacement who is an eligible approver receives temporary
   approval authority for the absence. That is wrong for this company.
2. **HR needs to edit approved requests of every type,** not only the dates and per diem of a daily
   trip (FR-84). The right to edit must be a permission the admin switches per role, one switch per
   request type.

This reverses one owner decision of 2026-11-05 ("regular leave dates are not corrected at all").

## Decisions (Amir, 2026-11-10)

### FR-90 — Replacement is on paper only

1. A replacement **never** receives approval authority, for anyone, the CEO included.
2. Requests always go to the original approver, also while that approver is on leave.
3. **Saved delegates** (Manage › Approval steps) keep working exactly as now.
4. The replacement's sign-off (FR-88), the Home card, the calendar entry and the paper box stay.

### FR-91 — Edit requests

5. Four new permissions, each its own toggle in the role editor (new role and edit role):
   **edit daily leave · edit hourly leave · edit daily work trip · edit hourly work errand.**
6. Only **approved** requests can be edited. Pending, rejected and cancelled ones cannot.
7. An editor may edit the requests of **every other employee in the company** (see 12).
8. Editable: the **duration** (dates, times, day part) and the **request type within one family**:
   daily leave ↔ hourly leave, daily trip ↔ hourly errand. Never leave ↔ work. Nothing else
   (leave type, location, description, replacement stay as filed).
9. **All signatures stay valid** (requester, replacement, approvers). The edit is recorded: who, when,
   old and new values.
10. An edit obeys the **same limits as a new request**: no overlap with the person's other requests,
    no negative balance, the hourly daily limit. A breaking edit is refused, not warned.
11. The new trip permission **replaces** the FR-84 gate (HR role / HR-step holder). It also gates the
    per diem correction. The `hr` preset role gets all four switched on, so HR loses nothing.

12. **Editing one's own request is a fifth toggle: "edit own requests"** (2026-11-10). Without it an
    editor cannot edit their own request; with it they can, for the types whose toggles they hold. The
    admin always can. Off by default for every role, the `hr` preset included (FR-84's spec listed "HR
    can correct their own trip" as an anti-goal; the admin now decides).

## Claude's calls (check these)

**FR-90**

- **Picker population unchanged.** The leave Replacement picker keeps offering department colleagues
  plus eligible approvers from other departments (a manager often has no peer in their own
  department). Being picked confers nothing.
- **Existing temporary grants are revoked** by the migration (`approval_delegations` rows with a
  `source_request_id`, `revoked_at = now()`). None exist in production: the amendment is unreleased.
- **Function signatures stay.** `p_temporary_ceo_authorized` and the preview's `temporary*` keys remain
  for the still-running old app; the parameter is ignored and the keys return null / false.
- **Form copy.** Every line that ties the Replacement field to approvals goes: the temporary-authority
  notice, the temporary CEO attestation, and the "no approval cover while you are away" warning (the
  manager approves while away). The CEO-delegate automatic-approval consent, which belongs to saved
  delegation, stays.
- `app_change_replacement` loses its "replacement is the temporary approval delegate" refusal.

**FR-91**

- **Reason and signature stay required**, as in FR-84: reason 1–1000 characters, the editor's signature
  (saved signature supported). This is the "log" of decision 9.
- **A type change needs both toggles**: daily leave → hourly needs "edit daily leave" and "edit hourly
  leave".
- **Permission keys** (shape `E`, action only): `edit_leave_daily`, `edit_leave_hourly`,
  `edit_errand_daily`, `edit_errand_hourly`, `edit_requests_own`, in a new role-editor section "Edit
  requests". Each depends on `leave_requests` read (the editor works from Manage › Requests). Admin
  always passes. `edit_requests_own` alone edits nothing: it lifts the own-request refusal for the
  types the holder may edit.
- **Delegates no longer inherit it.** FR-84 let the delegate of an `hr` holder correct trips. A
  permission is held through a role, so a delegate edits only if their own role has the toggle.
- **Migration grant:** every role that is the `hr` preset gets the four type keys, not
  `edit_requests_own`. No other role.
- **Balance rule, precisely:** a new request may run past the balance (the excess is unpaid). An edit
  may not create or grow an unpaid part: it is refused when the request's unpaid minutes would rise.
  Shrinking a request that already has an unpaid part is allowed.
- **Trip → hourly errand:** per diem is cleared (an hourly errand carries none, FR-61). Refused when
  procurement has opened a booking for the trip, and while an extension is pending.
- **Hourly errand → daily trip:** the trip enters procurement as a newly approved trip would. Per diem
  may be set in the same edit.
- **Leave ledger:** the request's debit is corrected by a new ledger row for the difference (the ledger
  stays append-only), under the employee lock. A shorter leave returns time, a longer one takes it; a
  balance that would go below zero refuses the edit.
- **Past requests are editable**, no time limit, as in FR-84.
- **What the others see:** the requester and approvers see a line per edit (old → new, reason, editor,
  time) on the request. No SMS. Finance keeps its "Corrected" marker for trips.
- **Print form:** as FR-84 — the form prints the originally signed values, then one line per later
  change in time order (extensions and edits mixed). A type change prints on the form of the
  **current** type, with the signed original shown in the change lines.
- **Storage:** `request_corrections` is extended, not replaced: before/after columns for unit, day part,
  start and end time, and requested minutes join the existing date and per diem columns. Still
  append-only, RLS on, no client policies.
- **RPC:** one new `app_edit_request(...)` for all four types. `app_correct_trip` keeps its signature
  for the old app and becomes a call into the same code, under the new gate.
- **UI:** the **Correct** button on Manage › Requests becomes **Edit**, shown on approved requests whose
  type the caller may edit. One dialog: a daily / hourly switch (when the caller holds both toggles of
  the family), then the matching date or date-and-time fields, day part for daily leave, per diem for a
  daily trip, reason, signature.

## Amendments after the PR review (2026-11-10)

- **Unpaid-type leave may be lengthened** (Amir). "An edit may not create or grow an unpaid part" applies
  to balance leave only; a leave of an unpaid type is unpaid by nature.
- **An editor may edit the admin's request** (Amir): decision 7 includes the admin. Cancel still does not.
- **Ledger row type:** the difference is posted as `consumption` (longer) or `reversal` (shorter), not
  `adjustment`, because Home's "used" counts only those two (migration `20261110130000`).
- **Trip → hourly errand is also refused once an extension was approved**: the approved extension would
  stay on a one-hour errand.
- "None exist in production: the amendment is unreleased" (temporary grants) was not accurate: `main`
  creates them. The live backup of 2026-11-10 holds none, and the migration revokes any.

## Goals, non-goals, anti-goals

**Goals**

- A manager on leave keeps their approval queue; naming a replacement changes nothing about approvals.
- The admin decides, per role and per request type, who may edit approved requests.
- Balances, reports, procurement and finance stay correct after an edit.

**Non-goals**

- Editing pending requests (the requester cancels and files again, or the approver rejects).
- Editing leave type, location, description or replacement.
- Leave ↔ work conversion.
- Removing or changing saved approval delegation.
- A new SMS event.

**Anti-goals — this fails even if it works, when**

- a replacement can approve anything because they were named as replacement;
- the originally signed dates, times or amount disappear from the record or the printed form;
- an edit leaves a balance, a report month or a procurement booking out of step with the request;
- a role without the toggle can edit through the old trip-correction path.

## Constraints

- Migrations are forward-only and must keep the still-running old app working (add first, drop later):
  no RPC the old app calls may change its signature.
- New permissions follow the catalog rule: `private.permission_keys` / `permission_allows` /
  `permission_deps` + `lib/permissions/catalog.ts`, checked with `private.has_perm`; map into
  `private.has_permission` only if the old app needs a legacy key.
- Lock order: `private.approval_lock(company)` before the `'leave:'||employee` lock.
- Security-only staff (FR-76) have no requests; nothing to edit.
- Strings in `fa` and `en`; amounts as days + hours, never decimal days; Blueprint design rules.
- A migration is frozen once applied locally: dry-run on a cloned database first.

## Left to the builder

- Exact column names and the split into migration files (the enum-in-own-file rule applies if a new
  enum value is needed).
- Whether `private.can_correct_trip` is rewritten or replaced by a per-type gate function.
- How the hourly daily limit and overlap checks are shared with `submit_leave_impl` rather than copied.
- Dialog layout details within `docs/DESIGN.md`.
- Tests: SQL tests per type and per conversion (ledger delta, refusals, gate), a catalog unit test,
  unit tests for the print lines, one e2e on a `999…` user.

## Docs to update when built

`REQUIREMENTS.md` (FR-28 amendment, FR-84 gate, new FR-90 / FR-91) · `PERMISSIONS.md` (temporary
authority section, trip corrections gate, new keys) · `DATA_MODEL.md` (`request_corrections`) ·
`CHANGELOG.md` · `TASKS.md` · `AGENT-LOG.md` · CLAUDE.md gotcha if one appears.
