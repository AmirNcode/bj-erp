# TASKS

Open work only. Finished work lives in `docs/CHANGELOG.md` and git history, so delete an item when
it closes instead of ticking it. Status: ☐ todo · ◐ in progress · ⊘ blocked.

## FR-90 / FR-91 replacement on paper only, edit requests (local, not deployed)

- ☐ e2e specs for request edit not yet run against a stack (`request-edit.spec`, `trip-correction.spec`).
- ☐ Deploy FR-90/FR-91 (migrations `20261110100000`, `20261110110000`, `20261110120000`). After deploy (owner): tell HR the Correct button is now Edit and covers all four request types; the admin switches the toggles per role in Settings › Roles (edit own requests is off for everyone).

## FR-89 signature boxes (local, not deployed)

- ☐ Owner tests on the local demo stack (`http://localhost:3501`), then PR + review. Before Liara: check the backfilled box names on the real steps after deploy (Approval steps page) and rename as wanted.
- ☐ e2e not run for `approval-step-person.spec` / `hr-role.spec` after the box-id changes.

## FR-88 replacement sign-off (local, not deployed)

- ☐ e2e spec for sign / decline / choose again (only SQL + unit tests so far).

## Liara (production host, testing phase)

- ◐ **Cold-start check:** after initial post-power-on timeouts, a provider restart restored access
  on 2026-10-04. New boot ID, all five services, persistent volume mounts, public HTTPS, renewed
  certificate and active backup timer verified. Owner confirmed login on bjeng.app (2026-10-06).
  Original timeout cause remains unknown; investigate with Liara if it recurs (the uptime workflow
  now emails on an outage).
- ☐ Real data: roster imported on Liara and login slips printed (2026-10-07). Not yet confirmed:
  the 1404–1405 official holidays (CSV upload in Settings), the **Department manager** approval
  step activated, Meysam Ayasi's `hr` role (if wanted), and `docs/files/Personnel_CLEAN.csv`
  deleted.
- ☐ Personnel list follow-ups (owner): hire a supervisor for «رنگ و بسته بندی» (PNP, 12 people;
  Milad 490 left — until then they report to Sahraei); HR corrects the three balances counted to other dates (notes column: Fateme
  Fouladi "to year end", Sousan Fouladi "incl. Mehr", Mousavi "incl. Shahrivar").

- ☐ **Stuck request 1405-0001 (owner, after the stranded-request fix deploys):** as admin, open
  Approvals and approve or reject it (manager + HR signed; its security step was turned off on
  2026-10-12). It is the only stuck request in the 2026-10-31 backup.
- ☐ **Clearance form setup (FR-54, after release):** in Manage › Employees › «تسویه حساب» › Default rows,
  assign a signer (person or department) to every row except HR, or untick the ones not used; give
  the finance manager the `finance` role. Until then new forms start with unassigned rows HR must
  assign or remove. Confirm with the client whether «مدیریت» stays a regular row (Amir: may change).
- ☐ **After the first FR-54 deploy on Liara:** check `select jobname, schedule from cron.job` shows
  `bj-apply-separations`, and after the first night `cron.job_run_details` shows a succeeded run.

## Pilot launch (owner)

- ☐ `www.bjeng.app`: add the DNS record; then the Caddy site needs the extra hostname and a redirect
  to `bjeng.app`.
- ☐ One-page Farsi user guide: login code = personnel number, install to home screen (Android
  Chrome / iPhone Safari), submit a request, first-login password, whom to call for a forgotten
  password.
- ☐ Tell approvers to open the app daily until notifications exist.

## Before expanding beyond the pilot group

- ☐ **Login rate limit.** GoTrue's `/token` limiter allows a burst of 30, then about one login or
  session refresh per second, **per public IP**, and the whole factory shares one. A company-wide
  first login (training session) will hit it. Onboard in groups, or raise
  `RATE_LIMIT_TOKEN_PER_IP_5_MINUTES` (default 300) in the VM `.env` and recreate `auth`. See the
  comment in `deploy/docker-compose.yml`. **Owner, 2026-11-03:** HR onboards person by person or one
  department at a time, so no change for now. Liara check the same day: sessions show distinct public
  client addresses (the gateway does not collapse everyone into one bucket).
