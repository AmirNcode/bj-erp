# AGENT LOG — running journal of what agents changed

**Every agent that touches this repository MUST append an entry here before finishing its
session.** This is not optional and not conditional on the size of the change. An agent that
edits code, config, deployment files, the database, or the live server and leaves no entry has
left the next agent blind.

## Why this file exists

`docs/CHANGELOG.md` records **what shipped**, grouped by feature, written for a release reader.
`docs/MEMORY.md` records **durable lessons** that outlive any one change. Neither answers the
question an agent actually has when it opens this folder cold:

> *Someone was here after me. What did they do, why, what state did they leave things in, and
> what is half-finished?*

This file answers that. It is chronological, session-scoped, and includes things a changelog
would never carry — commands run against the client's live server, investigations that found
nothing, decisions deliberately deferred, work left uncommitted.

## Rules for agents

1. **Append a new entry at the top of "Entries"** (reverse chronological — newest first).
2. **Write it before you end the session**, not "later". If the user ends the session early,
   log what you did up to that point.
3. **Log the failed and abandoned work too.** A dead end you already explored is worth as much
   to the next agent as a success — it stops them repeating it.
4. **Log actions taken outside the repo**: commands run on the client's server, database
   changes, anything done over SSH. These leave no git trace and are the easiest thing to lose.
5. **Be concrete.** File paths with line numbers, exact commands, exact error text. "Fixed the
   login bug" helps nobody; "`NEXT_PUBLIC_SUPABASE_URL` lacked the port, so the browser called
   :443" does.
6. **State verification honestly.** What you actually ran, and what it actually printed. If you
   did not run the tests, say you did not run the tests.
7. **Never rewrite or delete someone else's entry.** If an earlier entry turns out to be wrong,
   add a new entry that corrects it and link back.

### Where each kind of information belongs

| Information | Goes to |
|---|---|
| Everything you did this session, in order | **this file** (always) |
| A user-facing feature or fix that shipped | also `docs/CHANGELOG.md` |
| A lesson that will still matter in six months | also `docs/MEMORY.md` |
| Work now done / newly discovered work | also `docs/TASKS.md` |
| A frozen design decision for a module | also `docs/specs/<date>-<name>.md` |

This file is the one that is **always** updated. The others are updated when they apply.

### Entry template

Copy this block verbatim and fill it in.

```markdown
## YYYY-MM-DD — <short title of the session's work>

**Agent:** <model / tool, e.g. Claude Opus 5 via Claude Code>
**Branch / HEAD at start:** <branch> @ <sha>
**Trigger:** <what the user asked for, in one sentence>

**What changed**
- `path/to/file.ts:42` — what and why

**Actions outside the repo**
- <server commands, DB changes, deploys — or "none">

**Verification**
- <commands run and their actual result — or "not run, and why">

**State left behind**
- <committed? uncommitted? branch? pushed? what is unfinished or unverified>

**For the next agent**
- <traps, follow-ups, things deliberately not done>
```

---

# Entries

## 2026-10-05 — Local redeploy of HR admin redesign

**Agent:** Claude Opus 5.5 via Claude Code · **Branch / HEAD:** main @ fd407bf

