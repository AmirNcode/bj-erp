# Refactor Plan

Review date: 2026-10-19, at commit `3d81b08` on branch `codex/per-diem-wording`, which has
uncommitted work. Every task cites files and lines as they were then. Re-check a range before you
edit it, because line numbers drift.

## 1. Context for implementer

- **Stack:** Next.js 16 App Router (`next@16.3.8`, React 19) + TypeScript, `next-intl` (Farsi
  default, RTL; English toggle), self-hosted Supabase (Postgres + GoTrue + PostgREST, RLS is the
  access-control boundary), Tailwind 4 + shadcn/Radix UI, Vitest + Playwright.
- **Entry points:** `proxy.ts` (middleware: session refresh + locale routing), `app/[locale]/layout.tsx`
  (sends the full message catalog to the client via `NextIntlClientProvider`),
  `app/[locale]/(app)/layout.tsx` (signed-in shell), `app/api/health/route.ts`.
- **Folders:** `app/[locale]/(app)/*` screens (each `page.tsx` is a Server Component that usually
  renders one `'use client'` component) · `lib/actions/**` server actions (`'use server'`, each
  starts with `requireCaller()` from `lib/auth/context.ts`) · `lib/leave/*`, `lib/permissions/*`,
  `lib/csv/*`, … pure logic · `components/` shared UI (`components/ui/*` are shadcn primitives) ·
  `messages/{fa,en}.json` translations · `supabase/migrations/` SQL history (forward-only,
  frozen once applied) and `supabase/schema.sql` (generated snapshot) · `tests/unit` (Vitest),
  `tests/e2e` (Playwright), `tests/sql` (psql scenario scripts), `tests/deploy` (shell).
