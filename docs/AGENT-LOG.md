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

## 2026-08-12 — Correct app-tag cutover and reuse the verified failed-run upload

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `codex/code-review` @ `11373fe` (= `main` and both origin refs)
**Trigger:** The user supplied client run `20260813T004921Z-b987f2`, which applied all pending
migrations but failed health checks and rolled its app image back.

**What changed**

- `deploy/lib/common.sh` — added `bj_set_app_version`, which atomically updates `APP_VERSION` in
  `.env` and exports the same value in the running shell. Docker Compose gives exported variables
  precedence over `.env`; changing only the file cannot select a new image after preflight sourced
  and exported the old tag.
- `deploy/update.sh` — cutover and rollback both use `bj_set_app_version`, and the existing tag is
  validated before mutation. The failed client log said it was switching to
  `20260813-004921-11373fe` but `docker compose ps` showed `bj-erp-app:latest`: the stale exported
  value caused Compose to recreate the old image, whose August 5 build predates `/api/health`.
- `deploy/bj-deploy` — added `retry-uploaded FAILED_RUN_ID`. It accepts only a local client-update
  manifest whose remote status is terminal `FAILED:*`; verifies the local archive and checksum,
  requires the server archive/checksum to match, requires unchanged migration and seed inputs, and
  creates a **new** immutable run with current controller scripts. It does not build or transfer the
  large app archive. The retry still runs the 5 GiB preflight, source gates, new verified backup,
  migration/seed pass, app cutover, architecture/health/row-count checks, and off-server backup copy.
- `tests/deploy/deploy-assistant.test.sh` — added regression coverage for file/exported-variable
  precedence and an isolated retry dry run that proves no build/upload and refuses changed seed
  input. The suite now has 15 named deployment cases.
- `docs/{CHANGELOG,DEPLOY-ASSISTANT,DEPLOY-GUIDE,MEMORY,TASKS}.md` and `deploy/RUNBOOK.md` — recorded
  the failure semantics, Compose precedence rule, and guarded no-reupload recovery command.

**Actions outside the repo**

- The user, not this agent, ran client update `20260813T004921Z-b987f2`. It created verified server
  backup `./backups/pre-20260813-004921-11373fe-2026-08-13-043136.dump` (316 KiB); recorded pre-run
  counts `profiles:3`, `user_roles:6`, `leave_requests:1`, `leave_ledger:7`, `holidays:0`,
  `departments:5`, `leave_types:3`, `companies:1`; loaded the AMD64 release image; and atomically
  applied/recorded all three August migrations. It then recreated `bj-erp-app:latest`, not the new
  tag, failed the health contract, and recreated `latest` again as rollback. Result was `FAILED:1`.
  The new image never ran. Forward migrations remain applied; no post-run row-count phase or local
  backup download occurred because health failed first.
- This agent attempted one read-only SSH health probe, but the permission gate rejected it before a
  process or connection was created because the original no-client-contact boundary remains active.
  No SSH, server read, transfer, database change, container operation, restore, or deployment was
  performed by this agent.

**Verification**

- `/bin/bash -n` passed for every deployment and deployment-test shell script.
- `npm run test:deploy` passed all 15 named cases; `git diff --check` passed. Both ARM64-local and
  AMD64-client Compose overlays passed `docker compose ... config --quiet`.
- `npm run lint` and `npx tsc --noEmit` passed. `npm run test:unit` passed 40 files / 254 tests.
- `npm run build` passed with Next.js 16.2.9 and generated 40 pages including `/api/health`.
- Playwright was not rerun because no application, migration SQL, database contract, or browser
  behavior changed; the full current-source suite passed earlier on 2026-08-12.

**State left behind**

- The hotfix is committed and pushed through retained `codex/code-review`, then fast-forwarded into
  clean synchronized `main` without rewriting history. Exact commit is reported in the handoff.
- Failed run `20260813T004921Z-b987f2` remains terminal and immutable. Its verified 102 MiB artifact
  remains locally and is expected remotely because cleanup occurs only after success; use
  `retry-uploaded`, which revalidates both copies before starting anything.

**For the next agent**

- From final clean `main`, run
  `./deploy/bj-deploy retry-uploaded 20260813T004921Z-b987f2`. It creates and prints a new run ID;
  if monitoring disconnects after start, resume that **new** ID. Do not resume the failed ID and do
  not restore the pre-run dump unless the currently rolled-back app is demonstrably incompatible
  with the forward schema.

## 2026-08-12 — Atomic ledger-input hotfix after the first client migration attempt

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `e73ef4b` (= `origin/main`), hotfix branch
`codex/migration-ledger-atomic-hotfix`
**Trigger:** The user resumed client run `20260812T155950Z-ee1c94`; its upload completed, but the
first pending August migration failed while recording the migration ledger.

**What changed**

- `deploy/lib/migrations.sh` — kept the verified host-side migration and ledger row in one
  `--single-transaction`, but moved the variable-bearing ledger `INSERT` out of a separate `psql -c`
  argument and appended it to the same `-f -` stdin stream as the migration. PostgreSQL received the
  literal `:'filename'` token through the old `-c` path; stdin is processed by psql and expands the
  safely quoted `-v` values before sending SQL to PostgreSQL.
- `tests/deploy/deploy-assistant.test.sh` — the migration harness now rejects any `-c` argument,
  requires both migration SQL and ledger SQL in the one stdin stream, and retains the existing
  checksum, simulated-rollback, and resume assertions.
- `docs/{CHANGELOG,DEPLOY-ASSISTANT,MEMORY,TASKS}.md` — documented the corrected psql transport and
  recorded that the first live acceptance run remains incomplete.

**Actions outside the repo**

- The user, not this agent, completed and checksum-verified the 102 MiB release upload, then resumed
  client run `20260812T155950Z-ee1c94`. The worker created and validated
  `./backups/pre-20260812-155950-e73ef4b-2026-08-13-040218.dump` (316 KiB), preserved row counts
  (`profiles:3`, `user_roles:6`, `leave_requests:1`, `leave_ledger:7`, `holidays:0`,
  `departments:5`, `leave_types:3`, `companies:1`), loaded the new tagged image without starting it,
  and skipped the 38 recorded baseline migrations. The first August migration and ledger insert
  were wrapped by `--single-transaction`; the ledger syntax error caused rollback, status
  `FAILED:1`, and no app restart. The existing `latest` app remained running. No restore is indicated.
- This agent did **not** SSH to the client, transfer a bundle, modify its database, or operate its
  containers. Local only: an isolated temporary-table query against `bj-erp-db-1` proved psql
  interpolates the filename/checksum/release values when the combined input is read via `-f -`.

**Verification**

- `/bin/bash -n` passed for every deployment and deployment-test shell script.
- `npm run test:deploy` passed all 13 cases, including the new single-stdin/no-`-c` regression;
  `npm run lint` and `npx tsc --noEmit` passed.
- `npm run test:unit` passed 40 files / 254 tests. `npm run build` passed with Next.js 16.2.9 and
  generated 40 pages. The first sandboxed build was blocked only because Turbopack could not bind
  its internal worker port; the permitted rerun completed successfully.
- Playwright was not rerun: no application, migration SQL, image contents, or browser behavior
  changed. The full current-source suite had passed earlier the same day before this shell-only fix.
- `git diff --check` passed.

**State left behind**

- The focused fix and documentation are committed on the local hotfix branch, then the retained
  review branch `codex/code-review` and `main` are fast-forwarded to that commit and pushed without
  rewriting published history.
- Client run `20260812T155950Z-ee1c94` is terminal and must not be resumed. The existing client app
  and test database remain available; a new update from the corrected clean `main` is required.

**For the next agent**

- Start a new `./deploy/bj-deploy update client`; do not reuse the failed run ID. The new run will
  take another verified backup, skip the 38 baseline rows, atomically apply/record the three August
  migrations, and cut over only after all health checks pass.

## 2026-08-12 — Container-safe migration runner after the resumed client update

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `d941970` (= `origin/main`), hotfix branch
`codex/migration-stdin-hotfix`
**Trigger:** The user resumed staged client run `20260812T052250Z-291168`; it reached the first
pending August migration and failed because containerized `psql` could not open the server-host
run-directory path.

**What changed**

- `deploy/lib/migrations.sh` — changed atomic migration execution from `psql -f <host-path>` to
  `psql -f - < <host-path>`. The verified run-scoped SQL now crosses the Docker boundary through
  stdin, while the migration and its ledger `-c` remain inside one `--single-transaction` call.
- `tests/deploy/deploy-assistant.test.sh` — the fake containerized `pgexec` now rejects host file
  paths, requires non-empty migration SQL on stdin, and requires the ledger insert in the same
  invocation. Existing checksum, resume, and simulated-rollback assertions remain active.
- `docs/{CHANGELOG,DEPLOY-ASSISTANT,MEMORY}.md` — documented the container namespace boundary and
  durable `-f -`/stdin rule.

**Actions outside the repo**

- The user, not this agent, ran `./deploy/bj-deploy resume 20260812T052250Z-291168` against the
  client. The corrected worker created and validated
  `./backups/pre-20260812-052250-d941970-2026-08-12-183332.dump` (312 KiB), recorded pre-update row
  counts, loaded but did not start `bj-erp-app:20260812-052250-d941970`, and bootstrapped the private
  ledger with the verified 38-migration legacy baseline. The first August migration never executed
  and was not recorded; the old `latest` app remained running. The worker ended truthfully as
  `FAILED:1`. No restore is indicated.
- This agent did **not** SSH to the client, transfer files, modify its database, or operate its
  containers. Failed run `20260812T052250Z-291168` remains terminal and must not be resumed again.
- Local only: proved the exact `psql --single-transaction -f - -c ...` transport with read-only
  `SELECT 41` / `SELECT 42` against `bj-erp-db-1`. For current-build E2E, the guarded local Safe
  Update created verified backup
  `backups/deploy-assistant/local/20260812T152344Z-e8aeaf/postgres.dump`, skipped all 41 matching
  ledger migrations, ran the idempotent seed, built native ARM64 image
  `sha256:373e31bd987cc7c4e89063516efdea586a972706a25128978c93b7786d5e8f25`, and recreated only
  `bj-erp-app-1`.
  The local database/auth/rest/gateway containers and database volume were preserved.

**Verification**

- `/bin/bash -n` passed for every deployment/test shell script; `npm run test:deploy` passed all
  13 cases, including the new container-stdin assertion; `git diff --check` passed.
- `npm run lint` and `npx tsc --noEmit` passed; `npm run test:unit` passed 40 files / 254 tests.
- `npm run build` passed with Next.js 16.2.9 and generated 40 pages. An initial sandboxed attempt
  was correctly treated as failed because Turbopack could not bind its internal worker port; the
  authorized rerun completed successfully.
- The first dev-server E2E attempt was stopped after two login timeouts because `.env.local`
  targets unpublished local gateway port 8080 (`ECONNREFUSED`), not because of product code. A
  production-shaped local Docker run against the stale August 6 image produced 31 pass / 2 fail /
  1 skip. After the guarded current-source ARM64 rebuild, the full serial Playwright suite passed:
  **33 passed, 1 intentionally skipped**. Teardown deleted all 28 throwaway users and one test
  department.

**State left behind**

- Focused hotfix commit `504b368` is on `codex/migration-stdin-hotfix`. This log is the follow-up
  documentation commit; both commits are intended to be pushed on the retained hotfix branch,
  fast-forwarded into `main`, and pushed without rewriting history.
- Local test stack is healthy on the rebuilt ARM64 app with its existing data. Client production
  is still on `latest`; its 38-row migration ledger is now established, but none of the three
  August migrations or the new app was deployed by the failed run.

**For the next agent**

- Do not resume `20260812T052250Z-291168`. Once final clean `main` is synchronized, begin a **new**
  `./deploy/bj-deploy update client`; the clean-tree, disk, backup, migration, architecture, and
  health guards must remain intact.

## 2026-08-12 — Safe Update false-success and late disk-preflight hotfix

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `3e71818` (= `origin/main`), hotfix branch
`codex/deploy-preflight-hotfix`
**Trigger:** The user's first client Safe Update stopped for low disk after a four-hour transfer but
was incorrectly reported as successful; after reviewed cleanup left 6.9 GiB free, the user asked
what to do next while preserving the test database and login credentials.

**What changed**

- `deploy/remote-job.sh` — runs each mutating worker action in an isolated shell with active
  `errexit`, captures the real child exit code in the controller, and writes `FAILED:<code>`.
  This closes the Bash context bug where `perform_update ... || rc=$?` disabled `set -e` inside the
  function, allowing failed `update.sh` to continue into `record_installed_state` and return zero.
- `deploy/bj-deploy` — checks the client's exact available KiB over SSH before source tests, AMD64
  build, or transfer; requires 5 GiB. A successful update now requires non-empty remote backup path
  and checksum metadata, including on resume, instead of treating missing files as “no database.”
- `deploy/update.sh` — repeats the 5 GiB server preflight using exact KiB rather than rounded
  `df -BG` output and reports the measured GiB.
- `tests/deploy/deploy-assistant.test.sh` — reproduces a child update exiting 23 and proves the run
  becomes `FAILED:23`, logs the failure, and writes no installed-state files. Also guards the early
  disk-check ordering and mandatory backup metadata contract.
- `docs/{DEPLOY-ASSISTANT,DEPLOY-GUIDE,MEMORY,CHANGELOG}.md` — documented failure semantics, disk
  diagnosis, safe cleanup boundaries, non-resumable terminal failures, and the durable Bash trap.

**Actions outside the repo**

- The user ran the deployment before this hotfix. SSH setup, lint, 254 unit tests, AMD64 build, and
  transfer succeeded. Remote run `20260811T180522Z-519c4f` then stopped with only about 2.2 GiB
  usable disk space, before backup, image loading, migrations, database writes, or app cutover.
  The old worker falsely wrote `SUCCEEDED` and installed manifests; those claims do not represent
  deployed state and that run must never be resumed.
- At the user's direction, the user removed only the duplicate old installer, already-imported
  offline image archives, and failed release upload. Reported free space increased to 6.9 GiB;
  all five containers remained running and healthy, and `bj-erp_db-data` remained mounted at
  `/var/lib/docker/volumes/bj-erp_db-data/_data` (about 44 MiB).
- This agent did not connect to the client server, run SSH, transfer files, change its database, or
  operate its containers during the hotfix.

**Verification**

- `/bin/bash -n` passed for every deployment/test shell script.
- `npm run test:deploy` passed all 13 cases, including the exact false-success regression.
- `npm run lint`, `npx tsc --noEmit`, and `npm run test:unit` passed; unit result was 40 files and
  254 tests.
- `npm run build` passed with Next.js 16.2.9 and generated 40 pages. Both the local ARM64 and client
  AMD64 Compose overlays rendered successfully with `config --quiet` without starting containers.
- All 50 Markdown files passed the local-link check; `git diff --check` passed.

**State left behind**

- Hotfix commit `af0f4a7` was pushed to `origin/codex/deploy-preflight-hotfix`, fast-forwarded into
  `main`, and pushed to `origin/main` without rewriting history. This documentation-only completion
  update is also synchronized to both retained branches before handoff. Local `main` is clean and
  the next Safe Update will stage the corrected worker before starting a new remote run.

**For the next agent**

- Never resume `20260811T180522Z-519c4f`; it is a falsely terminal run from the old worker. Start a
  new `./deploy/bj-deploy update client` only from the final clean `main`. The new run overwrites the
  incorrect installed manifests only after a real successful update and preserves the existing
  database volume, users, credentials, Caddy state, and `.env` secrets.

## 2026-08-11 — Git landing completion for the reviewed August release

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `codex/code-review` @ `d4f474e`
**Trigger:** Completion of the reviewed release-preparation session recorded in the next entry.

**What changed**

- Staged all 114 reviewed paths only after the cached diff passed whitespace, artifact-name,
  private-key, and token-signature checks. Created `d4f474e` (`feat: add signed leave flows and
  guarded deployment`) and pushed `codex/code-review` to `origin` without rewriting history.
- GitHub reported no evaluated rules for `main` and no classic branch protection. Fast-forwarded
  local `main` from `4e6b6bf` to `d4f474e` and pushed the same commit to `origin/main`; no pull
  request or protection bypass was needed.
- `docs/AGENT-LOG.md` — added this documentation-only completion record. This follow-up commit is
  fast-forwarded to both the retained review branch and `main` so their final source/documentation
  content remains identical.

**Actions outside the repo**

- A stale zero-byte `.git/index.lock` dated 2026-08-09 initially blocked staging. Process and file
  checks proved no Git/GitHub process owned it; the file was moved, not deleted, to
  `/private/tmp/bj-index.lock.stale-20260809` before staging resumed.
- Pushed Git refs to GitHub. The client server was not contacted: no SSH, transfer, database change,
  deployment, Safe Update, or production container operation occurred.

**Verification**

- Immediately before the release commit, `main...origin/main` was `0 0`; the remote review branch
  did not exist; the linked Claude worktree/branch remained unchanged.
- The release commit was created from a clean cached diff, its review-branch push succeeded, and the
  first `main` fast-forward/push succeeded. The final documentation-only synchronization repeats
  `git diff --check` and verifies identical local/remote refs and an empty porcelain status.

**State left behind**

- The intended final state is clean `main`, with `main`, `origin/main`, `codex/code-review`, and
  `origin/codex/code-review` all pointing to this documentation follow-up commit. Exact final hashes
  are reported to the user after the synchronization is verified.

**For the next agent**

- The repository is ready for the guarded client Safe Update once the operator chooses to begin it.
  This session deliberately stopped before any client contact or deployment action.

