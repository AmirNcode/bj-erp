# Frontend Overhaul — Design Spec

- **Date:** 2026-06-27
- **Status:** Approved (brainstorm) → ready for implementation plan
- **Scope:** Cross-cutting UI/UX for the HR module (all screens)
- **Brand:** Behsazan Jonoob (بهسازان جنوب) — royal blue + white

## 1. Context & problem

The UI was never designed — it is the `create-next-app` starter with feature code
bolted on. There is no design system. Concrete findings from the code review:

- **No real font.** [`app/globals.css`](../../app/globals.css) hardcodes `font-family: Arial`
  on `body`, overriding the loaded Geist font, and ships **no Persian font** — fatal for a
  Farsi-first RTL app (Persian renders in OS Arial fallback, inconsistent and unprofessional).
- **No tokens / no components.** Every file hardcodes raw Tailwind palette utilities
  (`bg-white`, `text-gray-500`, `text-blue-600`). The status-badge map is duplicated in
  `HomeBoard.tsx` and `MyRequestsList.tsx`; form-input classes are copy-pasted everywhere.
- **Half-broken dark mode.** `globals.css` flips `body` dark on `prefers-color-scheme: dark`
  while components hardcode `bg-white` — dark-mode users get dark page + white cards.
- **No app shell.** The mobile bottom tab bar renders on desktop too ("stretched phone");
  no header, no page titles, no desktop layout.
- **JS-driven layout flash.** `useViewport` (width starts at 0 = desktop until mount) can
  drive layout that snaps after hydration.
- **Slow/janky.** `window.location.reload()` after submit; `react-multi-date-picker` (+ 4
  locale modules) in the initial client bundle; native `confirm()`; no skeletons.

Structurally the app is sound (clean server/client split, next-intl wired, RTL `dir` set,
sensible routes). This is a **skin + system** problem, not a rewrite.

## 2. Goals / Non-goals

**Goals**
- A branded, consistent, professional **light** theme derived from the logo.
- Looks good on **desktop** and is **optimized for mobile** (primary usage).
- Faster + smoother: no hydration flash, lazy heavy deps, no full-page reloads.
- Accessible (focus, keyboard, dialogs, contrast, touch targets) and **RTL-correct**.
- All existing behavior and tests preserved (65 unit / 20 e2e green throughout).

**Non-goals**
- No backend, schema, RLS, or business-logic changes.
- No new product features.
- No dark mode in v1 (tokens leave the door open for it later).
- No route/IA restructuring beyond adding the app shell.

## 3. Decisions (summary)

| Decision | Choice |
|---|---|
| Component foundation | **shadcn/ui** (`new-york`, `cssVariables: true`, base **slate**) + Radix |
| Theme | Brand-blue tokens in **OKLCH** via Tailwind v4 `@theme inline` |
| Font | **Vazirmatn** (self-hosted via `next/font/local`), Persian + Latin |
| Dark mode | **Light-only** for v1 |
| Scope | **All screens** |
| Responsiveness | **CSS breakpoints** drive layout; JS detection kept only as NFR-1 primitive |
| Confirms / feedback | **AlertDialog** + **Sonner** toasts (replace `confirm()` / reload) |

shadcn/ui verified (Context7) against the stack: **Tailwind v4 + React 19** fully supported
(CLI init, `@theme`, OKLCH, `data-slot`); **RTL** supported via `npx shadcn migrate rtl` +
CSS-variable theming. Components are copied **into** the repo (MIT, no runtime lock-in) —
compatible with NFR-4 self-hosted production.

## 4. Design tokens & theme

Rewrite `app/globals.css`: remove the Arial override and the `prefers-color-scheme` block;
keep `@import "tailwindcss"`; define brand tokens and map them through `@theme inline` and
shadcn's semantic variables.

**Palette (hex = source of truth; exact OKLCH generated at implementation):**

