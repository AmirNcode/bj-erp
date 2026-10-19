# Approval delegation implementation handoff — 2026-10-18

> **Superseded in part (2026-10-19, owner):** the CEO timer, worker, scheduled job, worker-health card
> and adjustable review window were removed. The CEO delegate's own requests now get the CEO step
> approved at submission. Current behavior: spec amendment in
> `docs/specs/2026-10-17-ceo-delegate-approval-design.md`, `docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`.
> The migrations were squashed into `20261018011333_approval_delegation.sql`.

## Read this first

The owner requested a handoff after repeated usage interruptions. Continue the authorized implementation;
do not restart the design or infer that it is finished. **All implementation is uncommitted. Nothing has
been pushed or deployed.** Preserve the complete working tree, including earlier design/review documents.

- Repository: `/Users/amir/Workspace/bj`
- Branch: `codex/approval-delegation`
- HEAD: `984b661915e178b327a64718edca2ee9328c3f6e`
- Read `CLAUDE.md`, newest journal entries, and `docs/TASKS.md`; do not read `docs/archive/`.
- No unresolved owner policy questions. Ask only if a genuinely new policy decision becomes necessary.
- At most **two concurrent subagents**, **no nested delegation**. Give narrow context/file ownership.
  Explicitly choose model and effort when supported. The lead owns DB operations, shared test execution,
  schema regeneration and journal. Prior agents: database `gpt-6.1-sol` / `xhigh`; settings
  `gpt-6.1-sol` / `high`. Lead model/effort were not exposed by the session.
- Implementation/local validation is authorized. Commit, push, production migration, deployment and
  production scheduler activation have not been requested. A push to main triggers Liara deployment.
- **Credential/session hardening is explicitly deferred by the owner**, not an activation gate.
  Preserve the recorded risk: account creators may retain initial credentials and password resets
  do not revoke existing sessions. Those sessions can impersonate a principal/delegate. Resets remain
  admin-only. Do not expand this release into credential redesign.

## Critical database state: migration is frozen

`supabase/migrations/20261018011333_approval_delegation.sql` **has been applied** to the isolated
synthetic test database. Do not edit it. Any SQL fix now requires a new CLI-created forward migration.

Verified immediately before this handoff:

- Container: `bj-delegation-db`; database: `postgres` **inside that container only**.
- Ledger: `bj_deploy.schema_migrations`, release `delegation-isolated-qa`.
- Migration SHA256: `db34edf28e38646b84ca9953d3424ff1f9621b1400c60026be99f1fc81830b31`.
- Cron job `bj-approval-delegation`, schedule `* * * * *`, **active=false**.
- Exactly one profile: the synthetic bootstrap admin. SQL fixtures all rolled back.
- `supabase/schema.sql` was regenerated from this isolated container after applying the migration.
- Shared local **`bj-erp-db-1/postgres` contains the real roster**. Do not migrate, seed or run these tests
  there. Hosted/production systems have not been touched.

The isolated baseline was imported from `git show HEAD:supabase/schema.sql`, not copied from real data.
Only this feature migration is in its deployment ledger; do not blindly run the whole historical migration
folder against it. Company seed, bootstrap admin, Jalali calendar and pg_cron were installed separately.

## Approved requirements

Primary references:

1. `docs/specs/2026-10-17-ceo-delegate-approval-design.md`
2. `docs/plans/2026-10-17-ceo-delegate-approval.md`
3. `docs/REVIEW-2026-10-17-approval-delegation.md`
4. `docs/plans/approval-delegation-rpc-contract.md` — implemented contract details

Settled policy, condensed:

- `approval_delegate` is action-only: `edit` = Yes, absent = No. Exactly two options under
  **Approval chain** in role editing. Existing non-admin roles default No. Manager stays locked;
  admin assigns a supplementary custom role. Preserve FR-55 D4/D5 and admin-only role authoring.
- `/settings/roles`: admin manages others' saved delegates and explicit CEO/HR-head identities plus
  actual HR-review step IDs. Permission holders manage only their own saved delegate, without role rights.
