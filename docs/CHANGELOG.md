# CHANGELOG

Format: [Keep a Changelog](https://keepachangelog.com/). The app is built; v1 (Phases 0–6 +
frontend overhaul) is feature-complete and merged to `main`. `[Unreleased]` holds the v1 work
pending a tagged release; semantic versioning starts at the first tag.

> This file records **what shipped**, for a release reader. For *what the last agent actually
> did this session* — including investigations, dead ends, and commands run against the client's
> live server — see **`docs/AGENT-LOG.md`**, which every agent is required to append to.

## [Unreleased]

### Hourly work errand, and login codes without a department prefix (2026-07-30)

Spec: [`docs/specs/2026-07-30-work-errand-and-login-codes-design.md`](specs/2026-07-30-work-errand-and-login-codes-design.md).
Driven by a third client form and a clarification about numbering.

#### Added
- **Hourly work errand (ماموریت ساعتی), form BJ-F 50207.** A new request screen at
  `/request/errand` for an off-site work trip on a single date: departure time, return time, محل
  ماموریت, and an optional شرح ماموریت. An errand is **work, not leave** — it deducts nothing from
  a balance. It is approved by the direct manager in the same queue as leave, appears on the team
  calendar, and carries its own tracking-number sequence. Teammates see that a colleague is out;
  the location and the description stay private to the requester, their manager, security and admin.
- **Departments panel in Manage → Settings.** Tapping a department opens a floating panel listing
  its people as Managers, then Workers. Closes with the X, an outside tap, or Esc.
- **Add Department moved into Settings**, at the bottom of the Departments card, and Cancel now
  returns there. It is gone from Manage → Employees — one home instead of two.

#### Changed
- **New login codes are the personnel number alone** (`1042`), not `prod-1042`. Everyone hired
  before today keeps the code they have, and both shapes sign in. Nothing to re-issue.
- **Department codes are no longer typed or edited.** They prefix nothing now, so the field is gone
  from the create form and the code is generated behind the scenes. Admin editing is switched off at
  the client's request and can be switched back on without a migration.
- **The request number is now labelled شماره پیگیری / Tracking no.** The client clarified that the
  شماره on their paper forms is the requester's personnel number — a different thing — so the app's
  own number is named so the two cannot be confused. Leave and errands number independently.

#### Fixed (pre-merge review, 2026-07-31)
- **Errands could not be submitted at all.** The first errand of each year collided with an existing
  leave request's number. Caught before anyone saw it.
- **The calendar showed a two-hour absence as a whole day off**, and told teammates the person was
  back "tomorrow". It now shows the actual hours. This affected hourly leave too, not just errands.
- **An approved errand could not be cancelled.** A called-off trip stayed on the books and kept
  blocking that time slot.
- **Leave could be silently under-credited** if an administrator corrected an employee's accrual
  start month to an earlier month — the months in between were never added.
- The department panel's close button announced itself in English to screen readers; the "you are
  covering X" card on Home omitted the hours.

#### Notes
- An errand may be booked on a weekend or a public holiday, unlike hourly leave. Urgent company
  business does not respect the holiday calendar.
- Neither change is on the client's server yet; both stack on the still-undeployed leave v2.
- **Before this can be deployed**, the installer's migration replay must be fixed — it currently
  stops on the first migration when run against an existing database.

### Security and reliability review (2026-07-30)
- **Deactivated accounts are now actually blocked.** Existing or newly issued login sessions cannot
  read HR data or submit/cancel leave; the login screen clears the session and explains that the
  account is inactive.
- **Manager authority now requires both the manager role and the reporting relationship.** Removing
  the role takes effect at the database boundary immediately, even if the org chart still lists
  reports. Employees also cannot be assigned as their own manager.
- **Audit history is trustworthy.** Signed-in clients can no longer invent audit events; real profile,
  department, holiday, work-setting, company, and leave-type changes are recorded automatically in
  the database. Role/profile creation must use the guarded, transactional RPCs.
- **Catastrophic/lockout paths are closed:** the seeded single company cannot be deleted at runtime,
  the last active administrator cannot be deactivated, and password resets reject missing targets,
  weak/overlong values, and reset selected employees atomically.
- **Hourly approval is time-aware.** Adjacent hourly requests on the same date can both be approved,
  and the replacement warning no longer reports false conflicts for non-overlapping times.
- **Request reliability improved:** submit stops when newly earned leave cannot be accrued; reasons,
  holiday dates, work windows/caps, and zero-row edits are validated instead of silently accepted.
- **Deployment/browser hardening:** app container runs non-root with no Linux capabilities; installer
  host/port input is allow-listed and secret files forced to mode 600; CSP/HSTS/cross-origin headers
  are enabled; the server/client “Updated” timestamp no longer causes a hydration mismatch.
- Full evidence and the one blocked external dependency-audit check:
  `docs/SECURITY-REVIEW-2026-07-30.md`.

### Leave v2: request serial numbers (2026-07-29)
- **Every request now has a number** — `۱۴۰۴-۰۰۴۲` — the شماره the paper forms carry, so HR can quote a
  request on the phone, write it on a file, or reference it in an insurance claim. It appears on the
  employee's own requests and on approval cards.
- Numbering is per company and per Jalali year, restarting at `۱۴۰۵-۰۰۰۱` at Nowruz, matching how they
  file paper. **Existing requests were backfilled** in the order they were filed.
- Gapless even when two people submit at the same moment: the counter is bumped under a row lock, which
  the per-employee lock elsewhere in the writer does not provide.

### Leave v2: the replacement person (2026-07-29)
- **Requests can now name who covers for you** — جانشین on the daily form, جایگزین on the hourly one,
  matching the client's paper forms. Optional, searchable by name or employee code, and limited to
  colleagues in your own department.
