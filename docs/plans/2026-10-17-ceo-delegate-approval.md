# Approval delegation and CEO automatic approval — revised implementation plan

Status (2026-10-19, second continuation): implementation and local validation complete on
`codex/approval-delegation`, **uncommitted, undeployed**. All policy decisions settled; credential/session
protection deferred (retained risk R9). Both migrations applied only to the isolated synthetic stack and
frozen; worker inactive. SQL 761, unit 895, lint, typecheck, Webpack build, deploy tests, 21 real lock
scenarios (12 + 3 + 6), two actual cron runs, and the full rendered browser checklist passed (four forms,
stale preview, exact-step decisions, early manual CEO, mobile RTL, EN/FA print). The Farsi redirect loop
was a local `--hostname 127.0.0.1` artifact, not an app bug (`docs/MEMORY.md`). Remaining work is only
the separately authorized release gates in the 2026-10-19 handoff. Baseline: `main` at `984b661`.
Policy: `docs/specs/2026-10-17-ceo-delegate-approval-design.md`.
Review: `docs/REVIEW-2026-10-17-approval-delegation.md`.
This replaces the former CEO-only design, separate Manage page and identity-only appointment right.

## 1. Agreed behavior

| Situation | Result |
| --- | --- |
| Role editor, Approval chain | Select an approval delegate: exactly Yes / No |
| Admin on `/settings/roles` | Edit roles and set/change CEO or other users' delegates |
| Non-admin with delegation permission | Select own delegate on the same page; no role-editing rights |
| Delegate candidates | Active same-company managers or existing approvers |
| CEO delegate candidates | Additionally must already report directly to the designated CEO |
| Principal with permission selects an eligible approver as Replacement | Temporary delegate during approved absence only |
| Principal selects ordinary employee as Replacement | Work cover only; saved approval delegate remains, or warning appears |
| Temporary period ends | Resume currently saved default delegate |
| No Replacement with saved delegate | Retain saved approval delegate; operational replacement stays empty |
| Neither replacement nor delegate | Non-blocking warning below Replacement for people with approval duties |
| Current CEO delegate submits own request | CEO manual review, then automatic CEO-step approval after 120 minutes |
| CEO signs before deadline | Actual CEO signature, manual decision; timer cannot overwrite it |
| Requester is designated HR head | HR step not required, independent of current CEO delegation |
| CEO delegate is someone else | Normal HR review still required; CEO-step completion alone is not full approval |
| HR precedes CEO and remains pending at two hours | Automatic CEO step completes; HR remains required and request stays pending |
| Rejected/cancelled request | No automatic approval |

The general permission does not grant self-approval, role authoring, a CEO identity or financial
approval. The two-hour rule is specific to effective appointments from the designated CEO.
All review clarification questions are answered. Preserve those decisions, including the explicitly
deferred credential/session work; do not reintroduce it as a prerequisite for this release.

## 2. Source findings and affected boundaries

- `/settings/roles/page.tsx` currently calls `requireAdminPage`; split page content/access so a
  delegation-only user sees the personal panel. Keep new/edit-role routes and role mutation RPCs
  admin-only. `SettingsTabs`, sidebar/mobile navigation and landing routes must admit this purpose.
- `PermissionSection` uses `TriStateToggle`; an E-shaped permission still shows a disabled third
  segment. Add an explicit binary presentation for the new item; do not just disable Read.
- Catalog is mirrored in SQL and `lib/permissions/catalog.ts`. Section bulk operations, permission
  union, JWT parsing, sensitive-role confirmation and role-assignment subset checks all use it.
- `ReplacementPicker` is shared by daily/hourly leave. No Replacement clears `replacement_id`.
  Saved approval delegation must remain separate from that field. Errand forms currently have no
  replacement; preserve that boundary, while saved delegation applies to errand approval duties.
- Replacement SQL is department-scoped and checks availability at submit/approve. Preserve ordinary
  department colleagues; add eligible cross-department approval delegates with matching server
  validation. A non-eligible operational replacement does not replace the saved approval delegate.
- `private.is_manager_of` grants employee-write powers as well as approvals. Never broaden it to
  represent delegation; add approval-specific authorization and request visibility.
