# Design Spec — Separate Daily Dates and Requester Digital Signatures

- **Date:** 2026-08-05
- **Status:** Approved from client feedback and user clarification
- **Module:** HR → Time-Off
- **Builds on:** `2026-07-29-hourly-accrual-replacement-design.md` and
  `2026-07-30-work-errand-and-login-codes-design.md`

This is a frozen point-in-time record. Living schema and permission details belong in
`docs/DATA_MODEL.md` and `docs/PERMISSIONS.md`.

## 1. Confirmed scope

1. Daily leave replaces its one range-mode calendar field with two controlled calendar fields:
   **Start date** and **End date**.
2. Hourly leave and hourly work errands remain single-date flows. Their database invariants and
   business rules do not change.
3. Every new daily leave, hourly leave, and errand submission requires a freshly drawn requester
   signature and a checked authorization statement.
4. The signature is permanent evidence on the request. It is visible to the requester and to
   existing authorized base-row readers: the direct manager, security, and admin. It remains hidden
   from teammates through the reason-less `team_leave_calendar` view.

## 2. Daily date interaction

- Both fields use the saved Persian/Gregorian calendar preference and the current UI language.
- Missing or unknown calendar preferences continue to default to Persian/Jalali.
- End date cannot precede start date. The end picker receives the chosen start as `minDate`; if a
  changed start would invalidate the end, the end is cleared.
- The form still converts both displayed dates to Gregorian ISO at the UI boundary. Working-day,
  replacement-availability, half-day, overlap, and balance rules continue to consume the same
  `start_date` / `end_date` values as before.

## 3. Signature capture and consent

- A shared canvas uses Pointer Events, so the same control accepts a mouse/stylus on desktop and a
  finger on touch devices. It has a visible Clear action and redraws correctly at device pixel ratio.
- The client exports a white-background PNG data URL only after a completed stroke. Empty taps do not
  satisfy the signature requirement.
- The authorization checkbox is unchecked for every new request and is required independently of the
  signature. Copy is localized in English and Farsi.
- The server action and SQL writer both validate the PNG shape/size and authorization flag. Client
  validation exists for usability, not trust.

## 4. Persistence and immutability

`leave_requests` gains:

```text
signature_data       text nullable
signature_consent_at timestamptz nullable
```

- Existing historical rows keep both fields NULL.
- New writer functions require a `data:image/png;base64,...` value and explicit authorization. The
  database sets `signature_consent_at = now()`; no client-supplied timestamp is trusted.
- A CHECK requires the two columns to be both NULL or both present and constrains the PNG data length.
- Request rows have no direct client write path. Existing decision/cancellation functions never touch
  the signature columns, so the signed evidence remains attached after approval, rejection, or
  cancellation.
- Storage stays in Postgres rather than Supabase Storage because the self-hosted production bundle does
  not run the Storage service. The bounded PNG avoids adding deployment infrastructure for small,
  private request evidence.

## 5. Read path and privacy

- Request lists and approval queues carry only the consent timestamp, not the image payload.
- A shared viewer fetches one signature on demand through a server action. The existing
  `leave_requests_select` RLS policy is the authorization boundary.
- Calendar pages fetch only the IDs/timestamps of signatures the current manager/security/admin can
  read. The PNG is fetched only if the viewer opens it. The team calendar view itself remains an
  explicit, signature-free column list.

## 6. Non-goals

- This adds only the requester's signature. It does not implement the deferred four-step paper-form
  approval/signature workflow, replacement consent, security sign-off, or HR sign-off.
- It is evidence of the submitter's authorization inside this application, not a qualified
  cryptographic signature or external legal identity-verification service.

## 7. Acceptance checks

- Daily leave shows two calendar inputs in both languages and both calendar modes; hourly and errand
  continue to show one date.
- A request cannot be submitted without both ink and checked authorization, including direct RPC calls.
- Mouse and touch/pointer strokes create a PNG; Clear removes it.
- Successful submission records a database timestamp and resets the signature and checkbox.
- Requester, direct manager, security, and admin can open the stored signature where request details are
  available; teammates cannot fetch it.
- Unit/static/build gates pass, and the authenticated daily/hourly/errand browser flows are updated.