- **Someone already on leave cannot be chosen.** They are still listed, marked "در مرخصی" and disabled,
  so a worker is told why rather than wondering where a colleague went. The server refuses an unavailable
  pick at submit, and **re-checks at approval** — a cover can book leave in between, and approving anyway
  would quietly leave nobody covering.
- **The named person sees "You are covering …" on their Home page.** No approval waits on them: with no
  notification channel yet, a consent step would stall requests on an off-shift worker.
- Deliberate asymmetry, documented: being named as someone's cover never blocks your *own* leave request.
  You are warned and the manager sees the clash; a coworker's paperwork does not veto your leave rights.
- The cover's name appears on your own requests and on the approvals queue, where a clash is flagged.

### Leave v2: hourly leave (2026-07-29)
- **Workers can request a few hours off instead of a whole day** — مرخصی ساعتی, on its own screen that
  mirrors the client's BJ-F 50208 form: one date, a from-time and a to-time. Available for annual and
  unpaid leave; **not** for sick leave, matching the paper form.
- **Times come from the company's working hours** (a new setting, default 07:00–15:00) as 30-minute
  slots, and hourly leave is **capped per day** (default 4 hours, configurable) across all of that
  day's requests — so the hourly form cannot be used to take a full day in pieces.
- **Two non-overlapping errands in one day are both allowed.** The overlap rule compares times rather
  than dates, and treats 08:00–10:00 and 10:00–12:00 as adjacent. A whole-day request still blocks
  everything else that day. One accepted limitation, documented: a half-day plus an hourly request on
  the same date is refused.
- Hourly requests show their **time range** in My Requests, the approvals queue, and the team calendar
  — a manager approving one sees ۰۹:۰۰–۱۱:۰۰ rather than a bare duration that reads like a full day.
- Home now offers both request buttons, and each request screen links to the other.

### Leave v2: monthly leave accrual (2026-07-29)
- **Leave now accrues every month instead of being a number an admin typed once.** Each employee has
  a per-leave-type policy — days earned per month, yearly cap, carryover cap, start month —
  pre-filled from the leave type and editable on the create and edit forms.
- **Anchored to Jalali month starts**, with the hire month pro-rated by calendar days so an employee
  can check the figure against a payslip by hand. Annual leave defaults to 1 day/month with a 12-day
  year; sick leave does not accrue, because in Iran it is certified rather than earned.
- **Carryover is capped, and the excess is forfeited visibly.** At Farvardin 1 anything above the cap
  (default 9 days, ماده ۶۶) is written off as a `carryover_forfeit` ledger row — an audited entry,
  never a silent reset — and it happens *before* that month's accrual is credited.
- **Nothing is scheduled.** Missing months are posted whenever a balance is read, and by an admin
  button in Manage → Settings that reports how many employees and rows it wrote. That choice is
  deliberate: the client's server is LAN-only and can be powered off, so a cron job would need
  catch-up logic anyway. A partial unique index makes double-crediting impossible rather than
  unlikely, which is what makes posting-on-read safe.
- The accrual **start month defaults to the current Jalali month**, never the hire date, so switching
  accrual on cannot retroactively credit months nobody worked.
- **Fixed a latent balance bug this exposed:** "current balance" was the latest ledger row by
  `created_at`, but `now()` is frozen within a transaction, so the several months accrual writes at
  once all shared a timestamp and the tie-break fell to a random uuid — a balance of 1440 could read
  back as 960. Ledger rows now carry a monotonic `seq`, and every reader orders by it.

### Leave v2 foundations: minutes as the stored unit + Jalali calendar table (2026-07-29)
- **Leave durations are now stored as integer minutes** instead of fractional days, across
  `leave_ledger`, `leave_requests`, and `leave_allocations`. Nothing about the request flow changes
  for a worker; what changes is that a balance can now express **"۹ روز و ۴ ساعت"** — the way HR
  already words it on the paper daily form — which is the prerequisite for hourly leave.
- **`work_settings.hours_per_day`** (default 8) defines what one day of leave means. Existing rows
  were backfilled with a frozen constant of 480 minutes/day, deliberately *not* the live setting:
  history was recorded when a day meant 8 hours, so changing the setting later cannot retroactively
  move anyone's past balance.
- Migrated in **three replayable steps** — `20260729130001` (calendar table), `20260729130002`
  (add + backfill + sync triggers), `20260729130003` (functions write minutes; day columns dropped)
  — so the conversion could be verified against real data before anything was destroyed, and every
  intermediate state stayed deployable. `docs/plans/2026-07-29-leave-v2-foundations-acceptance.sql`
  is the check to run against a dump of the client's database before this ships to their server.
- **Breaking RPC changes** (all callers updated): `allocate_leave` takes `p_minutes`,
  `set_leave_balance` takes `p_target_minutes`, `compute_requested_days` became
  `compute_requested_minutes`, and `current_leave_balance` returns minutes. Admin-facing inputs are
  still day-denominated and convert at the boundary through `lib/leave/duration.ts`.
- **New `jalali_months` reference table** (1400–1450, 612 generated rows) plus `jalali_month_of()`.
  Monthly accrual anchors on Jalali month starts, carryover fires on Farvardin 1, and request serial
  numbers key on the Jalali year — this turns all three into joins instead of calendar arithmetic
  inside a `SECURITY DEFINER` function. A documented exception to the never-persist-Jalali rule: it
  is a calendar dimension, and no user row stores a Jalali value.
- Design record: `docs/specs/2026-07-29-hourly-accrual-replacement-design.md`. Still to come in that
  spec: monthly accrual, hourly requests, the replacement person, and request serial numbers.

