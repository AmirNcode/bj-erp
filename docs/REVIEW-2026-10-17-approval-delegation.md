# Approval delegation — final design and implementation-plan review

> **Superseded in part (2026-10-19, owner):** the CEO timer, worker, scheduled job, worker-health card
> and adjustable review window were removed. The CEO delegate's own requests now get the CEO step
> approved at submission. Current behavior: spec amendment in
> `docs/specs/2026-10-17-ceo-delegate-approval-design.md`, `docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`.
> The migrations were squashed into `20261018011333_approval_delegation.sql`.

Date: 2026-10-17. Baseline: `main` at `984b661`, with uncommitted discussion documents.
Scope: source-based review of the proposed design and plan, not implementation or production testing.
Reviewed: `docs/specs/2026-10-17-ceo-delegate-approval-design.md` and
`docs/plans/2026-10-17-ceo-delegate-approval.md`, against current SQL, permissions, request forms,
approval readers, navigation and existing credential-risk notes.

**Result: review complete; corrections incorporated into the plan.** The owner resolved three
business contradictions and answered the final half-day/scope questions. The documented fixes
must be implemented and tested; R9 remains an explicitly deferred security risk. No clarification
questions remain. These are design risks and existing integration gaps; no new delegation
implementation exists to exploit or test.

## Decisions received during review

1. CEO delegates must already report directly to the designated CEO. This restriction also applies
   when the CEO's leave replacement would become a temporary approval delegate.
2. At two hours, automatic approval completes the CEO step even when an earlier required HR step
   is still pending. HR remains required for anyone other than the designated HR head.
3. A manager may choose an ordinary employee as operational Replacement. That choice does not
   grant approval authority; retain the eligible saved delegate or show a missing-delegate warning.
4. Half-day delegation uses the first or second half of the company's configured workday, with
   exact hours shown before submission.
5. Keep credential/session protection deferred and explicitly record the remaining risk. It is
   outside this release, not a new prerequisite for activating delegation.

## R1 — High: a CEO appointment does not itself create a CEO approval step

**Evidence:** `private.is_manager_of` in `supabase/schema.sql:915` requires the actual reporting
relationship and Manager role. A custom role named CEO is not an identity or a natural approval
power. The original plan admitted any existing approver as CEO delegate without ensuring their
own request reached the CEO.

**Failure:** someone reporting to another manager becomes CEO delegate but their request has no
CEO step to time out. Even a direct report may lack such a step if the chain is disabled or the
designated CEO has no applicable natural authority.

**Resolution:** enforce the owner's direct-report restriction on saved and temporary CEO
appointments and recheck it at execution. Validate CEO identity, natural authority and applicable
step configuration before activating the special policy. Capture the exact covered step IDs;
never invent a completed CEO step or fall back to admin override when none exists. Configuration
or reporting-line changes must surface an actionable error and invalidate affected timers.

**Tests:** reject an otherwise eligible non-direct report through UI and direct RPC; custom CEO
label without natural authority; no applicable CEO step; reporting-line change during the timer;
all four request kinds, including chains whose `applies_to` differs.

## R2 — High: ordered approvals contradicted the two-hour rule

**Evidence:** the original plan said both “CEO approval after 120 minutes” and “Honor required
earlier steps when order is enforced.” `work_settings.approval_order_enforced` normally blocks
later steps until earlier ones finish (`docs/DATA_MODEL.md:198`).

**Resolution, confirmed:** only the automatic CEO action receives this ordering exception. Record
the CEO decision at the first successful run after the deadline, even if HR is pending. Keep the
request pending and do not consume leave until all required approvals and final validation finish.
The exemption for the HR head remains separate. Preserve ordinary manual-order rules.

**Tests:** HR-before-CEO and CEO-before-HR; HR later approves or rejects; automatic CEO decision
does not make a pending absence an active temporary delegation; no duplicated ledger consumption.

## R3 — Medium: the proposed picker removed ordinary operational replacements

**Evidence:** the original design restricted delegation-enabled users' Replacement picker to
managers/approvers. Current cover validation is department-scoped (`get_replacement_candidates`,
`private.submit_leave_impl`), and operational replacement is distinct from approval authority.

