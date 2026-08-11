# Approval signatures and Persian-only calendar

**Date:** 2026-08-05
**Status:** Accepted from client feedback

## Scope

Two changes ship together:

1. A pending request can be approved only after the authorized approver draws a fresh signature and
   explicitly authorizes its use as a digital signature. Rejecting a request does not ask for or save
   a signature.
2. Persian (Jalali) becomes the only display and picker calendar throughout the app. Interface
   language remains independently selectable between Farsi and English.

## Approval signature behavior

- The direct manager remains the normal approver; the existing admin override remains available.
  Whichever authorized person approves must sign. There is no unsigned admin bypass.
- The approval dialog starts with an empty canvas and unchecked authorization box every time it is
  opened. A prior request signature or approval signature is never reused.
- The canvas supports mouse, stylus, and touch by reusing the request-signature component.
- A missing/invalid signature or unchecked authorization prevents approval in both the UI and the
  database RPC.
- Rejection keeps its current optional reason and requires no signature.
- The approval status transition, approver identity, approval signature, consent timestamp, ledger
  debit, and audit record are one database transaction.
- Existing approved requests remain valid without an approver signature. New approvals must use the
  new signed RPC because the old one-argument RPC is removed.
- The raw PNG remains private on `leave_requests`; existing base-row RLS controls who may fetch it.
  List/calendar reads carry only consent metadata, and an authorized viewer fetches the image only
  after clicking View.
- The requester can view the approver's signature on an approved request. Authorized manager,
  security, and admin calendar viewers can also inspect it on approved rows.

## Persian-only calendar behavior

- Stored PostgreSQL dates remain Gregorian `date` values. Conversion to Jalali still happens only at
  the UI boundary.
- Every date picker uses the Persian calendar. Farsi uses Persian digits/locale and English uses the
  English Persian-calendar locale.
- Every displayed business date uses the Persian calendar, including approval cards, request history,
  Home, team time off, calendar views, holidays, hire dates, and signature consent timestamps.
- The profile page no longer contains a calendar selector. It retains only the language preference.
- Existing `profiles.calendar_pref` values are normalized to `jalali` and constrained to `jalali` for
  backward compatibility with the installed schema and employee RPC signatures. Application code no
  longer reads or writes this value.

## Security and compatibility

- `approve_leave_request` remains `SECURITY DEFINER`, retains the direct-manager/admin authorization
  check, uses an empty `search_path`, and is executable only by `authenticated`.
- The obsolete unsigned function overload is dropped so PostgREST cannot resolve an unsigned approval.
- Signature bytes are never written to `audit_log`; the audit record carries only that signed consent
  was recorded.
- PostgREST is notified to reload its schema cache after the RPC signature change.

## Acceptance criteria

- Approve dialogs on both the approval queue and calendar contain a blank signature canvas and consent
  checkbox.
- Approve cannot succeed without both; reject still succeeds without either.
- A signed approval stores the approver, consent timestamp, and valid PNG atomically.
- The approval queue never prints raw Gregorian ISO dates.
- No calendar preference control or Gregorian calendar branch remains in the rendered application.
- English UI continues to work while displaying Jalali dates with English digits.