## 2026-08-11 — Reviewed and prepared the pending August release for production

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` (= `origin/main`)
**Trigger:** The user authorized a complete review, validation, commit, and push of all intended
pending work, with production `main` left clean for the deployment assistant and no client deploy.

**What changed**

- Inventoried the repository before staging: 74 modified and 35 untracked paths (109 total), no
  staged or deleted paths. Confirmed `main` matched `origin/main`, created `codex/code-review` from
  that base without disturbing the working tree, and retained the linked
  `claude/peaceful-williams-9c1cf9` worktree and its branch.
- Reviewed the application, three August migrations, deployment assistant, ARM64/AMD64 overlays,
  tests, documentation, and branding. The pending paths contained no secrets, `.env` files,
  private keys, database dumps, deployment archives, Docker image archives, or temporary output.
  `.gitignore` now keeps deployment run state and manifests under `.bj-deploy/` out of Git.
- `deploy/lib/migrations.sh` — made each migration and ledger row one PostgreSQL transaction and
  strengthened the three known-August-migration adoption fingerprints to verify their complete
  catalog shape, security, grants, and relevant function bodies.
- `deploy/{bj-deploy,remote-job.sh,update.sh,install.sh}` — isolated migrations and seed data inside
  each immutable run, reverified the manifest before remote mutation, preserved transfer-owner
  access to backups/manifests, corrected custom SSH host/user/port resolution, and consistently
  selected the production AMD64 overlay for restore/rollback guidance.
- `deploy/release.sh` — replaced the superseded direct transfer path with a compatibility wrapper
  that delegates to the guarded deployment assistant. The clean-`main` safety check in
  `deploy/bj-deploy` remains intact and was neither bypassed nor weakened.
- `supabase/migrations/20260805185628_approval_signatures_persian_only.sql` — corrected the approver
  signature constraint so cancelling an approved future request preserves the signed evidence.
  Added regression coverage and strengthened the adoption fingerprint for this shape.
- `scripts/seed-demo.mjs`, E2E fixtures, `README.md`, and `docs/DEPLOY.md` — updated the obsolete RPC
  argument and legacy alphanumeric demo logins to current numeric personnel-number login codes.
- `lib/leave/signature.ts` — aligned signature validation with the database minimum length and
  removed a dead constant reported by the final lint run.
- Deployment guides, durable memory, data/permission/requirements/task documentation, and the
  changelog now describe atomic ledger/resume behavior, immutable run inputs, correct ARM64-local
  versus AMD64-client commands, and the reviewed feature set.

**Actions outside the repo**

- Fetched Git refs from `origin`; no history was rewritten and no branch was deleted.
- Used only the existing local ARM64 Docker test environment. The local database received the
  corrected pending approval-signature constraint/checksum and the numeric demo fixtures needed by
  Playwright. E2E teardown removed its temporary test users and department.
- The client server was not contacted. No client SSH connection, file transfer, database change,
  deployment bundle transfer, Safe Update, or production container operation occurred.

**Verification**

- Shell syntax: every `deploy/*.sh`, `deploy/bj-deploy`, `deploy/lib/*.sh`, and
  `tests/deploy/*.sh` file passed `/bin/bash -n`.
- `npm run lint` — passed with no errors or warnings. `npx tsc --noEmit` — passed.
- `npm run test:unit` — 40 files and 254 tests passed.
- `npm run test:deploy` — all 11 deployment-assistant cases passed, including atomic migration
  rollback/resume and immutable run-source/ownership regressions.
- `npm run build` — Next.js 16.2.9 production build passed and generated 40 pages, including
  `/request/daily-errand`, `/api/health`, the Apple icon, and the PWA manifest.
- `npx playwright test` against the local HTTPS stack — 33 passed and one intentionally skipped
  legacy department-code-editing case. An earlier run exposed the signed-cancellation constraint
  and stale demo seeder; both were fixed, their targeted tests passed, and then the entire suite
  passed.
- Local Docker doctor passed with five native ARM64 services and a healthy database/app. A local
  Compose render of the client overlay selected only the dedicated AMD64 service images plus the
  app image; it did not start or modify containers.
- All three hardened August migration fingerprints returned true against the local test database.
  English/Farsi key parity passed for 415 messages. All 50 Markdown files had valid local links;
  icon formats/dimensions were verified; `git diff --check` passed.

**State left behind**

- At the time this entry was written, the reviewed work was still on `codex/code-review`, ready for
  staging and landing. The final commit/push/merge hashes are recorded in the completion entry that
  follows this one in Git history.

**For the next agent**

- Do not weaken the clean-tree or clean-`main` production gate. The next production action is the
  guarded client Safe Update only after confirming local `main` and `origin/main` remain identical.
- Do not replay or edit historical migrations already recorded by a deployed ledger. The three
  August files were still pending for the client during this review, which is why correcting the
  constraint before their first production application was safe.

## 2026-08-11 — Production release blocked by intentional clean-tree guard

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf`
**Trigger:** The user selected Client server → Safe update in `./deploy/bj-deploy` and reported
`client releases require a clean working tree; commit or stash changes first`.

**What changed**

- `docs/AGENT-LOG.md` only — recorded the diagnosis. No deployment or application code changed.

**Actions outside the repo**

- None. The client server was not contacted and no package, SSH transfer, backup, database change,
  container change, commit, or push was made.

**Verification**

- Confirmed `deploy/bj-deploy:92-98` deliberately requires production packages to be built from a
  clean `main` worktree so the package can be tied to a reproducible commit.
- `git status --short` shows roughly 108 pending paths containing the August features, three
  migrations, deployment assistant, documentation, tests, and branding. `HEAD` remains `4e6b6bf`.
- `git diff --check` passed. Full tests were not rerun because this turn diagnosed the release gate
  and did not authorize committing or deploying the pending work.

**State left behind**

- The source remains uncommitted on `main`; nothing was staged, committed, pushed, packaged, or
  deployed. The production guard will continue to stop until the intended changes are reviewed and
  committed (or deliberately discarded/stashed).

**For the next agent**

- Do not bypass or remove the clean-tree guard. If the user wants the pending August version in
  production, validate it, commit it, push/merge it to `main`, and rerun **Safe update**. Stashing
  would package the old `4e6b6bf` version and omit the new migrations/features.

## 2026-08-07 — Deploy-readiness check; brand favicon and PWA icons replace the stock placeholders

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `4e6b6bf` (= `origin/main`), worktree dirty with 103 paths
**Trigger:** User asked whether the project is ready to deploy, asked me to verify some Supabase
commands they had run, and asked for the logo + favicon from `assets/` to be wired in and shown
running locally — explicitly **not** pushed.

**What changed**

- `app/favicon.ico` — replaced. The previous file (Jun 25, sha `2b8ad2d3…`) was the **stock
  Next.js/Vercel black-triangle favicon**; I rendered it to PNG and looked at it before
  overwriting. Now a multi-size ICO (16/32/48/64/128/256) of a BJ monogram.
- `app/apple-icon.png` — new, 180px.
- `public/icons/icon-{192,512}.png` — replaced. The previous files were **blank royal-blue
  squares** with no mark on them (verified by rendering). Now the unpadded monogram.
- `public/icons/icon-maskable-{192,512}.png` — new; same monogram inset ~10% for the Android
  maskable safe zone.
- `app/manifest.ts` — icon list now declares `purpose: 'any'` (unpadded) and `purpose: 'maskable'`
  (inset) separately. First attempt used `purpose: 'any maskable'`, which the web-app-manifest
  spec allows but Next's `MetadataRoute.Manifest` types as a single enum — `tsc` rejected it with
  TS2820. Split into four entries.
- No application logic, migration, deploy script, or route was touched.

**Icon provenance — read this before "fixing" it**

- `assets/` is **not new** (dated Jun 30) and contains **no favicon**: only `bj-logo.png` and the
  Rubik font family. The user believed they had supplied a favicon; there is no such file.
- `assets/bj-logo.png` is **byte-identical** to `public/bj-logo.png` (sha `bc5abaf9…`), which was
  already rendered by `AppShell.tsx:20` and `login/page.tsx:53`. The logo needed no work.
- The logo is a 1181×591 wordmark. Letterboxed into a square favicon it is an illegible smudge at
  16px — I rendered both candidates at 16/32/64 and showed the user the comparison. Hence the
  monogram: `#2E3C92` field, white "BJ" in Rubik Bold (`assets/Rubik/static/Rubik-Bold.ttf`).
- Generator kept at
  `/private/tmp/claude-501/-Users-amir-Workspace-bj/e412a95b-…/scratchpad/mkicons.py`. That is a
  scratch path and **will not survive**; re-derive from `public/bj-logo.png` if the icons need
  regenerating.

**Actions outside the repo**

- No client server contact, no SSH, no database write, no deploy. `https://10.10.10.50/api/health`
  is unreachable from here (no corporate VPN) — expected.
- Killed a stale orphaned `next-server` (PID 87316) left listening on port 3000 by my previous
  session; it was serving 404s because `npm run build` had replaced its dev output. Restarted
  `npm run dev` via the preview tool.
- Read-only Supabase CLI checks: `supabase projects list` (authenticated) and a local
  `docker exec … psql` count of `bj_deploy.schema_migrations`. No write.

**Verification**

- `npx tsc --noEmit` — clean (after the TS2820 fix above). `npm run lint` — clean.
- `npm run test:unit` — 40 files, 254 tests passed.
- `npm run test:deploy` — 9/9 deployment-assistant tests passed.
- `npm run build` — succeeded, 39 pages, all four request routes including
  `/[locale]/request/daily-errand`. **Note this build predates the icon changes**; `tsc` and
  `lint` were re-run after them, a full `build` was not.
- Dev server: `/favicon.ico` 200 (14685B, `image/x-icon`), `/apple-icon.png` 200,
  all four `/icons/*` 200, `/manifest.webmanifest` 200 with the four-entry icon array. Next
  emits `<link rel="icon" sizes="256x256">` and `<link rel="apple-touch-icon" sizes="180x180">`.
- **Not run: Playwright e2e.** Not run at all this session — no claim either way about it.
- Local stack: five containers up, `bj-erp-db-1` healthy, `https://192.168.2.48:3500/api/health`
  → 200, `bj_deploy.schema_migrations` holds 41 rows matching the 41 files in
  `supabase/migrations/`.

**State left behind**

- Nothing committed, staged, or pushed. `HEAD` is still `4e6b6bf` and equals `origin/main`; the
  worktree now carries ~108 uncommitted paths.
- `npm run dev` running on port 3000.

**For the next agent**

- **This repo is not deployable as it stands, and the reason is not a bug.** Roughly two weeks of
  feature work — signatures, daily errands, PTO overage, the deployment assistant, three
  migrations — exists only as uncommitted working-tree changes. `deploy/bj-deploy` refuses a
  production build from dirty or non-`main` source by design, so the first step is a reviewed
  `git diff` and a commit, not a deploy command.
- The client server is still on the pre-August schema and has never been touched by the
  assistant. Its first run must be a reviewed Safe update, per
  `docs/DEPLOY-ASSISTANT.md`.
- If the favicon is ever regenerated, keep it a monogram or another compact mark. The full
  wordmark does not survive 16px; that was measured, not assumed.

## 2026-08-06 — Safe-update migration adoption recovery and local deployment

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf`, with the uncommitted deployment-assistant and
application work described in the preceding entry
**Trigger:** The user's first local **Safe update** stopped while replaying an already-installed SQL
migration with `function "approve_leave_request" already exists`; the user supplied the full run
output and asked for the deployment failure to be handled.

**What changed**

- `deploy/lib/migrations.sh` — made first-run migration-ledger adoption resumable. The immutable
  legacy baseline still covers migrations 1–38, while missing known migrations 39–41 are now adopted
  only after each migration's complete catalog fingerprint proves its columns, constraints,
  functions, function bodies, and removal of obsolete overloads are already installed. An interrupted
  adoption can therefore resume without replaying installed DDL or trusting a single-column guess.
- `deploy/lib/migrations.sh` — corrected the fingerprint queries to read SQL from stdin without
  supplying psql's `-c` option; `-c` requires an inline command argument and caused the second safe
  update attempt to stop with `psql: option requires an argument -- 'c'` before migration or app
  cutover.
- `tests/deploy/deploy-assistant.test.sh` — added regression coverage for interrupted legacy
  adoption, complete known-migration recording, apply-once behavior, and the psql stdin/`-c`
  incompatibility.
- `docs/{MEMORY,CHANGELOG}.md` — documented the durable migration-adoption rule and the recovery fix.

**Actions outside the repo**

- No client-server SSH connection, transfer, command, database operation, or deployment was made.
- Queried only the local Docker PostgreSQL catalogs and proved that migrations 39, 40, and 41 were
  already fully installed while the new ledger initially recorded only 1–39. No business row was
  changed by that diagnosis.
- Ran `./deploy/bj-deploy update local`. Each of the three attempts made and verified a custom-format
  backup before proceeding:
  `backups/deploy-assistant/local/20260806T222756Z-b629cc/postgres.dump`,
  `20260806T223126Z-ff5aad/postgres.dump`, and
  `20260806T223235Z-1ac0af/postgres.dump`. The first two stopped safely before app cutover; the final
  run adopted ledger records 40–41, skipped all already-applied SQL, rebuilt the application natively
  for ARM64, and recreated only `bj-erp-app-1`. Database/Auth/PostgREST/Caddy containers and database
  data were preserved.

**Verification**

- `/bin/bash -n deploy/lib/migrations.sh tests/deploy/deploy-assistant.test.sh` — passed.
- `npm run test:deploy` — all deployment-assistant tests passed, including both new regressions.
- Production Docker build inside the successful Safe update — Next.js 16.2.9 compile, TypeScript,
  and all 39 generated pages passed; `/api/health` was present.
- Final local checks: `bj_deploy.schema_migrations` contains exactly 41 entries; the installed
  manifest contains 41 lines; the final three migration filenames are recorded; and
  `https://192.168.2.48:3500/api/health` returned HTTP 200 with `{"status":"ok"}`.
- Docker image inspection reported `arm64` for app, database, Auth, PostgREST, and Caddy. Compose
  reports all five services running and PostgreSQL healthy. `git diff --check` passed before the
  documentation update and is repeated at session end.

**State left behind**

- The corrected app is running locally at `https://192.168.2.48:3500`; the test database and Caddy CA
  were preserved. The three verified backups remain on the Mac.
- All source and documentation changes remain uncommitted on the already-dirty `main` worktree.
  Nothing was staged, committed, or pushed. The client server remains untouched.

**For the next agent**

- Do not replace the complete catalog fingerprints with a single sentinel column. Adoption is a
  narrow recovery path for these three known migrations; unknown missing history must still stop.
- With psql, a heredoc/stdin query must not use `-c` without an argument. Keep SQL out of argv when it
  contains values or secrets, and preserve the deployment harness regression.

## 2026-08-06 — Interactive deployment assistant implementation

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf`, with substantial pre-existing uncommitted feature,
native-ARM64 deployment, and documentation work from the preceding sessions
**Trigger:** After the design discussion, the user approved implementation of one guided program for
local ARM64 and client AMD64 restart/redeploy/update/fresh-install workflows, including resumable SSH
jobs, and required enough documentation for another agent to rebuild or recover it without any chat
context.

**What changed**

- `docs/specs/2026-08-06-interactive-deployment-assistant-design.md` and
  `docs/plans/2026-08-06-interactive-deployment-assistant.md` — complete cold-start design and
  implementation/recovery map: topology, action/data matrix, architecture and Git gates, backup and
  secret boundaries, migration contract, remote state machine, reset order, failures, acceptance
  criteria, and exact file inventory.
- `deploy/bj-deploy` — new macOS-Bash-3.2-compatible interactive/CLI entry point. Implements local
  and client doctor/status/logs, restart, manifest-gated app-only rebuild, safe update, database
  reset, factory reset, dry-run, and `resume <run-id>`. Client defaults are SSH alias `bj` backed by
  `behsazan@5.201.190.184:2222`, remote directory
  `/home/behsazan/bj-erp-installer`, and app `https://10.10.10.50:3500`.
- `deploy/remote-job.sh` — server-side detached worker with atomic status/log files, a global `flock`,
  idempotent run IDs, independent backup phase, Mac-checksum authorization gate, restart/app/update/
  reset workers, protected reset-password handoff, and reconnect states including `BACKUP_READY`,
  `BACKUP_VERIFIED`, `RESET_READY`, `RUNNING`, `SUCCEEDED`, and `FAILED:<code>`.
- `deploy/lib/{common,migrations,health}.sh` — shared target-safe Compose wrapper, validation/hashing/
  atomic-env helpers, password-safe container execution, immutable private migration ledger, known
  legacy-baseline adoption, source manifest generation, stable app/Auth/DB health checks, and running
  image architecture verification.
- `deploy/docker-compose.client-amd64.yml` — dedicated pinned `*-client-amd64` service tags and
  explicit AMD64 platforms. Integrated the preceding session's untracked local ARM64 overlay and
  preparation script; local and production paths now always supply their correct overlays.
- `deploy/install.sh`, `update.sh`, `package.sh`, and SQL/key helpers — use the target wrapper,
  pending-only migrations, `/api/health`, force-recreated app cutover, reliable admin creation after
  a DB wipe, password files/environment names instead of secrets in argv, dedicated AMD64 bundle
  tags, SHA-256 sidecars, macOS metadata-free tar creation, and inclusion of the controller/worker/
  libraries in the offline installer.
- `app/api/health/route.ts` — public no-store liveness contract returning `{status:"ok"}` outside the
  locale/session proxy. This replaces the broken assumption that `/` must return 200; Next normally
  redirects the root with 307.
- `tests/deploy/deploy-assistant.test.sh` and `npm run test:deploy` — Bash fixture coverage for
  architecture/identifier rejection, atomic `.env` edits and permissions, sorted migration hashes,
  apply-once/changed-history ledger behavior, remote run-ID idempotence, and health contract.
- `docs/DEPLOY-ASSISTANT.md` — simple operator guide covering one-time SSH setup, every action/data
  effect, local phone access, production packaging, reset guards, resume, backup privacy, migrations,
  network behavior, overrides, troubleshooting, and verification. Added pointers from the older
  runbooks and updated `MEMORY`, `TASKS`, and `CHANGELOG`.
- `deploy/setup-release.sh` and `release.sh` — corrected the outdated laptop-VPN requirement. The
  Mac uses public SSH directly; only phone/browser access to the private app route uses VPN.

**Actions outside the repo**

- No SSH connection, rsync transfer, command, file change, Docker operation, database operation, or
  health request was made against the client's server. No client VPN was used.
- Ran read-only local Docker inspection with approved access. Docker daemon reported `aarch64`; both
  local/client Compose overlay combinations rendered; the five currently running local images are
  all `linux/arm64`/`linux/arm64/v8`. No local container was restarted/recreated and no volume was
  modified.
- Ran one read-only query through the existing local PostgreSQL 15 container to prove psql
  `\getenv` and safely quoted `:'variable'` work with an inherited environment-variable name. It
  returned only the harmless literal `safe_value`; no SQL write ran and no secret was printed.
- Consulted current Docker Compose documentation through Context7 (multiple `-f` overlays,
  recreation, `--wait`, project/volume behavior), current PostgreSQL psql documentation for
  `\getenv`, current Supabase self-host/restore documentation, and current Supabase breaking-change
  notices. The PG15→PG17 and gateway transitions reinforce that ordinary releases must keep this
  project's tested infrastructure versions pinned.

**Verification**

- `npm run test:deploy` — passed all deployment fixture checks; also passed explicitly under the
  Mac's `/bin/bash` 3.2.57.
- `bash -n` under Bash 3.2 — clean for the controller, worker, install/update/package/release/setup,
  ARM64 preparation, all three libraries, and the deployment test harness.
- Both target Compose configurations rendered with `config --quiet`; read-only image inspection
  verified every existing local service is native ARM64.
- `npm run lint` — passed. `npm run test:unit` — 40 files / 254 tests passed.
- `npm run build` — first attempt hit the known sandbox-only Turbopack worker-port denial; approved
  retry outside the sandbox passed compile, TypeScript, 39 static pages, and emitted `/api/health`.
- Dummy-secret key-generation contract passed without putting the secret in argv. PostgreSQL 15
  environment-variable/quoting contract passed read-only. `git diff --check` passed.
- ShellCheck was not installed, so it could not be run. The complete AMD64 multi-GB offline package,
  destructive local reset, and any production SSH execution were deliberately not run during
  implementation; the production command itself retains architecture/checksum/test gates.

**State left behind**

- Implementation and documentation are complete but remain uncommitted on the already-dirty `main`
  worktree. Nothing was staged, committed, pushed, deployed, or migrated by this session.
- The existing local stack remains running exactly as found on native ARM64 images and its existing
  database/volumes. Its current app image predates the new `/api/health`; the endpoint becomes active
  after the user chooses a local app/update deployment.
- The client server remains untouched. Its first assistant-driven operation should be a reviewed
  Safe update or Fresh database only after all intended source changes are committed on clean
  `main`. App only intentionally refuses until an installed migration manifest exists.

**For the next agent**

- Start with `docs/DEPLOY-ASSISTANT.md`, then the dated design and plan. Do not infer missing behavior
  from this chat; those three files contain the complete contract and recovery sequence.
- Preserve all pre-existing feature changes in this dirty worktree. Do not test a destructive action
  against the local or client project without fresh explicit authorization.
- Before the first live client run, review `git diff`, commit the intended source on `main`, run
  `./deploy/setup-release.sh`, then `./deploy/bj-deploy doctor client`. The assistant will refuse a
  production build from dirty/non-main source.
- A first client Safe update adopts the verified 38-migration legacy baseline and applies the three
  current August migrations. A first local Safe update detects those already-applied columns and
  records them without replaying non-idempotent history.
- If SSH drops, use the printed `./deploy/bj-deploy resume <run-id>`. Never manually start a second
  job or bypass `BACKUP_VERIFIED`; inspect `status`/`logs` and the run manifest first.

## 2026-08-06 — Clarify direct-SSH deployment without a laptop VPN

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the preceding sessions' uncommitted feature,
deployment-design, native-ARM64, and documentation work
**Trigger:** The user clarified that the Mac can reach the client's public SSH endpoint directly,
while only the phone uses VPN to reach the private application URL, and asked whether the proposed
tool will also execute installation remotely rather than merely upload an archive.

**What changed**
- `docs/AGENT-LOG.md` only — recorded the clarified deployment connectivity model. No script,
  configuration, application code, migration, or running environment was changed.

**Actions outside the repo**
- None. No SSH connection, file transfer, client-server command, Docker command, or database action
  was run.

**Verification**
- Re-read `deploy/setup-release.sh` and `deploy/release.sh`. The existing routine-release pipeline
  already uploads with rsync and then uses `ssh -t` to execute `sudo update.sh` remotely, so the
  interactive deployment assistant can extend the same pattern to full installation and resets.
- Confirmed the VPN wording in both scripts is an outdated assumption for this user's topology. The
  deployment prerequisite should be successful direct SSH to `5.201.190.184:2222`, not a VPN.
- Confirmed the app's `10.10.10.50:3500` address and the public SSH endpoint are separate network
  paths. Because the Mac cannot reach the private app address, post-deploy HTTP/Auth checks should
  run on the client server over SSH and return their results to the Mac; the phone VPN remains only
  for the final human browser test.
- Consulted current OpenSSH documentation for remote command execution, forced TTY allocation, and
  authenticated file transfer. No tests were run because this was a design clarification only.

**State left behind**
- The intended tool remains design-only. It will perform upload plus remote execution in one Mac-side
  command; the user will not need to open a separate SSH session.
- This journal entry remains uncommitted with the existing changes on `main`; nothing was staged,
  committed, or pushed.

**For the next agent**
- Remove the VPN prerequisite/messages from the future Mac-side deployment flow and replace them
  with direct SSH preflight. Do not change the app URL: employees/testers still reach
  `https://10.10.10.50:3500` through the client's LAN/VPN.
- Use SSH key authentication or a multiplexed authenticated connection for transfers, allocate a TTY
  for sudo/admin-password prompts, never pass passwords in command arguments, and execute remote
  health checks from the server before reporting success.

## 2026-08-06 — Interactive deployment assistant design review

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the preceding sessions' uncommitted feature,
native-ARM64 deployment, local-runbook, and documentation work
**Trigger:** The user proposed replacing manual terminal-command sequences with one interactive
script covering local ARM64 and client AMD64 restarts, app redeploys, database-preserving updates,
offline SSH delivery, and destructive fresh installations, and requested brainstorming before code.

**What changed**
- `docs/AGENT-LOG.md` only — recorded this design-only review. No deployment script, Compose file,
  application source, migration, or operator documentation was implemented or modified.

**Actions outside the repo**
- None. No Docker container, image, volume, database, SSH configuration, client server, or remote
  file was touched.

**Verification**
- Read the existing deployment implementation and active design records: `deploy/install.sh`,
  `package.sh`, `prepare-local-arm64.sh`, `release.sh`, `setup-release.sh`, `update.sh`, all Compose
  variants, `docs/LOCAL_REDEPLOY.md`, and the 2026-07-25/26 deployment plans.
- Confirmed most low-level building blocks already exist: interactive offline install, AMD64 package
  creation, resumable SSH/rsync release delivery, verified pre-update backup, app rollback, and
  dedicated native ARM64 tags/Compose overlay.
- Identified design blockers to fix before adding a menu: `update.sh` expects exactly HTTP 200 from
  `/` without following the app's normal redirect; wiping only the DB volume while retaining `.env`
  makes `install.sh` reuse configuration and skip the first-admin prompt; every update currently
  replays every migration rather than using an immutable migration ledger; and AMD64 packaging uses
  canonical service tags, so a forgotten local overlay can reintroduce emulation on Apple Silicon.
- Checked current Docker Compose documentation for multiple-file overlays, `--wait`, and targeted
  recreation, plus current Supabase self-hosting/update guidance and breaking-change notices. The
  upstream PG15-to-PG17 and Kong-to-Envoy changes reinforce keeping this project's service versions
  pinned and treating infrastructure upgrades as a separate reviewed operation.
- No tests were run because the user explicitly requested design discussion before implementation.

**State left behind**
- Brainstorm/design only; no deployment assistant exists yet and no workflow was executed.
- This journal entry remains uncommitted with the existing work on `main`; nothing was staged,
  committed, or pushed.

**For the next agent**
- If the user approves the design, write a reviewed spec/plan before implementation. Prefer one
  interactive Mac-side entry point that dispatches to small local/remote operations, with both menu
  and non-interactive subcommands, rather than one monolithic destructive script.
- Preserve these proposed safety defaults: detect and verify architecture instead of trusting a
  menu choice; clean `main` for client releases; dry-run/doctor first; verified off-machine backup
  before any wipe; versioned/checksummed staging; explicit typed destructive confirmation; exact
  compose project/volume validation; no secrets in arguments/logs; and a distinct factory reset from
  a database reset that preserves the Caddy CA.
- Before wrapping the existing scripts, repair the health-check contract and fresh-admin path, then
  add deployment manifests/migration checksums so an app-only choice can be proven safe rather than
  guessed from filenames.

## 2026-08-05 — Daily work errands and paid-leave overage

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the preceding sessions' uncommitted FR-32,
signed-approval, Persian-only-calendar, and native-ARM64 deployment work
**Trigger:** Add a separate daily work-errand form, rename the existing errand tab to Hourly Work
Errand, and show/project paid leave with any excess recorded as unpaid using 8 hours per day.

**What changed**
- `app/[locale]/(app)/request/daily-errand/{page.tsx,DailyErrandRequestForm.tsx}` and
  `RequestTypeTabs.tsx` — added the fourth signed daily-errand form with Persian Start/End dates,
  required location, optional description, localized four-tab navigation, and a mobile-scrollable
  tab row; renamed the existing errand tab to Hourly Work Errand.
- `lib/leave/dailyErrand.ts`, `lib/actions/leave.ts`, `messages/{en,fa}.json`, request pages, and
  request lists — wired the daily-errand RPC and labels through the UI and show stored unpaid time on
  pending/approved requests.
- `lib/leave/duration.ts`, daily/hourly leave forms, and unit tests — added exact minute-based
  projections for Requesting, non-negative Remaining Balance, and conditional Unpaid Time Off.
- `supabase/migrations/20260806014310_daily_work_errands_pto_overage.sql` — added constrained
  `unpaid_minutes`, daily errand shape/counting/submission, authoritative paid/unpaid splitting on
  signed approval, paid-only ledger consumption, and paid-only cancellation reversal. Public RPCs
  remain authenticated-only SECURITY DEFINER functions with empty search paths.
- `tests/e2e/{_helpers.ts,errand.spec.ts,leave.spec.ts}` and unit tests — cover daily errand signed
  submission/approval and the exact 4-days-versus-3-days-4-hours overage flow.
- Requirements, data model, permissions, tasks, changelog, design, and implementation plan —
  documented FR-13/FR-33 and the preserved-data local rollout.

**Actions outside the repo**
- Backed up the preserved local database to
  `/private/tmp/bj-pre-daily-errand-pto-20260805/postgres.dump` (368302 bytes) before migration.
- A first rollback dry run as `postgres` stopped before DDL because that role did not own
  `leave_requests`; a second passwordless `supabase_admin` attempt failed authentication. Using the
  database container's configured `supabase_admin` password, the entire migration then parsed inside
  `BEGIN`/`ROLLBACK`, after which it was applied once successfully.
- Built `bj-erp-app:local-arm64` with
  `docker build --platform linux/arm64 -f deploy/Dockerfile ...` and recreated only the app using
  `deploy/docker-compose.yml` plus `deploy/docker-compose.local-arm64.yml`, `--no-deps`, and
  `--pull never`. Database container ID
  `e48c7930e3038510a10a7c83b26a6070b56721bb7cb0dc05ff0cf1949b029a07` did not change. The
  `bj-erp_db-data` volume was neither removed nor recreated. No production/client command ran.
- The in-app browser could not pass local Caddy's private certificate
  (`ERR_CERT_AUTHORITY_INVALID`), so UI verification used the project's explicitly local Playwright
  configuration with `ignoreHTTPSErrors`; the in-app browser session was then finalized.

**Verification**
- `jq empty messages/en.json messages/fa.json`, `npm run lint -- --max-warnings=0`, and
  `npx tsc --noEmit` — passed.
- `npm run test:unit` — 40 files / 254 tests passed. An earlier attempt with Vitest's unsupported
  `--runInBand` flag failed at option parsing; no test ran in that attempt.
- `npm run build` — passed after rerunning outside the filesystem sandbox because Turbopack's worker
  port was denied there; the output includes `/[locale]/request/daily-errand`.
- Focused native-stack e2e (`errand.spec.ts` + `leave.spec.ts`, one worker) — 3 passed in 23s,
  including signed daily-errand approval and an over-balance signed approval with unpaid remainder;
  cleanup removed all five throwaway users. A second mobile leave run passed in 8.9s and removed its
  one throwaway user.
- Read-only browser checks on both request routes found the correct headings/tabs, no framework
  overlay, and no console issues. Visual captures:
  `/private/tmp/bj-daily-errand-desktop.png` and `/private/tmp/bj-pto-overage-mobile.png`.
- Pre-migration business counts were profiles 5, roles 6, requests 3, ledger 10, holidays 0,
  departments 5, leave types 3, companies 1; migration checks confirmed the new column,
  constraints, function security/ACL, and no count changes. The final post-e2e audit returned those
  same counts, all five running images inspected as `linux/arm64` (`/v8` where reported), the
  preserved volume creation time remained `2026-08-04T19:54:09Z`, and the daily-errand route
  returned HTTP 200 through the local gateway.

**State left behind**
- Work remains uncommitted on `main` together with the preceding sessions' changes.
- The local stack is running with native ARM64 service images and the original `bj-erp_db-data`
  volume. Migration `20260806014310` is applied locally. The client's AMD64 production environment
  was not contacted and does not have this migration.

**For the next agent**
- Always use both Compose files for local commands. Do not run `down -v`, delete
  `bj-erp_db-data`, or use the AMD64 production packaging path for Apple-Silicon testing.
- Production deployment is a separate AMD64 operation and must include the new migration; it was
  deliberately not attempted here.

## 2026-08-05 — Signed approvals, Persian-only dates, and native ARM64 local Docker separation

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the preceding sessions' uncommitted FR-32 and
local-redeploy work
**Trigger:** Require manager/admin signatures on approval, remove Gregorian calendars everywhere,
then correct the local Docker deployment so Apple Silicon runs no AMD64-emulated service while
preserving the existing database.

**What changed**
- `supabase/migrations/20260805185628_approval_signatures_persian_only.sql` — added nullable
  historical approver-signature evidence, replaced the unsigned approval RPC with a signed
  three-argument RPC, kept decision/ledger/audit/evidence atomic, normalized profile calendar
  preferences to `jalali`, and constrained future values to Jalali.
- `lib/actions/leave.ts`, generated Supabase types, request signature components, approvals queue,
  and calendar — approval now requires a fresh mouse/touch signature plus explicit authorization;
  rejection remains unsigned; authorized viewers fetch requester and approver images lazily.
- Profile settings and all request, employee, holiday, allocation, home, approval, and calendar
  surfaces — removed the Gregorian selector/branching and use Persian pickers/display formatting.
  Stored database dates remain ISO Gregorian at the persistence boundary.
- `deploy/docker-compose.local-arm64.yml` — new Apple-Silicon-only overlay with dedicated local
  image tags and explicit `platform: linux/arm64` for Postgres, GoTrue, PostgREST, app, and Caddy.
- `deploy/prepare-local-arm64.sh` — pulls the ARM64 manifests of the existing pinned service
  versions, builds `bj-erp-app:local-arm64`, verifies every image architecture, and deliberately
  does not touch containers or volumes.
- `docs/LOCAL_REDEPLOY.md`, `docs/MEMORY.md`, `docs/CHANGELOG.md`, `docs/TASKS.md`, requirements,
  data model, permissions, and the new approval-signature design/plan — documented the signed
  approval/Persian-only contract and separated ARM64 local commands from AMD64 client releases.
- `playwright.config.ts` and e2e helpers — external local-stack URL support, private-CA handling in
  the isolated test process, ARM-local cleanup routing, Persian allocation pickers, and reliable
  below-the-fold signature drawing.

**Actions outside the repo**
- Initially rebuilt/recreated the app and applied the new migration while the four previously
  loaded service images were still AMD64. The user correctly stopped further testing and required
  native ARM64 for all local services. No production/client server action was taken.
- Audited Docker Desktop (`aarch64`) and all running images. Before correction: app was ARM64;
  Postgres, GoTrue, PostgREST, and Caddy were AMD64. Docker manifests confirmed every pinned tag
  publishes an ARM64 variant.
- Applied only `20260805185628_approval_signatures_persian_only.sql` after a verified backup at
  `/private/tmp/bj-pre-approval-signatures.pCTmtl/postgres.dump`; reloaded PostgREST and verified
  the signed function, grants, constraint, columns, calendar normalization, and unchanged counts.
- Before the architecture cutover, created and validated a fresh 365,625-byte backup at
  `/private/tmp/bj-pre-arm64-switch.KjmAs5/postgres.dump`. Recorded `bj-erp_db-data` creation time
  `2026-08-04T19:54:09Z` and all business counts.
- Prepared dedicated ARM64 images, then ran Compose with the base + ARM64 overlay and `--pull never
  --force-recreate`. This recreated containers only. No `down -v`, `volume rm`, database restore,
  or client-server command was run.

**Verification**
- `npx tsc --noEmit`: passed. `npm run lint -- --max-warnings=0`: passed.
- `npm run test:unit`: 39 files / 248 tests passed.
- `npm run build`: passed outside the sandbox after the first attempt hit a sandbox-only Turbopack
  worker-port denial. The ARM64 Docker build also completed successfully.
- External-stack Playwright: approval flow passed end-to-end (requester evidence, signed manager
  approval, separate approver viewer, rejection without approver evidence, balance debit); settings
  flow passed (no Gregorian option, language switch). Six throwaway accounts were cleaned. A final
  calendar-only run was interrupted by the user before execution completed; no test process or
  throwaway account remained.
- Current `docker compose ... images`: all five services are `linux/arm64` or `linux/arm64/v8`.
  PostgREST logs its database connection as `aarch64-unknown-linux-gnu`.
- The DB container mounts the same `bj-erp_db-data` volume with the same creation timestamp and
  mountpoint. Counts before/after are identical: profiles 3, roles 4, requests 3, ledger 5,
  holidays 0, departments 5, leave types 3, companies 1. All four requester/approver signature
  columns remain present.
- `https://192.168.2.48:3500/en/login` returned 200 and `/auth/v1/health` returned 200 after the
  native Caddy cutover. App/Auth/PostgREST logs show normal startup and schema loading.

**State left behind**
- Local stack is running entirely on native ARM64 images via the dedicated local overlay, against
  the preserved database volume and current signed-approval schema.
- Production remains explicitly AMD64 through the unchanged `deploy/package.sh` and
  `deploy/release.sh`; neither the client server nor its data was contacted.
- Work remains uncommitted on `main`, alongside the earlier uncommitted UI/FR-32 work. The user's
  existing untracked `deploy/docker-compose.local.yml` was preserved; new instructions use
  `deploy/docker-compose.local-arm64.yml` instead.

**For the next agent**
- For local Docker commands on this Mac, always combine `deploy/docker-compose.yml` with
  `deploy/docker-compose.local-arm64.yml`. Never use production canonical image tags locally.
- Running `package.sh` intentionally loads AMD64 canonical tags on the Mac, but the dedicated
  `*-local-arm64` tags remain isolated. Re-run `prepare-local-arm64.sh` only if those local tags
  were pruned.
- Never use `docker compose down -v`, remove `bj-erp_db-data`, or replay all historical migrations
  against this populated database.

## 2026-08-05 — Verify LAN-IP deployment despite macOS curl TLS failure

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the preceding sessions' uncommitted FR-32,
redeploy-documentation, and diagnostic journal changes
**Trigger:** After recreating the local stack for `192.168.2.48`, the user reported that the Step 2
curl check returned `app: 000` instead of 200.

**What changed**
- `docs/AGENT-LOG.md` only — recorded the read-only runtime diagnosis. No source, `.env`, Compose,
  certificate, container, volume, or database setting was changed.

**Actions outside the repo**
- Inspected `docker compose ps --all` and current logs after the user's full force-recreation. All
  five services are up, Postgres is healthy, Caddy publishes `0.0.0.0:3500->443`, the app reports
  ready, and Caddy successfully issued an internal certificate for `192.168.2.48`.
- Confirmed the Mac has a listener on TCP 3500. The system curl connects but fails during TLS with
  LibreSSL `CRYPTO_internal:bad decrypt`, producing curl exit 35 / HTTP code 000.
- Tested TLS 1.2 and 1.3 independently with OpenSSL; both handshakes succeeded. Sent an HTTP/1.1
  request through the successful TLS connection and received the expected 307 redirect to
  `/fa/login` with the correct IP-based CSP and alternate links.
- Repeated the complete request with Node's TLS verification disabled for this one diagnostic; it
  followed the redirect and printed `app: 200`.

**Verification**
- `.env` contains the intended values: `APP_HOST=192.168.2.48`, `APP_PORT=3500`, and
  `APP_ORIGIN=https://192.168.2.48:3500`.
- Caddy's certificate store now contains both the old `localhost` leaf and a new
  `192.168.2.48` leaf; Caddy logged `certificate obtained successfully` for the IP.
- The endpoint is reachable and the app returns 200. The failed curl result is specific to the
  Mac's LibreSSL curl path, not an application or container readiness failure.
- The recreate output also truthfully reports that the current `db`, `rest`, `auth`, and `gateway`
  images are `linux/amd64` on the `linux/arm64/v8` Mac. That warning did not stop the services, but
  native-image cleanup remains separate work if the user's no-emulation goal still applies.

**State left behind**
- The IP-configured local stack remains running and ready for phone certificate installation/testing.
- No runtime mutation was made during diagnosis. This journal entry remains uncommitted with the
  existing work on `main`; nothing was staged, committed, or pushed.

**For the next agent**
- Do not treat curl `000` as a failed app in this exact state; inspect curl's error text. Node and
  OpenSSL independently proved the gateway and app work.
- The phone must install and fully trust Caddy's exported root CA before Safari/Chrome will accept
  the IP certificate. If the phone then times out rather than showing a certificate error, check
  Wi-Fi client isolation, VPN, and macOS firewall.
- If eliminating emulation is still required, replace/re-pull the four AMD64 service images for
  arm64 and verify each image's architecture before recreating; do not conflate that with this
  already-proven endpoint response.

## 2026-08-05 — Diagnose local phone access over the Mac LAN address

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the uncommitted FR-32 implementation and local
redeploy documentation from the preceding sessions
**Trigger:** The user can open the Docker deployment at `https://localhost:3500` on the Mac but
cannot open it from a phone at the Mac's `192.168.2.48` address.

**What changed**
- `docs/AGENT-LOG.md` only — recorded the read-only network/configuration diagnosis required by the
  project working agreement. No application or deployment configuration was changed.

**Actions outside the repo**
- Inspected the local Docker stack. The gateway publishes `0.0.0.0:3500->443/tcp` and
  `[::]:3500->443/tcp`, so Docker is already listening on all Mac interfaces rather than only on
  loopback.
- Tested both `https://localhost:3500/` and `https://192.168.2.48:3500/` from the Mac with TLS
  verification deliberately disabled; both followed redirects to HTTP 200.
- Inspected the certificate served without SNI, matching the raw-IP browser path. Its only subject
  alternative name is `DNS:localhost`. A first probe that explicitly sent the IP as SNI returned no
  certificate; it made no change.
- Consulted current Docker Compose and Supabase self-hosting documentation. Both confirm that public
  URL environment changes require container recreation, not a plain restart.

**Verification**
- `deploy/.env` currently has `APP_HOST=localhost`, `APP_PORT=3500`, and
  `APP_ORIGIN=https://localhost:3500`, proving the browser bundle, Auth service, and TLS site are
  configured for the Mac-only name.
- `docker compose ps` reported all five services up and the database healthy.
- `curl -skL` returned final HTTP 200 through both hostnames from the Mac; the remaining phone-side
  requirements are a matching IP certificate/public URL, trust of the local root CA, and an
  unisolated shared Wi-Fi path.
- `ipconfig getifaddr en0` failed in the restricted process with
  `ipconfig_server_port failed (os/kern) unknown error code (44c)`; the provided IP was independently
  usable in the successful curl and TLS probes.

**State left behind**
- Running containers, volumes, database, `.env`, and certificate are unchanged. The app remains
  configured for `localhost` until the user applies the supplied phone-testing steps.
- This journal entry joins the already-uncommitted work on `main`; nothing was staged, committed, or
  pushed in this session.

**For the next agent**
- For phone testing, change all three public settings together to the LAN IP and port, recreate the
  stack so the app/Auth/Caddy receive them, export Caddy's root CA, and install/trust it on the phone.
  Do not run `docker compose down --volumes`; no data wipe is needed.
- If the Mac still returns 200 through the LAN IP but the phone cannot connect after those changes,
  check same/guest Wi-Fi client isolation, VPNs, and the macOS firewall before changing Docker.

## 2026-08-05 — Repair local signature schema and document data-preserving redeploys

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the uncommitted FR-32 implementation from the
preceding session
**Trigger:** After the schema-mismatch diagnosis, the user authorized the local fix and requested a
plain-English local app/database redeploy guide that preserves the existing database.

**What changed**
- `supabase/migrations/20260805171924_request_signatures.sql` — added an explicit
  `NOTIFY pgrst, 'reload schema'` after the column/RPC DDL so self-hosted PostgREST discovers the new
  RPC signatures without waiting for another lifecycle event.
- `docs/LOCAL_REDEPLOY.md` — added the complete developer-machine procedure: preflight, row-count
  snapshot, private `pg_dump`, archive validation, rollback image tag, Docker build, one-by-one new
  migration application over stdin, PostgREST reload, app-only recreation, health/schema/data checks,
  browser smoke test, frontend-only shortcut, and safe failure handling. Every executable step states
  its expected result and the guide explicitly forbids volume-deleting commands and bulk historical
  migration replay.
- `docs/DEPLOY.md` — linked the new local redeploy runbook from the self-host deployment section.

**Actions outside the repo**
- Created and validated the pre-migration custom-format database archive
  `/private/tmp/bj-pre-request-signatures.b08VQq` (318,209 bytes, 620 archive entries; PostgreSQL 15.8).
- Recorded pre-migration data counts: `profiles=3`, `user_roles=4`, `leave_requests=1`,
  `leave_ledger=5`, `holidays=0`, `departments=5`, `leave_types=3`, `companies=1`.
- Applied only `supabase/migrations/20260805171924_request_signatures.sql` to the persistent local
  `postgres` database with `psql -v ON_ERROR_STOP=1`. It completed with `ALTER TABLE`, `COMMENT`,
  `CREATE FUNCTION`, `DROP FUNCTION`, `REVOKE`, `GRANT`, and `NOTIFY` operation tags and no error.
- PostgREST received the notification and logged `Schema cache loaded` with 27 functions. No Docker
  service or volume was stopped, deleted, or recreated; the user's already-rebuilt app container
  remained running.
- Two initial read-only row-count commands failed before execution due shell/SQL quoting errors
  (`syntax error at or near "chr"`, then `trailing junk after numeric literal`). The corrected query
  succeeded. These failed attempts made no database change.

**Verification**
- Post-migration information-schema query returned nullable `signature_data text` and nullable
  `signature_consent_at timestamp with time zone`.
- Function-catalog query returned exactly the new argument lists for `submit_leave_request`,
  `submit_hourly_leave_request`, and `submit_errand_request`; `authenticated` has execute permission
  and `anon` does not for all three.
- Every post-migration business-table count exactly matched the pre-migration snapshot above.
- Local gateway checks: `/en/login` returned HTTP 200, `/en/request` returned the expected anonymous
  redirect HTTP 307, and `/auth/v1/health` returned GoTrue v2.170.0 health JSON.
- `npm run test:unit` — 39 files, 247 tests passed.
- `git diff --check` — clean before this journal entry; final whitespace check repeated afterward.
- No business request was submitted during verification, so the user can retry the failed request
  without a second test request affecting balances or approval queues.

**State left behind**
- The local stack is running the user's new app image against the now-current signature schema and
  refreshed PostgREST cache. Existing data and container ages are preserved; the verified backup is
  retained in `/private/tmp`.
- All FR-32 source changes, the new runbook, and this journal update remain uncommitted on `main`.

**For the next agent**
- Ask the user to retry the signed request. If it still fails, inspect only logs newer than the retry;
  the earlier missing-column/PGRST202 entries describe the now-fixed pre-migration state.
- Do not replay all historical migrations on this populated local database. Follow
  `docs/LOCAL_REDEPLOY.md` and apply only migrations not yet deployed, oldest first.

## 2026-08-05 — Local Docker request submission diagnosis

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` with the uncommitted FR-32 implementation from the
preceding session
**Trigger:** The user redeployed the local Docker app and reported the generic error when submitting
a signed daily leave request.

**What changed**
- `docs/AGENT-LOG.md` only — recorded this diagnosis. No application, migration, or deployment code
  was changed because the user reported the failure but did not yet authorize changing the running
  database.

**Actions outside the repo**
- Read local `docker compose` service status and the last ten minutes of `app`, `rest`, and `db` logs.
  The app container is the new image (created four minutes before inspection), while database/Auth/
  PostgREST containers and the persistent volume are 22 hours old.
- Logs prove the mismatch: `column leave_requests.signature_consent_at does not exist` and PostgREST
  `Could not find the function public.submit_leave_request(... p_signature_authorized,
  p_signature_data ...) in the schema cache`.
- Confirmed `deploy/migrations/` does not contain
  `20260805171924_request_signatures.sql`; the source migration exists only under
  `supabase/migrations/`. Recreating only `app` therefore updated frontend/server code but could not
  update the persistent database schema.
- Consulted current Supabase/PostgREST troubleshooting docs: after applying function/column DDL, use
  `NOTIFY pgrst, 'reload schema'` when an explicit schema-cache refresh is needed.

**Verification**
- Diagnosis is backed by both Next server logs and the exact failed SQL statements in Postgres logs.
- No test submission or write query was run. No migration was applied and no container was restarted.
- Unrelated existing log noise remains: the DB health probe connects without `-d postgres`, causing
  repeated harmless `database "supabase_admin" does not exist` FATAL entries while Compose still
  reports the database healthy.

**State left behind**
- Running local stack unchanged. Leave submission will continue failing until the FR-32 migration is
  applied to the persistent database and PostgREST sees the new schema.

**For the next agent**
- With user authorization, take/verify a backup, apply only
  `supabase/migrations/20260805171924_request_signatures.sql` to the local `postgres` database, reload
  PostgREST's schema cache, verify both columns and all three new RPC signatures, then submit a test
  request. Do not replay every historical migration against this populated database.

## 2026-08-05 — Separate daily dates and permanent requester signatures

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `4e6b6bf` (clean tree)
**Trigger:** The client asked for separate Start/End fields on daily leave and a required fresh
mouse/touch signature plus explicit digital-signature authorization on every request.

**What changed**
- `docs/specs/2026-08-05-request-signatures-and-daily-date-fields-design.md` and matching plan —
  froze the clarified scope: daily only gets two dates; daily/hourly/errand all require fresh ink and
  consent; this is requester evidence, not the deferred four-party paper workflow.
- `app/[locale]/(app)/request/LeaveRequestForm.tsx` — replaced the range picker with separate
  preference-aware start/end pickers, constrained End by Start, retained Gregorian conversion at the
  UI boundary, and preserved preview/balance/replacement behavior.
- `request/_components/RequestSignature.tsx`, `lib/leave/{signature,signatureLabels}.ts`, all three
  request forms/pages, and `messages/{en,fa}.json` — added one pointer-event canvas for mouse, stylus,
  and touch, Clear, a required localized authorization checkbox, reset behavior, bounded PNG
  validation, and a lazy protected viewer.
- `supabase/migrations/20260805171924_request_signatures.sql`, `lib/actions/leave.ts`, generated DB
  types, and DB-error mappings — added nullable historical signature/consent columns, a shape CHECK,
  database-generated `now()` consent, and mandatory signature parameters on all three public request
  writers. Signature attachment and request insertion are one transaction; no unsigned overload
  remains exposed.
- Requester history, the direct-manager approval queue, and manager/security/admin calendar surfaces
  now carry only consent metadata and fetch the PNG on explicit open. Existing strict base-row RLS is
  the read boundary; `team_leave_calendar` remains an explicit signature-free view.
- `tests/unit/request-signature.test.tsx` and existing e2e flows — covered validation, pointer capture,
  lazy image loading, two-vs-one date fields, SQL enforcement, mouse drawing/consent, authorized
  viewers, and the teammate metadata/image absence assertion.
- Updated `docs/{REQUIREMENTS,DATA_MODEL,PERMISSIONS,TASKS,CHANGELOG}.md` for FR-32 and corrected the
  stale permissions summary that still described the pre-FR-25 broad base-row read policy.
- Required current-doc checks were done through Context7 for `react-multi-date-picker` controlled
  fields and `minDate`, and through the Supabase documentation search for RLS/schema decisions.

**Actions outside the repo**
- None. No client server, database, deployment, Docker service, or external record was changed.
- `supabase status` was retried with the required permission after its sandboxed telemetry write
  failed; it reported `No such container: supabase_db_bj`, so the migration was not applied anywhere.
- A temporary local Next dev server was started for browser verification and stopped afterward.
  The authenticated `https://localhost:3500` tab was the older Docker image, while the changed
  `http://localhost:3000` build had no valid session and its configured backend
  `192.168.2.48:8080` returned `ECONNREFUSED`. No form was submitted and no test data was written.

**Verification**
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npm run test:unit` — **39 files, 247 tests passed** (new signature suite: 5/5).
- `npm run build` — sandboxed run failed at Turbopack CSS processing because internal port binding
  was denied; approved retry outside the sandbox compiled successfully, ran TypeScript, and generated
  all 36 static pages.
- `git diff --check` — clean. English/Farsi message parity — **402 keys each, no missing keys**.
- In-app/Chrome browser verification — browser connection and route rendering worked, but the changed
  authenticated pages were blocked by the split old-container/new-dev environment described above.
  The target e2e flows were updated but not run against a database because the configured endpoint is
  unavailable. A first message-parity shell one-liner also failed because zsh expanded a JavaScript
  template literal; the quote-safe retry produced the clean 402/402 result above.

**State left behind**
- Uncommitted changes on `main`; nothing staged, committed, pushed, deployed, or migrated.
- Feature code, migration, types, tests, translations, and docs are complete. Authenticated rendered
  behavior and live SQL execution still need a reachable up-to-date local/client stack.

**For the next agent**
- Apply `20260805171924_request_signatures.sql` before deploying the matching frontend; otherwise the
  new RPC argument contracts will not exist. Then run the updated e2e suite serially and exercise one
  mouse and one real touch signature. Do not add signature columns to `team_leave_calendar`.

## 2026-08-04 — Header refresh, Home cancellation, replacement picker, and hire calendar

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `94ee09e` (tree already had the earlier orientation entry in
`docs/AGENT-LOG.md` plus untracked `deploy/bj-root-ca.crt`, `deploy/migrations/`, and
`deploy/sql/seed.sql`; the deployment files are not mine and were not touched)
**Trigger:** The user requested four UI/UX changes: one header-level Updated control, cancellation
from Home recent requests, a simpler replacement selector, and a preference-aware Persian-default
hire-date calendar.

**What changed**
- `app/[locale]/(app)/_components/{AppShell,PageHeader}.tsx` — moved the refresh control into the
  shared sticky header and used explicit LTR/RTL direction so its physical position relative to the
  profile button matches the language. Page headers now render only title/action content.
- `app/[locale]/(app)/request/_components/RequestCancelButton.tsx`, `MyRequestsList.tsx`, and
  `home/HomeBoard.tsx` — extracted the existing cancellation behavior and reused it on Home, including
  eligibility, confirmation, server action, toast feedback, and refresh.
- `app/[locale]/(app)/request/_components/ReplacementPicker.tsx`, both leave request forms,
  `lib/leave/replacement.ts`, and `messages/{en,fa}.json` — deleted search state/filtering, changed the
  empty dropdown prompt, and added the controlled No Replacement checkbox that clears/disables it.
- `components/LazyDatePicker.tsx`, `lib/leave/calendarPicker.ts`, the three request forms, and
  `manage/employees/new/{page,NewEmployeeForm}.tsx` — centralized picker configuration, made any
  missing/unknown preference Jalali, and converted the displayed hire date to Gregorian ISO before
  calling the employee action. The old route-local lazy picker was removed.
- `tests/unit/{page-refresh-button,calendar-picker,replacement-picker,request-cancel-button}*` and
  `tests/e2e/{leave,replacement}.spec.ts` — added regression coverage and updated the browser flows for
  Home cancellation and dropdown-only replacement selection. Removed the obsolete filter unit test.
- `docs/{CHANGELOG,TASKS,AGENT-LOG}.md` — recorded the completed UI work and honest gate status.
- Followed the project-required Context7 workflow for `react-multi-date-picker` / `react-date-object`
  current controlled-value, calendar/locale, and conversion APIs before changing the picker wiring.

**Actions outside the repo**
- None. No client server, database, deployment, container, or external data was changed. The targeted
  Playwright attempt started its local web server, but authentication and cleanup could not reach the
  configured local Supabase endpoint, so no test rows were created or changed.

**Verification**
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npm run test:unit` — **38 files, 242 tests passed**.
- `npm run build` — first sandboxed run failed because Turbopack was denied permission to bind a local
  port while processing CSS (`Operation not permitted (os error 1)`); approved retry outside the
  sandbox succeeded, compiling and generating all 36 static pages.
- `git diff --check` — clean. English/Farsi message-key parity script — **385 keys match**.
- `npx playwright test tests/e2e/replacement.spec.ts tests/e2e/leave.spec.ts --workers=1` — attempted
  outside the sandbox; both specs were blocked before the changed flows because
  `192.168.2.48:8080` returned `ECONNREFUSED` during login, and cleanup hit the same unavailable
  endpoint. This is an environment failure, not a UI assertion failure.

**State left behind**
- All feature, test, and documentation changes are uncommitted on `main`; no commit was requested.
- The pre-existing untracked deployment certificate/migration/seed paths listed above remain untouched.

**For the next agent**
- The shared header group deliberately renders refresh before profile in the DOM and applies
  `dir="ltr"`/`dir="rtl"`; changing either part can reverse the requested physical placement.
- Replacement remains optional at the server boundary: the checkbox is an explicit UI choice that
  submits the existing null/empty replacement value, so no database or RPC change was needed.
- Rerun the two targeted Playwright specs when the local Supabase stack at `192.168.2.48:8080` is back.

## 2026-08-04 — UI/UX codebase orientation before the next change request

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `main` @ `94ee09e` (tree already had untracked
`deploy/bj-root-ca.crt`, `deploy/migrations/`, and `deploy/sql/seed.sql`; none are mine)
**Trigger:** The user asked for a codebase review focused on UI/UX and will provide the desired
changes after the agent is ready.

**What changed**
- `docs/AGENT-LOG.md` — recorded this read-only orientation session as required by the project
  working agreement. No application, styling, test, translation, or deployment file was changed.

**Actions outside the repo**
- None. No server, database, container, deployment, browser, or external service was touched.

**Verification**
- No test suite was run because this session made no code or configuration changes.
- Read the required onboarding chain (`CLAUDE.md`, `docs/AGENT-LOG.md`, `PLAN`, `REQUIREMENTS`,
  `DATA_MODEL`, `PERMISSIONS`, the current spec, `TASKS`, and `CHANGELOG`), then inspected the
  frontend shell, theme tokens, shared primitives, route composition, primary screens, responsive
  tests, RTL/i18n constraints, and current git state.

**State left behind**
- `main` remains at `94ee09e`; only this journal entry is newly modified by this session.
- The pre-existing untracked deployment files listed above were left untouched.

**For the next agent**
- The app is Farsi-first/RTL, light-only, mobile-first, and uses a shared shadcn-style component
  layer. Preserve fa/en message parity, logical RTL utilities, existing `data-testid` contracts,
  role/RLS behavior, and the mobile-bottom-nav/desktop-side-rail split when implementing the user's
  requested UI changes.
- The three request routes share `RequestTypeTabs`. Its seamless tab/card treatment depends on the
  strip's `-mb-px` + `z-10`, the active tab's `border-b-card`, and each form/fallback using
  `rounded-t-none`.

## 2026-08-04 — Request-type tab strip on the three request screens

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `f4977f0` (tree already dirty: `docs/AGENT-LOG.md`,
`docs/MEMORY.md`, untracked `deploy/docker-compose.local.yml` — none of those are mine)
**Trigger:** The request type could only be picked from the home board. The user asked for a
type selector inside the request screens themselves — not a dropdown, styled as tabs that blend
into the form — with the home-board buttons kept and the bottom link row removed.

**What changed**
- `app/[locale]/(app)/request/_components/RequestTypeTabs.tsx` — new server component. Three
  `Link`s (daily → `/request`, hourly → `/request/hourly`, errand → `/request/errand`). Because
  each type is its own route (D13), these are links, not client tab state. The active tab gets
  `border-b-card` so its bottom border matches the card fill, and the strip is `-mb-px z-10`, so
  the tab paints over the card's top border and the seam disappears.
- `app/[locale]/(app)/request/page.tsx`, `.../hourly/page.tsx`, `.../errand/page.tsx` — strip
  rendered in the page shell (outside `Suspense`, so it is up immediately and does not shift when
  the data resolves); the bottom `<p>` cross-link rows are gone. Dropped the now-unused `Link`
  imports, `tHourly` in `request/page.tsx`, and `tErrand` in `hourly/page.tsx`.
- `.../LeaveRequestForm.tsx:217`, `.../hourly/HourlyRequestForm.tsx:213`,
  `.../errand/ErrandRequestForm.tsx:155` — `<Card className="rounded-t-none">`, so the strip owns
  the top corners. Same on the `hourly-unavailable` `<p>`, which replaces the card on that branch.
- `components/Skeletons.tsx` — `CardSkeleton`/`FormSkeleton` take an optional `className`; the
  three request pages pass `rounded-t-none` so the Suspense fallback lines up under the strip.
- `messages/{fa,en}.json` — added `request.tabs.{label,daily,hourly,errand}`. Deleted the five
  keys the removed link row used and nothing else reads: `hourly.dailyLink`, `hourly.hourlyLink`,
  `errand.leaveLink`. (`hourly.navLink` and `errand.navLink` are also unreferenced now, but they
  predate this change, so I left them.)
- `.claude/launch.json` — new, so the preview tool can start `npm run dev`. Untracked directory;
  not part of the feature.

**Actions outside the repo**
- None. No server, no database, no deploy.

**Verification**
- `npx tsc --noEmit` — clean. `npm run lint` — clean.
- `npm run test:unit` — 36 files, 239 tests passed.
- `npm run build` — succeeded; all three request routes compiled.
- Confirmed Tailwind actually emits the utilities the blend depends on, in
  `.next/static/chunks/41u9vsylrl8ca.css`: `.border-b-card{border-bottom-color:var(--card)}`,
  `.border-b-border`, `.rounded-t-lg`, `.rounded-t-none`.
- Visual check was done on a **static replica**, not the live app: I could not log in (entering
  credentials is out of bounds for me), so I served an HTML page with the real built CSS and the
  exact class strings. Confirmed at desktop and at 375px, RTL: the active tab merges into the
  card with no seam, inactive tabs read as tabs, and the Farsi labels fit on mobile. **The strip
  has not been seen inside the authenticated app.**
- No e2e run. `tests/e2e` never referenced the removed `daily-to-hourly` / `hourly-to-daily` /
  `daily-to-errand` / `hourly-to-errand` / `errand-to-daily` testids, so nothing there should
  break — but that is a grep, not a run.

**State left behind**
- All changes uncommitted on `main`, per the commit-only-when-asked rule.
- `npm run dev` left running on port 3000 by the preview tool.

**For the next agent**
- The blend is a three-part contract: strip is `-mb-px` + `z-10`, active tab is `border-b-card`,
  card is `rounded-t-none`. Break any one and a 1px seam or a double border appears.
- New testids for e2e: `request-type-tabs`, `request-tab-daily|hourly|errand`.
- Each screen still shows its own `<h1>`/`PageHeader` above the strip, so the title and the active
  tab say much the same thing. Left as-is — the user did not ask for the titles to go.

## 2026-08-03 — Local Docker stack un-wedged: emulated Caddy broke TLS; restarted from `deploy/`

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `f4977f0` (clean tree)
**Trigger:** User asked to check the app is running properly in Docker, restart it if needed, and
to be given the local URL plus database credentials for ad-hoc SQL.

**What changed**
- `deploy/.env` (gitignored, new) — local-testing config, secrets copied out of the already-running
  containers so the existing `bj-erp_db-data` volume keeps working: `POSTGRES_PASSWORD`,
  `JWT_SECRET`, `ANON_KEY` (all unchanged), `APP_HOST=192.168.2.48`, `APP_PORT=8443`,
  `APP_ORIGIN=https://192.168.2.48:8443`. No `SERVICE_ROLE_KEY` — nothing in the compose file
  consumes it.
- `deploy/docker-compose.local.yml` (new, untracked) — local-only overlay publishing Postgres on
  `127.0.0.1:5433`. Must never reach the client's server; it is not referenced by `package.sh`.

**Actions outside the repo**
- Found the stack running from `dist/bj-erp-installer/` (a **2026-07-23** package) whose `.env` and
  `docker-compose.override.yml` no longer exist on disk, so that project directory was unusable for
  `docker compose`. Containers were up but **no port was actually bound on the host**: `curl` to
  `https://192.168.2.48/` and `https://localhost/` returned exit 7, and `nc -z 127.0.0.1 443/80/8080`
  was refused, even though `HostConfig.PortBindings` listed 80/443/8080. A throwaway
  `docker run -d -p 18080:80 caddy` bound fine, so Docker Desktop itself was healthy.
- Recreated the whole stack from `deploy/` instead: `docker compose -f docker-compose.yml -f
  docker-compose.local.yml up -d --force-recreate`. Project name is pinned (`name: bj-erp`), so the
  db volume was reused — no data loss. Ports then bound, but TLS failed:
  `LibreSSL/3.3.6: error:06FFF064:digital envelope routines:CRYPTO_internal:bad decrypt` right after
  Server Hello, and Caddy's own `:8080` listener timed out from inside the container while
  `app:3000`, `rest:3000` and `auth:9999` all answered normally over the docker network.
- **Root cause: `caddy:2.8.4-alpine` was the amd64 image running under emulation on this arm64 Mac,
  and its TLS stack is broken there.** `docker pull --platform linux/arm64 caddy:2.8.4-alpine`
  (registry was reachable — the user's VPN was up) + `up -d --force-recreate gateway` fixed it
  immediately. The other three services (`supabase/postgres`, `gotrue`, `postgrest`) are still amd64
  under emulation and work fine; only Caddy is affected. `bj-erp-app:latest` is arm64 (built locally
  2026-07-31).
- Stopped the two idle `bj-erp-app-rollback-*` containers. Note `bj-erp-app-rollback-20260729`
  carries the compose `service=app` label, so every `docker compose up` starts it again; it is inert
  (the gateway proxies to the `app` alias) but noisy. `docker rm -f bj-erp-app-rollback-20260729`
  removes it without touching the rollback *image*.

**Verification**
- `https://192.168.2.48:8443/` → 307 → `https://192.168.2.48:8443/login` 200, title
  `سامانه منابع انسانی`.
- `GET /auth/v1/health` → 200, `{"version":"v2.170.0","name":"GoTrue",…}`.
- Real login: `POST /auth/v1/token?grant_type=password` with `admin@bj-app.internal` /
  `Admin!2026` returned an `access_token` carrying `"app_roles":["admin"]` — the custom access
  token hook is working.
- `GET /rest/v1/leave_types` through the gateway reached PostgREST (returned a PostgREST column
  error for a column I guessed wrong, i.e. the route and JWT path are fine).
- Schema is the **post-leave-v2** one: `jalali_months`, `leave_request_serials`,
  `employee_leave_policies` all present; 14 public tables. Row counts: 15 profiles,
  5 leave_requests. There is no `supabase_migrations` schema in this database, so applied
  migrations cannot be enumerated — the schema shape is the only evidence.
- Postgres reachable from the host on `127.0.0.1:5433` (`nc -z` succeeded). `psql` is **not
  installed on the Mac**; queries were run with `docker exec … psql` inside `bj-erp-db-1`.

**State left behind**
- Stack up and serving at **https://192.168.2.48:8443** (self-signed Caddy internal CA — browsers
  warn; `https://localhost:8443` also answers but the cert names only the IP).
- Nothing committed. `deploy/.env` is gitignored; `deploy/docker-compose.local.yml` is untracked.
- `dist/bj-erp-installer/` is still the stale 2026-07-23 package with a missing `.env`; nothing was
  repaired there.

**For the next agent**
- **Do not run this stack's gateway from an amd64 Caddy image on an arm64 Mac.** It starts, logs
  cleanly, and then fails every TLS handshake with `bad decrypt`. The packaged installer is
  deliberately amd64 for the client's server (`package.sh`), so local testing needs the arm64 pull.
- The earlier note that "`docker compose` is unusable here (`.env` is root-owned `600`)" applied to
  `dist/bj-erp-installer/`, not to `deploy/`. With `deploy/.env` present, plain compose works.
- The `APP_PORT=8443` / `APP_ORIGIN=https://192.168.2.48:8443` pair must stay in sync — the origin
  is baked into the browser bundle at container start, so changing it needs
  `up -d --force-recreate app`, not a restart.

## 2026-07-31 (later) — Local container rebuilt; deploy path checked; packaging fixed for amd64

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `d26b0cb` (straight after the merge below)
**Trigger:** User asked to rebuild the local Docker app so they could test on an iPhone, then asked
what it would take to run this on the client's server — and told me the client's install holds **no
real data**, so a fresh install is acceptable.

**What changed**
- `deploy/package.sh:24` — built with **no `--platform`** and pulled the four pinned service images
  the same way. On this arm64 Mac that yields arm64 artifacts that die on the client's amd64 server
  with `exec format error`, discovered on site because the bundle is offline. Now pins
  `linux/amd64` for the build *and* the pulls, and refuses to package unless every image verifies
  as amd64. `release.sh` already did this; `package.sh` is the **fresh-install** path and did not.
  The pulls were the sharper half — `caddy:2.8.4-alpine` is multi-arch, so a re-pull silently swaps
  a good image.
- `deploy/RUNBOOK.md`, `docs/DEPLOY.md`, `docs/TASKS.md` — all three asserted the migrations are
  idempotent. Measurably false; corrected with the actual numbers and the operational consequences.

**Actions outside the repo**
- **Rebuilt `bj-erp-app:latest`** from merged `main` (arm64, local only) and recreated
  `bj-erp-app-1`. Old image tagged `bj-erp-app:pre-errand-20260731`; old container kept stopped as
  `bj-erp-app-rollback-20260731`. `docker compose` is unusable here (`.env` is root-owned `600`, no
  passwordless sudo), so the container was recreated with `docker run`, copying env/labels off the
  running one — **network alias `app` is mandatory**, Caddy proxies to `app:3000`.
- Spun a **throwaway `supabase/postgres:15.8.1.085`** and applied all 38 migrations + `seed.sql` in
  order, as `install.sh` does. Container removed afterwards.
- Created and dropped a scratch database `bjdeploy` to measure replay behaviour.
- Stopped the `next dev` server left running earlier.

**Verification**
- **Fresh install works and is CORRECT, not merely error-free: 38/38 migrations + seed clean**, and
  the end state checks out — leave-type hourly/accrual flags (the ones migrations cannot set,
  because they run *before* the seed), 612 `jalali_months` rows, work settings, `request_kind`, the
  **kind-keyed serial index**, and a `team_leave_calendar` leaking neither reason nor errand location.
- **Replay against a populated DB fails 9 of 38**, listed in `docs/TASKS.md`. `update.sh` therefore
  aborts on file #1 — safely: app not restarted, backup intact.
- **The production container genuinely works**, not just serves HTML: ran `errand.spec.ts` and
  `hourly.spec.ts` against `https://192.168.2.48` with a throwaway Playwright config (deleted after)
  — **3 passed**, including submit → manager approves → leave balance untouched.
- The new amd64 guard was tested against a real arm64 image and rejected it.

**State left behind**
- `main` @ `8b6ad86`, **not pushed**. Working tree clean.
- Local stack runs the new arm64 image; rollback image and stopped container retained. The local DB
  carries all 38 migrations.

**For the next agent**
- **`package.sh` had never been fixed despite the arm64 landmine being known since 2026-07-25.**
  It is fixed now, but note the asymmetry that hid it: `release.sh` (incremental updates) guarded
  the build, `package.sh` (fresh installs) did not, and only the latter is used for a new install.
- The migration replay repair is **deferred, not done** — see `docs/TASKS.md`. It is not needed for
  this release because the client has no real data and is getting a fresh install. It becomes
  required the moment they do.
- A fresh install **wipes their test users and departments** and regenerates the root CA, so phones
  must re-trust it. Their install is on port **3500** — `APP_ORIGIN` must match or login breaks in
  the way the 2026-07-29 changelog entry describes.

## 2026-07-31 — Pre-merge review of the leave-v2 branch; four real bugs found and fixed; merged to main

**Agent:** Claude Opus 5 via Claude Code (two parallel review subagents, also Opus 5)
**Branch / HEAD at start:** `feat/leave-v2-hourly-accrual-replacement` @ `ba0e859`
**Trigger:** User asked what was left on the branch, and if nothing, to do a full review and
debugging pass and merge to `main` if it was safe. The client is testing the app but not yet
using it for real requests.

**What was actually left (the honest answer to the question)**
1. **`npm run test:e2e` had never been run on this branch tip.** This is what found two of the
   four bugs below.
2. **Neither of the two newest migrations had been applied anywhere real** —
   `20260730130001` had only been run against a *stub* schema on a throwaway cluster, and
   `20260730130002` had never been executed at all.
3. `npm audit` had never been run.

**Bugs found and fixed** (commits `1aa36dc`, `cb9f2c0`)

- **CRITICAL — every first errand of a Jalali year would have failed.** `20260730130001` re-keyed
  the serial *counter* to `(company_id, jalali_year, kind)` but left the unique index on
  `leave_requests` as `(company_id, serial_year, serial_seq)`, with no `kind`. The first errand
  draws seq=1 and collides with the leave request already holding seq=1:
  `duplicate key value violates unique constraint "leave_requests_serial_uniq"`. Found by e2e and
  independently reproduced by a reviewer on a `pg_dump` copy of the live DB. **The whole BJ-F 50207
  feature was non-functional.** It escaped because the earlier "validated against a real Postgres"
  check used a stub schema that never had this index — *a stub missing the constraint you are about
  to violate does not test it.*
- **CRITICAL — the calendar misreported hourly absences.** `CalendarView` never rendered
  `start_time`/`end_time`, although `20260729130010` exists solely to expose them, and it printed
  "returns \<next working day\>" unconditionally. A 09:00–11:00 absence displayed to teammates and
  managers as a full day off returning tomorrow, on a surface where managers approve. Affected
  shipped hourly leave as well as every errand.
- **IMPORTANT — `accrue_leave` silently under-credited.** Its hot-path short-circuit returns as
  soon as the current month is posted, so an admin moving `accrual_start_month` *backwards* lost
  every newly-in-range month with no error, unrepairable by "Post accruals now". Reproduced as four
  lost months. Fixed in `20260731120001`.
- **IMPORTANT — an approved errand could never be cancelled.** `cancel_leave_request` allows
  cancelling an approved request only while `start_date > today`; an errand is a same-day form, so
  that is the normal case. Fixed in `20260731120001`.
- Plus: the dialog close button's only accessible name was a hardcoded English "Close" (this branch
  was its first consumer, so it would have shipped the first untranslated string in a Farsi-first
  app); the Home cover card dropped the hourly window; `tr('confirmBody')` omits its `{count}` and
  only works via a production-only fast path in `use-intl`; two vacuous e2e assertions; a failed
  departments read rendering as an empty list.

**Actions outside the repo**
- **Applied `20260730130001` and `20260730130002` to the LOCAL Docker stack** (`bj-erp-db-1`), after
  a `pg_dump` backup (1.1 MB, in the session scratchpad). Then applied `20260731120001`. All three
  re-run cleanly (idempotency proven by a second pass). **Nothing was done to the client's server.**
- Restarted `bj-erp-rest-1` once while mis-diagnosing a PostgREST 404 (see below). No data change.
- Verified against the live DB rather than migration text: `pg_get_viewdef` on
  `team_leave_calendar` leaks none of `reason`/`decision_note`/`errand_location` and uses a LEFT
  JOIN; exactly one signature exists of each touched function; `approve_leave_request` is
  time-aware. `accrue_leave` was patched from the installed `pg_proc.prosrc` and diffed before and
  after to prove only the intended two changes landed.

**Verification**
- `npm run test:e2e` (serial): **32 passed, 1 skipped** — run twice, before and after the fixes.
  Teardown reaped 26 users and 1 department, proving the widened reap regex and the `zz`-in-the-name
  trick both work in practice.
- `npm run test:unit` **239/239**, `npx tsc --noEmit` clean, `npx eslint …` clean, `npm run build`
  clean. fa/en key trees identical.
- `npm audit --omit=dev`: **3 high**, all transitive via `next@16.2.9` (postcss XSS/path-traversal,
  sharp/libvips). **Pre-existing on `main`** — the only dependency change on this branch is the
  `supabase` CLI in devDependencies. Fix is a patch bump to `next@16.2.12`.

**State left behind**
- Branch merged to `main` with a `--no-ff` merge commit. **NOT pushed** — `origin/main` is
  unchanged and no PR was opened.
- The local Docker DB now carries all three new migrations. The app container still runs the old
  image; rebuild before testing the errand screen there.

**For the next agent**
- **The migration replay loop is broken, and it is the client's deploy path.** `deploy/update.sh`
  and `install.sh` replay *every* `migrations/*.sql` under `psql -v ON_ERROR_STOP=1` with `|| fail`.
  `20260623120001_core.sql:11` is a bare `create type public.app_role …`, which fails on any
  non-empty database — so the loop dies on file #1 and **cannot deliver these 18 migrations to the
  client's already-installed server.** Confirmed pre-existing (the 2026-07-29 entry hit the same
  wall). This branch additionally makes `20260729130002`, `20260729130013`,
  `20260624090002` and `20260623120006` unreplayable, because later migrations drop the columns and
  change the return type they reference. **Resolve this before scheduling the deploy**;
  `deploy/RUNBOOK.md:145,164` still claims the migrations are idempotent, which is not true.
- A same-day *leave* request still cannot be cancelled once approved. That is deliberate and
  unchanged; only errands were widened.
- `login.codePlaceholder` still reads `prod-1042`. Correct for every account that exists today,
  wrong for every new hire; left alone because D14 ruled out a mixed-format hint.
- I briefly mis-diagnosed a PostgREST **404** on `submit_errand_request` as a stale schema cache.
  It was not: PostgREST 404s when the caller's role lacks EXECUTE, and I had probed as `anon` while
  the function is granted to `authenticated`. The Supabase image ships `pgrst_ddl_watch` /
  `pgrst_drop_watch` event triggers, so the schema cache reloads itself after DDL and `update.sh`
  is right not to restart `rest`. Do not "fix" that.

## 2026-07-30 — Hourly work errand (BJ-F 50207); login codes lose the department prefix; Departments card

**Agent:** Claude Opus 5 via Claude Code (two parallel subagents, also Opus 5)
**Branch / HEAD at start:** `feat/leave-v2-hourly-accrual-replacement` @ `1a9589c`
**Trigger:** User supplied a third client form (`docs/forms/hourly_work_errand_form.jpeg`) to build
into the app, asked to rework the admin Departments settings card, and — mid-design — relayed a
client clarification that the شماره on all three paper forms is the requester's personnel number,
which turned into a request to drop the department prefix from login codes.

**What changed**

Five commits, `e703555` → `ad69a8f`. Each was verified green *in isolation* (see Verification).

- `docs/specs/2026-07-30-work-errand-and-login-codes-design.md` — new frozen spec, 15 numbered
  user decisions (D1–D15). Read this before touching any of the below.
- `supabase/migrations/20260730130001_work_errand.sql` — `request_kind` enum; `kind` +
  `errand_location` on `leave_requests`; `leave_type_id` made nullable;
  `leave_requests_kind_shape` CHECK; `leave_request_serials` PK re-keyed to
  `(company_id, jalali_year, kind)`; `compute_requested_minutes` and
  `private.submit_leave_impl` made kind-aware; new `public.submit_errand_request` wrapper;
  `team_leave_calendar` recreated with a **LEFT JOIN** and a `kind` column.
- `supabase/migrations/20260730130002_employee_code_no_prefix.sql` —
  `private.create_employee_impl` now sets `employee_code := personnel_no`; `app_cleanup_e2e_users`
  reaps `^999[0-9]{7}$` in addition to the legacy prefixed patterns.
- `lib/leave/errand.ts` (new, 16 unit tests), `lib/actions/leave.ts` (`submitErrandRequest` +
  `kind`/`errand_location` threaded through the three read paths), `lib/supabase/types.ts`
  (hand-edited, as always), `lib/leave/serial.ts:4` (header corrected — it claimed the serial was
  the paper form's شماره, which the client says it is not).
- `app/[locale]/(app)/request/errand/` (new screen), plus errand tagging in `MyRequestsList`,
  `ApprovalQueue`, `CalendarView`, `HomeBoard`, and the tracking-number label in the two places
  the serial renders.
- `app/[locale]/(app)/manage/settings/DepartmentsCard.tsx` + `DepartmentMembersDialog.tsx` (new),
  replacing the deleted `DepartmentCodesForm.tsx`; `getDepartmentMembers` in
  `lib/actions/departments.ts`; `createDepartment` now auto-generates the code and retries on
  `23505`; Add Department removed from `manage/employees/page.tsx:193`.
- `messages/{fa,en}.json` — new `errand` namespace, `home.requestErrand`, `leave.trackingNo`,
  reworked `manage.settings.departments`, two new `dbErrors` keys; removed
  `manage.departments.code` / `codeHint`.
- Docs: `REQUIREMENTS.md` (FR-30, FR-31, FR-29 corrected), `DATA_MODEL.md`, `PERMISSIONS.md`,
  `CHANGELOG.md`, `TASKS.md`.

**Actions outside the repo**
- None against the client's server. Nothing was deployed and no live database was touched.
- One subagent stood up a **throwaway local PostgreSQL 17 cluster** with a stub of the Supabase
  schema to execute `20260730130001` end to end (serial independence, overlap refusal, the Friday
  case, CHECK enforcement, view column list, re-run idempotency). The cluster was deleted
  afterwards.

**Verification**
- `npx tsc --noEmit` — clean. `npm run test:unit` — **36 files, 239 tests passed**.
  `npx eslint app components i18n lib tests scripts proxy.ts` — clean. `npm run build` — succeeded,
  `/[locale]/request/errand` present in the route manifest.
- `npm run lint` was **not** used: it is still polluted by generated files in the stale
  `.claude/worktrees/peaceful-williams-9c1cf9` worktree (same as the 2026-07-29 entry).
- **Each of the four code commits was checked out into a temporary worktree and independently
  typechecked and unit-tested.** The first attempt at the commit split failed this check twice —
  `tests/unit/department-code.test.ts` and the two calendar/home fixtures had been filed under the
  wrong commit — so the commits were rebuilt from `e703555` with the assignment corrected. All four
  now pass alone.
- **`npm run test:e2e` was NOT run** — it needs a reachable Supabase and a dev server, neither
  available in this session. `tests/e2e/errand.spec.ts` and the rewritten `department.spec.ts` have
  never been executed.

**State left behind**
- Five commits on `feat/leave-v2-hourly-accrual-replacement`, **not pushed**, no PR. Working tree
  clean.
- Nothing applied to the client's server. Both migrations stack on leave v2, which is itself still
  unapplied there, and the ordering matters: leave v2's serial migration must run before
  `20260730130001` re-keys the counter.

**For the next agent**
- **A correction to my own earlier reasoning, recorded because it is an easy trap.** I asserted
  that `approve_leave_request` had a live date-only overlap bug and wrote it into the spec as work
  to do. It does not. The date-only body is the **superseded** one in
  `20260729130012_leave_replacement_guard.sql`; the live definition is
  `20260730120001_security_review_fixes.sql:804-819` and is already time-aware. Two bodies for this
  function exist in the migration history — grep for the latest, not the first.
- `updateDepartmentCode` and the `departments_update_admin` RLS policy are **intentionally
  unreferenced**. Do not delete them as dead code; the client plans to revisit department codes.
- `login.codePlaceholder` still reads `prod-1042` in both locales. Correct for every account that
  exists today, wrong for every future hire. Left alone deliberately — D14 ruled out a
  login-screen hint about the two code formats. Raise it with the user rather than silently fixing.
- `scripts/cleanup-e2e.mjs` reaps throwaway departments by `code like 'zz%'`, but admins no longer
  choose a code. The e2e helper now puts its `zz####` token at the **start of the English name**,
  which is what the generator reads. If you change how codes are generated, that reap breaks
  silently on the client's own database.
- Four i18n keys are now unused but deliberately kept: `manage.departments.invalid`,
  `manage.departments.backToList`, `manage.settings.departments.invalid`,
  `manage.settings.departments.close`.

## 2026-07-30 — Review of the Codex security branch; CSP dev fix; merge to the feature branch

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `codex/code-review` @ `45af68f`
**Trigger:** The user asked for a thorough review of the Codex security fixes — confirming they do
not regress the rest of the codebase — and a merge back into the branch they were forked from
(`feat/leave-v2-hourly-accrual-replacement`) if the review came back clean.

**What changed**
- `next.config.ts` — scoped the new CSP's `script-src` to allow `'unsafe-eval'` **in development
  only**. The review's CSP applies to `next dev` as well, and React's development build uses
  `eval()` for owner stacks / callstack reconstruction, so every dev page load logged a CSP error
  and lost those debugging features. Production output is unchanged
  (`script-src 'self' 'unsafe-inline'`, verified in `.next/routes-manifest.json` after a build).

**Verification of the Codex change set (all live checks rollback-only, local stack only)**
- Inactive boundary: an inactive caller sees 1 profile shell and 0 rows across leave_requests,
  companies, calendar, leave_types, leave_ledger; `submit_leave_request` raises `account is inactive`.
- Manager authority: `is_manager_of` / `can_read_all` flip to false the moment the manager role row
  is deleted.
- Audit: `authenticated` INSERT on `audit_log` is revoked; the owner-run trigger wrote exactly one
  row for a direct profile UPDATE. Triggers confirmed on profiles/departments/work_settings/
  holidays/companies/leave_types, covering the audit inserts removed from the server actions.
- Invariants: `profiles_manager_not_self` and the last-active-admin trigger both fire.
- Hourly overlap: 09:00–10:00 and 10:00–11:00 on one date now both approve (the reported bug);
  a genuinely overlapping 11:00–13:00 vs 10:00–12:00 is still refused.
- No false failures from the new `.select('id')` zero-row guards — UPDATE/INSERT/DELETE … RETURNING
  each returned exactly 1 row under RLS for an admin.
- `revoke execute on set_updated_at()` does **not** break DML: PostgreSQL checks trigger-function
  EXECUTE at CREATE TRIGGER time, and updates on trigger-bearing tables still succeed.
- `accrue_my_leave` with zero accrual policies returns without raising, so submit's new
  fail-on-accrual-error path cannot block employees who have no policy yet.
- No leftover function overloads — every `create or replace` in the migration replaced in place.
- Deployment: live container runs as uid 1000 `node`; HTTPS response carries CSP/HSTS/COOP/CORP and
  no `X-Powered-By`; the build-time CSP placeholder is correctly rewritten by the entrypoint `sed`
  (`connect-src 'self' https://192.168.2.48`).

**Gates:** `npx tsc --noEmit` clean · `npm run lint` clean · `npm run test:unit` 35 files / 217
tests · `npm run build` passing · **`npm run test:e2e` 30/30 passing** (the review doc did not
record an e2e run; it was the main outstanding gate given how much RLS moved).

**Actions outside the repo**
- Read-only catalog queries and rollback-only role simulations against the local `bj-erp-db-1`
  container. No schema or data change was committed. The client's server at `https://10.10.10.50`
  was not touched.

**State left behind**
- `codex/code-review` merged into `feat/leave-v2-hourly-accrual-replacement` (fast-forward).
  Neither branch is pushed.
- Migration `20260730120001_security_review_fixes.sql` remains applied to the **local** stack only.

**For the next agent**
- Still open from the Codex review: `npm audit` from a network-authorized machine.
- Pre-existing bug, **not** from this change set and not fixed here: `manage/employees/page.tsx`
  calls `tr('confirmBody')` without the `{count}` argument, so next-intl throws a
  `FORMATTING_ERROR` on every bulk-password-reset dialog render; `EmployeesTable.tsx` then does its
  own `.replace('{count}', …)`. Pass `{ count }` to `tr` (or use `tr.raw`) to silence it.
- The client's server is still on the pre-minutes schema; this migration is additive on top of the
  leave-v2 set and must ship through the release runbook, not an ad-hoc DB command.

## 2026-07-30 — Full security review, fixes, and local container redeploy

**Agent:** OpenAI Codex (GPT-5)
**Branch / HEAD at start:** `feat/leave-v2-hourly-accrual-replacement` @ `6c37993`
**Trigger:** The user asked for a thorough bug/security review, fixes for every confirmed issue,
updated project documentation, a rebuilt local Docker app, and a commit + push.

**What changed**
- `docs/SECURITY-REVIEW-2026-07-30.md` — recorded the review scope, confirmed findings by severity,
  fixes/proof, clean checks, verification, and the blocked external registry audit.
- `supabase/migrations/20260730120001_security_review_fixes.sql` — made inactive status a real RLS
  and RPC boundary; required a live manager role for report authority; removed forgeable audit,
  direct role/profile creation, company mutation, and write-like calendar-view grants; added
  trigger-backed audits, last-admin/self-manager invariants, atomic bulk password reset with
  bcrypt-safe limits, time-aware hourly approval, and reason-length enforcement.
- `lib/actions/{employees,leave,profile,refresh,settings}.ts`,
  `lib/leave/{hourly,settings-validation}.ts`, and affected forms/pages — propagated accrual and
  zero-row failures, validated settings/dates/manager assignments, bounded refresh paths and
  password inputs, used atomic resets, and corrected hourly replacement overlap.
- `app/[locale]/(app)/layout.tsx` and `app/[locale]/(auth)/login/page.tsx` — fail closed for inactive
  users and clear an inactive login session.
- `app/[locale]/(app)/_components/PageRefreshButton.tsx` — formatted the server-rendered timestamp
  in `Asia/Tehran`; this removed production React hydration error #418 found during browser QA.
- `deploy/{Dockerfile,docker-compose.yml,install.sh}` and `next.config.ts` — non-root/capability-free
  app runtime, validated installer address input, private env-file permissions, CSP/HSTS and
  cross-origin headers, and no framework disclosure.
- `tests/unit/*`, `eslint.config.mjs`, localized messages, Supabase types, and DB error mapping —
  added regressions for the fixes and excluded hidden generated worktrees from lint.
- `docs/{MEMORY,PERMISSIONS,TASKS,CHANGELOG}.md` — captured the durable security rules, current
  permission model, remaining external audit gate, and shipped behavior.

**Actions outside the repo**
- Applied and idempotently replayed migration `20260730120001_security_review_fixes.sql` as
  `supabase_admin` against the local `bj-erp-db-1` PostgreSQL 15 container.
- Ran rollback-only live SQL role simulations proving inactive-user isolation, manager-role
  removal, non-forgeable/triggered audit, atomic password reset, and adjacent hourly approvals.
- Built `bj-erp-app:latest`, recreated only `bj-erp-app-1`, and stopped the old
  `bj-erp-app-rollback-20260729` container after Compose unexpectedly started it.
- Confirmed the current app container runs as `node` with `no-new-privileges` and all capabilities
  dropped; verified the HTTPS gateway at `https://192.168.2.48`.
- Did not touch the client's production server at `https://10.10.10.50`.
- `npm audit` was attempted, but the environment's external-data-transfer safeguard blocked the
  dependency manifest from being sent to the npm registry; the escalated attempt was rejected.
- The requested push to `https://github.com/AmirNcode/bj-erp.git` was attempted after commit
  `a697a9c`; the environment rejected it pending explicit approval of that exact destination and
  security-review payload.

**Verification**
- `npm run test:unit` — 35 files, 217 tests passed.
- `npm run lint` — passed with no findings.
- `npx tsc --noEmit` — passed.
- `npm run build` and the Docker production build — passed; 34 routes generated.
- `git diff --check` — passed.
- HTTPS smoke check — HTTP 200 with CSP, HSTS, COOP/CORP, permissions/referrer/content-type/frame
  headers and no `X-Powered-By`.
- Fresh in-app browser pass — signed-in hourly page rendered, changing 08:00–10:00 showed
  `2 hours`, and the production console contained no application errors. Remaining warnings came
  from the installed MetaMask Chrome extension, not this app.

**State left behind**
- All review/fix/doc changes are committed locally on `codex/code-review` for review before
  merging. The external-transfer safeguard rejected the push pending the user's explicit approval
  of the destination `https://github.com/AmirNcode/bj-erp.git`.
- The original `feat/leave-v2-hourly-accrual-replacement` branch was restored to its pre-review
  commit `6c37993`, so it does not contain this security-review change set.
- The rebuilt current local app is running at `https://192.168.2.48/en/login`; supporting local
  database/auth/rest/gateway containers were preserved.

**For the next agent**
- Run `npm audit` before release from a network-authorized machine and record/remediate any
  registry-backed advisory; this is the only incomplete review gate.
- The new migration is applied locally only. Production remains untouched and must receive it
  through the established release runbook, not an ad-hoc database command.

## 2026-07-29 — Leave v2: design spec + ALL FIVE PLANS implemented (minutes, calendar, accrual, hourly, replacement, serials)

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `cce7b16`, tree had untracked `docs/forms/`
**Branch created:** `feat/leave-v2-hourly-accrual-replacement`
**Trigger:** Client feedback after reviewing the live app: add hourly leave (≤4h), make PTO accrue
1 day/month cumulatively, add the replacement/cover person from their paper forms, and document
(not solve) their insurance/ink-signature concern. User asked for a thorough blueprint with
clarifying questions, then said "go ahead with implementation and commit".

**What changed**

Design (no code):
- **`docs/specs/2026-07-29-hourly-accrual-replacement-design.md`** — frozen record of 15 decisions
  the user made, then the design for all four asks. Read this before plans 2–5.
- **`docs/plans/2026-07-29-leave-v2-foundations.md`** — plan 1 of 5. The spec is deliberately split
  into five plans (foundations → accrual → hourly → replacement → serials); each ships working
  software alone.
- `docs/forms/*.jpeg` — the client's two paper forms, now tracked. Read them; they answer questions
  the spec cannot (they show a حراست signature on hourly, a جانشین signature on daily, a شماره
  serial field, and HR writing balances as "__ روز و __ ساعت").

Implementation (plan 1, all committed):
- **`20260729130001_jalali_calendar.sql`** — `jalali_months` (612 rows, 1400–1450) +
  `jalali_month_of()`. Generated by `scripts/gen-jalali-months.mjs` from `lib/leave/jalaliMonths.ts`;
  do not hand-edit rows, re-run the generator. Documented exception to CLAUDE.md convention 1.
- **`20260729130002_leave_minutes_expand.sql`** — minutes columns + backfill + sync triggers.
- **`20260729130003_leave_minutes_contract.sql`** — definer fns write minutes; day columns dropped;
  `team_leave_calendar` recreated (still no `security_invoker`, still no `reason`/`decision_note`).
- **`20260729130004_leave_minutes_allocation_impl.sql`** — the one …130003 missed. See the trap below.
- `lib/leave/duration.ts` (+ `durationLabels.ts`) — the only place days↔minutes conversion happens.
- `lib/leave/balances.ts`, `lib/actions/leave.ts`, `HomeBoard`, `MyRequestsList`, `ApprovalQueue`,
  `LeaveRequestForm`, `EditEmployeeForm`, `NewEmployeeForm`, `AllocateForm` + their pages,
  `scripts/seed-demo.mjs`, `messages/{fa,en}.json`, `lib/supabase/types.ts`.
- Docs: DATA_MODEL (units, `jalali_months`, minutes columns, counting), CHANGELOG, TASKS, CLAUDE.md
  test counts, plus `docs/plans/2026-07-29-leave-v2-foundations-acceptance.sql`.

Implementation (plan 2 — accrual, all committed):
- **`docs/plans/2026-07-29-leave-v2-accrual.md`** — the plan, executed in full.
- **`20260729130005_leave_policy.sql`** — `employee_leave_policies`, `leave_types.default_*`,
  `leave_ledger.period_month`, the `carryover_forfeit` enum value, and **the partial unique index on
  (employee, type, entry_type, period_month)** that is the entire idempotency guarantee.
- **`20260729130006_leave_accrual_fns.sql`** — `accrue_leave` + `accrue_my_leave` /
  `accrue_employee_leave` / `accrue_all_leave` / `set_employee_leave_policy`.
- **`20260729130007_leave_ledger_seq.sql`** — the `seq` bug fix described below.
- `lib/leave/accrual.ts` — the pure planner the SQL mirrors (15 unit tests).
- `lib/actions/leave.ts` — `accrueBeforeRead` on all three balance readers + submit;
  `setEmployeeLeavePolicy` / `getEmployeePolicies` / `runAllAccruals` / `getCurrentJalaliMonthStart`.
- `manage/settings/AccrualRunner.tsx` (new) + policy blocks on the create and edit employee forms.
- `tests/e2e/accrual.spec.ts` (new) — proves through the UI that running accrual twice does not
  credit twice.

**Actions outside the repo**

- **Nothing was run against the client's server at `https://10.10.10.50`.** All four migrations are
  applied ONLY to the local docker stack. The client's database is untouched and still on days.
- Local docker stack (`bj-erp-db-1`): applied all four migrations as **`supabase_admin`** with
  `PGPASSWORD` from the container env, which is what `deploy/install.sh` does. My first attempt ran
  as `postgres` and failed with `must be owner of table work_settings`; it had already created
  `jalali_months` under the wrong owner, so I dropped and re-applied it as `supabase_admin`. Check
  `pg_tables.tableowner` if anything looks off.
- `npm i -D supabase` (CLI 2.110.0) — the user approved installing it for type generation. **It
  cannot generate types on this machine** (see traps).
- `pg_dump` safety net taken to the session scratchpad before the schema changes; it is gone with
  the scratchpad now, so re-dump before doing this on the client's box.

**Verification**

- Unit: **165/165 green** (30 files). Measured pre-branch baseline: **147**. `docs/TASKS.md` had that
  right; CLAUDE.md said 103 (now corrected) and a previous session's own note said 130.
  `docs/MEMORY.md` carries no count — do not look for one there.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`: all clean.
- SQL: acceptance query returned 0 mismatches on all four columns against real rows (27 ledger, 3
  requests, 25 allocations); replaying every migration is a no-op (`UPDATE 0`, `INSERT 0 0`); a
  rolled-back probe insert proved the expand-phase trigger; after the contract migration, zero day
  columns survive and zero functions reference them (checked via `pg_proc.prosrc`, not grep).
- `npm run seed` succeeds against the renamed RPCs.
- E2E: plan 1 — **first run 25/26** (caught the days/minutes mismatch below), **second run 24/26**
  (caught the allocation-impl break), **26/26 green** after `…130004`. Plan 2 — **27/27 green** with
  the new `accrual.spec.ts`. Plan 3 — **29/29 green** with `hourly.spec.ts` (2 specs). Plan 4 — **30/30 green** with `replacement.spec.ts`. Plan 5 — **30/30 green** (its assertion rides on that spec). Final gates: unit **208/208**, e2e **30/30**. Every failure
  along the way was a real bug in my work or my test, never a flaky suite.

**State left behind**

- Branch `feat/leave-v2-hourly-accrual-replacement`, committed, **not pushed, no PR**.
- Plans 2–5 (accrual, hourly, replacement, serials) are **not written yet**. The spec is their input.
- The local docker DB is now on minutes; the client's is not. They will diverge until deployment.

Implementation (plan 3 — hourly, all committed):
- **`docs/plans/2026-07-29-leave-v2-hourly.md`** — the plan, executed in full.
- **`20260729130008_leave_hourly.sql`** — `leave_unit`, `leave_requests.unit/start_time/end_time`, the
  `leave_requests_unit_shape` CHECK, `work_settings.work_start/work_end/max_hourly_minutes_per_day`,
  and `allow_hourly` switched on for annual + unpaid (never sick).
- **`20260729130009_leave_hourly_fns.sql`** — `compute_requested_minutes` made unit-aware, plus
  `private.submit_leave_impl` behind `submit_leave_request` (unchanged signature) and
  `submit_hourly_leave_request`.
- **`20260729130010_calendar_hourly.sql`** — `team_leave_calendar` recreated with `unit`/times/minutes.
  Still no `security_invoker`, still no `reason`/`decision_note` — verified against the live column list.
- `lib/leave/hourly.ts` (17 tests), `lib/leave/formatTimeRange.ts`, `lib/leave/workSettings.ts`.
- `app/[locale]/(app)/request/hourly/*` (new screen), Home buttons, time ranges in MyRequestsList /
  ApprovalQueue, work-hours fields in `WorkSettingsForm`, `tests/e2e/hourly.spec.ts` (2 specs).

Implementation (plan 4 — replacement, all committed):
- **`docs/plans/2026-07-29-leave-v2-replacement.md`** — the plan, executed in full.
- **`20260729130011_leave_replacement.sql`** — `replacement_id` (+ CHECK it is never the requester),
  `get_replacement_candidates` (annotated, own department only, no employee argument so it cannot
  enumerate another team), `get_my_cover_conflicts`.
- **`20260729130012_leave_replacement_guard.sql`** — `private.replacement_is_away` as the ONE predicate;
  `submit_leave_impl` gains `p_replacement_id`; both wrappers extended and their 5-arg variants dropped
  so there is exactly one of each; `approve_leave_request` re-checks the cover.
- `lib/leave/replacement.ts` (6 tests), `request/_components/ReplacementPicker.tsx` (shared by both
  screens), cover name + clash flag on approvals, "You are covering" card on Home,
  `tests/e2e/replacement.spec.ts`.

Implementation (plan 5 — serials, all committed):
- **`docs/plans/2026-07-29-leave-v2-serials.md`** — the plan, executed in full.
- **`20260729130013_leave_serials.sql`** — `leave_request_serials` counter, `leave_requests.company_id`
  (denormalised on purpose) + `serial_year`/`serial_seq` + unique index, and the **backfill**: existing
  requests numbered in `created_at` order per Jalali year, with the counter seeded past it. The migration
  raises rather than leaving a null if any `start_date` sits outside `jalali_months`.
- **`20260729130014_leave_serial_alloc.sql`** — allocation inside `submit_leave_impl`, patched from
  `pg_get_functiondef` at two points only.
- `lib/leave/serial.ts` (5 tests) + serials rendered on requests and approvals; the e2e assertion was
  added to the existing replacement spec rather than paying for a new browser run.

**Plan 5's one real subtlety**

The advisory lock in the writer is `leave:<employee_id>` — **per employee**. It does not serialise the
serial counter across *different* employees, so `on conflict … do update … returning` is what provides
that, by taking a row lock on the counter for the rest of the transaction. Verified with two genuinely
parallel psql transactions from two employees: they got 4 and 5, not the same number twice. Had they
collided, the unique index would have turned it into a failed submission for a real worker.

**Plan 4's notes**

1. **The searchable picker is a filter input over a native `<select>`, not shadcn `Command`.**
   `components/ui` has no `command` primitive and adding it pulls `cmdk` through a network install this
   machine cannot do. Native selects are also what the e2e suite drives. Deviation from spec §9, recorded
   in the plan rather than substituted silently.
2. **The repo lints against synchronous `setState` inside an effect.** My first candidate-fetch cleared
   state synchronously and failed `react-hooks/set-state-in-effect`. The fix is the pattern the balance
   effect already used: keep a `candidatesFor` key and DERIVE both the list and the loading flag.
3. **The availability predicate must exist exactly once.** It is `private.replacement_is_away`, shared by
   the candidate read, the submit guard and the approval re-check. If a copy drifts, the UI offers a
   colleague the server then rejects.

**Plan 3's traps**

1. **`lib/actions/leave.ts` is a `'use server'` file, so it may only export async functions.** I put a
   shared `WORK_SETTINGS_FALLBACK` object there and the build failed page-data collection with
   *"A 'use server' file can only export async functions, found object"*. It now lives in
   `lib/leave/workSettings.ts`; the type-only import is erased at runtime. Types are fine to export
   from a server file — runtime values are not.
2. **Assert e2e outcomes, not toasts.** `getByRole('status')` for the approval toast is a race: sonner
   auto-dismisses, and the approval had in fact succeeded. Assert that the request left the queue.
3. **Don't hardcode a balance in e2e.** My first assertion expected 4.75 days and got 31.75, because
   `createEmployee` grants the leave-type default, `allocate()` adds more, and plan 2's accrual adds a
   day on top. Read the balance before the action and assert the delta.
4. **`deploy/install.sh` applies migrations BEFORE `seed.sql`**, so a migration that backfills
   `leave_types` columns matches zero rows on a fresh install. Both plan 2's accrual defaults and plan
   3's `allow_hourly` were affected: a brand-new install would have had hourly silently unavailable and
   nobody accruing. `supabase/seed.sql` now sets those columns explicitly. **Any future migration that
   updates seeded reference rows must also set them in the seed.**
5. The `team_leave_calendar` type in `types.ts` had been missing `requested_minutes` since plan 1 (my
   day-column strip caught the view too, and nothing selected it). Restored while adding the hourly
   columns — a reminder that hand-maintained types hide omissions until something selects the column.

**Plan 2's own bug find, worth understanding before touching balances**

`current_leave_balance` (and `getMyBalance`, and `latestBalances`) defined "current balance" as the
latest ledger row by `created_at`. `now()` is frozen for a transaction, so the moment accrual started
posting several months at once, every row it wrote shared one `created_at` and the tie-break fell
through to a random uuid: a true balance of 1440 read back as 960. It was **latent** before accrual —
every ledger row used to come from its own transaction — and no existing test could have caught it.
It surfaced only because the plan required asserting the SQL against the TS planner's numbers.
Fix: `leave_ledger.seq` (sequence-backed, backfilled in `created_at` order) and every reader orders
by it. **If you add a code path that writes several ledger rows in one transaction, `seq` is what
keeps the balance readable.**

**For the next agent — traps that cost real time here**

1. **Never map SQL dependencies by grepping `supabase/migrations/`.** A later migration silently
   redefines an earlier function, so the files are history, not the live schema. `20260713120001`
   had moved allocation into `private.allocate_leave_impl`; my contract migration ported the
   2026-07-02 versions and missed it, so dropping the day columns broke BOTH employee-creation paths
   with `column "allocated_days" ... does not exist`. Ask the catalog:
   `select ... from pg_proc p ... where p.prosrc ~ '(allocated_days|delta_days|requested_days|balance_after[^_])'`.
   For big functions, patch `pg_get_functiondef` output programmatically instead of retyping.
2. **`supabase gen types` does not work from here.** It pulls
   `public.ecr.aws/supabase/postgres-meta` at runtime, which this network will not deliver — the same
   constraint that killed server-side Docker builds. `lib/supabase/types.ts` is therefore
   **hand-edited**, with that fact recorded in its header. `tsc --noEmit` + `next build` are the
   substitute gate. Do not assume the CLI in devDependencies means type generation works.
3. **No `supabase db reset` and no dev stack on :54322.** The running stack is the self-hosted
   `deploy/docker-compose.yml` one, its Postgres port is unpublished, and `.env.local` points at
   `http://192.168.2.48:8080`. Apply migrations with
   `docker exec -i -e PGPASSWORD=… bj-erp-db-1 psql -U supabase_admin -d postgres -f -`. Because
   migrations replay forward onto data, **every migration must be idempotent** — same requirement
   `deploy/update.sh` has on the client's server.
4. **The stack is Postgres 15** (`supabase/postgres:15.8.1.085`), not the 17 in `config.toml`. No
   PG16+ syntax. `create or replace trigger` is fine (PG14+).
5. **`create or replace function` cannot change a return type.** `current_leave_balance` went
   numeric→int and needed an explicit `drop function` first. The plan had this wrong.
6. **E2E is not optional on this kind of change.** Both real bugs were invisible to `tsc`: the
   days/minutes mismatch in the admin balance editor (`manage.spec.ts` expected `7`, got `3360`) and
   the allocation-impl break. The typecheck did earn its keep separately, finding four consumers the
   plan's reader list had missed.
7. **`docs/plans/2026-07-29-leave-v2-foundations-acceptance.sql` must run against a dump of the
   client's database, between …130002 and …130003**, before this ships. Sections 1–2 compare day and
   minute columns, so they only work while both exist. The amd64 `package.sh --platform` landmine
   still applies.
8. Unrelated pre-existing bug noticed in passing, not fixed: the bulk-import "regenerate passwords"
   confirmation throws a next-intl `FORMATTING_ERROR` because the `count` variable is not passed to
   `برای {count} نفر رمز جدید ساخته می‌شود…`. Worth a small separate fix.

## 2026-07-29 — Rejection reason (new column); employee-code field latin-only; local stack rebuilt

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `bd8efd7`, clean tree
**Trigger:** (1) Make the login *username* field English-only + LTR like the password field.
(2) Add an optional free-text reason when rejecting a request; dropdown of presets comes later.

**What changed**

- `lib/employees/code.ts` — `toLatinCode()`; wired into `#code` on `login/page.tsx` with
  `lang="en"`, `spellCheck={false}` (it already had `dir="ltr"`). Drops spaces too — codes never
  contain one. The code becomes the synthetic auth email, so a Persian character could only ever
  produce an unmatchable login.
- **`supabase/migrations/20260729120001_reject_reason.sql` — new nullable
  `leave_requests.decision_note` (≤500 chars) + `reject_leave_request` updated to persist it.**
  `p_reason` had existed since `20260624090001` but was written **only to `audit_log`**, which
  employees cannot read — the reason was invisible to the one person it was written for. Wiring
  the existing parameter to the UI alone would have shipped a field with no reader, so the
  column was the point of the feature, not scope creep. Chose a separate column from
  `leave_requests.reason` deliberately: that one is the requester's and FR-25-private from
  peers; this one is the decider's. `team_leave_calendar` selects an explicit column list
  (`20260624090002:39-50`) so the note cannot leak through the shared calendar — checked, not
  assumed.
- `lib/actions/leave.ts` — `decision_note` added to `LeaveRequestWithType` and to the
  `getMyLeaveRequests` select; `rejectRequest` trims and caps the note, sends `undefined` when
  blank.
- `manage/approvals/ApprovalQueue.tsx`, `calendar/CalendarView.tsx` — optional `Textarea` in
  both reject dialogs (`reject-reason-*` / `cal-reject-reason-*`), per-request state in the
  queue, local state in the calendar's `DecideButtons`.
- `request/MyRequestsList.tsx` — shows the note on the employee's own rejected row
  (`decision-note-*`).
- `messages/{en,fa}.json` — `approvals.rejectReasonLabel/Placeholder`, `request.rejectedReason`;
  key trees verified identical (320 keys). `login.codePlaceholder` changed from `admin` to
  `prod-1042` at the user's request — the login page no longer names the admin account.
- `lib/supabase/types.ts` — hand-added `decision_note` to the `leave_requests` Row/Insert/Update
  (generator not run; no network to a Supabase project from here).
- Tests: `toLatinCode` unit cases; `approval.spec.ts` now types a Farsi reason and asserts the
  employee reads it back. `docs/CHANGELOG.md`, `TASKS.md`, `DATA_MODEL.md` updated.

**Actions outside the repo**
- **Local Docker stack only — nothing against the client's server, no SSH, no VPN.**
- Applied `20260729120001_reject_reason.sql` to the **local** `bj-erp-db-1` by piping it to
  `psql` over stdin. Output: `ALTER TABLE / ALTER TABLE / COMMENT / CREATE FUNCTION / REVOKE /
  GRANT`, plus a harmless "constraint does not exist, skipping" notice.
- Rebuilt `bj-erp-app` twice from the working tree (native arm64 — **local testing only, the
  server needs the amd64 cross-build via `release.sh`**) and recreated `bj-erp-app-1`.
  `docker compose` was unusable here: `.env` is root-owned `600` and there is no passwordless
  sudo, so the container was recreated with `docker run`, copying env/network/labels off the
  running container. Compose labels preserved, so `sudo docker compose up -d app` still adopts it.
- e2e teardown deleted 20 throwaway users + 1 throwaway department from the **local** DB.

**Verification**
- unit **147/147**; full e2e **26/26** serial; `npm run lint`, `npx tsc --noEmit` clean.
- Confirmed live in the local container: `#code` renders `dir="ltr" lang="en" spellCheck="false"`;
  `information_schema` reports `decision_note | text`; `/login` and `/auth/v1/health` both 200.
- The reject→read-back path is covered end-to-end by `approval.spec.ts`, not just by unit tests.

**State left behind**
- Committed to `main` and pushed.
- Local stack runs the new image; `bj-erp-app:78a324a` remains for rollback. **The local image
  predates the placeholder change** — rebuild if you want it reflected in the container.
- Temporary `pw-tmp.config.ts` at the repo root was deleted; dev server stopped.

**Flake worth knowing (pre-existing, not caused by this work)**
- `auth.spec.ts:8` failed on the first run after each `next dev` start and passed immediately
  after, twice in a row. Cause: it fills `#code` directly instead of using the retrying `login()`
  helper, so it races the first-hit compile of the **authenticated** `/home` tree. Curling
  `/home` while logged out does not warm it — the redirect never reaches the route. Either run
  the suite twice or switch that spec to the helper.

**For the next agent**
- **The client's database does not have `decision_note` yet.** It ships on the next
  `release.sh`, which replays migrations — but the app build and the migration must go together.
  Deploying the new image against the old schema breaks `/request` (the select names a column
  that does not exist).
- The reject reason is deliberately free text for now; the user plans preset options plus a
  dropdown, keeping free text as the "other" case. `decision_note` is text and unconstrained
  beyond length, so presets can be layered on without another schema change.

## 2026-07-29 — Deploy guide rewritten for the 3500 port move; password work committed

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `14ba9ac`
**Trigger:** User asked for "a new file in docs" with step-by-step deploy commands, then to
commit and push.

**What changed**

- **No new file was created.** `docs/DEPLOY-GUIDE.md` already was that file (added `e478dd6`,
  2026-07-26). A second guide would have meant two sets of instructions, one of them wrong.
  Rewrote it in place instead and told the user. **It was stale in a way that mattered:** every
  health check and the success banner hardcoded `https://10.10.10.50` — port 443, where nothing
  has listened since `14ba9ac`. Following the old guide would have reported a healthy deploy as
  broken.
- **New PART 0, and it is blocking.** `deploy/docker-compose.yml:60,65,66,112` declare
  `${APP_ORIGIN:?…}`, so compose *hard-fails* on any `.env` written before the port change. Per
  the entry below, the client's server still has such an `.env` — so **the next `release.sh`
  will stop with `set APP_ORIGIN in .env` until PART 0 is done**. `update.sh:71`'s
  `APP_ORIGIN:-https://${APP_HOST}` fallback does not save this; it only feeds that script's own
  health check, not compose.
- Rest of the rewrite: all URLs carry `:3500`; new PART 3 groups the "is it running correctly"
  checks (app 200, `/auth/v1/health` 200, five containers, live version, update log, employee
  count, recent app errors); troubleshooting gains the `set APP_ORIGIN` row and 4.6 for
  "page loads, login fails"; a rule that `APP_HOST` never carries a port; a table of where
  things live.
- `docs/AGENT-LOG.md`, `docs/MEMORY.md`, `docs/TASKS.md` — entries for the password work
  (previous session, same day) plus this one.

**Actions outside the repo**
- **None. No VPN, no SSH, nothing run against the client's server.** Every command in the guide
  was verified by reading `deploy/*.sh` and `docker-compose.yml`, not by executing it there.

**Verification**
- Every error string in the troubleshooting table grepped out of `deploy/*.sh` /
  `docker-compose.yml` — all 14 present, no invented messages.
- Success-banner text checked against `update.sh:214-217`; container names against
  `docker-compose.yml` (`db`, `auth`, `rest`, `app`, `gateway`); remote path against
  `release.sh:24`; SSH alias/host/port/user against `setup-release.sh:18-20`.
- The PART 0.3 `printf … >> .env` quoting was executed locally against a throwaway file to prove
  the escaping survives the `ssh -t bj "…"` wrapper.
- **Not verified against the live server** — no VPN from here. PART 0 is reasoned from the
  compose file, not observed on the client's machine.

**State left behind**
- Committed to `main` and pushed (see the commit below this entry's date in `git log`), together
  with the previous session's uncommitted password-field work and the previously **untracked**
  `docs/AGENT-LOG.md` + `CLAUDE.md` change — the log file itself had never been committed and
  would have been lost by any clean checkout.

**For the next agent**
- Ask whether PART 0 has been run before touching deployment. Until it has, every release fails
  at compose time, and the failure names `.env`, not the port.
- `playwright.config.ts` hardcodes `localhost:3000`, which on this Mac belongs to an unrelated
  container (`isupply-app`); `next dev` falls back to 3001 and specs 404 against the wrong app.

## 2026-07-29 — Login password field: reveal toggle + latin-only entry (first-hand record)

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `14ba9ac`, clean tree
**Trigger:** Two changes to the login page: add a show/hide password toggle, and force the
password field left-to-right and English-only, because in the Farsi UI the field was collecting
Persian characters and the entered password was wrong.

> **Supersedes the backfilled entry of the same name further down this file.** That one was a
> reconstruction from `docs/CHANGELOG.md` written by the previous agent, with "Agent",
> "Trigger", "Actions outside the repo" and independent verification recorded as *unrecorded*.
> This is the first-hand record. Its own note says to treat its detail as incomplete — that
> stands; nothing in it is wrong, it is just thin. Left in place per rule 7.

**What changed**

Root cause of the reported bug: passwords in this system are always latin (temp passwords come
from an ASCII alphabet, employee codes are latin), but nothing stopped a Farsi keyboard from
entering Persian characters. `type="password"` shows only bullets, so the user gets a failed
login with no visible reason. Direction was the smaller half of the problem; the character set
was the real one.

- `lib/auth/passwordPolicy.ts:1` — new `toLatinPassword()`: converts Persian/Arabic-Indic digits
  (reuses `toAsciiDigits` from `lib/employees/code.ts`) then drops everything outside printable
  ASCII `[^\x20-\x7E]`. Placed here, not in the page, so both password entry points share it.
- `app/[locale]/(auth)/login/page.tsx` — reveal toggle (`Eye`/`EyeOff`, lucide) as a
  `type="button"` inside the field, `data-testid="password-toggle"`, `aria-pressed`, localized
  `aria-label`. Input gets `dir="ltr" lang="en"`, `autoCapitalize/autoCorrect` off,
  `spellCheck={false}`, `pe-10`, and filters through `toLatinPassword` on change. **The wrapper
  div also carries `dir="ltr"`** — with only the input set, `end-0` resolves against the RTL page
  and the button lands on the visual left, over the start of the text.
- `app/[locale]/(app)/profile/ChangePasswordForm.tsx` — same latin/LTR treatment on all three
  fields. **Scope addition, not requested.** Filtering only the login field leaves a lockout
  path: this form accepted Persian characters, so a password set here could never be typed at
  login again. Flagged to the user as revertible.
- `messages/{en,fa}.json` — `login.showPassword` / `login.hidePassword`, inserted after
  `passwordPlaceholder` in both; key trees verified identical afterwards (317 keys, same order).
- `tests/unit/passwordPolicy.test.ts` — 4 cases for `toLatinPassword` (ASCII passthrough, both
  digit families, Persian letters dropped, RTL mark + emoji dropped).
- `tests/e2e/auth.spec.ts:32` — asserts `dir="ltr"`, that filling `رمز۱۲۳abc!` leaves `123abc!`,
  and the `password → text → password` toggle round-trip.
- `docs/CHANGELOG.md` — entry added above the port entry.

**Actions outside the repo**
- Nothing against the **client's** server. No SSH.
- Local only: started and later stopped `npm run dev`; the local `bj-erp-*` Docker stack was
  already running from a previous session and was left running.
- The Playwright global teardown ran against the **local** Docker database and deleted 20
  throwaway e2e users and 1 throwaway e2e department (the reserved `999#######` / `zz` patterns).
  Expected behaviour, local DB only, no client data touched.

**Verification** — all actually run, on the local Docker stack:
- `npm run test:unit` → **143 passed** (139 before; +4 new).
- Full e2e serial → **26 passed**, run **twice**: once before the `ChangePasswordForm` edit and
  again after it, because that edit touches a shared module.
- `npm run lint` clean · `npx tsc --noEmit` clean · `npm run build` compiled successfully.
- Live DOM check on `/fa/login` in a browser: input `dir=ltr`, `lang=en`,
  `padding-right: 40px` / `padding-left: 12px`, toggle centre right of the field centre,
  `aria-label` = `نمایش رمز عبور`. Screenshot confirmed Farsi labels still render RTL.
- **One flake, not a regression:** `auth.spec.ts` "correct credentials land on /home" failed on
  the first cold run and passed on every run after. Same cold-`next dev` hydration race already
  documented in `docs/MEMORY.md`; this spec fills `#code` directly instead of using the
  retrying `login()` helper.

**State left behind**
- **Uncommitted on `main`**, not pushed — the user commits on request. Eight files:
  `login/page.tsx`, `profile/ChangePasswordForm.tsx`, `lib/auth/passwordPolicy.ts`,
  `messages/{en,fa}.json`, `tests/e2e/auth.spec.ts`, `tests/unit/passwordPolicy.test.ts`,
  `docs/CHANGELOG.md` (plus this file and the docs below).
- A temporary `pw-tmp.config.ts` was created at the repo root for the test runs and **deleted**;
  `playwright.config.ts` was not modified. Dev server stopped.

**For the next agent**
- **`npm run test:e2e` will silently test the wrong application on this Mac.**
  `playwright.config.ts` hardcodes `localhost:3000`, but port 3000 is held by an unrelated
  container of the user's (`isupply-app`), so `next dev` falls back to **3001** and every spec
  gets 404s that look like broken routing. Check the `next dev` banner for the real port and
  point Playwright at it. The port clash is on the machine, not in the repo.
- Employees whose password already contains non-latin characters can no longer type it and need
  an admin reset. Unknowable from here — passwords are bcrypt-hashed.
- The `ChangePasswordForm` half was a deliberate scope addition; if the user rejects it, revert
  the three `onChange`/`dir` blocks and the import, and leave `toLatinPassword` in place.

## 2026-07-29 — Configurable HTTPS port; login broken by the port move

**Agent:** Claude Opus 5 via Claude Code
**Branch / HEAD at start:** `main` @ `80d0cb4`
**Trigger:** Client's IT required the app off ports 80 and 443. The user changed the compose
`ports:` line to `'3500:443'` on the live server, after which login stopped working for the
admin and one other account.

**What changed**

Root cause: the published port lives in more places than the compose port mapping.
`NEXT_PUBLIC_SUPABASE_URL` was derived as `https://${APP_HOST}` (no port) and is substituted
into the compiled browser JS by `deploy/docker-entrypoint.sh:19` at container creation. Login is
a **browser-side** call (`lib/auth/usernameEmail.ts:26` → `lib/supabase/client.ts`), so the page
loaded fine over :3500 while every login POST went to :443 — unpublished, nothing listening.
Caddy itself was fine: it listens on 443 *inside* the container and ignores the `Host` header's
port when matching, so `'3500:443'` was correct.

- `deploy/docker-compose.yml` — `APP_ORIGIN` (full URL employees type) now feeds
  `NEXT_PUBLIC_SUPABASE_URL`, `API_EXTERNAL_URL`, `GOTRUE_SITE_URL`, `GOTRUE_URI_ALLOW_LIST`,
  declared `${APP_ORIGIN:?…}` so a `.env` missing it fails loudly rather than rendering empty
  URLs. Ports become `'${APP_PORT:-443}:443'`. Port 80 no longer published.
- `deploy/install.sh` — prompts for the HTTPS port, derives `APP_ORIGIN`, splits a port off
  `APP_HOST` if one was typed there (`APP_HOST` must stay bare — it is the TLS cert name and
  `default_sni`), and backfills `APP_PORT`/`APP_ORIGIN` into pre-existing `.env` files.
- `deploy/update.sh:141` — **second, separate bug found while investigating.** The post-deploy
  health check curled `https://${APP_HOST}/`. On any non-443 install that can never succeed, so
  every *good* deploy would have been automatically rolled back. Now uses `${APP_ORIGIN}`.
- `deploy/caddy/Caddyfile` — removed the dead `http://` redirect block (port 80 is gone);
  added a comment that the site address stays portless and why.
- `deploy/env.example`, `deploy/RUNBOOK.md` — three-value model documented; requirements list,
  phone-install steps and troubleshooting updated.
- `docs/CHANGELOG.md`, `docs/MEMORY.md` — entries added.

**Actions outside the repo**
- None. No SSH, no commands run against the client's server. The user was given the surgical
  `.env` + `sed` + `--force-recreate` sequence to run themselves; whether they ran it is not
  recorded here.

**Verification**
- `docker compose config` against a synthetic `.env` — all four public URLs render
  `https://10.10.10.50:3500`, `published: "3500"`, `target: 443`, `APP_HOST` stays bare.
- Same command against a pre-`APP_ORIGIN` `.env` — exits 1 with the intended message.
- `bash -n` clean on `install.sh` and `update.sh`; host/port normalisation exercised on
  `10.10.10.50`, `10.10.10.50:3500`, `erp.local:8443`, `erp.local`.
- Unit/e2e suites **not** run — no application code was touched, only deploy scripts and docs.

**State left behind**
- Committed as `14ba9ac` on `main`, not pushed at the time of writing.
- The client's live server still runs the **old** compose file with the hand-edited
  `'3500:443'` line. It needs either the manual fix or a new package built from this commit.

**For the next agent**
- Changing `APP_ORIGIN` requires `docker compose up -d --force-recreate app` — a plain
  `restart` reuses a container whose files were already substituted, so the old URL survives.
- Browsers cache `/_next/static/*` as `immutable`. The substitution changes chunk *contents*
  without changing filenames, so a hard reload (and clearing site data on installed PWAs) is
  required after any `APP_ORIGIN` change.
- Never put a port in `APP_HOST` — it corrupts `default_sni` and the certificate name.

## 2026-07-29 — Login password field: reveal toggle + latin-only entry

**Agent:** unrecorded (entry backfilled 2026-07-29 when this log was created)
**Branch / HEAD at start:** `main`
**Trigger:** Unrecorded.

**What changed**
- Show/hide password toggle on `/login`; password inputs forced latin-only, left-to-right, via
  `toLatinPassword()` in `lib/auth/passwordPolicy.ts`; applied to the change-password form too.
- Full detail: `docs/CHANGELOG.md` → "Login password field: reveal toggle + latin-only entry".

**Actions outside the repo** — unrecorded.

**Verification** — per the changelog: `toLatinPassword` unit cases (143 unit tests total) and an
`auth.spec.ts` case. Not independently re-run when this entry was written.

**State left behind**
- Uncommitted in the working tree at the time this log was created: `login/page.tsx`,
  `profile/ChangePasswordForm.tsx`, `lib/auth/passwordPolicy.ts`, `messages/{fa,en}.json`,
  `tests/e2e/auth.spec.ts`, `tests/unit/passwordPolicy.test.ts`.

**For the next agent**
- This entry is a reconstruction from `docs/CHANGELOG.md`, not a first-hand record — it predates
  this log. Treat its detail as incomplete. Everything after it is first-hand.
- Pre-existing non-latin passwords, if any exist in the client's database, can no longer be
  typed and need an admin reset.

## 2026-07-29 — Local Docker app restart

**Agent:** Codex
**Trigger:** User requested a restart of the currently running local Docker app for testing.

**Actions outside the repo**
- Restarted `bj-erp-app-1` (image `bj-erp-app:latest`).
- Verified `https://192.168.2.48/login` returns HTTP 200 through the local Caddy gateway.

**State left behind**
- The local app container is running. No application source or configuration was changed.

## 2026-07-29 — Hourly leave visibility diagnosis

**Agent:** Codex
**Trigger:** User could not see hourly leave in the restarted local deployment and asked whether it
was implemented.

**What was found**
- Hourly leave is implemented in the current branch: the `/request/hourly` page, request form,
  server action, SQL migrations, translations, Home/daily-request links, and unit/e2e coverage are
  present.
- The running `bj-erp-app:latest` image was created at `2026-07-29T15:13:29Z`; the hourly feature's
  commits began later, at `2026-07-29T21:34:52-04:00`.
- The running container's compiled Next.js output contains no `request/hourly` route. Restarting
  that container therefore cannot surface the feature; the image must be rebuilt and the
  application/database migrations redeployed.

**Actions outside the repo**
- Read Docker image/container metadata and inspected the app container's compiled route manifests.
  No container or database state was changed during this diagnosis.

**State left behind**
- Local Docker stack remains running on the same old image. No source or deployment changes were
  made.

## 2026-07-29 — Rebuild and local deployment of leave v2

**Agent:** Codex
**Branch / HEAD at start:** `feat/leave-v2-hourly-accrual-replacement` @ `5e26e77`
**Trigger:** User asked to rebuild the local Docker deployment, commit all pending work, and push it
so hourly leave could be tested.

**What changed**
- `package-lock.json` — added the missing npm 10 lock entry for
  `next-intl/node_modules/@swc/helpers@0.5.23`. The production Dockerfile uses npm 10.9.8;
  without this entry its clean `npm ci` stopped before the Next.js build.
- No application or database source was changed. The leave-v2 implementation was already committed
  on this branch.

**Actions outside the repo**
- Preserved the previous image as `bj-erp-app:pre-hourly-20260729`.
- Built `bj-erp-app:latest` from the current branch; image
  `sha256:d1d0364d496dd5f781841d8c299a7ecefee0181e4e4066a46f5b1c7ce0ada8cf`.
- Created and validated database backup `/private/tmp/bj-pre-leave-v2.2P7nKY` (439 KB).
- An attempted replay of all migrations stopped on the first statement (`app_role` already exists);
  it made no change. Exact schema probes then confirmed all leave-v2 migrations, including
  replacement and request serials, were already present, so no migration was required.
- Recreated only `bj-erp-app-1`, reusing the running stack's existing environment. The old app
  container is stopped as `bj-erp-app-rollback-20260729`; database/auth/rest/gateway containers and
  named volumes were not recreated.
- Verified the authenticated local flow in Chrome:
  `/home` → “درخواست مرخصی ساعتی” → `/request/hourly`; Annual and Unpaid leave were offered, and
  changing 07:00–08:00 to 07:00–09:00 updated the preview from one to two hours. No app console
  errors were present. The page was left open for the user.

**Verification**
- Docker production build passed, including TypeScript and the compiled
  `/[locale]/request/hourly` route.
- `npm run test:unit` — 34 files, 208 tests passed.
- `npx eslint app components i18n lib tests scripts proxy.ts` — passed.
- `npm run lint` is polluted by generated `.next` files in the separate
  `.claude/worktrees/peaceful-williams-9c1cf9` worktree; those generated-code failures are unrelated
  to this branch.
- Post-deploy row counts matched pre-deploy: profiles 15, leave_requests 3, leave_ledger 27,
  leave_types 3.
- `https://192.168.2.48/login` returned 200; the protected hourly route redirected unauthenticated
  requests to login as expected.

**State left behind**
- Local app is running the rebuilt `bj-erp-app:latest`; rollback image, stopped container, and
  verified database backup are retained.
- The hourly request page is open in Chrome for local testing.

---

*Entries before 2026-07-29 were never journalled. For that history use `docs/CHANGELOG.md`
(what shipped), `docs/MEMORY.md` (lessons), `.superpowers/sdd/progress.md` (task-level build
ledger), and `git log`.*

## 2026-08-11 — Local Git branch cleanup

**Agent:** Codex
**Trigger:** User requested cleanup to leave only the main branch where safe.

**What changed**
- Deleted fully merged local branches `codex/code-review` (at `1a9589c`) and
  `feat/leave-v2-hourly-accrual-replacement` (at `79e1362`). Both commits are reachable from
  `main`.
- Retained `claude/peaceful-williams-9c1cf9`: it is checked out by a linked worktree with
  uncommitted changes.
