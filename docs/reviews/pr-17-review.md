# PR #17 review — admin panel, SMS, sign-out, password rule (FR-77…80)

**PR:** https://github.com/AmirNcode/bj-erp/pull/17 · `claude/admin-panel` → `main`
**Reviewed:** 2026-11-04, commits a00f249, 13877b9, 43f4ee6 (58 files). Fix commit b44d0c8.
**Reviewer:** Claude Opus 5.5 via Claude Code, under the owner's pre-approved review/fix/merge run.
**Weighting:** security/auth and SQL migrations first; frontend and deploy scripts only where they
touch those two.

## Verdict

**Mergeable after F1.** One High finding (F1: the "write-only" SMS API key came back in database
error details) is fixed in a new migration, `20261104120000_sms_settings_errors_hide_key.sql`. No
Critical finding. Admin-only enforcement holds in the database for every new RPC. Sign-out really
deletes sessions and refresh tokens; GoTrue refuses the old token at once. Dry run is the default.
All migrations apply cleanly from main's state. Five Medium and seven Low findings stay open (below).
The most useful one for the owner is **F2**: GoTrue's own password endpoint skips the FR-80 rule.

## Findings

| ID | Severity | Area | File:line | Issue | Evidence | Proposed fix | Status |
|---|---|---|---|---|---|---|---|
| F1 | **High** | Security / SMS key | `supabase/migrations/20261103140001_sms_notifications.sql:466-484` (`app_set_sms_settings`) | A CHECK or NOT NULL violation (sender line `12`, blank site label, malformed key, null mode) makes Postgres attach DETAIL `Failing row contains (…)` listing the whole `private.sms_settings` row, **stored `api_key` included**. PostgREST returns DETAIL to the caller, so anyone with an admin token (stolen cookie, XSS, extension) can read the write-only key back, then send SMS on the company's account after the session ends. The DB log keeps it too (`log_min_messages=warning`, `log_error_verbosity=default`). | Clone `pr17_head`, as the admin: saved key `FAKEKEYabcdef123456`, then saved sender line `12` → DETAIL contained the key (`detail_contains_key=true`). | New migration re-raises those violations with only the constraint/column name (db-error.ts rules still match); same signature and grants. | **Fixed** b44d0c8 — test `F1:` cases in `tests/sql/sms.sql` fail before, pass after. |
| F2 | Medium | Password rule (FR-80) | `deploy/liara/Caddyfile` (`handle /auth/v1/*`) · `deploy/docker-compose.yml:52-90` (no `GOTRUE_PASSWORD_*`) | `PUT /auth/v1/user` is public and lets any signed-in user set their own password with GoTrue's rule only (default: 6 characters, no digit or special). The app never calls it. Reach: own account only, needs a live session and deliberate API use; a user who still has `must_change_password` is sent back to the first-login form anyway. | Test GoTrue v2.170.0 on a clone: `PUT /user {"password":"abcdef"}` → 200, then login with `abcdef` → ok. | Owner decision (compose change, outside this run): `GOTRUE_PASSWORD_MIN_LENGTH: '8'` and `GOTRUE_PASSWORD_REQUIRED_CHARACTERS` (digits, specials) on `auth`, or a Caddy `respond 404` for `PUT /auth/v1/user`. | Open |
| F3 | Medium | pg_net grants | `20261103140001_sms_notifications.sql:23` (`create extension pg_net`) | The image's pg_net event trigger grants `anon`/`authenticated` USAGE on `net`, every privilege (incl. TRUNCATE) on `net.http_request_queue` / `net._http_response`, and EXECUTE on `net.http_get` / `net.http_post`. The queue briefly holds URLs with the API key and, in line mode, bodies with temporary passwords. Not reachable over HTTP today (`PGRST_DB_SCHEMAS: public`), so no live exposure; exposing `net` later would mean SSRF plus key leak. pg_net is new in this PR (absent from main's dump). | `has_table_privilege('authenticated','net.http_request_queue','select')=true`, `has_function_privilege('anon','net.http_post(…)','execute')=true` on the clone. | New migration: `revoke all on all tables in schema net from anon, authenticated; revoke execute on all functions in schema net from anon, authenticated; revoke usage on schema net from anon, authenticated;` (dispatch runs as the job owner, unaffected). | Open |
| F4 | Medium | SMS duplicates | `20261103140001…sql:339-353` (`sms_dispatch` step 1) | At-least-once: a 15 s timeout, a 5xx, or "no reply in 10 min" re-queues (up to 3 attempts) although the provider may already have delivered. If the pg_net worker stalls, the first request is still in its queue and goes out after the retry → two texts. Live mode only. | Code reading; overlap between runs is safe (`for update skip locked`, pg_cron never overlaps one job, `net.http_post` is transactional). | Do not retry on timeout / no reply (mark failed for the admin), or check delivery by `recId` before resending. | Open |
| F5 | Medium | SMS outage | `20261103140001…sql:361-373, 376-429` | `sms_dispatch` is one transaction with no per-row guard. One bad row aborts the whole run every 30 s, e.g. a credit reply whose `amount` is not numeric (`(v_json->>'amount')::numeric` raises, `credit_request_id` never clears) → no SMS goes out until someone fixes it by hand. | Code reading. The job's failures would show in System › Scheduled jobs (`failures_24h`). | Per-row `begin … exception … end` around steps 2 and 3, marking that row failed. | Open |
| F6 | Low | Grants | `20261103140001…sql:98-104` | `public.sms_outbox` (and the older `audit_log`) carry Supabase default ALL grants to `anon`/`authenticated`, TRUNCATE included. RLS blocks every write: non-admin and admin inserts → 42501, admin update/delete of `audit_log` → 0 rows. TRUNCATE is not reachable through PostgREST. | Grant and RLS probes on the clone. | `revoke insert, update, delete, truncate on public.sms_outbox from anon, authenticated` to match the comment. | Open |
| F7 | Low | SMS key in transit | `20261103140001…sql:404, 419, 527` | The Melipayamak console API puts the key in the URL path (pattern **and** line mode, plus credit check). TLS protects it in transit, but provider/proxy access logs and the transient pg_net queue row hold it. Inherent to the provider API. | Code reading. | None in code; rotate the key if a log is exposed. | Open (note) |
| F8 | Low | SMS content | `20261103140001…sql:566-590` | `app_enqueue_password_sms` texts any admin-supplied string as the "temporary password" and still checks only ≥ 6 characters (deliberately unchanged in v2). Admin only. | Code reading. | Check `assert_password_ok`, or compare against the user's current hash. | Open |
| F9 | Low | Password rule parity | `lib/auth/passwordPolicy.ts:37-43` vs `20261104090000…sql:24-29` | TS counts UTF-16 units; SQL counts characters (min 8) and **bytes** (max 72, the bcrypt limit). Identical for ASCII; every form runs input through `toLatinPassword` (printable ASCII only) and generated passwords are ASCII, so forms and SQL agree. Only a caller that bypasses the forms could see a different message; SQL decides. | Code reading; digit set and the 32 specials match exactly. | None needed; optionally count bytes in TS. | Open (note) |
| F10 | Low | Backup ledger input | `20261103140000_admin_panel.sql:20-26` | `private.record_backup` accepts any name/size/hash, unlike `record_offsite_copies`, which checks a strict pattern. Superuser-only; `backup.sh` builds the name from `date`, so no injection today. | Code reading; `has_function_privilege('authenticated',…)=false`. | Same `^daily-…\.dump$` and hex checks as `record_offsite_copies`. | Open |
| F11 | Low | pg_cron purge | `20261104090000…sql:592-598` | `bj-purge-cron-history` deletes history older than 7 days for every job, not only `bj-*` ones, and never deletes rows with a null `end_time` (runs killed mid-way). All jobs are `bj-*` today. | `cron.job` on local `postgres`: 4 jobs, all `bj-*`. | Add `and jobid in (select jobid from cron.job where jobname like 'bj-%')`, and purge null `end_time` by `start_time`. | Open |
| F12 | Low | SMS backlog | `20261103140001…sql:376-397` | If dispatch stalls while in Dry run, queued rows pile up; switching to Live then sends the backlog, including old approver texts for requests still pending. It needs an admin action, but the texts can be stale. | Code reading. | Mark rows older than N hours `skipped/stale` at dispatch time. | Open |
| F13 | Info | Residual access | `20261104090000…sql:40-42` | After sign-out, an access token already issued still works against PostgREST until it expires (≤ 60 min, `GOTRUE_JWT_EXP=3600`). Owner accepted this. GoTrue itself refuses the token at once. | Test GoTrue: `/user` → 403 `session_not_found`, refresh → 400 `refresh_token_not_found`. | Accepted. | Accepted |

