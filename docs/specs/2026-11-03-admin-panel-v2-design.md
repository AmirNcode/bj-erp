# Admin panel v2: sign-ins, password rule, audit by person, off-server copies

**Date:** 2026-11-03 · **Status:** approved by owner 2026-11-04 ("proceed with the work"); built on `claude/admin-panel` (unreleased)
**Builds on:** FR-77 / FR-78 (`docs/specs/2026-11-03-admin-panel-sms-design.md`), unreleased on `claude/admin-panel`.
**Trigger:** owner's v2 backlog (items 1–7), reviewed in `docs/plans/2026-11-03-admin-panel-v2-review.md`;
owner answers recorded there (2026-11-03).
**Requirements:**
- New: FR-79 (sign-ins and force sign-out), FR-80 (password character rule). FR-81 (error log) is **on hold**.
- FR-77 changes: audit search by person, off-server copy status, cron-history purge.

**Owner decisions (2026-11-04):**
- Ships in the **same release** as FR-77/78.
- **Keep** "Sign out everyone except me".
- **Hold off** on the error log (§4). TASKS carries a reminder to come back to it.
- The **admin panel is English only**: no Persian strings, LTR, in either app language
  (`lib/admin/locale.ts`; `messages/fa.json` has no `admin` namespace). Pages outside the panel,
  including the new button on Manage › Employees › edit, stay fa + en.

## 0. What is in and out

| Backlog item | v2 |
|---|---|
| 1 CSV per table | **Out** (owner: revisit if needed) |
| 1 Backup download in the browser | **Out**; replaced by the off-server copy status (§5) |
| 2 Force sign-out | **In** (§1) |
| 2 Recent successful logins | **In** (§1) |
| 2 Failed logins | **Out** (owner: not needed) |
| 2 Login rate-limit status | **Out** (no change needed; the app cannot read it) |
| 2 Editable password policy | **Changed** to a fixed rule: 8+ characters, 1 digit, 1 special character (§2) |
| 3a Retention periods | **Out**: keep everything until the client names a period |
| 3b Archive + hard-delete, 3c re-import | **Out** |
| 4 Editable SMS templates | **On hold** until the client's IT says service or promotional line |
| 5 Audit search by person | **In**: actor and target (§3) |
| 6 Error log | **On hold** (owner, 2026-11-04; §4 kept as the design to come back to) |
| 7 Date-range migration export | **Out**; replaced by a host-move runbook (§7) |
| (found in review) `cron.job_run_details` never purged | **In** (§6) |

The admin panel gets one new tab. All five, in order: **Overview · SMS · System · Audit log ·
Sign-ins**. The new route is `/admin/sign-ins`. The guard is the same as FR-77: admin only, every
function starts with `private.require_admin()`, and the route is added to
`app/[locale]/(app)/admin/_components/AdminTabs.tsx`.

## 1. Sign-ins and force sign-out (FR-79)

### 1.1 What signing out does

Signing a person out deletes all of their `auth.sessions` rows. Their refresh tokens are deleted
with them, the same as GoTrue's own logout.

**Owner-accepted limit:** a page that is already open keeps working until its access token
expires, at most 60 minutes (`GOTRUE_JWT_EXP` 3600). After that the next refresh fails and the
person lands on the login page.

Every sign-out writes an audit row with action `sessions.revoke`, entity `auth.users`, entity_id
set to the person, and `after` set to `{"sessions": n, "reason": "admin" | "password_reset" | "deactivated"}`.

### 1.2 When it happens

| Trigger | Where |
|---|---|
| The admin presses **Sign out on all devices** for a person | Sign-ins tab; also on Manage › Employees › edit, admin only |
| The admin presses **Sign out everyone except me** | Sign-ins tab, behind a confirm dialog |
| The admin resets a person's password | `app_set_employee_password`, `app_bulk_set_employee_passwords` |
| A person becomes inactive (by hand, bulk import or deactivation, or the separations job) | trigger on `profiles`: `active` goes from true to false |