- ◐ **Admin panel + SMS notifications (FR-77, FR-78)** built on branch `claude/admin-panel` (not committed,
  not deployed). After deploy (owner): SMS starts in **Dry run**; check Admin panel › SMS log for who would
  be texted and how many are `skipped: no mobile` (fill mobiles in personal info). When IT sends the
  Melipayamak **console API key**: save it, **Check balance**, send one test text to your own number, then
  switch to Live. Ask IT whether the `5000…` line is service or promotional; if promotional, get pattern
  templates approved for the three events and switch to Pattern. Check `select jobname from cron.job`
  shows `bj-sms-dispatch` and `bj-purge-sms-outbox`, and that the System tab lists a backup the next day.
- ◐ **Admin panel v2 (FR-79 sign-ins + force sign-out, FR-80 password rule; audit by person, off-server
  copy status, cron-history purge)** built on `claude/admin-panel` (not committed, not deployed); ships
  with FR-77/78. Spec `docs/specs/2026-11-03-admin-panel-v2-design.md`. After deploy (owner): run
  `bash deploy/liara/pull-backups-to-mac.sh install` once on the Mac so the installed copy reports to
  the System tab; check System › Backups shows "Off-server copy" green the next day. Not checked in a
  signed-in browser yet (no local admin login): open Sign-ins and sign out a test person.
- ☐ **PR #17 review leftovers** (`docs/reviews/pr-17-review.md`; F1 fixed before merge). Owner
  decision first: **F2** GoTrue's `PUT /auth/v1/user` lets a signed-in user set a password with only
  GoTrue's 6-character rule (FR-80 bypass); fix with `GOTRUE_PASSWORD_MIN_LENGTH` +
  `GOTRUE_PASSWORD_REQUIRED_CHARACTERS` on `auth`, or a Caddy block (both need a compose/Caddy
  release). Before SMS goes **Live**: **F4** retries after a timeout can send twice, **F5** one bad row
  stops the whole dispatcher. Small migration: **F3** revoke `anon`/`authenticated` on schema `net`,
  **F6** revoke write grants on `sms_outbox`. Low: F7–F12.
- ☐ **Reminder (owner, 2026-11-04): come back to the error log (FR-81).** Design is §4 of the v2 spec
  (server errors via `instrumentation.ts` `onRequestError`, browser crashes via error boundaries, an
  admin Errors tab, 30-day purge). Open question there: the writer is open to the public anon key
  (hourly cap), because the app has no server-only secret without a compose change.
- ☐ **Editable SMS templates:** on hold until the client's IT says whether the line is service or
  promotional (in pattern mode the texts live at Melipayamak).

## Product backlog

- ◐ **Approvals and Finance usability (FR-87):** implemented on `codex/approvals-finance-layout`, uncommitted and not deployed. Apply `20261108200021` before the app. After deployment, owner: enable **Finance → View/print work-errand forms** for desired roles (off by default), confirm the renamed Leave review permission, and check the merged Approvals/HR controls with a real account. Existing local Farsi redirect loop remains outside this change; RTL components were validated in a locale fixture.

- ◐ **View as (FR-86):** built on `claude/view-as` (committed, not pushed, no PR; not deployed). Pushing `main`
  deploys it; the deploy runs `deploy/lib/sync-view-as-hook.sql` by itself. Owner: check the Farsi strip copy.
  Parked idea, only if reported problems turn out to be about actions: a trial mode (run an action, then roll
  it back; PostgREST `Prefer: tx=rollback`). The owner dropped it for now (spec §1).
- ◐ **Approved trip corrections + quick balance add (FR-84, FR-85):** built on
  `claude/approved-trip-corrections` (not merged, not deployed). Ships with FR-83. After deploy (owner): tell HR
  about Edit (was Correct, FR-91) on Manage › Requests and Add to balance on Edit Employee, and that early return = add the unused
  time (not any unpaid days on that request). Tell finance what the "Corrected" marker means.
