# HR / Time-Off — Phase 4 (Home board, Nav, Settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder home + nav-less shell with a role-aware home status board, a role-driven bottom-tab nav, a Profile/Settings page (calendar + language toggles, logout), and a responsive + a11y pass.

**Architecture:** Pure, unit-tested helpers (`tabsForRoles`, `parseDeviceType`, home view-model, balance reducer) drive thin server/client UI. No schema, RLS, or SQL-function changes — everything reads/writes existing tables via existing RLS (prefs self-update is already allowed by the `profiles` policy + `profiles_enforce_update_scope` trigger). Builds on Phases 0–3 on `feat/hr-timeoff-v1`.

**Tech Stack:** Next.js 16 App Router + TS · Supabase JS (existing clients/actions) · next-intl (path-based locales, fa default RTL) · `react-date-object` (already used) · Vitest (pure unit) · Playwright (e2e on linked Supabase).

## Global Constraints

Inherited from Phases 0–3 (see `docs/plans/2026-06-23-hr-timeoff-v1.md` + `…-phase3.md`):
- **Locale:** fa default **RTL**, en toggle LTR, per-user. **Dates Gregorian-stored, Jalali render-only.** **RLS is the source of truth.** Roles via `private.has_role`. Verify external APIs (next-intl navigation) via **Context7** before use.
- **Phase 4 specifics:** **No DB changes** (no migrations). Reuse existing server actions in `lib/actions/leave.ts`; add `lib/actions/profile.ts`. Tests: unit `npm run test:unit` (pure, no DB); e2e `npm run test:e2e` (linked Supabase; admin `admin`/`Admin!2026`; reuse `tests/e2e/_helpers.ts`). e2e runs flaky under high local parallelism — verify with `npm run test:e2e -- --workers=1` (CI mode) before claiming green.
- **Deferred to Phase 5 (do NOT build here):** admin work-settings/holiday UI (FR-24), self-service password change (FR-7 tail), balance-preview "نامشخص" race polish.

---

## File Structure (Phase 4)

```
lib/
  nav/tabs.ts                    # PURE tabsForRoles(roles) -> Tab[]   (unit)
  device.ts                      # PURE parseDeviceType(ua)            (unit)
  useViewport.ts                 # client hook: viewport width/breakpoint
  home/board.ts                  # PURE buildHomeBoard(...) view-model (unit)
  leave/balances.ts              # PURE latestBalances(rows) reducer   (unit)
  actions/profile.ts             # updateMyPrefs(), signOut()
  actions/leave.ts               # MODIFY: + getMyBalances() read
app/[locale]/(app)/
  layout.tsx                     # MODIFY: fetch roles, render <BottomNav>, bottom-pad content
  _components/BottomNav.tsx      # client: tabs from tabsForRoles, active by pathname, RTL, icons
  home/page.tsx                  # REWRITE: compose role cards from buildHomeBoard
  home/HomeBoard.tsx             # client/server card renderer
  profile/page.tsx               # server: prefs + name/code
  profile/SettingsForm.tsx       # client: calendar+language toggles, logout
messages/{fa,en}.json            # + nav.*, home.* (board), profile.*
tests/
  unit/{nav_tabs,device,home_board,balances}.test.ts
  e2e/{nav,settings}.spec.ts
```

Batches: **A = nav (4.1–4.2)** · **B = home board (4.3)** · **C = settings (4.4)** · **D = responsive/a11y (4.5)** · **E = docs (4.6)**.

---

### Task 4.1: Pure foundations — nav tabs + device parse

**Files:**
- Create: `lib/nav/tabs.ts`, `lib/device.ts`. Test: `tests/unit/nav_tabs.test.ts`, `tests/unit/device.test.ts`.

**Interfaces:**
- Produces: `type Tab = { key: 'home'|'request'|'calendar'|'profile'|'manage'; href: string; labelKey: string }`; `tabsForRoles(roles: string[]): Tab[]` — always Home, Request, Calendar, Profile; appends Manage iff `roles` includes `'admin'` or `'manager'`. `href` values are **locale-less path suffixes** (`/home`, `/request`, `/calendar`, `/profile`, `/manage/employees`); the component prefixes the locale.
- Produces: `parseDeviceType(userAgent: string | null | undefined): 'mobile' | 'desktop'`.

