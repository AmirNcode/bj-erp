# Frontend Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unstyled create-next-app UI with a branded, accessible, fast design system (shadcn/ui + brand tokens + Vazirmatn) across all HR screens, without changing any behavior or backend.

**Architecture:** Introduce a token layer in `app/globals.css` (brand colors in OKLCH mapped through Tailwind v4 `@theme inline` + shadcn semantic variables), add shadcn/ui primitives, build a responsive `AppShell` (bottom tabs on mobile → side rail on desktop), then reskin each screen onto the primitives while preserving every `data-testid` so the existing 65 unit / 20 e2e tests stay green. Cross-cutting perf/UX fixes (router.refresh instead of full reload, lazy date picker, AlertDialog/toast, skeletons) land last.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui (new-york, Radix) · next-intl · Supabase SSR · Vitest + Testing Library · Playwright · `react-multi-date-picker`.

## Global Constraints

- **Light theme only** for v1. Do not add a `.dark` block, `dark:` variants, or `prefers-color-scheme`.
- **Preserve every `data-testid`** on every screen. Tests are the safety net; a reskin must not break them.
- **No backend / schema / RLS / server-action logic changes.** UI and presentation only.
- **Dates stay Gregorian in code**; Jalali is presentation-only (existing format layer in `lib/leave/dateConvert.ts` is untouched).
- **Farsi-first RTL**: all new layout uses logical utilities (`ms-/me-/ps-/pe-/start-/end-`), never `ml-/pl-/left-/right-`. All copy goes through `messages/fa.json` + `messages/en.json`.
- **Brand:** primary `#2E3C92` (`oklch(0.3983 0.1418 271.41)`). `--radius` = `0.75rem`.
- **Portability (NFR-4):** self-host the font; only MIT, copied-in components. No external runtime CDN dependency in app code.
- **Each task ends green**: run the relevant tests + `npm run build` before committing.

---

## Phase A — Foundation

### Task 1: Initialize shadcn/ui + utilities

**Files:**
- Create: `components.json`, `lib/utils.ts`
- Modify: `package.json` (deps added by CLI), `app/globals.css` (CLI touches it; full rewrite in Task 2)

**Interfaces:**
- Produces: `cn(...inputs)` from `lib/utils.ts` used by every primitive.

- [ ] **Step 1: Run the shadcn initializer (Tailwind v4 mode)**

Run: `npx shadcn@latest init`
Answers: style **new-york**, base color **slate**, CSS variables **yes**.
Expected: creates `components.json` + `lib/utils.ts`, installs `clsx`, `tailwind-merge`, `class-variance-authority`, `tw-animate-css`, `lucide-react`.

- [ ] **Step 2: Verify `components.json`**

Confirm it contains (edit to match if the CLI differs):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "app/globals.css", "baseColor": "slate", "cssVariables": true, "prefix": "" },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 3: Verify the build still compiles**

Run: `npm run build`
Expected: build succeeds (globals.css gets a full rewrite in Task 2).

- [ ] **Step 4: Commit**

```bash
git add components.json lib/utils.ts package.json package-lock.json app/globals.css
git commit -m "chore(ui): init shadcn/ui (new-york, tailwind v4, css vars)"
```

---

### Task 2: Brand tokens + Vazirmatn font

**Files:**
- Create: `app/fonts/Vazirmatn[wght].woff2`
- Rewrite: `app/globals.css`
- Modify: `app/[locale]/layout.tsx` (swap Geist → Vazirmatn local font)

**Interfaces:**
- Produces: CSS variables `--primary`, `--background`, `--foreground`, `--muted(-foreground)`, `--border`, `--input`, `--ring`, `--radius`, `--success(-foreground)`, `--warning(-foreground)`, plus `--font-sans`. Consumed by every primitive + `StatusBadge` (Task 4).

- [ ] **Step 1: Download the self-hosted Vazirmatn variable font**

