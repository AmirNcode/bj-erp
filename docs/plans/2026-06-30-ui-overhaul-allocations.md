# UI Overhaul + Allocation-at-Create/Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship eight user-requested changes — lock the app to a polished light-only theme, swap to the Rubik font, add the company logo, strengthen the active-tab + button styling, and fold leave allocation (PTO + sick) into the employee create/edit flow.

**Architecture:** Pure CSS/token + font + component edits for the UI items (no new runtime deps). One new admin-guarded `SECURITY DEFINER` RPC (`set_leave_balance`) writes an `adjustment` ledger row so the edit page can set an absolute balance; create reuses the existing additive `allocate_leave`. Pure helpers carry the testable logic.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Supabase (Postgres + RLS) · next-intl (fa/en) · Tailwind v4 + shadcn/ui · next/font/local · Vitest · Playwright.

**Spec:** `docs/specs/2026-06-30-ui-overhaul-allocations-design.md`.

## Global Constraints

- **Light theme only.** No `.dark` classes, no `dark:` *new* usage, no `@media (prefers-color-scheme)`, no `next-themes`, no theme toggle.
- **Preserve every existing `data-testid`** and every e2e selector (ids, `htmlFor`, native `<select>`/checkbox structure).
- **fa/en message parity:** every key added to `messages/en.json` is added to `messages/fa.json` (identical key trees). No key removed.
- **RLS / SECURITY-DEFINER pattern unchanged:** privileged writes go through admin-guarded definer functions; no `service_role` in app; no new client write policy.
- **Gates per task:** relevant Vitest + `npm run build` green; full `npm run test:e2e -- --workers=1` green at the final task. Existing unit count (73) must not regress.
- **Logical RTL utilities only** (`ps/pe/ms/me/start/end`, `border-s/e`). Brand primary `#2E3C92`; `--radius .75rem`.
- **Supabase demo:** project ref `rimshsfkjpwlvjxbxhqm`. Migrations authored as files in `supabase/migrations/`; applied to the demo via Supabase MCP `apply_migration`; types regenerated.

---

### Task 1: Light-only lockdown + opaque chrome + surface polish

**Files:**
- Modify: `app/globals.css` (`:root` add `color-scheme`, tune surfaces)
- Modify: `app/[locale]/layout.tsx` (viewport `colorScheme`)
- Modify: `app/[locale]/(app)/_components/AppShell.tsx` (opaque app bar)
- Test: `tests/unit/theme.test.ts` (extend the existing CSS guard)

**Interfaces:**
- Produces: a light-locked stylesheet other tasks build on. No exported symbols.

- [ ] **Step 1: Extend the guard test (failing)**

In `tests/unit/theme.test.ts` add:

```ts
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

it('locks the page to a light color-scheme', () => {
  expect(css).toMatch(/color-scheme:\s*light/);
});

it('has no dark-mode escape hatches', () => {
  expect(css).not.toMatch(/prefers-color-scheme/);
  expect(css).not.toMatch(/\.dark\b/);
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm run test:unit -- theme`
Expected: FAIL (`color-scheme: light` not found).

- [ ] **Step 3: Edit `app/globals.css`**

In `:root` add `color-scheme: light;` (first line) and cool the page / strengthen card separation:

```css
:root {
  color-scheme: light;
  --radius: 0.75rem;

  /* Surfaces & text */
  --background: oklch(0.9711 0.0060 264.54);   /* page — slightly cooler grey #F2F4F8 */
  --foreground: oklch(0.2013 0.0144 272.55);
  --card: oklch(1 0 0);                          /* pure white panels */
  --card-foreground: var(--foreground);
  /* …rest unchanged… */
}
```

(Only `color-scheme` and the `--background` value change; leave every other token.)

- [ ] **Step 4: Make the app bar opaque — `AppShell.tsx`**

Change the header line so panels/chrome never look see-through:

```tsx
<header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card px-4 shadow-sm">
```

(Drop `bg-card/90 backdrop-blur` → solid `bg-card shadow-sm`.)

- [ ] **Step 5: Declare the scheme at the document level — `app/[locale]/layout.tsx`**

Extend the existing `viewport` export:

