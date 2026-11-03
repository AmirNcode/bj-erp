# Admin panel and SMS notifications

**Date:** 2026-11-03 · **Status:** approved by owner 2026-11-03 ("build it"); implemented on `claude/admin-panel` (unreleased)
**Trigger:** owner: "add an admin panel only accessible by the admin account … backend stuff, stats,
etc. One thing to include is a panel for SMS notifications." The client's IT contact sent partial SMS
credentials (username, 14-digit `5000…` sender line, empty token); provider not named.
**Requirements:** FR-77 (admin panel), FR-78 (SMS notifications), both new. Replaces the "SMS
notifications for approvers" TASKS item.

**Owner answers (2026-11-03):**
- First version has four tabs: **Overview (usage stats) · SMS · System · Audit log**.
- SMS goes out for: **approver, new request waiting**; **employee, final decision**; **admin
  password reset** (opt-in per reset). No daily digest.
- SMS credentials are stored **in the database, write-only**: typed in the panel, never shown again.
- Build now in **dry-run** mode; switch to live once the provider and password are confirmed.

## 1. Who sees it

Only the single admin (`user_roles_one_admin`). Not a permission, not delegable, not in Settings ›
Roles. A new nav item **پنل مدیر سیستم / Admin panel** shows for the admin only (`lib/nav/tabs.ts`,
`isAdmin(roles)`). Everyone else who opens `/admin…` is sent Home. Every database function behind it
refuses anyone but the admin (`private.is_admin(auth.uid())`, error 42501), so the guard does not
depend on the UI.

| Route | Tab |
|---|---|
| `/admin` | Overview |
| `/admin/sms` | SMS |
| `/admin/system` | System |
| `/admin/audit` | Audit log |

## 2. Overview (usage stats)

A date range (Jalali picker, default this month) and these blocks:

| Block | Shows |
|---|---|
| People | active, inactive, never signed in, still on the admin-issued password, signed in within 7 / 30 days |
| Requests | in range, by type (leave daily / hourly, errand daily / hourly) and status |
| Approval speed | median and 90th-percentile hours from submit to final decision |
| Stuck requests | pending for more than 3 days: serial, employee, step it waits on, days waiting, link |
| Leave by department | days taken in range, per department, as a bar list |
| SMS | in range: sent, dry-run, failed, skipped (no mobile) |

One function `app_admin_overview(p_from, p_to) → jsonb`. Sign-in data comes from
`auth.users.last_sign_in_at`. Bars are plain CSS, no chart library.

## 3. SMS notifications (FR-78)

### 3.1 Events and text

| Event | When | Who gets it | Text (fa; en for `language_pref = 'en'`) |
|---|---|---|---|
| `approver_new` | a request is filed, or a step is approved and the next step opens | everyone who can sign the step(s) now open (delegates included), one SMS each | «درخواست {نوع} {نام} منتظر تأیید شماست. bjeng.app» |
| `employee_decision` | a request becomes approved or rejected (final) | the requester | «درخواست {نوع} شما ({تاریخ}) تأیید شد / رد شد. bjeng.app» |
| `password_reset` | admin resets a password and ticks **Text it to the employee** | that employee | «رمز موقت شما: {رمز} — کد پرسنلی: {کد}. bjeng.app» |
| `test` | admin presses **Send test SMS** | the typed mobile | «پیام آزمایشی سامانه bj» |

- "Step(s) now open" follows the approval order setting: with the order on, only the next undecided
  step; with it off, every undecided step that has not yet been texted for this request.
- Each (request, step, recipient) is texted once. A second step held by the same person (FR-71 sign
  once) is folded into the first SMS.
- Cancelled requests send nothing. Requests the admin approves by override send only the decision SMS.
- Errand extensions and travel bookings send nothing in this version.

### 3.2 Phone numbers

From `employee_personal_info.mobile`. Normalised by `private.normalize_ir_mobile`: Persian and
Arabic digits to Latin, strip spaces and dashes, `+98` / `0098` / `98` to `0`, must then match
`^09\d{9}$`. A person with no valid mobile gets a `skipped` row (reason `no_mobile`), which the log
and Overview count, so HR can fill in missing numbers.

### 3.3 Modes

| Mode | Behaviour |
|---|---|
| Off | events queue nothing |
| Dry run (default) | events queue; the sender marks each row `dry_run` without contacting the provider. The log shows exactly who would have got what. |
| Live | rows are sent to the provider. Selectable only when a secret is saved. |

### 3.4 Provider: Melipayamak (confirmed by the client's IT, 2026-11-03)

IT sent the username and the sender line ("Number", 14 digits, `5000…`); the API key is to follow.
IT also mentioned "OTP", which suggests the account is set up for code/pattern sending (`SendOtp` /
shared service line) and favours the **Pattern** method below.

Settings the admin types in: the **console API key** (from console.melipayamak.com; the key is
part of the request URL, so no password is needed), **username** (reference only), **sender line**,
and **how to send**:

- **From the line** (`POST /api/send/simple/<key>` with `{from, to, text}`). Fine for a service line.
  A *promotional* line does not reach numbers that blocked ads (telecom blacklist).
- **Pattern** (`POST /api/send/shared/<key>` with `{to, bodyId, args}`). Each event needs a template
  approved in the Melipayamak panel; the admin types its **body ID** per event. Variables in order:
  approver — name, type, date; decision — type, date, decision; password — password, login code.
  Reaches blacklisted numbers; no sender line needed. The test text always goes from the line.