### Rejection reason; employee-code field latin-only (2026-07-29)
- **Rejecting a request can now carry a reason.** Optional free-text field (max 500 chars) in
  both reject dialogs — the approvals queue and the calendar's day-detail decide buttons.
  Leaving it blank behaves exactly as before. A dropdown of preset reasons is the planned
  follow-up; this is the free-text stage.
- **The reason is stored where the employee can read it.** `reject_leave_request` already
  accepted `p_reason` but wrote it only to `audit_log`, which employees cannot read — so the
  reason was invisible to the person it was for. New nullable
  `leave_requests.decision_note` (migration `20260729120001_reject_reason.sql`) is set on
  reject and shown on the employee's own request row in `/request`.
- Deliberately separate from `leave_requests.reason`: that one is the requester's and is
  FR-25-private from peers; `decision_note` is the decider's and follows the row's own RLS
  (own · manager-of · admin · security). `team_leave_calendar` selects an explicit column list
  and is untouched, so the note is never exposed through the shared calendar.
- **The employee-code field on `/login` is now latin-only and left-to-right**, matching the
  password field: `toLatinCode()` (`lib/employees/code.ts`) converts Persian/Arabic-Indic digits
  and drops everything outside printable ASCII, spaces included. The code becomes the synthetic
  auth email, so a Persian character could only ever produce an unmatchable login.
- The login code placeholder is now `prod-1042` (a generated-code example) instead of `admin` —
  the login page no longer names the administrator account.
- Tests: `toLatinCode` unit cases (147 unit tests total) + the approval e2e now types a Farsi
  rejection reason and asserts the employee reads it back on their request.

### Login password field: reveal toggle + latin-only entry (2026-07-29)
- **Show/hide password toggle** on `/login` (eye button inside the field, `password-toggle`
  testid, localized `aria-label`). The field and its toggle sit in a `dir="ltr"` wrapper so the
  button stays at the visual end of the input inside the Farsi RTL layout.
- **Passwords are latin-only, left-to-right.** On a Farsi keyboard the field silently collected
  Persian characters, producing a password that could never match while the user saw only
  bullets. `toLatinPassword()` (`lib/auth/passwordPolicy.ts`) converts Persian/Arabic-Indic
  digits and drops anything outside printable ASCII.
- Applied to the **change-password form** too (`profile/ChangePasswordForm.tsx`, all three
  fields): filtering only the login field would let a user set a Persian password here that
  they could never type again. Pre-existing non-latin passwords, if any, need an admin reset.
- Tests: `toLatinPassword` unit cases (143 unit tests total) + an `auth.spec.ts` case asserting
  `dir="ltr"`, the Persian→latin filtering, and the reveal toggle round-trip.

### Configurable HTTPS port; port 80 dropped (2026-07-29)
- **The published HTTPS port is now a first-class setting.** The client's IT reserved 443 and 80,
  so the app had to move to 3500. Editing only the compose `ports:` line is not enough and
  **breaks login**: `NEXT_PUBLIC_SUPABASE_URL` was derived as `https://${APP_HOST}` and is baked
  into the browser bundle, so the page still loaded over the new port while every login request
  went to `https://<host>` — port 443, where nothing was listening any more.
- `.env` now carries three related values instead of one. `APP_HOST` is the **bare** host/IP (the
  TLS certificate name and Caddy site address — never a port), `APP_PORT` is what the server
  publishes (default `443`), and `APP_ORIGIN` is the full URL employees type. Every public URL —
  `NEXT_PUBLIC_SUPABASE_URL`, `API_EXTERNAL_URL`, `GOTRUE_SITE_URL`, `GOTRUE_URI_ALLOW_LIST` —
  now comes from `APP_ORIGIN`, declared with `${APP_ORIGIN:?…}` so a `.env` missing it fails
  compose loudly instead of silently rendering empty URLs.
- Caddy still listens on **443 inside the container** (`ports: '${APP_PORT:-443}:443'`); it
  ignores the port in the `Host` header when matching, so the site block needs no change. The
  Caddyfile carries a comment saying so, because "just add the port to APP_HOST" breaks
  `default_sni` and the certificate name.
- `install.sh` prompts for the port, derives `APP_ORIGIN`, splits a port off `APP_HOST` if one
  was typed there, and **backfills `APP_PORT`/`APP_ORIGIN` into pre-existing `.env` files**.
- `update.sh` health-checks `${APP_ORIGIN}/` instead of `https://${APP_HOST}/` — on a non-443
  install the old check could never succeed and would have rolled back every good deploy.
- **Port 80 is no longer published**, so there is no `http://` → `https://` redirect: employees
  must use the full address including the port. Requirements list, phone-install steps, and
  troubleshooting in `deploy/RUNBOOK.md` updated to match.

### One-command release pipeline (2026-07-26)
- **Deploying an update is now a single command on the developer's Mac** —
  `./deploy/release.sh <version>` — replacing the manual build → `scp` → `docker load` →
  restart ritual. Step-by-step operator instructions: **`docs/DEPLOY-GUIDE.md`**.
- `deploy/release.sh` (Mac): validates the version string, checks Docker and SSH reachability
  **before** the slow build, warns on a dirty working tree, runs `lint` + `test:unit`,
  cross-builds for **linux/amd64** and *verifies the built architecture* (an arm64 image dies on
  the server with `exec format error`), gzips, ships with resumable `rsync --partial`, triggers
  the remote update, and copies the pre-deploy database dump back to the Mac.
