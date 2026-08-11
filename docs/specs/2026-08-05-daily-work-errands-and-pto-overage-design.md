# Daily work errands and paid-leave overage

**Date:** 2026-08-05
**Status:** Accepted from client feedback
**Module:** HR → Time-Off

## Scope

1. Requests gains a fourth form, **Daily Work Errands**, alongside Daily Leave, Hourly Leave, and
   the renamed **Hourly Work Errand** tab.
2. Daily work errands use separate Persian-calendar Start date and End date fields, a required
   errand location, an optional description, and the same requester signature and authorization
   evidence as every other request.
3. Paid leave previews show the amount being requested and the projected balance after the request.
   If the request is larger than the available paid balance, the preview identifies the excess as
   unpaid time instead of blocking submission.
4. One workday remains the company `hours_per_day` setting, whose default and current expected value
   is 8 hours (480 minutes). All examples and acceptance tests use 480 minutes per day.

## Daily work errand behavior

- A daily errand is stored on `leave_requests` with `kind = 'errand'` and `unit = 'day'`. The
  existing hourly errand remains `kind = 'errand'` and `unit = 'hour'`; no new request-kind enum is
  needed.
- Daily errands have no leave type, replacement, or balance effect. They use the existing errand
  tracking-number sequence and direct-manager/admin signed approval flow.
- The date range is inclusive. Because an errand is company work, weekends and holidays are allowed,
  matching the existing hourly-errand rule. Each calendar day contributes one configured workday to
  `requested_minutes` so the request has a useful duration without consuming leave.
- Daily errands conflict with any overlapping daily or hourly leave/errand. The existing unit-aware
  overlap rule already treats any `unit = 'day'` request as occupying the whole intersecting date.
- Location and description retain the existing errand privacy contract: requester, direct manager,
  security, and admin can read them; teammates can only see that the person is away on an errand.

## Paid and unpaid split

`leave_requests` gains `unpaid_minutes int not null default 0`, constrained between zero and
`requested_minutes`.

- On submission, the database records the best current estimate:
  `unpaid_minutes = max(requested_minutes - max(current_balance, 0), 0)` for balance-affecting paid
  leave. A directly selected unpaid leave type records the entire request as unpaid.
- Submission no longer fails merely because the request exceeds the current paid balance.
- Approval re-evaluates the split while holding the existing per-employee advisory lock. This is the
  authoritative value because accruals or earlier approvals can change the balance while a request is
  pending.
- Paid consumption is `min(requested_minutes, max(current_balance, 0))`. Only that amount is debited
  from the selected leave ledger, so a paid balance never becomes negative. The remainder is saved in
  `unpaid_minutes` on the same request.
- Cancelling an approved future request restores only the paid portion
  (`requested_minutes - unpaid_minutes`). Historical requests default to zero unpaid minutes and
  therefore preserve their existing full-reversal behavior.

## Preview copy

For a balance-affecting paid type, daily and hourly forms render:

1. **Requesting:** requested duration.
2. **Remaining Balance:** `max(balance - requested, 0)`.
3. **Unpaid Time Off:** `max(requested - balance, 0)`, shown only when greater than zero.

At 8 hours per day, a 4-day request is 1,920 minutes. A balance of 3 days 4 hours is 1,680 minutes,
so the preview and approved request produce 0 paid minutes remaining and 240 minutes (4 hours) unpaid.

## Security and compatibility

- All new/changed public RPCs remain `SECURITY DEFINER`, use `search_path = ''`, self-check the
  authenticated caller through the existing private writer, and are executable only by
  `authenticated`.
- Existing RLS policies and the explicit-column teammate calendar view remain unchanged. The new
  numeric split does not expose the private location, description, or signatures.
- Existing rows are backfilled by the column default only; no historical request or ledger row is
  rewritten.

## Acceptance criteria

- Requests shows four localized tabs, with separate Daily Work Errands and Hourly Work Errand tabs.
- A signed daily errand can be submitted for a Persian-calendar date range, approved with a manager
  signature, displayed, and cancelled under the existing errand rules without changing leave balances.
- Daily and hourly paid leave previews subtract the live request from the balance using 480 minutes per
  day in the default configuration and clearly show any unpaid excess.
- Over-balance submission and signed approval succeed; the paid ledger reaches zero, never negative,
  and the request records the remainder as unpaid.
- Cancelling that approved request restores only the paid portion.
