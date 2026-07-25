# MEMORY — institutional lessons & themes

Distilled memory for agents starting a session on this repo: the themes, corrections, and
conventions that are NOT obvious from the code. Read alongside `CLAUDE.md` (read order there).
Not a changelog — that's `docs/CHANGELOG.md`.

## Core themes

- **Built for real company use — security first.** RLS is the enforcement layer; UI only
  hides. Every access rule must exist as a Postgres policy (or guarded SECURITY DEFINER fn),
  and privacy claims get verified empirically against the live DB (role-simulation), not by
  reading code.
- **No `service_role` secret anywhere.** User creation, password change, role sets, cleanup —
  all via guarded in-DB SECURITY DEFINER RPCs (`app_create_employee`, `app_set_user_roles`,
  `app_change_my_password`, …). Deliberate: portability to self-hosted Supabase in production.
- **Dates are Gregorian in the DB, always.** Jalali is a presentation concern converted at the
  UI edge (`react-date-object`). Never store Jalali strings.
- **"Today" is Asia/Tehran** (`lib/appDate.ts` + SQL equivalents). Vercel/Supabase run UTC —
  naive `new Date()` drifts 3.5h nightly and breaks date-boundary logic (e.g. cancelability).
- **Farsi-first RTL discipline.** Logical CSS utilities only (`start-*`/`end-*`, no `left/right`);
  fa/en message key trees kept byte-identical; test RTL rendering, not just LTR.
- **The `data-testid` contract.** Reskins/refactors preserve every testid so the e2e suite
  survives; e2e drives native `<select>` via `selectOption`, so those stay native (shadcn Radix
  Select breaks Playwright) — a standing decision.
- **Cache invariant:** every mutating server action must call `invalidateAppCache()`
  (`lib/cache/invalidate-app.ts`), or the actor sees 5-min-stale tabs (`staleTimes.dynamic=300`).
- **Verify library APIs via Context7 before use** — Next 16 / Supabase APIs moved past training
  data more than once (e.g. `proxy.ts` middleware name, `getClaims`, `experimental.staleTimes`).

## Lessons learned

### Ledger writes race without locks
All balance writers (`allocate_leave`, `approve_leave_request`, cancel-reversal,
`set_leave_balance`) did read-latest-balance-then-insert; concurrent writers wrote stale
balances, and approve could go negative or double-book. Fix: per-employee
`pg_advisory_xact_lock` first, then re-check balance + overlap under the lock
(migration `20260702120001_hardening.sql`). Any new ledger writer must follow this pattern.

### Nav perf: the enemy is serial Supabase round-trips
1–2s tab switches were 5–6 serial RTTs/nav (double `getUser`, roles, profile, data). Fixes that
worked: `auth.getClaims()` local JWT verify (~0.5ms vs ~140ms), roles embedded as an `app_roles`
JWT claim via custom access token hook (with `user_roles` table fallback), router `staleTimes`,
parallel home reads, Vercel pinned `fra1` next to eu-central-1. Plan:
`docs/plans/2026-07-02-nav-performance.md`. Trade-off accepted: role edits propagate on token
refresh (≤1h); RLS still enforces in real time.

### e2e: cold-dev hydration race wipes the first login fill
On a cold `next dev`, Playwright's first fill on /login gets erased by hydration. Login helpers
fill-and-verify inside `expect(...).toPass()`. Keep this in any new spec's login path.

### e2e: throwaway users polluted the shared demo DB
Repeated runs left 380 junk accounts (purged 2026-07-02, user-approved). Suite now self-cleans:
admin-guarded `app_cleanup_e2e_users()` RPC (hardcoded test-code patterns) + Playwright
`globalTeardown` + `npm run cleanup:e2e`. New specs must use matching throwaway code patterns.

### e2e: hardcoded dates rot; parallelism flakes
Fixed Jalali fixtures expired and turned the suite red on month-end. Use dynamic
`jalali2DayRange()` / `jalaliCurrentMonthRange()` (tests/e2e/_helpers). Run e2e serial
(`--workers=1`) — parallel DB-backed specs contend and time out; that's not a regression.

### "Dark theme bug" was Chrome auto-dark
Reports of a too-dark/transparent nav were Chrome's auto-dark feature mangling the light-only
UI, not a real theme bug. Fixed with an explicit light `color-scheme` lock. Check browser
features before hunting phantom CSS bugs.

### Work gets split across AI tools — re-sync before continuing
When usage limits hit mid-task, Amir has ChatGPT (or another agent) finish from the written
plan. Commits from elsewhere (e.g. `abaeafd`) land on `main`. On session start: diff/review
what changed, update docs, then continue. Written plans in `docs/plans/` are the handoff format.

