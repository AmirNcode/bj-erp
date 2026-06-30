# Design — UI overhaul + allocation-at-create/edit (2026-06-30)

Frozen design record. Scope: eight user-requested changes — seven UI/UX, one feature (leave
allocation folded into the employee create/edit flow). Builds on the frontend overhaul
(`2026-06-27-frontend-overhaul-design.md`).

## Decisions locked

- **Light theme only. No dark mode, no theme toggle.** (User: "cancel the dark theme entirely…
  only light.") The "too dark / transparent navbar / border-only panels / text-only buttons" in the
  reported screenshots are **Chrome's Auto Dark Theme** re-coloring a page that never declared a
  `color-scheme`. Fix = opt out of auto-dark and lock to light; do **not** add `.dark` tokens or
  `next-themes`.
- **Font = Rubik for Latin/numerals, Vazirmatn fallback for Persian.** Rubik has no Arabic/Persian
  glyphs; the browser falls back per-glyph to Vazirmatn. Stack: `Rubik, Vazirmatn, system…`.
- **Edit-balance = set an absolute target via an `adjustment` ledger row** (auditable), NOT additive.
  The existing `allocate_leave` only adds; the edit field means "this person now has N days."
- **Allocation period = current calendar year** (Jan 1 – Dec 31).
- **Balance-affecting types identified by `affects_balance = true`** (Annual = "PTO", Sick) — no
  name-matching. Unpaid (affects_balance = false) is excluded.
- **Preserve every `data-testid`, fa/en message parity, RLS / SECURITY-DEFINER pattern.** Unit + e2e
  stay green.

## 1. Light-only theming (items 3, 4, 5, 7 root cause)

- `app/globals.css` `:root` gains `color-scheme: light;`. `app/[locale]/layout.tsx` adds
  `<meta name="color-scheme" content="light" />` (and/or `viewport.colorScheme`). Confirms no
  `@media (prefers-color-scheme)` exists anywhere (verified: none).
- Palette refinement for surface separation (item 5): keep page `--background` near-white but a
  touch cooler; cards stay pure white (`--card: white`) with a slightly stronger `shadow-sm` +
  border so panels visibly sit above the page. Tune in `globals.css` only.
- App bar + bottom nav forced fully opaque (item 3): bottom `MainNav` already `bg-card`; make app
  bar `bg-card` (drop the `/90` translucency or keep blur with an opaque base) and add a soft
  shadow. No see-through after auto-dark is gone.
- Inert `dark:` utility classes already present in shadcn primitives are harmless (no `.dark`
  ancestor ever) — left as-is.

## 2. Font → Rubik + Vazirmatn (item 8)

- Copy `assets/Rubik/Rubik-VariableFont_wght.ttf` (+ italic) into `app/fonts/`.
- `app/[locale]/layout.tsx`: register a second `next/font/local` (`--font-rubik`, weight `300 900`,
  `display: swap`); apply both `rubik.variable` and `vazirmatn.variable` to `<html>`.
- `globals.css` `--font-sans` → `var(--font-rubik), var(--font-vazirmatn), ui-sans-serif, system-ui,
  sans-serif`. RTL/layout unchanged.

## 3. Company logo in app bar (item 2)

- Copy `assets/bj-logo.png` → `public/bj-logo.png`.
- `AppShell` header: render the logo (`next/image`, fixed height ~28px, `priority`) inline-start of
  the company name. Reuse on the login screen wordmark. Alt text via i18n (`brand`/`nav.appName`).

## 4. Active-tab highlight (item 6)

`app/[locale]/(app)/_components/MainNav.tsx`:
- Desktop side rail active: `bg-primary/10 text-primary` pill + a leading (inline-start) accent bar.
- Mobile bottom active: `text-primary` + filled tint behind the icon + a top indicator line.
- Inactive stays `text-muted-foreground hover:text-foreground`. `aria-current="page"` kept.

## 5. Prominent buttons (item 7)

- Primary CTAs use the solid `default` (`bg-primary`) variant; secondary = `outline`. Add modest
  shadow/weight in `button.tsx` `default` variant for presence.
- Audit each screen so the main action (Approve, Submit, Save, Allocate, login) is filled, not
  ghost/link. AlertDialog confirm actions filled. No behavior/ testid change.

## 6. Allocation at create + edit (item 1) — the one backend change

### Migration (new): `set_leave_balance`
```
set_leave_balance(p_employee_id uuid, p_leave_type_id uuid, p_target numeric) returns numeric
  SECURITY DEFINER, search_path=''
  - guard: private.is_admin(auth.uid()) else raise 42501
  - validate p_target >= 0 else raise 22023
  - v_current := public.current_leave_balance(p_employee_id, p_leave_type_id)
  - if v_current = p_target: return p_target (no-op, no ledger row)
  - insert leave_ledger(entry_type='adjustment', delta_days = p_target - v_current,
      balance_after = p_target, note='admin balance set')
  - insert audit_log('set_leave_balance', 'leave_ledger', ...)
  - return p_target
  grants: revoke anon/public; grant authenticated (self-guarded by is_admin).
```
Mirrors the `allocate_leave` pattern. Types regenerated.

### Create employee (`NewEmployeeForm` + page + action)
- Page server-fetches active `affects_balance = true` types (Annual, Sick) and passes to the form.
- Form adds a number input per type, Annual prefilled from `default_annual_quota_days` (26), Sick
  default 0. New testids `alloc-days-<type_en_slug>` (e.g. `alloc-days-annual-leave`).
- On `createEmployee` success → for each type with days > 0, call the existing admin-guarded
  `allocateLeave` action (`allocate_leave` RPC), period = current year. Errors surface but the
  employee already exists (temp-password screen still shown); allocation failure shown as a warning.

### Edit employee (`EditEmployeeForm` + page + actions)
- Admin only. Page fetches each balance-affecting type + the employee's **current balance** (latest
  `leave_ledger.balance_after` per type; admin reads via `can_read_all` RLS).