- ◐ **First and last names (FR-83):** merged to main as `8224e81`, not deployed. Owner (2026-11-05): ships with FR-84/85 when merged.
  After deploy (owner/HR): sort Manage › Employees by Last name Z to A and fix each blank (about 54
  expected). Tell HR old import files are now refused and the personal-info export has two name columns.
- ☐ **FR-83 follow-up (one release after it deploys):** remove `p_full_name` from `app_create_employee`
  and the `full_name` branch of `app_bulk_create_employees` / `app_bulk_import_employees`. They exist only
  for the old app during the deploy window.
- ◐ **Profile photos (FR-82):** built on `claude/profile-photos-spec` (not merged, not deployed).
  Owner: review the as-built amendment (spec §8: HR may set anyone's photo but the admin's; manager
  selects show no face). After deploy: upload your own photo from a phone (camera and gallery); as HR,
  set and lock one person's photo and check their Profile shows "Set by HR".
- ☐ **Security-only staff (FR-76) after deploy (owner):** sign in as a security-only person (Security,
  no Employee; 3 on the local roster): no Request tab, no My Recent Requests / My Balances on Home.
  Anyone who should keep leave needs Employee ticked too.
- ☐ **Absence notifications (FR-75) after deploy (owner):** on Liara, Manage › Approval steps ›
  Absence notifications should list the old HR/Security holders (all four types, Home tile). Add the
  fingerprint clerk with only the types they enter; untick the rest for people who do not need it.
  Settings › Roles no longer shows "Approved absences".