- **Commands** (all in `package.json`, verified):
  - `npm install`, then `npm run dev` (http://localhost:3000; needs `.env.local`)
  - `npm run lint` (ESLint) · `npx tsc --noEmit` (type check; `typescript` is a devDependency)
  - `npm run test:unit` (Vitest, all of `tests/unit`)
  - `npm run test:deploy` (runs only `tests/deploy/deploy-assistant.test.sh`)
  - `npm run build` (production build; it catches `'use server'` export mistakes that `tsc` misses)
  - `npm run test:e2e -- --workers=1` (Playwright. It needs the local Docker stack and a dev server.
    The local DB holds real personnel data, so run only the specs a task touches, and never
    `accrual.spec`.)
- **Global rules:**
  1. **Behavior must not change.** Same UI text, same server-action results, same SQL calls. A task
     that cannot be done without a visible change is out of scope. Raise it as a question instead.
  2. Run `npx tsc --noEmit && npm run lint && npm run test:unit` after every task, plus
     `npm run build` for any task that touches a `'use server'` file or a `page.tsx`.
  3. **One task per commit.** Pushing to `main` deploys to production through CI, so keep each
     commit releasable.
  4. **No SQL or migration changes** in any task here.
  5. **Do not change the request-form files until branch `codex/per-diem-wording` has merged.**
     When this plan was written, these files had uncommitted edits:
     `app/[locale]/(app)/request/**`, `lib/i18n/format.ts`, `lib/leave/perDiem.ts`,
     `lib/leave/returnToWork.ts` (new, untracked), and `messages/*.json`. Tasks that touch them say
     so in their notes.
  6. Repo convention (CLAUDE.md): append an entry to `docs/AGENT-LOG.md` for each working session,
     and update `docs/CHANGELOG.md` when something ships.

## 2. Summary table

| ID | Title | Files | Impact | Effort | Risk | Depends on |
|---|---|---|---|---|---|---|
| R-01 | Delete the unused `getAllEmployees` server action | `lib/actions/leave/reference.ts` | H | S | L | — |
| R-02 | Delete dead modules and helpers | `lib/auth/permissions.ts`, `lib/device.ts`, `lib/leave/weekend.ts` + 2 tests | M | S | L | Q6 (device.ts only) |
| R-03 | One signature/per-diem pre-check for all signing actions | `lib/leave/signature.ts`, `lib/actions/leave/requests.ts`, `lib/actions/leave/approvals.ts`, `lib/actions/clearance.ts` | M | S | L | — |
| R-04 | One source for work-settings defaults | `lib/actions/leave/reference.ts`, `lib/actions/settings.ts`, `app/[locale]/(app)/settings/page.tsx` | M | S | L | — |
| R-05 | One client-side CSV download helper | 6 components + new `lib/csv/download.ts` | M | S | L | — |
| R-06 | Reuse the locale, number and timezone helpers | `lib/leave/calendarMonth.ts`, `lib/i18n/format.ts`, `i18n/routing.ts`, 4 components | L | S | L | after the per-diem branch (for `perDiem.ts`, `format.ts`) |
| R-07 | Name the server-action result type once | `lib/errors/db-error.ts` + ~20 files in `lib/actions/**` | M | M | L | R-01, R-03 |
| R-08 | One `.env.local` loader for Node scripts | `scripts/seed-demo.mjs`, `scripts/cleanup-e2e.mjs`, `tests/e2e/global-setup.ts` | L | S | L | — |
| R-09 | One set of ISO-date and working-day helpers | `lib/leave/{calendarMonth,returnToWork,workingDays,weekend}.ts` | M | M | M | after the per-diem branch |
| R-10 | Retire test-only TypeScript mirrors of SQL rules | `lib/leave/{approvals,hourly,accrual}.ts`, `lib/personal-info/fields.ts` + tests | H | M | M | **Q1** |
| R-11 | Run every deploy test through `npm run test:deploy` | `package.json`, `.github/workflows/deploy-liara.yml` | L | S | L | **Q4** |
| R-12 | Replace server-built `labels` props with `useTranslations` | ~22 `page.tsx` files + their client components | H | L | M | R-06; after the per-diem branch for `request/**` |

## 3. Tasks (ordered for execution)

### R-01: Delete the unused `getAllEmployees` server action

- **Files:** `lib/actions/leave/reference.ts:104-129` (`EmployeeOption` type and
  `getAllEmployees()`).
- **Problem:** `getAllEmployees` has no caller anywhere in `app/`, `lib/`, `components/` or `tests/`.
  Its last UI caller (the allocations screen) was removed in commit `2d2754b`. Every exported
  function in a `'use server'` file is a public POST endpoint. This one returns every active
  employee's name and code to any admin session, and nothing uses it, so it is unused attack
  surface that also costs reading time.
- **Change:**
  1. Delete lines 104-129 (the doc comment, `EmployeeOption`, `getAllEmployees`).
  2. Fix the module header comment (lines 3-6) so it no longer mentions "the employee list".
  3. If `dbErr` or `requireCaller` imports become unused, remove them. They are still used by the
     other two functions, so they should remain.
- **Before/after sketch:**
  ```ts
  // before: export type EmployeeOption = {...}; export async function getAllEmployees() {...}
  // after:  (gone) — file exports LeaveType, getActiveLeaveTypes, WorkSettings, getWorkSettings
  ```
- **Acceptance criteria:** `grep -rn "getAllEmployees\|EmployeeOption" app lib components tests`
  returns nothing. Type check, lint, unit tests and build pass.
- **Verification:** `npx tsc --noEmit && npm run lint && npm run test:unit && npm run build`. All
  should exit 0.
- **Risk notes:** Server actions are referenced only through imports, so nothing else can be
  calling it. `docs/AGENT-LOG.md` mentions it historically; leave the log alone.

### R-02: Delete dead modules and helpers

- **Files:**
  - `lib/auth/permissions.ts:1`: a one-line re-export of `getCachedPermissions`. No file imports
    `@/lib/auth/permissions`.
  - `lib/device.ts:1-20` (`parseDeviceType`, `isMobileWidth`) and `tests/unit/device.test.ts`. The
    test is the only importer.
  - `lib/leave/weekend.ts:18` (`WeekendFrequency` type) and `lib/leave/weekend.ts:134-143`
    (`frequencyOf`), plus `tests/unit/weekend.test.ts:6` (import) and `:206-218` (the
    `describe('frequencyOf')` block). `WorkSettingsForm.tsx` now edits two slot lists
    (`toSlots`/`fromSlots`) and never calls `frequencyOf`.
- **Problem:** These exports have no production caller, so readers have to work out whether they
  matter. `device.ts` describes itself as "provided for future modules". The barrel file adds a
  second import path for one function.
- **Change:** Delete the three code items and their tests as listed. Do not touch `isoWeekdayOf`,
  `isWeekendDate` or `validateWeekendDays`, which are used.
- **Before/after sketch:**
  ```text
  lib/auth/permissions.ts      → deleted
  lib/device.ts                → deleted   tests/unit/device.test.ts → deleted
  weekend.ts: WeekendFrequency, frequencyOf → removed (and their test block)
  ```
- **Acceptance criteria:** `grep -rn "auth/permissions\|lib/device\|parseDeviceType\|isMobileWidth\|frequencyOf\|WeekendFrequency" app lib components tests proxy.ts`
  returns nothing. All checks pass.
- **Verification:** `npx tsc --noEmit && npm run lint && npm run test:unit`. The unit-test count
  should drop by exactly the deleted cases.
- **Risk notes:** `docs/REQUIREMENTS.md` NFR-1 says the app should "detect device (UA + viewport) so
  future modules…". Deleting `device.ts` assumes that no module is about to need it. See **Q6**. If
  the owner wants it kept, drop only that part of this task.

### R-03: One signature/per-diem pre-check for all signing actions

- **Files:**
  - `lib/actions/leave/requests.ts:38-41`, `:112-115`, `:162-169`, `:212-219`. These are four copies
    of the same 4-line signature + delegation-preview check, and two copies of the per-diem check.
  - `lib/actions/leave/approvals.ts:42-48` (signature check + per-diem check again).
  - `lib/actions/clearance.ts:482-487` (`checkSignature`, a private copy) and its uses at `:492-493`
    and `:512-513`.
  - Target: `lib/leave/signature.ts`, which already exports `isValidSignatureData`.
- **Problem:** The same three signature rules (authorized → present → valid) are written out six
  times across three files. The per-diem rule (`null` or a non-negative safe integer) appears three
  times. Adding a rule today means editing every copy, and missing one makes one action accept what
  another refuses.
- **Change:**
  1. In `lib/leave/signature.ts`, add pure functions that return the **raw English message**
     (the strings `dbErr` already maps), or `null`:
     ```ts
     export function signatureProblem(i: { signatureData: string; signatureAuthorized: boolean }): string | null
     export function perDiemProblem(rials: number | null | undefined): string | null
     ```
     Keep the exact message strings and check order: `'signature authorization is required'`,
     `'signature is required'`, `'signature data is invalid'`, `'per diem must be 0 or more'`.
  2. In `requests.ts`, add a **non-exported** helper (a `'use server'` file may only *export* async
     functions):
     ```ts
     function submissionProblem(input: {...; delegationPreview: unknown; perDiemRials?: number | null }): string | null {
       return signatureProblem(input)
         ?? (!input.delegationPreview ? 'delegation preview refresh required' : null)
         ?? perDiemProblem(input.perDiemRials);
     }
     ```
     Use it in all four submit functions as `const bad = submissionProblem(input); if (bad) return dbErr(bad);`.
     Keep each function's later steps (accrual pass, RPC call) unchanged and in the same order.
  3. Replace the copies in `approvals.ts:42-48` with `signatureProblem` and `perDiemProblem`.
  4. Delete `checkSignature` in `clearance.ts` and call `signatureProblem` instead.
- **Before/after sketch:**
  ```ts
  // before (×4)
  if (!input.signatureAuthorized) return dbErr('signature authorization is required');
  if (!input.signatureData) return dbErr('signature is required');
  if (!isValidSignatureData(input.signatureData)) return dbErr('signature data is invalid');
  if (!input.delegationPreview) return dbErr('delegation preview refresh required');
  // after
  const bad = submissionProblem(input);
  if (bad) return dbErr(bad);
  ```
- **Acceptance criteria:** The string `'signature authorization is required'` appears only in
  `lib/leave/signature.ts` and `lib/errors/db-error.ts`. `checkSignature` is gone. The
  submit/approve/sign functions run their checks in the same order as before. Tests pass.
- **Verification:** `npx tsc --noEmit && npm run lint && npm run test:unit && npm run build`. Add
  unit tests for `signatureProblem` and `perDiemProblem` in `tests/unit/` covering each branch. As
  a smoke test, run `npm run test:e2e -- tests/e2e/hourly.spec.ts --workers=1`.
- **Risk notes:** For the hourly and daily-leave paths, `perDiemRials` is absent, so
  `perDiemProblem(undefined)` must return `null`. Errand inputs are typed with `perDiemRials?`. The
  per-diem check used to run *after* the preview check, and the helper keeps that order.

### R-04: One source for work-settings defaults

- **Files:**
  - `lib/leave/workSettings.ts:17-26` (`WORK_SETTINGS_FALLBACK`, the intended single source).
  - `lib/actions/leave/reference.ts:89-100` repeats `[5]`, `[]`, `null`, `8`, `'07:00'`,
    `'15:00'`, `240`.
  - `lib/actions/settings.ts:59-68` repeats the same literals.
  - `app/[locale]/(app)/settings/page.tsx:46-53` repeats them a third time for the
    `data.ok === false` case.
- **Problem:** The fallback constant exists so these values are written once (its own comment
  says so), but three call sites still hard-code them. If a default changes, four places have to
  agree.
- **Change:**
  1. `reference.ts`: `const d = WORK_SETTINGS_FALLBACK;` then `weekendDays: ws?.weekend_days ?? d.weekendDays`,
     and so on for every field. Importing a value from `workSettings.ts` is safe: that file imports
     only a **type** from `reference.ts`, and type imports are erased.
  2. `settings.ts` `getCompanyHolidays`: same substitution for the six shared fields.
  3. `settings/page.tsx`: replace the per-field ternaries with
     `const ws = data.ok ? data : { ...WORK_SETTINGS_FALLBACK, holidays: [], updatedAt: null };`
     and read from `ws`. Keep the local variable names if that keeps the diff small.
- **Before/after sketch:**
  ```ts
  // before
  workStart: ws?.work_start ?? '07:00',
  // after
  workStart: ws?.work_start ?? WORK_SETTINGS_FALLBACK.workStart,
  ```
- **Acceptance criteria:** `grep -rnE "'07:00'|'15:00'|\?\? 240" app lib` matches only
  `lib/leave/workSettings.ts`, plus string literals that are not defaults (check each hit). Checks
  pass.
- **Verification:** `npx tsc --noEmit && npm run lint && npm run test:unit && npm run build`. Then
  `npm run test:e2e -- tests/e2e/settings.spec.ts --workers=1`.
- **Risk notes:** `getCompanyHolidays` returns `Holiday[]` objects, while the fallback's `holidays`
  is `string[]`. Do not spread the fallback's `holidays` into that result.

### R-05: One client-side CSV download helper

- **Files** (the same Blob → `<a download>` → revoke sequence, written six times):
  - `app/[locale]/(app)/settings/HolidayImportDialog.tsx:101-110`
  - `app/[locale]/(app)/manage/reports/ReportsDashboard.tsx:95-103`
  - `app/[locale]/(app)/manage/employees/personal-info/PersonalInfoBulk.tsx:27-36`
  - `app/[locale]/(app)/manage/employees/import/ImportWizard.tsx:160-168`
  - `app/[locale]/(app)/finance/FinanceList.tsx:124-131`
  - `components/CredentialsDownload.tsx:42-50`
  - Shared CSV text builder: `lib/csv/parse.ts:59-63` (`buildCsv`).
- **Problem:** Six copies of browser-download plumbing, two of which also rebuild the same
  `YYYYMMDD` date stamp inline. A fix to how files download (for example, delaying the revoke for
  Safari) would have to be made six times.
- **Change:**
  1. Create `lib/csv/download.ts` (browser-only; no `'use client'` directive is needed in a plain
     module):
     ```ts
     import { buildCsv } from './parse';
     export function downloadCsv(rows: string[][], filename: string): void { /* the existing 7 lines */ }
     export function fileDateStamp(d = new Date()): string { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
     ```
  2. Replace each site with one call. Keep each file name exactly as it is today, and keep
     `FinanceList`'s `safeCell` mapping before the call:
     `downloadCsv([header, ...body].map((r) => r.map(safeCell)), \`bj-finance-${from}-${to}.csv\`)`.
  3. Delete the local `downloadCsv` (`ReportsDashboard`) and `download` (`PersonalInfoBulk`)
     helpers.
- **Before/after sketch:**
  ```ts
  // before (×6)
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); …; URL.revokeObjectURL(url);
  // after
  downloadCsv(rows, `bj-credentials-${fileDateStamp()}.csv`);
  ```
- **Acceptance criteria:** `grep -rn "createObjectURL" app components` returns no CSV sites.
  `lib/signature/process.ts:261` is an image use and stays. File names and contents are unchanged.
- **Verification:** `npx tsc --noEmit && npm run lint && npm run test:unit`. Add a jsdom unit test
  for `downloadCsv` that stubs `URL.createObjectURL` and asserts the anchor's `download` name.
  Also run `npm run test:e2e -- tests/e2e/holiday-import.spec.ts --workers=1`.
- **Risk notes:** `CredentialsDownload` calls `setSaved(true)` after the download. Keep that call
  after the helper.

### R-06: Reuse the locale, number and timezone helpers

- **Files:**
  - `lib/leave/calendarMonth.ts:33-35`: `normalizedLocale` duplicates `appLocale`
    (`lib/i18n/format.ts:1-3`). It is used at `:38` and `:154`.
  - `lib/i18n/format.ts:39, 79, 83, 87`: the literal `'Asia/Tehran'` duplicates `APP_TIME_ZONE`
    (`lib/appDate.ts:12`).
  - Ad-hoc `new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US')` that should be
    `formatNumber(n, locale)` (`lib/i18n/format.ts:5-14`):
    `app/[locale]/(app)/organization/OrgChart.tsx:75`,
    `app/[locale]/(app)/manage/employees/import/ImportPlanPanel.tsx:65`,
    `lib/leave/perDiem.ts:21` (`formatRials`).
  - `i18n/routing.ts:4-5` hard-codes `['fa', 'en']` and `'fa'`, while `lib/i18n/locale.ts:19-24`
    defines `APP_LOCALES` and `DEFAULT_LOCALE` with the comment "must stay in step… a unit test
    asserts it does".
- **Problem:** The same small decisions (which locale tag, which timezone, which locale list) are
  made in several places. The locale list even needs a unit test to keep two copies in sync.
  `lib/i18n/locale.ts` is a pure module with no `next-intl` import, so `routing.ts` can import it.
- **Change:**
  1. `calendarMonth.ts`: delete `normalizedLocale` and import `appLocale` from `@/lib/i18n/format`.
  2. `format.ts`: `import { APP_TIME_ZONE } from '@/lib/appDate'` and replace the four literals.
  3. Replace the three ad-hoc `NumberFormat` calls with `formatNumber(n, locale)`.
  4. `i18n/routing.ts`: `locales: APP_LOCALES, defaultLocale: DEFAULT_LOCALE`. Then remove the
     "must stay in step" comments in `lib/i18n/locale.ts:19,23`, and the
     `describe('locale constants stay in step with i18n/routing')` block at
     `tests/unit/entry-locale.test.ts:13`, which becomes tautological.
- **Before/after sketch:**
  ```ts
  // routing.ts
  import { APP_LOCALES, DEFAULT_LOCALE } from '@/lib/i18n/locale';
  export const routing = defineRouting({ locales: APP_LOCALES, defaultLocale: DEFAULT_LOCALE, … });
  ```
- **Acceptance criteria:** No `normalizedLocale` in `lib/`. `'Asia/Tehran'` appears only in
  `lib/appDate.ts`. No `Intl.NumberFormat(` outside `lib/i18n/format.ts`. Checks and build pass.
- **Verification:** `npx tsc --noEmit && npm run lint && npm run test:unit && npm run build`.
  `tests/unit/i18n-format.test.ts` and `tests/unit/per-diem.test.ts` must still pass unchanged.
- **Risk notes:** `formatNumber` adds `maximumFractionDigits: 2`. That does not change output for
  integers, and all three replaced sites format integers (counts, Rials). `defineRouting` may need
  the tuple type: `APP_LOCALES` is `readonly ['fa','en']`. If `tsc` objects, spread it
  (`[...APP_LOCALES]`) or cast. `proxy.ts` imports `routing` relatively (`./i18n/routing`), and the
  `@/` alias inside `routing.ts` must resolve in middleware. `npm run build` confirms that; if it
  fails, use a relative import. `perDiem.ts` and `format.ts` are on the unmerged per-diem branch
  (rule 5).

### R-07: Name the server-action result type once

- **Files:** `lib/errors/db-error.ts:24` (`DbErrorResult`). The ad-hoc union
  `{ ok: false; error: string }` is written out 75 times across `lib/actions/**/*.ts`
  (`grep -rn "{ ok: false; error: string }" lib app | wc -l` → 75), while `DbErrorResult` is used
  only 21 times.
- **Problem:** Every action declares its failure shape by hand, and those copies are narrower than
  what `dbErr()` returns (they lack `field?`). That forced casts like `submit`'s
  `Promise<{ ok: true } | { ok: false; error: string }>` in
  `app/[locale]/(app)/request/_components/useRequestForm.ts:28`. One alias makes signatures
  shorter and accurate.
- **Change:**
  1. In `db-error.ts`, add
     `export type ActionResult<T extends object = Record<never, never>> = ({ ok: true } & T) | DbErrorResult;`
  2. Mechanically rewrite each `Promise<{ ok: true; …fields } | { ok: false; error: string }>` to
     `Promise<ActionResult<{ …fields }>>`. Also rewrite exported aliases such as
     `SubmitRequestResult`, `CancelRequestResult` (`requests.ts:29-31, 71-73`) and
     `RefreshRouteResult` (`refresh.ts:6-8`). Keep the alias names, so importers don't change.
  3. Do one file per edit and run `npx tsc --noEmit` as you go.
- **Before/after sketch:**
  ```ts
  // before
  ): Promise<{ ok: true; types: LeaveType[] } | { ok: false; error: string }>
  // after
  ): Promise<ActionResult<{ types: LeaveType[] }>>
  ```
- **Acceptance criteria:** `grep -rn "{ ok: false; error: string }" lib app` returns ≤ 2 hits, each
  with a reason, such as a client hook type that is genuinely narrower. No runtime code changed;
  `git diff` shows type-only edits. Checks and build pass.
- **Verification:** `npx tsc --noEmit && npm run lint && npm run test:unit && npm run build`.
- **Risk notes:** This is type-only. Widening a return type to include `field?` is backward
  compatible for callers that read `.error`. `lib/leave/duration.ts:129-133` uses
  `{ ok: false, error: 'notWhole' }` as a *validation* result, not an action result. Leave it alone.

### R-08: One `.env.local` loader for Node scripts

- **Files:** `scripts/seed-demo.mjs:15-26`, `scripts/cleanup-e2e.mjs:16-27`,
  `tests/e2e/global-setup.ts:37-49`. All three copy the same 10-line parser.
- **Problem:** There are three copies of a hand-written env parser. A fix (for example, for
  `export FOO=` lines) has to be made three times.
- **Change:** Create `scripts/load-env.mjs` exporting `loadEnvLocal(path = '.env.local')` with the
  existing body, which never overrides variables already set. Import it from the two scripts. For
  `global-setup.ts`, import it too, but only if Playwright's TypeScript loader accepts the `.mjs`
  import. **[unverified]** Confirm by running
  `npm run test:e2e -- tests/e2e/nav.spec.ts --workers=1`. If it fails, keep that copy and say so in
  the commit message.
- **Before/after sketch:**
  ```js
  import { loadEnvLocal } from './load-env.mjs';
  loadEnvLocal();
  ```
- **Acceptance criteria:** The regex `/^\s*([A-Z0-9_.]+)\s*=\s*(.*)\s*$/i` appears once (or twice,
  if the Playwright import is refused). `npm run cleanup:e2e` still runs.
- **Verification:** `node scripts/cleanup-e2e.mjs` (local stack running; it only deletes `999…`
  e2e users) and `npm run lint`.
- **Risk notes:** Node's built-in `process.loadEnvFile` would remove the module entirely, but its
  quoting and override behavior has not been checked against the current parser. Don't switch to
  it as part of this task.

### R-09: One set of ISO-date and working-day helpers

- **Files:**
  - `addDays`: `lib/leave/calendarMonth.ts:56-60` (exported; returns the input on a bad date) and
    `lib/leave/returnToWork.ts:34-36` (private copy; throws on a bad date).
  - "Is this a working date?": `lib/leave/calendarMonth.ts:74-80`, `lib/leave/returnToWork.ts:38-40`
    (exported), and the inner `isWorkingDay` in `lib/leave/workingDays.ts:42-52`.
  - "Next working day after X": `lib/leave/calendarMonth.ts:82-91` (`nextWorkingDateAfter`, used
    by `buildCalendarMonth` at `:199`) and `lib/leave/returnToWork.ts:42-49` (`nextWorkingDay`).
  - ISO weekday: `lib/leave/calendarMonth.ts:69-72` (`isoWeekday`) duplicates
    `lib/leave/weekend.ts:53-58` (`isoWeekdayOf`).
- **Problem:** Calendar shading and return dates, the request form's return-to-work line, and the
  working-day counter each answer the same date questions with their own code. The calendar's
  "returns on" date and the form's "back at work" date can disagree if one copy is fixed and the
  other is not.
- **Change** (after branch `codex/per-diem-wording` lands, since `returnToWork.ts` is new there):
  1. Move `isWorkingDate(iso, rule: WeekendRule & { holidays: string[] })` into `lib/leave/weekend.ts`
     next to `isWeekendDate`. Import it in `returnToWork.ts`, `calendarMonth.ts` and
     `workingDays.ts`. In `workingDays.ts`, build the date string as today and call
     `isWorkingDate`. Keep the `Set` lookup by passing `holidays` as given; it is a small array.
  2. Keep one `addDays` (the safe one from `calendarMonth.ts`) in a new `lib/leave/isoDate.ts`,
     together with `daysBetween` (`calendarMonth.ts:62-67`). Re-point the imports, including
     `app/[locale]/(app)/clearance/[id]/page.tsx:16`.
  3. Make `nextWorkingDateAfter(iso, ws)` call `nextWorkingDay(iso, ws) ?? addDays(iso, 1)`, or
     inline that into `buildCalendarMonth` and delete `nextWorkingDateAfter` together with its test
     block (`tests/unit/calendarMonth.test.ts:93-105`). Move any unique cases into
     `tests/unit/return-to-work.test.ts`.
  4. Replace `isoWeekday` with `isoWeekdayOf(rangeStart)!`. `rangeStart` always comes from
     `currentCalendarMonthRange` and is valid.
- **Before/after sketch:**
  ```ts
  // weekend.ts
  export function isWorkingDate(iso: string, rule: WeekendRule & { holidays: string[] }) {
    return !isWeekendDate(iso, rule) && !rule.holidays.includes(iso);
  }
  ```
- **Acceptance criteria:** One definition each of `addDays`, `daysBetween`, `isWorkingDate`, the
  next-working-day search and the ISO weekday (`grep -rn "function addDays\|function isWorkingDate\|function isoWeekday" lib`
  → one hit each). All existing date tests pass unchanged, except deleted duplicates whose cases
  were moved.
- **Verification:** `npm run test:unit -- calendarMonth return-to-work workingDays weekend leave`.
  Then `npx tsc --noEmit && npm run lint && npm run build`, and
  `npm run test:e2e -- tests/e2e/calendar.spec.ts --workers=1`.
- **Risk notes:** The two next-day searches stop at different limits: 370 days for the calendar,
  366 for the form. They differ only if a full year has no working day, which
  `validateWeekendDays` already forbids. Keep the calendar's `?? addDays(iso, 1)` fallback so its
  output is identical. `lib/leave/accrual.ts:58-60` has a third `daysBetween`. Leave it alone if
  R-10 is going to delete the file anyway.

### R-10: Retire test-only TypeScript mirrors of SQL rules

**Blocked on Q1.**

- **Files** (code below has no production caller; verified with
  `grep -rlw <name> app lib components`):
  - `lib/leave/approvals.ts:95-112` (`FillableInput`), `:139-199` (`fillableStep`), `:201-228`
    (`ApprovalAction`, `approvalAction`), `:230-236` (`perDiemApplies`), `:250-289`
    (`filterApprovable`). Production uses only `ApprovalStep`, `StepRole`, `SignedStep`,
    `StepLabel`, `ManagerScope`, `stepLabel`, `departmentStepApplies`, `outstandingSteps` and its
    helper `applicableSteps` (`lib/actions/reports.ts:19-23`, `lib/actions/leave/*.ts`). The
    approvals queue now reads `app_request_approval_context` from SQL (the switch came with commit
    `e728c25`).
  - `lib/leave/hourly.ts:35-41` (`isWithinWindow`), `:43-52` (`rangesOverlap`), `:54-75`
    (`LeavePeriod`, `leavePeriodsOverlap`).
  - `lib/leave/accrual.ts` (the whole file, `planAccruals`). Only `tests/unit/accrual.test.ts`
    imports it. Its own header says the SQL `public.accrue_leave` is authoritative.
  - `lib/personal-info/fields.ts:236-238` (`isPersonalInfoComplete`). The real value is the
    database column `complete` (`lib/actions/personal-info.ts:34`).
  - Tests: `tests/unit/approval-chain.test.ts` (describe blocks at `:51, :83, :117, :135, :173,
    :229, :305, :420, :519, :560` exercise the deleted functions; keep `:31`, `:193`, `:497`),
    `tests/unit/hourly.test.ts:48-135`, `tests/unit/accrual.test.ts` (whole file),
    `tests/unit/personal-info.test.ts:4, :100-101`.
- **Problem:** About 300 lines of TypeScript re-implement SQL rules so that unit tests can run
  without a database, but no app code executes them. Each file says it "MUST STAY IN LOCKSTEP" with
  a SQL function. The tests therefore prove that the copy is right, not that production is. Every
  SQL change adds a sync chore that keeps no user-visible behavior safe. The SQL behavior is
  covered by `tests/sql/*.sql` scenario scripts.
- **Change** (only if the owner approves under Q1):
  1. Delete the listed functions and types and their test blocks.
  2. If a deleted test encoded a rule that no `tests/sql/*.sql` scenario covers, which is likely for
     named-person steps (FR-42), department steps (FR-47), order enforcement and admin override
     (FR-58), first add an equivalent psql assertion to a `tests/sql/` file. Follow the existing
     `pg_temp.try_as`/`as_call` pattern in `tests/sql/client-feedback-2026-10-12.sql`.
  3. Update the header comments of `approvals.ts` and `hourly.ts` so they no longer claim to mirror
     the whole SQL function. Update `docs/DATA_MODEL.md:594`, which cites `lib/leave/accrual.ts`.
- **Before/after sketch:**
  ```text
  lib/leave/approvals.ts   289 → ~120 lines (types, stepLabel, departmentStepApplies, applicableSteps, outstandingSteps)
  lib/leave/hourly.ts       89 → ~45 lines  (timeToMinutes, minutesToTime, rangeMinutes, timeSlots)
  lib/leave/accrual.ts     deleted
  ```
- **Acceptance criteria:** `grep -rlw "fillableStep\|approvalAction\|filterApprovable\|perDiemApplies\|isWithinWindow\|rangesOverlap\|leavePeriodsOverlap\|planAccruals\|isPersonalInfoComplete" app lib components tests`
  returns nothing. Every rule removed from unit tests has a named `tests/sql` assertion, listed in
  the commit message. Checks pass.
- **Verification:** `npm run test:unit`. Run the touched SQL scenario inside a rollback, as the
  header of each `tests/sql/*.sql` file describes:
  `docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d postgres -q < tests/sql/<file>.sql`.
  Every line should print PASS.
- **Risk notes:** This lowers unit-test coverage of these rules, so it depends on the SQL suites
  being run. They are not run in CI today, so check `.github/workflows/deploy-liara.yml`. Do not
  start without the owner's answer to Q1.

### R-11: Run every deploy test through `npm run test:deploy`

**Blocked on Q4.**

- **Files:** `package.json:11` (`"test:deploy": "bash tests/deploy/deploy-assistant.test.sh"`) and
  `.github/workflows/deploy-liara.yml:29-31`, which run the other three scripts by hand.
- **Problem:** The npm script and CI disagree about what "the deploy tests" are. A developer who
  runs `npm run test:deploy` skips three of the four suites, and CI repeats the file list.
- **Change:** Set `"test:deploy": "for f in tests/deploy/*.test.sh; do bash \"$f\" || exit 1; done"`,
  then delete the three extra `run:` lines in the workflow.
- **Acceptance criteria:** CI's step list contains `npm run test:deploy` once and no direct
  `tests/deploy/*.sh` calls. Locally, `npm run test:deploy` runs all four suites.
- **Verification:** Run `npm run test:deploy` locally with Docker running. All four suites print
  `ok`/pass.
- **Risk notes:** `client-ip-runtime.test.sh` starts Docker containers and the two compose tests
  need the Compose CLI, so the npm script would then require Docker on every developer machine.
  That trade-off is Q4.

### R-12: Replace server-built `labels` props with `useTranslations`

- **Files:** `page.tsx` files that build label objects line by line (count of `key: t…(…)` lines):
  `settings/page.tsx` 61 · `manage/reports/page.tsx` 50 · `request/page.tsx` 49 ·
  `manage/approval-steps/page.tsx` 47 · `home/page.tsx` 37 · `manage/employees/[id]/page.tsx` 32 ·
  `manage/employees/new/page.tsx` 31 · `manage/employees/import/page.tsx` 31 ·
  `manage/departments/page.tsx` 28 · `manage/approvals/page.tsx` 27 · `request/hourly/page.tsx` 26 ·
  `manage/employees/page.tsx` 22 · `manage/requests/page.tsx` 21 · `(app)/layout.tsx` 20 ·
  `profile/page.tsx` 19 · `request/errand/page.tsx` 18 · `calendar/page.tsx` 17 ·
  `request/daily-errand/page.tsx` 16 · `manage/departments/new/page.tsx` 15 ·
  `organization/page.tsx` 10. Total ≈ 590 lines, all under `app/[locale]/(app)/`. There are also
  matching `type Labels = {…}` blocks in each client component, plus the builders
  `lib/leave/durationLabels.ts` and `lib/leave/signatureLabels.ts`.
- **Problem:** `app/[locale]/layout.tsx:56-70` already sends the **entire** message catalog to the
  browser, so translating on the server and passing strings down saves nothing. It also triples the
  code: a translation call, a prop-type line and a prop read for every string. Placeholder messages
  need workarounds. The pages pass `t.raw()` (`settings/page.tsx:92-148`,
  `manage/approval-steps/page.tsx:75`, `manage/reports/page.tsx:125`, `organization/page.tsx:46-48`),
  and the components re-implement ICU interpolation by hand (`OrgChart.tsx:56`,
  `ImportPlanPanel.tsx:60` `fill()`). About 40 client components already call `useTranslations`,
  so the codebase solves the same problem in two ways.
- **Change** (incremental: **one screen per commit**, smallest first):
  1. Pick a `'use client'` component that receives `labels`. Replace each `labels.x` with `t('x')`
     from `useTranslations('<namespace>')`, using the namespace the page used.
  2. Delete the `Labels` type and the `labels` prop. Delete the page's label-building block.
  3. For `.raw()` + `fill()` pairs, call `t('key', { count })` directly and delete `fill()`.
     Persian digits need `{count, number}` in the message, so check the existing message text first.
  4. Leave alone Server Components that render text themselves, such as the print pages under
     `app/[locale]/(print)`. Conversion applies only where the consumer is a client component.
  5. Once nothing uses `durationLabelsFrom` or `signatureLabelsFrom`, delete those two files. Let
     `formatDuration` accept a translator, or keep its `DurationLabels` argument built in the client
     with `useTranslations('leave')`.
  6. Update unit tests that render these components with `labels=` (34 occurrences in
     `tests/unit`). Wrap them in `NextIntlClientProvider` with the real messages, as
     `tests/unit/my-requests-list.test.tsx` already does.
- **Before/after sketch:**
  ```tsx
  // page.tsx — before
  const labels = { date: tErrand('date'), fromTime: tErrand('fromTime'), … };
  return <ErrandRequestForm labels={labels} … />;
  // ErrandRequestForm.tsx — after
  const t = useTranslations('errand');
  <Label>{t('date')}</Label>
  ```
- **Acceptance criteria (per screen):** The page has no `labels` object, and the client component
  has no `labels` prop. The rendered text is identical in `fa` and `en`: compare `get_page_text` or
  a Playwright snapshot before and after. Unit tests for that component pass under
  `NextIntlClientProvider`. **Overall:** `grep -rn "\.raw(" app` returns only structured-object
  reads (`RoleEditor.tsx:105-111`), and `durationLabels.ts`/`signatureLabels.ts` are deleted.
- **Verification:** After each screen, run `npx tsc --noEmit && npm run lint && npm run test:unit && npm run build`
  and the e2e spec for that screen (for example `tests/e2e/settings.spec.ts`,
  `tests/e2e/hourly.spec.ts`).
- **Risk notes:** ICU messages with `{placeholders}` must be called with their values, or `dev`
  renders `FORMATTING_ERROR` while `build` stays green (`docs/MEMORY.md`, "Translate an ICU message
  where its variables live"). Test the rendered output of every placeholder message. Server-side
  date or time strings computed in pages (for example `formatCalendarDate`) are values, not labels,
  so keep passing them. Do the `request/**` screens last, after the per-diem branch merges.

## 4. Out of scope / deferred

- **On-prem deploy code** (`deploy/release.sh`, `setup-release.sh`, `package.sh`,
  `docker-compose.client-amd64.yml`, the `bj-deploy client` target): the owner keeps it in case the
  app moves back on-site (`docs/TASKS.md:189`).
- **`updateDepartmentCode`** (`lib/actions/departments.ts`) and the skipped
  `tests/e2e/department.spec.ts:25`: test-only, but the owner said on 2026-10-04 to keep them
  (`docs/TASKS.md:197`).
- **`supabase` CLI devDependency:** unused on this network, but kept deliberately for machines that
  can reach the registry (`docs/MEMORY.md`, "`supabase gen types` needs a container image…").
- **A page-level `requirePageUser()` guard:** 19 pages repeat `getCachedUser()` + redirect, but
  layouts already guard and pages need the id. This was considered and rejected on 2026-10-04.
- **Unifying the person pickers** (`components/PersonSearch.tsx` client-side,
  `AddApprovalStepDialog.tsx:98-115` debounced server search, `DelegationPanel.tsx:95` search
  button): they use different data sources with server-side RLS filtering, so merging them changes
  UX.
- **Splitting large components** (`EditEmployeeForm.tsx` 614 lines, `ImportWizard.tsx` 576,
  `CalendarView.tsx` 533, `HomeBoard.tsx` 469): no clean seam beyond what R-12 removes. Revisit
  after R-12.
- **Symbols exported but used only in their own file** (`ApproveExtras`, `PolicyLabels`,
  `policyFieldName`, `ReplacementLabels`, `RequestTypeKey`, `ROLE_NAME_RE`): linter-level noise.
- **`fullPerms`** (`lib/permissions/catalog.ts:176-178`): only tests use it, as a fixture. It is
  harmless.
- **Unused generic helpers in `lib/supabase/types.ts`** (`Tables`, `TablesInsert`, `Constants`, …):
  generator boilerplate. Keep it so a future regeneration diffs cleanly.
- **Shared ISO-date regex:** `/^\d{4}-\d{2}-\d{2}$/` appears in `clearance.ts:30`,
  `employees.ts:254`, `finance/page.tsx:29`, `manage/reports/page.tsx:30`. Replacing it with
  `isValidIsoDate` would reject dates like `2026-02-30` that the code accepts today, which is a
  behavior change.
- **`proxy.ts:105` matcher** still excludes `trpc|_vercel` (no tRPC; Vercel retired). This is
  harmless config.
- **Request-form internals** (`app/[locale]/(app)/request/**`): already deduplicated through
  `FormParts.tsx` and `useRequestForm.ts`, and being edited on the open branch.

## 5. Open questions for the owner

- **Q1 → R-10.** Should the TypeScript copies of SQL rules (approval chain, hourly overlap, monthly
  accrual, personal-info "complete") be deleted, relying on `tests/sql/*.sql` instead? Those SQL
  scenarios are not run in CI today. Approving R-10 means either accepting that or also adding a CI
  job with a Postgres service.
- **Q2 (no task yet).** "Who is an approver" is decided four ways. `lib/nav/tabs.ts:58` uses
  admin | manager | hr. `app/[locale]/(app)/calendar/page.tsx:40` uses admin | manager.
  `lib/home/board.ts:51` uses admin | manager | hr. The live RPC `getApprovalCapabilities()`
  (`lib/auth/approval-capabilities.ts`) is a fourth. Should all of them use the RPC? That would
  change who sees what, so it is not a refactor until you decide.
- **Q3 (related to R-05).** Only the finance export protects cells against spreadsheet formula
  injection (`FinanceList.tsx:35-40` `safeCell`). The reports, personal-info and credentials exports
  write user-entered text raw. Should `downloadCsv` apply `safeCell` everywhere? That is a
  behavior change, so it is kept out of R-05.
- **Q4 → R-11.** May `npm run test:deploy` require Docker on developer machines, so that it runs
  the same four suites as CI?
- **Q5 (no task).** `tests/unit/personnel-clean-csv.test.ts` validates
  `docs/files/Personnel_CLEAN.csv`, which `docs/TASKS.md` says to delete after the roster import.
  Should the test be deleted together with the file?
- **Q6 → R-02.** Can `lib/device.ts` (UA/viewport detection "for future modules", NFR-1) be
  deleted now? It can be restored from git if a module needs it.