```ts
export const viewport: Viewport = {
  themeColor: '#2E3C92',
  colorScheme: 'light',
};
```

- [ ] **Step 6: Run tests + build**

Run: `npm run test:unit -- theme` → PASS
Run: `npm run build` → clean

- [ ] **Step 7: Commit**

```bash
git add app/globals.css app/[locale]/layout.tsx "app/[locale]/(app)/_components/AppShell.tsx" tests/unit/theme.test.ts
git commit -m "fix(ui): lock to light color-scheme (kill Chrome auto-dark) + opaque chrome"
```

---

### Task 2: Font → Rubik (Vazirmatn fallback for Persian)

**Files:**
- Create: `app/fonts/Rubik-VariableFont_wght.ttf`, `app/fonts/Rubik-Italic-VariableFont_wght.ttf` (copied from `assets/Rubik/`)
- Modify: `app/[locale]/layout.tsx` (register Rubik)
- Modify: `app/globals.css` (`--font-sans` stack)
- Test: `tests/unit/theme.test.ts` (assert stack order)

**Interfaces:**
- Produces: `--font-rubik` CSS var on `<html>`; `--font-sans` = Rubik → Vazirmatn → system.

- [ ] **Step 1: Copy the font files**

```bash
cp "assets/Rubik/Rubik-VariableFont_wght.ttf" app/fonts/
cp "assets/Rubik/Rubik-Italic-VariableFont_wght.ttf" app/fonts/
```

- [ ] **Step 2: Guard test (failing)**

Add to `tests/unit/theme.test.ts`:

```ts
it('uses Rubik first, Vazirmatn as the Persian fallback', () => {
  const sans = css.match(/--font-sans:\s*([^;]+);/)?.[1] ?? '';
  expect(sans.indexOf('--font-rubik')).toBeGreaterThanOrEqual(0);
  expect(sans.indexOf('--font-rubik')).toBeLessThan(sans.indexOf('--font-vazirmatn'));
});
```

Run: `npm run test:unit -- theme` → FAIL.

- [ ] **Step 3: Register Rubik in `app/[locale]/layout.tsx`**

Below the `vazirmatn` declaration:

```ts
const rubik = localFont({
  src: [
    { path: './../fonts/Rubik-VariableFont_wght.ttf', style: 'normal', weight: '300 900' },
    { path: './../fonts/Rubik-Italic-VariableFont_wght.ttf', style: 'italic', weight: '300 900' },
  ],
  variable: '--font-rubik',
  display: 'swap',
});
```

Add `rubik.variable` to the `<html>` className:

```tsx
className={`${rubik.variable} ${vazirmatn.variable} h-full antialiased font-sans`}
```

- [ ] **Step 4: Update the stack in `app/globals.css`**

```css
--font-sans: var(--font-rubik), var(--font-vazirmatn), ui-sans-serif, system-ui, sans-serif;
```

- [ ] **Step 5: Test + build**

Run: `npm run test:unit -- theme` → PASS
Run: `npm run build` → clean (fonts resolve)

- [ ] **Step 6: Commit**

```bash
git add app/fonts/Rubik-VariableFont_wght.ttf app/fonts/Rubik-Italic-VariableFont_wght.ttf app/[locale]/layout.tsx app/globals.css tests/unit/theme.test.ts
git commit -m "feat(ui): switch UI font to Rubik with Vazirmatn fallback for Persian"
```

---

### Task 3: Company logo in app bar + login

**Files:**
- Create: `public/bj-logo.png` (copied from `assets/bj-logo.png`)
- Modify: `app/[locale]/(app)/_components/AppShell.tsx`
- Modify: `app/[locale]/(auth)/login/page.tsx`

**Interfaces:**
- Consumes: `appName` prop already passed to `AppShell`.

- [ ] **Step 1: Copy the logo into `public/`**

```bash
cp "assets/bj-logo.png" public/bj-logo.png
```

- [ ] **Step 2: Render it in the app bar — `AppShell.tsx`**

Add `import Image from 'next/image';` at the top. Replace the brand `<span>` with logo + name:

```tsx
<div className="flex items-center gap-2">
  <Image src="/bj-logo.png" alt={appName} width={28} height={28} priority className="size-7 object-contain" />
  <span className="font-bold text-primary">{appName}</span>
</div>
```

