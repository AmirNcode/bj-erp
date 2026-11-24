# UI readability and desktop layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No field triggers the iPhone zoom; each person picks a saved text size (Profile › Preferences); tabbed and form pages share one centred 1280px column with annotated form sections.

**Architecture:** One unlayered coarse-pointer CSS rule keeps fields ≥ 16px. Tailwind v4 text tokens become `calc(base * var(--font-scale))`; `--font-scale` derives in CSS from `--font-step` (set per person by the `(app)` layout from `profiles.font_step`) and `<html lang>` (Farsi +1 step). `AppShell` caps every page at 1280px; a new `FormSection` component lays settings forms out as title/description beside a fields card.

**Tech Stack:** Next.js 16.4.6 App Router, React 19, Tailwind CSS v4, Supabase (Postgres + PostgREST), next-intl, Vitest 4, Playwright.

**Spec:** `docs/specs/2026-11-23-ui-readability-layout-design.md`

**Worktree:** `/Users/amir/Workspace/bj-ui-readability`, branch `claude/ui-readability-layout` (from `origin/main` 1ca84ef). Before Task 1: `cp -Rc ../bj/node_modules node_modules` (symlinks break `next build`), then `npm install`.

## Global Constraints

- Owner rule: **no input, select, textarea or date field may trigger the iPhone zoom** (computed font-size ≥ 16px on touch screens). Never add `maximum-scale` or `user-scalable=no`.
- Text size: 5 steps (`0..4`), labels `100% · 110% · 120% · 130% · 140%` for everyone. Multipliers: English `1.00 1.10 1.20 1.30 1.40`; Farsi `1.10 1.20 1.30 1.40 1.50`. Only text scales: not spacing, icons, button heights, sidebar width.
- `profiles.font_step smallint not null default 0`, CHECK `0..4`; one step per person; only the person themself (or the admin) changes it.
- View as keeps the admin's own text size (read with `createRealClient()`). Print routes never scale.
- Page column max **1280px** (`max-w-7xl`); annotated sections go two-column at **1024px** (`lg`). `data-wide` only on: Employees list, Sales records list, Finance.
- Desktop field widths: time 9rem `w-36`, number 8rem `w-32`, date 12rem `w-48`, day+hour 18rem `w-72`, short select 14rem `w-56`, name/person/job title 20rem `w-80`, notes up to 36rem `max-w-xl`. Phones: full width.
- Profile tabs: **Profile · Personal info · Preferences · Account security** (`/profile`, `/profile/personal-info`, `/profile/preferences`, `/profile/security`); `/profile/account` redirects to `/profile/preferences`.
- Every user-facing string in `messages/fa.json` + `messages/en.json` (`messages-parity` test). Logical properties only (RTL). Blueprint rules from `docs/DESIGN.md` (no `shadow-*`, tabs from `lib/ui/tabs.ts`, `data-table` on tables).
- Migrations: new file only; dry-run on a clone first (CLAUDE.md "Dry-run migrations first"); patch `supabase/schema.sql` by diffing clone dumps; hand-edit `lib/supabase/types.ts`.
- Verify Tailwind v4 `@theme` behaviour against current docs (Context7) before Task 2's CSS — no training-data API details.
- **Commit steps run only after the owner says to commit (CLAUDE.md "Commit only when user asks"). Never push to `main`.**

## Review Focus

1. **Farsi at 140% (×1.50) on a 375px phone** — bottom tab bar, tab strips, status badges and table headers wrap or truncate; the page never scrolls sideways. Test: Task 10 e2e `no horizontal overflow at fa step 4`.
2. **View as** — the admin keeps their own size, never the viewed person's, and cannot save a size while viewing. Tests: Task 5 `getOwnFontStep uses the real client`, Task 7 `save disabled under View as`.
3. **Language switch after saving** — switching fa↔en changes the multiplier with no re-save, and the slider label stays the same. Test: Task 2 `fontScale` table cases.
4. **Profile read fails or column missing** (old app during deploy, broken session) — the app renders at step 0, never crashes. Test: Task 5 `getOwnFontStep returns 0 on error / out-of-range`.
5. **Landscape iPhone / iPad** (≥ 768px wide, where `md:text-sm` kicks in) — fields still ≥ 16px. Test: Task 1 e2e landscape case.