- `private.step_applies` only knows manager scope/employee. Introduce request-aware applicability
  for the independently designated HR-head exemption, reused by ordering, progress and completion.
- Current manual approval requires a signer and PNG; add separate automatic evidence/internal
  entrypoint. Never fabricate a CEO JWT, signer or signature image.
- Print currently maps multiple steps by role/current configuration. Preserve step IDs and
  evidence snapshots so delegated/automatic/named/department decisions remain correctly attributed.
- Existing approval/cancellation use employee advisory locks. Reuse their lock family. In the
  touched rejection path, re-read status after acquiring the lock (current read occurs before it).
- Approval page, Manage layout, navigation and Home currently gate by admin/manager/HR roles.
  Include named/custom-role approvers and effective delegates through shared server-derived
  capability. Request RLS alone does not make profile joins readable; add a minimal authorized
  approval-context projection instead of broad profile permissions.

## 3. Permission and role UI unit

Proposed catalog key: `approval_delegate`, action-only (`edit` = Yes; absent = No), under
`approvalChain` alongside `approval_steps`. Reject `read` as an invalid value at database and UI.

- Update SQL `permission_keys`, `permission_allows`, `permission_deps` where needed, role catalog
  constraints, TS catalog and catalog parity tests. No dependency on broad people/HR/settings edit.
- Use a minimal guarded candidate-search RPC rather than requiring company-wide profile access.
- Default existing non-admin roles to No; admin retains its implicit capabilities. A custom CEO
  role receives Yes only when configured. Use existing highest-permission union across held roles.
- Built-in Manager remains fixed. Admin enables selected managers with a supplementary custom
  role; do not unlock system-role editing or add delegation to the HR-assignable Manager default.
- Bulk Allowed maps the new row to Yes; Read-only/Not allowed map it to No. Render row labels
  explicitly as Yes/No in both locales with two accessible keyboard-operable choices.
- Include the permission in existing sensitive-change warnings/confirmation and test assignability.
  Do not weaken FR-55 restrictions on assigning write-capable custom roles or existing Manager
  assignment exceptions. Retain D4 subset behavior: a target with this permission may need admin
  personnel editing when HR lacks equivalent access. Explain/test that consequence; no silent
  exemption or automatic extra grant. Credential/session protection remains explicitly deferred.
- Selecting one's own delegate is an explicit self-service exception for this new capability,
  not permission to edit one's entire profile. Admin changes for another principal are separate.
- Use live DB permission checks on save/decision/worker, not only cached JWT/UI claims. Loss of
  permission invalidates active outgoing delegation; preserve history rather than deleting grants.
- Receiving an appointment does not require permission to appoint another delegate and cannot
  transfer the principal's role permissions. Delegates may not re-delegate borrowed authority.

## 4. Proposed data and RPC contracts

Names are proposed interfaces, not existing objects.

1. `company_executive_settings`: explicit CEO and HR-head profile IDs, configured by admin,
   changed-by/time, and explicit HR-review step mapping/semantics. Distinct designations; role
   names, job titles and printed signature-box roles are not identity or exemption checks.
2. `approval_delegations`: principal, delegate, company, source (saved/absence), source request,
   effective window, actual configuring actor, version, scope and revocation. One current saved
   default per principal. Retain authority-change history and effective activation intervals so
   interruption invalidation does not depend on the worker observing each transition. Temporary
   periods derive from approved absence data, including half-day boundaries.
3. `ceo_auto_approval_authority`: versioned explicit CEO authorization associated with a CEO
   appointment, including the fixed two-hour policy and actual creator/admin attestation. Record
   this for saved and temporary CEO delegates; selecting generic delegation must not grant it.
4. Request approval context: submission time, designated CEO/HR-head snapshots, effective grant,
   optional two-hour eligibility/deadline and responsibility consent, covered CEO steps, exempt
   HR steps. Capture HR-head exemption independently even when another person is CEO delegate.
5. Step decisions: checked `decision_source` (legacy/manual/delegated/automatic), actual signer,
   principal, grant/context reference, step label/identity snapshot and actual execution time.
   Automatic rows have no human signature. HR exemption is separate evidence, not a decision row.