- `deploy/update.sh` (server, re-shipped every release): `flock` so two updates cannot
  interleave; preflight on disk space and database health; **verified** `pg_dump -Fc` backup
  (proven restorable with `pg_restore -l` — an empty or invalid dump aborts the deploy before
  anything changes); row-count snapshot; image load with an architecture guard; idempotent
  migration replay; cutover of **only** the `app` container; 90s health check on the app and
  GoTrue; **automatic image rollback** if it fails; a second row-count pass that fails loudly
  with the restore command if any table shrank; retention of 3 images and 14 backups.
- `deploy/setup-release.sh`: one-time SSH key + `bj` host alias with connection multiplexing,
  so a release involves no SSH password prompts (only the server's `sudo` password, once).
- **Database safety, by construction:** the only Docker commands used against the stack are
  `docker load` and `docker compose up -d app`; `docker compose down`, `down -v` and
  `volume rm` appear nowhere. All SQL is piped to `psql` over **stdin** rather than the
  container bind mounts — `./sql/seed.sql` is a single-*file* mount, so a replaced file gets a
  new inode while the mount keeps serving stale content. `release.sh` ships `seed.sql` with
  `rsync --inplace` to preserve the inode for `install.sh` re-runs.
- `deploy/RUNBOOK.md`: the update section now documents the pipeline (with a manual fallback),
  and the **backup command is corrected** — it documented `pg_dump -U postgres`, but the image's
  superuser is `supabase_admin` and requires password auth even over the local socket; added a
  `pg_restore -l` verification step and a Farsi summary of the new update flow.
- `backups/` added to `.gitignore` — pre-deploy dumps contain employee PII and password hashes
  and must never be committed.
- Plan: `docs/plans/2026-07-26-release-pipeline.md`. The earlier server-side-build plan
  (`docs/plans/2026-07-25-deploy-automation.md`) is **superseded** and kept as the decision
  record: building on the server would depend on Docker Hub and npm being reachable from an
  Iranian network at deploy time, and a blocked registry mid-deploy would strand a live system.

### Add departments from the app (2026-07-25)
- **Admin can create departments in the UI.** Manage → Employees gains an **Add Department**
  button beside *Add Employee* (admin only), opening `/manage/departments/new`: Farsi + English
  name, the latin `code` that becomes the login-code prefix (auto-suggested from the English
  name, editable), and the descriptive `kind`. Existing departments and their taken codes are
  listed under the form, and the success screen links straight into *Add employee* — closing
  the gap where a new hire could only join a department that already existed in the seed.
- New server action `createDepartment` (`lib/actions/departments.ts`), admin-guarded and
  enforced by the existing `departments_insert_admin` RLS policy — **no migration needed**;
  writes an `audit_log` row (`create_department`) and invalidates the app cache.
- Code validation shared by the form, the action, and the settings editor
  (`lib/departments/code.ts`, mirrors the `departments_code_format` check + Persian-digit
  normalization). New `dbErrors` entries map duplicate/invalid codes and missing names to
  fa/en messages (the old unmapped "invalid department code" now localizes too).
- Tests: `tests/unit/department-code.test.ts` (139 unit tests total) and
  `tests/e2e/department.spec.ts` — admin creates a department, hires into it, and the new
  employee logs in with the generated `<code>-<personnel_no>`; a manager is bounced from the
  page and never sees the button. Test departments use the reserved `zz` code prefix and are
  deleted by `scripts/cleanup-e2e.mjs` (plain admin DELETE under the existing RLS policy).
  Gates: unit 139/139, e2e 25/25 serial, lint + tsc + build green.

### Employee onboarding & logout UX (2026-07-13)
Spec: `docs/specs/2026-07-13-employee-onboarding-design.md` · plan: `docs/plans/2026-07-13-employee-onboarding.md`

- **Logout moved + confirmed**: button now sits at the very bottom of the profile page
  (outside any card) and opens an AlertDialog before signing out — no more accidental logouts
  (`profile/LogoutButton.tsx`; `settings-logout` testid preserved, confirm is `logout-confirm`).
- **Generated employee codes**: `departments.code` (latin, admin-editable in Manage → Settings)
  + `profiles.personnel_no` (client HR number, typed by the creator) compose the login code
  in-DB as `prod-1042`; nobody hand-types codes anymore (read-only live preview in the form).
  New display-only `profiles.job_title`. Existing users keep their codes.
- **Manager-scoped creation**: managers get the new-employee page with department locked to
  their own, themselves as manager, employee role only — enforced inside the rebuilt
  `app_create_employee` (SECURITY DEFINER), which also applies default leave quotas for the
  manager path via the extracted `private.allocate_leave_impl` (advisory-lock pattern kept).
  Admin path unchanged. Old text-code RPC signature dropped.
- **Admin bulk CSV import** (`/manage/employees/import`): Farsi template download, client-side
  parse/validation preview (Excel BOM, Persian digits, Jalali *or* Gregorian hire dates,
  duplicate/unknown-reference checks; managers may be referenced from earlier rows of the same
  file), then one-transaction `app_bulk_create_employees` (all-or-nothing). Credentials
  (name, code, password) are returned **once** and downloaded as CSV — passwords stay
  bcrypt-hashed and unrecoverable, so the employees list gains admin bulk-select →
  **Regenerate passwords** as the recovery path (self excluded to prevent lockout).
- Migration `20260713120001_employee_onboarding.sql`; e2e cleanup pattern extended
  (test personnel numbers are `999#######`). e2e suite migrated to the generated-code flow and
  de-flaked: login/upload helpers retry through the cold-dev hydration race, and "today" in
  range helpers is now Asia/Tehran (UTC drifted one day behind every night 20:30–24:00 UTC).
- Dev/e2e now run against the **local Docker stack** (`.env.local` → gateway `:8080`; cloud
  demo project is paused). Gateway fixes shipped to `deploy/caddy/Caddyfile`: `default_sni`
  so browsers can reach the site by raw IP, and CORS preflight answers on the internal
  listener (GoTrue does none itself — Kong used to, on Supabase Cloud).

### Self-host installer package (2026-07-03)
- **`deploy/` — turnkey offline installer** for running the whole product (app + Postgres +
  auth + data API + HTTPS gateway) on the client's own Linux server: `deploy/package.sh`
  builds `dist/bj-erp-installer-<version>.tar.gz` (all container images saved inside — no
  registry/internet needed on the server, sanctions-safe); the client runs `sudo ./install.sh`,
  answers two prompts (server address, first-admin password), and the stack comes up with all
  migrations + baseline seed applied and the roles-in-JWT auth hook enabled.
- HTTPS via Caddy's internal CA; `install.sh` exports `bj-root-ca.crt` for the one-time phone
  trust step (required for PWA install). `deploy/RUNBOOK.md` documents requirements, backups,
  restore, updates, and day-2 ops in English + Farsi.
- App changes to support it: `output: 'standalone'` in `next.config.ts`; server-side Supabase
  clients (`lib/supabase/server.ts`, `proxy.ts`) prefer a runtime `SUPABASE_URL` (internal
  plain-HTTP gateway) over the baked public URL; build-time placeholder env values substituted
  at container start; **auth cookie name pinned** to `bj-auth` in all three Supabase clients
  (`lib/supabase/constants.ts`) — the default is derived from the Supabase URL's host, which
  differs between browser and server in the package and broke the session hand-off. Existing
  demo sessions are invalidated once by the rename (users just log in again).
- Verified end-to-end on a local Docker install: `install.sh` from scratch → HTTPS login as
  the bootstrapped admin → home board renders; roles claim (`app_roles: ["admin"]`) present in
  self-host-issued JWTs (auth hook enabled via GoTrue env). Also fixed en route: a
  `package-lock.json` gap (`next-intl`'s nested `@swc/helpers` missing — npm 10 in the Docker
  build rejects what local npm 11 tolerated).

### Navigation performance — the round-trip diet (2026-07-02, evening)
Implements `docs/plans/2026-07-02-nav-performance.md` (P1–P5; P6 cleanup deliberately
skipped). Per-navigation server work drops from **5–6 serial Supabase round-trips to 1–2**,
and recently visited tabs re-render instantly from the client router cache.

- **Local JWT verification (P1):** both per-request `auth.getUser()` network calls
  (middleware + layout guard via `getCachedUser`) are now `auth.getClaims()`, which
  verifies the token **locally** (WebCrypto; the project's asymmetric ES256 signing key
  was confirmed active via JWKS). Session refresh behavior is unchanged — `getClaims()`
  still refreshes near-expiry tokens. `getCachedUser` returns a lean `{ id, email }`;
  no call site used anything else. Root locale page + profile/password actions switched
  to the shared cached helper too.
- **Roles ride inside the JWT (P2):** new migration `20260702150001_custom_access_token_hook.sql`
  adds a Supabase **Custom Access Token hook** that embeds the caller's role slugs as an
  `app_roles` claim; `getCachedRoles` reads the claim (0 round-trips) and falls back to
  the old `user_roles` query for tokens that predate the hook — so the app behaves
  identically until the hook is enabled (dashboard → Auth → Hooks; local stack wired in
  `supabase/config.toml`). Accepted trade-off: an admin's role edit reaches the affected
  user on their next token refresh (≤ 1 h), not instantly; RLS still enforces from the
  table in real time.
- **Home page streams instantly:** the greeting `profile` read no longer blocks the page
  shell — the header moved inside the Suspense boundary, and profile + board data +
  pending approvals now fetch in **one parallel burst** (approvals used to be a second
  serial leg after the board batch).
- **Client router cache (P3):** `experimental.staleTimes.dynamic = 300` — a tab visited
  in the last 5 minutes re-renders from cache with zero server work. Correctness: every
  mutating server action (leave submit/cancel/approve/reject, allocations, balance set,
  employee CRUD/roles/team/manager, holidays/work-settings, own prefs) now calls a shared
  `invalidateAppCache()` (`revalidatePath('/', 'layout')`), so the acting user always
  sees their own change on the next navigation; other users get freshness via the
  staleness window or the per-page refresh pill (`router.refresh()` bypasses the cache).
- **Vercel region pinned (P5):** new `vercel.json` pins functions to `fra1` (Frankfurt),
  co-located with the eu-central-1 Supabase project — the remaining server↔DB legs become
  ~1–5 ms on the demo deployment.
- **Operator steps (pending, in this order):** (1) apply migration
  `20260702150001_custom_access_token_hook.sql` to the hosted project, (2) enable the
  hook: Dashboard → Authentication → Hooks → Customize Access Token (Postgres function
  `public.custom_access_token_hook`). Until then the fallback path keeps everything
  working at the old roles-query cost.

### UI polish, e2e hygiene & perf investigation (2026-07-02, later)
- **Approve/reject from the calendar:** approvers (admin: all; manager: own reports) now
  see approve/reject buttons — with the same confirm dialogs as `/manage/approvals` — on
  pending entries in both the calendar list view and the month view's day detail. Display
  scoping reuses `getPendingApprovals()`; the SQL function still re-checks permission on
  write. Plain employees see no buttons (asserted in `calendar.spec`).
- **Today highlighted on the calendar:** the current day's tile in the month view now
  has a gold fill (`#DACC3E` at 70% transparency) and a darkened-gold border, so today
  stands out from the other tiles. "Today" is the company timezone (Asia/Tehran).
- **Calendar month view (fixed):** in Farsi/RTL the per-day people-count badge overlapped
  the day number (both top-right). The badge now uses logical positioning (`end-*`) —
  top-left in Farsi, top-right in English.
- **Profile moved to the header:** the Profile tab left the bottom-tab/side-rail nav; a
  profile button now sits in the app header opposite the logo (`data-testid="nav-profile"`
  preserved). Nav is Home · Request · Calendar (+ Manage). Route still prefetched.
- **Demo DB cleanup:** deleted 380 throwaway accounts (and, by cascade, their requests,
  ledger rows, allocations, roles) accumulated from Playwright runs — codes matching
  `mgr|emp|cxl|auth|peer|lv|non|ov|e2e|set` + 13-digit timestamp or `set|pwd` + 6 digits.
  16 real accounts remain (admin, 12 seeded, 3 manually created).
- **Self-cleaning e2e:** new admin-guarded `app_cleanup_e2e_users()` RPC (migration
  `20260702140000_e2e_cleanup_fn.sql`, hardcoded test-code patterns only, audited),
  `scripts/cleanup-e2e.mjs` (`npm run cleanup:e2e`), and a Playwright `globalTeardown`
  that runs it after every e2e run.
- **Navigation performance:** investigated the 1–2 s tab-switch lag; root cause is a
  serial waterfall of 5–6 Supabase round-trips per navigation (double session validation
  in middleware + layout, then roles/profile/data) amplified by dev-mode compile &
  no-prefetch. Findings + ranked fix plan (local JWT verification via `getClaims`,
  roles-in-JWT, router cache reuse, region co-location): `docs/plans/2026-07-02-nav-performance.md`.
  Nothing implemented yet.

### Security & hardening — production-readiness review (2026-07-02)
A full codebase review (security, correctness, i18n, performance) with fixes. Two new
migrations (`20260702120001_hardening.sql`, `20260702120002_perf_rls_initplan.sql`) are
applied to the demo project and are idempotent.

- **Ledger concurrency (fixed):** `allocate_leave`, `approve_leave_request`,
  `cancel_leave_request` (reversal), and `set_leave_balance` all read the latest
  `balance_after` and then wrote a new row; two concurrent writers could write stale
  balances. All four now take a per-employee `pg_advisory_xact_lock` first.
- **Approval integrity (fixed):** approving could drive a balance negative (several
  pending requests could each pass the submit-time check) and could double-book dates.
  `approve_leave_request` now re-reads under the lock and rejects insufficient balance
  or overlap with an already-approved request.
- **Request validation (added):** `submit_leave_request` now rejects ranges longer than
  366 days (bounds the per-day counting loop — a DoS vector) and ranges overlapping the
  caller's own pending/approved requests.
- **Roles (fixed):** replacing a user's roles was a non-atomic delete-then-insert (a
  failed insert lost all roles) and an admin could remove their own admin role
  (lockout). New atomic `app_set_user_roles()` RPC guards both; the app now calls it.