| Role | Hex | Usage |
|---|---|---|
| Primary | `#2E3C92` | buttons, active nav, app bar, links |
| Primary hover | `#25307A` | hover/pressed |
| Primary deep | `#1C2660` | headings on tint, emphasis |
| Accent | `#3A49B0` | secondary emphasis |
| Tint surface | `#E7E9F6` | selected nav, subtle brand fills |
| Page tint | `#F3F4FB` | app background wash |
| Ink (text) | `#14161D` | primary text |
| Secondary text | `#3A3F4B` | labels |
| Muted | `#6B7280` | hints, metadata |
| Border | `#CBD2DC` / hairline `#E2E6EE` | dividers, inputs |
| Surface | `#FFFFFF` | cards |
| Page | `#F7F8FB` | body background |

**Semantic / status** (kept meaningful, softened): success `#15803D` on `#DCFCE7`,
warning `#B45309` on `#FEF3C7`, danger `#B91C1C` on `#FEE2E2`, neutral/cancelled `#6B7280`
on `#EEF1F5`. A single `StatusBadge` component owns this map (removes the duplication).

**shadcn token mapping:** `--primary` = brand primary, `--primary-foreground` = white,
`--ring` = primary, `--radius` = `0.75rem` (12px), `--background`/`--foreground`/`--muted`/
`--border`/`--input`/`--card` mapped to the neutrals above. Status colors exposed as
`--success`/`--warning`/`--destructive` (+ foregrounds).

## 5. Typography

- **Vazirmatn** added via `next/font/local` (self-hosted woff2 in `app/fonts/`) bound to
  `--font-sans`; covers Persian + Latin, so one family unifies fa/en. (Self-hosting, not the
  Google CDN, satisfies NFR-4 portability and works offline / in self-hosted prod.)
- Geist removed (latin-only, was overridden anyway). `--font-mono` optional (kept for code/ids).
- **Tabular, lining numerals** for balances, day counts, dates (`font-variant-numeric`).
- Jalali ↔ Gregorian formatting already lives at the format layer — **unchanged**.

## 6. Component system (shadcn/ui)

`npx shadcn init` (Tailwind v4 mode), then add primitives, themed by the tokens above:

**Primitives:** Button, Card, Input, Label, Select, Textarea, Badge, Dialog, AlertDialog,
Popover, Sonner (toast), Skeleton, Avatar, Separator, Sheet (mobile drawer), DropdownMenu, Tabs.

**App-specific components** (composed from primitives, owning current duplication):
- `StatusBadge` — the single status→color map.
- `AppShell` / `AppBar` / `MainNav` — shell + responsive navigation.
- `Field` — label + control + error wrapper for the forms.
- `PageHeader` — title + optional action, per screen.
- `EmptyState` — replaces bare `—` / "no items" text.

## 7. App shell & responsive strategy

- **`AppShell`** wraps `(app)/layout.tsx`: a **top app bar** (page title + user avatar/menu
  with logout + settings) and a **primary nav** that is a **bottom tab bar on mobile** and a
  **left side-rail at `md:` (≥768px)**. Content sits in a `max-w` container with comfortable
  padding. The "stretched phone" look is gone on desktop.
- **Layout is CSS-breakpoint driven** (`sm:`/`md:`/`lg:`), never gated on `useViewport`.
  Desktop uses the extra width: Home cards become a responsive grid; manage tables go
  full-width with proper columns; forms cap at a readable measure.
- **NFR-1 detection primitives retained:** `parseDeviceType` (server UA) and `useViewport`
  stay as primitives "for future modules to serve mobile vs desktop variants." They must not
  drive the current layout. `useViewport` documented as detection-only.
- **PWA:** keep `manifest.ts`; set `theme-color` = `#2E3C92`; ensure installable + safe-area
  insets on the bottom nav (already present).

## 8. RTL & i18n