6. Worker processing metadata: due time, attempt time, state/reason and successful execution time.
   Separate request pending status from a completed CEO step awaiting HR or another approver.

Proposed public RPCs: get own/admin delegation configuration, set default delegate, revoke grant,
search eligible delegates, get effective delegate/absence preview and set CEO/HR-head designation.
Use separate admin identity configuration and self-service appointment checks. Public mutations
verify active caller, company, permission, target eligibility and ownership; no direct table writes.

General selection eligibility: active same-company Manager, a person entitled to an existing active
leave/errand approval step, or admin. Re-evaluate before acting. Do not treat approval-step editing
permission, arbitrary role names, or receiving a borrowed appointment alone as natural eligibility.
The principal delegates only steps they themselves are presently authorized to sign. Include direct,
department and named steps where applicable; the actual principal/step identity must be explicit.
For CEO appointments, require the delegate's actual direct manager to be the designated CEO.
Recheck that relationship live. Before activating the special policy, validate the CEO's natural
authority and applicable CEO steps for each covered request kind. A custom role name is insufficient.
No-step/ambiguous configuration must produce an actionable configuration error, not an invented
automatic approval or an admin-override fallback. Admin cannot activate a grant for an ineligible principal.

RLS: all exposed tables protected; grants readable only by principal/delegate/admin and necessary
CEO configuration actors. Request readers see only relevant evidence. Add narrowly scoped
request reads for delegated signers and candidate names; never broaden `is_manager_of`, people
editing, balances or unrelated request access. Private workers/internal helpers revoke EXECUTE
from PUBLIC/anon/authenticated, qualify names and fix search_path. Preserve unsigned legacy rows.

## 5. Effective delegate and replacement lifecycle

- Resolver precedence: an eligible temporary appointment whose approved source absence contains
  now, otherwise eligible saved default, otherwise no delegate. Original approver remains able to
  act. No multi-hop traversal; the delegate cannot exercise this authority on their own request.
- Selecting a replacement while submitting leave records a prospective temporary appointment
  only when requester has delegation permission and the replacement is an eligible approver.
  Capture consent/preview in the form. Activation requires approval and actual absence start.
- Ordinary operational replacement remains allowed. If not eligible for this principal's authority
  (including the CEO direct-report rule), keep the saved approval delegate or show the warning.
- A prospective temporary delegate cannot use that appointment to approve its own source absence.
  A replacement who was already independently authorized retains only that independent authority.
- Full-day windows use Asia/Tehran local start-of-day through the day after the last date (exclusive);
  hourly windows use actual stored start/end. AM/PM must use half-day windows, not whole-day bounds.
  Owner-confirmed: split configured work_start/work_end at the midpoint. AM is [start, midpoint),
  PM is [midpoint, end). Show exact hours before submission and snapshot the server-validated bounds
  atomically at submission; use the configured clock range, not accounting hours_per_day. Reject a
  stale settings preview with a refresh-required response rather than silently accepting other hours.
  Later settings edits cannot move saved bounds. For 07:00–15:00, use 07:00–11:00 and 11:00–15:00.
  Compute effectiveness at read/action time so expiry needs no browser or cron job. Approval after
  start activates from then, with no retrospective authority.
- Cancellation/rejection or inactive source ends temporary authority. Default edits during absence
  affect the fallback afterward. Reject ambiguous overlapping temporary appointments; test legacy
  pending overlaps without silently choosing one. Do not auto-assign someone unavailable in the window.
- Separate cover nomination checks from authority validity. `replacement_is_away` includes pending
  leave and must not be reused as a live check that invalidates a delegate merely for submitting
  their own request. Preserve the existing rule that being cover does not veto one's own leave.
- No Replacement leaves operational cover null. Display “Your saved approval delegate, [name],
  will continue to handle approvals.” With no valid delegate, show the warning from the spec.
  Permissionless approvers still receive a non-blocking warning but cannot self-appoint through UI/API.
- When ordinary work cover is selected, use different wording: cover is assigned but cannot sign
  approvals; identify the saved delegate or warn that the principal remains responsible.
- No new replacement field on errands in this scope. Four request kinds still participate in
  CEO-delegate own-request auto-approval and use saved/active delegation for incoming approvals.

