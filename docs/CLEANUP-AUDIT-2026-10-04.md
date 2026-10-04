# Cleanup audit — 2026-10-04

Review of the whole repository at `eb5a913`. Goal: cut what build agents have to read, grep past,
or keep in sync without getting value back. Each item says what to do, how big it is, and whether
it needs a decision first.

## 0. Status after the 2026-10-04 cleanup session

Applied (everything that needed no owner input), verified by lint, `tsc`, 427 unit tests, all
deploy tests, a production build, and the full e2e suite serially (47 passed, 1 skipped as before):

| Done | Items |
|---|---|
| Docs | A2 tiered read order (CLAUDE.md, AGENTS.md) · A3 TASKS.md rewritten as open items · A6 cleanup entry and an `a0cb7b1` release heading in CHANGELOG · A8 auto-memory 65 KB → 10 KB · A9 `supabase/schema.sql` + `npm run schema:dump` · stale RUNBOOK section and AGENT-LOG footer fixed |
| Files | B1 `deploy/migrations` and `deploy/sql/seed.sql` are symlinks into `supabase/` · B2 `assets/` removed (font licence moved to `app/fonts/OFL.txt`) · B3 scaffold SVGs · B4 stray `.superpowers` file untracked · B5 `docker-compose.local.yml` · B7 `config.toml` 416 → 13 lines · B10 package renamed `bj-erp` |
| Code | C1 seven unused UI primitives · C2 `setTeam`, `setManager` · C3 `useViewport`, `gregorianToJalali`, smoke test, `hourlyDayTotal`, `next-themes` · C6 `validateErrand`, `chainComplete` · C7 eleven unused i18n keys · D1 request forms share `FormParts` + `useRequestForm` · D2 employee forms share `EmployeeFormParts` · D4 `lib/actions/leave/*` split · D5 `requireCaller()` in every action · D6 one `PickerDate` type · D7 e2e helpers in one place · D8 source-text tests replaced or dropped · D11 `types.ts` header |

Kept on purpose: `theme.test.ts` and `login-rate-limit.test.ts` read config files, but there is no
behaviour to test instead (CSS tokens, Caddy/compose wiring). No page-level `requirePageUser`
helper: layouts already guard, and pages need the user id anyway.

Owner answers (2026-10-04, second pass): §4.1 leave `updateDepartmentCode` for now · §4.3 Vercel
demo retired: `vercel.json` deleted, docs updated · §4.4 archive and hide: old journal entries,
`docs/plans/`, DEPLOY.md, DEPLOY-GUIDE, LOCAL_REDEPLOY and SECURITY-REVIEW moved to `docs/archive/`,
hidden by a CLAUDE.md rule and the root `.ignore` · §4.5 on-prem server retired: `dist/` (4.6 GB)
deleted, docs updated. Its code (B6 and the `client` target) is a TASKS.md item.

Third pass: §4.2 `/manage/allocations` removed; the e2e `allocate()` helper now adds to the
Annual balance on the Edit Employee form. On-prem code kept on purpose. Still waiting: the
worktree and Docker images in §5; the merged branches are approved but left for Amir to delete.

Incremental (by design, when touching the area): D3, D9, D10, C8.

Found while applying: the local database has the six newest migrations applied by hand but missing
from its `bj_deploy.schema_migrations` ledger (harmless, they are idempotent), and the installed
Playwright browser build (1243) does not match `@playwright/test` 1.61.1 (expects 1228), so e2e
here ran through a scratch config pointing at the installed build.

Priority = (Impact + Risk) × (6 − Effort), each scored 1–5 (skill rubric). Effort: S < 1 h,
M = a few hours, L = a day or more.

## 1. Headline numbers