- [ ] **Step 1: Write failing tests** (`tests/unit/nav_tabs.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { tabsForRoles } from '@/lib/nav/tabs';

describe('tabsForRoles', () => {
  it('employee: 4 base tabs, no manage', () => {
    expect(tabsForRoles(['employee']).map(t => t.key)).toEqual(['home','request','calendar','profile']);
  });
  it('manager gets the manage tab', () => {
    expect(tabsForRoles(['employee','manager']).map(t => t.key)).toContain('manage');
  });
  it('admin gets the manage tab', () => {
    expect(tabsForRoles(['admin']).map(t => t.key)).toContain('manage');
  });
  it('security (no manage)', () => {
    expect(tabsForRoles(['security']).map(t => t.key)).not.toContain('manage');
  });
  it('manage tab points at the employees hub', () => {
    const manage = tabsForRoles(['admin']).find(t => t.key === 'manage');
    expect(manage?.href).toBe('/manage/employees');
  });
});
```

And `tests/unit/device.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDeviceType } from '@/lib/device';

describe('parseDeviceType', () => {
  it('iPhone UA -> mobile', () => {
    expect(parseDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile')).toBe('mobile');
  });
  it('Android UA -> mobile', () => {
    expect(parseDeviceType('Mozilla/5.0 (Linux; Android 14; Pixel) Mobile Safari')).toBe('mobile');
  });
  it('desktop Chrome -> desktop', () => {
    expect(parseDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120 Safari')).toBe('desktop');
  });
  it('null/undefined -> desktop (safe default)', () => {
    expect(parseDeviceType(null)).toBe('desktop');
    expect(parseDeviceType(undefined)).toBe('desktop');
  });
});
```

- [ ] **Step 2: Run, verify fail.** `npm run test:unit -- nav_tabs device` → FAIL (modules missing).

- [ ] **Step 3: Implement** (`lib/nav/tabs.ts`):

```ts
export type TabKey = 'home' | 'request' | 'calendar' | 'profile' | 'manage';
export type Tab = { key: TabKey; href: string; labelKey: string };

const BASE: Tab[] = [
  { key: 'home',     href: '/home',     labelKey: 'home' },
  { key: 'request',  href: '/request',  labelKey: 'request' },
  { key: 'calendar', href: '/calendar', labelKey: 'calendar' },
  { key: 'profile',  href: '/profile',  labelKey: 'profile' },
];

export function tabsForRoles(roles: string[]): Tab[] {
  const canManage = roles.includes('admin') || roles.includes('manager');
  return canManage
    ? [...BASE, { key: 'manage', href: '/manage/employees', labelKey: 'manage' }]
    : BASE;
}
```

And `lib/device.ts`:

```ts
export function parseDeviceType(userAgent: string | null | undefined): 'mobile' | 'desktop' {
  if (!userAgent) return 'desktop';
  return /Mobi|Android|iPhone|iPod|iPad|Windows Phone|webOS|BlackBerry/i.test(userAgent)
    ? 'mobile'
    : 'desktop';
}
```

- [ ] **Step 4: Run, verify pass.** `npm run test:unit -- nav_tabs device` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/nav/tabs.ts lib/device.ts tests/unit/nav_tabs.test.ts tests/unit/device.test.ts
git commit -m "feat(nav): pure tabsForRoles + parseDeviceType helpers"
```

### Task 4.2: Bottom-tab nav component + shell integration

**Files:**
- Create: `app/[locale]/(app)/_components/BottomNav.tsx`.
- Modify: `app/[locale]/(app)/layout.tsx`; `messages/fa.json`, `messages/en.json` (add `nav` namespace).
- Test: `tests/e2e/nav.spec.ts`.

**Interfaces:** Consumes `tabsForRoles` (4.1). `<BottomNav roles={string[]} locale={string} labels={Record<TabKey,string>} />`.

- [ ] **Step 1: Add `nav` i18n keys** to both message files: `home`, `request`, `calendar`, `profile`, `manage`. (fa: `خانه`, `درخواست`, `تقویم`, `پروفایل`, `مدیریت`; en: `Home`, `Request`, `Calendar`, `Profile`, `Manage`.)

- [ ] **Step 2: Build `BottomNav.tsx`** (`'use client'`): call `tabsForRoles(roles)`; for each tab render a `next/link` to `/${locale}${tab.href}` with an inline SVG icon + `labels[tab.key]`; mark active when `usePathname()` starts with `/${locale}${tab.href}` (special-case `/home`). Fixed bar: `className="fixed inset-x-0 bottom-0 z-40 border-t bg-white flex justify-around ..."` with `pb-[env(safe-area-inset-bottom)]`. Each link: `data-testid={`nav-${tab.key}`}`, min touch target `min-h-14`, active style. Icons: small inline `<svg>` per key (home/request/calendar/profile/manage) — simple line icons, `aria-hidden`.

- [ ] **Step 3: Integrate in `layout.tsx`** — after the auth guard, fetch the caller's roles (mirror the `user_roles` select already used in `manage/layout.tsx`), load `getTranslations('nav')`, and render:

```tsx
return (
  <div className="min-h-dvh pb-20">
    {children}
    <BottomNav roles={roles} locale={locale} labels={labels} />
  </div>
);
```

(`labels` = `{ home: t('home'), request: t('request'), calendar: t('calendar'), profile: t('profile'), manage: t('manage') }`. `pb-20` keeps content clear of the bar.)

- [ ] **Step 4: Write e2e** (`tests/e2e/nav.spec.ts`), reusing `_helpers.ts`:

```ts
import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee } from './_helpers';