## 6. Submission, decisions and timed worker

- Atomic submission records requester PNG/consent, responsibility acknowledgment if currently
  CEO delegate, immutable authority version, deadline and HR exemption when requester is HR head.
  Use versioned wrappers for all four submission RPCs to avoid overload ambiguity. Old clients
  cannot silently enroll without consent; give eligible users a refresh/consent-required error.
- Only a person who is effective CEO delegate at submission may enroll. Recheck same effective
  authority at execution. Becoming delegate later does not enroll old requests. Revocation,
  expiry, default/temporary precedence change or replacement invalidates the former timer.
- Enforce continuous eligibility, not just equal grant IDs at the two endpoints. Persist authority
  interruption/invalidation and evaluate effective intervals even across worker downtime. A saved
  delegate returning after a temporary replacement, permission restoration or reactivation does
  not revive an old timer. Include reporting-line and relevant chain/identity configuration changes.
  Warn when appointment expiry is earlier than the two-hour deadline; manual review will be needed.
- When CEO temporarily appoints someone else, saved HR-head delegate is no longer effective for
  automatic approval during that interval. New delegate's own request still needs normal HR review
  unless they separately hold the HR-head designation. Labels must not say Head of HR for others.
- Manual/delegated actions select exact step IDs and use actual actor signature with on-behalf
  attribution. HR head signing both an HR step and another principal's step remains two distinct
  decisions unless explicitly supported by a clearly presented combined action; use separate actions
  initially. Do not repurpose admin override.
- Extract shared finalization/accounting from current approval function; preserve overlap,
  cover availability, paid/unpaid split, ledger consumption/reversal and audit behavior.
- Apply HR-head exemption consistently in natural/override paths, step order, remaining totals,
  queues and progress. Skip the actual HR-department review step; do not waive unrelated named
  individuals merely because their display role is HR. Use explicit admin-controlled HR-review step
  mapping, validate references, and snapshot exact exempt IDs. Changes to mapped steps/configuration
  cannot silently transfer authority or exemptions; flag affected pending requests for reconciliation
  and preserve recorded evidence. Ambiguous step classification grants no automatic waiver.
- Worker every minute selects bounded due candidates, locks, rechecks state/authority and records
  automatic CEO evidence. Eligible at 120 minutes, executed on next successful run. Current time
  is server-controlled; no browser/session identity, backdated execution or synthetic signature.
- Document and test one lock order across appointment changes, source absence lifecycle and
  manual/reject/cancel/automatic decisions. Re-read status/authority under lock. Idempotence and
  unique request/step constraints prevent double decisions/ledger consumption under concurrency.
- Owner-confirmed exception: the automatic CEO action bypasses unfinished earlier steps even when
  order is enforced. Other steps and ordinary manual-order rules remain. Complete CEO step without
  finalizing if HR/other steps remain; the absence is not yet approved and grants no temporary
  authority. Blocked final validation is surfaced with a reason; no balance debit until full approval.
  A per-request exception cannot stop other due requests. Bounded retries/error logs.
- Automatic finalization leaves human decider/approver PNG null and records system origin. CEO
  manual approval is never overwritten. Cancellation after approval uses existing reversal rules.
- No automatic per-diem grant/increase, financial self-approval or copied grantor permissions.
- Add indexed due lookup, job health/overdue counts for admin and affected principal, and request
  status for delegate. Preserve existing polling/refresh behavior; no SMS/email feature expansion.

## 7. File map and product UI

| Unit | Existing/new files |
| --- | --- |
| Permissions | `lib/permissions/catalog.ts`, new SQL migrations, `PermissionSection.tsx` under role components, locale messages |
| Roles/delegate panel | `/settings/roles/page.tsx`, new delegate panel and `lib/actions/approval-delegation.ts` |
| Access/navigation | Role page guard split, `SettingsTabs`, `lib/nav/tabs.ts`, Manage layout, approvals page, Home page/board and consumers; leave role edit/new guards intact |
| Replacement integration | `ReplacementPicker.tsx`, `FormParts.tsx`, `useRequestForm.ts`, daily/hourly leave forms, `lib/leave/replacement.ts` |
| Submission | `lib/actions/leave/requests.ts`, all four request forms and SQL wrappers |
| Decisions | `lib/leave/approvals.ts`, `lib/actions/leave/approvals.ts`, shared approval capability/context reads, decision dialogs and queue |
| Progress/signatures | `lib/actions/leave/progress.ts`, `components/RequestProgress.tsx`, signature actions/viewer |
| Print | `lib/actions/leave/review.ts`, print request page, `lib/leave/paperForm.ts` |
| Contracts/errors | `lib/supabase/types.ts`, regenerated schema, `lib/errors/db-error.ts`, both locales |