- Eligible delegate: active, same-company, naturally existing manager/approver. Receiving delegation
  alone does not qualify someone for onward delegation. Never broaden `private.is_manager_of`.
- CEO delegate must already report directly to the designated CEO. Before authorizing the special
  policy, CEO must naturally own applicable steps for **both leave and errand**.
- An eligible selected Replacement becomes temporary approval delegate only during the fully approved
  absence, then the eligible saved default returns. Original approver keeps authority. Pending source
  absence cannot grant authority to approve itself. No multi-hop or delegated self-signing.
- Ordinary department employee remains valid operational cover but gains no approval authority;
  use saved delegate or show the missing-delegate warning. No Replacement leaves `replacement_id` null
  and retains saved approval delegate. Warning is advisory and only for people with approval duties.
- No new replacement field on errands. All four request forms participate in CEO timer rules.
- Temporary windows use Asia/Tehran, exclusive end: full-day calendar bounds, hourly exact times,
  AM/PM first/second half of configured `work_start`–`work_end`. Preview exact hours before submit;
  server validates/snapshots them; changed settings require refreshed preview.
- Current CEO delegate's own **new** requests require requester signature and explicit responsibility
  consent. CEO step becomes eligible for automatic completion after 120 elapsed minutes, even before
  outstanding earlier HR review. Non-HR delegates still need HR. Only designated HR head is exempt
  from explicitly mapped HR review, independently of whether they are CEO delegate.
- CEO manual approval before deadline records actual CEO signature; rejection/cancel stops timer.
  No old-request enrollment; revoked, expired or interrupted authority never revives an old timer,
  including A→B→A, role/permission restoration, reactivation and worker downtime.
- Saved and temporary CEO automatic authority have separate explicit CEO/admin attestation. CEO's
  temporary appointment requires `p_temporary_ceo_authorized`, separate from own-request consent.
- Automatic evidence has no human signer/PNG. Display automatic approval, CEO authority reference,
  requester responsibility, and actual execution time. HR exemption is not a signed approval.
- Preserve exact step IDs, named/department distinctions and historical evidence. Manual and automatic
  completion share final balance/overlap/cover checks; automatic path cannot set per diem.
- Minute worker installs inactive. Status/overdue/blocked information for admin and designated CEO;
  requester sees pending/blocked/invalidated timer status. Activation is a separate release operation.

## What is implemented

### Database (prior database subagent; source/tests only)

Frozen migration adds:

- `approval_executive_settings`, `approval_delegations`, `approval_request_policy`,
  `approval_auto_requests`, `approval_worker_runs`, and decision evidence columns.
- Permission catalog, scoped delegation configuration/candidate APIs, live approval capabilities,
  request preview, four `_v2` submission wrappers, exact-step approval/rejection APIs.
- Natural/delegated authorization, explicit HR exemptions, shared finalization, immutable evidence,
  durable timer invalidation, temporary precedence and worker retry/backoff (cap 60 attempts).
- Scoped queue/context/progress/signature RPCs; private helpers revoked from browser roles.
- Authority mutation locks/reconciliation for **old and new companies**, inactive cron registration.
- Worker-health JSON masked for CEO, company-scoped counts for admin.

`tests/sql/approval-delegation.sql` has **142 passing assertions**, run by the lead. The agent did not
execute DB operations. Contract is `docs/plans/approval-delegation-rpc-contract.md`.

Review fixes already incorporated before freeze:

- Generic triggers nest table/op guards before accessing profile-only `NEW` fields.
- No-chain delegation gets matching scoped read/inbox access.
- CEO authorization validates natural steps for both request kinds.
- Admin explicitly choosing a non-owned step uses recorded override semantics.
- Closed requests do not append current pending steps; completed HR exemptions retain snapshots.
- Changed pending HR step meaning requires review and exposes historical exemption metadata.
- A legacy null-step role approval satisfies a current step only if role mapping is unambiguous;
  one old manager row cannot satisfy both direct and department manager steps.
