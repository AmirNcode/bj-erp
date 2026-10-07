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
- ☐ **Limited admin role** for on-site helpdesk: reset passwords (and maybe create employees)
  without full admin. Today only `admin` can reset passwords.
- ☐ **SMS notifications** for approvers (owner plans an SMS service). Replaces the generic
  notifications item below once a provider is chosen.

## Product backlog

- ☐ **Admin-configurable roles and permissions** (owner, 2026-10-07). Admin creates a role (name),
  ticks a permission level per area (not allowed / read only / edit), and the role appears in the
  Edit Employee role checkboxes, so granting access no longer needs a migration. Seam already in
  place: `private.has_permission(uid, key)` (FR-51) — replace its body with a table lookup, move the
  older hard-coded `has_role(uid,'hr')` grants onto it, and replace the fixed `app_role` enum with a
  roles table.

- ☐ FR-8: leave types cannot be added or edited in the app. Only the seeded types exist.
- ☐ Rejection reason: preset reasons in a dropdown, keeping free text as "other" (owner's plan).
- ☐ The role checkboxes on both employee forms show raw English slugs (`admin`, `hr`, …) even in
  Farsi. The e2e `createEmployee` helper and `hr-employee-admin.spec` select them by label text, so
  add `data-testid`s before translating them.
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