Admin's Roles page shows existing role management plus delegate management, with explicit principal
selection and a CEO section. Non-admin permission holders get only their own delegate panel on that
route. Changing a person's delegate does not change every holder of their role. No separate Manage
CEO-delegate page. Expose active temporary delegate and default separately, including fallback date.

Evidence UI must distinguish pending, signed, automatic, rejected, HR-not-required and legacy missing
evidence. Non-HR CEO delegate sees “CEO step automatically approved; awaiting HR” where applicable.
Print manual CEO PNG or automatic statement in CEO box, real HR signature or exemption in HR box,
and requester signature separately. Preserve evidence after later changes to names, roles or grants.
Do not send signature images in queue/calendar lists. Farsi-first RTL and English, keyboard/mobile.
Read installed Next.js documentation and applicable component skills before application edits.

## 8. Validation matrix

- Catalog SQL/TS parity; exactly two Yes/No controls; section bulk behavior and multi-role union;
  sensitive-role assignment restrictions; No cannot be bypassed by direct API or stale JWT.
- Custom CEO role with Yes can choose own delegate but cannot edit roles or others' delegates.
  Admin can change CEO/default delegates. Self-nomination, inactive/cross-company/non-approver denied.
- CEO delegate must be a direct report, including temporary selection. Actual CEO authority and
  matching step must exist for each request kind. Reporting-line change invalidates timer.
- Manager remains locked; supplementary role grant/assignment obeys admin-only restrictions.
  Test D4's impact on HR personnel editing instead of silently weakening it.
- Delegate gets scoped approval access with no new employee-write or broad data access.
- Named employee approver/custom-role delegate can reach inbox, Home and Manage without broad
  profile access; authorized context contains necessary names but unrelated data remains denied.
- Replacement temp inactive before approval/start; active during full-day/half-day/hourly window; original
  saved default resumes afterward; edited default used on return; cancellation revokes promptly.
- No Replacement retains saved delegate without filling operational replacement. No delegate shows
  warning without blocking. Ordinary operational replacement unchanged. Invalid candidates denied server-side.
- Ordinary employee replacement and No Replacement each retain saved approval delegate or show
  the appropriate warning. A pending own request alone does not invalidate delegate authority.
- Temporary/saved precedence, incoming pending requests, principal authority loss, permission removal,
  role removal, inactive delegate, self-request conflicts, reciprocal appointments and no onward chains.
- Worker offline across A→B→A, permission removal/restoration or deactivation/reactivation: old
  timer never resumes. Expiry before deadline shows need for manual review. Snapshot half-day hours
  stay fixed after work-settings change; midpoint/end boundaries have no excess authority.
- Half-day preview matches the server interval; settings change between preview and submit requires
  refreshed hours. Test 07:00–15:00 => AM 07:00–11:00 / PM 11:00–15:00, with exact exclusive ends.
- HR head independent of CEO appointment: HR exemption persists; only currently effective CEO
  delegate receives eligible timer. Non-HR delegate still needs real HR review.
- All four forms: signature + consent + due time; 119:59 not due, 120:00 eligible; no retroactive enrollment.
- Early CEO manual evidence preserved; rejection/cancellation before timer; actual concurrent worker,
  manual, revoke, source-absence cancellation and permission-change sessions; no duplicated ledger.
- Ordered HR-before-CEO and CEO-before-HR workflows; named/department step identities; no-chain or
  changed configuration handled explicitly without silent automatic completion of unrelated steps.
- HR-before-CEO remains pending for HR after timed CEO decision, with no temporary appointment
  activation or ledger debit. Explicit HR-review mapping exempts genuine named/role-based HR only.