- **Employee codes (fixed):** codes become the synthetic auth email
  (`code@bj-app.internal`); non-latin/whitespace codes produced accounts that cannot
  log in. Codes are now normalized (lowercase/trim) and validated in the form, the
  server action, and in-DB; duplicates get a friendly error.
- **Temp passwords (fixed):** were generated with `Math.random()` (predictable); now
  CSPRNG via `node:crypto` `randomInt` (same charset/length).
- **Localized errors (added):** raw English Postgres errors were shown in the Farsi
  UI. New `lib/errors/db-error.ts` maps every SQL-raised message (and known constraint
  violations) to fa/en `dbErrors` translations; unknown errors are logged server-side
  and replaced with a generic message so internals never leak.
- **Misc security:** `refreshRoute` server action now requires auth (was anonymous
  cache purging); security headers (`X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`) added in `next.config.ts`;
  `get_my_team_directory` search_path tightened to `''`.
- **Data integrity:** unique `work_settings(company_id)` (updateWorkSettings now
  upserts instead of silently updating 0 rows) and unique
  `holidays(company_id, holiday_date)`, both with dedupe of existing data; holiday
  update/delete now company-scoped in the action too.
- **Performance:** all RLS policies now use `(select auth.uid())` (advisor lint 0003 —
  evaluated once per statement instead of per row); covering indexes added for every
  advisor-flagged FK plus the `leave_ledger` latest-balance hot path.