---

### Task 1: No iPhone zoom on fields

**Files:**
- Modify: `app/globals.css` (new unlayered block after the native `select` chevron rules)
- Create: `tests/unit/touch-field-size.test.ts`
- Create: `tests/e2e/touch-fields.spec.ts`
- Modify: `docs/DESIGN.md` (forms section), `CLAUDE.md` (Gotchas: one line)

**Interfaces:**
- Produces: CSS rule `@media (pointer: coarse) { input:not([type=checkbox],[type=radio],[type=range],[type=file],[type=color],[type=hidden]), select, textarea { font-size: max(16px, var(--text-base)); } }` — unlayered.

- [ ] **Step 1: Write the failing unit test** — `touch-field-size.test.ts` reads `app/globals.css` as text and asserts:
  - it contains `@media (pointer: coarse)` with a rule whose selector list includes `input`, `select`, `textarea` and whose declaration is `font-size: max(16px, var(--text-base))`;
  - that rule is not inside any `@layer` block;
  - `app/[locale]/layout.tsx` contains neither `maximumScale` nor `userScalable`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/touch-field-size.test.ts` → FAIL (rule missing).
- [ ] **Step 3: Add the rule** to `app/globals.css` with a comment citing the owner rule.
- [ ] **Step 4: Run** the unit test → PASS.
- [ ] **Step 5: Write the e2e** `touch-fields.spec.ts` with `test.use({ hasTouch: true, isMobile: true })` in two describes: portrait `{ width: 390, height: 844 }` and landscape `{ width: 932, height: 430 }`. First assert `matchMedia('(pointer: coarse)').matches === true` (fail loudly if the emulation does not set it). Then, for each of: login code field (`/login`), Employees search (`/manage/employees`, signed in as admin), a native select on Settings › Working times, a `PersianDateField` input on `/request` — assert `parseFloat(getComputedStyle(el).fontSize) >= 16`. Use the spec's existing login helper.
- [ ] **Step 6: Run** `npx playwright test tests/e2e/touch-fields.spec.ts --workers=1` against the local stack → PASS.
- [ ] **Step 7: Docs** — DESIGN.md forms rule: "Fields are never under 16px on touch screens; the global rule in `globals.css` handles it; never add `maximum-scale`." CLAUDE.md gotcha line with the same meaning.
- [ ] **Step 8: Commit** `feat(ui): keep form fields at 16px on touch screens (no iPhone zoom)`.

### Task 2: Scaled text tokens

**Files:**
- Create: `lib/prefs/fontScale.ts`
- Modify: `app/globals.css` (`@theme` text tokens, `:root`/`html[lang=fa]` scale rules, `.font-scale-scope`, hand-written `rem` font sizes)
- Modify: `app/[locale]/(print)/layout.tsx`
- Test: `tests/unit/font-scale.test.ts`, `tests/unit/font-tokens.test.ts`

**Interfaces:**
- Produces (`lib/prefs/fontScale.ts`, no server imports):
  - `export const FONT_STEPS = [0, 1, 2, 3, 4] as const; export type FontStep = (typeof FONT_STEPS)[number];`
  - `export function isFontStep(v: unknown): v is FontStep`
  - `export function fontScale(step: FontStep, locale: 'fa' | 'en'): number` — `1 + 0.1 * (step + (locale === 'fa' ? 1 : 0))`, rounded to 2 decimals.
  - `export function fontStepLabel(step: FontStep): string` — `'100%' … '140%'` (no locale bonus).
- Produces (CSS): `html { --font-step: 0; --font-scale: calc(1 + 0.1 * var(--font-step)); }`, `html[lang='fa'] { --font-scale: calc(1.1 + 0.1 * var(--font-step)); }`; every `--text-*` token = `calc(<base rem> * var(--font-scale, 1))`; new tokens `--text-10` (0.625rem), `--text-11` (0.6875rem), `--text-13` (0.8125rem), `--text-15` (0.9375rem), scaled the same way, with line-height ratios; class `.font-scale-scope` re-declares every scaled token with the same formula (so a local `--font-scale` on that element re-scales its subtree — used by Task 7's preview).

- [ ] **Step 1: Failing tests.**
  - `font-scale.test.ts`: `fontScale(0,'en')===1`, `fontScale(4,'en')===1.4`, `fontScale(0,'fa')===1.1`, `fontScale(4,'fa')===1.5`; `fontStepLabel(0)==='100%'`, `fontStepLabel(4)==='140%'`; `isFontStep(5)===false`, `isFontStep(2.5)===false`, `isFontStep('2')===false`, `isFontStep(3)===true`.
  - `font-tokens.test.ts` (reads `globals.css`): each of `xs sm base lg xl 2xl 3xl 4xl 10 11 13 15` has `--text-<name>:` with `var(--font-scale` in `@theme`; the same names appear in `.font-scale-scope` with identical values; `html[lang='fa']` rule sets `--font-scale` from `1.1`; no `font-size:` in `globals.css` uses a bare `rem`/`px` value without `var(--font-scale` except the Task 1 `max(16px, …)` rule and print blocks.
- [ ] **Step 2: Run** both → FAIL.
- [ ] **Step 3: Implement** `lib/prefs/fontScale.ts` and the CSS (check Tailwind v4 docs for redefining `--text-*` with `var()` in `@theme`; utilities must reference `var(--text-*)`, not inlined values — do not use `@theme inline` for these). Multiply hand-written `rem` font sizes (`.data-table`, `.help-guide`, badges …) by `var(--font-scale, 1)`. Print layout: `<style>{':root:root:root{--font-scale:1}'}</style>`.
- [ ] **Step 4: Run** both tests + `npm run build` → PASS / build OK. Open any page in the dev server and confirm in devtools that `text-sm` computes to 14px (en) and 15.4px (fa) at step 0.
- [ ] **Step 5: Commit** `feat(ui): scale text tokens by --font-scale (Farsi +1 step)`.

### Task 3: Move hard-coded pixel font sizes onto tokens

**Files:**
- Modify: every file in `app/` and `components/` with `text-[Npx]` (87 uses; `grep -rhoE "text-\[[0-9.]+px\]" app components`)
- Create: `tests/unit/no-px-font-sizes.test.ts`

**Interfaces:**
- Consumes: Task 2 tokens `text-10 text-11 text-13 text-15`.
- Mapping (fixed): `9px, 10px → text-10` · `11px, 11.5px → text-11` · `12px, 12.5px → text-xs` · `13px, 13.5px → text-13` · `15px → text-15` · `17px → text-lg`. Any other size: nearest token, note it in the commit message.

- [ ] **Step 1: Failing guard test** — walk `app/**/*.tsx` and `components/**/*.tsx` (skip `app/[locale]/(print)/**` and `components/CredentialsDownload.tsx`); fail listing file:line for any `text-\[\d[^\]]*(px|rem|em)\]` and any inline `fontSize:` style with a literal length.
- [ ] **Step 2: Run** → FAIL with ~87 hits.
- [ ] **Step 3: Replace** per the mapping.
- [ ] **Step 4: Run** guard + `npx vitest run` + `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `refactor(ui): move pixel font sizes onto scaled tokens`.

### Task 4: `profiles.font_step` column

**Files:**
- Create: `supabase/migrations/20261123140000_profile_font_step.sql`
- Modify: `supabase/schema.sql` (patch hunks only), `lib/supabase/types.ts` (`profiles` Row/Insert/Update)
- Create: `tests/sql/profile-font-step.sql` (header + helpers copied from `tests/sql/absence-watchers.sql`)
- Modify: `docs/DATA_MODEL.md` (profiles columns), `docs/PERMISSIONS.md` (own-profile fields)

**Interfaces:**
- Produces: column `public.profiles.font_step smallint not null default 0` with constraint `profiles_font_step_range check (font_step between 0 and 4)`; `private.enforce_profile_update_scope()` redefined with `'font_step'` in the own-row `v_allowed` array and a check line `or (new.font_step is distinct from old.font_step and not ('font_step' = any (v_allowed)))`. Everything else in the function body stays identical to `schema.sql` line 1774ff.

- [ ] **Step 1: Write the SQL test** — fixtures: employee `e1`, employee `e2`, a people-edit holder `p`, admin `a` (same company). Assertions, one statement each:
  - `e1` updates own `font_step` to 3 → succeeds; value reads back 3.
  - `e1` sets own to 5 → `ERROR 23514`.
  - `p` sets `e2.font_step` → `ERROR 42501`.
  - `e1` sets `e2.font_step` → error (RLS: 0 rows or 42501 — assert value unchanged).
  - `a` sets `e2.font_step` to 1 → succeeds.
  - `e1` updating own `language_pref` still succeeds (regression).
- [ ] **Step 2: Clone + apply + run** per CLAUDE.md "Dry-run migrations first" (clone db `postgres` in `bj-erp-db-1` into `fontstep_x`, run the test against the clone *before* the migration → FAIL on missing column; apply migration; run again → PASS; run the existing `tests/sql/*` that touch profiles (`grep -l profiles tests/sql/*`) → PASS; `drop database fontstep_x`).
- [ ] **Step 3: Patch `schema.sql`** from a before/after dump diff of the clone (only the column, constraint and function hunks); edit `types.ts`; `npx tsc --noEmit` → OK.
- [ ] **Step 4: Docs** DATA_MODEL + PERMISSIONS lines.
- [ ] **Step 5: Commit** `feat(db): profiles.font_step (own text size, 0..4)`.

### Task 5: Apply the saved step

**Files:**
- Create: `lib/prefs/fontStep.server.ts`
- Create: `app/[locale]/(app)/_components/FontStepStyle.tsx`
- Modify: `app/[locale]/(app)/layout.tsx` (render `<FontStepStyle>` first inside the shell)
- Modify: `lib/actions/profile.ts` (`updateMyPrefs` accepts `fontStep`)
- Test: `tests/unit/font-step-server.test.ts`, `tests/unit/update-my-prefs.test.ts`

**Interfaces:**
- Consumes: `FontStep`, `isFontStep` (Task 2); column (Task 4).
- Produces:
  - `export async function getOwnFontStep(): Promise<FontStep>` — `createRealClient()` → `auth.getUser()` → `profiles.select('font_step').eq('id', uid).single()`; returns `0` on no user, any error, or a value failing `isFontStep`. Wrapped in React `cache`.
  - `export function FontStepStyle({ step }: { step: FontStep })` — renders `<style>{`:root:root{--font-step:${step}}`}</style>` (step is a validated integer; nothing else interpolated).
  - `updateMyPrefs(input: { languagePref?: 'fa' | 'en'; fontStep?: FontStep })` — adds `font_step` to the patch when `isFontStep(input.fontStep)`; an invalid `fontStep` alone returns the existing `'not permitted to update these fields'` error. Under View as it must not write (the read-only transaction fails `25006`; map it to the existing `dbErr`, no special case needed — assert it).

- [ ] **Step 1: Failing tests** (mock `@/lib/supabase/server` as other `*_action.test.ts` files do):
  - `getOwnFontStep uses the real client` — `createRealClient` called, `createClient` not.
  - `getOwnFontStep returns 0 on error / out-of-range` — error result → 0; `font_step: 7` → 0; `null` user → 0; `font_step: 2` → 2.
  - `FontStepStyle` renders exactly `:root:root{--font-step:3}` for step 3.
  - `updateMyPrefs({ fontStep: 2 })` sends `{ font_step: 2 }`; `{ fontStep: 9 as never }` returns the error and does not call `update`; `{ languagePref: 'en', fontStep: 1 }` sends both and sets the locale cookie.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests + `npm run build` → PASS. Manually: set `font_step=4` for the local test account (via the Preferences UI once Task 7 lands, or `updateMyPrefs` in a scratch route), reload `/fa/home`: `text-sm` computes 21px; `/fa/login` (signed out) computes 15.4px.
- [ ] **Step 5: Commit** `feat(prefs): apply each person's saved text size`.

### Task 6: Profile tabs — Preferences and Account security

**Files:**
- Modify: `app/[locale]/(app)/profile/_components/ProfileTabs.tsx` (tab keys `profile`, `personalInfo`, `preferences`, `security`; hrefs `''`, `/personal-info`, `/preferences`, `/security`)
- Create: `app/[locale]/(app)/profile/preferences/page.tsx` (Language card without a card title — label "Language" stays — then the Text size slot, filled in Task 7)
- Create: `app/[locale]/(app)/profile/security/page.tsx` (Change password card, then `LogoutButton`)
- Replace: `app/[locale]/(app)/profile/account/page.tsx` → `redirect(`/${locale}/profile/preferences`)` (relative path rule from CLAUDE.md applies to route handlers only; a page `redirect()` is fine)
- Modify: `messages/fa.json`, `messages/en.json` (`profile.tabs.preferences` = "Preferences" / «ترجیحات», `profile.tabs.security` = "Account security" / «امنیت حساب»; remove `profile.tabs.account` and the unused `profile.preferences` title if nothing else reads it)
- Modify: e2e `tests/e2e/settings.spec.ts` (4×), `password.spec.ts`, `view-as.spec.ts` — language tests go to `/profile/preferences`, password tests to `/profile/security`
- Test: `tests/unit/profile-tabs.test.tsx`

- [ ] **Step 1: Failing test** — `profile-tabs.test.tsx` renders `ProfileTabs` (mock `usePathname`) and asserts four links in order with hrefs `/fa/profile`, `/fa/profile/personal-info`, `/fa/profile/preferences`, `/fa/profile/security`; on pathname `/profile/security` (Farsi: no locale prefix, CLAUDE.md) the security tab is active.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** tabs, pages, redirect, messages, e2e path updates.
- [ ] **Step 4: Run** unit + `messages-parity` + `npx tsc --noEmit` → PASS; `npx playwright test tests/e2e/settings.spec.ts tests/e2e/password.spec.ts --workers=1` → PASS.
- [ ] **Step 5: Commit** `feat(profile): Preferences and Account security tabs`.

### Task 7: Text size control

**Files:**
- Create: `components/profile/TextSizeControl.tsx` (`'use client'`)
- Modify: `app/[locale]/(app)/profile/preferences/page.tsx` (render it with `initialStep={await getOwnFontStep()}`)
- Modify: `messages/fa.json`, `messages/en.json` (`profile.textSize.{title,description,sampleTitle,sampleLine1,sampleLine2,save,saved,viewAsDisabled}`)
- Test: `tests/unit/text-size-control.test.tsx`

**Interfaces:**
- Consumes: `FONT_STEPS`, `fontScale`, `fontStepLabel` (Task 2); `.font-scale-scope` (Task 2); `updateMyPrefs` (Task 5); `useViewAs()`.
- Produces: `export function TextSizeControl({ initialStep, locale }: { initialStep: FontStep; locale: 'fa' | 'en' })`.
- Behaviour: native `<input type="range" min=0 max=4 step=1>` with a stop label row (`fontStepLabel`), `aria-valuetext` = the label; sample block = `div.font-scale-scope` with inline `--font-scale: fontScale(step, locale)` holding a heading (`text-base font-semibold`), two lines (`text-sm`, `text-xs text-muted-foreground`) in the current language — a leave request summary and a balance line; **Save** button (`disabled` when `step === initialStep`, while pending, or under View as with the `viewAsDisabled` hint) → `updateMyPrefs({ fontStep: step })` → on ok `router.refresh()` and show `saved`; on error show the `dbErr` message.

- [ ] **Step 1: Failing tests** (Testing Library, mock `updateMyPrefs`, `useRouter`, `useViewAs`):
  - moving the slider to 2 sets the sample's `--font-scale` to `1.3` (fa) / `1.2` (en), and `document.documentElement.style` is untouched;
  - label text shows `120%` at step 2 in both locales;
  - Save is disabled at `initialStep`, enabled after a change; click → `updateMyPrefs` called with `{ fontStep: 2 }` and `router.refresh` called;
  - `save disabled under View as` — `useViewAs` returns a view → Save disabled, hint shown.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the component, messages, and wire it into the Preferences page under the Language card.
- [ ] **Step 4: Run** tests + `messages-parity` → PASS. Browser check (dev server on the local stack, test account from `.env.test-accounts`): `/fa/profile/preferences`, move to 140%, sample grows, rest of page doesn't; Save → whole app grows; screenshot at 375px and 1920px.
- [ ] **Step 5: Commit** `feat(profile): text size slider with live sample`.

### Task 8: Page frame and `FormSection`

**Files:**
- Modify: `app/[locale]/(app)/_components/AppShell.tsx:67` (`max-w-6xl` → `max-w-7xl`; keep `has-[[data-wide]]:max-w-none`; update the doc comment)
- Remove `data-wide` and page-level width caps (`max-w-[900px]`, `max-w-[1000px]`, `max-w-5xl`, `mx-auto`) from: `settings/page.tsx`, `settings/roles/page.tsx`, `settings/roles/new/page.tsx`, `settings/roles/[id]/page.tsx`, `profile/layout.tsx`, `admin/layout.tsx`, `manage/employees/[id]/page.tsx`
- Move `data-wide` in Sales from `sales/layout.tsx` to the records list page `sales/page.tsx` only; remove it from `sales/_components/NameMatching.tsx`
- Keep `data-wide`: `manage/employees/page.tsx`, `finance/page.tsx`
- Create: `components/FormSection.tsx`, `lib/ui/fieldWidths.ts`
- Modify: `docs/DESIGN.md` (replace the "Use the full shell width … `data-wide`" paragraph with the frame, annotated section and field-width rules + the no-`text-[Npx]` rule), `CLAUDE.md` (update the "Full-width page = `data-wide`" gotcha: "only Employees list, Sales records list, Finance")
- Test: `tests/unit/form-section.test.tsx`, `tests/unit/page-width.test.ts`

**Interfaces:**
- Produces:
  - `export function FormSection({ title, description, children, className, id }: { title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string; id?: string })` — root `section` with `grid gap-4 py-6 border-b last:border-b-0 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-10`; start column `h2.text-base font-semibold` + `p.text-sm text-muted-foreground`; end column = `children` (callers pass a `Card`).
  - `export const FIELD_W = { time: 'w-full md:w-36', number: 'w-full md:w-32', date: 'w-full md:w-48', dayHour: 'w-full md:w-72', shortSelect: 'w-full md:w-56', name: 'w-full md:w-80', notes: 'w-full md:max-w-xl' } as const;` in `lib/ui/fieldWidths.ts`.
  - A form's Save bar: `div.flex.items-center.justify-end.gap-3.pt-4` placed after the last `FormSection`, inside the end column on `lg` (`lg:ms-[calc(20rem+2.5rem)]`).

- [ ] **Step 1: Failing tests.**
  - `form-section.test.tsx`: renders title as heading, description, children; root has `lg:grid-cols-[20rem_minmax(0,1fr)]`; no description → no empty `p`.
  - `page-width.test.ts` (source scan): `data-wide` appears only in `manage/employees/page.tsx`, `finance/page.tsx` and `sales/page.tsx` (plus the `has-[[data-wide]]` selector in `AppShell.tsx`); `AppShell.tsx` main has `max-w-7xl`; none of the files listed above contains `max-w-[900px]`, `max-w-[1000px]` or `max-w-5xl`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** shell change, `data-wide` moves, `FormSection`, `FIELD_W`, docs.
- [ ] **Step 4: Run** tests + `npx tsc --noEmit` → PASS. Browser at 1920px: Settings, Admin, Profile, Edit Employee have the tab line exactly as wide as the content; Employees list and Finance still edge to edge.
- [ ] **Step 5: Commit** `feat(ui): one 1280px page column and FormSection`.

### Task 9: Convert settings-style forms to annotated sections

**Files (one commit per group; each group ends with its e2e spec passing):**
- Group A — Settings: `settings/WorkSettingsForm.tsx` (sections "Weekly days off", "Working hours and hourly leave"; Save bar keeps "Last saved"), `settings/roles/_components/DelegationPanel.tsx` (+ the CEO/Head of HR panel), `settings/roles/_components/RoleEditor.tsx`, `settings/HolidayEditor.tsx` (column width only, add-row fields get `FIELD_W.date` / `FIELD_W.name`). e2e: `admin-settings.spec.ts`, `holiday-import.spec.ts`, `hr-role.spec.ts`.
- Group B — Admin + approvals: `admin/sms/page.tsx` settings form, `admin/system/page.tsx`, `manage/approval-steps/**` form. e2e: the specs that open these pages (`grep -l "admin/sms\|admin/system\|approval-steps" tests/e2e`).
- Group C — People: `manage/employees/[id]/EditEmployeeForm.tsx` (all three tabs), `components/personal-info/PersonalInfoForm.tsx`, `profile/preferences/page.tsx`, `profile/security/page.tsx`. e2e: employee edit + `settings.spec.ts` + `password.spec.ts`.

**Interfaces:**
- Consumes: `FormSection`, `FIELD_W` (Task 8). Section titles and descriptions reuse each card's existing title/description strings; no new copy unless a card has no description (then omit it).

- [ ] **Step 1 (per group): Snapshot behaviour** — run the group's e2e specs before changing anything → PASS (baseline).
- [ ] **Step 2: Convert** each card to `FormSection` + `Card`; every field gets its `FIELD_W` entry; remove ad-hoc `w-40`/`max-w-*` field widths and any `text-[…]` leftovers. Keep all `data-testid`s.
- [ ] **Step 3: Run** the group's e2e + `npx vitest run` + `npx tsc --noEmit` → PASS.
- [ ] **Step 4: Browser check** at 1920px (en + fa) and 375px; screenshot each page for the AGENT-LOG entry.
- [ ] **Step 5: Commit** `feat(ui): annotated sections — <group>`.

### Task 10: Whole-branch verification and docs

**Files:**
- Create: `tests/e2e/text-size-overflow.spec.ts`
- Modify: `docs/AGENT-LOG.md`, `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/REQUIREMENTS.md` (next free FR number after FR-96 — confirm none was taken by annual-leave borrowing)

- [ ] **Step 1: Write the e2e** `no horizontal overflow at fa step 4` — local test account, set step 4 through `/fa/profile/preferences`, viewport 375×812 with touch; for `/fa/home`, `/fa/request`, `/fa/profile`, `/fa/manage/employees`, `/fa/settings`: `document.documentElement.scrollWidth <= innerWidth`. Reset the step to 0 in `afterAll`.
- [ ] **Step 2: Run it** → PASS (fix overflow by wrapping/truncation where it fails, then re-run).
- [ ] **Step 3: Full gates** — `npm run lint`, `npm run test:unit`, `npx tsc --noEmit`, `npm run build`, `npm audit --omit=dev` (via `scripts/audit-gate.mjs`), e2e specs touched in Tasks 1–9 with `--workers=1` on the local stack (skip `accrual.spec`; real roster). All PASS.
- [ ] **Step 4: Docs** — AGENT-LOG entry (what changed, migration dry-run, screenshots, what was not verified); CHANGELOG; TASKS; REQUIREMENTS FR line; CLAUDE.md lines from Tasks 1 and 8 present.
- [ ] **Step 5: Commit** `docs: UI readability and layout — log, changelog, requirements`. Ask the owner before pushing the branch or opening a PR.