Run:
```bash
mkdir -p app/fonts
curl -L "https://cdn.jsdelivr.net/npm/vazirmatn@33.003/fonts/variable/Vazirmatn[wght].woff2" -o "app/fonts/Vazirmatn[wght].woff2"
```
Expected: a ~100–200KB woff2 at `app/fonts/Vazirmatn[wght].woff2`. (If the path 404s, browse `https://www.jsdelivr.com/package/npm/vazirmatn` and grab the variable woff2.)

- [ ] **Step 2: Rewrite `app/globals.css`** (full file)

```css
@import "tailwindcss";
@import "tw-animate-css";

:root {
  --radius: 0.75rem;

  /* Surfaces & text */
  --background: oklch(0.9792 0.0041 271.37);   /* page #F7F8FB */
  --foreground: oklch(0.2013 0.0144 272.55);   /* ink #14161D */
  --card: oklch(1 0 0);                          /* white */
  --card-foreground: var(--foreground);
  --popover: oklch(1 0 0);
  --popover-foreground: var(--foreground);

  /* Brand */
  --primary: oklch(0.3983 0.1418 271.41);       /* #2E3C92 */
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.9363 0.0176 279.05);     /* tint #E7E9F6 */
  --secondary-foreground: oklch(0.2981 0.1033 271.32); /* deep #1C2660 */
  --accent: oklch(0.9363 0.0176 279.05);        /* tint */
  --accent-foreground: oklch(0.3983 0.1418 271.41);

  /* Neutrals */
  --muted: oklch(0.9242 0.0117 264.51);         /* hairline #E2E6EE */
  --muted-foreground: oklch(0.5510 0.0234 264.36); /* muted #6B7280 */
  --border: oklch(0.8614 0.0158 257.20);        /* #CBD2DC */
  --input: oklch(0.8614 0.0158 257.20);
  --ring: oklch(0.3983 0.1418 271.41);          /* primary */

  /* Status (semantic) */
  --destructive: oklch(0.5054 0.1905 27.52);    /* danger #B91C1C */
  --destructive-foreground: oklch(1 0 0);
  --success: oklch(0.5273 0.1371 150.07);       /* #15803D */
  --success-foreground: oklch(0.9624 0.0434 156.74); /* bg #DCFCE7 */
  --warning: oklch(0.5553 0.1455 49.00);        /* #B45309 */
  --warning-foreground: oklch(0.9619 0.0580 95.62);  /* bg #FEF3C7 */
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);

  --font-sans: var(--font-vazirmatn), ui-sans-serif, system-ui, sans-serif;
}

* { border-color: var(--color-border); }
body { background: var(--color-background); color: var(--color-foreground); }
```

Note: there is **no `body { font-family: Arial }`**, **no `.dark` block**, and **no `prefers-color-scheme`** — those were the bugs.

- [ ] **Step 3: Wire the font in `app/[locale]/layout.tsx`**

Replace the Geist imports/instances with:

```tsx
import localFont from 'next/font/local';

const vazirmatn = localFont({
  src: './../fonts/Vazirmatn[wght].woff2',
  variable: '--font-vazirmatn',
  weight: '100 900',
  display: 'swap',
});
```

Then change the `<html>` className from the Geist variables to:

```tsx
className={`${vazirmatn.variable} h-full antialiased font-sans`}
```

(Remove the `Geist`/`Geist_Mono` imports and their `.variable` usages.)

- [ ] **Step 4: Add a guard test** `tests/unit/theme.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('globals.css theme', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  it('does not hardcode Arial on body', () => {
    expect(css).not.toMatch(/font-family:\s*Arial/i);
  });
  it('defines the brand primary token', () => {
    expect(css).toMatch(/--primary:\s*oklch\(0\.3983/);
  });
  it('has no dark-mode block (light-only v1)', () => {
    expect(css).not.toMatch(/prefers-color-scheme|\.dark\s*\{/);
  });
});
```

- [ ] **Step 5: Run tests + build**