**Resolution, confirmed:** preserve ordinary department colleagues as operational replacements.
An eligible manager/approver may additionally become a temporary delegate; cross-department
candidates require the delegated-cover eligibility checks. For the CEO, apply the direct-report
restriction too. Otherwise show the selected work cover separately from the retained saved
approval delegate or missing-delegate warning. No Replacement still leaves `replacement_id` null.

**Tests:** ordinary colleague plus saved delegate; ordinary colleague without one; No Replacement
with/without one; eligible cross-department delegate; CEO replacement who is not a CEO direct report;
permission removed before the absence is approved. Never silently grant authority to ordinary cover.

## R4 — High: half-day leave would delegate for the whole day

**Evidence:** the original plan gave all daily requests midnight-to-midnight delegation. The daily
form supports `day_part='am'|'pm'` (`request/LeaveRequestForm.tsx:88`), but those requests have no
stored exact absence times (`docs/DATA_MODEL.md:548`).

**Failure:** a morning-only absence grants a replacement authority throughout the afternoon.

**Resolution, confirmed:** use the first/second half of the configured company workday for AM/PM,
show the concrete hours before submission and snapshot the server-validated Asia/Tehran interval
at submission. For 07:00–15:00, AM is [07:00, 11:00) and PM [11:00, 15:00). Do not infer a whole-day
grant from `unit='day'`. Later work-settings changes must not move an existing grant's boundaries;
a settings change before submission requires a refreshed preview. Keep this separate from existing
conservative leave-overlap calculations and accounting hours_per_day.

**Tests:** before/at/after midpoint; hourly and full-day boundaries; overnight calendar boundary;
settings changed after submission; approval after absence start; no retroactive authority.

## R5 — High: checking only the current grant can revive a stopped timer

**Evidence:** the plan promises that replacement/revocation stops an old timer, but its submission
and execution checks alone do not guarantee uninterrupted authority.

**Failure:** saved delegate A submits, temporary delegate B takes over, then A becomes effective
again before the next successful worker run. The same saved grant ID is present at both observed
ends, so a naive comparison auto-approves A's interrupted request. Permission removal/restoration,
deactivation/reactivation and reporting-line changes create similar cases.

**Resolution:** record durable authority-change history and the effective activation interval,
and make timer invalidation permanent. Prove uninterrupted eligibility between submission and
execution, including time-driven transitions while the worker is offline. No transfer, resurrection
or re-enrollment of an old timer. Sample actual time and re-read state after acquiring locks.

Separate eligibility to nominate operational cover from approval-authority validity. The existing
`replacement_is_away` includes pending requests (`supabase/schema.sql:1207`); reusing it as a live
authority check could make a delegate's own pending request invalidate its timer. Preserve the
intentional rule that being named as cover does not block someone's own leave. The owner must see
when a short remaining appointment means a newly submitted request will need manual review.

**Tests:** A→B→A with worker offline; remove/regrant permission; deactivate/reactivate; revoke and
reappoint same person; future replacement approved during the window; source cancellation; submit
less than two hours before expiry; pending own leave; actual competing SQL sessions.

## R6 — Medium: eligible delegates can be locked out of their inbox

**Evidence:** `lib/nav/tabs.ts:58` and `manage/approvals/page.tsx:108` allow only admin, manager or
HR identities. The design also allows named employee approvers/custom-role holders. Home and
Manage layout have related gates. The queue joins `profiles` to obtain routing/name data
(`lib/actions/leave/approvals.ts:201`); granting request reads alone does not grant those joins.

**Resolution:** use a shared server-derived natural/delegated approval capability for navigation,
layout, page and Home. Every decision RPC must still authorize the exact live request/step. Add a
minimal authorized approval-context projection for queue, progress, print and signature access;
do not grant broad profile, employee-write or balance access just to make the screen work.

**Tests:** employee named approver and delegate with no broad profile-read permission can review
only authorized requests, including necessary names; unrelated personnel data stays unreadable;
expiry removes access; stale UI cannot authorize a decision; mobile and desktop reach the inbox.

## R7 — Medium: the new permission has two existing-role integration traps

**Evidence:** built-in Manager cannot be edited (`app_save_role`, `supabase/schema.sql:3460`),
and permission rows are disallowed on system roles (`role_permissions_guard`, line 1229).
`role_within` explicitly lets some non-admins assign Manager (line 1245). Also, `can_act_on`
compares every catalog permission (line 353), so a target with the new permission can become
uneditable by HR staff who lack it.

