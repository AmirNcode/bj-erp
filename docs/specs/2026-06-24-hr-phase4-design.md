# Design Spec — HR / Time-Off Phase 4 (Home board, Nav, Settings)

- **Date**: 2026-06-24
- **Status**: Approved (design). Implementation plan pending.
- **Module / phase**: HR → Time-Off, **Phase 4** (UI shell & polish). Builds on Phases 0–3
  (auth, org, leave core, approval flow, reason-private calendar) on branch `feat/hr-timeoff-v1`.

Frozen point-in-time record of the approved design. Living detail: `docs/REQUIREMENTS.md`
(FR-20/21/23, NFR-1/7), `docs/PERMISSIONS.md`, `docs/DATA_MODEL.md`.

---

## 1. Context & problem

Phases 0–3 shipped the data + flows but the UI is still a **placeholder home** (a stack of link
buttons) inside an **auth-guard-only shell** (no navigation). Phase 4 turns this into the real
product surface: a role-aware **home status board** (the notification surrogate), a **role-driven
bottom-tab nav**, a **Profile/Settings** page (calendar + language toggles, logout), and a
**responsive + accessibility** pass with a device-detection utility for future modules.

## 2. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| P4-1 | Desktop nav form | **Single responsive bottom-tab bar** (mobile-first; centered max-width on desktop) | One nav to maintain; YAGNI on a separate desktop sidebar. Revisit if desktop dashboards need it. |
| P4-2 | 5th tab for admin/manager | **"Manage" hub tab** → links employees / allocations / approvals | One entry point; avoids a crowded bar. Matches FR-21 "Manage/Approvals tab". |
| P4-3 | Tab affordance | **Inline SVG icons + text labels** (no icon dependency) | Icons aid low-literacy factory users; inline SVG = no new dep, tree-shaken, RTL-safe. |
| P4-4 | Language toggle mechanics | **Persist `language_pref` + swap locale path** (`/fa/…`↔`/en/…`); login redirects to preferred locale | next-intl is path-based; swapping the prefix is the clean switch. Persisted pref drives the post-login redirect. |
| P4-5 | Device detection scope | **Build the utility** (server UA parse + client viewport hook), **do not fork** mobile/desktop UIs | Spec NFR-1 wants detection available for *future* modules; forking UIs now is premature. |
| P4-6 | Logout | **New `signOut` server action** + button on Profile | No logout exists today (carried over from Phase 1). |

**Deferred to Phase 5** (out of Phase 4 scope, per user): admin work-settings + holiday editor UI
(FR-24); self-service password change after first login (FR-7 tail); balance-preview "نامشخص"
propagation-race polish.

## 3. Scope

Delivers **FR-20** (role home status board), **FR-21** (role-driven bottom-tab nav), **FR-23**
(calendar + language toggles, persisted), **NFR-1** (responsive + device detection), **NFR-7**
(accessibility / touch targets). No schema changes — reads/writes use existing tables, RLS, and
server actions.

## 4. Architecture & components

- **Bottom-tab nav** — a client component rendered by `app/[locale]/(app)/layout.tsx` (today
  auth-guard only). Tabs computed from the caller's roles (fetched server-side in the layout and
  passed down): Home · Request · Calendar · Profile, + Manage (admin/manager). Active-tab state
  from the pathname; RTL-correct; fixed to the viewport bottom with safe-area padding. Page
  content gets bottom padding so the bar never overlaps.
- **Home status board** — `home/page.tsx` rewritten as a server component composing role-scoped
  cards, each fed by an existing action: `getMyLeaveRequests` (my statuses), leave balances per
  type (from `leave_ledger`), team upcoming time-off (`getCalendarEntries`), and — for
  managers/admins — `getPendingApprovals` (queue count + quick list). A small **pure view-model
  helper** (`lib/home/board.ts`) shapes the cards per role (unit-tested).
- **Profile / Settings** — `profile/page.tsx` (server: shows name/code, reads prefs) + a client
  `SettingsForm` with two toggles (calendar jalali/gregorian, language fa/en) and a logout button.
  Toggles call a `updateMyPrefs` server action (writes `calendar_pref`/`language_pref` to
  `profiles`; self-update is within the RLS-allowed column subset). Language change also navigates
  to the mirrored locale path.
- **Device detection** — `lib/device.ts`: `parseDeviceType(userAgent): 'mobile' | 'desktop'`
  (pure, unit-tested) used server-side via request headers; `lib/device/useViewport.ts`: a client
  hook exposing viewport width / breakpoint. Provided for future modules; Phase 4 only uses it to
  confirm responsive behavior.
- **Logout** — `signOut` server action (`supabase.auth.signOut()` → redirect `/login`).
- **i18n** — new `nav`, `home`, `profile`/`settings` message keys in `messages/{fa,en}.json`.

Component boundaries: nav (presentation + role→tabs), board (per-role view-model + cards),
settings (prefs form + logout). Each independently testable; no schema or RLS changes.

## 5. Key user flows

1. **Any user** logs in → lands on **Home** showing their statuses + balances + team time-off; the
   bottom-tab bar is always present.
2. **Manager/Admin** sees an extra **pending-approval** card on Home and a **Manage** tab.
3. **Settings**: user opens **Profile** → flips calendar or language → preference persists; language
   flip re-renders in the other locale/direction; next login honors it.
4. **Logout** from Profile → session cleared → `/login`.

## 6. Testing

- **Unit (Vitest, pure):** `parseDeviceType` (UA strings → mobile/desktop); `tabsForRoles(roles)`
  (correct tab set incl. Manage gating); home-board view-model (`board.ts`) shaping per role.
- **e2e (Playwright):** bottom-tab nav shows the right tabs per role (employee vs manager vs admin)
  and navigates; Profile toggles persist across reload; language toggle switches locale/direction;
  logout returns to `/login`; Home renders role-appropriate cards (manager sees the approvals card).

## 7. Out of scope (Phase 4)

Admin work-settings/holiday UI (FR-24), self-service password change (FR-7 tail), and the
balance-preview race polish — all **Phase 5**. No new tables, enums, RLS policies, or SQL functions.