- `./deploy/bj-deploy app local` (no new migrations, LAN IP still 192.168.2.80). DB untouched.
- Verified `/api/health` 200, `/login` 200. User confirmed site loads in phone Chrome.
- Then, on user request, pushed main to trigger Liara deploy. Local CI mirror all green: audit 0
  vulns, lint, 455 unit tests, test:deploy + 3 deploy scripts, tsc. Previous HEAD `fd407bf` had
  `[skip ci]`, so the push commit deliberately omits it. `docs/design/` left untracked (other agent's handoff).
- Run 37266101461 FAILED: build ok, deploy step `ssh: connect to host 62.60.191.132 port 32222:
  Connection timed out` before any file transfer. Mac probe 05:1x UTC: SSH 32222 and HTTPS 443 both
  time out too, so the VM is unreachable again (like 2026-10-04). Live release unchanged. No VM restart done.

## 2026-10-05 — HR admin UI redesign (shell, Home, Employees, Settings, Reports)

**Agent:** Claude Opus 5.5 via Claude Code
**Branch / HEAD at start:** main @ 2d2754b
**Trigger:** Amir: implement `docs/design/design_handoff_hr_admin_redesign/README.md`, one commit per step.

**What changed** (commits 8291b77, 9c26fae, 63f4933, c7e3f1d, 5f4635d)
- Shell: `_components/MainNav.tsx` is the whole side panel (logo, grouped nav, footer with
  `PageRefreshButton`, profile link, new `LanguageSwitch.tsx`); `AppShell.tsx` lost the header.
  `lib/nav/tabs.ts` adds `manageItemsForRoles` / `settingsItemForRoles`. Desktop Employees item
  owns `nav-manage`; the mobile Manage tab is `nav-manage-tab` (→ new `manage/page.tsx` list),
  mobile Profile tab `nav-profile-tab`. Approvals badge streams a promise from `(app)/layout.tsx`.
- Home: `lib/actions/home.ts` (getTodayPulse, getMyBalanceUsage, getNextHoliday,
  getRequesterBalances) + pure `lib/home/pulse.ts`. `PendingApproval` gained submitted_at,
  department, leave_type_id, affects_balance. Approve/reject dialogs extracted to
  `manage/approvals/DecisionDialogs.tsx` and reused by `home/PendingApprovalsCard.tsx`.
- Employees: `lib/employees/list.ts` (URL parsing, PostgREST-safe ilike term, 25/page);
  `EmployeesToolbar.tsx`; `/team` redirects to `?filter=reports`.
- Settings: `/settings` (admin) with `WorkSettingsForm`, `HolidayEditor`, `HolidayImportDialog`
  moved from `manage/settings/`; `/manage/departments` (DepartmentsCard + AccrualRunner, admin),
  `/manage/approval-steps` (admin + hr). `manage/settings/page.tsx` is now a role redirect.
- Reports: `ReportsDashboard.tsx` rewritten (two bar cards, instant selects, export menu);
  `absenceDaysByDepartment` + `buildCapacity` in `lib/reports/reports.ts`.
- E2E specs updated for moved routes, pagination (`?q=<code>`) and the export menu.
- `eslint.config.mjs` ignores `docs/design/**` (vendored support.js in the handoff zip).

**Actions outside the repo**
- Unzipped the handoff into `docs/design/` (left untracked, as found).
- Local Docker DB only: submitted 3 pending leave requests via `submit_leave_request` as seeded
  users 2001, 2002, 2101 (psql with impersonated JWT claims), then rejected 2101's from Home to
  test inline decisions. The other two are still pending. The aborted e2e run's global setup also
  reset the local admin locale to fa and the weekend to Friday-only.

**Verification**
- After each step: `npm run test:unit` (final 455 passed) and `npm run lint` clean; `tsc` clean;
  `npm run build` passed.
- Browser checks on the local dev server (desktop 1280 and mobile 375, fa RTL): shell, language
  switch, Home pulse + inline reject, Employees search/filter/bulk bar/mobile cards, Settings,
  Departments, Approval steps, Reports select + export menu. No horizontal overflow on mobile.
- E2E **not run**: `npx playwright test --workers=1` failed every spec at launch (Chromium
  headless-shell 1228 is not installed; needs `npx playwright install chromium`).

**State left behind**
- Five commits on local `main`, not pushed (push deploys to Liara). Docs commit follows.
- This log and `docs/TASKS.md` carry earlier agents' uncommitted outage notes; left uncommitted.

**For the next agent**
- Install the Playwright browser and run the e2e suite before pushing.
- README deviations are listed in the session summary: bulk bar has only password reset (no
  change-department / deactivate actions exist), accrual lives on the Departments page, "،" kept
  where the README spells it and "-" replaces old middle dots; Calendar, Request and print pages
  still contain "·" (out of scope).

## 2026-10-04 — Clean restart of local Docker stack for LAN testing

**Agent:** Claude Opus 5.5 via Claude Code · **Branch / HEAD:** main @ 2ff9af6
**Trigger:** User asked to clean-start the local Docker stack and get a LAN link for laptop + phone.

- Found `bj-erp` stack up 3 days; app image dated 2026-08-18 (stale). Mac LAN IP had drifted
  192.168.2.70 → 192.168.2.80, so `deploy/.env` `APP_HOST`/`APP_ORIGIN` updated to `.80`
  (gitignored, private file).
- `docker build --no-cache --pull` of `bj-erp-app:local-arm64`, then `./deploy/bj-deploy update local`
  (verified backup under `backups/deploy-assistant/local/`, applied migrations up to
  `20260819120001`, reseeded, recreated app). Then `docker compose ... up -d --force-recreate` on all
  five services so gateway (default_sni / cert) and GoTrue (SITE_URL) pick up the new IP. DB volume kept.
- Verified: `/api/health` 200, `/auth/v1/health` 200, `/login` renders, cert SAN = IP 192.168.2.80,
  `curl --cacert deploy/bj-root-ca.crt` trusted 200. No login/e2e test run.
- For next agent: DHCP may change the Mac IP again → edit `deploy/.env` and recreate all containers.

## 2026-10-04 — Connectivity recovered after provider restart

**Agent:** Codex · **Branch / HEAD:** main @ 2ff9af6

- Follow-up SSH succeeded with new boot ID `0c59670d-ade9-4e91-9cd4-6e74e6a4a46f`; uptime ~1 minute.
  Public HTTPS health returned 200. User independently confirmed the app loads on phone cellular.
- All five containers running without manual start/deploy commands; database healthy. Auth restart
  count 1, other services 0 at check. Live release remains a0cb7b1. Original database/certificate
  volumes remain mounted. No database content comparison or login test performed in this turn.
- Docker and backup timer active; backup service last result success, next run scheduled.
- Public certificate has renewed: valid Oct 4 21:30:46 UTC through Oct 11 13:30:45 UTC.
- The provider restart restored observed reachability; exact original guest/network cause is unknown.
  No forced reset/rebuild, credential changes, firewall changes or code deployment performed.
- Updated open tasks for observed startup/certificate recovery; user login/data check still needed.
  Outage journal and task updates are local only; no commits/pushes in this troubleshooting session.

## 2026-10-04 — Controlled provider restart while investigating outage

**Agent:** Codex · **Branch / HEAD:** main @ 2ff9af6
**Trigger:** User requested alternatives to waiting for support for the post-power-on SSH timeout.

- Checked installed `liara vm restart --help` and Context7's documented power signal API.
- Issued exactly one `liara vm restart --vm bj-vm --detach`; CLI confirmed restart signal sent.
  Existing VM/disks retained; no rebuild, deletion, firewall change or deployment.
- Safe-column VM query still reports CREATED / POWERED_ON. TCP probes to 32222, 80 and 443
  still timed out after request. Queried documented VM events using the existing CLI credential
  in memory without printing it: newest operation, 2026-10-05T00:08:20.567Z, reports SUCCEEDED.
  This confirms provider operation status, not successful guest boot or application health.
- Asked user to test HTTPS on phone cellular data with Wi-Fi disabled to isolate the home route.
- If external reachability remains absent, next evidence is an independent network/Iran-side
  probe or provider console/guest/network diagnostics. Do not attribute outage to lost keys.
- Journal remains uncommitted with previous outage entries; unrelated code is unchanged.

## 2026-10-04 — SSH key intact; Liara confirms powered-on state

**Agent:** Codex · **Branch / HEAD:** main @ 2ff9af6
**Trigger:** User confirmed IP unchanged, remote console unavailable, refreshed CLI login, and asked whether code cleanup deleted SSH credentials.

- Dedicated `/Users/amir/.ssh/bj_liara_deploy` exists (419 bytes, mode 600); ssh-keygen parses it
  successfully as ED25519. Alias still targets root@62.60.191.132:32222.
- Refreshed CLI access works: `liara vm list` and `vm info --vm bj-vm` report CREATED,
  POWERED_ON, Debian 12.9 and expected IPv4. Power state alone does not verify guest boot/network.
- Caution: default `liara vm info` output includes the server password, which appeared in tool
  output. Do not repeat that value; use explicit safe columns on future VM queries. Rotate this
  root password once authorized access is restored; no secret files were opened or keys printed.
- Latest GitHub deployment remains successful a0cb7b1, run 36806814730; cleanup is local and no
  subsequent deployment run appears. Missing keys cannot explain the prior TCP connection timeouts.
- No restart or server mutation performed. Next evidence needed from Liara: guest boot/console,
  NIC/public routing, firewall and persisted SSH port 32222. Root cause still unconfirmed.

## 2026-10-04 — Post-power-on connectivity investigation

**Agent:** Codex · **Branch / HEAD:** main @ 2ff9af6
**Trigger:** User reports bj-vm powered on in Liara for an hour after two days off, but SSH times out.

**Actions / verification**
- Read current onboarding, newest journal entries and open tasks; did not read retired archive.
- Effective `liara-bj-vm` SSH config still resolves root@62.60.191.132:32222 with the dedicated
  key. Bounded SSH and HTTPS health attempts both timed out before connection; no auth/TLS stage.
- Independent TCP probes to 22, 80 and 32222 also timed out. Mac route uses en0 via 192.168.2.1.
  This does not distinguish guest boot/firewall failure from provider/international routing or IP change.
- GitHub's latest deployment run remains successful 36806814730 (a0cb7b1); no active release shown.
- Context7 Liara docs plus installed CLI help identified read-only `liara vm list/info` commands.
  `liara vm list` returned Authentication failed and requested `liara login`; no VM state obtained.
- Asked user to confirm the currently assigned IPv4 and what the remote console displays.
  Need restored CLI authentication or console evidence before diagnosing the guest/network.

**State left behind**
- No VM restart, firewall change, deployment, credential change or data write performed.
- Cold-start validation remains incomplete. Only this journal entry is modified locally.

## 2026-10-04 — `/manage/allocations` removed; branch deletion blocked; on-prem code kept

**Agent:** Claude Opus 5.5 via Claude Code
**Branch / HEAD at start:** `main` @ `eb5a913` (cleanup still uncommitted)
**Trigger:** Amir: remove allocations, delete old branches, keep the on-prem deploy code unless
it is trivial to rebuild, and report on that before acting.

**What changed**
- Deleted `app/[locale]/(app)/manage/allocations/` (page + `AllocateForm`) and the `allocations`
  message namespace in both catalogs; manage layout comment updated.
- `tests/e2e/_helpers.ts` `allocate()` now opens the employee's Edit page, adds `days` to
  `balance-days-annual` (rounded to the input's 0.5 step), saves, and returns the field's
  `data-leave-type-id`. `leave.spec.ts` uses it instead of its inline copy; `hr-role.spec.ts`
  drops the `/manage/allocations` redirect check.
- TASKS, CHANGELOG (`Removed`), audit §0 and DEPLOY-ASSISTANT banner updated.

**Actions outside the repo**
- Removed stale generated `.next/dev/types` (left by the last e2e dev server; it still listed
  the deleted route and broke `npm run build`'s typecheck).
- Branch deletion (`git branch -d` of 4 merged `codex/*` + `git push origin --delete` of 3) was
  refused by the session's auto-mode permission classifier. Nothing deleted. A read-only
  `git grep` for leftover references was refused too, so `allocateLeave` and `getAllEmployees`
  were not checked for remaining callers.

**Verification**
- `npm run build` passed (no `/manage/allocations` route), `tsc` clean, lint clean, 427 unit
  tests passed. e2e serial on the 9 specs that call `allocate()`: 21 passed (2.9 min).

**State left behind**
- Uncommitted on `main` with the rest of the cleanup. Branch deletion left to Amir.

**For the next agent**
- Check whether `allocateLeave` (`lib/actions/leave/balances.ts`) and `getAllEmployees`
  (`reference.ts`) still have callers; delete them if not. The SQL `allocate_leave` stays
  (seed and employee onboarding may use it).
- On-prem code stays on purpose (TASKS "Known gaps").

## 2026-10-04 — Owner answers: Vercel and on-prem retired, docs archived, `dist/` cleared

**Agent:** Claude Opus 5.5 via Claude Code
**Branch / HEAD at start:** `main` @ `eb5a913` (the cleanup below still uncommitted)
**Trigger:** Amir answered the audit's §4 questions: leave `updateDepartmentCode`; the Vercel demo
is retired; archive old docs and hide them from agents; the on-prem server is no longer used, so
clear the old release bundles.

**What changed**
- `docs/archive/` (new): journal entries 2026-07-29 → 2026-08-31 moved verbatim to
  `agent-log-2026-07-29-to-2026-08-31.md` (84 entry headings before and after the split); all of
  `docs/plans/`; `DEPLOY.md`, `DEPLOY-GUIDE.md`, `LOCAL_REDEPLOY.md`,
  `SECURITY-REVIEW-2026-07-30.md`; `README.md` index. AGENT-LOG keeps 2026-09-29 onward.
- Root `.ignore` lists `docs/archive/`: `rg` skips it by default (checked), `--no-ignore-dot`
  still finds it. CLAUDE.md read order and AGENTS.md say not to read it unless the user asks.
- Vercel: `vercel.json` deleted; mentions dropped from README, CLAUDE.md, PLAN, MEMORY, and code
  comments in `lib/appDate.ts`, `next.config.ts`, the calendar and home pages.
- On-prem: marked retired in CLAUDE.md, README, PLAN §7, REQUIREMENTS NFR-4, MEMORY pointers and
  the DEPLOY-ASSISTANT banner; TASKS loses its on-prem and Vercel sections and gains a "remove
  the on-prem code" item. Links to moved docs repointed in `deploy/RUNBOOK.md`,
  `deploy/setup-release.sh`, one spec; `deploy/prepare-local-arm64.sh` no longer sends readers to
  LOCAL_REDEPLOY.
- `docs/MEMORY.md`: added the ICU-translation lesson that only existed uncommitted in the
  `peaceful-williams-9c1cf9` worktree.

**Actions outside the repo**
- Deleted `dist/` (4.6 GB): eight `bj-erp-app-*.tar.gz` release bundles with checksums, two
  `bj-erp-installer-*.tar.gz`, and the unpacked `bj-erp-installer/`. Approved by Amir.
- Kept `.bj-deploy/` (Liara keys, password, backups; on-prem run evidence).

**Verification**
- `npm run lint`, `npx tsc --noEmit`: clean. `npm run test:unit`: 427 passed.
  `npm run test:deploy`: all passed. No e2e run: no app behaviour changed in this pass.

**State left behind**
- Everything uncommitted on `main`, together with the earlier cleanup.
- Waiting on Amir: `/manage/allocations` (link or remove); deleting the worktree, the merged
  branches, old Docker images and build cache.

**For the next agent**
- The paused Supabase Cloud project and the Vercel project still exist in those dashboards.
- The on-prem server's real data was never migrated to Liara (PLAN §7).

## 2026-10-04 — Cleanup applied: every audit item that needed no owner input

**Agent:** Claude Opus 5.5 via Claude Code
**Branch / HEAD at start:** main @ eb5a913 (audit report and its journal entry uncommitted)
**Trigger:** User: "Proceed with everything that doesn't require my input for now."

**What changed** (full list: `docs/CLEANUP-AUDIT-2026-10-04.md` §0; CHANGELOG "Codebase cleanup")
- Docs: tiered read order in `CLAUDE.md` and `AGENTS.md`; `docs/TASKS.md` rewritten as open items
  only (old statuses were wrong); CHANGELOG cleanup entry plus an `a0cb7b1` release heading;
  stale RUNBOOK "automating deploys" section and this file's `.superpowers` pointer fixed.
- `lib/actions/leave.ts` split into `lib/actions/leave/{requests,balances,reference,approvals,
  signatures,calendar,review,shared}.ts`, sliced by script so bodies moved verbatim. 33 importers
  and two test mocks repointed.
- `requireCaller({ anyOf, company })` in `lib/auth/context.ts` replaces three private
  caller-context helpers and inline guards in every action file except `refresh.ts`. Same
  messages; the db-error rule now matches any "… role required".
- Request forms share `request/_components/FormParts.tsx` + `useRequestForm.ts`; employee forms
  share `manage/employees/_components/EmployeeFormParts.tsx`; every date input is
  `components/PersianDateField.tsx`. All ids, test ids and strings unchanged.
- New `supabase/schema.sql` from `scripts/dump-schema.sh` (`npm run schema:dump`), pg_dump of the
  public and private schemas from `bj-erp-db-1`. Deterministic; one definition per function.
- Removed: 7 unused shadcn primitives, `setTeam`/`setManager`, `useViewport`, `gregorianToJalali`,
  `validateErrand`, `chainComplete`, `hourlyDayTotal`, smoke test, `next-themes`, 11 i18n keys,
  `assets/` (OFL moved to `app/fonts/`), 5 scaffold SVGs, `docker-compose.local.yml`.
  `config.toml` trimmed 416 → 13 lines (validated with the CLI). Package renamed `bj-erp`.
  `.superpowers/sdd/task-0a-report.md` untracked.
- `deploy/migrations` and `deploy/sql/seed.sql` replaced by symlinks into `supabase/`.
- Tests: `calendar-view-css` deleted (e2e covers it); source-text blocks dropped from
  `calendar-picker` and `request-signature`; the AppShell source check became a render test that
  fails when the refresh button is moved (sabotage-checked). e2e helpers consolidated into
  `_helpers.ts`; `ADMIN_CODE`/`ADMIN_PASSWORD` now read `E2E_ADMIN_*`.

**Actions outside the repo**
- Claude auto-memory rewritten (65 KB → 10 KB; added a client-data-handling rule).
- Read-only queries against the local `bj-erp-db-1`, `pg_dump` for the snapshot, and one
  throwaway `docker run --rm` to prove a symlinked bind mount resolves (55 migrations seen).
- e2e runs wrote and then reaped throwaway users on the local demo database, as usual.

**Verification**
- Baseline before changes: lint, tsc, 440 unit, deploy tests green; e2e 47 passed / 1 skipped.
- After: lint and tsc clean; 427 unit (the drop is the deleted dead and source-text tests);
  `test:deploy` and the three CI deploy scripts pass; `npm run build` passes; e2e checkpoints
  after the helper merge (18/18), the leave split + guard (47 passed / 1 skipped), the request
  forms (9/9) and the employee forms (15/15). Final full e2e on the finished tree: 47 passed /
  1 skipped (the deliberate `department.spec` skip) in 3.9 min, identical to the baseline.
- e2e here needs `-c <scratch config>` pointing at the installed headless shell
  (`~/Library/Caches/ms-playwright/chromium_headless_shell-1243`): `@playwright/test` 1.61.1 wants
  build 1228, which is not installed, and downloading it was not attempted.

**State left behind**
- All uncommitted on `main`. Suggested commits: docs (`[skip ci]`) separate from code; a code
  push deploys to Liara, whose VM was powered off on 2026-10-01.
- Local DB ledger lacks six migrations that were applied by hand (`20260818170001`…
  `20260819120001`). Harmless (idempotent) but a `bj-deploy update local` will re-run them.

**For the next agent**
- Owner decisions still open: audit §4, plus the local-disk deletions in TASKS. The old worktree
  `.claude/worktrees/peaceful-williams-9c1cf9` holds uncommitted edits; do not delete it unasked.

## 2026-10-04 — Codebase cleanup audit (report only)

**Agent:** Claude Opus 5.5 via Claude Code
**Branch / HEAD at start:** main @ eb5a913
**Trigger:** User asked for a full review of what can be cleaned up so build agents read less, with
a report in `docs/` and no codebase changes yet.

**What changed**
- New `docs/CLEANUP-AUDIT-2026-10-04.md`: ranked findings, decisions needed, phased plan.
- This entry. Nothing else was edited.

**Actions outside the repo**
- None. The auto-memory staleness (finding A8) was reported, not fixed.

**Verification**
- Read-only measurements: `git ls-files` inventories, importer greps, an unused-export scan,
  i18n key comparison, line-overlap checks, `cmp` of `deploy/migrations` against
  `supabase/migrations`, and `tsc --listFilesOnly`.
- No build or tests were run; nothing executable changed.

**State left behind**
- Uncommitted: the report and this entry. The user will choose which phases to apply.

**For the next agent**
- Do not start cleanup until the user approves. §4 of the report lists the open decisions.

## 2026-10-04 — CLAUDE.md audit and onboarding-doc refresh

**Agent:** Claude Opus 5.5 via Claude Code
**Branch / HEAD at start:** main @ 6bd31dc
**Trigger:** User asked for a CLAUDE.md audit against the codebase, then said to apply every proposed edit.

**What changed**
- `CLAUDE.md` — fixed claims that were wrong: roles now include `hr`; calendar is Persian-only
  (since 2026-08-05); the self-hosted stack has no Storage service; dropped the stale test counts
  (165/26, real numbers 440/28); the status block was dated 2026-06-30; the demo admin login applies
  only to the seed (Liara password is in `.bj-deploy/liara/admin-password`); `^` ranges, not pinned.
  Merged the hosting paragraph into the stack table and resolved the contradiction about the on-prem
  target. Layout now lists `(print)/`, `app/api/health`, `deploy/`, `.github/workflows/`,
  `tests/deploy/`, the scripts, `docs/MEMORY.md`, `DEPLOY-ASSISTANT.md`, `plans/`. Removed the
  `.superpowers/sdd/progress.md` pointer: that folder is gitignored and its last entry is from 2026-06-30.
  Added `test:deploy`, `cleanup:e2e`, `E2E_BASE_URL`. New **Gotchas** section: a push to main deploys
  to Liara (`[skip ci]` for docs); `deploy/migrations/` is a stale copy; a new enum value needs its own
  migration; `types.ts` is hand-edited. New working agreement (user wording): propose a one-line
  CLAUDE.md update when you find a non-obvious convention, gotcha, or command.
- `AGENTS.md` — read order now starts with `docs/AGENT-LOG.md`; dropped the `progress.md` pointer.
- `README.md` — test badge/table 440 unit · 28 e2e; Persian-only calendar (intro, requests,
  self-service, stack); `hr` role; no Storage; added `test:deploy` and `cleanup:e2e` scripts.

**Actions outside the repo**
- none

**Verification**
- Each claim was checked against the repo: `npx vitest list` → 440; 28 `tests/e2e/*.spec.ts`;
  55 files in `supabase/migrations/` against 38 in `deploy/migrations/` (last commit 4e6b6bf,
  2026-08-04); `deploy/docker-compose.yml:42` bind-mounts `./migrations`; neither compose file has a
  storage service and the code never calls `.storage`; `docs/CHANGELOG.md:437` (Persian-only);
  `docs/PERMISSIONS.md:14` (`hr`). No build or test run: these are doc-only edits.

**State left behind**
- Uncommitted on `main` (CLAUDE.md, AGENTS.md, README.md, this file). If this gets committed, use `[skip ci]`.

**For the next agent**
- The tracked `deploy/migrations/` copy is still in the repo. Removing it or regenerating it is a
  separate decision, because `deploy/docker-compose.yml` mounts it when the stack runs from the repo.

## 2026-10-01 — Authorized overnight VM power-off test

**Agent:** Codex · **Branch / HEAD:** main @ ee706ca
**Trigger:** User requested startup/persistence checks, then power-off from the terminal for approximately one day.

- Live Docker service is enabled/active; all five running containers have `unless-stopped` restart
  policies. Database volume `bj-erp_db-data` and certificate volume `bj-erp_caddy-data` persist.
- System state running, 9.7 GiB disk free, public health OK, deployed code a0cb7b1. No running
  deployment workflow, release lock free, backup service inactive and no dump/update process.
- Backup timer enabled with `Persistent=true`; missed schedule should catch up after boot.
  Docker shutdown timeout 90 seconds. Public certificate expires 2026-10-07 12:43:04 UTC.
- Pre-shutdown boot ID: `c326baf3-d306-4272-a815-b8ef42874dc0`.
- Acquired release lock, rechecked backup inactivity, issued `systemctl poweroff --no-block`
  via root SSH on port 32222. Command returned `Graceful power-off accepted`.
- Follow-up SSH 32222 and HTTPS 443 connection attempts both timed out after shutdown.
  The OS accepted power-off; Liara control-plane power/billing status was not independently queried.
- Did not manually stop/remove containers, alter restart policies, delete volumes or disable CI.
- User must start the VM through Liara's control plane. No automatic wake-up was scheduled.
  After boot verify new boot ID, all services, public TLS/login, database persistence and timer;
  auto-start is configured but the actual cold-start test remains pending.
- Avoid ordinary main pushes while offline; CI deployment would fail. This journal-only commit
  uses `[skip ci]` and makes no application changes.

## 2026-10-01 — Approved recovery bundle copied to the Mac

**Agent:** Codex · **Branch / HEAD:** main @ 8de4396
**Trigger:** User explicitly approved the private recovery copy and requested only the location of the admin password.

- Confirmed the local admin-password file exists with mode 600; did not read or display its contents.
- Verified the VM checksum, then copied `recovery-20261001T023025Z.tar.gz` and its checksum from
  `/root/bj-liara/` into the Mac's ignored `.bj-deploy/liara/backups/` directory.
- Local SHA-256 matches the original. Verified database dump, environment, roles and TLS archive
  members are present without extracting or displaying sensitive contents. Archive is 200099 bytes.
- Backup directory mode 700, files mode 600; `git check-ignore` confirms Git exclusion.
- Marked the initial off-VM copy complete. This is a snapshot from before the first automatic
  deployment, not a new database backup and not a scheduled offsite backup service.
- No live application, credential or database changes. Documentation-only commit skips CI.

## 2026-10-01 — Final screenshot readiness check

**Agent:** Codex · **Branch / HEAD:** main @ 1bbe539

Visual inspection caught a desktop screenshot taken during a loading skeleton despite
passing DOM assertions. Strengthened the temporary Playwright script to wait for a visible
heading and zero skeletons, reran all seven checks successfully, and inspected the fully
rendered desktop screenshot. No application/runtime code changed.

## 2026-10-01 — Push-to-main deployment verified and handoff

**Agent:** Codex
**Branch / HEAD at start:** main @ a0cb7b1
**Trigger:** User resumed after the usage limit reset.

**What changed**
- Updated runbook, task checklist and changelog from preparation to verified deployment.
- This final documentation-only handoff is committed with `[skip ci]`; the running code release
  remains `a0cb7b1bc6534724b8c7f43ad016ee71c8981b12` and no runtime changes follow it.

**Actions outside the repo / verification**
- Enabled `LIARA_DEPLOY_ENABLED=true` and pushed reviewed fixes in a0cb7b1 with prior authorization.
- GitHub run https://github.com/AmirNcode/bj-erp/actions/runs/36806814730 passed all build/test
  stages and the actual SSH transfer/apply deployment through the approved `bj-deploy` account.
- Resumed after the usage interruption: VM `DEPLOYED_RELEASE` matches a0cb7b1, all five services
  have stayed up for about 12 hours, database healthy, public HTTPS health HTTP 200.
- Post-deployment Playwright smoke passed all seven checks: protected-page redirect, invalid-password
  rejection, fresh-admin login, session reload, admin employee list, mobile overflow and browser errors.
  Browser plugin not available; used existing Playwright/Chromium with full TLS verification.
  Navigation-canceled prefetch requests occurred, but no browser runtime or console errors.
  Screenshots: `/private/tmp/bj-liara-home-desktop.png` and `/private/tmp/bj-liara-home-mobile.png`.
- Daily timer remains enabled; last backup service result success. Controlled image rollback and
  isolated full database restore already passed (previous entry). Private recovery bundle exists on VM.
- Working tree was clean before final documentation updates. Client server remains untouched.

**State left behind / next steps**
- Application ready for testing at https://62.60.191.132. Username `admin`; unique password is in
  ignored mode-600 `.bj-deploy/liara/admin-password` on the Mac and the private root file on Liara.
- Ordinary pushes to main now build/test/deploy automatically; infrastructure changes still require
  explicit installation/verification before the deploy guard accepts them.
- Approval review previously blocked copying the database/env/TLS recovery bundle to the Mac.
  No approval reply received, so no transfer attempted. User approval for that exact copy remains open.
- Daily backups are VM-local; ongoing offsite backup scheduling is not configured. Client IT supplies
  the eventual hostname; real employee rollout and first scheduled certificate renewal remain untested.

## 2026-09-30 — Liara live rollout, deployment access and recovery rehearsal

**Agent:** Codex
**Branch / HEAD at start:** main @ 490491a
**Trigger:** User authorized continuing deployment and explicitly approved the dedicated GitHub credential/account, preferring `bj-deploy`.

**What changed**
- Corrected public Caddy identity stamping in both targets: `{client_ip}` replaces the invalid
  `{http.request.client_ip}`; removed the same-header deletion that ran after the set operation.
  Earlier journal claims based on text assertions did not prove actual forwarding. Added real
  isolated Caddy 2.8.4/2.11.4 runtime tests, including duplicate spoofed headers and private forwarding.
- Liara serves public HTTPS over HTTP/1.1 with `Connection: close`: direct HTTP/2 redirect chains
  and some reused HTTP/1.1 connections stalled from Canada, while local/tunneled requests worked.
  This compatibility workaround passed normal Chromium with full TLS verification; upstream cause
  remains unconfirmed. It adds public handshake overhead and should be revisited with the domain.
- Workflow uses approved `bj-deploy` and runs the real forwarding regression test.
- Added the pinned-image GraphQL wrapper recovery helper; updated deployment/recovery documentation.

**Actions outside the repo**
- Installed release `490491a48ae550c5a3f577181e548b29c5c8e607` on Liara: fresh schema,
  baseline organization and unique admin; no demo users. Client server was untouched.
- Installed rsync/sudo from Debian's Liara mirror. Docker apt repository returned 403 on update;
  existing tested Docker runtime remained usable. Production IP TLS issuance and restart passed.
- Created `bj-deploy` with restricted SSH key and sudo permission only for the root deployment
  entrypoint plus a 40-hex SHA. Unrelated sudo commands were denied. Stored dedicated key/known-host
  secrets in GitHub's `liara` environment, restricted to main. Deployment switch remained false
  through these checks; enabling and testing the real push workflow is next.
- Applied verified gateway configuration live. Auth burst probe returned 30 invalid-login responses
  followed by ten 429 responses despite forged identity headers.
- Browser desktop/mobile QA passed login, invalid-password rejection, persisted session, admin
  employee list, mobile overflow and console checks. A failed diagnostic assertion exposed the
  initial test password in tool output: rotated it immediately, revoked old sessions, sanitized
  subsequent error reporting and reverified login. Final credential is only in private ignored files.
- Enabled daily backup timer and completed isolated restore of the full dump. The pg_graphql wrapper
  ACL failed initially because its extension-member DDL is absent from pg_dump; excluded ONLY that
  TOC ACL, then recreated the exact wrapper/grants/membership. Corrected the test's scoped PGPASSWORD
  after its helper unset it. All 33 public/Auth/migration-ledger tables matched counts/content hashes.
  Disposable restore container/volume were removed; live data was not replaced.
- Prepared private `/root/bj-liara/recovery-20261001T023025Z.tar.gz`, including database, roles,
  environment and TLS state. First streamed-script attempt consumed stdin; reran a saved script.
  Automatic approval review blocked copying this sensitive bundle to the Mac; explicit approval
  was requested and remains pending. No off-VM copy has been made.
- Controlled failing-image rehearsal completed: `update.sh` rejected `liara-rollback-check`,
  restored image 490491a, and public health recovered. Test image/archive removed. Database
  migrations are NOT rolled back by image recovery; no new migrations were introduced in this test.

**Verification**
- GitHub Linux build run 36802135762 succeeded before manual first installation.
- Real forwarding tests, unit rate-limit tests, lint, Compose checks and diff whitespace checks passed.
- Desktop/mobile browser smoke passed with TLS verification; all five services running, DB healthy.
- Latest live Liara Caddyfile SHA-256 matches the reviewed local file; public health returns HTTP 200.
- Backup restore and controlled app-image rollback both passed.

**State left behind / next steps**
- Commit/push these fixes, enable auto-deploy, then verify the complete GitHub SSH deployment.
- Recovery bundle copy awaits the separate explicit sensitive-transfer approval. Daily backups
  currently remain on the VM; do not describe them as ongoing offsite protection.
- Client IT still owns the future company hostname. First actual IP-certificate renewal has not
  occurred yet; preserve certificate storage and keep HTTP reachable for renewal.

## 2026-09-30 — First Linux CI run identifies BSD stat test portability

**Agent:** Codex
**Branch / HEAD at start:** main @ 6ab2265
**Trigger:** Continued the authorized Liara release build.

**What changed / verification**
- Pushed the reviewed release preparation as `6ab2265`. GitHub run `36781967711`
  passed npm install, runtime audit, lint and all 440 unit tests.
- Deployment tests then failed because GNU `stat -f` emitted filesystem data
  before the BSD-format probe failed. Replaced three permission checks with a
  silent probe and platform-compatible formatter; retained all assertions.
- Public HTTPS remained trusted after restarting the preflight gateway. The
  service-image pull was interrupted before completion and is being retried.
- CI deployment access approval remains pending. No app/database deployment yet.

## 2026-09-30 — Prepare explicit Liara release and verify public IP HTTPS

**Agent:** Codex
**Branch / HEAD at start:** main @ 77c33ea
**Trigger:** User authorized proceeding with the reviewed deployment plan, including the reviewed local changes and commit/push.

**What changed**
- Added the explicit `liara` Compose target, Caddy 2.11.4 public IP TLS configuration,
  clean-commit Linux release packaging, serialized release application, and daily backup timer.
- Added a push-to-main GitHub Actions build/test/artifact workflow with deployment gated
  by `LIARA_DEPLOY_ENABLED`; its dedicated account/environment secrets are not installed yet.
- Installer accepts the committed app image tag and skips internal-CA instructions for Liara.
  Existing client/local targets remain separate. Updated recovery command overlay paths.
- Reconciled the hosting overview and Liara runbook with the accepted one-VM architecture;
  clarified backup archive checks versus actual recovery rehearsal and rate-limit comments.
- Preserved and included the previously reviewed rate-limit, Docker-context and dependency fixes.

**Actions outside the repo**
- Verified current Caddy/ACME and GitHub Actions documentation through Context7 and official
  sources; reviewed Supabase changelog without blindly upgrading the pinned compatible stack.
- Started temporary `bj-liara-tls-preflight` on Liara 80/443. Let's Encrypt staging issuance
  passed, followed by production issuance using persistent volume `bj-erp_caddy-data`.
  A public curl returned the expected preparation HTTP 503 with TLS verification result 0.
  Caddy logged successful issuance and a future renewal window; actual renewal has not occurred.
- Fetched origin; local HEAD and origin/main have zero divergence.
- Automatic approval review rejected creation of the dedicated sudo deployment account and
  transfer of its new private key to GitHub. That command did not execute. Asked the user for
  approval of that exact privilege/credential setup; other preparation continued independently.

**Verification**
- Real Caddy config validation passed; real Compose merge publishes only 80/443 with all
  application/database/API services private, Linux amd64, and persistent certificate storage.
- `npm run test:deploy`, five rate-limit environment cases, Liara configuration test,
  shell syntax checks and `git diff --check` passed.
- Prior clean install, 440 unit tests, lint, production build and zero-vulnerability npm audit
  remain recorded above. The GitHub Linux image build and fresh stack verification are next.

**State left behind / next steps**
- This entry precedes the authorized release commit/push. Public TLS is ready; the VM still
  serves only the preparation response. No application database has been created yet.
- Await dedicated CI access approval, build the Linux artifact, install the fresh stack,
  verify login/session behavior and backup restoration, then enable and test push deployment.
- No commands were run against the client's existing server. Never delete the production
  certificate volume when replacing the temporary preflight container with the real gateway.

## 2026-09-30 — Review after all three fixes; remaining Liara deployment work

**Agent:** Codex
**Branch / HEAD at start:** main @ 77c33ea
**Trigger:** User requested a review of completed work and the next steps.

**Review findings**
- Re-read the rate-limit changes, compatibility fallback, Docker exclusions,
  dependency manifest/lockfile, tests, and deployment scripts. No new blocking
  regression identified in the three completed fixes.
- Public deployment configuration is still unfinished: Caddy retains
  `local_certs` / `tls internal`, and `bj-deploy` defaults to the existing
  client's host, port, user, and directory. An explicit Liara target and public
  HTTPS configuration must be prepared before using these deployment commands.
- `docs/DEPLOY-LIARA.md` correctly marks the original PaaS/one-click proposal
  as superseded, but CLAUDE, README and other overview documents still describe
  it as current. Reconcile these before committing the release.
- No `.github/workflows` directory exists. GitHub Actions deployment and runner
  connectivity are still unimplemented/unverified.
- Remaining validation: actual Linux amd64 application image and fresh stack,
  public TLS issuance/renewal, login/session behavior and gateway header handling,
  backup/restore and rollback, then push-triggered deployment.

**Actions outside the repo**
- Read-only SSH to `liara-bj-vm`: hostname `debian-bj-vm`, Docker 29.8.1,
  Compose 5.5.1, about 14 GiB free disk, 1931 MiB RAM with 1530 MiB available,
  2047 MiB swap unused, UFW active allowing 32222/80/443, NTP synchronized.
- `docker ps` returned no running containers; `/opt/bj-erp` was empty. No
  server configuration changed and no application was deployed.

**Verification**
- `git diff --check` passed; locked Next.js version remains 16.3.8.
- Inspected the saved successful audit result (zero vulnerabilities) and prior
  turn's clean install, 440 unit tests, lint, deployment tests and production
  build results. Did not repeat those checks because the implementation had
  not changed since they passed.
- An initial local read used nonexistent glob paths and failed in zsh; retried
  with explicit existing deployment files. No edit resulted from that failure.

**State left behind / next steps**
- Review only; this journal is the sole file edited this turn. Existing local
  changes remain uncommitted. No commit, push, workflow or deployment performed.
- Next: reconcile architecture docs and prepare an explicit Liara deployment
  target with public HTTPS; build/verify the Linux artifact; commit the reviewed
  release when asked; install the fresh database and app; verify public access,
  backups and resource usage; then implement/test GitHub Actions deployment.

## 2026-09-30 — Fix 3 complete: dependency security updates; paused at user request

**Agent:** Codex
**Branch / HEAD at start:** main @ 77c33ea
**Trigger:** User said "Proceed" to the third review fix under the one-fix-at-a-time instruction.

**What changed**
- `package.json` — pinned Next.js and eslint-config-next to 16.3.8, up from
  16.2.9. npm preserved their production/development dependency categories.
- `package-lock.json` — compatible security updates via `npm audit fix`
  without `--force`, including sharp 0.35.5, PostCSS 8.5.23 (Next.js) / 8.5.28
  (tooling), nanoid 3.3.19, Tailwind 4.3.3, Vitest 4.1.11, and undici 7.30.0.
  Only the two Next.js entries changed in the manifest; other declared ranges
  and React 19.2.4 remained unchanged. No application logic changed.
- Updated CHANGELOG and TASKS, including the older unresolved audit item.

**Actions outside the repo**
- Queried current Next.js documentation through Context7 (`/vercel/next.js`),
  npm metadata, and official release/security advisory pages. The registry's
  current stable version and audit recommendation were 16.3.8, newer than the
  earlier review's 16.3.7 recommendation; existing React and Node versions satisfy
  its peer/engine requirements.
- Refreshed audit reports in `/private/tmp/bj-audit-{before,after}-fix3.json`.
  Before: 12 vulnerable groups (1 critical, 7 high, 4 moderate); after: zero.
- No remote server actions, database changes, deployment, commit, or push.

**Verification**
- `npm install --save-exact next@16.3.8 eslint-config-next@16.3.8` succeeded;
  compatible `npm audit fix` resolved the remaining reports without forcing majors.
- `npm ci` succeeded from the updated lockfile (565 packages installed).
- Full `npm audit --json` succeeded: zero vulnerabilities across production and
  development dependencies. Linux x64 musl SWC/sharp/libvips optional packages
  are represented in the lockfile; this was metadata verification, not a Linux build.
- `npm run test:unit`: all 47 files / 440 tests passed under Vitest 4.1.11.
- `npm run lint`, `npm run test:deploy`, and the five real Compose rate-limit
  interpolation cases all passed.
- Production `npm run build` passed under Next.js 16.3.8 with placeholder public
  Supabase config and telemetry disabled: compilation, TypeScript, and 44 static
  pages. Authorized worker-port access was used because the earlier sandbox build
  failed to bind its worker. No Docker image build or live-backend e2e this turn.
- `git diff --check` passed.

**State left behind**
- All three review fixes are now complete locally and uncommitted; the existing
  local work is preserved. The Liara app has not been deployed.
- Paused after fix 3 as explicitly requested. Local node_modules and .next reflect
  the updated dependencies; build output uses placeholder public configuration.

**For the next agent**
- Wait for the user to continue. Commit only when asked. Resume the Liara
  deployment preparation after this pause, preserving the pending local work.

## 2026-09-30 — Fix 2 complete: private Docker inputs excluded; paused at user request

**Agent:** Codex
**Branch / HEAD at start:** main @ 77c33ea
**Trigger:** User said "Proceed to next one" under the one-fix-at-a-time instruction.

**What changed**
- `.dockerignore:4` — replaced the root-only `.env*` pattern with `**/.env*`
  and added `**/backups/` and `**/.bj-deploy/`. This excludes database dumps,
  deployment run metadata, and nested configuration such as `deploy/.env`
  before the production Dockerfile's `COPY . .` reaches them.
- Updated CHANGELOG and TASKS to record fix 2 as complete. Dependency updates
  remain pending; fix 3 was not started.

**Actions outside the repo**
- Started local Docker Desktop after the first check reported its daemon was
  unavailable. No remote server actions, deployment, commit, or push.
- Created `/private/tmp/bj-docker-context-check.sh`, a synthetic-only check;
  temporary fixture and export directories were removed by its exit trap.

**Verification**
- Fetched Docker ignore-pattern documentation through Context7 (`/docker/docs`).
- `bash /private/tmp/bj-docker-context-check.sh` ran a `FROM scratch` / `COPY .`
  Buildx build with local output and networking disabled. Passed: nine private
  fixtures absent, seven required app/build/deployment inputs retained.
- Fixtures covered root/nested backup and state directories, root env files,
  `deploy/.env`, and a deeper env file. No real dumps or credentials were sent
  to the builder. No full app build was needed for an ignore-only change.
- `git diff --check` passed.

**State left behind**
- Changes remain uncommitted with the existing local work preserved. Nothing
  deployed. Paused after fix 2 as requested.

**For the next agent**
- Wait for the user to continue before fix 3 (vulnerable dependencies and
  focused revalidation). Do not deploy or start that fix during this pause.

## 2026-09-30 — Fix 1 complete: rate-limit units; paused at user request

**Agent:** Codex
**Branch / HEAD at start:** main @ 77c33ea
**Trigger:** User authorized the review fixes one at a time and explicitly requested a pause after each.

**What changed**
- Renamed the active setting to `RATE_LIMIT_TOKEN_PER_IP_5_MINUTES` in Compose, installer,
  and env example. Default remains 300, preserving the actual GoTrue v2.170.0 rate (one
  request/second sustained), with its fixed burst capacity 30.
- Compose retains old `RATE_LIMIT_TOKEN_PER_IP_HOUR` as a fallback. Installer backfills
  the new name from the old numeric value, without unit conversion; new name wins.
- Corrected RUNBOOK, CHANGELOG, repo MEMORY, and server-client comment: unset/missing header
  skips the pinned Auth limiter, not a peer-IP fallback. Clarified NAT sharing and burst behavior.
- Updated the existing unit capacity check to use five-minute units and added real Compose
  interpolation checks in `tests/deploy/rate-limit-config.test.sh` (no daemon required).
- TASKS records the remaining fixes and the user's explicit one-fix-at-a-time instruction.

**Verification**
- Six focused login-rate-limit unit tests passed.
- Five Compose cases passed: default, legacy numeric preservation, new setting, new-over-old
  precedence, empty-new fallback. All existing deployment assistant tests passed.
- Bash syntax checks and `git diff --check` passed. No full app rebuild needed: runtime
  TypeScript logic was not changed; only a comment in the server client changed.

**State left behind**
- Local changes only; no server modifications, deployment, commit, or push.
- Fix 2 (Docker build exclusions) and fix 3 (dependency upgrades) NOT started.
- Paused: wait for the user to explicitly say continue before starting fix 2.

## 2026-09-30 — Local-change review before Liara deployment

**Agent:** Codex
**Branch / HEAD at start:** main @ 77c33ea
**Trigger:** User requested a quick review and inclusion of local changes if they look good.

**Review findings**
- Client-IP forwarding matches the configured Caddy/GoTrue header; pinned Caddy 2.8.4 accepts
  the configuration. No app-code regression identified by lint/unit/build checks.
- Rate-limit units are incorrect in the new variable/docs/test: inspected GoTrue v2.170.0
  `internal/api/options.go` lines 48-51: rate is `RateLimitTokenRefresh/(60*5)`, burst 30.
  Therefore configured 300 is per FIVE MINUTES (~3600/hour sustained), not per hour. Initial
  commentary suggesting 300/hour was insufficient for the office was explicitly corrected.
- The same pinned version's `middleware.go` lines 59-79 skips rate limiting when the configured
  header is absent (or when RateLimitHeader is unset). Comments claiming a peer-IP fallback
  are wrong for this version. Public header stamping is essential; internal listener stays private.
- Pre-existing `.dockerignore` omits backups/ and .bj-deploy/; local database dumps are present
  and `deploy/Dockerfile` uses COPY . . in its builder. These must be excluded before packaging.
  Did not send backups to a new builder or claim they exist in the final runtime image.
- Runtime audit: 1 critical, 3 high, 1 moderate vulnerable dependency groups (5 total).
  Next 16.2.9 is affected; audit recommends 16.3.7, with transitive nanoid/PostCSS/sharp fixes.
  Reviewed official GHSA-2xp9-vwfh-vxw4 (AVIF optimization RCE, patched 16.3.3); actual
  exploitability was not tested and Windows-only findings do not apply to Debian.
- Supabase changelog reviewed; do not switch to current self-host gateway/Auth defaults while
  retaining this pinned stack. Existing historical PaaS documentation still needs reconciliation.

**Verification / actions outside the repo**
- `npm run test:unit`: 47 files, 440 tests passed.
- `npm run lint`: passed. `npm run test:deploy`: all deployment assistant tests passed.
- `git diff --check`: passed. Caddy 2.8.4 `caddy validate`: passed in a temporary container.
  First invocation omitted the caddy executable and failed; corrected invocation succeeded.
- Production `npm run build` with placeholder public config passed (compile, TypeScript, 44
  static pages) after authorized retry; initial sandbox blocked Turbopack's local worker port.
- Audit report: `/private/tmp/bj-audit.json`. Version-specific GoTrue review sources in
  `/private/tmp/bj-gotrue-{api,middleware,options,token}.go`.

**State left behind**
- Review did not meet the user's all-good condition for deployment. No app/config/dependency
  edits, package build, remote changes, commit, or push. Only this journal appended.
- Recommend correcting rate-limit naming/semantics and tests, excluding private build inputs,
  updating vulnerable dependencies, then revalidating before including local changes in deployment.

## 2026-09-30 — Liara VM provisioned and verified after reboot

**Agent:** Codex
**Branch / HEAD at start:** main @ 77c33ea
**Trigger:** User installed the dedicated public key and asked to continue setup after a usage interruption.

**What changed**
- `docs/DEPLOY-LIARA.md` now begins with the agreed single-VM architecture and verified server
  preparation. Original PaaS/one-click proposal retained as explicitly historical, not executable
  guidance for this VM. Other older architecture references need reconciliation before release.
- `/Users/amir/.ssh/config` alias now uses `~/.ssh/bj_liara_deploy`, IdentitiesOnly, publickey
  first and password fallback. Backup `config.before-liara-key-20260930` saved next to it.

**Actions outside the repo**
- Verified root login with the user-installed key on `62.60.191.132:32222`. Initial inventory:
  Debian 12, 1931 MiB RAM, no swap or Docker, ~17 GiB free, SSH only public listener.
- Installed ca-certificates, curl, gnupg, UFW and Chrony through existing Liara Debian mirrors.
  Chrony replaced systemd-timesyncd, which reported unsynchronized; Chrony synchronized.
- Installed Docker Engine 29.8.1, Compose 5.5.1, Buildx 0.37.1 and containerd 2.3.6 through
  Docker's signed Debian apt repository, configured in `/etc/apt/sources.list.d/docker.sources`.
- Created `/swapfile` (2 GiB, 600), enabled through `/etc/fstab`, swappiness 10 through
  `/etc/sysctl.d/90-bj-swap.conf`. Created empty `/opt/bj-erp` and `/var/backups/bj-erp` at 700.
- Configured Docker local logging, 10m/max-file 3. Direct Docker Hub smoke test failed HTTP 403
  from its CloudFront layer endpoint. Added official `https://docker-mirror.liara.ir` mirror,
  preserving log settings and backing up `/etc/docker/daemon.json.before-mirror`; test passed.
- Enabled UFW deny incoming/allow outgoing, permitting TCP 32222,80,443 for IPv4/IPv6. Used
  a 180-second rollback timer, verified a fresh SSH session, then cancelled the timer.
  Docker-published ports bypass UFW: future Compose must keep all non-gateway ports private.
- Applied available Debian userspace updates with `--force-confold`, preserving SSH settings.
  Logs: `/var/log/bj-bootstrap-upgrade.log`. Installed remaining linux-image-amd64 update
  explicitly; log `/var/log/bj-bootstrap-kernel.log`. Old kernel retained for recovery.
- Rebooted the empty VM through a transient systemd timer; reconnect and service checks passed.

**Verification**
- Dedicated SSH key and alias authenticate noninteractively; `sshd -t` passed after updates.
- `docker run --rm hello-world` passed using Liara mirror; cached smoke test also passed after
  reboot with `--pull=never`. Engine/Compose version queries succeeded.
- Reboot runs kernel `6.1.0-53-amd64`; ssh/docker/chrony active and enabled, swap 2 GiB present,
  UFW rules preserved, NTPSynchronized=yes. `dpkg --audit` empty, no remaining apt upgrades.
- Final disk: root ~4.3 GiB used / 14 GiB available; /boot 121 MiB used / 274 MiB available.
- Documentation whitespace check passed before final journal update; no application code changed.

**State left behind / next steps**
- No BJ app/database/secrets/TLS certificate/GitHub workflow deployed. No commits or pushes.
- Existing local changes preserved; user clarification pending whether first deployment uses
  published GitHub main or local app changes after review. Do not silently choose a revision.
- Next stages: validate chosen source; adapt public HTTPS with reliable renewal and private
  DB ports; initialize fresh DB/admin; configure and test GitHub main deployment separately.
- Local temporary provisioning scripts: `/private/tmp/bj-liara-install-docker.sh` and
  `/private/tmp/bj-liara-baseline.sh` (one-time guarded steps; not general-purpose rerun scripts).

## 2026-09-30 — Prepared dedicated Liara deployment key

**Agent:** Codex
**Trigger:** User is logged into the fresh VM and asks what to prepare for deployment.

**Actions outside the repo / verification**
- Generated an Ed25519 key at `/Users/amir/.ssh/bj_liara_deploy` with no passphrase for
  unattended setup/deployment, refusing to overwrite an existing file. Private key remains
  on BigMac with ssh-keygen's owner-only permissions; only the public key was displayed.
- Prepared commands for the user to append its public key to root's authorized_keys through
  their existing authenticated session. Remote installation and login are not yet verified.
- Reviewed installer/Compose prerequisites: Docker Engine and Compose plugin. Current
  runbook still describes the older PaaS plus full Supabase plan; session-authorized plan
  is the minimal Compose stack on the existing Debian VM. Runbook needs updating before use.

**State left behind**
- Alias remains password-only until the new key is installed and independently verified.
- No VM packages installed, remote changes made, credentials removed, commit, or push.
- Next: user installs public key, then agent verifies access, inventories VM, and prepares
  Docker/Compose, memory/disk settings, public HTTPS, and the fresh app stack.

## 2026-09-30 — Added Liara SSH alias on BigMac

**Agent:** Codex
**Trigger:** User confirmed password login succeeded and requested `ssh liara-bj-vm`.

**Actions outside the repo / verification**
- Added a host-specific block to `/Users/amir/.ssh/config`: alias `liara-bj-vm`, root,
  `62.60.191.132:32222`, password authentication, public-key authentication disabled for
  this alias to avoid prompting for the forgotten local key passphrase.
- Preserved existing entries and saved `/Users/amir/.ssh/config.before-liara-20260930061402`.
- Verified resolved values with `ssh -G liara-bj-vm`; no remote login attempted this turn.

**State left behind**
- Alias ready on BigMac; server password still required. No password stored in config.
- No server changes, commit, or push. Dedicated deployment key remains to be configured.

## 2026-09-30 — Enabled Mac Tailscale for phone access

**Agent:** Codex
**Trigger:** User requested turning on Tailscale to SSH into their Mac from their phone.

**Actions outside the repo / verification**
- Confirmed this host is `BigMac`; Tailscale was stopped. UI access timed out and sandboxed
  CLI could not load preferences; authorized CLI access worked.
- Ran `tailscale up` successfully. Verified backend `Running`, IPv4 `100.109.151.61`.
- Read-only TCP check to `127.0.0.1:22` succeeded; existing SSH listener is available.
- No SSH configuration, tailnet access policy, or remote Liara server changes.

**State left behind**
- Tailscale is enabled on BigMac; phone-to-Mac authentication has not been tested.

## 2026-09-30 — Liara port 32222 reachable; key authentication incomplete

**Agent:** Codex
**Trigger:** User requested SSH access after support changed the server's SSH port.

**Actions outside the repo / verification**
- SSH at `62.60.191.132:32222` responds. Initial strict host verification stopped because
  this port had no local known-host entry. Scanned its ED25519 public host key into
  `/private/tmp/bj-liara-32222-known-hosts` and compared the fingerprint with the user's
  earlier successful login screenshot: `SHA256:dQ/aBnbVlBAvVYWu/E6lVTAakBXMzklnoijY78wBTM0`.
- Retried with strict verification using that file and `~/.ssh/id_ed25519`. Verbose SSH
  confirms the server accepts the public key but the client sends no signed authentication
  packet. Batch login ends in `Permission denied (publickey,password)`.
- Authorized `ssh-add -l` shows only the unrelated mint key loaded. Explicit macOS
  `UseKeychain=yes` did not resolve login. No password/passphrase requested or exposed.
- Remote `hostname; id; uptime` checks did not execute because authentication failed.
- User-provided support reply confirms upstream port-22 restrictions, inaccessible remote
  console from abroad, powered-off plan billed at one third, and separate IPv4 billing.

**State left behind**
- Network access is restored on the new port; successful authenticated access and GitHub
  runner reachability remain unverified. User may need to unlock their registered key locally.
- No server changes, deployment, commit, or push. Only this journal updated in the repo.

## 2026-09-29 — Overnight VM shutdown and access blockers

**Agent:** Codex
**Trigger:** User confirmed no VPN, failed fresh `ssh bj`, unavailable Liara remote console,
and asked whether overnight shutdown saves credit.

**Findings / state left behind**
- Reviewed current Liara IaaS signal documentation and Context7: Settings supports graceful
  shutdown, start, reboot, and a distinct force power-off action.
- Current IaaS documents retrieved did not confirm the discounted powered-off billing rate
  or treatment of IPv4. PaaS marketing's one-third rate is insufficient evidence for this VM.
- Recommended support clarification for billing and inaccessible remote console; no shutdown,
  server changes, or deployment performed.

## 2026-09-29 — Liara SSH reachable through client server

**Agent:** Codex
**Trigger:** User connected from the client server to Liara after direct Mac SSH timed out.

**Findings / state left behind**
- User screenshot confirms successful Liara root login and SSH listening on IPv4/IPv6 port 22.
- User confirmed the working first hop uses their existing `ssh bj` alias.
- Two read-only SSH attempts through that alias from the agent failed with a connection reset
  at `5.201.190.184:2222`, before authentication or remote command execution.
- Direct Mac reachability remains unresolved; the evidence does not identify the blocking network.
- Next step is a user-terminal ProxyJump test through `bj`, using the Mac's existing key.
- No server configuration, credentials, application data or deployment changed.

## 2026-09-29 — Liara VM created; SSH TCP timeout diagnosis

**Agent:** Codex
**Trigger:** User created `bj-vm` and reported SSH timeout to `62.60.191.132:22`.

**Actions outside the repo / findings**
- Network-authorized `liara vm list` confirmed `bj-vm`, `standard-base-g2`, `debian-12.9`,
  state `CREATED`, power `POWERED_ON`.
- `nc -vz -G 8 62.60.191.132 22` timed out from the Mac, independently reproducing the
  TCP reachability failure. No authentication or SSH host-key verification was reached.
- Network-authorized `route -n get 62.60.191.132` showed interface `en0`, gateway `192.168.2.1`.
  This does not rule out router/network filtering. Initial sandbox route read was denied.
- Read Liara's official `iaas/details/console` documentation: دورنما provides console access
  independently of SSH, useful to inspect server startup/service status. Requested VPN/proxy
  and creation-timing clarification; no response yet at the time of this entry.
- Need console-side SSH listener/service checks to distinguish guest configuration from
  upstream filtering. No reboot, firewall change, SSH configuration change or deployment.

**What changed / state left behind**
- Journal only. VM exists, SSH is unreachable from the Mac, provisioning of BJ is not started.
- Checkout showed Debian 12.9, 1 key, 1 CPU/2 GB/20 GB, and 10% VAT; user-facing monthly
  estimate corrected to 1,842,500 tomans before traffic (~49 days of credit).
- No tests run; this turn performed read-only infrastructure diagnostics.

## 2026-09-29 — Corrected PaaS versus VM creation flow

**Agent:** Codex
**Trigger:** User's creation screenshots showed base/silver/gold tiers, 2 GB at 2,300,000
tomans/month, a private network `bj-network` and app URL `bj-app.liara.run`.

**Findings / guidance**
- These indicators match Docker PaaS, rather than the intended IaaS VM. Advised not to finish
  that wizard. No paid resource creation was confirmed by the user or inspected this turn.
- Rechecked Liara official Docker one-click and Debian VM quick-start docs. Offered the direct
  `سرور مجازی ابری` -> `ایجاد سرور مجازی ابری` path with Debian, 1 CPU/2 GB/20 GB and the SSH
  public key; Docker can be installed afterward. No need to create a PaaS app for this plan.
- Existing network/app wizard state left untouched. No deletion, creation or deployment.

**What changed / verification**
- Journal only; documentation review and screenshot interpretation. No code changes or tests.
- Sources: https://docs.liara.ir/one-click-apps/docker/quick-start/ and
  https://docs.liara.ir/iaas/debian/quick-start/.

## 2026-09-29 — Verified access before user creates the Liara VM

**Agent:** Codex
**Branch / HEAD at start:** `main` @ `77c33ea`; pre-existing changes preserved.
**Trigger:** User installed/logged into Liara CLI and requested exact manual setup steps.

**What changed**
- Journal only. No server, SSH authorization, credential, workflow or GitHub setting changed.

**Actions outside the repo / verification**
- `liara --version`: `@liara/cli/9.5.1 darwin-arm64 node-v24.13.0`.
- Read `liara` / `account` / `vm` / `vm list` help. Network-authorized `liara vm list`
  reached the service and reported `You didn't create any VMs yet` for the active account.
- Sandbox `gh auth status` initially reported invalid tokens; network-authorized verification
  succeeded with active account `AmirNcode` and repo/workflow scopes. Do not ask the user to
  reauthenticate on the basis of the first sandbox result.
- `gh repo view AmirNcode/bj-erp --json nameWithOwner,viewerPermission,visibility,defaultBranchRef`
  confirmed ADMIN permission, PUBLIC visibility and default branch `main`.
- Confirmed existing `~/.ssh/id_ed25519.pub` and matching private-key file. Read only its
  fingerprint; no private-key contents read or displayed. SSH usability/passphrase and remote
  server identity remain unverified until the VM exists.
- Context7 confirmed Docker one-click is a Debian IaaS VM, with SSH public-key input during
  creation. CLI account login is separate from SSH authorization.
- No build or application tests; no deployment performed.

**State left behind / next agent**
- User to create Docker one-click VM with 1 CPU / 2 GB RAM / 20 GB SSD and add the Mac public
  key, then supply VM identifier/IP and Connection-tab username/port. Verify host identity and
  SSH access before configuration. Existing client server remains untouched.
- Accepted plan: fresh database; public-IP HTTPS until company subdomain; top up credit as needed;
  prepare GitHub Actions deployment for pushes to main. Workflow not created or enabled yet.

## 2026-09-29 — GitHub auto-deploy feasibility for the Liara VM

**Agent:** Codex
**Branch / HEAD at start:** `main` @ `77c33ea`; existing uncommitted work preserved.
**Trigger:** User asked whether connecting GitHub can deploy pushes to `main` automatically.

**What changed**
- Journal only; no workflow, repository setting, secret, infrastructure or application change.
- Confirmed subsequent user decisions: smallest VM with top-up if needed, fresh database,
  public-IP HTTPS initially, company subdomain later.

**Findings / proposed setup**
- Git remote is `https://github.com/AmirNcode/bj-erp.git`; no local `.github` directory/workflows.
- Context7 Liara docs describe native GitHub integration under PaaS applications. No native
  IaaS Docker Compose auto-deployment integration was verified. Use GitHub Actions for the VM.
- Proposed flow: push `main` -> source checks -> build the app image on a GitHub-hosted Linux
  runner -> transfer a versioned image archive and migration manifest over verified SSH ->
  server lock, backup, pending migrations, app replacement and health check. Building on GitHub
  supersedes the earlier Mac-only build proposal for automatic releases and spares the 2 GB VM.
- Existing `deploy/bj-deploy` / `remote-job.sh` / `update.sh` provide much of the release logic,
  but have client defaults and TTY/sudo handling that require explicit Liara/noninteractive
  adaptation. Do not point an unattended workflow at the current default client target.
- GitHub concurrency and the existing server lock should prevent overlapping updates; do not
  cancel an in-progress database deployment. Image rollback does not undo forward migrations.
- Keep deployment credentials in GitHub Actions secrets and verify the SSH host key. Confirm
  GitHub-runner-to-VM connectivity during setup. Do not upload database backups as CI artifacts.

**Actions outside the repo**
- Read official Liara and GitHub Actions documentation through Context7 and web; no account
  connection, GitHub setting change, workflow dispatch, SSH or deployment.

**Verification / state left behind**
- Read current Git remote, local workflow inventory and deployment scripts. No tests run for
  this research-only turn. Auto-deployment is proposed, not configured or verified.
- VM address/access and initial installation still need establishing before activation.
- Sources: https://docs.liara.ir/paas/docker/how-tos/deploy-app/ and
  https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments.

## 2026-09-29 — Liara runbook review, budget and test-server sizing

**Agent:** Codex
**Branch / HEAD at start:** `main` @ `77c33ea`; pre-existing uncommitted work preserved.
**Trigger:** Review `docs/DEPLOY-LIARA.md` against current provider documentation and recommend
a deployment path using 3,000,000 tomans of Liara credit, with a step-by-step walkthrough.

**What changed**
- This journal entry only. No application, runbook, or deployment configuration changed.
- User clarified: start fresh; approximately 200 total employees, unlikely simultaneous use;
  testing and frequent updates before real use; ideally credit lasts 2–3 months; company domain
  is controlled by client IT and should be connected later. Existing Liara resources not confirmed.

**Findings**
- Verified https://liara.ir/pricing/ through web and the rendered base-tier pricing page:
  IaaS 1 CPU/2 GB/20 GB is 1,475,000 tomans/month; 2 CPU/4 GB/40 GB is 2,650,000;
  public IPv4 adds 200,000. PaaS 1 GB base is 1,300,000. Thus the runbook's 4 GB VM +
  1 GB PaaS app costs 4,150,000/month before extras (~22 days of credit). Single 2 GB VM
  is 1,675,000 (~54 days); single 4 GB VM is 2,850,000 (~32 days). These are estimates,
  not account quotes; traffic, snapshots/backups, domain and any applicable taxes are excluded.
- Budget-oriented proposal: adapt the existing five-service stack for a single 2 GB test VM,
  building app images on the Mac, with monitoring and a later upgrade if needed. This is a
  proposal, not an approved architecture change or production capacity guarantee. Liara documents
  a Debian Docker one-click VM at https://docs.liara.ir/one-click-apps/docker/quick-start/.
  Resizing requires shutdown/backup per https://docs.liara.ir/iaas/details/change-plan/.
- `docs/DEPLOY-LIARA.md:139` uses `|| break`, then continues to seed/bootstrap after a failure;
  it has no per-file transaction or durable migration ledger. Existing
  `deploy/lib/migrations.sh:68` already pairs each migration and checksum ledger row atomically.
- One-click Supabase's exact release is unverified. Current upstream differs from runbook
  assumptions: Envoy is now the default gateway, and the current stock configuration expects
  `/auth/v1` in `API_EXTERNAL_URL`. Do not apply those changes blindly to the pinned legacy
  stack. Sources: Supabase changelog entries `48048-self-hosted-supabase-envoy-becomes-the-default-api-gateway-b`
  and `47093-self-hosted-supabase-api-external-url-to-include-auth-v1`.
- Preserve the guide's correct concerns about build-time public env/CSP, upload exclusions,
  private backend ports, default-secret verification and trustworthy client-IP rate limiting.
  Its destructive empty-DB reset is not a general secret-rotation procedure.
- The single-VM path still needs public TLS, installer/update targeting and clean release
  packaging reviewed. Current Caddy uses `local_certs`/`tls internal`; client release helpers
  must not accidentally target the existing on-prem deployment. Pending source changes and
  dependency checks must be reviewed before packaging any public release.
- No VM-provided `liara.run` hostname was verified; PaaS documents one. A domain can also be
  deferred using a public-IP certificate: Let’s Encrypt's 2026-01-15 and 2026-03-11 announcements
  confirm IP certificates and Certbot >=5.4 webroot support, with ~6-day validity and automated
  renewal required. This is not configured or tested here.

**Actions outside the repo**
- Read official Liara and Supabase docs using Context7, web, public HTTP downloads, and an
  in-app browser pricing page. Read local Docker status and resource metrics only.
- No Liara purchase, server creation, SSH, migration, deployment, DNS change or data transfer.

**Verification**
- Local `docker stats --no-stream`: app 138.3 MiB, DB 122 MiB, Auth 11.8 MiB,
  REST 103.2 MiB, gateway 56.37 MiB; total ~431.7 MiB at near-idle. Local ARM64 containers
  are not a Liara capacity/load test. Initial sandbox stats access failed; approved read succeeded.
- Initial sandbox public HTTP DNS lookup failed; approved public fetch succeeded. Some web
  documentation opens also failed; direct official markdown fetches supplied the contents.
- No builds, unit/e2e tests or dependency audit run: this was a deployment-design review.

**State left behind / next agent**
- No commit or push. Budget tolerance (top-up versus hard limit/account-specific price) and
  temporary-address preference asked asynchronously; not yet answered when this entry was written.
- Complete those choices before resource creation. Guide is still the original proposal;
  do not interpret this review as having deployed or validated it on Liara.

## 2026-09-29 — Hosting decision recorded: Liara replaces the on-prem server (docs only)

**Agent:** Claude Opus 5.5 via Claude Code
**Branch / HEAD at start:** `main` @ `77c33ea` (same session as the entry below; earlier sessions'
uncommitted work untouched)
**Trigger:** Amir: client IT could not create a subdomain with the company's own domain on the
company's own servers, so a third-party server (Liara) will deploy and host the web app going
forward; still in testing phase. Asked for the docs to record the change.

**What changed** (documentation only — no code, config, or `deploy/` file)
- `docs/DEPLOY-LIARA.md` — **new.** Runbook from the walkthrough below: why, shape, rejected
  options, Phase 1 (Supabase one-click VM), Phase 2 (NEXTJS app), updating, before-real-users,
  open decisions, sources. Marked "decided, not yet executed"; proposed `liara.json` /
  `.liaraignore` contents are in it but the files were **not** added.
- `CLAUDE.md` — hosting status paragraph; stack table Hosting rows (Liara current; Vercel +
  on-prem legacy); layout lists `DEPLOY-LIARA.md`; "How to run" deploy pointer.
- `README.md` — stack table, portability bullet, deployment paragraph, docs table.
- `docs/PLAN.md` — §2 wording; §7 rewritten as the decision record (why, shape, runbook, legacy,
  open decisions).
- `docs/REQUIREMENTS.md` — NFR-4 wording (Liara host; `deploy/` remains a working target).
- `docs/DEPLOY.md` — retitled as index + legacy; banner pointing to the Liara runbook.
- `docs/DEPLOY-ASSISTANT.md`, `docs/DEPLOY-GUIDE.md` — banners: on-prem only; the "until IT creates
  the production subdomain" line now says the subdomain plan was dropped.
- `docs/TASKS.md` — hosting note at top; new "Liara hosting (2026-09-29) — testing phase"
  checklist; note that the on-prem release-pipeline ☐ items apply only while that server stays.
- `docs/MEMORY.md` — lesson "Hosting moved to Liara…" (tooling path, rate-limit caveat, Liara
  traps); Pointers updated.
- `docs/CHANGELOG.md` — `[Unreleased]` entry for the decision, noting the 2026-08-31 rate limiting
  does not carry over.
- `deploy/RUNBOOK.md` deliberately **not** touched: it ships inside the client installer bundle
  and is written for client IT.

**Actions outside the repo**
- None. No Liara resource created, no server touched.

**Verification**
- `git diff --check` clean after the edits (see below). Nothing built or run; doc-only change.

**State left behind**
- All uncommitted on `main`, alongside the earlier sessions' uncommitted rate-limit and journal work.
- The previous entry's "production with real data is the client's call" question is now answered:
  Liara is the host (testing phase).

**For the next agent**
- Open decisions, recorded in `docs/TASKS.md` and the runbook: which domain serves `api.`, and
  what happens to the on-prem server `10.10.10.50` and its data.
- The runbook is untested. Whoever runs it first must correct it with what the VM actually has
  (Supabase version, container names, published ports, whether secrets were generated).
- The 2026-08-31 login rate-limit code (`proxy.ts`, `lib/supabase/server.ts`, Caddy) is built for the
  on-prem gateway; on Liara the forwarded `x-bj-client-ip` header is visitor-controlled.

---

## 2026-09-29 — Liara (liara.ir) deployment walkthrough — research only

**Agent:** Claude Opus 5.5 via Claude Code
**Branch / HEAD at start:** `main` @ `77c33ea` (earlier sessions' uncommitted rate-limit + journal
work left untouched)
**Trigger:** Amir, sitting on Liara's "create app" screen (14 platform tiles), asked where to
start deploying this app on Liara.

**What changed**
- `docs/AGENT-LOG.md` only — this entry. No code, config, or deploy file changed.

**Actions outside the repo**
- None against the client server; no Liara account action. Read Liara docs via Context7
  (`/liara-cloud/docs`) and `https://docs.liara.ir/llms/<path>.md` (index:
  `https://docs.liara.ir/all-links-llms.txt`); Supabase self-hosting docs via Context7.

**Findings (Liara docs as of 2026-09)**
- PaaS has no Docker Compose support — one app per service, joined by env vars + private network
  (`paas/docker/how-tos/deploy-docker-compose`). An app's private network cannot be changed after
  creation.
- Managed PostgreSQL offers only PostGIS/pgvector — not a stand-in for the Supabase roles/`auth`
  schema that GoTrue and PostgREST need.
- Supabase exists as a one-click app (برنامه‌های آماده), but it is a Debian **cloud VM** running the
  stock Supabase compose in `/opt/supabase-project`, Studio/Kong on `http://<IP>:8000`, no TLS or
  domain. Liara documents only `DASHBOARD_PASSWORD` as auto-generated — JWT secret/keys unverified.
- Stock self-host compose ships the custom-access-token hook env commented out (Supabase
  `docker/CONFIG.md`). Without it `lib/auth/context.ts:48-56` falls back to one `user_roles` query
  per request and the FR-34 language claim is missing — degraded, not broken.
- NEXTJS platform: `npm install` (devDeps too) → `npm run build` → `npm start`; console env vars
  are visible at build time; `liara.json` `{"platform":"next","port":3000,"next":{"nodeVersion":"22"}}`
  (Node 20/22/24); build location `iran|germany`.
- The console zip upload applies no ignore file. The CLI honours `.liaraignore`, which, when
  present, replaces `.gitignore`/`.dockerignore`. Repo `.dockerignore` does **not** list `backups/`
  (employee PII dumps) or `deploy/` (holds `deploy/.env`).
- `next start` with `output: 'standalone'` only warns (`node_modules/next/dist/server/next.js:227`),
  so Liara's `npm start` works unchanged.
- `supabase` devDependency 2.110.0 ships its binary via optionalDependencies — no GitHub download
  during `npm install`, so the default iran build location should cope.
- CSP `connect-src` is derived from `NEXT_PUBLIC_SUPABASE_URL` at build time (`next.config.ts:9-15`),
  so both public vars must exist before the first Liara build, and changing them needs a redeploy.

**Recommendation given to Amir**
- Demo/staging: Supabase one-click VM (زحل, 4 GB) + NEXTJS app. Same topology as the old
  Vercel + Supabase Cloud demo, so no code change. Steps: verify/replace default secrets while the
  DB is empty; bind 8000/8443/5432/6543 to 127.0.0.1; nginx + certbot for `api.<domain>` proxying
  only `/auth/v1/` and `/rest/v1/`; auth env (`DISABLE_SIGNUP`, autoconfirm, hook); apply
  `supabase/migrations/*` + `supabase/seed.sql` + `deploy/sql/bootstrap_admin.sql` as
  `supabase_admin` (mirrors `install.sh` `pgexec`); then the NEXTJS app with both `NEXT_PUBLIC_*`
  vars set before the first build and `liara deploy` from the CLI.
- Production with real data was flagged as the client's decision (CLAUDE.md: production = company's
  own servers). If chosen, run this repo's `deploy/` stack on a Liara cloud server instead; that
  needs a public-ACME mode in the Caddyfile (today `tls internal`).

**Verification**
- Nothing built or deployed. Findings above come from the cited docs and local source. No Liara
  resource was created, so the one-click's Supabase version, secret generation, container names,
  and published ports are unverified — the walkthrough tells Amir to check each on the VM.

**State left behind**
- No repo change besides this entry. Offered, not done: add `liara.json` + `.liaraignore`, and
  write the walkthrough up as `docs/DEPLOY-LIARA.md`.

**For the next agent**
- Do not copy `GOTRUE_RATE_LIMIT_HEADER: X-BJ-Client-IP` onto a Liara VM as-is: nothing stamps or
  strips that header there, and `proxy.ts` / `lib/supabase/server.ts` forward any inbound copy, so
  a client could rotate it to dodge the `/token` limit. Needs app + nginx changes first.
- On Liara all server-side session refreshes leave from the app's egress IP, so GoTrue's per-IP
  `/token` bucket is shared by every user — tune before real users.
- `scripts/seed-demo.mjs:35-36` hard-codes `admin` / `Admin!2026`; a public demo seeded with it
  must change that password afterwards.

---

*Entries from 2026-07-29 to 2026-08-31 are archived in
`docs/archive/agent-log-2026-07-29-to-2026-08-31.md`. Read them only when the user asks. Before
2026-07-29 nothing was journalled: use `docs/CHANGELOG.md` and `git log`.*