- [ ] **Step 3: Add the logo to the login wordmark — `login/page.tsx`**

Add `import Image from 'next/image';`. Replace the brand `<p>` with:

```tsx
<div className="flex flex-col items-center gap-2">
  <Image src="/bj-logo.png" alt={t('brand')} width={48} height={48} priority className="size-12 object-contain" />
  <p className="text-center text-xl font-bold text-primary">{t('brand')}</p>
</div>
```

- [ ] **Step 4: Build + nav e2e**

Run: `npm run build` → clean
Run: `npm run test:e2e -- nav --workers=1` → PASS (header still renders; app name intact)

- [ ] **Step 5: Commit**

```bash
git add public/bj-logo.png "app/[locale]/(app)/_components/AppShell.tsx" "app/[locale]/(auth)/login/page.tsx"
git commit -m "feat(ui): add BJ company logo to app bar and login"
```

---

### Task 4: Active-tab highlight (MainNav)

**Files:**
- Modify: `app/[locale]/(app)/_components/MainNav.tsx`
- Test: `tests/unit/main-nav.test.tsx` (assert active styling)

**Interfaces:**
- Consumes: `tabsForRoles`, `isActive` (unchanged).

- [ ] **Step 1: Extend the unit test (failing)**

The test renders `MainNav` at a pathname. Add an assertion that the active link carries the highlight class. Match the existing render setup in the file; add:

```tsx
// with usePathname mocked to `/fa/home`
const homeLink = screen.getByTestId('nav-home');
expect(homeLink.className).toMatch(/bg-primary\/10/);
expect(homeLink.getAttribute('aria-current')).toBe('page');
```

Run: `npm run test:unit -- main-nav` → FAIL.

- [ ] **Step 2: Strengthen active styling in `MainNav.tsx`**

Replace the `className` on the `<Link>` (keep `data-testid`, `aria-current`, icon/label):

```tsx
className={cn(
  'relative flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors',
  'md:min-h-0 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:py-2.5 md:text-sm',
  active
    ? 'font-semibold text-primary bg-primary/10 md:bg-primary/10 ' +
      // mobile top indicator + desktop leading accent bar
      'before:absolute before:bg-primary before:content-[""] ' +
      'before:inset-x-4 before:top-0 before:h-0.5 before:rounded-full ' +
      'md:before:inset-x-auto md:before:inset-y-2 md:before:start-0 md:before:h-auto md:before:w-1'
    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
)}
```

- [ ] **Step 3: Test + build**

Run: `npm run test:unit -- main-nav` → PASS
Run: `npm run build` → clean

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(app)/_components/MainNav.tsx" tests/unit/main-nav.test.tsx
git commit -m "feat(ui): clearer active-tab highlight on side rail + bottom nav"
```

---

### Task 5: More prominent buttons

**Files:**
- Modify: `components/ui/button.tsx` (default + secondary variants)
- Test: `tests/unit/ui-button.test.tsx`

**Interfaces:**
- Produces: same `Button` API; only class strings change.

- [ ] **Step 1: Extend `ui-button` test (failing)**

```tsx
it('default variant is a solid primary button with elevation', () => {
  render(<Button>Go</Button>);
  const btn = screen.getByRole('button', { name: 'Go' });
  expect(btn.className).toMatch(/bg-primary/);
  expect(btn.className).toMatch(/shadow/);
  expect(btn.className).toMatch(/font-semibold/);
});
```

Run: `npm run test:unit -- ui-button` → FAIL.

- [ ] **Step 2: Edit `button.tsx`**

Base `cva` string: change `font-medium` → `font-semibold`. In `variants.variant`:

```ts
default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow",
```

(Leave `destructive`, `outline`, `secondary`, `ghost`, `link` as-is.)

- [ ] **Step 3: Test + build + spot e2e**

Run: `npm run test:unit -- ui-button` → PASS
Run: `npm run build` → clean
Run: `npm run test:e2e -- approval --workers=1` → PASS (approve/reject buttons unchanged behaviorally)

- [ ] **Step 4: Commit**

```bash
git add components/ui/button.tsx tests/unit/ui-button.test.tsx
git commit -m "feat(ui): make primary buttons solid + elevated (font-semibold, shadow)"
```

---

### Task 6: Migration — `set_leave_balance` RPC + types

**Files:**
- Create: `supabase/migrations/20260630120001_set_leave_balance.sql`
- Modify: `lib/supabase/types.ts` (add the function signature in-style)

**Interfaces:**
- Produces RPC `set_leave_balance(p_employee_id uuid, p_leave_type_id uuid, p_target numeric) returns numeric`. Consumed by Task 8.

- [ ] **Step 1: Author the migration**

```sql
-- =============================================================================
-- Migration: 20260630120001_set_leave_balance.sql
-- Purpose  : Admin sets an employee's CURRENT leave balance for a type to an
--            absolute target, via an 'adjustment' ledger row (auditable). Used
--            by the employee edit page. Additive grants still go through
--            allocate_leave. Mirrors the allocate_leave guard/pattern (0006).
-- =============================================================================

