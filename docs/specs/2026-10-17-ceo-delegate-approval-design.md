# Approval delegation, absence replacements and CEO automatic approval

Status: final review complete on 2026-10-17; review corrections and all owner clarification
answers incorporated. Credential/session protection remains explicitly deferred. Application unchanged.
Plan: `docs/plans/2026-10-17-ceo-delegate-approval.md`.
Review: `docs/REVIEW-2026-10-17-approval-delegation.md`.
This revision supersedes the earlier CEO-only setup page and HR-only automatic approval scope.

## 1. Confirmed permission and placement

- Add **Select an approval delegate** under **Approval chain** in the role editor, with exactly
  **Yes / No** options. No read-only option, including no disabled third button.
- A role with Yes allows its holders to appoint a delegate for their own approval duties. An
  admin can create a custom CEO role with this permission and enable it for managers as needed.
- Built-in Manager stays locked. Admin enables selected managers using a supplementary custom
  role with Yes; a role named CEO alone does not confer natural manager/approver authority.
- Put delegate selection/change on `/settings/roles`. Admin can change the CEO's delegate based
  on availability. Permitted users can select their own delegate there without role-editing access.
- Current role creation/edit/deletion is admin-only. This change adds delegation selection, not
  a new right to create roles. Preserve existing role-authoring controls and sensitive-role checks.
- Eligible delegates are active same-company employees who are already managers or approvers.
  Receiving delegated authority does not grant management, employee-editing or role-editing rights.
- A CEO delegate must also already report directly to the designated CEO. Apply this restriction
  to saved and temporary appointments, and validate that the CEO can naturally sign the relevant steps.

## 2. Saved delegate and temporary replacement

- Keep a saved/default delegate per person. Selecting an eligible approval delegate as Replacement
  on a leave request by someone with delegation permission automatically makes that person the
  temporary approval delegate **only during the approved absence**. Afterwards, revert to the
  currently saved default delegate.
- Ordinary employees can still be operational replacements. If the selected replacement is not
  eligible to receive this principal's approval authority, retain the saved eligible delegate or
  show a missing-delegate warning. Work cover alone does not confer signing authority.
- A pending/rejected/cancelled absence does not authorize a temporary delegate. The replacement
  cannot use that prospective appointment to approve the absence that appoints them.
- Selecting **No Replacement** preserves the saved approval delegate; it does not erase that
  appointment. Keep operational `replacement_id` empty and clearly display the retained delegate.
- With no replacement and no saved effective delegate, show a non-blocking warning below the field:
  “You have no approval delegate or replacement. If a request requires your approval while you
  are away, you must respond yourself or select a replacement/delegate now.” Translate to Farsi.
- If an operational replacement is selected but there is no approval delegate, say that the
  replacement covers work only and the requester must respond to approvals or arrange a delegate.
- Show this approval warning for people with approval duties; ordinary employees do not gain
  approval responsibilities merely by submitting leave. If the person lacks delegation permission,
  offer the applicable admin contact path instead of an unusable self-selection link.
- Keep the replacement and saved delegate distinct in storage and wording. No Replacement is
  not an instruction to silently name the saved delegate as operational cover.

## 3. CEO delegate's own requests — updated confirmed rule

- **Amendment 2026-10-19 (owner):** the two-hour window is now an admin-only company setting
  (1–1440 minutes, default 120). Each request snapshots the window at submission; later changes never
  move existing deadlines. "Two hours" below means the configured window.
- The two-hour automatic approval entitlement follows **whoever is currently the CEO's delegate**,
  including an effective temporary delegate. It is no longer limited to the HR head.
- An eligible own request starts its review window at server submission. If the CEO approves
  manually before expiry, record the CEO's actual signature and manual approval.
- Otherwise, after 120 elapsed minutes, automatically approve the pending CEO step under the
  recorded CEO authority and the requester's explicit acceptance of responsibility.
- Rejection or cancellation stops automatic approval. Ordinary managers' delegates receive no
  automatic approval of their own requests from the general delegation permission.
- **Only the designated HR head is exempt from the HR signature.** Mark HR “Not required —
  request submitted by the Head of HR”; never create a fabricated HR approval or copy the CEO
  signature into that box. This identity must be separate from the current CEO delegate.
- A CEO delegate who is not the HR head **still needs normal HR review**. The two-hour action
  completes the CEO step; the overall request remains pending until HR/other required steps finish.
- The automatic CEO action may bypass earlier unfinished steps even when approval order is
  enforced. This exception does not waive HR or other steps, debit leave, activate a pending
  absence, or change the ordinary ordering rules for manual approvals.
- This is the owner's explicit answer to the non-HR-delegate clarification. Do not re-ask it.

## 4. Proposed identity and authority controls

- Admin explicitly designates the CEO and HR-head accounts. A custom role named CEO enables
  capabilities via its permissions, but role names/job titles do not identify these special accounts.
- Saved appointments record the delegator, delegate, actual configuring actor, dates and scope.
  Temporary appointments also reference the approved absence and its time window.
- Admin changes for another person are explicit and audited. A non-admin may configure only
  their own delegate, guarded by the new permission; nobody may nominate themselves.
- For an effective CEO appointment, record the explicit two-hour authority and its attestation.
  Admin configuring on behalf of CEO remains the recorded actor, not an impersonated CEO action.
- Appointments cover the principal's existing leave/errand approval steps; the app does not copy
  all their permissions. Delegates use their own account and signature with on-behalf attribution.
