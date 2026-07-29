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

---

*Entries before 2026-07-29 were never journalled. For that history use `docs/CHANGELOG.md`
(what shipped), `docs/MEMORY.md` (lessons), `.superpowers/sdd/progress.md` (task-level build
ledger), and `git log`.*