## Checklist

### Security / auth

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Admin enforced server-side on every new RPC/table; every `lib/actions/admin.ts` action starts with `requireCaller` + admin | **Pass** | Every public function calls `private.require_admin()` first (`…140000.sql:55,145,215`; `…140001.sql:439,460,499,522,540,571`; `…090000.sql:68,86,111,541`). Probe as an employee on the clone: all 12 admin RPCs → 42501. `lib/actions/admin.ts:29` `requireAdmin = requireCaller({ anyOf: ['admin'] })`, called first in each action (`:37,61,99,117,134,143,153,164,194,217,228,241`) followed by `if (!c.ok) return c`; `signOutEverywhere` same (`lib/actions/employees.ts`). Admin layout guard `app/[locale]/(app)/admin/layout.tsx:20`. `sms_outbox` RLS: select admin + own company only. |
| 2 | SECURITY DEFINER functions fix `search_path`; EXECUTE revoked where needed; grants on functions, tables, sequences | **Pass** (F3, F6 open as hardening) | All 30 new or changed definer functions have `search_path=""` (pg_proc probe). Internal ones (`record_backup`, `record_offsite_copies`, `revoke_sessions`, `sms_*` writers, `require_admin`, trigger functions, `assert_password_ok`, `try_uuid`): `anon=false auth=false`. Pure helpers (`audit_redact`, `sms_mask`, `normalize_ir_mobile`, `jalali_text`, `sms_kind_label`) are executable but immutable and in unexposed `private`. Private tables: no grants to anon/authenticated. No new sequences outside identity columns of private tables. `net` grants: F3. `sms_outbox` default grants: F6. |
| 3 | SMS API key unreadable by any role; never in logs, pg_net tables, cron tables, audit rows, error messages | **Fail → Pass after F1** (F3, F7 notes) | `app_sms_settings` strips `api_key`, returns a 4-char hint (`…140001.sql:441-444`). Audit rows drop `api_key` (`:487-489`); `audit_redact` hides `api_key` keys. Cron command text is `select private.sms_dispatch()`, no key. `_http_response` has no URL column. **F1**: the key was in error DETAIL and the DB log; fixed. Transient presence in `net.http_request_queue.url`: inherent (F7), grants F3. pg_net worker log content: **Unverified**. |
| 4 | Dry run default; only the admin changes mode; pg_net calls only Melipayamak; no duplicate sends on trigger retry, rollback, overlapping runs | **Pass** with F4 open | Column default `'dry_run'` and backfill (`…140001.sql:27,58`); `live` needs a key (CHECK). Only `app_set_sms_settings` (admin) writes the mode; no grants on `private.sms_settings`. URLs are hard-coded `https://console.melipayamak.com/api/…/` + key; the key CHECK `^[A-Za-z0-9._~-]{8,200}$` has no `/`, `?`, `#` or `@`, so the host cannot change. Trigger repeats: unique indexes + `on conflict do nothing`. Rollback: `net.http_post` only queues inside the transaction. Overlap: `for update skip locked`, pg_cron runs one instance per job. Timeout retries can duplicate: F4. |
| 5 | Sign-out revokes all sessions/refresh tokens; residual ≤ 60 min; non-admins cannot call it; "everyone except admin" cannot hit the admin | **Pass** | Test GoTrue v2.170.0 on a clone: 2 sessions → `revoke_sessions` → 0 sessions, 0 refresh tokens (FK `refresh_tokens_session_id_fkey … ON DELETE CASCADE`, same for `mfa_amr_claims`); `/user` and `PUT /user` with the old token → 403 `session_not_found`; refresh → 400. No legacy refresh tokens without a session on local `postgres` (count 0). `GOTRUE_JWT_EXP: '3600'` (`deploy/docker-compose.yml:69`). Non-admin → 42501. `app_revoke_all_sessions` filters `s.user_id <> auth.uid()` after `require_admin` (`…090000.sql:93`); `revoke_sessions` never touches the caller (`:51`); `app_revoke_sessions` refuses self (`:70`). |
| 6 | Every path that sets a password, and whether it enforces the rule; 72 bytes vs characters; forms match SQL | **Pass in the app; F2 open for GoTrue** | Enforced by `private.assert_password_ok`: `create_employee_impl` (used by `app_create_employee` and `app_bulk_create_employees`), `app_change_my_password`, `app_set_initial_password`, `app_set_employee_password`, `app_bulk_set_employee_passwords` (validates every row before the first write). **Not enforced:** GoTrue `PUT /auth/v1/user` (public, user session) → **F2**; GoTrue admin API (service_role only, used by `scripts/seed-demo.mjs` for demo data, never by the app); `deploy/sql/bootstrap_admin.sql` (install-time admin, ≥ 8 characters only, ops path). Signup disabled; recovery needs email that synthetic addresses cannot receive (Unverified on Liara). Max is `octet_length > 72` (bytes, bcrypt-safe for Farsi); min is characters. Forms strip non-ASCII, so TS and SQL agree (F9). Temp-password generator always has upper, lower, digit, special (`lib/actions/employees-helpers.ts:40-60`). |
| 7 | Audit rows cannot be inserted, edited or deleted by non-admins; target filter leaks nothing | **Pass** | `audit_log`: insert privilege false for authenticated; only an admin SELECT policy, so update/delete affect 0 rows even for the admin (probe: count unchanged). The `p_target` filter runs inside admin-only `app_audit_log`, scoped by actor company. |
| 8 | Deploy scripts: no SQL injection through names/hashes; inputs validated; no DB password printed | **Pass** (F10 Low) | `backup.sh` interpolates `basename` of a `date`-built name, `stat` digits and a `sha256sum` hex; output to `/dev/null`. `pull-backups-to-mac.sh` regex-checks every name and hash before building the array literal; `record_offsite_copies` re-checks the exact pattern; `$POSTGRES_PASSWORD` expands inside the container only (`\$`, single quotes), never echoed. `sudo -n` on the VM: **Unverified** (not run against the VM). |