create or replace function public.set_leave_balance(
  p_employee_id uuid, p_leave_type_id uuid, p_target numeric
) returns numeric language plpgsql security definer set search_path = '' as $$
declare v_current numeric;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can set leave balance' using errcode = '42501';
  end if;
  if p_target is null or p_target < 0 then
    raise exception 'target balance must be >= 0' using errcode = '22023';
  end if;

  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);
  if v_current = p_target then
    return p_target;  -- no-op, no ledger noise
  end if;

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_days, balance_after, note)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_target - v_current, p_target, 'admin balance set');

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_leave_balance', 'leave_ledger', p_employee_id,
          jsonb_build_object('leave_type_id', p_leave_type_id, 'target', p_target, 'previous', v_current));
  return p_target;
end; $$;

revoke execute on function public.set_leave_balance(uuid, uuid, numeric) from public, anon;
grant  execute on function public.set_leave_balance(uuid, uuid, numeric) to authenticated;
```

- [ ] **Step 2: Apply to the demo via Supabase MCP**

Use MCP `apply_migration` (project ref `rimshsfkjpwlvjxbxhqm`, name `set_leave_balance`, body = the SQL above).

- [ ] **Step 3: Smoke-verify grants + behavior via MCP `execute_sql`**

```sql
-- grant present for authenticated, absent for anon
select has_function_privilege('authenticated', 'public.set_leave_balance(uuid,uuid,numeric)', 'execute') as auth_ok,
       has_function_privilege('anon',          'public.set_leave_balance(uuid,uuid,numeric)', 'execute') as anon_ok;
```
Expected: `auth_ok = true`, `anon_ok = false`.

- [ ] **Step 4: Add the type entry to `lib/supabase/types.ts`**

Open `types.ts`, find the `allocate_leave:` entry under `Database.public.Functions`, and add an analogous entry (keeps the file's CLI declaration order — do NOT overwrite the whole file):

```ts
set_leave_balance: {
  Args: { p_employee_id: string; p_leave_type_id: string; p_target: number };
  Returns: number;
};
```

- [ ] **Step 5: Typecheck + commit**

Run: `npm run build` → clean
```bash
git add supabase/migrations/20260630120001_set_leave_balance.sql lib/supabase/types.ts
git commit -m "feat(db): set_leave_balance RPC — admin sets absolute balance via adjustment ledger"
```

---

### Task 7: Pure allocation helpers (TDD)

**Files:**
- Create: `lib/leave/allocations.ts`
- Test: `tests/unit/allocations.test.ts`

**Interfaces:**
- Produces:
  - `currentYearPeriod(now?: Date): { start: string; end: string }` — `YYYY-01-01` / `YYYY-12-31`.
  - `type DesiredBalance = { leaveTypeId: string; target: number }`
  - `type CurrentBalance = { leaveTypeId: string; balance: number }`
  - `balanceAdjustments(current: CurrentBalance[], desired: DesiredBalance[]): DesiredBalance[]` — entries whose target differs from the current balance (current 0 if absent).

- [ ] **Step 1: Write the tests (failing)**

```ts
import { describe, it, expect } from 'vitest';
import { currentYearPeriod, balanceAdjustments } from '@/lib/leave/allocations';

