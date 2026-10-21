# TASKS

Open work only. Finished work lives in `docs/CHANGELOG.md` and git history, so delete an item when
it closes instead of ticking it. Status: ☐ todo · ◐ in progress · ⊘ blocked.

## Liara (production host, testing phase)

- ◐ **Cold-start check:** after initial post-power-on timeouts, a provider restart restored access
  on 2026-10-04. New boot ID, all five services, persistent volume mounts, public HTTPS, renewed
  certificate and active backup timer verified. Owner confirmed login on bjeng.app (2026-10-06).
  Original timeout cause remains unknown; investigate with Liara if it recurs (the uptime workflow
  now emails on an outage).
- ☐ Real data: enter the 1404–1405 official holidays (CSV upload in Settings) and import the
  employee roster (`docs/files/Personnel_CLEAN.csv` via Manage › Employees › Import — owner tests
  it locally first). After import: activate the **Department manager** approval step, give Meysam
  Ayasi the `hr` role if wanted, and hand out the login slips (Print login slips on the
  credentials screen), then delete the CSV. Import only after the FR-50 release is live on Liara:
  accounts created before it are not flagged for a first-login password (regenerating their
  passwords flags them).
- ☐ Personnel list follow-ups (owner): hire a supervisor for «رنگ و بسته بندی» (PNP, 12 people;
  Milad 490 left — until then they report to Sahraei); HR corrects the three balances counted to other dates (notes column: Fateme
  Fouladi "to year end", Sousan Fouladi "incl. Mehr", Mousavi "incl. Shahrivar").

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
  comment in `deploy/docker-compose.yml`.
- ☐ **SMS notifications** for approvers (owner plans an SMS service). Replaces the generic
  notifications item below once a provider is chosen.

## Product backlog

