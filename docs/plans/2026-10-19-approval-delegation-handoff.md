# Approval delegation continuation handoff — 2026-10-19

## Current status — design simplified after PR #7 review (2026-10-19, later)

**Read this first; everything below is history.** Owner removed the timer: the CEO's attested delegate
(e.g. HR head) gets the CEO step approved **at submission**; there is no worker, cron job, worker-health
card or review window. All delegation SQL is one squashed migration `20261018011333_approval_delegation.sql`
(none of the earlier five ever ran outside the disposable test DB). The isolated DB was **rebuilt** with
`.bj-deploy/delegation/resume-tools/bj-delegation-rebuild.sh` (baseline = `main` schema, ACL repair incl. the
three private validators, seed, calendar, GoTrue, bootstrap admin, ledger apply) and re-seeded with
`/tmp/bj-delegation-qa.py seed`. Until PR #7 merges, an SQL change means: edit the squashed file, rerun
the rebuild script, re-seed, rerun tests — not a forward migration. Validation and perf numbers: AGENT-LOG
2026-10-19 "simplified". PR #7 is open, not merged; merging deploys.

## Status after second continuation (2026-10-19, Claude Opus 5.5)

Everything this handoff listed as outstanding is now done; sections below are history. Still
**uncommitted, unpushed, undeployed**; worker inactive; credential/session risk retained (deferred).

- **Lint:** `ApprovalWorkerHealthCard` no longer calls `Date.now()` in render; the action returns
  `observed_at` (server read time) and staleness is measured against it. `npm run lint` exit 0.
- **Farsi loop: test-harness artifact, not an app bug.** Proven by a second `next start` bound with
  `--hostname localhost` (relative rewrite, `/login` 200). Mechanism in `docs/MEMORY.md`. Launchers
  `/tmp/bj-delegation-prod.cjs` / `-start.cjs` now bind `localhost`; app URL is
  **`http://localhost:3002`**. Isolated Caddy CORS allows both `127.0.0.1:3002` and `localhost:3002`.
  No routing code changed. Production image binds `0.0.0.0`, unaffected.
- **Six additional races:** all PASS (`additional-races.log/json`). Harness needs Python ≥ 3.12
  (`~/.local/bin/python3.13`; anaconda 3.11 rejects an f-string in `bj-delegation-qa.py`).
- **Admin-adjustable window (owner request, same day):** migrations `20261019143148_approval_auto_window.sql`
  (SHA256 `0c36be058857d9d3d7a35b29b08f64f61589e72b95052e290234cbf3550999f8`) and
  `20261019143601_approval_auto_window_acl.sql` (`13c9ceb7fb199ddef327a892f10e9650f198642ff9fd8e407d2dcd1d7a259b8b`)
  applied to `bj-delegation-db` only, now frozen. **Isolated company window is set to 2 minutes.**
  SQL suites need `resume-tools/bj-delegation-suites-isolated.py` (rolled-back fixture isolation; 782 PASS).
  `supabase migration new` waits on stdin when not a TTY: run it with `< /dev/null`.
- **Browser:** `/tmp/bj-delegation-browser-rest.cjs <phase…>` (phases smoke forms warn exact early
  mobile hrnatural window autoprint2 autoprint print; `autoprint` targets the 120-minute timers due 15:42 UTC, not run; state in `browser-rest-state.json`, screenshots/PDFs in
  `.bj-deploy/delegation/browser/`). All phases passed; see the 2026-10-19 AGENT-LOG entry.
- **Final checks (after window change):** lint 0, `tsc --noEmit` 0, unit 913/82, Webpack build 0,
  SQL 782 PASS (delegation 175) on candidate and applied schema.
- `resume-tools/*.cjs` copies renamed `*.cjs.txt` (ESLint scans untracked `.bj-deploy/`).

Remaining, each needing explicit owner authorization: commit + review/PR; recovery evidence
(pre-deploy dump and restore drill); production migration; worker configuration, activation and
post-deploy smoke on Liara.

## Start here

Owner requested another handoff after usage interruptions. **Implementation is not finished.**
Read `CLAUDE.md`, then this document, newest journal entry and `docs/TASKS.md`. The earlier
`docs/plans/2026-10-18-approval-delegation-handoff.md` remains the detailed policy/source map;
this document supersedes its operational state and validation checklist. Do not repeat broad
exploration or reopen settled policy decisions. Do not read `docs/archive/`.