describe('currentYearPeriod', () => {
  it('returns Jan 1–Dec 31 of the given year', () => {
    expect(currentYearPeriod(new Date('2026-06-30T12:00:00Z'))).toEqual({
      start: '2026-01-01', end: '2026-12-31',
    });
  });
});

describe('balanceAdjustments', () => {
  const cur = [{ leaveTypeId: 'a', balance: 26 }, { leaveTypeId: 's', balance: 10 }];
  it('returns only changed types', () => {
    expect(balanceAdjustments(cur, [{ leaveTypeId: 'a', target: 30 }, { leaveTypeId: 's', target: 10 }]))
      .toEqual([{ leaveTypeId: 'a', target: 30 }]);
  });
  it('treats a missing current balance as 0', () => {
    expect(balanceAdjustments([], [{ leaveTypeId: 'a', target: 5 }]))
      .toEqual([{ leaveTypeId: 'a', target: 5 }]);
  });
  it('returns nothing when all match', () => {
    expect(balanceAdjustments(cur, [{ leaveTypeId: 'a', target: 26 }, { leaveTypeId: 's', target: 10 }]))
      .toEqual([]);
  });
});
```

Run: `npm run test:unit -- allocations` → FAIL (module missing).

- [ ] **Step 2: Implement `lib/leave/allocations.ts`**

```ts
/** Pure allocation/balance helpers — no I/O, unit-tested. */

export type DesiredBalance = { leaveTypeId: string; target: number };
export type CurrentBalance = { leaveTypeId: string; balance: number };

