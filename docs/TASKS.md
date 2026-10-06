# TASKS

Open work only. Finished work lives in `docs/CHANGELOG.md` and git history, so delete an item when
it closes instead of ticking it. Status: ☐ todo · ◐ in progress · ⊘ blocked.

## Liara (production host, testing phase)

- ◐ **Cold-start check:** after initial post-power-on timeouts, a provider restart restored access
  on 2026-10-04. New boot ID, all five services, persistent volume mounts, public HTTPS, renewed
  certificate and active backup timer verified. User still needs to verify login and saved data.
  Original timeout cause remains unknown; investigate with Liara if it recurs.
- ☐ Scheduled offsite backups. Daily backups currently stay on the VM.
- ☐ Real data: enter the 1404–1405 official holidays (CSV upload in Settings) and import the
  employee roster (`docs/files/Personnel_CLEAN.csv` via Manage › Employees › Import — owner tests
  it locally first). After import: activate the **Department manager** approval step, give Meysam
  Ayasi the `hr` role if wanted, and hand out the credentials file.
- ☐ Personnel list follow-ups (owner): hire a supervisor for «رنگ و بسته بندی» (PNP, 12 people;
  Milad 490 left — until then they report to Sahraei); HR corrects the three balances counted to other dates (notes column: Fateme
  Fouladi "to year end", Sousan Fouladi "incl. Mehr", Mousavi "incl. Shahrivar").

## Product backlog

- ☐ FR-8: leave types cannot be added or edited in the app. Only the seeded types exist.
- ☐ Rejection reason: preset reasons in a dropdown, keeping free text as "other" (owner's plan).
- ☐ The role checkboxes on both employee forms show raw English slugs (`admin`, `hr`, …) even in
  Farsi. The e2e `createEmployee` helper selects them by label text, so add `data-testid`s before
  translating them. The Edit Employee "Admin actions" card title is hard-coded English too.
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