- Checkout `/Users/amir/Workspace/bj`, branch `codex/approval-delegation`.
- HEAD remains `984b661915e178b327a64718edca2ee9328c3f6e`.
- All design, implementation, review and documentation changes remain **uncommitted**. Preserve them.
- No commit, push, deployment, production migration or production worker activation authorized.
- Never operate on shared real-roster `bj-erp-db-1/postgres` or hosted/production systems.
- At most two concurrent subagents, no nested delegation. Explicit model/effort where supported.
  This session used `gpt-6.1-sol`/`xhigh` for SQL review and `gpt-6.1-sol`/`high` for UI/docs.
  Lead owns database operations, shared tests, schema regeneration and journal.
- Credential/session hardening remains explicitly deferred, **not a new activation gate**.
  Retained initial credentials and sessions can impersonate principals/delegates. Resets stay admin-only.

## Frozen migrations and verified isolated state

Both migrations are now applied through the deployment ledger to **`bj-delegation-db/postgres` only**.
Neither may be edited; any SQL correction needs a new CLI-created forward migration.

| Filename | SHA256 |
| --- | --- |
| `20261018011333_approval_delegation.sql` | `db34edf28e38646b84ca9953d3424ff1f9621b1400c60026be99f1fc81830b31` |
| `20261018231551_approval_delegation_lock_rechecks.sql` | `6602cc226ee41870724c8adf8e63978bfb6d25d701a15cc55816acb96b449621` |

Ledger: `bj_deploy.schema_migrations(filename, checksum_sha256, release_version)`; both release
`delegation-isolated-qa`. Handoff read-only recheck confirmed these hashes, eight synthetic profiles,
one active admin (`employee_code=admin`), and cron `bj-approval-delegation`, `* * * * *`, **active=false**.
The original baseline was schema-only, never copied real roster data.

`supabase/schema.sql` was regenerated after the forward migration, explicitly using
`BJ_DB_CONTAINER=bj-delegation-db npm run schema:dump`. Source review found no remaining unexpected
existing-object/ACL drift. Three unrelated PUBLIC EXECUTE revokes on private `is_valid_card_no`,
`is_valid_national_id`, `is_valid_sheba` were isolated baseline-import artifacts; restored their
exact HEAD grants before dumping. Existing-function bodies match original + forward migration.
Grant ordering, SET placement and loss of the replaced SELECT policy's comment are cosmetic.

## What this session changed

### Forward SQL correction

Eight full CREATE OR REPLACE definitions preserve signatures and ACLs:

- `app_set_approval_delegate`, `app_set_executive_settings`, `cancel_leave_request` recheck caller
  authority/company after waiting for locks; revoked authority cannot survive a lock wait.
- `app_bulk_import_employees` acquires the company lock before row/employee leave locks and refreshes
  caller rights. Prevents the identified import→employee / worker→company inversion.
- `private.submit_leave_impl` refreshes active/company/department checks after company lock.
- Submission, consent and manual/automatic evidence use actual clocks after waits, instead of
  transaction-start `now()`. Two-hour window is not shortened by submission lock wait.
- Twelve rollback SQL assertions added, including deterministic post-lock mutation hooks restored
  by savepoints. Those hooks are test-only, not installed in the applied schema.

Specific worker/RPC lock orders have been tested; do **not** claim universal deadlock freedom for
arbitrary direct authority-table DML. Row-level BEFORE triggers run after tuple locks; direct profile
UPDATE versus a company-first importer could still produce a broader tuple/advisory inversion.

### UI/action/evidence correction

- `ApprovalWorkerHealthCard.tsx`: stale/future completion timestamps no longer show healthy; five-minute
  tolerance for minute worker; new EN/FA wording and tests. **Has a final lint failure below.**
- `lib/actions/approval-delegation.ts`: validates worker-health shape/counts/timestamps and returns
  only narrow UI fields. Additional malformed-response/action tests.
- `lib/actions/leave/review.ts`, `lib/leave/approval-context.ts`, print page: retain exact step identity,
  named/expected approver/order, historical authority statement, delegate/submitted/consent data.
  Print labels repeated-role steps and automatic evidence, suppresses fictitious human PNGs.