/** The current calendar year as a Gregorian allocation period. */
export function currentYearPeriod(now: Date = new Date()): { start: string; end: string } {
  const y = now.getUTCFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

/** Desired entries whose target differs from the current balance (absent = 0). */
export function balanceAdjustments(
  current: CurrentBalance[],
  desired: DesiredBalance[]
): DesiredBalance[] {
  const byId = new Map(current.map((c) => [c.leaveTypeId, c.balance]));
  return desired.filter((d) => (byId.get(d.leaveTypeId) ?? 0) !== d.target);
}
```

- [ ] **Step 3: Test pass + commit**

Run: `npm run test:unit -- allocations` → PASS
```bash
git add lib/leave/allocations.ts tests/unit/allocations.test.ts
git commit -m "feat(leave): pure currentYearPeriod + balanceAdjustments helpers"
```

---

### Task 8: Server actions — `setLeaveBalance` + `getEmployeeBalances`

**Files:**
- Modify: `lib/actions/leave.ts`

**Interfaces:**
- Consumes: `getCallerContext`, `latestBalances`, `BalanceItem` (existing in the file/`lib/leave/balances`).
- Produces:
  - `setLeaveBalance(employeeId: string, leaveTypeId: string, target: number): Promise<{ ok: true } | { ok: false; error: string }>`
  - `getEmployeeBalances(employeeId: string): Promise<{ ok: true; balances: BalanceItem[] } | { ok: false; error: string }>`

- [ ] **Step 1: Add both actions to `lib/actions/leave.ts`**

```ts
/**
 * Admin sets an employee's current balance for a leave type to an absolute
 * target (adjustment ledger row). Admin-guarded here and re-checked in the RPC.
 */
export async function setLeaveBalance(
  employeeId: string,
  leaveTypeId: string,
  target: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user, roles } = await getCallerContext();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!roles.includes('admin')) return { ok: false, error: 'Admin role required' };

  const { error } = await supabase.rpc('set_leave_balance', {
    p_employee_id: employeeId,
    p_leave_type_id: leaveTypeId,
    p_target: target,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Admin/can_read_all view of an employee's current balance per active
 * balance-affecting leave type (for the edit form prefill).
 */
export async function getEmployeeBalances(
  employeeId: string
): Promise<{ ok: true; balances: BalanceItem[] } | { ok: false; error: string }> {
  const { supabase, user, roles, companyId } = await getCallerContext();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!roles.includes('admin')) return { ok: false, error: 'Admin role required' };
  if (!companyId) return { ok: false, error: 'Could not determine your company' };

  const [{ data: types, error: typesError }, { data: ledger, error: ledgerError }] =
    await Promise.all([
      supabase
        .from('leave_types')
        .select('id, name_fa, name_en')
        .eq('company_id', companyId)
        .eq('active', true)
        .eq('affects_balance', true)
        .order('name_fa'),
      supabase
        .from('leave_ledger')
        .select('leave_type_id, balance_after, created_at')
        .eq('employee_id', employeeId),
    ]);

  if (typesError) return { ok: false, error: typesError.message };
  if (ledgerError) return { ok: false, error: ledgerError.message };

  const byType = latestBalances(ledger ?? []);
  const balances: BalanceItem[] = (types ?? []).map((t) => ({
    leaveTypeId: t.id,
    name_fa: t.name_fa,
    name_en: t.name_en,
    balance: byType[t.id] ?? 0,
  }));
  return { ok: true, balances };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run build` → clean
```bash
git add lib/actions/leave.ts
git commit -m "feat(leave): setLeaveBalance + getEmployeeBalances server actions"
```

---

### Task 9: Allocate PTO + sick at employee creation

**Files:**
- Modify: `app/[locale]/(app)/manage/employees/new/page.tsx` (fetch balance-affecting types)
- Modify: `app/[locale]/(app)/manage/employees/new/NewEmployeeForm.tsx` (inputs + post-create allocation)
- Modify: `messages/en.json`, `messages/fa.json` (new `manage.employees` keys)
- Test: `tests/e2e/manage.spec.ts` (create-with-allocation)

**Interfaces:**
- Consumes: `createEmployee` (returns `{ userId }`), `allocateLeave` action, `currentYearPeriod`.
- Produces: testids `alloc-section`, `alloc-days-annual`, `alloc-days-sick`.

- [ ] **Step 1: Add i18n keys (both files, identical tree)**

Under `manage.employees` add (en):

```json
"allocTitle": "Initial leave balance",
"annualDays": "Annual leave (PTO) days",
"sickDays": "Sick leave days",
"allocWarn": "Employee created, but setting leave balance failed:"
```

fa:

```json
"allocTitle": "موجودی اولیه مرخصی",
"annualDays": "روزهای مرخصی استحقاقی",
"sickDays": "روزهای مرخصی استعلاجی",
"allocWarn": "کارمند ایجاد شد، اما تنظیم موجودی مرخصی ناموفق بود:"
```

- [ ] **Step 2: Fetch balance-affecting types in `new/page.tsx`**

In `NewEmployeeData`, add to the parallel fetch:

```tsx
supabase.from('leave_types')
  .select('id, name_en, default_annual_quota_days')
  .eq('active', true).eq('affects_balance', true),
```

Identify by `name_en`: `annual = types.find(t => t.name_en === 'Annual Leave')`, `sick = types.find(t => t.name_en === 'Sick Leave')`. Pass two props to the form: `annualTypeId`, `annualDefault` (`annual?.default_annual_quota_days ?? 0`), `sickTypeId`. Add the three new label strings to the `labels` object (`allocTitle`, `annualDays`, `sickDays`, `allocWarn`).

- [ ] **Step 3: Add inputs + wiring to `NewEmployeeForm.tsx`**

New props on the `Props` type: `annualTypeId?: string; annualDefault: number; sickTypeId?: string;` and the four label keys. Add a section before the submit row (only when a type id exists):

```tsx
{(annualTypeId || sickTypeId) && (
  <div className="space-y-3 rounded-lg border border-border p-4" data-testid="alloc-section">
    <span className="block text-sm font-semibold">{labels.allocTitle}</span>
    {annualTypeId && (
      <div className="space-y-1.5">
        <Label htmlFor="alloc_annual">{labels.annualDays}</Label>
        <Input id="alloc_annual" name="alloc_annual" type="number" min={0} step="0.5"
               defaultValue={annualDefault} data-testid="alloc-days-annual" />
      </div>
    )}
    {sickTypeId && (
      <div className="space-y-1.5">
        <Label htmlFor="alloc_sick">{labels.sickDays}</Label>
        <Input id="alloc_sick" name="alloc_sick" type="number" min={0} step="0.5"
               defaultValue={0} data-testid="alloc-days-sick" />
      </div>
    )}
  </div>
)}
```

In `handleSubmit`, after `setTempPassword(result.tempPassword)` succeeds, allocate (import `allocateLeave` and `currentYearPeriod`):

```tsx
const { start, end } = currentYearPeriod();
const allocs: { typeId: string; days: number }[] = [];
if (annualTypeId) allocs.push({ typeId: annualTypeId, days: Number(fd.get('alloc_annual') || 0) });
if (sickTypeId)   allocs.push({ typeId: sickTypeId,   days: Number(fd.get('alloc_sick') || 0) });
for (const a of allocs.filter((a) => a.days > 0)) {
  const r = await allocateLeave({
    employeeId: result.userId, leaveTypeId: a.typeId,
    periodStart: start, periodEnd: end, days: a.days,
  });
  if (!r.ok) setError(`${labels.allocWarn} ${r.error}`);
}
```

(Read `fd` before `setTempPassword`; capture `result.userId` from `createEmployee`.)

- [ ] **Step 3b: Run + verify it fails first (e2e)**

Write the e2e step (Step 4) before the wiring is confirmed, run it, watch it fail, then confirm pass after wiring. (Order: add the test, run red, finish wiring, run green.)

- [ ] **Step 4: e2e — create employee with allocation**

In `tests/e2e/manage.spec.ts` add a test (reuse the file's admin-login helper): create an employee, fill `alloc-days-annual` = `12`, submit, see the temp-password screen; then log in as that employee and assert the home board "My Balances" shows `12` for Annual (or query `/request` balance). Keep it serial-safe + clean up if the file's other tests do.

Run: `npm run test:e2e -- manage --workers=1` → PASS.

- [ ] **Step 5: Build + commit**

Run: `npm run build` → clean
```bash
git add "app/[locale]/(app)/manage/employees/new/page.tsx" "app/[locale]/(app)/manage/employees/new/NewEmployeeForm.tsx" messages/en.json messages/fa.json tests/e2e/manage.spec.ts
git commit -m "feat(hr): allocate PTO + sick days when creating an employee"
```

---

### Task 10: Edit an employee's PTO + sick balances

**Files:**
- Modify: `app/[locale]/(app)/manage/employees/[id]/page.tsx` (fetch balances)
- Modify: `app/[locale]/(app)/manage/employees/[id]/EditEmployeeForm.tsx` (inputs + save)
- Modify: `messages/en.json`, `messages/fa.json`
- Test: `tests/e2e/manage.spec.ts`

**Interfaces:**
- Consumes: `getEmployeeBalances`, `setLeaveBalance`, `balanceAdjustments`, `BalanceItem`.
- Produces: testids `balance-<typeId>` inputs, `balances-section`.

- [ ] **Step 1: i18n key (both files)**

Under `manage.employees`: en `"balancesTitle": "Leave balances"`; fa `"balancesTitle": "موجودی مرخصی"`.

- [ ] **Step 2: Fetch balances in `[id]/page.tsx` (admin only)**

After computing `isAdmin`, when admin fetch balances:

```tsx
import { getEmployeeBalances } from '@/lib/actions/leave';
// …
const balancesRes = isAdmin ? await getEmployeeBalances(id) : null;
const balances = balancesRes?.ok ? balancesRes.balances : [];
```

Pass `balances={balances}` and `labels.balancesTitle` to `EditEmployeeForm`.

- [ ] **Step 3: Inputs + save wiring in `EditEmployeeForm.tsx`**

Add `balances: BalanceItem[]` to `Props` (import `type { BalanceItem } from '@/lib/leave/balances'`) and `balancesTitle` to labels. Keep a controlled map of desired targets:

```tsx
const [targets, setTargets] = useState<Record<string, number>>(
  Object.fromEntries(balances.map((b) => [b.leaveTypeId, b.balance]))
);
```

Render (admin only, inside the form, before the submit row):

```tsx
{isAdmin && balances.length > 0 && (
  <div className="space-y-3 rounded-lg border border-border p-4" data-testid="balances-section">
    <span className="block text-sm font-semibold">{labels.balancesTitle}</span>
    {balances.map((b) => (
      <div key={b.leaveTypeId} className="space-y-1.5">
        <Label htmlFor={`balance-${b.leaveTypeId}`}>{locale === 'fa' ? b.name_fa : (b.name_en ?? b.name_fa)}</Label>
        <Input id={`balance-${b.leaveTypeId}`} data-testid={`balance-${b.leaveTypeId}`}
               type="number" min={0} step="0.5" value={targets[b.leaveTypeId] ?? 0}
               onChange={(e) => setTargets((p) => ({ ...p, [b.leaveTypeId]: Number(e.target.value) }))} />
      </div>
    ))}
  </div>
)}
```

In `handleSubmit`, after the roles update succeeds (admin branch), apply balance changes (import `setLeaveBalance`, `balanceAdjustments`):

```tsx
if (isAdmin && balances.length > 0) {
  const changes = balanceAdjustments(
    balances.map((b) => ({ leaveTypeId: b.leaveTypeId, balance: b.balance })),
    Object.entries(targets).map(([leaveTypeId, target]) => ({ leaveTypeId, target }))
  );
  for (const c of changes) {
    const r = await setLeaveBalance(employee.id, c.leaveTypeId, c.target);
    if (!r.ok) { setPending(false); setError(r.error); return; }
  }
}
```

(Place before `setSuccess(true)`.)

- [ ] **Step 4: e2e — edit a balance**

In `manage.spec.ts`: as admin, open an employee's edit page, set `balance-<annualId>` to a new value, Save, reload, assert the input shows the new value (or assert the employee's home balance updates). Use the annual type id surfaced on the page.

Run: `npm run test:e2e -- manage --workers=1` → PASS.

- [ ] **Step 5: Build + commit**

Run: `npm run build` → clean
```bash
git add "app/[locale]/(app)/manage/employees/[id]/page.tsx" "app/[locale]/(app)/manage/employees/[id]/EditEmployeeForm.tsx" messages/en.json messages/fa.json tests/e2e/manage.spec.ts
git commit -m "feat(hr): edit an employee's PTO + sick balances from the edit page"
```

---

### Task 11: Final verification + docs

**Files:**
- Modify: `docs/CHANGELOG.md`, `docs/TASKS.md`

- [ ] **Step 1: Full gates**

```bash
npm run lint
npm run test:unit          # 73 prior + new (theme/allocations/main-nav/ui-button) all green
npm run test:e2e -- --workers=1   # 20 prior + new manage assertions green
npm run build
```
All must pass. Fix any regression before continuing.

- [ ] **Step 2: Update docs**

Add a CHANGELOG `[Unreleased]` entry summarizing: light-only lockdown (auto-dark killed), Rubik font, logo, active-tab + button polish, and allocation-at-create/edit (`set_leave_balance` RPC). Note migration `20260630120001`. Tick the relevant line in `docs/TASKS.md` (or add a short "UI polish + allocation" note).

- [ ] **Step 3: Commit**

```bash
git add docs/CHANGELOG.md docs/TASKS.md
git commit -m "docs: record UI overhaul + allocation-at-create/edit"
```

---

## Self-Review

**Spec coverage:**
- Item 2 logo → Task 3. Item 3 transparent nav → Task 1 (opaque chrome + auto-dark kill). Item 4 light/less-dark → Tasks 1 (light lock) — dark mode dropped per user. Item 5 panel backgrounds → Task 1 (surface polish; cards already `bg-card`). Item 6 active tab → Task 4. Item 7 buttons → Task 5. Item 8 font → Task 2. Item 1 allocation → Tasks 6–10. ✓ All eight covered.

**Placeholder scan:** No TBD/TODO; every code step shows code; e2e steps name concrete selectors/values. ✓

**Type consistency:** `set_leave_balance(p_employee_id, p_leave_type_id, p_target)` identical across migration (Task 6), types.ts (Task 6), and `setLeaveBalance` action (Task 8). `balanceAdjustments(CurrentBalance[], DesiredBalance[])` defined in Task 7, consumed in Task 10 with matching shapes. `currentYearPeriod` defined Task 7, used Task 9. `allocateLeave` consumed in Task 9 matches the existing `AllocateLeaveInput`. ✓

**Notes:** Tasks 1–5 are independent (any order). Task 6 → 8 → {9,10}. Task 7 → {9,10}. Task 11 last.