Run: `npm run test:unit -- theme && npm run build`
Expected: theme tests PASS; build succeeds; app now renders in Vazirmatn.

- [ ] **Step 6: Commit**

```bash
git add "app/fonts/Vazirmatn[wght].woff2" app/globals.css app/[locale]/layout.tsx tests/unit/theme.test.ts
git commit -m "feat(ui): brand OKLCH tokens + self-hosted Vazirmatn, drop Arial/dark"
```

---

### Task 3: Add base primitives + RTL migration

**Files:**
- Create: `components/ui/*` (button, card, input, label, select, textarea, badge, dialog, alert-dialog, popover, sonner, skeleton, avatar, separator, sheet, dropdown-menu, tabs)
- Test: `tests/unit/ui-button.test.tsx`

- [ ] **Step 1: Add the primitives**

Run:
```bash
npx shadcn@latest add button card input label select textarea badge dialog alert-dialog popover sonner skeleton avatar separator sheet dropdown-menu tabs
```
Expected: files appear under `components/ui/`, deps (Radix packages, `sonner`) installed.

- [ ] **Step 2: Run the RTL migration**

Run: `npx shadcn@latest migrate rtl`
Expected: `components.json` gains RTL support; primitive CSS uses logical properties + RTL variants.

- [ ] **Step 3: Write a render smoke test** `tests/unit/ui-button.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Button } from '@/components/ui/button';

describe('Button primitive', () => {
  it('renders children and is a button by default', () => {
    render(<Button>ثبت</Button>);
    expect(screen.getByRole('button', { name: 'ثبت' })).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run test + build**

Run: `npm run test:unit -- ui-button && npm run build`
Expected: PASS + build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/ui components.json package.json package-lock.json tests/unit/ui-button.test.tsx
git commit -m "feat(ui): add shadcn primitives + RTL migration"
```

---

### Task 4: `StatusBadge` component (de-duplicate the status map)

**Files:**
- Create: `components/StatusBadge.tsx`, `tests/unit/status-badge.test.tsx`

**Interfaces:**
- Produces: `<StatusBadge status labels />` where
  `status: 'pending'|'approved'|'rejected'|'cancelled'` and
  `labels: { pending: string; approved: string; rejected: string; cancelled: string }`.
  Consumed by Home (Task 8) and My Requests (Task 10), replacing both copies of `STATUS_COLORS`.

- [ ] **Step 1: Write the failing test** `tests/unit/status-badge.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from '@/components/StatusBadge';

const labels = { pending: 'در انتظار', approved: 'تأیید شد', rejected: 'رد شد', cancelled: 'لغو شد' };

describe('StatusBadge', () => {
  it('renders the localized label for the status', () => {
    render(<StatusBadge status="approved" labels={labels} />);
    expect(screen.getByText('تأیید شد')).toBeTruthy();
  });
  it('applies a status-specific class', () => {
    const { container } = render(<StatusBadge status="rejected" labels={labels} />);
    expect(container.firstChild).toHaveProperty('className');
    expect((container.firstChild as HTMLElement).className).toContain('destructive');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- status-badge`
Expected: FAIL ("Cannot find module '@/components/StatusBadge'").

- [ ] **Step 3: Implement** `components/StatusBadge.tsx`

```tsx
import { Badge } from '@/components/ui/badge';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
type Labels = Record<Status, string>;

const STYLES: Record<Status, string> = {
  pending: 'bg-warning-foreground text-warning border-warning/20',
  approved: 'bg-success-foreground text-success border-success/20',
  rejected: 'bg-destructive/10 text-destructive border-destructive/20',
  cancelled: 'bg-muted text-muted-foreground border-border',
};

export function StatusBadge({ status, labels }: { status: Status; labels: Labels }) {
  return (
    <Badge variant="outline" className={STYLES[status]}>
      {labels[status]}
    </Badge>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- status-badge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/StatusBadge.tsx tests/unit/status-badge.test.tsx
git commit -m "feat(ui): StatusBadge primitive (single status-color source)"
```