### SQL migrations

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Apply cleanly on main's state, in order | **Pass** | `pr17_main` (backup `20261103T203122Z-1a204b`, ledger at `20261102130001`): main's 3 newer files, then the PR's 3 and the fix, each `--single-transaction`, no error. |
| 2 | Old `app_audit_log` overload dropped; callers use the new signature; grants re-applied | **Pass** | `drop function public.app_audit_log(date, date, uuid, text, text, integer, integer)` (`…090000.sql:535`), new 8-arg function with revoke/grant (`:586-587`). Only caller `lib/actions/admin.ts:101` passes `p_target`; `lib/supabase/types.ts:1772-1777` matches. Main's app never called it (new in this release), so the old app keeps working during the swap. |
| 3 | Idempotency, ordering, rollback | **Pass** | Ledger-tracked forward-only files; `create or replace` / `if not exists` where re-run matters; `cron.schedule` upserts by name. Old app compatible during the swap: main's temp-password generator already meets FR-80. Rollback = restore the pre-deploy dump. |
| 4 | pg_cron jobs: unique names, UTC schedules, purge scope | **Pass** (F11 Low) | `bj-sms-dispatch` (`30 seconds`), `bj-purge-sms-outbox` (`50 20 * * *`), `bj-purge-cron-history` (`0 21 * * *`); `cron.timezone = GMT` on local `postgres`; pg_cron 1.6 supports second intervals. Purge: `end_time < now() - 7 days` only. |
| 5 | `supabase/schema.sql` matches the migrations | **Pass** | Dump of `pr17_main` after all migrations vs `schema.sql`: only the 3 known re-parenthesized CHECK lines (`separation_signoffs_names`, `separation_units_names`, `user_signatures_shape`). Dump of local `postgres` = `schema.sql` exactly (before and after F1). |
| 6 | No compose, Caddy or .env changes | **Pass** | `git diff main...claude/admin-panel -- deploy/docker-compose*.yml deploy/Caddyfile deploy/liara/Caddyfile` → 0 lines. No `.env` or `env.example` in the diff. |