- ◐ **FR-70 travel booking (procurement → finance):** [PR #10](https://github.com/AmirNcode/bj-erp/pull/10),
  branch `codex/travel-booking`; migrations `20261020120000`–`…11` applied only to the scratch DB
  `bj_travel`. Owner review changes done (finance pending + approved, manager's own extension, UI fixes).
  Open: **confirm the traveller field list with procurement** (placeholder: full name, national ID,
  birth date, mobile, gender — `private.travel_traveller_fields()` + `lib/travel/fields.ts`); manual
  walk-through on a stack pointed at `bj_travel`; merge.
  **Deferred by the owner (2026-10-20 review), no code yet:**
  - An hr holder's approval delegate can tick, cancel or decide extensions on that hr holder's OWN trip
    (`private.acts_as_travel_hr` / `is_travel_hr`, migration `…06`, check only `employee_id <> delegate`).
    Accepted for now as an HR exception to the no-delegated-self-signing rule.
  - `app_set_travel_booking` reads the request status without a lock, so ticking at the instant of
    final approval can leave `travel_bookings.opened_at` null for good (narrow race; the trip never
    reaches procurement).
  - HR can approve an extension after the trip has ended (`app_decide_errand_extension` has no end-date
    check). Kept on purpose as a last-minute buffer; revisit with real data.

- ◐ **Approval delegation, replacements and automatic CEO step:** new Yes/No delegation permission
  under Approval chain; saved delegate selection at `/settings/roles` (admin manages others, permission
  holders select their own). Eligible delegates: active managers/approvers. Leave replacement becomes
  temporary delegate only if eligible, during approved absence, then saved delegate resumes. Ordinary
  employees remain work cover only. **Owner simplification 2026-10-19:** no timer, worker or review
  window — when the CEO's attested delegate (e.g. HR head) submits their own request with consent, the
  CEO step is approved at submission; other CEO-step requests go to the CEO or the delegate. Non-HR
  delegates still need HR; only the designated HR head skips the HR signature. Spec:
  `docs/specs/2026-10-17-ceo-delegate-approval-design.md` (amendment). Open as
  https://github.com/AmirNcode/bj-erp/pull/7; one squashed migration `20261018011333`, applied only to
  the rebuilt isolated test DB. Review findings addressed: `step_delegation` performance (10–20× on
  production data), narrower read RLS, CEO re-designation, e2e-cleanup FKs, queue order. Remaining,
  each needing owner authorization: second review, merge (= deploy), pre-deploy backup + restore
  drill, post-deploy smoke. Credential/session hardening stays deferred (risk R9). Second review done
  2026-10-19 (no blocker; follow-ups in the next item).

- ☐ **PR #7 second-review follow-ups** (review of `def6861`, 2026-10-19; none blocks deploy). Migration
  `20261018011333` is frozen once deployed, so SQL fixes go in a new migration. Line numbers refer to it.
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
  - **HR head errand per diem can never be set:** an errand whose only applicable step is the exempt HR
    step is finalized at submission; per diem is settable only on a pending HR step. Ask the owner.
  - **Wider `leave_requests` RLS reaches unscoped queries:** `lib/actions/reports.ts:119` and
    `lib/actions/absences.ts:44` have no employee filter, so named step approvers now also see pending /
    self-decided requests there. Confirm intended or filter.
  - **Nits:** trigger `approval_before_authority_mutation` does `to_jsonb(new)` on full `leave_requests`
    rows (signature PNGs) just to read `company_id` (:1803); `app_approval_queue(p_status)` accepts any
    status (HR could build whole-company history) — pin to pending; queue sort changed from `start_date`
    to `created_at`; separate responsibility consent is not stored distinctly (evidence `consent_at` =
    signature consent); legacy `approve_leave_request` / `request_approval_progress` still granted to
    `anon` (pre-existing, safe, revocable).
  - **Test gaps:** no SQL tests for executive-settings negatives, automatic approval refused when the CEO
    is inactive / lost the permission, the revoke path, the HR-step exclusion; multi-session lock races not
    rerun after the timer removal.
  - **Before deploy (read-only):** count pending requests holding a legacy `step_id is null` manager
    approval where both manager steps apply — the new mapping no longer lets one row fill both, so those
    show "reconciliation required" and need an admin override.

- ☐ **Settings › Roles save notices vanish ~1 s after saving** (branch `codex/approval-delegation`,
  found 2026-10-19): `settings/roles/page.tsx` keys `DelegationPanel` on `JSON.stringify(context)`;
  the save action's `invalidateAppCache()` re-renders the page, the key changes and the panel remounts,
  dropping the "saved" status for delegate and executive saves. Values do update. Fix by
  keying on `principal_id` only (state is already refreshed client-side) and re-run the browser phases.
- ☐ **Farsi print shows the recorded automatic-authority statement in English** (same branch): the
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
- ☐ Owner approved deleting the merged branches; the agent's permission check blocked it, so
  Amir runs it: 4 local `codex/*` and 3 `origin/codex/*`, all merged into `main`.
- ☐ Local disk, owner to confirm: the `.claude/worktrees/peaceful-williams-9c1cf9` worktree and
  its branch (its one lesson is now in `docs/MEMORY.md`); 18 old `bj-erp-app` Docker image tags
  and ~18 GB of Docker build cache.
- ☐ Incremental, when touching the area: SQL-level tests instead of TS mirrors (D9); trim history
  from comments (D10); drop the vestigial `profiles.calendar_pref` (C8). (D3, labels props →
  `useTranslations`, is done on branch `codex/refactor-cleanup`.)
- ⊘ **R-10 of `docs/REFACTOR_PLAN.md`** (delete the test-only TS mirrors in `lib/leave/approvals.ts`,
  `hourly.ts`, `accrual.ts`, `personal-info/fields.ts`): blocked until `tests/sql/*.sql` run in CI
  (a Postgres service job); add SQL cases for order enforcement, self-signing and hourly overlap first.
- ☐ Owner decisions left open by the refactor plan: Q2 (one definition of "approver"), Q3
  (formula-injection guard on all CSV exports; not on credentials, passwords may start with `@`),
  Q5 (delete `personnel-clean-csv.test.ts` with the roster CSV).
