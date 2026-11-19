# Profile Tabs + Self-Service SMS Mobile (FR-95) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Profile into three route tabs (Profile · Personal information · Account) with a wider layout, and let every active user set their own SMS mobile.

**Architecture:** One SECURITY DEFINER function `app_set_my_mobile` writes only the caller's `employee_personal_info.mobile` (bypassing the `personal_info_own` RLS gate for that one column). `app/[locale]/(app)/profile/layout.tsx` renders the header, the phone link row + Logout, and `ProfileTabs`; each tab is its own page.

**Tech Stack:** Next.js App Router, next-intl, Supabase (Postgres + PostgREST), Vitest, Playwright, psql SQL tests.

**Spec:** `docs/specs/2026-11-19-profile-tabs-design.md`

## Global Constraints

- Branch **`feat/profile-tabs` from `main`** (not from `feat/erp-sales-module`; unrelated work, ships on its own).
- Migration file: `supabase/migrations/20261119120000_self_service_mobile.sql`. Frozen once applied — dry-run on a clone first (CLAUDE.md "Dry-run migrations first").
- Mobile format stored: `^09[0-9]{9}$` (existing CHECK `epi_mobile`). Normalize with `private.normalize_ir_mobile` (SQL) / `normalizeIrMobile` from `lib/admin/format.ts` (TS).
- `schema.sql`: patch only the new function's hunks (local DB anon/ACL drift — CLAUDE.md). `lib/supabase/types.ts` hand-edited.
- UI per `docs/DESIGN.md`: tabs from `lib/ui/tabs.ts`, no `shadow-*`, no `rounded-[Npx]`, light only.
- Every string in `messages/fa.json` + `messages/en.json`; client components use `useTranslations`.
- Phones: no page title on Profile pages (MobileTopBar shows it); desktop keeps `PageHeader` title.
- Server actions start with `requireCaller()`; `if (!c.ok) return c;`.

## Review Focus