- EN/FA automatic timer wording now means eligible after deadline / next successful worker execution.
- Render tests added for same-role exact steps and EN/FA automatic print.
- `DATA_MODEL.md`, `PERMISSIONS.md`, `REQUIREMENTS.md` updated as **unreleased/local branch**. Includes
  twentieth Yes/No permission, scoped access, temporary/HR/CEO behavior, evidence, locks and deferred risk.
  Lead still needs final documentation review, plan/backlog completion and optionally Unreleased changelog.

## Verification results — preserve these distinctions

| Check | Actual result | Remaining qualification |
| --- | --- | --- |
| Six SQL suites, candidate rollback | 761 PASS, zero FAIL/ERROR | Before application |
| Same suites, applied schema | 761 PASS, zero FAIL/ERROR | Before persistent browser fixtures |
| Delegation SQL | 154 PASS | Included above |
| FR-51 / FR-52-53 / FR-54 / FR-55 / client feedback | 40 / 59 / 83 / 355 / 70 PASS | Included above |
| Full unit suite | 895 tests, 82 files passed | Includes latest worker/print/action fixes |
| TypeScript | `npx tsc --noEmit` passed | Final log empty, exit 0 |
| Lint | **FAIL**, one `react-hooks/purity` error | Worker card line26 `Date.now()` during render |
| Webpack production build | Passed | Latest app code, isolated API environment |
| Deployment shell tests | All passed | Local tests only |
| Schema review | No unexpected object/ACL drift | Reviewed against HEAD + both migrations |
| Real worker races | 12 scenarios passed | Observed actual advisory lock waits, not sleeps alone |
| Temporary source cancellation | Both winning orders passed | Synthetic clock/history isolation described below |
| Submission clock after lock wait | Passed | Actual competing connection |
| Additional 6 races | **Not passed yet** | Harness baseline error corrected but not rerun |
| Actual pg_cron | Two scheduled runs succeeded | Browser closed, worker returned inactive |
| English settings/preview browser | Partial passes listed below | Full browser script stops at Farsi loop |
| RTL/mobile/four-form submission/print/queue decisions | **Still outstanding** | Script written but those portions not reached |

SQL regression totals: 355+83+154+59+70+40 =761. Some suites print FAIL notices without nonzero exit;
continue counting FAIL/ERROR explicitly. Full unit logs include known jsdom navigation notices,
not test failures. Build passed using Webpack; no new Turbopack attempt this session.

### Real concurrency that passed

`/tmp/bj-delegation-races.py` ran worker versus manual CEO approval, rejection, own cancellation,
saved-grant revocation, permission removal, and another worker — both winning orders for each.
A held transaction plus third observer verified actual advisory wait, then released the winner.
Assertions cover at most one exact CEO decision and one consumption, preserved manual evidence,
permanent invalidation when revocation/reject/cancel wins, and expected losing decision errors.
Results: `.bj-deploy/delegation/races.json`, `races.log`.

`/tmp/bj-delegation-extra.py` ran submission waiting for company lock and temporary-source cancellation
in both orders. Source is an approved CEO daily errand today (ordinary approved leave today is not
cancellable); fixture owner inserts its temporary grant directly, without adding an errand Replacement
field. Test clocks backdate enrollment by121minutes. Prior temporary fixture intervals must end before
that artificial submission time, or durable interruption detection correctly invalidates the new timer.
Early attempts hit that protection and an overlapping source errand; corrected fixture isolation passed.
Results: `extra-races.json`, `extra-races.log`. Do not blindly rerun fixed-date fixtures over themselves.

`/tmp/bj-delegation-additional-races.py` was authored for six additional checks:
revoked cancellation permission; former-admin executive/delegate writes through actual admin transfer;
post-wait decision timestamp; bulk-import/worker both orders. Bulk uses a third employee-lock holder
and checks specific `pg_locks` keys. Initial run failed **in the fixture**, because default HR has
leave_requests read, not edit, so cancellation correctly failed before acquiring its lock.
Agent corrected `cancel_permission_race()` to establish edit authority and restore exact baseline
permissions afterward, but hit usage limit before reporting completion. Inspect current file (the
correction is present) and rerun under lead control. No later case has run. Handoff recheck confirms
original admin is still active. Harness reads fixture passwords silently and redacts failures.

### Actual scheduler proof