- Cover/overlap block, paid/unpaid split, cancellation reversal, no automatic per diem.
- Closed browser, worker retry/restart/downtime, and actual execution timestamp. Per-item failure
  does not block the batch. Role/grant changes preserve historical print evidence.

Add SQL scenarios `tests/sql/approval-delegation.sql`; extend permission/approval/replacement/progress
unit tests. Focused E2E: admin role edit/delegate changes; custom CEO self-service; manager temporary
replacement; both default/warning cases; manual/automatic outcomes and printed Farsi/English output.
Use isolated fixtures; run concurrent SQL sessions for races rather than only sequential simulations.

Run typecheck, lint, unit suite, build, relevant deployment tests, existing approval/signature and
FR-55 SQL regressions, focused browser tests. No tests against real-roster shared DB; no broad cleanup
or accrual. Test new evidence FKs/fixture cleanup. No application tests were run during planning.

## 9. Implementation and release sequence

1. Use the corrected review findings as implementation acceptance criteria; all clarification
   questions are settled. Credential/session hardening remains a separate deferred follow-up,
   not an activation prerequisite. Retain its unresolved security risk in release documentation.
2. Isolated checkout/database setup preserving current docs. Verify current runtime, migration
   ledger and pg_cron version/permissions. Use disposable test cluster for real scheduler test;
   pg_cron metadata belongs to one database, so avoid touching shared postgres jobs.
3. New forward migrations for catalog/identities/appointments, context/evidence and shared approval
   logic, then inactive worker registration. Use installed CLI migration creation command. Dry-run
   migration + SQL scenarios before application; never edit an already-applied migration.
4. Implement roles page/binary permission, saved delegate picker, replacement integration, consent,
   scoped decision UI, progress/print and worker health. Keep old RPC compatibility until retirement.
5. Complete regression and isolated scheduler tests; regenerate schema from explicit test DB, not
   default dump target. Update requirements/data/permission docs, changelog and backlog accurately.
6. Review final diff/results. Commit/push only with authorization; main push deploys Liara.
7. Separately authorized release: restore-capable backup/rehearsal, compatible schema/app rollout,
   explicit CEO/HR-head configuration and permission/grant activation, then scheduled job activation.
   Never seed real identities or retroactively enroll existing pending requests in migrations.
8. Verify job health and pilot workflows. Pause via job/grant disable retaining manual decisions
   and evidence. App rollback after activation requires evidence compatibility review; database
   rollback uses documented restore procedure, not blind reverse SQL.

The runtime makes a request eligible at two hours, not guaranteed approved to the exact second.
Manual approvals remain possible until an automatic decision is actually committed. Competing
operations use locked state; the committed decision wins and later operations cannot rewrite it.

### Explicitly deferred credential/session risk

Existing account creators know the initial password, and existing resets do not revoke all sessions
(FR-55 deferred item in `docs/TASKS.md`). Delegated signatures amplify that existing risk: someone
retaining another account's credentials/session may appoint a delegate or sign using that account.
On 2026-10-17 the owner explicitly chose to keep protection outside this release and record the risk.
Do not add credential handover/session-invalidation work or an activation gate to this feature.

Future remediation should cover trusted handover for principals and delegates, session invalidation
and server-side rejection of stale sensitive actions, verified against the installed auth runtime.
A password-change flag/reset alone is insufficient. Keep resets admin-only and retain existing
delegation authorization checks. Do not describe this account-control gap as fixed or its tests as
passing; future credential-specific tests belong to that separate follow-up.

## References checked

- Local schema/source, FR-55 permissions, replacement data model and screenshot placements.
- Bundled Next.js server-actions guide read in the preceding planning pass; re-read relevant
  sections before edits.
- Current pg_cron documentation retrieved via Context7 `/citusdata/pg_cron` in the preceding pass:
  [scheduler/run history](https://github.com/citusdata/pg_cron/blob/main/README.md),
  [cross-database API](https://github.com/citusdata/pg_cron/blob/main/_autodocs/api-reference/sql-functions.md).
  Same-job serialization does not replace locking against manual actions. Installed runtime and
  live CEO/HR configuration have not been verified during planning.