- Form shows a number input per type prefilled with the current balance. New testids
  `balance-<type_en_slug>`.
- On save → pure `balanceAdjustments(current[], desired[])` yields only changed types → call new
  `setLeaveBalance(empId, typeId, target)` action per change. Field means "current available days."
- `/manage/allocations` stays unchanged for ad-hoc grants.

### New code
- `lib/actions/leave.ts`: `setLeaveBalance(employeeId, leaveTypeId, target)` (wraps RPC);
  `getEmployeeBalances(employeeId)` (admin read of latest balance per active type).
- `lib/leave/allocations.ts` (pure): `currentYearPeriod()` → `{start,end}`; `balanceAdjustments(
  current, desired)` → list of `{leaveTypeId, target}` that differ. Unit-tested.

## 7. i18n

New keys in BOTH `messages/fa.json` + `messages/en.json` (parity): allocation/ balance labels
(`manage.alloc.annual`, `manage.alloc.sick`, `manage.balances.title`, helper text), logo alt if
needed. No key removed.

## 8. Testing

- **Unit (Vitest):** `balanceAdjustments` (no-change, partial, all-change, new-from-zero),
  `currentYearPeriod`. Keep 73 existing green.
- **e2e (Playwright):** extend `manage.spec` — create an employee with Annual+Sick days, assert the
  balances surface; edit to change a balance, assert the new value. Keep the suite green serial.
- **Migration smoke:** apply `set_leave_balance`, verify grants (anon revoked) + an admin set →
  adjustment ledger row with correct `balance_after`.

## Out of scope / non-goals

Dark mode, theme toggle, entitlement-vs-balance separation, hourly leave, per-type custom periods,
notifications. Holiday list and other v1 features untouched.

## Risks

- Auto-dark fix relies on `color-scheme: light` + meta; verify on Android Chrome after build.
- `set_leave_balance` with `target < current` writes a negative-delta adjustment (intentional admin
  correction); guarded `>= 0`. Balance may exceed prior entitlement when raised — by design.
- Rubik italic optional; if omitted, italics synthesize — acceptable.