`/tmp/bj-delegation-cron.py` enabled only the isolated job, used a synthetic overlap blocker, and
observed real `cron.job_run_details` success at `2026-10-18T23:46:00Z` and `23:47:00Z` (run IDs1,2).
First run blocked one item but completed another. An immediate explicit call respected retry backoff.
After removing the blocker and adjusting only synthetic attempted_at for test speed, the next actual
cron run completed the blocked request. Repeated explicit call was idempotent; evidence timestamp was
at/after due time with no signer/PNG. Finally returned cron inactive, independently rechecked.
See `cron-resume.log`, `cron-results.json`; IDs for automatic print fixtures are in the JSON.
Do not rerun cron script blindly: its dates overlap existing fixtures.

## Current browser blocker: Farsi redirect loop

Browser plugin/skill was absent; used installed Playwright Chromium and temporary scripts, no new deps.
Application URL stays `http://127.0.0.1:3002`; API is `http://127.0.0.1:8092`.

English browser passes (`browser-flows.log`):
- Admin changes CEO saved delegate A→B→A with explicit attestation and saves CEO/HR/exact-step mapping.
- New-role permission displays exactly two buttons, keyboard Space selects Yes and No can be selected.
- CEO self-service has no principal selector, executive authoring or New role link.
- AM preview 07:00–11:00, PM11:00–15:00; changing bounds resets temporary consent.
- Eligible replacement shows separate CEO authorization; ordinary cover retains saved A; No Replacement
  clears replacement and retains saved A.
- Initial admin page identity/content/interaction/screenshot and console checks passed (`ERRORS []`).

Browser script then fails at RTL. Explicit `/fa/...` alone redirects to bare path and stored English
preference may win; use real language switch to change preference. **After switching to Farsi, both
login/default routes and the language switch encounter `net::ERR_TOO_MANY_REDIRECTS`.** Body can be blank.
Observed in dev AND after successful production build under `next start --hostname127.0.0.1`.
Do not report this as fixed or merely test timing.

Read-only curl evidence:
- `http://127.0.0.1:3002/login` →307, `x-middleware-rewrite: http://localhost:3002/fa/login`, `location:/login`.
- `http://localhost:3002/login` has same loop while server is bound with hostname127.0.0.1.
- `/fa/request` →307 `/request`, expected prefix stripping on its own.
- English routes work. No routing/application config was changed while investigating.

Leading hypothesis, **not yet proven/fixed**: Next normalizes loopback rewrite URL to `localhost`, but
router init origin uses configured hostname127.0.0.1, causing an intended internal rewrite to be
proxied as external and re-enter middleware. Local source evidence:
`node_modules/next/dist/server/lib/router-utils/resolve-routes.js` lines116–118 builds initUrl from
`opts.hostname`; lines467–478 calls getRelativeURL then treats remaining protocol as external.
`shared/lib/router/utils/relativize-url.js` compares exact origins. Next-intl default-locale rewrite
then prefix-removal redirect explains symptoms. Next step: test a server actually **bound with hostname
localhost**, or proper standalone server with aligned HOSTNAME/origin, before editing product routing.
Testing a localhost request against a server configured127 did not disprove that hypothesis.
`next start` also warns output:standalone should use `node .next/standalone/server.js`; consider proper
standalone setup (public/.next/static assets) for final verification. Do not edit node_modules.

Docs already consulted: installed proxy guide and skipProxyUrlNormalize guide; Context7
`/amannn/next-intl` middleware composition/as-needed, `/microsoft/playwright/v1.61.1`, `/supabase/cli`.
Supabase changelog Markdown fetch failed unsupported content type. No need to redo generic doc lookup.
Use Context7 for new library-specific changes and installed Next guides before code.

### Browser test environment repairs already made

Initial login failed CORS in test-only gateway. `.bj-deploy/delegation/Caddyfile` now allows origin3002
with necessary headers, and removes upstream duplicate Access-Control-Allow-Origin. Reloaded only
`bj-delegation-gateway-1`; English login works. This is ignored test config, not product/deploy config.
Do not remove CORS fixes. If testing another app origin, update isolated origin deliberately.

### Browser scripts and remaining flows

- `/tmp/bj-delegation-browser.cjs`: admin login/settings inspection; initial screenshot
  `/tmp/bj-delegation-admin.png` visually inspected, English layout good. Writes admin storage state
  `/tmp/bj-delegation-admin-state.json` (chmod0600, expires; re-login rather than sharing it).