- Company A→B→A changes cannot revive old timers; both company locks use deterministic ordering.
- Manual `can_approve` respects configured order; rejection remains independently authorized.
- Blocked-item backoff/pending-first worker ordering avoids repeatedly starving new due work.

### Settings, navigation and request forms (prior settings subagent)

- `lib/permissions/catalog.ts`, role editor binary controls, `DelegationPanel.tsx`, guarded actions.
- Live `getApprovalCapabilities()` in `lib/auth/approval-capabilities.ts`, used across navigation,
  Home, Manage and Settings. Named/custom-role approvers no longer depend on broad role-name gates.
- All four forms and shared `useRequestDelegation`/`RequestDelegationFields` pass complete server preview
  JSON, responsibility consent and separate temporary CEO authorization to `_v2` submissions.
- Missing/malformed/stale previews fail closed; missing delegate remains advisory. A→B→A and cleared-input
  preview reuse reset consent. Invalid saved candidates remain visible but cannot be selected/saved.
- English/Farsi strings and panel, permission, navigation, Home, action and preview tests.

**Last subagent turn was interrupted by usage limit while adding worker status UI. Files exist but
were not revalidated after that turn:**

- `app/[locale]/(app)/settings/roles/_components/ApprovalWorkerHealthCard.tsx`
- integration in `settings/roles/page.tsx` (Suspense)
- `getApprovalWorkerHealth()` in `lib/actions/approval-delegation.ts`
- `ApprovalWorkerHealth` type in `lib/leave/delegation.ts`
- `rolesDelegation.worker.*` in both locale files
- `tests/unit/approval-worker-health.test.tsx`

Card/action appear written, but inspect their completeness and tests. No scheduler controls added.
Visibility is admin or initial own principal matching designated CEO. Existing page access still needs
admin/delegation permission; do not casually broaden role authoring or page guards.

### Lead integration

- New `lib/leave/approval-context.ts` DTOs and exact-step choices.
- `lib/actions/leave/approvals.ts`: scoped JSON queue, `_v2` decisions, exact step IDs. Filters out rows
  with no live approve/reject/override action. Home/queue refresh after each step instead of permanently
  hiding a request after the first decision.
- Shared decision dialogs allow exact-step selection and delegated attribution/per-diem eligibility.
- Progress uses scoped context; automatic/HR-exempt/delegated evidence and timer/configuration/legacy
  reconciliation warnings. `historical_hr_exemption` is displayed on changed pending steps.
- Signature actions use scoped signature RPC. Print uses scoped context/signatures, preserves extra
  same-role steps, shows actual or automatic evidence and does not invent zero balances when ledger
  is not visible. Automatic/exempt rows cannot render a human PNG.
- Hand-maintained `lib/supabase/types.ts` contracts/new tables/evidence fields; new table Relationships
  arrays currently empty, so check completeness if adding relational queries.
- `approvalEvidence` translations and new database-error mappings; `approval-evidence.test.tsx`.
- Existing SQL expectation changes: permission count 19→20; assigned named approver may read progress,
  unrelated colleague still denied. Unit catalog count likewise 20.

## Validation: completed versus still needed

These are recorded results, **not a claim that the final working tree passed everything**:

| Check | Last observed result | Qualification |
|---|---|---|
| Delegation SQL | 142 PASS / 0 FAIL / 0 ERROR | Final migration in rollback transaction before apply |
| FR-51 SQL | 40 PASS | Earlier candidate before final historical fixes; rerun after final apply |
| FR-52/53 SQL | 59 PASS | Same qualification |
| FR-54 SQL | 83 PASS | Same qualification |
| FR-55 SQL | 355 PASS | After ACL restoration and historical fixes, before last health/readiness additions |
| Client feedback SQL | 70 PASS | Same qualification |
| Full unit suite | 862 passed, 3 catalog failures | Before schema regeneration/count update; final full rerun required |
| Focused UI/actions/evidence | 28 passed in 4 files | Before worker card/latest warning edits |
| TypeScript / lint | Passed | Before latest edits/new table declarations; rerun |
| Build, default Turbopack | Blocked | Compiler subprocess `binding to a port: Operation not permitted`; escalated retry also failed |
| `npm run build -- --webpack` | Passed | Before last worker/status edits; rerun final build |
| Whitespace | `git diff --check` passed | Rechecked during handoff; untracked files need inclusion/check too |
| Real simultaneous DB sessions | **Not run** | Required |
| Actual pg_cron execution | **Not run** | Job is inactive |
| Browser/E2E/RTL/mobile/print | **Not run** | App started, no browser fixtures beyond bootstrap admin |
| Deployment shell tests | **Not run this implementation** | Required relevant checks |