- No onward delegation of borrowed authority. A delegate cannot approve their own request through
  another person's appointment; the special CEO timer is the separate approved exception.
- Removing a principal's permission disables their saved/temporary delegated actions immediately.
  Historical evidence is retained. New permissions default to No unless admin grants them.
- Keep current personnel-edit subset safeguards: granting this permission can require admin to
  edit a person's personnel record when HR lacks equivalent access. Do not weaken these checks
  or grant extra permissions implicitly. Admin appointment management does not bypass principal eligibility.
- Use explicit admin-controlled HR-review step mapping and exact CEO step IDs, not printed role
  labels, to determine exemptions and automatic coverage. Preserve request-specific evidence.

## 5. Proposed UI and request evidence

On `/settings/roles`, admin sees the role list/editor links plus delegation management, including
CEO selection/current delegate. Non-admin permission holders see a My approval delegate panel,
not role-management controls. Keep edit/new role routes admin-only. Show default and temporary
appointments separately, including when the temporary assignment ends and what resumes afterwards.

Proposed picker behavior: saved delegates can be any eligible manager/approver in the company.
CEO candidates are additionally limited to CEO direct reports. Keep ordinary department colleagues
in the Replacement picker, and identify whether the choice also grants temporary approval authority.
For delegation-enabled approvers, additionally permit eligible cross-department approval delegates
with matching server validation. Display work cover and approval delegate separately when different.

Eligible named/custom-role approvers must be able to reach their inbox through Home, Manage and
navigation. Scoped approval-context reads must supply necessary names without exposing full
personnel profiles or granting employee-management permissions.

Suggested submission acknowledgment for the effective CEO delegate:

> I accept responsibility for this request. Under the CEO's explicit authorization recorded in
> the system, the CEO approval step may be completed automatically two hours after submission
> if that step remains pending and the authorization remains valid. Any other required approval
> steps still apply.

Suggested replacement of the CEO signature on an automatic decision:

> Automatically approved under delegated CEO authority.
> The CEO review period elapsed without a CEO decision. [Delegate name], the CEO's appointed delegate,
> accepted responsibility for this request under the CEO's recorded authorization for automatic
> approval of the CEO step on their own requests.
> Submitted: [time]. Automatically approved: [actual time]. Authorization: [reference].

Use “automatically approved”, not “self-approved”, for the timer. Never label a non-HR delegate
as Head of HR. Keep requester and actual HR signatures in their proper boxes. Preserve step IDs,
principal/delegate identities, authority version, consent and timestamps after later role changes.

## 6. Proposed timing and lifecycle rules

- Use 120 elapsed minutes, including non-working hours/holidays. Worker runs every minute; the
  actual processing time can be later than eligibility. Record actual time rather than backdating.
- New eligible submissions enroll atomically with consent and authority version. No retroactive
  enrollment of old pending requests when someone becomes delegate later.
- A temporary replacement becomes effective only while its source absence is approved and the
  absence interval contains current time. Full-day bounds use Asia/Tehran calendar days; hourly
  bounds use the actual time range. For half-days, split the configured `work_start`–`work_end`
  interval at its midpoint: AM is the first half, PM the second, with exclusive end bounds.
  Show the exact hours before submission and snapshot the server-validated interval at submission.
  For example, 07:00–15:00 gives AM 07:00–11:00 and PM 11:00–15:00. Later settings changes must
  not move the recorded interval; if settings change before submission, refresh the preview before
  accepting it. Activation still requires approval. A late approval grants no retrospective authority.
- Effective temporary replacement takes precedence over saved default. Default edits during an
  absence affect the fallback after it ends. Cancellation ends temporary authority immediately.
- Recheck principal permission, actual step authority, active accounts and effective grant before
  every delegated decision or timed approval. Revocation, expiry or replacement stops the former
  delegate's pending auto-approval; do not transfer a timer or silently restart it under a new grant.
- Record uninterrupted authority and permanent timer invalidation, including transitions that occur
  while the worker is down. Returning to the same saved delegate must not revive a stopped timer.
  Distinguish nomination availability from authority validity: a pending own request must not by
  itself invalidate its submitter's appointment. Show when expiry before the deadline needs manual review.
- HR-head exemption is independent of who is CEO delegate. Preserve recorded exemption/decisions
  as history. Changes to company designations must not silently rewrite pending authority snapshots.
- One-hop routing only; prevent self-approval and ambiguous temporary overlaps. If no valid
  delegate can act, principal retains responsibility; warn instead of silently completing the step.
- Preserve normal overlap/cover/ledger checks, paid/unpaid calculation, ordering of other required
  steps and per-diem restrictions. Automatic approval grants no financial self-approval rights.
- Server automation must work with browsers closed, serialize with manual/reject/cancel/revoke,
  and never duplicate decisions or leave consumption. Surface blocked requests and job health.

## 7. Delivery boundary

Final review and proposed fixes are recorded in `docs/REVIEW-2026-10-17-approval-delegation.md`.
All clarification questions from this review are answered. Half-day delegation uses the first or
second half of the configured workday, with hours shown before submission.

The owner explicitly chose to keep credential/session protection outside this release. Remaining
risk: someone retaining another account's credentials or session could configure delegation or sign
using that account's authority. Identity checks, signatures and consent do not eliminate this risk.
Keep it recorded as the deferred FR-55 account-control issue, not fixed or an unresolved scope gate.
Password resets remain admin-only; this decision does not grant any new credential-management rights.

The corrected implementation plan is prepared; this review and these answers do not implement it.
No role, delegate, account, database, server or production setting has been changed.