---

### Task 5: Responsive `AppShell` + `MainNav` + `PageHeader` + Toaster

**Files:**
- Create: `app/[locale]/(app)/_components/AppShell.tsx`, `MainNav.tsx`, `PageHeader.tsx`
- Modify: `app/[locale]/(app)/layout.tsx`
- Remove: `app/[locale]/(app)/_components/BottomNav.tsx` (superseded by `MainNav`)
- Test: `tests/unit/main-nav.test.tsx`; existing `tests/e2e/*` nav assertions

**Interfaces:**
- Consumes: `tabsForRoles(roles)` from `lib/nav/tabs.ts` (unchanged).
- Produces: `<AppShell roles locale labels>{children}</AppShell>` rendering an app bar, `MainNav`, the content container, and the Sonner `<Toaster />`. `MainNav` keeps the existing `data-testid="nav-${key}"` on each link.

- [ ] **Step 1: Write the failing test** `tests/unit/main-nav.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MainNav } from '@/app/[locale]/(app)/_components/MainNav';

vi.mock('next/navigation', () => ({ usePathname: () => '/fa/home' }));

const labels = { home: 'خانه', request: 'درخواست', calendar: 'تقویم', profile: 'پروفایل', manage: 'مدیریت' };

describe('MainNav', () => {
  it('renders a link per role-visible tab with its testid', () => {
    render(<MainNav roles={['employee']} locale="fa" labels={labels} />);
    expect(screen.getByTestId('nav-home')).toBeTruthy();
    expect(screen.getByTestId('nav-profile')).toBeTruthy();
    expect(screen.queryByTestId('nav-manage')).toBeNull();
  });
  it('shows the manage tab for managers', () => {
    render(<MainNav roles={['manager']} locale="fa" labels={labels} />);
    expect(screen.getByTestId('nav-manage')).toBeTruthy();
  });
});
```

(Use the project's existing testid query helper; if none, swap `getByTestId` for `container.querySelector('[data-testid="nav-home"]')`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- main-nav`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `MainNav.tsx`** — keep the existing SVG icon set from `BottomNav.tsx`, render as **bottom bar on mobile, vertical side rail at `md:`**:

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { tabsForRoles, type TabKey } from '@/lib/nav/tabs';
import { cn } from '@/lib/utils';
import { NAV_ICONS } from './nav-icons'; // extract the <Svg> icon map from the old BottomNav into nav-icons.tsx

type Props = { roles: string[]; locale: string; labels: Record<TabKey, string> };

export function MainNav({ roles, locale, labels }: Props) {
  const pathname = usePathname();
  const tabs = tabsForRoles(roles);
  const isActive = (href: string) => {
    const full = `/${locale}${href}`;
    return href === '/home' ? pathname === full : pathname === full || pathname.startsWith(`${full}/`);
  };
  return (
    <nav
      aria-label="Primary"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card', // mobile bottom bar
        'md:inset-y-0 md:end-auto md:start-0 md:w-60 md:border-t-0 md:border-e md:pt-4' // desktop side rail (logical: start/end)
      )}
    >
      <ul className="mx-auto flex max-w-2xl justify-around md:mx-0 md:max-w-none md:flex-col md:gap-1 md:px-3">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.key} className="flex-1 md:flex-none">
              <Link
                href={`/${locale}${tab.href}`}
                data-testid={`nav-${tab.key}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors',
                  'md:min-h-0 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:py-2.5 md:text-sm',
                  active ? 'text-primary md:bg-secondary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span aria-hidden="true">{NAV_ICONS[tab.key]}</span>
                <span>{labels[tab.key]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

Also create `app/[locale]/(app)/_components/nav-icons.tsx` exporting `NAV_ICONS` (move the `Svg` component + the `ICONS` map verbatim out of the old `BottomNav.tsx`).

- [ ] **Step 4: Implement `PageHeader.tsx`**

```tsx
export function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {action}
    </div>
  );
}
```

- [ ] **Step 5: Implement `AppShell.tsx`** — app bar + content container + side-rail offset + Toaster:

```tsx
import { Toaster } from '@/components/ui/sonner';
import { MainNav } from './MainNav';
import type { TabKey } from '@/lib/nav/tabs';