| Measure | Now | After phases 1–2 |
|---|---|---|
| Words an agent is told to read before starting (CLAUDE.md read order) | **~81k words (~110k tokens)** | ~4k words; domain docs on demand |
| `docs/AGENT-LOG.md` | 5,220 lines / 48k words, 82 % from Jul–Aug | last ~30 days only |
| `docs/` total | 55 files / 184k words (plans alone: 25 files / 66k words) | ~60 % smaller |
| Tracked duplicate SQL (`deploy/migrations/`) | 38 files / 7,500 lines, stale | 0 |
| Dead or duplicated app code | ~2.9k removable lines (~13 % of app/lib/components) | phase 2 removes ~1.1k of it; the rest is refactors |

The cost is concentrated in documentation, not code. The code is in decent shape. Its bloat is
duplication between sibling forms and a translation-plumbing pattern.

## 2. Findings, ranked

| # | Finding | Effort | Score | Decision needed? |
|---|---|---|---|---|
| A1 | AGENT-LOG is "read first" and 48k words long | S | 40 | archive vs delete |
| A2 | Mandatory read order totals ~81k words | S | 35 | — |
| A9 | Current SQL definitions are spread across 55 migrations; no schema snapshot | M | 32 | — |
| A4 | 25 finished implementation plans (66k words) sit next to live docs | S | 30 | archive vs delete |
| A8 | Claude auto-memory (outside the repo) is 65 KB and partly stale | S | 30 | — |
| A3 | TASKS.md is 621 lines with many wrong statuses | M | 28 | — |
| B1 | `deploy/migrations/` + `deploy/sql/seed.sql` are stale tracked copies | M | 28 | — |
| A5 | Six overlapping deploy docs | M | 20 | on-prem scope |
| C2 | Two dead server actions (`setTeam`, `setManager`) | S | 20 | — |
| D4 | `lib/actions/leave.ts` is 1,619 lines / 53 exports | M | 20 | — |
| D5 | Auth boilerplate repeated in every action and page | M | 20 | — |
| D1 | Four request forms share 52–64 % of their lines | L | 18 | — |
| D8 | Six unit tests assert on raw source text | M | 16 | — |
| B2 | `assets/` holds 3.5 MB of unused fonts and a duplicate logo | S | 15 | — |
| B7 | `supabase/config.toml`: 416-line CLI config for a stack nobody starts | S | 15 | — |
| C1 | Seven unused shadcn primitives (907 lines) | S | 15 | — |
| C3 | Small dead helpers, scaffold leftovers, unused `next-themes` | S | 15 | — |
| D2 | New/Edit employee forms share ~47 % | L | 15 | — |
| D3 | ~1,000 lines of translated-label props | L | 12 | — |
| D7 | e2e helpers and constants redefined across specs | M | 12 | — |
| A6 | CHANGELOG never cut a release; 1,041 lines under `[Unreleased]` | M | 12 | — |
| B3–B5, B10, C6, C7, D6, D11 | One-line tidy-ups (see §3) | S | ≤10 | — |
| C4, C5, B8 | Code kept on purpose or orphaned (see §4) | S–M | — | **yes** |
| D9, D10, C8 | Long-term (see §3.5) | L | ≤10 | — |

## 3. Details

### 3.1 Documentation and agent context (A)

**A1 — AGENT-LOG.md.** 82 entries, 2026-07-29 → 2026-10-04. Jul–Aug entries are 39.4k of its 48k
words. CLAUDE.md tells every agent to read it before touching anything. Problems:
- Move every entry older than ~30 days to `docs/archive/AGENT-LOG-2026-07-08.md`. Keep the template
  and recent entries.
- In CLAUDE.md, change "read first" to "read the newest 3 entries".
- Housekeeping: the 2026-08-11 entry sits after the closing footer (`docs/AGENT-LOG.md:5210`), and
  that footer points at `.superpowers/sdd/progress.md`, which is gitignored and local-only.