- The admin is never signed out by these. The caller's own id is skipped, and the button is
  disabled on the admin's own row (the Profile page has its own logout).
- A person changing their own password does **not** sign out their other devices in v2.

### 1.3 Sign-ins tab

**Recent sign-ins:** the newest 100 `login` events from `auth.audit_log_entries`, showing the
Jalali time, the person's name and their login code.
- There is no address column: GoTrue leaves `ip_address` empty (review, "Address check").

**Who is signed in:** each person with at least one session, showing:
- name and login code
- devices (session count)
- last activity (newest `refreshed_at` / `updated_at`)
- the **Sign out on all devices** button

Search by name or code. The **Sign out everyone except me** button sits above the list. A note
under the list says: "Pages that are already open keep working for up to 60 minutes."

### 1.4 Functions

- `app_admin_sign_ins(p_limit int default 100) → jsonb`: recent logins plus the per-person
  sessions list.
- `app_revoke_sessions(p_user uuid) → int`: returns the number of sessions removed. It refuses the
  caller's own id and people outside the admin's company.
- `app_revoke_all_sessions() → int`: everyone in the company except the caller.
- `private.revoke_sessions(p_user uuid, p_reason text) → int`: shared by the three triggers in §1.2.
  It writes the audit row when it removed a session, and always for the admin's button.
- "Sign out everyone" writes one summary row instead: action `sessions.revoke_all`, `after`
  `{"sessions": n, "people": m, "reason": "admin"}`.

**Locking:** the `profiles` trigger runs inside writes that already hold the company approval lock
(CLAUDE.md lock order). Deleting from `auth.sessions` takes no `'leave:'` lock, so the order is
unchanged.

## 2. Password rule (FR-80)

**The rule:** 8 to 72 characters, with at least **1 digit** (`0-9`) and at least **1 special
character** from the printable ASCII punctuation set ``!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~``. A space
is allowed but does not count as special.
- Persian and Arabic digits are already turned into `0-9` before the check (`toLatinPassword`,
  `lib/auth/passwordPolicy.ts`).

**Where it is checked:** one SQL helper, `private.assert_password_ok(p text)`, raises
`new password must be at least 8 characters`, `… at most 72 ASCII characters`,
`… must contain a digit` or `… must contain a special character` (22023). Every function that
sets a password calls it:
- `private.create_employee_impl`
- `app_bulk_set_employee_passwords`
- `app_change_my_password`
- `app_set_employee_password`
- `app_set_initial_password`

`app_enqueue_password_sms` keeps its own check (`< 6`): it only texts a password one of the
functions above has just set.

The messages are mapped in `lib/errors/db-error.ts`. The TS side (`passwordRuleProblem`,
`PASSWORD_SPECIALS` in `lib/auth/passwordPolicy.ts`) gives `validateNewPassword` the same reasons.
The change-password and first-login forms show the rule under the field (fa + en). The employee
forms need no hint: they only issue generated passwords.

**Existing passwords keep working.** No one is forced to change (owner). The rule applies the
next time a password is set.

**Temp passwords:** `generateTempPassword()` (`lib/actions/employees-helpers.ts:40-52`) already
includes a digit and a symbol, so it is unchanged. A unit test asserts that its output passes the
rule.

**Bulk password import:** a row that fails the rule is rejected with the same handling as a
too-short row today.

## 3. Audit log by person (FR-77 change)

The Audit log tab gets two person pickers (search by name or code, `components/PersonSearch.tsx`):
- **Done by:** the actor. `p_actor` already exists in `app_audit_log`; only the UI is missing.
- **About:** the target. A row matches when any of these holds:
  - `entity_id` is the person, for the entities `profiles`, `auth.users`, `user_roles`,
    `employee_personal_info` and `user_signatures`;
  - `before` or `after` has `employee_id` or `user_id` equal to the person (leave policies,
    allocations, ledger, special grants, separations);
  - the entity is `leave_requests` and `entity_id` is one of the person's requests.