type Props = { roles: string[]; locale: string; labels: Record<TabKey, string>; appName: string; children: React.ReactNode };

export function AppShell({ roles, locale, labels, appName, children }: Props) {
  return (
    <div className="min-h-dvh md:ps-60">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/90 px-4 backdrop-blur">
        <span className="font-bold text-primary">{appName}</span>
        <div className="size-8 rounded-full bg-secondary" aria-hidden />
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-5 pb-24 md:max-w-4xl md:pb-8">{children}</main>
      <MainNav roles={roles} locale={locale} labels={labels} />
      <Toaster position="top-center" richColors />
    </div>
  );
}
```

- [ ] **Step 6: Update `app/[locale]/(app)/layout.tsx`** — swap `BottomNav` for `AppShell`, pass `appName` (translate `app.name`, fallback `'بهسازان جنوب'`):

```tsx
import { AppShell } from './_components/AppShell';
// ...inside the component, replace the returned JSX:
return (
  <AppShell roles={roles} locale={locale} labels={labels} appName={t('appName')}>
    {children}
  </AppShell>
);
```

Add `appName` to the `nav` namespace in `messages/fa.json` (`"بهسازان جنوب"`) and `messages/en.json` (`"Behsazan Jonoob"`). Delete `BottomNav.tsx`.

- [ ] **Step 7: Run unit + e2e + build**

Run: `npm run test:unit -- main-nav && npm run test:e2e && npm run build`
Expected: new nav unit test PASS; existing e2e (which click `nav-*`) PASS; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add app/[locale]/(app) messages/fa.json messages/en.json tests/unit/main-nav.test.tsx
git commit -m "feat(ui): responsive AppShell + MainNav (bottom tabs → desktop rail) + Toaster"
```

---

### Task 6: PWA brand color

**Files:**
- Modify: `app/manifest.ts`, `app/[locale]/layout.tsx` (metadata `themeColor`)

- [ ] **Step 1: Update `app/manifest.ts`** — set `theme_color: '#2E3C92'` and `background_color: '#F7F8FB'`.

- [ ] **Step 2: Add viewport theme color** in `app/[locale]/layout.tsx`:

```tsx
import type { Viewport } from 'next';
export const viewport: Viewport = { themeColor: '#2E3C92' };
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds; `/manifest.webmanifest` shows the brand color.

- [ ] **Step 4: Commit**

```bash
git add app/manifest.ts app/[locale]/layout.tsx
git commit -m "feat(pwa): brand theme-color (#2E3C92)"
```

---

## Phase B — Screen reskins

Each task: swap raw markup for primitives, keep all `data-testid`s, run that screen's tests, commit. The data flow, server actions, and state logic are unchanged unless noted.

### Task 7: Login

**Files:** Modify `app/[locale]/(auth)/login/page.tsx`

- [ ] **Step 1:** Wrap the form in `Card`/`CardContent`; replace the two `<input>`s with `Input` + `Label`; replace the submit `<button>` with `Button` (full-width, `disabled={loading}`). Keep `noValidate`, `autoComplete`, the `role="alert"` error `<p>` (style with `text-destructive`), and `router.push` logic verbatim. Add a brand wordmark above the title.
- [ ] **Step 2:** Run: `npm run test:e2e -- login` (and any auth specs). Expected: PASS.
- [ ] **Step 3:** Visual check at 375px + 1280px (login centered, branded).
- [ ] **Step 4:** Commit: `git commit -am "feat(ui): reskin login onto card/input/button"`

### Task 8: Home board

**Files:** Modify `app/[locale]/(app)/home/HomeBoard.tsx`, `home/page.tsx`

**Preserve testids:** `home-board`, `home-approvals-card`.

- [ ] **Step 1:** Replace the three `<section>`s with `Card`/`CardHeader`/`CardTitle`/`CardContent`. Render balances as a metric row (label + big tabular number). Replace the inline status `<span>` + local `STATUS_COLORS` with `<StatusBadge status labels />` (Task 4) — delete the local `STATUS_COLORS` map and `statusLabel` ternary, pass `labels` mapped to `{pending,approved,rejected,cancelled}`. Keep `home-approvals-card` on the approvals `Link` (wrap in `Card` styling). Replace empty `—`/"no items" with `EmptyState`.
- [ ] **Step 2:** In `home/page.tsx`, make the balances/recent/team a responsive grid: `className="grid gap-4 md:grid-cols-2"`.
- [ ] **Step 3:** Run: `npm run test:e2e -- home` + `npm run test:unit`. Expected: PASS.
- [ ] **Step 4:** Commit: `git commit -am "feat(ui): reskin home board (cards, metrics, StatusBadge, desktop grid)"`

### Task 9: Leave request form (+ lazy date picker, refresh-not-reload)

**Files:** Modify `app/[locale]/(app)/request/LeaveRequestForm.tsx`; Create `app/[locale]/(app)/request/LazyDatePicker.tsx`

**Preserve testids:** `leave-preview`, `working-days-count`, `balance-display`, `success-msg`, `error-msg`.

- [ ] **Step 1: Extract a lazy date picker** `LazyDatePicker.tsx`:

```tsx
'use client';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

export const LazyDatePicker = dynamic(
  () => import('react-multi-date-picker').then((m) => m.default),
  { ssr: false, loading: () => <Skeleton className="h-10 w-full" /> }
);
```

Replace the direct `import DatePicker from 'react-multi-date-picker'` usage in the form with `LazyDatePicker` (same props). The `react-date-object` calendar/locale imports stay (they are tiny config objects, not the heavy UI).

- [ ] **Step 2:** Replace form controls: `<select>`→`Select`, `<textarea>`→`Textarea`, labels→`Label`, wrap groups in a `Field` helper or `<div className="space-y-1.5">`, submit→`Button`. Put the form in a `Card`. Style the preview/success/error blocks with `bg-secondary/`/`text-success`/`text-destructive` while **keeping their `data-testid`s and text**.
- [ ] **Step 3: Replace the full reload.** Change `window.location.reload()` to a `router.refresh()`:

```tsx
import { useRouter } from 'next/navigation';
// const router = useRouter();
// on success, after clearing fields:
router.refresh();
```

Add `revalidatePath` to the `submitRequest` server action in `lib/actions/leave.ts` (revalidate the request route) so the server data refetches.

- [ ] **Step 4:** Run: `npm run test:e2e -- request` (covers preview, balance, submit). Expected: PASS. Verify in the network tab the date-picker chunk loads only when the field mounts.
- [ ] **Step 5:** Commit: `git commit -am "feat(ui): reskin request form, lazy date picker, refresh not reload"`

### Task 10: My Requests (AlertDialog cancel + toast)

**Files:** Modify `app/[locale]/(app)/request/MyRequestsList.tsx`

**Preserve testids:** `request-row-${id}`, `status-badge-${id}`, `cancel-btn-${id}`.

- [ ] **Step 1:** Replace each row container with `Card`; replace the status `<span>` + local `STATUS_COLORS` with `<StatusBadge>` (keep `data-testid="status-badge-${id}"` on the badge). Keep the row/cancel testids.
- [ ] **Step 2: Replace `confirm()`** with `AlertDialog` (trigger = the cancel `Button variant="ghost" className="text-destructive"`, keep `data-testid="cancel-btn-${id}"`); the dialog's confirm action calls the existing `handleCancel`. Use `labels.cancelApprovedConfirm`/`cancelConfirm` as the dialog description.
- [ ] **Step 3: On success/error, fire a toast** via `import { toast } from 'sonner'` (`toast.success(labels.cancelSuccess)` / `toast.error(res.error)`) in addition to the existing inline error state.
- [ ] **Step 4:** Run: `npm run test:e2e -- cancel` (the cancel-approved + pending specs). **If a spec relied on `window.confirm`**, update it to click the AlertDialog confirm button in the same commit. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -am "feat(ui): reskin my-requests, AlertDialog cancel, toast feedback"`