**A2 — Read order.** CLAUDE.md lists nine documents that together total ~81k words: AGENT-LOG 48k ·
CHANGELOG 11.6k · TASKS 6.7k · DATA_MODEL 4.2k · REQUIREMENTS 3.0k · PERMISSIONS 2.9k · a spec
~2.5k · CLAUDE 1.1k · PLAN 1.0k. Make it tiered:
- **Always:** CLAUDE.md, the newest AGENT-LOG entries, and TASKS open items.
- **When the task touches the area:** DATA_MODEL (schema), PERMISSIONS (RLS and roles),
  REQUIREMENTS (behaviour), and the relevant spec.
- **Never by default:** CHANGELOG, plans, archive.

**A3 — TASKS.md (621 lines, 6.7k words).** It is a mixture of status and narrative history, and many
statuses are wrong:
- Phase 0–2 items are still ☐ even though they shipped (lines 57–76).
- "Holidays, weekends, approvers" is marked "◐ batch A landed" (line 380), but line 438 says A–D
  landed.
- "HR role, approval chain…" is marked "◐ planned, batch 0 landed" (line 488), but CHANGELOG shows
  it all shipped on 2026-08-18.
- The ⊘ operator step about enabling the access-token hook from the Supabase Cloud dashboard
  (line 32) applies to the retired Vercel/Cloud demo.
- About ten "☐ Not applied to the client's server" lines describe the on-prem box. That box is no
  longer the deploy target.

Rewrite TASKS.md as open items only (aim for under 80 lines): Liara follow-ups (offsite backups,
company subdomain), real backlog (PLAN §6), questions for the client, and known gaps. History
already lives in CHANGELOG and git.

**A4 — `docs/plans/` (25 files, 66k words).** Every plan is implemented. They still show up in
searches with instructions that no longer work. For example, plans repeatedly say
`npx supabase gen types typescript --linked`, which `docs/MEMORY.md:283` says cannot run from Iran.
Move them to `docs/archive/plans/`, or delete them, since git keeps them. Keep `docs/specs/`: those
are the frozen design records CLAUDE.md points to.

**A5 — Deploy docs.** There are six: DEPLOY-LIARA (current), DEPLOY-ASSISTANT (on-prem/local tool),
DEPLOY-GUIDE, LOCAL_REDEPLOY, DEPLOY.md (index plus legacy Vercel), and `deploy/RUNBOOK.md` (shipped
inside the installer bundle). Together they are ~10.9k words.
- DEPLOY-GUIDE and LOCAL_REDEPLOY each say `bj-deploy` supersedes them. Archive both.
- Reduce DEPLOY.md to a ~20-line index.
- `deploy/RUNBOOK.md:291` "Later: automating deploys (design, not yet built)" is stale: `bj-deploy`
  exists. Keep RUNBOOK itself, because `deploy/package.sh` ships it.

**A6 — CHANGELOG.md.** All 1,041 lines sit under `[Unreleased]`. Cut a section per deployed release
(on-prem `c778c7b`, Liara `a0cb7b1`) and move pre-leave-v2 sections to the archive. Low urgency once
A2 drops CHANGELOG from the default reading.

**A7 —** `docs/SECURITY-REVIEW-2026-07-30.md` is closed evidence. Archive it.

**A8 — Claude auto-memory** (outside the repo, `~/.claude/projects/-Users-amir-Workspace-bj/memory/`).
`bj-hr-app-state.md` is 52 KB (~13k tokens whenever it is recalled). The `MEMORY.md` index line that
loads every session is ~1,800 characters and stale: it says "ALL UNCOMMITTED on `main`" and
"13 client-unapplied migrations". That work was committed in `8ba15e9`/`77c33ea`. Rewrite it as a few
lines pointing at the repo docs. History belongs in AGENT-LOG and CHANGELOG, not in memory.

**A9 — No schema snapshot.** An agent who needs the current `approve_leave_request` has to find the
last of **9** definitions. `submit_leave_request` and `cancel_leave_request` have 8 each. Overall the
55 migrations hold 126 function definitions for about 50 distinct functions, 86 `create policy`
statements and 66 `drop policy` statements. Fix:
- Add `scripts/dump-schema.sh`. It runs `pg_dump --schema-only` against the local Docker DB
  (`docker exec … pg_dump -U supabase_admin`).