### Stale docs actively mislead agents
CLAUDE.md once said "documentation only, not a git repo" long after the app shipped — agents
wasted time on false premises. Keep `CLAUDE.md`, `CHANGELOG.md`, `TASKS.md` current as work
lands. CLAUDE.md is caveman-compressed; the readable original is backed up at
`~/.local/share/caveman-compress/backups/bj/CLAUDE.original.md`.

### Employee code IS the auth identity — validate hard
Codes become the synthetic auth email (`code@bj-app.internal`); Persian characters/whitespace
created accounts that could never log in. Codes are normalized + validated in form, action,
and in-DB. Any new identity-adjacent input needs the same triple validation.

### Self-host gateway: browsers by IP and CORS are Kong's old jobs
Two Caddy gaps surfaced running the installer stack locally (both fixed in
`deploy/caddy/Caddyfile`): (1) TLS to a raw IP sends no SNI — without `default_sni {$APP_HOST}`
Caddy refuses the handshake ("tlsv1 alert internal error"), which would have hit the client too;
(2) GoTrue itself sends **no CORS preflight headers** (Supabase Cloud's Kong does that), so the
internal `:8080` listener answers preflights for cross-origin dev (`npm run dev` on the host).
GoTrue *does* set `Access-Control-Allow-Origin` on actual responses — don't add it again at the
proxy (browsers reject the duplicate). Dev/e2e point `.env.local` at `http://<mac-ip>:8080`
(compose override in `dist/bj-erp-installer/` publishes the port; not shipped).

### e2e: one `.font-mono`/selector class is not a contract
The new-employee success screen's temp password was scraped via `.font-mono` — adding a second
font-mono element (code preview) silently made four specs read the wrong value. Anything e2e
reads gets its own `data-testid` (`temp-password`, `code-preview`). Also: cold-dev hydration
eats first *clicks*, not just fills — the login/upload helpers retry the whole
fill→click→assert cycle in one `toPass`. And e2e "today" must be **Asia/Tehran**
(`_helpers.todayUTC()`), or cancel-approved flakes nightly 20:30–24:00 UTC.

### Test-reserved identifier ranges beat pattern archaeology
Generated employee codes broke the old cleanup regexes; instead of stacking patterns,
personnel numbers `999#######` (10 digits) are reserved for tests and `app_cleanup_e2e_users()`
matches `^[a-z0-9]{2,6}-999[0-9]{7}$`. New e2e users must come from
`nextTestPersonnelNo()` in `tests/e2e/_helpers.ts`.

### Advisor warnings ≠ bugs here
The Supabase security advisor flags the SECURITY DEFINER RPCs and the reason-less
`team_leave_calendar` definer view — all intentional and documented (FR-25 reason privacy
depends on the view). Don't "fix" them; the HIBP leaked-password toggle is N/A (passwords set
via our RPCs, not GoTrue).

## Working conventions with Amir

- Non-technical owner. **The final message must stand alone**: outcome first, plain language,
  no shorthand/arrow-chains; each ask spelled out fresh. He reads only that message.
- Replies are terse ("proceed", "approved", "continue"). Ask clarifying questions **up front**,
  then execute uninterrupted — "once you start don't stop" is the norm.
- He batches work to dodge usage limits: list batches/phases, wait for a go per batch.
- Destructive/irreversible ops (DB purges, branch deletion) get explicit approval first —
  writes to the demo DB are otherwise fine.
- **Commit only when asked; push only when asked.** He sometimes creates/merges PRs himself.
- Workflow: superpowers brainstorm → spec (`docs/specs/`) → plan (`docs/plans/`) →
  subagent-driven or inline-batched execution with review gates; ledger in
  `.superpowers/sdd/progress.md`.
- Keep `docs/CHANGELOG.md` + `docs/TASKS.md` updated as part of landing work, not after.

## Pointers

- Read order: `CLAUDE.md` → `docs/PLAN.md` → `REQUIREMENTS.md` → `DATA_MODEL.md` →
  `PERMISSIONS.md` → current spec in `docs/specs/` → `TASKS.md` → `CHANGELOG.md`.
- Granular task + commit history: `.superpowers/sdd/progress.md`.
- Supabase demo project: `bj-app`, ref `rimshsfkjpwlvjxbxhqm`, eu-central-1. Vercel: `fra1`.
- GitHub: `AmirNcode/bj-erp`. Demo logins: `admin`/`Admin!2026`; seeded roster `Demo!2026`.
- Cross-session agent memory: `~/.claude/projects/-Users-amir-Workspace-bj/memory/`.