Replies are JSON `{recId, status}` (credit: `{amount, status}`); `status` carries the provider's error
text, shown in the log. Endpoint shapes come from the community client `HRashidi/melipayamak`
(`src/config.ts`, `src/types.ts`), 2026-11-03: **send one real test text before relying on Live.**
If the key IT sends turns out to be a panel password instead, a second sender (`rest.payamak-panel.com`
with username + password) is a small addition to `private.sms_dispatch`.

### 3.5 Storage

- `private.sms_settings` (one row per company): mode, provider, API key, username, sender line, send
  method, body ID per event, on/off per event, link label, last balance check, updated by / at. In `private`, so PostgREST never
  exposes it and `authenticated` has no grant.
- `public.sms_outbox`: company, event, recipient, mobile, body, status
  (`queued | sending | sent | dry_run | failed | skipped`), attempts, provider id, error, request,
  step, created / sent at. RLS: the admin reads; nobody writes directly.
- Functions for the admin: `app_sms_settings()` (everything **except** the secret, plus
  `has_secret`), `app_set_sms_settings(…, p_secret default null)` (null keeps the saved secret;
  audit row shows `***`), `app_sms_test(p_mobile)`, `app_sms_log(limit, offset, status)`,
  `app_enqueue_password_sms(p_employee, p_password)`.
- Rows older than 180 days are deleted nightly (pg_cron `bj-purge-sms-outbox`).

### 3.6 Who actually sends

**Changed during implementation (2026-11-03):** the first design ran a sender loop in the Next.js
server with its own PostgREST token (`SMS_WORKER_JWT`). That needs a new variable in
`docker-compose.yml`, and `deploy/liara/apply-release.sh` refuses any release that changes the compose
files ("Infrastructure changed … apply it explicitly"), so every deploy would need a manual VM step.

The database sends instead. pg_cron job `bj-sms-dispatch` runs `private.sms_dispatch()` every 30
seconds: it reads the replies to the previous run's requests from `net._http_response`, then posts up
to 20 due rows with `net.http_post` to
`https://console.melipayamak.com/api/send/simple/<key>` (`{from, to, text}`) or
`…/send/shared/<key>` (`{to, bodyId, args}`). The key never leaves the database except to Melipayamak;
the app needs no secret and no new environment variable. A balance check posts
`GET …/receive/credit/<key>`; the next run stores `amount`.

A reply with a `recId` of 6+ digits is sent. 5xx, timeouts and no reply within 10 minutes retry after
1 and 5 minutes (3 attempts); any other error fails at once with the provider's `status` text.

**Password texts:** the first dispatch replaces the password in the body with «••••» and clears the
pattern variables; a row skipped for no mobile is stored masked from the start.

### 3.7 The SMS tab

- Mode (Off / Dry run / Live), provider (Melipayamak only for now), API key, username
  (empty box with "saved" hint, never filled in), how to send (line / pattern), sender line, a body
  ID per event when pattern is chosen, on/off per event.
- **Check balance** (provider credit) and **Send test SMS** to a typed mobile.
- Log: newest first, filter by status and event, Jalali time, recipient name, mobile, text, status,
  error in words. 50 per page.
- A short note under the line field: a promotional `5000…` line cannot reach people who blocked
  ads; ask the provider for a service line or pattern sending if many sends fail with "blacklisted".

## 4. System

| Block | Source |
|---|---|
| Version | commit and build time, baked into the image at build (`--build-arg APP_VERSION`, `deploy/liara/package-release.sh`); `dev` elsewhere |
| Services | the app checks Postgres, GoTrue and PostgREST from the server; ok / down and response time |
| Database | size; 10 biggest tables (rows, size) |
| Migrations | last 10 rows of `bj_deploy.schema_migrations` |
| Scheduled jobs | each pg_cron job, its schedule, its last run (time, ok / failed, message) |
| SMS queue | queued and failed counts, oldest queued |
| Backups | newest dumps (name, size, time) from `private.backup_runs`, which `deploy/liara/backup.sh` writes after each successful dump; red when the newest is over 36 hours old |

One function `app_admin_system() → jsonb` for the database parts. `/api/health` is unchanged (it
deliberately does not query Postgres; deploy scripts check each service on their own); the System tab
calls `app_health()` instead.

## 5. Audit log

Reads the existing `public.audit_log` (admin-only RLS already). Filters: date range, actor
(name search), entity (people, requests, roles, settings, …), action. 50 per page, newest first.
Each row: Jalali time, actor, action in words, what it touched (link to the person or request
when it still exists). Expanding a row shows only the changed fields, before → after. Signature
images, password fields and the SMS secret show as **[hidden]**. Function
`app_audit_log(p_from, p_to, p_actor, p_entity, p_action, p_limit, p_offset)`.

New audit rows: SMS settings changed, test SMS sent. Password resets are already logged.

## 6. Not in this version

Daily digest SMS; SMS for errand extensions, travel bookings, clearance forms; announcements;
sign-out-everywhere; maintenance mode; running jobs by hand; data export; editable SMS texts.

## 7. Open points for the owner

1. **Provider:** Melipayamak (confirmed). Still to settle: the API key (IT will send it); check it
   with a balance check (`GetCredit`) before going live. Ask whether
   the line is **service** (خدماتی) or **promotional** (تبلیغاتی); if promotional or OTP-only, get
   pattern templates approved for the three events.
2. **Mobile numbers:** how many people have a mobile in their personal info today? The Overview
   will show the count of `skipped: no mobile` once dry-run is on.
3. **Night texts:** approvers get an SMS at whatever hour a request is filed. Acceptable, or hold
   texts between 22:00 and 07:00?
