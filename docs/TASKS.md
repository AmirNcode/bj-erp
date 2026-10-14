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

- ☐ **Encrypt backups** now that they hold national IDs and bank details (FR-53): the Liara backup
  copies on the owner's Mac belong on an encrypted disk (owner action), or encrypt the dump files.

- ☐ **FR-55 follow-ups** (release `20261013200001`..`200005`):
  - After the FR-55 release is live, drop the `private.has_permission` legacy keys and
    `app_set_user_roles(uuid, app_role[])`, and `private.can_read_all`. First move
    `finance_approved_requests` (still `has_permission(…, 'finance.view')`) to `has_perm`.
  - **Before pushing the release:** check Liara has exactly one admin. The migration refuses
    otherwise, which blocks the deploy (safe, but a failed release).
  - Admin lockout has no recovery path (D1, owner accepted).
  - SELECT policies on `holidays`, `work_settings` and `approval_steps` are company-blind (fine with
    one company per deploy; the write policies are company-scoped).
  - The Reports page pulse is identity-scoped: its capacity card shows for admin and hr only
    (company-wide); a custom Reports-only role does not see it.
  - A screen to cancel someone else's request: `leave_requests` edit allows it in the database
    (`cancel_leave_request`), but no screen offers it yet (the permission text says so).
  - D7 is a guard against honest mistakes, not a control: hr can still create a hire, give them
    Manager, appoint them department manager and sign in as them (owner question, with the D7
    analogues below).
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
- ☐ Incremental, when touching the area: move client components from translated `labels` props to
  `useTranslations` (audit D3); SQL-level tests instead of TS mirrors (D9); trim history from
  comments (D10); drop the vestigial `profiles.calendar_pref` (C8).
