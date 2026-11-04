# Admin panel v2 backlog: critique and questions

**Date:** 2026-11-03 · **Branch:** `claude/admin-panel` @ 13877b9 · **Status:** answered; spec drafted in `docs/specs/2026-11-03-admin-panel-v2-design.md`
**Scope:** backlog items 1–7 (owner's wording) against FR-77 / FR-78 as built.
Line numbers in `supabase/schema.sql` are for the file at 13877b9.

---

## Part 1: Date-range export, archive + hard-delete, re-import (items 3b, 3c, 7)

### Verdict

| Feature | Sound? | Why |
|---|---|---|
| 7. Export a start–end window to move hosting | **No** | A move needs the whole state. Balances, logins, config and the migration ledger all live outside any window. |
| 3b. Archive a window, then hard-delete it | **No** | The deletes cascade into signed evidence and corrupt balances. The data is also too small for deletion to buy anything. |
| 3c. Re-import an archive | **No** | Insert triggers fire again, foreign keys may point at rows that are gone, and the schema moves forward-only. Making it work needs superuser SQL. |

### Concrete breakages in this schema

1. **Balances inflate after deleting ledger rows.** Balance = the `leave_ledger` row with the highest `seq`
   (`docs/DATA_MODEL.md` §leave_ledger). `accrue_leave` takes `min(period_month)` of the posted
   allocations as `v_first_post`. When that is later than the policy's start, it skips the short-circuit
   and posts every month that has no row (`schema.sql:3670-3740`, `on conflict do nothing` keyed on
   `leave_ledger_period_uniq`, `:9967`). So hard-deleting a window's `allocation` rows makes the next
   balance read post those months again and add the minutes a second time. Deleting `consumption` /
   `adjustment` rows also breaks the `balance_after_minutes` chain that HR uses to explain a balance.
2. **Cascades destroy evidence.** Deleting a `leave_requests` row cascades to `leave_request_approvals`
   (`:10863`), `errand_extensions` (`:10767`), `travel_bookings` (`:11159`), `approval_request_policy`
   (`:10655`), `approval_delegations.source_request_id` (`:10607`) and `home_dismissed_requests`
   (`:10799`). It sets `leave_ledger.request_id` (`:10847`) and `sms_outbox.request_id` (`:11095`) to
   null. The signed approvals go with it.
3. **The window has no single meaning.** A request has `created_at`, `start_date`/`end_date`,
   `decided_at`, approvals with their own `created_at`, and ledger rows posted later (lazy accrual writes
   `created_at` months after `period_month`, DATA_MODEL §leave_ledger). Any cut leaves orphans on one side.
4. **References across the window are not time-bound.** `profiles`, `departments`, `roles`/`user_roles`,
   `approval_steps`, `employee_leave_policies`, `leave_types` (RESTRICT, `:10903`) are current state, not
   history. A profile cannot be archived with a window. Deleting a departed person's `auth.users` row
   cascades to `profiles` (`:10943`), then to all their `leave_requests` (`:10895`) and `leave_ledger`
   (`:10831`).
5. **Re-import fires the triggers again.** Inserts into `leave_requests` / `leave_request_approvals` run the
   SMS constraint triggers (`:10457`, `:10464`): old requests would text approvers again once the 180-day
   outbox purge has removed the dedupe rows (`sms_outbox_approver_once`, `:10163`). They also run the
   FR-76 refusal for people who are now security-only (`:10408`), the per-diem trigger (`:10401`) and the
   company approval lock (`:10317`). Avoiding that needs `session_replication_role = replica`
   (superuser), which is hand-run SQL that CLAUDE.md forbids.
6. **IDs and keys.** UUID primary keys only avoid collisions for rows that are really gone. A partial
   re-import collides on `leave_requests_pkey` and on `leave_requests_serial_uniq` (`:10044`), and on
   `leave_ledger_period_uniq` once accrual has posted the months again (point 1). Re-imported `seq` values
   come from the old sequence and land between newer rows.
7. **Schema drift.** Migrations are frozen and forward-only (CLAUDE.md). An archive written at migration
   N is restored into N+k with new columns, tighter CHECKs and new enum values (for example, every new
   `travel_bookings` column breaks row literals, CLAUDE.md). There is no down-migration back to the
   archive's shape, so every future release would need a transformer for every old archive version.
8. **`auth.users` and passwords.** Logins are `auth.users` (`encrypted_password` = bcrypt), plus
   `auth.identities`, `auth.sessions` and `auth.refresh_tokens`. None of these is dated by a window. A
   hosting export without them means 147 new passwords. With them, the archive is a password-hash file.
9. **pg_cron and the extensions.** Jobs are rows in `cron.job`, created by migrations
   (`20261007150002`, `20261103140001:596`) and only in database `postgres`. A data window carries no
   jobs; a full dump does. `pg_net`, `private.sms_settings` (holds the Melipayamak `api_key`) and
   `bj_deploy.schema_migrations` must also move, or the next release runs every migration again.
10. **Personal data leaving the server.** Any window file carries `employee_personal_info` (national ID,
    Sheba, card number, mobile; DATA_MODEL §FR-53), signature PNGs and, for a hosting move, password
    hashes. Encrypting backups is still an open TASKS item ("Encrypt backups").

### What to use instead

- **Moving hosts:** the full logical dump that already exists. `deploy/liara/backup.sh` runs a nightly
  `pg_dump -Fc` of all of `postgres`. Restore with the procedure in `docs/DEPLOY-LIARA.md` §Backups:
  a `pg_restore -l` list without the graphql ACL entry, `--clean --if-exists --exit-on-error
  --single-transaction`, then `liara/restore-graphql.sql`. That procedure passed a restore rehearsal
  (33 tables matched). Carry the VM `.env` separately (`JWT_SECRET`, `ANON_KEY`, DB password;
  `deploy/RUNBOOK.md:147-148`). Size is no argument for a window: the newest Liara dump is **2.5 MB**.
- **Storage growth:** no deletion is needed. Measured on Liara: DB **19 MB**, 147 users, 17 requests.
  Signatures are the bulk (about 126 KB per request across requester, approver and step images; the
  dump grew 1.56 → 2.55 MB on 2026-11-02, a day with 7 new requests). [estimate] At about 2 requests
  per person per month (140 active), that is roughly 3,400 requests and **~0.4 GB a year**. The real
  pressures are:
  1. **`cron.job_run_details` has no purge.** Once FR-78 ships, `bj-sms-dispatch` adds about 2,880 rows
     a day (local: 512 runs in about 4 h; 533 rows = 144 kB). That is about 1 M rows and ~0.15–0.3 GB a
     year of junk, in every dump too. Fix it with a purge job in a new migration (FR-78's migrations are
     frozen).
  2. **28 full dumps on a 19 GB disk** (14 daily in `/var/backups/bj-erp`, `backup.sh:22`; 14 pre-deploy
     in `/opt/bj-erp/backups`, `deploy/update.sh:52,233`). 8.4 GB is free (53% used). At ~0.4 GB a dump,
     28 copies take ~11 GB, so retention, not the data, fills the disk first. Levers: fewer on-VM copies,
     a bigger disk, or both. `pull-backups-to-mac.sh` already alerts above 85%.

---

## Part 2: Risk flags for the rest of the backlog

**Needs an infrastructure / compose change (refused by `apply-release.sh:40-44`)**
- 1 · Backup download: the app container has no mount of `/var/backups/bj-erp`, and it has no
  `pg_dump` and no superuser credentials. Serving a dump needs a volume added in compose.
- 2 · Failed logins: GoTrue writes only successful logins to `auth.audit_log_entries`. A failed
  password returns `invalid_credentials` with no audit row (Context7 `/supabase/auth`, `token.go`).
  Failures appear only in the `auth` container's stdout. Storing them needs GoTrue's
  password-verification hook (new `GOTRUE_HOOK_*` env in compose). Login runs in the browser
  (`lib/auth/usernameEmail.ts:24-28`), so if the app recorded failures itself, anyone (anon) could forge them.
- 2 · Rate-limit status: the limit is `RATE_LIMIT_TOKEN_PER_IP_5_MINUTES` in the VM `.env`
  (`docker-compose.yml:99`). The app cannot read it, and GoTrue exposes no limiter state. Changing it
  is an operator edit plus recreating `auth`. That needs no compose-file change, but it cannot be done
  from the panel.
- 6 · Error viewer: reading `docker logs` from the app needs the Docker socket (a compose change, and
  root-equivalent access). There is no `instrumentation.ts`, `error.tsx` or `global-error.tsx` today.

**Would expose secrets or every employee's data through the browser**
- 1 · Raw backup download: one file holds every bcrypt hash, every national ID / Sheba / card number,
  every signature and `private.sms_settings.api_key`. It would go to whatever device the admin uses,
  behind one password with no second factor.
- 1 · "CSV per table": raw tables include `auth.users.encrypted_password`, `private.sms_settings.api_key`
  and base64 `signature_data`. A raw export also skips the shaping the app does on purpose: FR-25
  private `reason`, and travel costs stripped from travellers (CLAUDE.md).
- 6 · Error rows: exception messages and stacks can carry SQL parameters and personal data. Storing
  them creates a new personal-data table that needs its own purge.

**Would destroy legal or audit evidence**
- 3a · A signature retention period: `signature_data` in `leave_requests` (also
  `approver_signature_data`), `leave_request_approvals`, `errand_extensions`, `separation_signoffs` and
  `separations.finance_signature_data` is the only proof of who approved. `print/request` would print
  unsigned forms.
- 3a · An audit-log retention period: `audit_log` is the only record of `set_leave_balance`,
  `opening_balance` and role changes. On Liara it holds 2,122 rows / ~1 MB after four weeks of onboarding.
- 3b · Hard-delete: the cascades in Part 1 §2.

**Duplicates what FR-77 / FR-78 already ship**
- 3a · SMS log retention: the 180-day purge already exists (`bj-purge-sms-outbox`). Only "editable"
  would be new.
- 5 · Audit search: `app_audit_log` already takes `p_actor uuid` (`schema.sql` app_audit_log body,
  `a.actor_id = p_actor`). Only the UI is missing (`admin/audit/page.tsx` offers range, entity and
  action). Search by target person (`entity_id`) is genuinely new.
- 2 · "Recent successful logins": Overview already shows signed in within 7 / 30 days and never signed
  in (`auth.users.last_sign_in_at`, spec §2).
- 1 · Backups: the System tab already lists them (`private.backup_runs`), and
  `pull-backups-to-mac.sh` already makes the off-server copy.
- 4 · Pattern mode: the template text lives at Melipayamak, and each `bodyId` must be approved by the
  provider (error −5 when it is not; [Melipayamak SendByBaseNumber2](https://www.melipayamak.com/api/sendbybasenumber2/)).
  Editing texts in the panel helps line mode only. Today the text is built in
  `private.sms_enqueue_request`.

**Findings that need no question**
- Force sign-out works without infrastructure. GoTrue's own logout deletes the user's `auth.sessions`
  rows (refresh tokens follow; Context7 `/supabase/auth`, `models/sessions.go` `Logout`). An admin-only
  definer function can do the same. Access tokens stay valid until they expire (≤ 3600 s,
  `GOTRUE_JWT_EXP`). Password reset and deactivation should call it too; today a reset leaves the
  target's sessions alive (TASKS, FR-55 "account control").
- Editable password policy needs no compose change, but min 8 / max 72 is hard-coded in six SQL
  functions (`schema.sql:881, 4731, 4839, 6497, 6593`) plus `lib/auth/passwordPolicy.ts`.
  `app_enqueue_password_sms` checks `< 6` (`:5298`).
- ~~Every Liara login has the same `ip_address`.~~ **Corrected 2026-11-03:** GoTrue writes an
  empty `ip_address` on every `auth.audit_log_entries` row (all 675 rows, every action); the
  "1 distinct" was the empty string. See "Owner answers" for the follow-up check. An IP column in a
  login list would still show nothing useful.

---

## Part 3: Questions for Amir

**Item 1: Data export**
1. What is the CSV export for, and who opens the files?
   Found: curated exports already exist (personal info `app_export_personal_info` with an audit row;
   reports; finance; `lib/csv/download.ts`).
   Options: (a) curated exports on screens only; (b) one admin "export all as spreadsheets" zip of app
   tables, without `auth`, `private` and signature columns; (c) raw per-table.
   Recommendation: (b) if the goal is "we own our data", otherwise (a). Never (c).
2. Do you still want backup download in the browser?
   Found: the app cannot reach the dumps (Part 2), the Mac pull already works, and a dump holds every
   hash and ID number.
   Options: (a) drop it and show the Mac pull status instead; (b) one explicit compose change to mount
   the backups read-only, behind password re-entry; (c) an admin-triggered dump encrypted with a passphrase.
   Recommendation: (a).

**Item 2: Sessions and security**
3. Is it acceptable that a force-signed-out person keeps access for up to 60 minutes?
   Found: deleting `auth.sessions` stops refreshes; the JWT lives 3600 s.
   Options: (a) accept 60 minutes; (b) check the token's session on every page and action (one extra
   query each); (c) a shorter `GOTRUE_JWT_EXP` (compose change, more refreshes against the shared-IP limiter).
   Recommendation: (a), and also sign out on password reset and deactivation.
4. Failed logins: may this wait for the next infrastructure change?
   Found: GoTrue does not store failures (Part 2).
   Options: (a) successful logins only for now; (b) one compose change for GoTrue's
   password-verification hook, writing failures to a table.
   Recommendation: (a), and fold (b) into the next planned infra change.
5. How will the company-wide first login happen: one training session, or person by person?
   Found: 124 of 147 Liara accounts have never signed in. The busiest hour so far had 19 logins.
   ~~All logins share one IP~~ (wrong, see the correction in Part 2). Limit: burst 30, then ~1/s per address.
   Options: (a) onboard in groups; (b) raise `RATE_LIMIT_TOKEN_PER_IP_5_MINUTES` in the VM `.env` once
   (operator step); (c) both. The panel would show only the configured number, not the live state.
   Recommendation: (c) before a training day.
6. Which password rules should the admin be able to change?
   Found: min 8 / max 72, fixed in six SQL functions and the TS policy.
   Options: (a) minimum length only (never below 8); (b) length plus character classes; (c) keep it fixed.
   Recommendation: (a). Labourers type on phones; character rules cost more support calls than they add.

**Item 3: Retention and storage**
7. What is the real worry behind archive and delete: disk space, privacy law, or speed?
   Found: DB 19 MB; growth ~0.4 GB a year [estimate]; the disk fills first from 28 dump copies and the
   unpurged `cron.job_run_details` (Part 1).
   Options: (a) disk: purge cron history and tune dump retention, and drop 3b/3c; (b) privacy: a
   retention rule for departed employees' `employee_personal_info`, not for requests; (c) both.
   Recommendation: (a), and drop 3b, 3c and 7.
8. How many years must the client keep leave/errand records, their signatures and the audit log
   (labour office, insurance audits)? This is a question for the client's HR or legal.
   Options: (a) keep everything; (b) keep N years, then remove the signature images and keep the rows;
   (c) let the admin set N.
   Recommendation: (a) until the client names N.

**Item 4: SMS templates**
9. Will texts go from the line or by pattern? This waits on IT's service-or-promotional answer (spec §7.1).
   Found: pattern texts live at Melipayamak and need its approval; line texts are built in SQL.
   Options: (a) editable texts for line mode, with checked placeholders; (b) no editing (pattern texts
   are edited in the Melipayamak panel); (c) both, each per mode.
   Recommendation: decide after IT answers; (a) if it is a service line.

**Item 5: Audit search**
10. Does "search by person" mean who did it, whom it was done to, or both?
    Found: the SQL actor filter exists without a UI; there is no target filter; logins are in a
    separate table (`auth.audit_log_entries`).
    Options: (a) actor picker; (b) actor plus target; (c) (b) plus login events merged in.
    Recommendation: (b).

**Item 6: Error log**
11. Who reads the error log: you as the developer, or the client's admin?
    Found: errors go only to the `app` container's stdout (13 error-like lines in the last 63 log lines on
    Liara); there is no error hook in the app.
    Options: (a) a Next.js `onRequestError` hook writes rows to a DB table, the admin tab lists them, and a
    30-day purge removes them; (b) no UI, a runbook line for `docker compose logs app`; (c) an external
    error service (reachability from Iran [unverified]).
    Recommendation: (a). It needs a server-only write path, because the app has no `service_role`.

**Item 7: Migration export**
12. Is there a real hosting move planned (on-prem, another provider), and when?
    Found: the full dump-and-restore path exists and was rehearsed; a window cannot carry logins,
    balances or jobs (Part 1).
    Options: (a) full dump + `.env` handover with the DEPLOY-LIARA restore; (b) the same plus a rehearsal
    restore on the target before the cutover.
    Recommendation: (b), and drop item 7.

---

## Checks run

All database sessions were `begin transaction read only; … rollback;`. Only aggregates were selected.

**Local** (`bj-erp-db-1`, `supabase_admin`, password from `POSTGRES_PASSWORD` in `deploy/.env`, not printed)
- `pg_database_size('postgres')` → 19 MB.
- Top tables (total): `audit_log` 1312 kB, `leave_requests` 1072 kB (toast 904 kB),
  `leave_request_approvals` 392 kB, `auth.audit_log_entries` 248 kB, `user_signatures` 232 kB,
  `leave_ledger` 216 kB.
- Rows by year (all 2026): `audit_log` 1538, `leave_requests` 13, `leave_request_approvals` 13,
  `leave_ledger` 56, `auth.audit_log_entries` 495.
- Signature bytes: requester 555 kB / 13, approver 98 kB / 3, step approvals 195 kB / 6, extensions 22 kB / 1,
  saved 91 kB / 2.
- Profiles 18 active / 1 inactive; `auth.users` 19; mobiles 1.
- `cron.job`: `bj-apply-separations`, `bj-sms-dispatch` (30 seconds), `bj-purge-sms-outbox`.
  `cron.job_run_details`: 533 rows / 144 kB (512 of them `bj-sms-dispatch`, all succeeded); avg row
  136 B; `cron.log_run` on; `pg_net.ttl` 6 hours.
- `private.backup_runs` 0 rows; `net._http_response` 0 rows / 32 kB; `bj_deploy.schema_migrations` 118 rows.
- Grep: no `cron.job_run_details` purge in `supabase/migrations/`.

**Liara** (`ssh liara-bj-vm`, `/opt/bj-erp`)
- `docker compose … ps`: app up 18 h; auth, db (healthy), gateway and rest up 4 weeks.
- `df -h /`: 19 G, 9.4 G used, 8.4 G free (53%).
- `ls -l /var/backups/bj-erp`: 15 dumps, 1,349,024 B (2026-10-19) → 2,552,153 B (2026-11-02);
  `du -sh` 23 M. `/opt/bj-erp/backups`: 14 pre-deploy dumps, 23 M.
- psql as `supabase_admin` inside the db container, authenticated with the container's own
  `$POSTGRES_PASSWORD` env, never printed. (Socket auth without a password failed first.)
  - DB 19 MB. Top: `audit_log` 1512 kB, `leave_request_approvals` 1480 kB (toast 1376 kB),
    `leave_requests` 1248 kB, `user_signatures` 672 kB, `leave_ledger` 336 kB, `auth.audit_log_entries` 304 kB.
  - Rows (2026): `audit_log` 2122 (Oct 1252 / Nov 870), `leave_requests` 17, approvals 35, ledger 331,
    `auth.audit_log_entries` 675.
  - Signature bytes: requester 440 kB / 17, approver 440 kB / 12, step approvals 1266 kB / 35, saved 511 kB / 17.
  - Profiles 140 active / 7 inactive; `auth.users` 147; mobiles 134; never signed in 124;
    `must_change_password` 124.
  - Sessions 38 (18 users); refresh tokens 113 (38 live). Auth audit actions: token_refreshed 289,
    token_revoked 197, login 135, logout 54.
  - Logins: `ip_address` empty on all rows (first read as "1 distinct"); max 19 in one hour.
  - `cron.job`: only `bj-apply-separations` (28 runs, all succeeded). Migrations: 116, newest
    `20261103120000_security_only_no_time_off.sql`.
- `docker compose logs --tail=200 auth` (counted, not printed): 2 `/token` lines, 0 with status 400 or
  `invalid_credentials`. `logs --tail=200 app`: 63 lines, 13 contain "error".

**Docs**
- Context7 `/supabase/auth`: `POST /logout` scopes; `models.Logout` deletes `auth.sessions` by user;
  JWTs stay valid until expiry; the password grant writes an audit row only on success;
  `GOTRUE_AUDIT_LOG_DISABLE_POSTGRES`.
- Web: [Melipayamak SendByBaseNumber2](https://www.melipayamak.com/api/sendbybasenumber2/) (approved
  `bodyId`, error −5), [SharedServiceBodyEdit](https://www.melipayamak.com/api/sharedservicebodyedit/).
  Whether an edited template needs approval again: [unverified].

## Owner answers (2026-11-03)

| # | Answer |
|---|---|
| 1 | Skip CSV exports for now; revisit if a real need shows up. |
| 2 | (a+) No browser download. The System tab shows when the Mac pull last copied a dump, red when it stops (the pull script reports back after each copy). |
| 3 | (a) Accept up to 60 minutes of access after a force sign-out. Also sign out on password reset and deactivation. |
| 4 | No failed-login log. Successful logins only (already in Overview). |
| 5 | HR onboards department by department (started with Assembly Line, on the company Wi-Fi). No rate-limit change. Address check run, result below. |
| 6 | Minimum length stays 8. Also require at least 1 digit and 1 special character. No forced change for existing passwords. |
| 7 | Skip archive and delete (3b, 3c) for now. The cron-history purge and dump retention still stand as fixes. |
| 8 | Keep everything until the client names a retention period N. |
| 9 | On hold until the client's IT answers (service vs promotional line). |
| 10 | (b) Audit search by actor and by target person. |
| 11 | Amir reads the error log (developer and admin until further notice). (a) DB table + admin tab + 30-day purge. |
| 12 | No move planned yet; Liara cost or client self-hosting may decide it within days. (b) Full dump + `.env` handover + a test restore before cutover. Drop item 7. |

Notes found while recording the answers:
- `generateTempPassword()` (`lib/actions/employees-helpers.ts:40-52`) already puts one digit and one symbol in every temporary password, so answer 6 only changes the checks, not the generator.
- The Mac backup pull is installed and runs daily: launchd job `app.bjeng.backup-pull` loaded; 33 dumps in `~/Backups/bj-erp`; `pull.log` shows one copy each day at 09:00 through 2026-11-03.

### Address check (question 5), 2026-11-03

Read-only aggregates on Liara (`auth.audit_log_entries`, `auth.sessions`); no address printed.

- `auth.audit_log_entries.ip_address` is empty on all 675 rows (login 135, token_refreshed 289,
  token_revoked 197, logout 54). The pinned GoTrue does not fill it. The "one shared address" in
  Part 2 was the empty string.
- `auth.sessions.ip`: 38 sessions. 20 carry a public address: 11 distinct addresses for 10 users,
  and the most-shared one has 1 user. 18 carry one private address (13 users, all refreshed): the app
  container, because server-side refreshes reach Auth through the internal `:8080` listener.
- So the gateway sees distinct real client addresses (`deploy/liara/Caddyfile` stamps
  `X-BJ-Client-IP {client_ip}` from the socket, `TRUSTED_PROXY_CIDRS` default). No sign of the
  collapse-into-one-bucket bug. The limiter's own bucket key cannot be read from the database;
  the wiring is covered by `tests/unit/login-rate-limit.test.ts` [runtime not verified].
- Consequence for the login list: neither table holds a usable per-login address, so it shows
  time and person only.