- **UX polish:** approve/reject now `router.refresh()` so home-board counts update;
  employee-code inputs are LTR with a latin-only pattern; leave reason capped at 500
  chars; recurring-holiday checkbox now explains that day counting only honors exact
  saved dates; "cancellable" date check no longer freezes at page load.
- **Company timezone (fixed):** server-side "today" used the server clock (UTC on
  Vercel/Supabase), so between 00:00 and 03:30 Tehran time the home-board range, the
  calendar "current month", and the cancel-eligibility check were on yesterday's date.
  New `lib/appDate.ts` (Asia/Tehran) drives the home board and calendar month;
  `cancel_leave_request` compares against the Tehran date
  (`20260702120003_company_tz_cancel.sql`).
- **Supabase advisor status:** remaining lints are the documented by-design
  acceptances (0010 security-definer view, 0029 self-guarded RPCs). "Leaked password
  protection" stays off — passwords are set via our in-DB RPCs, which GoTrue's HIBP
  check does not cover; policy is enforced by `lib/auth/passwordPolicy.ts` + in-DB
  length check.

### Added — Navigation prefetch + manual page update pill (2026-06-30)
- **Performance/UX:** the app shell now prefetches every role-visible bottom/side-tab route after
  login so tab changes can reuse the client route cache instead of showing empty panels while each
  page fetches from scratch.