1. Persian digits / `+98` / spaces in the mobile input → saved as `09xxxxxxxxx` (SQL test + unit test).
2. Empty input → number cleared (NULL), not an error; SMS then logs `no_mobile` (SQL test).
3. Employee with no `employee_personal_info` row yet → row created with company from profile (SQL test).
4. View as (read-only) → save fails, field disabled; never writes as the viewed person (e2e `view-as` not run here; check the card's `disabled` when `isViewingAs`).
5. Old link `/profile/personal-info` and e2e `profile-personal-info-link` still reach the Personal information tab (keep the test id on the tab link).

---

### Task 1: `app_set_my_mobile` migration + SQL test

**Files:**
- Create: `supabase/migrations/20261119120000_self_service_mobile.sql`
- Create: `tests/sql/self-service-mobile.sql` (copy the harness header of `tests/sql/sms.sql`: `pg_temp.fx/login/as_scalar/expect`)
- Modify: `supabase/schema.sql` (function + grant hunks only), `lib/supabase/types.ts` (`Functions.app_set_my_mobile: { Args: { p_mobile: string | null }; Returns: string | null }`)

**Interfaces:**
- Produces: `public.app_set_my_mobile(p_mobile text) returns text` — returns the stored value (normalized or NULL).

- [ ] **Step 1: Write the SQL test** with fixtures: company, employee `e1` (has a personal-info row, no `personal_info_own`), `e2` (no personal-info row), inactive `e3`. Assertions:
  - `as_scalar('e1', $$select public.app_set_my_mobile('۰۹۱۲ ۳۴۵ ۶۷۸۹')$$)` = `09123456789`, and the row's `mobile` = `09123456789`
  - `'+98 912 345 6789'` → `09123456789`
  - `''` → NULL and row `mobile` IS NULL
  - `'12345'` → `ERROR 22023 invalid mobile`
  - `e2` call creates its row; `company_id` = e2's profile company
  - `e3` → `ERROR 42501 ...` (inactive)
  - `audit_log` has `action='personal_info.mobile_self'`, `entity='employee_personal_info'`, `entity_id`=caller, `before`/`after` = `{"mobile": old}` / `{"mobile": new}`
  - other columns of e1's row unchanged
- [ ] **Step 2: Run on a clone without the migration** → fails (function missing). Clone procedure: CLAUDE.md "Dry-run migrations first"; run `psql -d x -f tests/sql/self-service-mobile.sql` as `supabase_admin`.
- [ ] **Step 3: Write the migration:** `security definer`, `set search_path to ''`, `volatile`; require `private.is_active(auth.uid())` else `raise ... using errcode='42501'`; `v := private.normalize_ir_mobile(p_mobile)`; if `nullif(btrim(p_mobile),'') is not null and v is null` raise `'invalid mobile'` errcode `22023`; `insert ... on conflict (employee_id) do update set mobile = excluded.mobile` (company from `public.profiles`); audit row; `revoke all ... from public, anon; grant execute ... to authenticated`.
- [ ] **Step 4: Apply to the clone, run the new test + `tests/sql/sms.sql` + `tests/sql/fr52-53-signature-personal-info.sql`** → all pass. Drop the clone.
- [ ] **Step 5: Apply to local `postgres`, restart `bj-erp-rest-1`, patch `schema.sql` (diff schema dumps before/after, only new hunks), edit `types.ts`, `npx tsc --noEmit`.**
- [ ] **Step 6: Commit** `feat(profile): app_set_my_mobile — everyone sets their own SMS mobile (FR-95)`

### Task 2: Server action + SMS mobile card

**Files:**
- Modify: `lib/actions/personal-info.ts` (add `setMyMobile`)
- Create: `components/profile/SmsMobileCard.tsx` (`'use client'`)
- Modify: `messages/fa.json`, `messages/en.json` — namespace `profile.mobile`: `title`, `hint` ("SMS notifications are sent to this number"), `label`, `placeholder` (`09123456789`), `save`, `saved`, `cleared`, `invalid`, `none` ("No number yet — you won't get SMS notifications")
- Test: `tests/unit/sms-mobile.test.ts`

**Interfaces:**
- Consumes: `app_set_my_mobile` (Task 1).
- Produces: `setMyMobile(mobile: string): Promise<{ ok: true; mobile: string | null } | DbErrorResult>`; `<SmsMobileCard initial={string | null} disabled={boolean} />`.

- [ ] **Step 1: Unit test** `normalizeIrMobile` cases used by the card: `'۰۹۱۲۳۴۵۶۷۸۹'`→`'09123456789'`, `'+989123456789'`→`'09123456789'`, `'0912'`→`null` (skip if already covered in the existing admin-format test; add only missing cases there instead).
- [ ] **Step 2: Implement `setMyMobile`:** `requireCaller()`; if input non-blank and `normalizeIrMobile` null → `{ ok:false, error:'invalid mobile' }` without calling the DB; rpc; `revalidatePath('/[locale]/profile', 'layout')`.
- [ ] **Step 3: Implement the card:** shows current number (`dir="ltr"`, mono), input (`inputMode="tel"`, `dir="ltr"`), Save; inline success/error text; `disabled` when the caller is viewing as someone (page passes it).
- [ ] **Step 4: `npm run test:unit` + `npx tsc --noEmit`** → pass.
- [ ] **Step 5: Commit** `feat(profile): SMS mobile card`

### Task 3: Tabbed layout, three tab pages, phone link row

**Files:**
- Create: `app/[locale]/(app)/profile/layout.tsx`, `app/[locale]/(app)/profile/_components/ProfileTabs.tsx` (copy `AdminTabs` pattern; tabs `profile` `''`, `personalInfo` `/personal-info`, `account` `/account`; test ids `profile-tab-<key>`; the e2e that clicked `profile-personal-info-link` is updated to `profile-tab-personalInfo`), `app/[locale]/(app)/profile/_components/ProfileMobileLinks.tsx` (org / help / settings links + `LogoutButton`, `md:hidden`), `app/[locale]/(app)/profile/account/page.tsx`
- Modify: `app/[locale]/(app)/profile/page.tsx` (Profile tab only), `app/[locale]/(app)/profile/personal-info/page.tsx` (drop `PageHeader` and back link), `messages/*.json` (`profile.tabs.{profile,personalInfo,account}`), `tests/e2e/signature-personal-info.spec.ts:129` (click `profile-tab-personalInfo`)

**Interfaces:**
- Consumes: `SmsMobileCard`, `getPersonalInfo(user.id)` for the initial mobile, existing `ProfilePhotoCard`, `SavedSignatureCard`, `LanguageSwitch`, `ChangePasswordForm`, `LogoutButton`.

- [ ] **Step 1: Layout:** `<main data-wide className="p-4 mx-auto max-w-5xl space-y-4">`; `PageHeader` wrapped `hidden md:block` with `section` (title `profile.title`) — check `MobileTopBar` `SECTIONS` still matches `/profile/*`; phone refresh button stays (top-right on phone, `md:hidden`); then `ProfileMobileLinks` (compact row of three links + Logout), then `ProfileTabs`, then `{children}`. Settings link computed in the layout (move `settingsItemForRoles` logic from the page).
- [ ] **Step 2: Profile page:** `grid gap-4 md:grid-cols-2`; left column: name/code card, photo card; right column: `SmsMobileCard`, signature card. Phones collapse to one column in DOM order name → photo → phone → signature (use two column `div`s; source order gives that).
- [ ] **Step 3: Personal info page:** intro text + form card, `max-w-3xl`.
- [ ] **Step 4: Account page:** `grid gap-4 md:grid-cols-2` — Preferences (language) card, Change password card; `LogoutButton` at the end, `hidden md:flex`.
- [ ] **Step 5: Verify in browser** (dev server against local stack, live-backup DB, Ayasi test account): desktop 1280 and mobile 375 for each tab; tab underline correct in fa (no locale prefix) and en; save a number with Persian digits, reload, see it in Personal information too; View as → field disabled. Screenshots.
- [ ] **Step 6: `npm run lint`, `npx tsc --noEmit`, `npm run build`, e2e `signature-personal-info.spec.ts` + `password.spec.ts` + `settings.spec.ts` (`--workers=1`)** → pass.
- [ ] **Step 7: Commit** `feat(profile): tabs — Profile, Personal information, Account (FR-95)`

### Task 4: Docs

**Files:** `docs/REQUIREMENTS.md` (FR-95), `docs/PERMISSIONS.md` (`employee_personal_info` section: own mobile via `app_set_my_mobile`, any active user), `docs/DATA_MODEL.md` (mobile note), `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/AGENT-LOG.md`, `CLAUDE.md` (one gotcha line: own mobile = `app_set_my_mobile`, not the RLS update).

- [ ] **Step 1: Write the entries.**
- [ ] **Step 2: Commit** `docs: FR-95 profile tabs + self-service mobile [skip ci]` — never push with this as the newest commit on top of code.