Each row gets an **About** column (the person's name when the row names a single person).

**Known gap:** bulk rows (`bulk_import`, `personal_info.import`, `bulk_deactivate`) list many
people inside `rows` and are not matched by **About**. The tab says so under the picker.

**Signature change:** `app_audit_log` gains `p_target uuid default null`. Two overloads would make
PostgREST calls ambiguous, so the migration drops the 7-argument function and creates the
8-argument one. That is safe only while no deployed app calls the old one: FR-77 has not reached
Liara, and v2 ships in the same release (owner, 2026-11-04).

## 4. Error log (FR-81) — on hold

**Not built.** The owner put this on hold on 2026-11-04 (TASKS reminder). The design below stays
as the starting point; its open question is §4.3's accepted risk.

### 4.1 What gets recorded

| Source | How |
|---|---|
| Server: render, route handler, server action, proxy | `instrumentation.ts` (repo root) exports `onRequestError` (Next.js file convention, checked against the v16.2.9 docs; app is on 16.4.3) |
| Browser: a page crashes while rendering | new `app/[locale]/(app)/error.tsx` and `app/global-error.tsx`. Each shows a friendly fa/en "Something went wrong · Try again" and reports through a server action |

Errors our code catches and turns into `{ ok: false }` are not recorded; they are expected
outcomes.

### 4.2 Storage

`private.app_errors` has these columns:
- `id`, `source` (`server` | `browser`), `digest`, `message` (≤ 1,000 chars), `stack` (≤ 4,000 chars)
- `path` (query string removed, ≤ 300 chars), `method`, `route` (`routePath`), `route_type`
- `app_version`, `user_id` (when signed in)
- `first_seen`, `last_seen`, `count`

**Grouping:** the same `source` + `route` + `message` within 24 hours increments `count` and
`last_seen` instead of adding a row.

**What is never stored:** request headers and query strings.

### 4.3 Writing without a server secret

The app has only the public anon key: no `service_role` (CLAUDE.md), and a new variable would be
a compose change, which `apply-release.sh` refuses. So the writer is a SECURITY DEFINER function,
`public.app_report_error(...)`, granted to `anon` and `authenticated`. It truncates every field
and keeps at most **300 new rows per hour** across the company; beyond that it only bumps a
dropped-errors counter.

`onRequestError` calls it through `SUPABASE_URL` (the internal gateway) with the anon key and the
user's token when there is one. The call has a 2-second timeout and swallows its own failures, so
a broken error log never breaks a page.

**Accepted risk:** anyone holding the public anon key can add fake rows, up to the hourly cap.
They can never read any. The worst case is noise, or real errors hidden behind the cap; the
dropped counter shows when that happens.

**Personal data:** a message or stack can include values from the failed request. Rows are
admin-only and are purged after **30 days** by a daily pg_cron job, `bj-purge-app-errors`.

### 4.4 Errors tab

- Newest first. Each row shows message, count, first and last seen (Jalali), route, source and
  version. Filter by source and by "last 24 h / 7 d / 30 d".
- Expanding a row shows the stack, method, path and person.
- At the top, the dropped-errors counter for the last 24 hours, when it is above 0.
- Overview gets one number: errors in the last 24 hours, linked to the tab.
- Function: `app_admin_errors(p_since, p_source, p_limit, p_offset) → jsonb`.

## 5. Off-server copy status (FR-77 change)

`deploy/liara/pull-backups-to-mac.sh` already copies each daily dump to the owner's Mac and
checks it against the VM's sha256. At the end of each run it now reports **every** dump that is
both on the VM and on the Mac, with the sha256 of the Mac's own copy, over the same SSH connection:

```
select private.record_offsite_copies(array['daily-…Z.dump:<sha256>', …]::text[]);
```

The SQL goes to `psql` in the db container on stdin (`sudo -n docker compose … exec -T db …`),
the same path as `backup.sh` → `private.record_backup`. Names and hashes are checked against fixed
patterns on both sides. It is best effort: a failed report never fails the pull, and the log line
says `reported to admin panel: failed`.

Reporting the whole list (not only new copies) means the first run after the update fills in the
dumps the Mac already holds, so nothing shows as missing by mistake.

The new table `private.offsite_copies` has `file_name` (key), `sha256`, `first_seen` and
`last_seen`; rows not reported for 90 days are deleted. The System tab's Backups block gains an
**Off-server copy** line: the time of the last report and the newest file. It turns red when:
- no report has arrived for 36 hours;
- a dump between 36 hours and 7 days old was never reported (missing);
- a reported sha256 differs from the `backup_runs` row ("copy differs").

The admin runs `pull-backups-to-mac.sh install` once more after the change, so the installed copy
is refreshed (`~/Library/Application Support/bj-erp/`).

## 6. Scheduled-job history purge (FR-77 change)

pg_cron writes one `cron.job_run_details` row per run and never deletes them. `bj-sms-dispatch`
alone adds about 2,880 rows a day. A new daily job, `bj-purge-cron-history` (21:00 UTC), deletes
rows older than **7 days**. The System tab's "last run" needs only the newest row per job.

It is scheduled the same way as FR-78's jobs: a `do $$ … if exists pg_cron … $$` block in the new
migration.

## 7. Moving hosts (runbook only)

There is no code for this. A new section in `docs/DEPLOY-LIARA.md`, "Moving to another host",
covers the steps for a move to another VPS or to the client's own server:
1. Full `pg_dump -Fc`.
2. Hand over `.env` and the Caddy data separately.
3. Restore on the new server, with the existing graphql step.
4. Do a **test restore and a login check there before cutover**.
5. Change DNS.
6. Keep the old host read-only for a week as the rollback.

Write it when a move is decided.

## 8. Migrations and files (outline; the plan has the detail)

- **Migration:** one new file, `supabase/migrations/20261104090000_admin_panel_v2.sql`
  (`20261103140000` and `20261103140001` are frozen):
  - `private.try_uuid`, `private.assert_password_ok`
  - sign-in and revoke functions plus the `profiles` trigger
  - the five password setters
  - `app_admin_system` with `offsite`, and `offsite_copies` with `record_offsite_copies`
  - `app_audit_log` with `p_target`, `about_id` and `about_name`
  - the cron job
  - then `npm run schema:dump`
- **App:**
  - route `admin/sign-ins` (`page.tsx`, `SignedInList.tsx`); tab in `AdminTabs.tsx`
  - English-only panel: `admin/layout.tsx` (English provider, LTR), `lib/admin/locale.ts`, pages
    translate and format with `ADMIN_LOCALE`, `dbErr(raw, { locale })` for admin actions
  - audit: `AuditPersonFilters.tsx`, `AuditRows.tsx` (About), `getAuditPeople`
  - system: off-server copy block
  - Manage › Employees › edit: **Sign out on all devices** (`signOutEverywhere`)
  - `passwordPolicy.ts`, `ChangePasswordForm.tsx`, `SetPasswordForm.tsx`, `db-error.ts`
  - `messages/en.json` (+ fa for the non-admin strings), `lib/supabase/types.ts` (hand-edited)
- **Scripts:** `deploy/liara/pull-backups-to-mac.sh`. There are no compose, Caddyfile or `.env`
  changes, so `apply-release.sh` accepts the release.
- **Tests:**
  - `tests/sql/admin-panel-v2.sql`: the rule, revoke (admin only, self refused, reset, bulk reset,
    deactivation, everyone), sign-ins, the target filter, offsite missing/mismatch
  - `tests/unit/passwordPolicy.test.ts` (rule, generator), `messages-parity.test.ts` (admin is en only)
- **Docs:**
  - REQUIREMENTS FR-79/80 and FR-77 changes
  - PERMISSIONS (new admin-only functions)
  - DATA_MODEL (`private.offsite_copies`)
  - CHANGELOG and TASKS (FR-81 reminder)

## 9. Decided (owner, 2026-11-04)

1. **Release:** together with FR-77/78.
2. **"Sign out everyone except me":** kept.
3. **Error log:** on hold; come back to it later (TASKS).