- Commit its output as `supabase/schema.sql` and regenerate it in the same commit as each migration.
- CLAUDE.md: "current definitions → `supabase/schema.sql`; migrations are history".

Do **not** squash the migrations. Deployed databases track them in `bj_deploy.schema_migrations`.

### 3.2 Duplicate and stale files (B)

**B1 — `deploy/migrations/`** is 38 tracked files, byte-identical to their `supabase/migrations/`
counterparts but missing the 17 newer ones. **`deploy/sql/seed.sql`** is identical to
`supabase/seed.sql`. Nothing in the pipeline copies from them: `package.sh`,
`liara/package-release.sh` and `bj-deploy` all read `supabase/`. They exist only because
`deploy/docker-compose.yml:42-43` bind-mounts `./migrations` and `./sql/seed.sql` when the stack runs
from the repo. Every SQL grep returns two copies, one of them stale.

Replace them with relative symlinks (`deploy/migrations → ../supabase/migrations`,
`deploy/sql/seed.sql → ../../supabase/seed.sql`), or gitignore them and have `bj-deploy local`
populate them. Verify with `docker compose -f deploy/docker-compose.yml -f
deploy/docker-compose.local-arm64.yml config` and a local up.

**B2 — `assets/`** holds 19 files and 3.5 MB, and nothing references it:
- 14 static Rubik weights, never loaded.
- Two variable fonts that are byte-identical to the ones the app loads from `app/fonts/`.
- The Rubik README.
- `bj-logo.png`, a byte-identical duplicate of `public/bj-logo.png`.

Delete it, but move `OFL.txt` to `app/fonts/`, because the font license should travel with the font.

**B3 — `public/`:** `file.svg`, `globe.svg`, `next.svg`, `vercel.svg` and `window.svg` are
create-next-app leftovers and unused.

**B4 —** `.superpowers/sdd/task-0a-report.md` is tracked even though `.superpowers/` is ignored.
Remove it from the index.

**B5 —** `deploy/docker-compose.local.yml` is unreferenced and superseded by
`docker-compose.local-arm64.yml`.

**B6 —** `deploy/release.sh` is a shim kept for "older operator habits". `setup-release.sh` still
describes itself in terms of it. Remove both together once on-prem docs are archived (A5); not
urgent.

**B7 — `supabase/config.toml`** is the 416-line `supabase init` default. There is no CLI dev stack:
see `docs/MEMORY.md:290`, "Local stack ≠ `supabase start`". Trim it to `project_id` plus the API
schemas, or delete it. `gen types --db-url` does not need it.

**B8 — `vercel.json`** only pins the region for the retired Vercel demo. Delete it if the demo is
really retired (see §4).

**B10 —** The package name in `package.json` is `"hr-scaffold"`; rename it to `bj-erp`.

### 3.3 Dead code (C)

**C1 — Unused UI primitives.** No file imports `components/ui/{avatar, dropdown-menu, popover,
select, separator, sheet, tabs}.tsx` (907 lines). Agents choosing components read them anyway.
Delete; `npx shadcn add <name>` restores any one in seconds.

**C2 — Dead server actions.** `lib/actions/employees.ts:208` `setTeam` and `:233` `setManager` have
no callers. The e2e `setManager` helpers are separate functions that drive the UI. Both write
`profiles` directly instead of going through the guarded flows. Delete.

**C3 — Small dead items:**
- `lib/useViewport.ts`: no importers.
- `gregorianToJalali` (`lib/leave/dateConvert.ts:28`): no callers.
- `lib/_smoke.ts` and `tests/unit/smoke.test.ts`: scaffold check.
- `hourlyDayTotal` (`lib/leave/hourly.ts:92`): an `a + b` wrapper used only by its own test.
- The `next-themes` dependency: never imported; the app is light-only.