### Task 11: Calendar

**Files:** Modify `app/[locale]/(app)/calendar/CalendarView.tsx`, `calendar/page.tsx`
- [ ] **Step 1:** Wrap in `Card`; use `--border`/`--muted` tokens for grid lines and day cells; keep the leave-type color dots (`style={{ backgroundColor }}`) and any testids. Ensure RTL day order reads correctly (logical utilities). `PageHeader` for the title.
- [ ] **Step 2:** Run: `npm run test:e2e -- calendar`. Expected: PASS.
- [ ] **Step 3:** Commit: `git commit -am "feat(ui): reskin team calendar"`

### Task 12: Approvals queue

**Files:** Modify `app/[locale]/(app)/manage/approvals/ApprovalQueue.tsx`, `approvals/page.tsx`
- [ ] **Step 1:** Render each pending request as a `Card`; approve/reject as `Button` (`default` / `variant="outline"` or `destructive`); show `StatusBadge` where status appears; success/error → `toast`. Preserve all testids used by the approvals e2e.
- [ ] **Step 2:** Run: `npm run test:e2e -- approval`. Expected: PASS.
- [ ] **Step 3:** Commit: `git commit -am "feat(ui): reskin approvals queue"`

### Task 13: Manage employees (list + new + edit)

**Files:** Modify `manage/employees/page.tsx`, `manage/employees/new/NewEmployeeForm.tsx`, `manage/employees/[id]/EditEmployeeForm.tsx`, `manage/layout.tsx`
- [ ] **Step 1:** `manage/layout.tsx`: add `PageHeader` + a desktop-friendly container. Employees list: render as a `Card`-wrapped table on `md:` (columns) and stacked cards on mobile; "new employee" as a `Button` link. Forms: `Input`/`Select`/`Label`/`Button`, grouped in `Card` sections; replace the duplicated `INPUT_CLASS` strings. Keep every testid and the server-action calls.
- [ ] **Step 2:** Run: `npm run test:e2e -- employee`. Expected: PASS.
- [ ] **Step 3:** Commit: `git commit -am "feat(ui): reskin manage employees (list + forms)"`

### Task 14: Manage allocations

**Files:** Modify `manage/allocations/AllocateForm.tsx`, `allocations/page.tsx`
- [ ] **Step 1:** Form onto `Card` + `Select`/`Input`/`Button`; result/error → styled callouts or `toast`. Preserve testids + action calls.
- [ ] **Step 2:** Run: `npm run test:e2e -- alloc` (or the allocations spec). Expected: PASS.
- [ ] **Step 3:** Commit: `git commit -am "feat(ui): reskin allocations form"`

### Task 15: Manage settings (work settings + holiday editor)

**Files:** Modify `manage/settings/WorkSettingsForm.tsx`, `manage/settings/HolidayEditor.tsx`, `settings/page.tsx`
- [ ] **Step 1:** Two `Card` sections. Work settings: weekend-day toggles as a checkbox/toggle row using primitives; Holiday editor: list rows as cards with a `Button variant="destructive"` (AlertDialog confirm) for delete, `Input`(date)+`Button` to add. Keep testids + the direct-RLS action calls.
- [ ] **Step 2:** Run: `npm run test:e2e -- settings`. Expected: PASS.
- [ ] **Step 3:** Commit: `git commit -am "feat(ui): reskin work-settings + holiday editor"`

### Task 16: Profile (settings + password)