- **Manual freshness:** every app page header now includes a pill-shaped update button above the
  page title. It shows the last loaded time, invalidates the current route, and refreshes the page
  payload when tapped.

### Added — Home My Team + mobile calendar/manage polish (2026-06-30)
- **Home:** replaced the Team Time-Off card with **My Team**, showing the caller's manager,
  same-department teammates, role labels, team/title context, and each member's upcoming time off.
  Added the scoped `get_my_team_directory()` security-definer function so employees can see
  teammate role labels without broad `user_roles` access.
- **Calendar:** month view now uses explicit seven-column tracks on mobile and keeps multi-day leave
  names visible on every covered date.
- **Manage Employees:** mobile header actions now stack below the page title instead of squeezing
  beside it.

### Added — Calendar month view + locale polish (2026-06-30)
- **Calendar** now has a List/Month toggle. Month view highlights each in-month day with visible
  time-off, shows a localized per-day count badge, previews the first names with `...` overflow, and
  opens a selected-day detail panel showing who is off and the next configured working return date.
- **Request page localization:** leave-type selects, date picker locale/digits, working-day previews,
  balance previews, request-row dates, and request-row day counts now follow the user's language
  preference (English or Persian). User names remain unchanged.

### Added — UI polish + allocation at create/edit (2026-06-30)
- **Admin employee forms:** create employee now accepts initial PTO/annual and sick balances, and
  edit employee now sets current leave balances through the audited `set_leave_balance` RPC
  (`20260630120001_set_leave_balance.sql`).
- **Brand polish:** app/login logo, light-only color-scheme lock, Rubik primary font with Vazirmatn
  fallback for Persian glyphs, opaque mobile/desktop chrome, clearer active nav state, and more
  prominent primary buttons.

### Changed — Frontend Overhaul (UI/UX redesign)
- **Design system:** brand OKLCH tokens derived from the Behsazan Jonoob logo (primary `#2E3C92`),
  mapped via Tailwind v4 `@theme`; self-hosted **Rubik** font with **Vazirmatn** fallback for
  Persian glyphs; **shadcn/ui** primitives (new-york) with RTL migration. Light-only v1.
- **Responsive shell:** new `AppShell` — sticky app bar + a nav that is a bottom tab bar on mobile
  and a left side-rail on desktop (replacing the stretched-phone bottom bar); `Toaster` mounted once.
- **All 11 screens reskinned** onto Card/Input/Button/Select/Badge/Dialog primitives plus
  `StatusBadge`/`PageHeader`/`EmptyState`: login, home, request, my-requests, calendar, approvals,
  manage employees/allocations/settings, profile, team. Behavior and every `data-testid` preserved;
  FR-25 reason-privacy verified intact.
- **UX / perf:** lazy-loaded date picker (off the initial bundle); `router.refresh()` + `revalidatePath`
  instead of a full-page reload on submit; native `confirm()` → styled `AlertDialog` throughout;
  `toast` result feedback; `Suspense` + skeletons on data pages; consistent focus rings; PWA
  `theme-color` set to the brand.
- **Tooling:** e2e leave dates computed dynamically (no longer rot over time). All gates green —
  lint clean, unit 73/73, e2e 20/20 (serial), build clean. Branch `feat/frontend-overhaul`.

### Added
- Project documentation scaffold: `CLAUDE.md` (agent onboarding) and `docs/` —
  `PLAN.md`, `REQUIREMENTS.md`, `DATA_MODEL.md`, `PERMISSIONS.md`, `TASKS.md`, this changelog.
- Approved v1 design spec: `docs/specs/2026-06-23-hr-timeoff-design.md` (HR / Time-Off).
- Phase 0–2 implementation plan (TDD, file-level): `docs/plans/2026-06-23-hr-timeoff-v1.md`.
- Recorded key decisions: fresh build on Next.js + Supabase reusing Frappe HR's leave data model;
  admin-issued username/password auth; Farsi-default RTL + English; full Supabase with self-host
  for production; direct-manager approval with admin override; statutory leave types + balance
  ledger; full/half-day (hourly reserved); configurable Friday weekend + seeded Iranian holidays.

### Implemented — Phase 0 (Scaffold)
- Next.js (App Router) + TypeScript + Tailwind; Vitest + Playwright harness.
- Farsi-default **RTL** via next-intl (fa/en); PWA manifest (installable, persistent session).
- Supabase project `bj-app` (eu-central-1); typed server/browser clients (`@supabase/ssr`, Next 16 async cookies).

### Implemented — Phase 1 (Identity & Org)
- Schema: `companies, departments, profiles, user_roles, audit_log` (+ enums); generated TS types.
- **RLS** on all tables; helper fns in a PostgREST-hidden `private` schema; security advisor: 0 accidental lints. Visibility matrix verified (employee→own team; manager/security→all; write-scoping correct).
- **Auth**: employee-code + password login (synthetic-email mapping), persistent session, route guard; next-intl + Supabase session refresh composed in `proxy.ts`.
- **Admin** employee CRUD: create (in-DB `SECURITY DEFINER` RPC — no service_role secret), update (role-aware column subset), roles/team/manager assignment, activate/deactivate, password reset; audit logged.
- **Manager**: "My Team" view + edit of direct reports (RLS-scoped, column-limited).
- Seed (interim): 1 company, 4 departments (3 teams + Security), 1 admin (`admin`).