test('bottom nav shows role-correct tabs and navigates', async ({ page }) => {
  test.setTimeout(120_000);
  const ts = Date.now();
  // Admin sees Manage.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await expect(page.locator('[data-testid="nav-home"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-manage"]')).toBeVisible();
  await page.locator('[data-testid="nav-calendar"]').click();
  await expect(page).toHaveURL(/\/calendar$/);
  // Plain employee: no Manage tab.
  const empPw = await createEmployee(page, { code: `emp${ts}`, name: `E ${ts}`, roles: ['employee'] });
  await logout(page);
  await login(page, `emp${ts}`, empPw.trim());
  await expect(page.locator('[data-testid="nav-home"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-manage"]')).toHaveCount(0);
});
```

- [ ] **Step 5: Run + build.** `npm run test:e2e -- nav` → PASS; `npm run build` → compiles; `npx eslint` the new/changed files → clean.

- [ ] **Step 6: Commit.**

```bash
git add "app/[locale]/(app)/_components/BottomNav.tsx" "app/[locale]/(app)/layout.tsx" messages/fa.json messages/en.json tests/e2e/nav.spec.ts
git commit -m "feat(nav): role-driven bottom-tab navigation"
```

### Task 4.3: Home status board

**Files:**
- Create: `lib/home/board.ts`, `lib/leave/balances.ts`, `app/[locale]/(app)/home/HomeBoard.tsx`.
- Modify: `lib/actions/leave.ts` (add `getMyBalances`), `app/[locale]/(app)/home/page.tsx`, `messages/{fa,en}.json` (extend `home`).
- Test: `tests/unit/balances.test.ts`, `tests/unit/home_board.test.ts`, (e2e folded into nav/settings or a `home` check).

**Interfaces:**
- Produces (pure, in `lib/leave/balances.ts`): `latestBalances(rows: { leave_type_id: string; balance_after: number; created_at: string }[]): Record<string, number>` — latest `balance_after` per type (rows may be unsorted); **and** `export type BalanceItem = { leaveTypeId: string; name_fa: string; name_en: string|null; balance: number }` (defined here — the neutral module — so both `board.ts` and the `getMyBalances` action import it; avoids a `board.ts`↔`leave.ts` circular import).
- Produces (pure, in `lib/home/board.ts`): `buildHomeBoard(input: { roles: string[]; requests: LeaveRequestWithType[]; balances: BalanceItem[]; team: CalendarEntry[]; pendingCount: number }): HomeBoard` where `HomeBoard = { showApprovals: boolean; pendingCount: number; recent: LeaveRequestWithType[]; balances: BalanceItem[]; team: CalendarEntry[] }`. `showApprovals = roles includes admin|manager`; `recent` = first 5 requests.
- Produces (action): `getMyBalances(): Promise<{ok:true; balances: BalanceItem[]} | {ok:false;error:string}>` — joins active leave types with `latestBalances` over the caller's `leave_ledger`.
- Consumes: `getMyLeaveRequests`, `getCalendarEntries`, `getPendingApprovals`, `getActiveLeaveTypes` (existing).

- [ ] **Step 1: Failing tests.** `tests/unit/balances.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { latestBalances } from '@/lib/leave/balances';