**Resolution:** keep the built-in Manager locked. Admin can assign a supplementary custom role
with delegation set to Yes, or use a custom CEO role alongside the necessary existing approval
identity. Do not add the sensitive permission to Manager's default or weaken its assignment rules.
Retain the current subset safeguard: personnel edits on a newly privileged target may require
admin, and the UI/docs should explain that effect. Do not silently exempt the new key or grant HR
delegation merely to restore an editing button. Any later subset exception needs a separate policy
decision. Admin management of a person's appointment does not bypass that principal's required
delegation permission.

**Tests:** system-role save still rejected; admin assigns supplementary role; HR cannot assign it;
multi-role union; HR edit allowed/denied under the existing subset rule; direct self-service save
without permission rejected. Read-only bulk controls must not introduce a third permission value.

## R8 — High: HR exemption needs explicit step meaning, not a display role

**Evidence:** named steps use `role` to select their printed signature box, not to identify their
business purpose (`docs/DATA_MODEL.md:402`). Multiple named steps can carry the same role.
The plan says to skip only actual HR review but does not define how that step is identified.

**Failure:** skipping every `role='hr'` step waives an unrelated named person's approval; skipping
only unnamed HR steps leaves the HR head's own request stuck if the real HR review is named.

**Resolution:** add explicit, admin-controlled HR-review step mapping/semantics and validate its
references. Snapshot the exact exempt steps per new request. Map CEO coverage with exact step IDs
and natural principal authority too. Editing/replacing/deleting a mapped step must not silently
expand the exemption, transfer automatic authority or rewrite existing evidence. Surface affected
pending requests for explicit reconciliation; preserve already-recorded decisions.

**Tests:** role-based HR review; named HR review; unrelated named step displayed as HR; direct and
department manager steps together; multiple CEO-authorized steps; active-step changes; historical
print remains stable. Default no automatic waiver where the classification is ambiguous.

## R9 — High, pre-existing: creator-known credentials undermine signer identity

**Evidence:** `app_create_employee` passes the creator's chosen `p_password` to account creation
(`supabase/schema.sql:2783`, especially 2853). The existing FR-55 follow-up in `docs/TASKS.md`
records that first-login password change is only enforced by layout and resets do not end sessions.
This is an existing, previously deferred risk, not a newly reproduced delegation exploit.

**Failure:** a staff member who retains another person's credentials/session could sign using
that person's delegated authority. A different user ID, a drawn signature or an “I accept” checkbox
does not establish that the intended account holder was the actor.

**Owner disposition, 2026-10-17:** keep this protection deferred and explicitly record the remaining
risk. It is outside the delegation release and is not an activation prerequisite. The gap remains
open; signatures, consent and account-ID checks do not prove exclusive control of the account.
Preserve admin-only password resets and all planned delegation authorization controls.

**Future remediation, outside this release:** cover principals and delegates through trusted
credential handover, existing-session invalidation and rejection of stale sensitive access. Confirm
the mechanism against the installed auth runtime. A forced-password-change flag or reset alone is
insufficient. Do not reopen broad password-reset delegation as part of this feature.

**Future tests, not this release's acceptance gate:** creator's old password, refresh session and
still-unexpired access token cannot configure delegation or decide requests after secure handover;
new trusted login succeeds; direct RPCs enforce the gate; account reactivation/reset cannot revive
authority without checks. No claim that these protections currently exist or these tests pass.

## Existing safeguards retained and verification boundary

The plan already correctly separates automatic evidence from actual CEO signatures, preserves
the independent HR-head exemption, forbids borrowed self-approval/onward delegation, keeps grants
company-scoped, and protects ledger finalization with shared locking and idempotency. Retain these.
The rejection path reads status before its lock but also checks the conditional update row count
and raises on an already-decided request; this review does not claim that it currently commits a
second decision. Re-read all relevant state under lock in the shared decision work as planned.

Before shipping, prove the in-scope fixes (R1–R8) with isolated SQL concurrency tests, permission/RLS regression
tests, all four request forms, real worker execution with browsers closed, and Farsi/English
print/UI checks. Validate deployed cron/runtime versions and recovery separately. No tests or
database/server operations were run in this review; no code, migration, commit, push or deployment.