## Check results

All runs on clones in `bj-erp-db-1`; the local `postgres` DB was read-only except for
`./deploy/bj-deploy update local` (F1, backup `backups/deploy-assistant/local/20261104T060944Z-100dfa/`).

| Check | Before fix | After fix (fresh clones) |
|---|---|---|
| Migrations on main-state clone `pr17_main` | 6/6 clean | 7/7 clean (incl. `20261104120000`) |
| `tests/sql/*` on branch-state clone | 20/20 pass | 20/20 pass (new F1 cases fail before the fix, pass after) |
| `tests/sql/*` on main-state clone after migrations | not run | 20/20 pass |
| `npx tsc --noEmit` | pass | pass |
| `npm run lint` | pass | pass |
| `npm run test:unit` | 113 files / 1078 tests pass | 113 files / 1078 tests pass |
| `npm run build` | pass | pass |
| `npm run test:deploy` | pass | pass |
| `npm audit --omit=dev` | 0 vulnerabilities | 0 vulnerabilities |

The known `approval-delegation.sql` "overlapping leave request exists" failure did not occur on
either clone. Clones (`pr17_head`, `pr17_main`, `pr17_fix`) and the test GoTrue container were
removed afterwards.
| GoTrue sign-out probe (test GoTrue on a clone) | pass (see checklist 5) | not repeated (F1 does not touch it) |

## Open questions (owner)

1. **F2:** turn on GoTrue's own password rule (`GOTRUE_PASSWORD_MIN_LENGTH=8`,
   `GOTRUE_PASSWORD_REQUIRED_CHARACTERS`), or block `PUT /auth/v1/user` in Caddy? Either one is a
   compose/Caddy change, so it needs its own release.
2. **F3/F6:** a small follow-up migration revoking `net` and `sms_outbox` write grants from
   `anon`/`authenticated`? Safe; nothing in the app uses them.
3. **F4/F5:** before switching SMS to **Live**, decide whether a timed-out text should be retried
   (risk: duplicates) or shown as failed; and add per-row guards to the dispatcher.
4. Not verified here: what the pg_net worker writes to the Postgres log on a failed request, and
   the exact shape of Melipayamak replies (`recId`, `amount`). Check both in Dry run → Live trials.