**C6 —** `validateErrand` (`lib/leave/errand.ts:61`): its header says it "exists so the form can
validate before a round-trip", but the form never calls it. Only tests do. Either wire it into
`ErrandRequestForm` or delete it. `chainComplete` (`lib/leave/approvals.ts:158`) is likewise
test-only.

**C7 — Unused i18n keys** (fa and en are otherwise at 634/634 parity):
- `home.manageLink`
- `request.workingDays`, `request.remainingBalance`
- `print.fields.jobTitle`, `print.fields.decidedBy`, `print.signedAt`
- `manage.departments.backToList`, `manage.departments.invalid`, `manage.settings.departments.invalid`
- `dbErrors.insufficientBalance`
- The `app` namespace: `app/[locale]/layout.tsx:27` hard-codes the same title instead of using it.

### 3.4 Refactors (D)

**D1 — Request forms.** Leave, Hourly, Errand and Daily-errand forms are 1,466 lines together.
Measured overlap of significant lines:

| Pair | Overlap |
|---|---|
| Leave ↔ Hourly | 62 % |
| Errand ↔ Hourly | 64 % |
| Errand ↔ Daily-errand | 52 % |

Each repeats the same replacement-candidate fetch, balance fetch, signature state and
success/error state. Extract `useReplacementCandidates`, `useLeaveBalance` and a shared
signature/submit/feedback section. Expect about −500 lines, and one place to change instead of four.

**D2 — Employee forms.** `EditEmployeeForm` (621) and `NewEmployeeForm` (609) share ~47 %. Extract
shared field groups: identity, roles, and leave balance/policy.

**D3 — Translated-label props.** Server pages translate strings and pass them down: 514
`key: t('…')` lines across `page.tsx` files, and ~555 `field: string;` prop-type lines in client
components, mostly label fields. Meanwhile `app/[locale]/layout.tsx:65` already sends the **entire** catalog to the client
through `NextIntlClientProvider`, so the pattern saves nothing. Client components should call
`useTranslations` directly. Convert each component when it is next touched; don't do a big-bang
rewrite. About −1,000 lines eventually.

**D4 — `lib/actions/leave.ts` (1,619 lines, 53 exports).** It mixes submit/cancel, approvals,
signatures, calendar, balances, policy/accrual and review/print. Any leave change loads the whole
file. Split it by concern into `lib/actions/leave/*.ts`, with a barrel or updated imports.

**D5 — Auth boilerplate.** `getCallerContext` is copy-pasted in `lib/actions/leave.ts:27` and
`lib/actions/employees.ts:19`. Actions repeat `if (!user) return dbErr('not authenticated')` 44 times
and `roles.includes('admin')` 21 times. Pages repeat `getCachedUser` + redirect. Add
`requireCaller({ anyOf: [...] })` for actions and `requirePageUser(locale, roles?)` for pages in
`lib/auth/context.ts`.

**D6 —** `type DateObjectLike = any` (each with an `eslint-disable`) is copy-pasted into 9
components. Export one type from `lib/leave/dateConvert.ts`, which already defines one.

**D7 — e2e helpers.** `tests/e2e/_helpers.ts` exports `ADMIN_CODE`, `ADMIN_PASSWORD` and `login`,
yet `approval`, `auth`, `leave` and `manage` specs and `global-setup` redefine them.
`setManager` is defined in 3 specs; `login`, `logout` and `createEmployee` in 2 each, plus
`loginAs` in `team.spec.ts`. Consolidate. This
also makes the `E2E_ADMIN_*` overrides apply everywhere.

**D8 — Source-text tests.** These six unit tests `readFileSync` source files and assert on literal
strings rather than behaviour. `request-signature.test.tsx:189-228`, for example, reads three form
files and a migration.
- `calendar-picker.test.ts`
- `calendar-view-css.test.ts`
- `login-rate-limit.test.ts`
- `page-refresh-button.test.tsx`
- `request-signature.test.tsx`
- `theme.test.ts`