- ☐ **`tests/sql/approval-delegation.sql` fails on a clone of the local DB** ("submission failed for
  ceo: overlapping leave request exists"), with or without FR-75 — likely the real roster's data
  colliding with its fixture dates. Investigate (found 2026-11-03).
- ☐ **Absences look-ahead feedback (owner, after deploy):** ask the HR clerk who updates the
  fingerprint system whether the 30-day list on Home is enough. If items slip, next step is a
  worklist with a per-request "entered in attendance system" tick, flagging cancelled-after-entry
  and back-dated approvals (see AGENT-LOG 2026-11-02 design advice).

- ☐ **Production test of sign once, Home details, finance range (FR-71, FR-72, FR-62 amendment)**
  (owner; [PR #11](https://github.com/AmirNcode/bj-erp/pull/11), live since 2026-10-22): Head of HR as manager signs once; employee's Home shows procurement's note under Show more;
  Remove on a rejected request; `/finance` opens on this + next month.

- ☐ **FR-70 travel booking follow-ups** ([PR #10](https://github.com/AmirNcode/bj-erp/pull/10), live;
  migrations `20261020120000`–`…11` are frozen, so fixes go in new migrations).
  **Confirm the traveller field list with procurement** (placeholder: full name, national ID,
  birth date, mobile, gender — `private.travel_traveller_fields()` + `lib/travel/fields.ts`).
  **Deferred by the owner (2026-10-20 review), no code yet:**
  - An hr holder's approval delegate can tick, cancel or decide extensions on that hr holder's OWN trip
    (`private.acts_as_travel_hr` / `is_travel_hr`, migration `…06`, check only `employee_id <> delegate`).
    Accepted for now as an HR exception to the no-delegated-self-signing rule.
  - `app_set_travel_booking` reads the request status without a lock, so ticking at the instant of
    final approval can leave `travel_bookings.opened_at` null for good (narrow race; the trip never
    reaches procurement).
  - HR can approve an extension after the trip has ended (`app_decide_errand_extension` has no end-date
    check). Kept on purpose as a last-minute buffer; revisit with real data.
  **Security review findings, skipped by the owner 2026-10-20 (come back later):**
  - `…06` `private.is_travel_hr` / `acts_as_travel_hr` is company-wide: an hr holder's delegate passes on
    the hr holder's own trip and on the delegation's source request (same as the first deferred item).
    Fix idea: per-request check, `r.employee_id <> principal` and `source_request_id is distinct from request`.
  - `…05` `cancel_leave_request` travel branch lacks the `leave_requests` branch's exclusions: HR can cancel
    admin-owned travel trips (owner: fine, admin is a test account) and the delegating principal's own trips.
  - `…04` `app_decide_errand_extension` does not refuse `e.requested_by = v_uid`: a direct manager who also
    holds `hr` can request and approve their report's extension. Fix idea: 42501 after the lock, and hide
    such rows in `app_pending_errand_extensions`.

- ☐ **Approval delegation follow-ups** ([PR #7](https://github.com/AmirNcode/bj-erp/pull/7), live; spec
  `docs/specs/2026-10-17-ceo-delegate-approval-design.md`). From the second review of `def6861`
  (2026-10-19). Migration `20261018011333` is frozen, so SQL fixes go in a new migration; line numbers
  refer to it. Credential/session hardening stays deferred (risk R9).
  - **Revoke blocked while principal is ineligible (most important):** `app_set_approval_delegate`
    (:389-391) demands the principal's `approval_delegate` permission + `natural_approver` even when
    `p_delegate_id` is null. If the CEO is deactivated or loses the manager role/permission, admin cannot
    clear the appointment; when restored, the saved `ceo_authorized` grant silently takes effect again.
    Workaround until fixed: unset and re-set the CEO in executive settings (clears `ceo_authorized`).
    Fix: skip those checks for a revoke; SQL test: role removed → revoke → role restored → no auto step.
  - **`app_set_executive_settings` validation is a no-op** (:425-430): `from unnest(...) id ... where
    p.id=id` / `s.id=id` resolve `id` to the inner table column, so inactive or other-company CEO/HR head
    and any step UUID pass. Fix: `unnest(...) as v(eid)`, compare `v.eid`; add negative tests.
  - **Automatic set can include an HR-mapped step** (`enroll_request_delegation` :531): if the CEO owns
    a step listed in `hr_step_ids` (e.g. named approver), a non-HR-head delegate's HR step is auto-approved.
    Add `and not s.id = any(x.hr_step_ids)`.
  - **Config drift blocks the delegate's submission** (:533-534): if the CEO no longer owns a step for a
    request kind, submit raises "CEO has no natural applicable approval step" while the preview still asks
    for consent. Skip the automatic path instead, or reflect it in `auto_approval_eligible`.
  - **Admin can nominate themselves** as someone's delegate (`delegate_eligible` :108 checks only
    principal ≠ delegate); spec §4 says nobody may. Reject `p_delegate_id = auth.uid()`.
  - **e2e testid contract broken:** `ApprovalQueue.tsx:170` is now `chain-<id>-<step_id>`;
    `tests/e2e/hr-role.spec.ts:355-380` still expects `chain-<id>-manager` / `-hr`. Restore a role-based
    testid or update the spec.
  - **Wider `leave_requests` RLS reaches unscoped queries:** `lib/actions/reports.ts:119` and
    `lib/actions/absences.ts:44` had no employee filter, so named step approvers now also see pending /
    self-decided requests there. Confirm intended or filter. (Absences no longer reads `leave_requests`
    since FR-75: `watched_absences` is approved-only; the reports query remains.)
  - **Nits:** trigger `approval_before_authority_mutation` does `to_jsonb(new)` on full `leave_requests`
    rows (signature PNGs) just to read `company_id` (:1803); `app_approval_queue(p_status)` accepts any
    status (HR could build whole-company history) — pin to pending; queue sort changed from `start_date`
    to `created_at`; separate responsibility consent is not stored distinctly (evidence `consent_at` =
    signature consent); legacy `approve_leave_request` / `request_approval_progress` still granted to
    `anon` (pre-existing, safe, revocable).
  - **Test gaps:** no SQL tests for executive-settings negatives, automatic approval refused when the CEO
    is inactive / lost the permission, the revoke path, the HR-step exclusion; multi-session lock races not
    rerun after the timer removal.
  - **Post-deploy check (read-only, Liara):** count pending requests holding a legacy `step_id is null` manager
    approval where both manager steps apply — the new mapping no longer lets one row fill both, so those
    show "reconciliation required" and need an admin override.

- ☐ **Settings › Roles save notices vanish ~1 s after saving** (found 2026-10-19,
  shipped with PR #7): `settings/roles/page.tsx` keys `DelegationPanel` on `JSON.stringify(context)`;
  the save action's `invalidateAppCache()` re-renders the page, the key changes and the panel remounts,
  dropping the "saved" status for delegate and executive saves. Values do update. Fix by
  keying on `principal_id` only (state is already refreshed client-side) and re-run the browser phases.
- ☐ **Farsi print shows the recorded automatic-authority statement in English** (shipped with PR #7): the
  statement is stored immutable evidence text written by SQL in English.
- ☐ **e2e cleanup fails when a throwaway approver signed a throwaway user's request** (pre-existing,
  found 2026-10-19; same FKs on `main`): one `delete from auth.users` removes both, and the approver's
  `ON DELETE SET NULL` update on `leave_request_approvals` re-checks a request row already cascaded
  away (23503). Delete the junk users' `leave_requests` first inside `app_cleanup_e2e_users`. Decide whether to store both
  languages at decision time or print a localized summary beside the recorded original.

- ☐ **Farsi route prefetch takes two redirects per tab** (pre-existing, found 2026-10-19):
  `RoutePrefetcher.tsx` prefetches `/${locale}${href}`, so in Farsi every `/fa/…?_rsc` prefetch is
  307'd to `/…` and again to `/…?_rsc`. Harmless but wasted round-trips on the nav-perf path; use the
  next-intl router/`Link` locale handling (as-needed: no `fa` prefix) and verify with a network trace.
  The language switch's soft navigation similarly leaves `/fa/profile` in the address bar until reload.

- ☐ **Encrypt backups** now that they hold national IDs and bank details (FR-53): the Liara backup
  copies on the owner's Mac belong on an encrypted disk (owner action), or encrypt the dump files.

- ☐ **FR-55 follow-ups** (release `20261013200001`..`200007`):
  - After the FR-55 release is live, drop the `private.has_permission` legacy keys and
    `app_set_user_roles(uuid, app_role[])`, and `private.can_read_all`. First move
    `finance_approved_requests` (still `has_permission(…, 'finance.view')`) to `has_perm`.
  - **At release:** recheck Liara has exactly one active admin and `pgrst_ddl_watch` enabled;
    verified read-only on 2026-10-15. More than one admin is rejected by the migration, but zero
    or inactive admins are not rejected. Refresh the backup before deploying; use only the
    fresh-database restore procedure if rollback is needed.
  - Admin lockout has no recovery path (D1, owner accepted).
  - `getRoleHolders` (`lib/actions/roles.ts`) sends every holder id in one `.in()` filter. A
    custom role held by several hundred people may exceed the URL limit and break the delete
    dialog. Use an RPC or a join instead.
  - SELECT policies on `holidays`, `work_settings` and `approval_steps` are company-blind (fine with
    one company per deploy; the write policies are company-scoped).
  - The Reports page pulse is identity-scoped: its capacity card shows for admin and hr only
    (company-wide); a custom Reports-only role does not see it.
  - A screen to cancel someone else's request: `leave_requests` edit allows it in the database
    (`cancel_leave_request`), but no screen offers it yet (the permission text says so).
  - D7 is a guard against honest mistakes, not a control: hr can still create a hire, give them
    Manager, appoint them department manager and sign in as them (owner question, with the D7
    analogues below).
  - **Deferred (review decision 2026-10-14): account control and D3.**
    The 2026-10-15 sensitive-role restriction closes the reproduced self-role pawn path: only admin
    may assign write-capable roles, and HR is restricted to Employee/Manager. The manager/approver
    creation-credential issue below remains deferred; warnings do not close it. Password resets are
    admin-only (`20261013200007`), which closes the peer-reset path. NOT closed: impersonation
    through credentials a non-admin issues when creating an employee. Every creator
    (`people_create`, a Manager onboarding to their team, bulk create) picks the initial password
    and can complete the first-login change, `must_change_password` is enforced in the app layout
    only, and a reset does not end the target's sessions (no SQL touches `auth.sessions` /
    `auth.refresh_tokens`). Pre-existing on main: HR creates a hire, makes them the only named
    approver, signs in as them and approves HR's own request (code reading, not reproduced).
    Options from the review: an account-control rule ("D13": control keys, never reset or empower
    someone who decides for you) and issuer tracking + session revocation ("Tier 2"). Before
    re-delegating password resets, decide these and add SQL scenarios for every path. D3 is not
    fully protected until then.
    **Reaffirmed 2026-10-17 during delegation review:** owner chose to keep credential/session
    protection outside the delegation release and record the residual risk. Retained credentials or
    sessions may be used to configure or exercise another account's delegated approval authority;
    delegation does not close this gap. See `docs/REVIEW-2026-10-17-approval-delegation.md`, R9.
  - Owner questions pending, the D7 analogues: a `people` editor setting themselves as a report's
    manager (and a Manager doing so for their own reports), an `approval_steps` editor naming
    themselves as approver, a `clearance` editor naming themselves as signer, a `people_create`
    holder setting themselves as manager of a new hire.

- ☐ FR-8: leave types cannot be added or edited in the app. Only the seeded types exist.
- ☐ Rejection reason: preset reasons in a dropdown, keeping free text as "other" (owner's plan).
- ☐ Ask the client whether the daily work errand has its own paper form. It reuses BJ-F 50207
  today.
- ☐ Optional: extend `jalali_months` below 1400 for historical leave records. Regenerate with
  `scripts/gen-jalali-months.mjs`, and update the error text that names Farvardin 1400.
- ☐ Notifications (push, SMS or email) once a channel is chosen.
- ☐ Later modules (PLAN §6): attendance, shifts, overtime, advances and loans, payslips,
  announcements, documents, QC, finance, procurement.

## Known gaps, left on purpose

- `login.codePlaceholder` still shows `prod-1042`. Changing it is the mixed-format hint that D14
  ruled out (`docs/specs/2026-07-30-work-errand-and-login-codes-design.md`).
- The on-prem deploy code stays in `deploy/` (the `bj-deploy` `client` target, `package.sh`,
  `release.sh`, `setup-release.sh`, the amd64 compose overlay, `RUNBOOK.md`) in case the app moves
  back on-site (owner, 2026-10-04). If it is ever removed, tag the last commit that has it first.

## Codebase cleanup

Plan and status: `docs/CLEANUP-AUDIT-2026-10-04.md` (§0 says what was applied on 2026-10-04).

- ☐ `updateDepartmentCode`, its skipped test (`tests/e2e/department.spec.ts`) and the
  `departments_update_admin` policy: owner said leave them for now (2026-10-04).
- ☐ Local disk, owner to confirm: stale detached worktrees `/Users/amir/Workspace/bj-fr55` (FR-55,
  merged in PR #6; its scratch DB `bj_fr55`) and `.claude/worktrees/objective-kilby-c2fe28`, plus a
  prunable scratchpad worktree (`git worktree prune`); 18 old `bj-erp-app` Docker image tags and
  ~18 GB of Docker build cache.
- ☐ Incremental, when touching the area: SQL-level tests instead of TS mirrors (D9); trim history
  from comments (D10); drop the vestigial `profiles.calendar_pref` (C8). (D3, labels props →
  `useTranslations`, is done (PR #9).)
- ⊘ **R-10 of `docs/REFACTOR_PLAN.md`** (delete the test-only TS mirrors in `lib/leave/approvals.ts`,
  `hourly.ts`, `accrual.ts`, `personal-info/fields.ts`): blocked until `tests/sql/*.sql` run in CI
  (a Postgres service job); add SQL cases for order enforcement, self-signing and hourly overlap first.
- ☐ Owner decisions left open by the refactor plan: Q2 (one definition of "approver"), Q3
  (formula-injection guard on all CSV exports; not on credentials, passwords may start with `@`),
  Q5 (delete `personnel-clean-csv.test.ts` with the roster CSV).