### Implemented — Phase 2 (Leave core)
- Leave schema: `work_settings, holidays, leave_types, leave_allocations, leave_requests, leave_ledger` (+ enums). Transactional tables are **SELECT-only** for clients.
- Write-path via guarded `SECURITY DEFINER` functions (no client fabrication): `submit_leave_request` (computes working-days server-side + validates balance), `cancel_leave_request`, `allocate_leave`; `compute_requested_days` + `current_leave_balance` internal-only.
- Pure `countWorkingDays` (TS, weekend + holiday aware) for UI preview, mirrored by the SQL counter; parity confirmed (preview = server).
- **Request form** on `react-multi-date-picker` — Persian **or** Gregorian per `calendar_pref`, RTL; live working-day + remaining-balance preview; half-day gated by leave type. My-Requests list with cancel. Admin allocation UI.
- Seed (interim): work settings (Friday weekend) + 3 leave types (annual 26d, sick, unpaid).

### Implemented — Phase 3 (Flow & visibility)
- **Approval** via guarded `SECURITY DEFINER` fns (`approve_leave_request` / `reject_leave_request`): the direct manager — or admin (override) — approves/rejects a pending request; approval atomically writes a `consumption` ledger row (−requested_days) with a row-count guard against double-debit; both decisions audit-logged.
- **Approvals queue** UI (`/manage/approvals`, admin + manager), pending list narrowed to the viewer's reports by the pure `filterApprovable` (admin sees all).
- **FR-25 reason privacy**: `leave_requests` SELECT tightened to `own | is_manager_of | security | admin` (teammates can no longer read another's free-text `reason`); a reason-less `team_leave_calendar` `SECURITY DEFINER` view (scoped `own | same_team | can_read_all`, pending+approved) backs the calendar. Verified on the live DB (a same-team peer reads the view, not the base row).
- **Calendar** (`/calendar`, FR-22): viewer-scoped, agenda-style month view (type-colored, Jalali/Gregorian per pref), never showing `reason`.
- Migrations 0008 (approval fns) + 0009 (reason privacy + view) applied; types regenerated. Tests: unit 34/34, e2e 11/11 (added approval + calendar suites, serial/CI). FR-15 approved-future cancellation still deferred.

### Implemented — Phase 4 (Home board, Nav, Settings)
- **Role-driven bottom-tab nav** (FR-21): Home · Request · Calendar · Profile, + Manage for admin/manager (pure `tabsForRoles`); inline SVG icons, RTL, active-by-pathname, safe-area padding.
- **Home status board** (FR-20): role-aware cards — balances, recent requests, team time-off, and (managers/admins) a pending-approval card — composed by the pure `buildHomeBoard` view-model over existing reads (`getMyBalances` added).
- **Profile / Settings** (FR-23): calendar (jalali/gregorian) + language (fa/en) toggles persisted to `profiles` (`updateMyPrefs`); language switch via new `i18n/navigation.ts` (next-intl locale-aware `router.replace`); logout via `signOut`.
- **Responsive + device detection** (NFR-1, NFR-7): pure `parseDeviceType`/`isMobileWidth` + `useViewport` hook; e2e verifies no horizontal overflow at 375/1280 px and ≥44 px nav touch targets. `/team` re-surfaced from the Manage employees header.
- No schema / RLS / SQL changes. Tests: unit 54/54, e2e 14/14 (serial). Deferred to Phase 5: admin work-settings/holiday UI (FR-24), self-service password change (FR-7 tail), balance-preview race polish.

### Implemented — Phase 5 (Seed & demo) — v1 demo release
- **Demo seed** (`scripts/seed-demo.mjs`, `npm run seed`): BJ Manufacturing with 3 teams (Production Line A, Quality Control, Maintenance) + Security; 12 curated users (3 managers, 6 employees, 3 security) with Iranian names, annual + sick allocations, and minimal 2026 holidays. Idempotent; created via the guarded `app_create_employee` / `allocate_leave` RPCs (no `service_role`). Non-curated e2e-throwaway profiles deactivated → 13 active (admin + roster). Password `Demo!2026`.
- **Portable config baseline** `supabase/seed.sql` (company / departments / leave types / work settings).
- **Polish:** the request form shows a balance loading state instead of flashing "unknown"; `/team` clarified as the manager's direct-reports view.
- **Deploy runbook** `docs/DEPLOY.md` (Vercel + self-host parity); the demo deploy is the operator's to run.
- e2e smoke (`seed-roles.spec`) logs in as manager / employee / security. Suite: unit 54/54, e2e 17/17 (serial).
- **v1 is feature-complete** except FR-24 (admin work/holiday editor) and FR-7 (self-service password change), deferred to **Phase 6** with FR-15 (cancel approved leave) and the official Iranian holiday list.

### Implemented — Phase 6 (Settings, password, cancel-approved)
- **FR-15**: `cancel_leave_request` now also cancels an **approved** request whose `start_date` is in
  the future, writing a `reversal` ledger row (+requested_days) for balance-affecting types (atomic,
  row-count guarded). My Requests shows Cancel on eligible approved rows (pure `isCancellable`).
- **FR-7**: self-service password change — guarded `app_change_my_password` verifies the current
  password in-DB (`crypt`; no `service_role`); a Change-Password form on Profile/Settings.
- **FR-24**: admin work-settings (weekend days) + holiday add/edit/delete editor at
  `/manage/settings`, writing directly via the pre-existing admin RLS policies on
  `work_settings`/`holidays` (no new RPC/migration). Linked from Manage for admins only.
- Migrations `20260626120001` (cancel reversal) + `20260626120002` (password fn); types regenerated.
  No table/enum/RLS-policy changes. Tests: unit 65/65 (+11), e2e 20/20 (+3, serial).

### Next
- Official Iranian 1404–1405 holiday dataset (entered via the FR-24 editor) · demo deploy
  (`docs/DEPLOY.md`) · then PLAN §6 modules (attendance, shifts, …).