describe('latestBalances', () => {
  it('keeps the latest balance_after per leave type', () => {
    const rows = [
      { leave_type_id: 'a', balance_after: 26, created_at: '2026-01-01T00:00:00Z' },
      { leave_type_id: 'a', balance_after: 24, created_at: '2026-06-01T00:00:00Z' },
      { leave_type_id: 'b', balance_after: 10, created_at: '2026-03-01T00:00:00Z' },
    ];
    expect(latestBalances(rows)).toEqual({ a: 24, b: 10 });
  });
  it('empty -> {}', () => expect(latestBalances([])).toEqual({}));
});
```

`tests/unit/home_board.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildHomeBoard } from '@/lib/home/board';

const base = { requests: [], balances: [], team: [], pendingCount: 3 };
describe('buildHomeBoard', () => {
  it('employee: no approvals card', () => {
    expect(buildHomeBoard({ ...base, roles: ['employee'] }).showApprovals).toBe(false);
  });
  it('manager: approvals card with count', () => {
    const b = buildHomeBoard({ ...base, roles: ['manager'] });
    expect(b.showApprovals).toBe(true);
    expect(b.pendingCount).toBe(3);
  });
  it('recent caps at 5', () => {
    const requests = Array.from({ length: 8 }, (_, i) => ({ id: String(i) })) as never[];
    expect(buildHomeBoard({ ...base, roles: ['employee'], requests }).recent).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Verify fail.** `npm run test:unit -- balances home_board` → FAIL.

- [ ] **Step 3: Implement the pure helpers.** `lib/leave/balances.ts`:

```ts
export type BalanceItem = { leaveTypeId: string; name_fa: string; name_en: string | null; balance: number };

export function latestBalances(
  rows: { leave_type_id: string; balance_after: number; created_at: string }[],
): Record<string, number> {
  const latest: Record<string, { balance: number; at: string }> = {};
  for (const r of rows) {
    const prev = latest[r.leave_type_id];
    if (!prev || r.created_at > prev.at) latest[r.leave_type_id] = { balance: r.balance_after, at: r.created_at };
  }
  return Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, v.balance]));
}
```

`lib/home/board.ts` (import the existing `LeaveRequestWithType`, `CalendarEntry` types from `@/lib/actions/leave`):

```ts
import type { LeaveRequestWithType, CalendarEntry } from '@/lib/actions/leave';
import type { BalanceItem } from '@/lib/leave/balances';

export type HomeBoard = {
  showApprovals: boolean;
  pendingCount: number;
  recent: LeaveRequestWithType[];
  balances: BalanceItem[];
  team: CalendarEntry[];
};

export function buildHomeBoard(input: {
  roles: string[];
  requests: LeaveRequestWithType[];
  balances: BalanceItem[];
  team: CalendarEntry[];
  pendingCount: number;
}): HomeBoard {
  const showApprovals = input.roles.includes('admin') || input.roles.includes('manager');
  return {
    showApprovals,
    pendingCount: input.pendingCount,
    recent: input.requests.slice(0, 5),
    balances: input.balances,
    team: input.team,
  };
}
```

- [ ] **Step 4: Verify pass.** `npm run test:unit -- balances home_board` → PASS.

- [ ] **Step 5: Add `getMyBalances` to `lib/actions/leave.ts`.** Fetch active types (`getActiveLeaveTypes` logic) + the caller's `leave_ledger` rows (`employee_id = user.id`, select `leave_type_id, balance_after, created_at`); apply `latestBalances`; map to `BalanceItem[]` (types with no ledger row → balance 0). Mirror the existing read-helper shape (`getCallerContext`, `{ ok }` result).

- [ ] **Step 6: Rewrite `home/page.tsx`** (server) — fetch in parallel: `getMyLeaveRequests`, `getMyBalances`, `getCalendarEntries(currentMonthRange)` (reuse the month-range computation from `calendar/page.tsx`), roles, and `getPendingApprovals` **only if** manager/admin (else skip). Call `buildHomeBoard(...)`; pass to `<HomeBoard board labels locale calendarPref />`. Remove the old link-stack (nav now owns navigation).

- [ ] **Step 7: Build `HomeBoard.tsx`** — cards: **Balances** (per type: name + number), **My recent requests** (reuse the row style/status colors from `MyRequestsList.tsx`), **Team time-off** (reuse the chip style from `CalendarView.tsx`), and — when `board.showApprovals` — an **Approvals** card showing `pendingCount` linking to `/${locale}/manage/approvals`, `data-testid="home-approvals-card"`. Add `data-testid="home-board"`. fa+en labels under `home`.

- [ ] **Step 8: Verify.** `npm run test:unit` (all green), `npm run build`, `npx eslint` changed files clean. Quick e2e sanity: manager logs in → `home-approvals-card` visible (can fold into `nav.spec` or add a check).

- [ ] **Step 9: Commit.**

```bash
git add lib/home/board.ts lib/leave/balances.ts lib/actions/leave.ts "app/[locale]/(app)/home" messages/fa.json messages/en.json tests/unit/balances.test.ts tests/unit/home_board.test.ts
git commit -m "feat(home): role-aware status board (balances, requests, team, approvals)"
```

### Task 4.4: Profile / Settings (prefs + logout)

**Files:**
- Create: `lib/actions/profile.ts`, `app/[locale]/(app)/profile/page.tsx`, `app/[locale]/(app)/profile/SettingsForm.tsx`.
- Modify: `messages/{fa,en}.json` (add `profile`).
- Test: `tests/e2e/settings.spec.ts`.

**Interfaces:**
- Produces: `updateMyPrefs(input: { calendarPref?: 'jalali'|'gregorian'; languagePref?: 'fa'|'en' }): Promise<{ok:true}|{ok:false;error:string}>` — `supabase.from('profiles').update(...).eq('id', user.id)` (self-update is within the RLS-allowed column subset; the `profiles_enforce_update_scope` trigger permits `language_pref`/`calendar_pref` for self).
- Produces: `signOut(): Promise<void>` — `await supabase.auth.signOut()` then `redirect('/<locale>/login')` (pass locale in).

- [ ] **Step 1: Confirm next-intl navigation API via Context7.** Query for the App-Router locale-switch pattern (`createNavigation`/`useRouter().replace(pathname, { locale })` from the project's `i18n/routing.ts`). Use the confirmed API in Step 4.

- [ ] **Step 2: Implement `lib/actions/profile.ts`.** `updateMyPrefs` (validate enums; whitelist only `calendar_pref`/`language_pref`; return `{ok}`); `signOut(locale: string)` (signOut + `redirect`). Mirror `getCallerContext`/result-shape conventions from `lib/actions/leave.ts`.

- [ ] **Step 3: Build `profile/page.tsx`** (server) — load profile (`full_name`, `employee_code`, `calendar_pref`, `language_pref`), `getTranslations('profile')`, render name/code (read-only) + `<SettingsForm current={...} locale labels />`.

- [ ] **Step 4: Build `SettingsForm.tsx`** (`'use client'`): two selects — calendar (`jalali`/`gregorian`) and language (`fa`/`en`) — and a Logout button. On calendar change → `updateMyPrefs({ calendarPref })` + `router.refresh()`. On language change → `updateMyPrefs({ languagePref })` then navigate to the mirrored locale path via the Context7-confirmed next-intl router (`router.replace(pathname, { locale })`). Logout → `signOut(locale)`. Testids: `settings-calendar`, `settings-language`, `settings-logout`. Use existing form styling.

- [ ] **Step 5: Add `profile` i18n keys** (both locales): `title`, `code`, `name`, `calendar`, `language`, `jalali`, `gregorian`, `langFa`, `langEn`, `logout`, `saved`.

- [ ] **Step 6: Write e2e** (`tests/e2e/settings.spec.ts`) using `_helpers.ts`: create an employee, log in, open `/profile`; switch calendar to gregorian → reload → the select still shows gregorian (persisted); switch language to `en` → URL becomes `/en/...` and `<html lang="en" dir="ltr">`; click logout → lands on `/login`.

- [ ] **Step 7: Verify + commit.** `npm run test:e2e -- settings` PASS; build + eslint clean.

```bash
git add lib/actions/profile.ts "app/[locale]/(app)/profile" messages/fa.json messages/en.json tests/e2e/settings.spec.ts
git commit -m "feat(profile): settings (calendar/language toggles) + logout"
```

### Task 4.5: Responsive + device detection + a11y pass

**Files:**
- Create: `lib/useViewport.ts`. Test: `tests/unit/device.test.ts` (extended is optional; `useViewport` is a thin hook — covered by e2e viewport checks).
- Modify (responsive/a11y only): `BottomNav.tsx`, `home/HomeBoard.tsx`, `request/LeaveRequestForm.tsx`, `calendar/CalendarView.tsx`, `manage/employees/page.tsx` (table overflow), as the audit requires.

**Interfaces:** Produces `useViewport(): { width: number; isMobile: boolean }` (client hook; `isMobile = width < 768`). `parseDeviceType` (4.1) covers the server side.

- [ ] **Step 1: Implement `lib/useViewport.ts`** — `'use client'` hook with a `resize` listener (SSR-safe initial `width = 0` → `isMobile=false` until mounted).
- [ ] **Step 2: Responsive audit** — at 375px (mobile) and 1280px (desktop): confirm no horizontal scroll; the bottom bar doesn't overlap content (the `pb-20` from 4.2); manage tables scroll within `overflow-x-auto` (already present); forms are full-width on mobile, max-width centered on desktop. Apply Tailwind `sm:`/`md:` fixes where broken.
- [ ] **Step 3: a11y audit** — every interactive control has a label or `aria-label`; nav links have discernible text (label, not icon-only); touch targets ≥ 44px (`min-h-11`/`min-h-14`); status colors are not the *only* signal (text label present — already true in `MyRequestsList`). Fix gaps.
- [ ] **Step 4: e2e viewport check** — extend `nav.spec.ts` (or a new `responsive.spec.ts`): set viewport 375×667, assert the bottom nav is visible and `nav-home` is clickable; set 1280×800, assert nav still visible. (Guards the bar across sizes.)
- [ ] **Step 5: Verify + commit.** Full `npm run test:e2e -- --workers=1` green; build + eslint clean.

```bash
git add lib/useViewport.ts "app/[locale]/(app)" tests/e2e
git commit -m "feat(ui): device-detection hook + responsive/a11y pass"
```

### Task 4.6: Docs — flip statuses + changelog + memory

**Files:** Modify `docs/REQUIREMENTS.md`, `docs/TASKS.md`, `docs/CHANGELOG.md`, `.superpowers/sdd/progress.md`, memory (`bj-hr-app-state.md` + `MEMORY.md`).

- [ ] **Step 1:** `docs/REQUIREMENTS.md`: **FR-20 ☑, FR-21 ☑, FR-23 ☑, NFR-1 ☑, NFR-7 ☑**. (FR-24, FR-7 password-change → remain ☐, Phase 5.)
- [ ] **Step 2:** `docs/TASKS.md`: tick Phase 4 boxes; banner → "Phases 0–4 complete"; next = Phase 5.
- [ ] **Step 3:** `docs/CHANGELOG.md`: Phase 4 entry (home board, nav, settings, responsive/a11y).
- [ ] **Step 4:** Append Phase 4 to `.superpowers/sdd/progress.md`; update memory `bj-hr-app-state.md` + `MEMORY.md` pointer ("Phases 0–4 done").
- [ ] **Step 5:** Final suite green: `npm run test:unit && npm run test:e2e -- --workers=1 && npm run build`.
- [ ] **Step 6: Commit.** `git commit -m "docs: mark Phase 4 (home board, nav, settings) complete"`.

---

## Self-Review

**Spec coverage:** FR-20 (home board) → 4.3. FR-21 (role nav) → 4.1+4.2. FR-23 (calendar/language toggles, persisted) → 4.4 (+ logout, P4-6). NFR-1 (responsive + device detection) → 4.1 (`parseDeviceType`) + 4.5 (`useViewport` + responsive). NFR-7 (a11y/touch) → 4.5. Decisions P4-1..P4-6 all realized (single bottom bar 4.2; Manage hub 4.1; inline SVG icons 4.2; language path-swap 4.4; device util-not-fork 4.5; logout 4.4). Deferred (FR-24, FR-7 tail, balance-flash) explicitly out — no tasks, correct.

**Placeholder scan:** No TBD/"handle edge cases". External-API step (next-intl navigation) names the concrete check (Context7 in 4.4 Step 1) + the exact call to wire. UI steps cite exact components to mirror + testids.

**Type consistency:** `Tab`/`TabKey` consistent 4.1↔4.2. `BalanceItem`/`HomeBoard`/`buildHomeBoard` consistent 4.3 (action `getMyBalances` returns `BalanceItem[]` consumed by `buildHomeBoard`). `latestBalances` row shape matches the `leave_ledger` select in `getMyBalances`. `parseDeviceType` (4.1) / `useViewport` (4.5) distinct names, no clash. `updateMyPrefs`/`signOut` signatures consistent 4.4. Reused types (`LeaveRequestWithType`, `CalendarEntry`) imported from `lib/actions/leave.ts`, not redefined.

**Risks / verify-at-build:** (1) next-intl locale-switch API — Context7 in 4.4.1. (2) `signOut` server action must clear the `@supabase/ssr` cookies — confirm the session is gone after redirect (e2e in 4.4.6). (3) e2e parallel flakiness — use `--workers=1` for the green gate (4.6.5).