Logs are in ignored `.bj-deploy/delegation/`: `approval-delegation.log`, `fr*.log`,
`client-feedback-2026-10-12.log`, `unit.log`, `focused-unit.log`, `typecheck.log`, `lint.log`,
`build*.log`, `migration-apply.log`, `restore-acls.log`, `app.log`.

**Important test baseline correction:** importing schema into a fresh Supabase image inherited extra
anon/authenticated default grants. This produced false FR-55 ACL failures. Lead replayed exact baseline
object ACLs using `.bj-deploy/delegation/restore-acls.sql` (131 objects), then tests passed. This was an
isolated-baseline repair, not a production migration. Review regenerated schema diff for unrelated ACL
or restore churn before considering the work complete.

## Test environment and commands

Ignored config: `.bj-deploy/delegation/compose.yml`, `Caddyfile`, `test.env` (mode 0600).
Do not print/commit secrets. `test.env` has generated isolated `POSTGRES_PASSWORD`, `JWT_SECRET`,
`ANON_KEY`, `SERVICE_ROLE_KEY`, `BJ_ADMIN_PASSWORD`. No real roster or production credentials copied.

- Compose name/network `bj-delegation` / `bj-delegation_default`; volume `bj-delegation_db-data`.
- DB `bj-delegation-db`, image `supabase/postgres:15.8.1.085-local-arm64`.
- Auth `bj-delegation-auth-1`, REST `bj-delegation-rest-1`, gateway `bj-delegation-gateway-1`.
- API gateway `http://127.0.0.1:8092` routes `/auth/v1` and `/rest/v1`.
- App launched at `http://127.0.0.1:3002` with Webpack; recheck reachability, not just stale log.
- `/tmp/bj-delegation-start.cjs` reads test env silently and spawns
  `npm run dev -- --webpack --hostname 127.0.0.1 --port 3002`, overriding public URL/key and
  server `SUPABASE_URL` to isolated API. It does not export DB/service secrets into app environment.
- `/tmp/bj-delegation-apply.sh` sourced deployment migration helpers and applied/recorded only the
  feature migration. **Do not rerun it** now; its purpose is historical evidence.

Run existing rollback-only test files **directly** now that migration is applied:

```bash
docker exec -i bj-delegation-db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q' \
  < tests/sql/approval-delegation.sql
```

Repeat for the five other `tests/sql/*.sql` suites. Some older suites print FAIL notices rather than
exit nonzero: count/search both FAIL and ERROR, not only exit status.

**Do not reuse `.bj-deploy/delegation/*.sql` generated scenario wrappers:** those prepend the already
applied CREATE migration and will duplicate objects. For future forward migration dry runs, prepend
only the new unapplied migration inside BEGIN/ROLLBACK, then the intended test body.

For regeneration, only the isolated target:

```bash
BJ_DB_CONTAINER=bj-delegation-db npm run schema:dump
```

Docker/local listener operations need sandbox escalation in this environment. No automatic approval
review rejection occurred. Avoid broad cleanup or stopping unrelated containers/processes.

## Next steps, in recommended order

1. Read this handoff and narrow source files; verify branch, migration checksum, ledger and inactive job.
   Inspect interrupted worker UI/test additions. No broad repository rediscovery is needed.
2. Run final typecheck/lint/unit suite now schema is regenerated, including new worker tests; fix issues.
   Check the large generated schema diff against the frozen migration and baseline ACLs.