- next-intl already sets `dir` on `<html>` (NFR-3). Run `npx shadcn migrate rtl` so primitives
  use logical properties + RTL variants; author all new layout with logical utilities
  (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`), never `ml-`/`pl-`/`left-`.
- Direction-aware: chevrons/arrows mirror; `react-multi-date-picker` calendar position stays
  bound to calendar pref (already handled).
- All new strings go through `messages/fa.json` + `messages/en.json` (no hardcoded copy).

## 9. Per-screen redesign

Same data + server actions + logic; new components; **`data-testid`s preserved**.

- **Login** — centered branded card, logo lockup, `Input`/`Button`, inline error, consistent ring.
- **Home** — `PageHeader`; balances as metric `Card`s (grid on desktop); recent + team as
  clean list rows with `StatusBadge`; approvals as a prominent action card (manager/admin).
- **Request** — form on `Card`s via `Field`; `Select` for type/day-part; date picker in a
  `Popover`, lazy-loaded; live working-days/balance preview as a styled callout.
- **My Requests** — request `Card`s; `StatusBadge`; cancel via **AlertDialog** (not `confirm()`);
  success/error via **toast**; refresh via `router.refresh()` (no reload).
- **Calendar** — reskinned team calendar; legible RTL day cells; type color dots.
- **Approvals** — queue as cards/table with approve/reject in confirmable actions + toasts.
- **Manage (employees / allocations / settings)** — desktop-friendly tables/forms; `Dialog`
  for create/edit where it improves flow; holiday editor + work-settings on `Card`s.
- **Profile** — settings (calendar/language) + password change as grouped `Card` sections.

## 10. Performance & UX fixes

- Replace `window.location.reload()` (LeaveRequestForm) with `router.refresh()` +
  `revalidatePath` in the relevant server actions. Audit other reloads.
- **Lazy-load** `react-multi-date-picker` via `next/dynamic` (`ssr:false`) with a `Skeleton`
  fallback — removes it + 4 locale modules from the initial bundle.
- **Suspense + Skeleton** for data-backed sections (home board, lists, calendar).
- `confirm()`/`alert()` → `AlertDialog`/`toast`. Consistent `focus-visible` rings via `--ring`.
- Keep heavy forms as client components; keep pages/server data fetching on the server.

## 11. Phasing

Each phase ends green (65 unit / 20 e2e) and is independently shippable.

- **Phase A — Foundation:** tokens + `globals.css` rewrite, Vazirmatn, `shadcn init`, base
  primitives, `AppShell`/nav, `theme-color`. Visible reskin of the shell; no logic change.
- **Phase B — Screens:** migrate each screen onto primitives (Section 9), screen by screen,
  preserving `data-testid`s.
- **Phase C — Perf/UX:** `router.refresh()`, lazy datepicker, Suspense/Skeletons, AlertDialog,
  toasts, focus polish.

## 12. Testing & success criteria

- **Existing tests stay green** — `data-testid` contract preserved; behavior unchanged.
  Adjust only selectors that structurally must change, in the same commit.
- **Add:** a smoke test that the new primitives render in RTL; a check that the datepicker
  loads lazily.
- **Success:** consistent branded light theme; strong desktop + mobile layouts; no hydration
  flash; datepicker off the initial bundle; accessible focus/dialogs; RTL correct in fa,
  clean LTR in en; Lighthouse mobile materially improved.

## 13. NFR alignment

NFR-1 responsive + detection (CSS layout + retained detection primitives) · NFR-2 PWA
(manifest + theme-color) · NFR-3 RTL (`migrate rtl` + logical props) · NFR-4 portability
(MIT copied-in components, self-hosted font) · NFR-7 accessibility (Radix a11y, contrast,
touch) · NFR-6 performance (lazy + refresh-not-reload).

## 14. Risks / open questions

- **`migrate rtl` churn** — re-themes/rewrites primitives; run early (Phase A), review diffs,
  verify a few components visually in both directions before proceeding.
- **e2e selector drift** — reskin may move DOM; mitigated by preserving `data-testid`s and
  updating tests in the same commit as each screen.
- **OKLCH conversion** — generate exact values with the shadcn theme generator / tweakcn from
  the hex table; verify contrast (text on primary ≥ 4.5:1).
- **Vazirmatn weights** — ship only the weights used (e.g., 400/500/600/700) to keep the font
  payload small.