They will fail on D1/D3 without catching real regressions. Replace them with render/behaviour tests
or drop them. The deploy-config assertions in `login-rate-limit` arguably belong in
`tests/deploy/*.sh`.

**D11 —** The `lib/supabase/types.ts` header opens with "Generated… Do not edit by hand", then
documents that it *is* hand-edited. Make the header say what is true.

### 3.5 Long-term, low priority

- **D9 — TS mirrors of SQL.** `lib/leave/{accrual, approvals, hourly, errand, workingDays}.ts` must
  stay "in lockstep" with SQL functions. `accrual.ts` is test-only in its entirety. SQL tests (pgTAP
  against the Docker DB) would remove the drift risk; then drop the test-only mirrors.
- **D10 — Comment style.** Several pure modules are 40–75 % comment, much of it history ("since
  2026-07-30", "replaces the pre-chain version"). When editing, keep the *why* and cut the
  chronology; git and CHANGELOG hold the history.
- **C8 —** `profiles.calendar_pref` is vestigial: a CHECK pins it to `'jalali'`, and
  `app_create_employee` still accepts `p_calendar_pref`. Drop it only in a migration that touches
  that area anyway.

## 4. Decisions for Amir

1. **`updateDepartmentCode`**, the skipped test in `tests/e2e/department.spec.ts:25`, and the
   `departments_update_admin` policy are kept on purpose "so the feature can return". Recommendation:
   delete. Git history restores it if the client asks.
2. **`/manage/allocations`** is linked from nowhere in the UI. Balances are now set on the employee
   forms. It is still admin-only, and four e2e helpers reach it by URL. Link it, or remove it and
   switch those helpers to the employee form?
3. **Vercel demo:** is it retired? If yes, delete `vercel.json` and the Vercel sections of DEPLOY.md
   and PLAN.md.
4. **Archive or delete** for old AGENT-LOG entries, plans and closed docs. Recommendation: archive
   AGENT-LOG and closed docs in `docs/archive/`, and delete plans, since git keeps them.
5. **On-prem tooling stays.** The client server still runs `c778c7b` with real data, and the Liara
   path reuses `install.sh`, `update.sh` and `lib/*`. Only its docs shrink (A5).

## 5. Phased plan

| Phase | Items | Risk | Verify | Commit |
|---|---|---|---|---|
| 1 — docs only (~2 h) | A1–A5, A7, A8, B4, CLAUDE.md read order, C7 | none at runtime | links resolve | `[skip ci]` |
| 2 — dead files and code (~3 h) | B1, B2, B3, B5, B7, B10, C1, C2, C3, C6, D6, D11 | low | `npm run lint`, `test:unit`, `test:deploy`, `build`; local compose up for B1 | normal push → Liara deploy |
| 3 — structure (~1–2 days) | A9, D4, D5, D7, D8 | low–medium | full unit + e2e serial | per item |
| 4 — opportunistic | D1, D2, D3, A6, D9, D10, C8 | medium | e2e on touched flows | when touching the area |

**Local disk only (not in git; agents never see it):**
- `dist/` is 4.6 GB: eight ~107 MB release bundles plus the installer tree. Keep the bundle for
  `20260819-022529-8ba15e9` (what the client server runs) and delete the rest.
- Five local branches and three `origin/codex/*` branches are all merged into `main`. The
  `.claude/worktrees/peaceful-williams-9c1cf9` worktree (69 MB) still holds uncommitted edits:
  its code fix is superseded on `main`, but its `docs/MEMORY.md` lesson is not. Ask before deleting.
- `.next/` is 3.3 GB of build cache.

## 6. How this was measured

The checks were run from the repo root and can be re-run to confirm a finding:
- `git ls-files` inventories.
- A grep of each module's importers.
- A script listing exports not referenced outside their file.
- A comparison of i18n leaf keys against code.
- Line-overlap checks between sibling components.
- `cmp` of `deploy/migrations/*` against `supabase/migrations/*`.
- `grep -c 'create or replace function'` per function name.

Treat counts as of `eb5a913`.