3. Seed **synthetic browser/concurrency fixtures** in isolated stack. Only admin exists now.
   Use admin password from test.env silently. Existing `seed-demo.mjs` hardcodes `Admin!2026`, so do not
   run it unchanged expecting random bootstrap credentials. Prefer a small isolated seed using guarded
   admin RPCs. Create CEO, HR head, another eligible direct-report manager/approver, employee and ordinary
   operational cover. Assign supplemental delegation role and explicit CEO/HR step configuration.
4. Execute real simultaneous sessions: worker/manual, worker/reject/cancel, revoke/worker, source absence
   cancellation/worker, permission change/worker. Test both lock acquisition orders; assert single exact
   step/ledger consumption, no authority after revocation and no deadlock/cross-request corruption.
   SQL unit scenarios are sequential and do not replace this. If fixing SQL, create a new forward
   migration with CLI; original migration is frozen.
5. Actually run pg_cron in the isolated stack, with a due synthetic request and browser closed.
   Confirm run details, actual timestamp, idempotence, retries/failed-item isolation. Enable only this
   isolated job for the test and return it inactive afterward. Never enable production here.
6. Browser QA: admin role Yes/No, delegate selection/change and executive mapping; CEO self-service
   without role authoring; manager eligible/ordinary/no replacement paths; AM/PM preview and stale
   consent; four forms; named approver access; multiple exact-step decisions; early manual and timed
   automatic evidence; Farsi/English print, desktop/mobile and keyboard. No screenshots exist yet.
7. Run final `npm run build -- --webpack`, relevant deploy tests, all SQL regressions and targeted E2E.
   Avoid concurrent build/dev runs sharing `.next`. Stop only the app process created for this task
   before final build, and restart if useful for review.
8. Update domain docs (`DATA_MODEL`, `PERMISSIONS`, `REQUIREMENTS` as appropriate), plan/backlog and
   journal with actual outcomes. Keep unreleased status explicit; CHANGELOG only if clearly marked
   unreleased, not shipped. Existing design docs are historical policy records.
9. Report implemented behavior, verification evidence, local-only status, inactive worker, deferred
   credential risk and remaining release steps. Do not claim completion while required validation is
   missing. No commit/push/deploy unless owner requests it.

## Additional traps and review pointers

- Installed Next docs are `node_modules/next/dist/docs/.../*.md`, not `.mdx`. Server-action docs and
  forms guide were read; follow repo Context7 rules for library-specific API questions.
- Skills used: Supabase, React best practices, frontend testing/debugging. Browser plugin/skill is
  absent in this session; regular Playwright was the planned QA path, not yet executed. Existing
  Playwright global setup/teardown treats `E2E_BASE_URL` as API gateway too; port3002 app is separate
  from8092 API. Inspect/use an isolated configuration or temporary focused script rather than blindly
  running shared setup/cleanup. `.env.test-accounts` can load unrelated real-roster defaults; override
  explicitly. Screenshots/traces should stay outside Git, e.g. `/tmp`.
- Four form paths: daily root `request/LeaveRequestForm.tsx`, `hourly/HourlyRequestForm.tsx`,
  `errand/ErrandRequestForm.tsx`, `daily-errand/DailyErrandRequestForm.tsx`.
- No PNGs in queue/context lists; fetch scoped signatures on demand/print only.
- A single approval can leave another exact step for same actor; do not optimistically hide forever.
- No valid ledger row means unknown balance, not necessarily zero.
- New worker UI status may say healthy when last run is old but no requests overdue; consider whether
  stale execution needs separate wording during QA, without claiming processing is timely from no work.
- New DB error `approval worker health unavailable` currently falls back to generic localized error;
  inspect whether a specific mapping is worthwhile. Existing raw delegation errors were mapped.
- `schema.sql` generated diff is substantial (2,379 additions/614 deletions at handoff); review for
  unintended baseline drift rather than assuming all generated churn is desired.
- The handoff itself did not run new implementation tests. A read-only SQL verification initially failed
  due literal Unicode-escape quoting, then succeeded via a quoted heredoc. No DB change from that failure.