- `/tmp/bj-delegation-browser-flows.cjs`: current full partial flow described above. Stops before mobile,
  A's four form submissions, named queue access and EN/FA print. Dates are Nov20–24 2026, chosen unused
  at creation. It uses actual pointer signature drawing and separate auto consent. Time selectors were
  corrected to `*-from`/`*-to` selects; permission toggles are buttons, not radios.
- `/tmp/bj-delegation-locale.cjs`: diagnostic; currently fails on CEO login landing at Farsi /home.
- `browser-flows.log`, `locale-debug.log`, `app.log`, `app-prod.log` contain failure evidence.
- Failure screenshot `/tmp/bj-delegation-failure.png` is blank from redirect loop. Do not cite as success.
- No mobile/print screenshots or PDFs were successfully produced yet.
- Still add actual multiple exact-step browser decisions: existing chain is HR→direct manager→named A
  for errands. Employee errand, HR first, then A can sign delegated CEO step and named own step;
  verify queue refresh retains request between those two decisions. Use scoped IDs/actual drawn PNG.
- Still verify early manual CEO evidence, automatic print both locales, warning for natural approver
  without saved delegate, stale-preview error path, all four form submissions and backend enrollment.
  Many have SQL/unit coverage but not rendered flow coverage yet.

## Remaining lint issue

`npm run lint` final run FAILED at
`app/[locale]/(app)/settings/roles/_components/ApprovalWorkerHealthCard.tsx:26`:
`Date.now()` is impure during render (`react-hooks/purity`). Stale calculation was introduced this
session. Fix deliberately (for example server action supplies observation timestamp / derived stale
state, with DTO/tests updated), then rerun lint, affected unit tests, typecheck and final build if code
changes. Do not simply claim prior lint pass; final `lint-final.log` is authoritative.

## Test resources and recovery

Ignored directory `.bj-deploy/delegation/` retains all config, logs and synthetic fixture IDs:
- `test.env` mode0600: isolated generated credentials, not production. Never print/commit.
- `qa-fixtures.json`: IDs (admin/company/dept/CEO/A/B/HR/employee/ordinary/unrelated/steps/type/role).
- `qa-login.json` mode0600: synthetic account password/codes. Seven new users via guarded admin RPCs.
- `resume-tools/`: copies of the operational/browser scripts listed here, saved from /tmp for recovery.
  Python harness imports are named `/tmp/bj-delegation-qa.py` and `...-races.py`; restore those paths
  if /tmp is cleared. Scripts are temporary QA tools, not a new production worker.

Current task-owned runtime at handoff: `/tmp/bj-delegation-prod.cjs` PID60152 and next server PID60175
(last observed; recheck before signalling) serving production-mode build on3002. Dev launcher10247/
next10270 was stopped before build. No browser harness remains running. Docker isolated API stack
continues running. No unrelated app/container was stopped.

Do not run `npm run schema:dump` without BJ_DB_CONTAINER. Do not rerun old apply scripts or prepend
already-applied migrations to committed tests. The six SQL suites ran before persistent fixtures;
`approval-delegation.sql` asserts global non-admin presets default No, so the synthetic QA Delegation
role may now make that assertion fail. Isolate/remove only synthetic fixture grants transactionally
for reruns or scope the assertion appropriately; never migrate/seed the real roster. Do not blindly
run broad E2E setup/teardown: it reads `.env.test-accounts` and treats E2E_BASE_URL as API too.

## Recommended continuation

1. Verify branch, both frozen hashes, inactive job and current runtime. Preserve all changes.
2. Fix final worker-card lint error. Resolve Farsi route loop using concrete runtime evidence;
   test aligned server hostname/proper standalone before expanding application changes.
3. Inspect corrected additional-races harness and run six cases under lead control; investigate actual
   failures rather than weakening assertions. Preserve original synthetic admin and inactive cron.
4. Finish browser scripts and exact-step decisions; verify submitted four-form requests in isolated DB.
5. Run appropriate final checks after changes. Build and dev must not share .next concurrently.
6. Review domain docs, update plan/backlog/journal and optional clearly Unreleased changelog. Record
   actual remaining limitations. No claim of completion while lint/required browser/race checks remain.
7. Report local-only status, worker inactive, deferred credential risk, and separate future authorized
   release gates (recovery evidence, production rollout/configuration/activation/smoke).