**Files:** Modify `profile/SettingsForm.tsx`, `profile/ChangePasswordForm.tsx`, `profile/page.tsx`

**Preserve testids:** `password-form`, `password-success`, `password-error`, `password-submit` (+ settings testids).

- [ ] **Step 1:** Two `Card` sections (calendar/language preferences; password change). Replace the duplicated `INPUT_CLASS` with `Input`; labels→`Label`; submit→`Button`. Keep the `validatePassword` flow, the `role="status"`/`role="alert"` messages, and all testids. Add a logout `Button` if currently only in nav.
- [ ] **Step 2:** Run: `npm run test:e2e -- password` + settings specs. Expected: PASS.
- [ ] **Step 3:** Commit: `git commit -am "feat(ui): reskin profile (settings + password)"`

---

## Phase C — Cross-cutting polish

### Task 17: Suspense + skeletons for data sections

**Files:** Modify `home/page.tsx`, `request/page.tsx`, `calendar/page.tsx`, `manage/*/page.tsx`; Create `components/Skeletons.tsx`
- [ ] **Step 1:** Add `components/Skeletons.tsx` with `CardSkeleton`/`ListSkeleton` built from `Skeleton`. Wrap each server-data section in `<Suspense fallback={<…Skeleton/>}>` (extract the data-fetching part into an async child component where needed).
- [ ] **Step 2:** Run: `npm run test:e2e`. Expected: PASS (loading states resolve to the same content).
- [ ] **Step 3:** Commit: `git commit -am "feat(ui): suspense + skeletons for data sections"`

### Task 18: Native dialog/alert sweep + focus polish

**Files:** repo-wide grep
- [ ] **Step 1:** Run `grep -rn "confirm(\|alert(" app lib` — ensure none remain (all replaced by AlertDialog/toast). Replace any stragglers.
- [ ] **Step 2:** Verify focus-visible rings are consistent (primitives use `--ring`); fix any custom control still using ad-hoc `focus:ring-*`.
- [ ] **Step 3:** Run: `npm run lint && npm run test:unit && npm run test:e2e`. Expected: PASS.
- [ ] **Step 4:** Commit: `git commit -am "chore(ui): remove native confirm/alert, unify focus rings"`

### Task 19: Final verification

- [ ] **Step 1:** Run the full gate:

```bash
npm run lint && npm run test:unit && npm run test:e2e && npm run build
```
Expected: all green (65+ unit, 20+ e2e), build succeeds.

- [ ] **Step 2: Manual pass** — at 375px and 1280px, in **fa (RTL)** and **en (LTR)**: login, home, request (date picker opens, submit refreshes), my-requests (cancel dialog + toast), calendar, approvals, each manage screen, profile. Confirm: brand consistent, bottom-tabs on mobile / side-rail on desktop, no hydration flash, no white-on-dark.
- [ ] **Step 3:** Update `docs/CHANGELOG.md` + `docs/TASKS.md` (note the overhaul shipped). Commit: `git commit -am "docs: record frontend overhaul"`

---

## Self-Review (completed by plan author)

- **Spec coverage:** §4 tokens → Task 2; §5 typography → Task 2; §6 components → Tasks 1,3,4; §7 shell/responsive → Task 5; §8 RTL → Task 3 (`migrate rtl`) + logical utilities throughout; §9 per-screen → Tasks 7–16; §10 perf/UX → Tasks 9 (lazy + refresh), 10 (dialog/toast), 17 (suspense), 18 (sweep); §11 phasing → A/B/C; §12 testing → every task + Task 19; PWA/NFR-2 → Task 6. No uncovered section.
- **Placeholder scan:** OKLCH values are concrete (computed); the only deferred item is the Vazirmatn weight subset, with a download command given. No "TBD/handle edge cases".
- **Type consistency:** `StatusBadge`'s `status`/`labels` shape (Task 4) matches its consumers (Tasks 8, 10); `MainNav` props match `AppShell` (Task 5) and `tabsForRoles` (unchanged).
