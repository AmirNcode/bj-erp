# HR / Time-Off Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three deferred v1 requirements — FR-24 (admin work-settings + holiday editor), FR-7 (self-service password change), FR-15 (cancel an approved future leave with balance reversal) — leaving no v1 FR outstanding.

**Architecture:** Reuse the established conventions. Transactional writes (`leave_requests`/`leave_ledger`, `auth.users`) go through guarded `SECURITY DEFINER` RPCs; **FR-15** extends the existing `cancel_leave_request(uuid)` and **FR-7** adds `app_change_my_password`. Config tables (`work_settings`/`holidays`) already accept admin writes via existing `private.is_admin` RLS policies, so **FR-24** is admin-gated server actions writing directly — no new migration. Pure functions carry the testable logic and get vitest unit tests; SQL + UI are exercised by Playwright e2e.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), TypeScript, Supabase (Postgres + RLS + Auth), `@supabase/ssr`, `react-multi-date-picker`, next-intl (fa/en), Tailwind v4, Vitest, Playwright. Supabase MCP for migrations + type generation.

## Global Constraints

- **Farsi-first, RTL default.** Every user-facing string is translated in BOTH `messages/fa.json` and `messages/en.json`. fa is the default locale.
- **Dates stored Gregorian** (`date`/`timestamptz`). Jalali is render-only — convert at the UI edge with `dateObjectToGregorian` / `gregorianToJalali`. Never persist Jalali.
- **RLS is the source of truth.** UI/action role checks are convenience; Postgres policies enforce.
- **No `service_role` secret in app code** (NFR-4 portability). DB-privileged work uses self-guarded `SECURITY DEFINER` RPCs.
- **TDD**: write the failing test first. Pure logic → vitest (`tests/unit/`). Flows → Playwright (`tests/e2e/`).
- **e2e runs serially and must stay idempotent**: any test that mutates shared/company data restores it at the end. Run e2e with `npm run test:e2e` (Playwright starts the dev server).
- **Verify library APIs against Context7** before use; do not rely on training data.
- **Migrations**: new files in `supabase/migrations/` named `YYYYMMDDHHMMSS_<slug>.sql`, applied to the demo project via Supabase MCP `apply_migration`; then regenerate `lib/supabase/types.ts` via MCP `generate_typescript_types`. Confirm the project ref with MCP `list_projects` (demo is `rimshsfkjpwlvjxbxhqm` per the Phase 5 spec).
- **Commit after every task.** Conventional Commits; end the message body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: `isCancellable` pure helper (FR-15)

**Files:**
- Create: `lib/leave/cancellable.ts`
- Test: `tests/unit/cancellable.test.ts`

**Interfaces:**
- Produces: `isCancellable(status: string, startDate: string, today: string): boolean` — `startDate`/`today` are `YYYY-MM-DD` Gregorian strings (ISO lexicographic compare). Mirrors the SQL guard in Task 2.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/cancellable.test.ts
import { describe, it, expect } from 'vitest';
import { isCancellable } from '@/lib/leave/cancellable';

const TODAY = '2026-06-26';

describe('isCancellable', () => {
  it('pending is always cancellable', () => {
    expect(isCancellable('pending', '2026-06-01', TODAY)).toBe(true);  // even past pending
    expect(isCancellable('pending', '2026-07-01', TODAY)).toBe(true);
  });
  it('approved is cancellable only before it starts', () => {
    expect(isCancellable('approved', '2026-06-27', TODAY)).toBe(true);   // future
    expect(isCancellable('approved', '2026-06-26', TODAY)).toBe(false);  // starts today
    expect(isCancellable('approved', '2026-06-20', TODAY)).toBe(false);  // already started/past
  });
  it('rejected and cancelled are never cancellable', () => {
    expect(isCancellable('rejected', '2026-07-01', TODAY)).toBe(false);
    expect(isCancellable('cancelled', '2026-07-01', TODAY)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cancellable.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/leave/cancellable"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/leave/cancellable.ts
/**
 * Whether a leave request may be cancelled by its owner.
 * Mirrors the SQL guard in cancel_leave_request: pending → always;
 * approved → only while it hasn't started (start_date strictly after today).
 * Dates are YYYY-MM-DD Gregorian strings (ISO order is lexicographic).
 */
export function isCancellable(status: string, startDate: string, today: string): boolean {
  if (status === 'pending') return true;
  if (status === 'approved') return startDate > today;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/cancellable.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/leave/cancellable.ts tests/unit/cancellable.test.ts
git commit -m "$(printf 'feat(leave): isCancellable guard for pending + approved-future\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Extend `cancel_leave_request` SQL — reverse balance on approved-future cancel (FR-15)

**Files:**
- Create: `supabase/migrations/20260626120001_leave_cancel_approved.sql`
- Modify: `lib/supabase/types.ts` (regenerated; no manual edit)

**Interfaces:**
- Consumes: `private.is_admin(uuid)`, `public.current_leave_balance(uuid, uuid)` (both exist).
- Produces: `public.cancel_leave_request(p_id uuid)` now also cancels an `approved` request whose `start_date > current_date`, writing a `reversal` ledger row (`+requested_days`) for balance-affecting types. Same signature/grants as before (`create or replace` keeps existing grants).

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260626120001_leave_cancel_approved.sql
-- FR-15: extend cancel_leave_request to also cancel an APPROVED future request
-- (start_date > current_date), reversing the consumption with a 'reversal' ledger
-- row. Pending path unchanged (no ledger). Same signature → existing grants persist.
-- leave_requests / leave_ledger have no client write policies; this SECURITY DEFINER
-- fn remains the only write path. (Advisor lint 0029 accepted, see docs/PERMISSIONS.md.)
create or replace function public.cancel_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_status  public.leave_status;
  v_start   date;
  v_type    uuid;
  v_days    numeric;
  v_affects boolean;
  v_prev    numeric;
  v_rows    int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id, status, start_date, leave_type_id, requested_days
    into v_owner, v_status, v_start, v_type, v_days
    from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (v_owner = v_uid or private.is_admin(v_uid)) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  elsif v_status = 'approved' and v_start > current_date then
    -- Atomic flip; the status predicate guards against a concurrent double-cancel
    -- so the reversal ledger row is written at most once.
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type, delta_days, balance_after, note)
      values (v_owner, v_type, p_id, 'reversal', v_days, v_prev + v_days, 'reversal on cancel');
    end if;

  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled' using errcode = '22023';
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'cancel_leave_request', 'leave_requests', p_id,
          jsonb_build_object('status_before', v_status, 'days', v_days,
                             'reversed', (v_status = 'approved')));
end; $$;
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name `leave_cancel_approved`, the SQL above) against the demo project ref. Expected: success, no error.

- [ ] **Step 3: Smoke-verify the function compiled**

Run via Supabase MCP `execute_sql`:
```sql
select pg_get_function_identity_arguments(oid)
from pg_proc where proname = 'cancel_leave_request';
```
Expected: one row, `p_id uuid`.

- [ ] **Step 4: Regenerate types**

Regenerate `lib/supabase/types.ts` via Supabase MCP `generate_typescript_types`; write the output to the file. (Signature unchanged → likely a no-op diff; run it to stay honest.)

- [ ] **Step 5: Verify build + lint still pass**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260626120001_leave_cancel_approved.sql lib/supabase/types.ts
git commit -m "$(printf 'feat(leave): cancel approved-future request with ledger reversal (FR-15)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Wire cancel-approved into My Requests + e2e (FR-15)

**Files:**
- Modify: `app/[locale]/(app)/request/MyRequestsList.tsx`
- Modify: `app/[locale]/(app)/request/page.tsx` (add the `cancelApprovedConfirm` label)
- Modify: `messages/fa.json`, `messages/en.json` (`request.cancelApprovedConfirm`)
- Create: `tests/e2e/cancel-approved.spec.ts`

**Interfaces:**
- Consumes: `isCancellable` (Task 1), `cancelRequest` (existing in `lib/actions/leave.ts`).

- [ ] **Step 1: Add the i18n key**

In `messages/fa.json` under `"request"`, after `"cancelConfirm"`:
```json
"cancelApprovedConfirm": "این مرخصی تأییدشده لغو می‌شود و مانده مرخصی شما بازگردانده می‌شود. ادامه؟",
```
In `messages/en.json` under `"request"`, after `"cancelConfirm"`:
```json
"cancelApprovedConfirm": "This approved leave will be cancelled and your balance restored. Continue?",
```

- [ ] **Step 2: Pass the new label to the list**

In `app/[locale]/(app)/request/page.tsx`, in the `labels` object handed to `<MyRequestsList>`, add:
```tsx
cancelApprovedConfirm: t('cancelApprovedConfirm'),
```
(`t` is the `request` namespace translator already in that file.)

- [ ] **Step 3: Extend the component (failing build drives the change)**

In `MyRequestsList.tsx`: (a) add `cancelApprovedConfirm` to the `Labels` type; (b) import the guard and compute today; (c) choose the confirm copy by status; (d) render Cancel whenever `isCancellable`.

Add to the `Labels` type (after `cancelConfirm?: string;`):
```ts
  cancelApprovedConfirm?: string;
```
Add the import + today constant near the top (after the existing imports):
```ts
import { isCancellable } from '@/lib/leave/cancellable';

const TODAY = new Date().toISOString().slice(0, 10); // client today; the SQL re-checks against current_date
```
Replace `handleCancel` so approved cancels get the balance-restore confirm:
```ts
  const handleCancel = (id: string, status: string) => {
    const prompt =
      status === 'approved'
        ? labels.cancelApprovedConfirm ?? labels.cancelConfirm ?? 'Cancel this request?'
        : labels.cancelConfirm ?? 'Cancel this request?';
    if (!confirm(prompt)) return;
    setErrorMsg('');
    startTransition(async () => {
      const res = await cancelRequest(id);
      if (res.ok) {
        setLocalRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r))
        );
      } else {
        setErrorMsg(res.error);
      }
    });
  };
```
Replace the `{/* Cancel button — only for pending */}` block with:
```tsx
                  {/* Cancel — pending, or an approved leave that hasn't started */}
                  {isCancellable(req.status, req.start_date, TODAY) && (
                    <button
                      onClick={() => handleCancel(req.id, req.status)}
                      disabled={isPending}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      data-testid={`cancel-btn-${req.id}`}
                    >
                      {labels.cancel}
                    </button>
                  )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Write the e2e test**

> NOTE (verify before writing): open `tests/e2e/approval.spec.ts` and reuse its exact approve
> interaction — the selector below (`[data-testid^="approve-btn-"]`) is the expected pattern, but
> match whatever `ApprovalQueue.tsx` actually renders. Also: `submitLeave` uses the fixed
> `JALALI_2DAY` (= 2026-06-29/30); this test requires "today" to be **before** that start date so the
> approved leave is still cancellable. That holds in the project's active dev window; if the suite is
> run later, bump `JALALI_2DAY` in `_helpers.ts` to a near-future range.

```ts
// tests/e2e/cancel-approved.spec.ts
import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee, allocate, submitLeave,
} from './_helpers';

// FR-15: an employee cancels their own APPROVED future leave; the row flips to
// cancelled and the Cancel control disappears. Uses a throwaway employee (the
// suite already deactivates such codes during seed), so no shared-state cleanup.
test('employee cancels an approved future leave', async ({ page }) => {
  const code = `cxl${Date.now().toString().slice(-6)}`;

  // Admin: create employee, allocate annual, then the employee requests leave.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const pw = await createEmployee(page, { code, name: 'Cancel Tester', roles: ['employee'] });
  const leaveTypeValue = await allocate(page, code, 26);
  await logout(page);

  await login(page, code, pw);
  await submitLeave(page, { leaveTypeValue });
  await logout(page);

  // Admin approves the pending request.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/approvals');
  const approveBtn = page.locator('[data-testid^="approve-btn-"]').first();
  await expect(approveBtn).toBeVisible({ timeout: 15_000 });
  await approveBtn.click();
  await page.waitForTimeout(1500);
  await logout(page);

  // Employee: the approved future request shows a Cancel button; cancelling it
  // flips the status badge to "cancelled" and removes the button.
  await login(page, code, pw);
  await page.goto('/request');
  const row = page.locator('[data-testid^="request-row-"]').first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const cancelBtn = row.locator('[data-testid^="cancel-btn-"]');
  await expect(cancelBtn).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await cancelBtn.click();
  const badge = row.locator('[data-testid^="status-badge-"]');
  await expect(badge).toHaveText(/لغو|cancel/i, { timeout: 10_000 });
  await expect(cancelBtn).toHaveCount(0);
});
```

- [ ] **Step 6: Run the e2e test**

Run: `npx playwright test tests/e2e/cancel-approved.spec.ts`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add app/'[locale]'/'(app)'/request/MyRequestsList.tsx app/'[locale]'/'(app)'/request/page.tsx messages/fa.json messages/en.json tests/e2e/cancel-approved.spec.ts
git commit -m "$(printf 'feat(leave): cancel approved-future leave from My Requests (FR-15)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: `validatePassword` pure helper (FR-7)

**Files:**
- Create: `lib/auth/passwordPolicy.ts`
- Test: `tests/unit/passwordPolicy.test.ts`

**Interfaces:**
- Produces: `MIN_PASSWORD_LENGTH = 8`; `validatePassword(current, next, confirm): { ok: true } | { ok: false; reason: 'empty_current' | 'too_short' | 'mismatch' }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/passwordPolicy.test.ts
import { describe, it, expect } from 'vitest';
import { validatePassword, MIN_PASSWORD_LENGTH } from '@/lib/auth/passwordPolicy';

describe('validatePassword', () => {
  it('requires a current password', () => {
    expect(validatePassword('', 'longenough1', 'longenough1')).toEqual({ ok: false, reason: 'empty_current' });
  });
  it('rejects a new password shorter than the minimum', () => {
    expect(validatePassword('old', 'short', 'short')).toEqual({ ok: false, reason: 'too_short' });
    expect('short'.length).toBeLessThan(MIN_PASSWORD_LENGTH);
  });
  it('rejects a confirm mismatch', () => {
    expect(validatePassword('old', 'longenough1', 'longenough2')).toEqual({ ok: false, reason: 'mismatch' });
  });
  it('accepts a valid change', () => {
    expect(validatePassword('old', 'longenough1', 'longenough1')).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/passwordPolicy.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/passwordPolicy`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/auth/passwordPolicy.ts
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordValidation =
  | { ok: true }
  | { ok: false; reason: 'empty_current' | 'too_short' | 'mismatch' };

/** Client-side gate for the change-password form. The SQL fn re-checks length + current. */
export function validatePassword(current: string, next: string, confirm: string): PasswordValidation {
  if (!current) return { ok: false, reason: 'empty_current' };
  if (next.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'too_short' };
  if (next !== confirm) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/passwordPolicy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/passwordPolicy.ts tests/unit/passwordPolicy.test.ts
git commit -m "$(printf 'feat(auth): validatePassword policy helper (FR-7)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: `app_change_my_password` SQL (FR-7)

**Files:**
- Create: `supabase/migrations/20260626120002_self_password_change.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces: `public.app_change_my_password(p_current text, p_new text) returns void` — verifies the caller's current password in-DB, enforces min length 8, updates `auth.users`, audits. Granted to `authenticated`, revoked from `anon`/`public`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260626120002_self_password_change.sql
-- FR-7: self-service password change for the signed-in user. Verifies the current
-- password in-DB (crypt) before updating auth.users — mirrors app_set_employee_password
-- (admin reset) but self-guarded by auth.uid(). No service_role. Advisor lint 0029
-- accepted by design (the in-function check is the gate), see docs/PERMISSIONS.md.
create or replace function public.app_change_my_password(p_current text, p_new text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if length(coalesce(p_new, '')) < 8 then
    raise exception 'new password must be at least 8 characters' using errcode = '22023';
  end if;

  select (encrypted_password = extensions.crypt(p_current, encrypted_password))
    into v_ok from auth.users where id = v_uid;
  if not coalesce(v_ok, false) then
    raise exception 'current password is incorrect' using errcode = '42501';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')),
         updated_at = now()
   where id = v_uid;

  insert into public.audit_log(actor_id, action, entity, entity_id)
  values (v_uid, 'change_own_password', 'auth.users', v_uid);
end; $$;

revoke execute on function public.app_change_my_password(text, text) from public, anon;
grant  execute on function public.app_change_my_password(text, text) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name `self_password_change`). Expected: success.

- [ ] **Step 3: Smoke-verify**

Supabase MCP `execute_sql`:
```sql
select pg_get_function_identity_arguments(oid)
from pg_proc where proname = 'app_change_my_password';
```
Expected: one row, `p_current text, p_new text`.

- [ ] **Step 4: Regenerate types**

Regenerate `lib/supabase/types.ts` via MCP `generate_typescript_types` (adds the new RPC to `Database['public']['Functions']`).

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260626120002_self_password_change.sql lib/supabase/types.ts
git commit -m "$(printf 'feat(auth): app_change_my_password RPC verifies current password (FR-7)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Change-password action + form + profile wiring + e2e (FR-7)

**Files:**
- Modify: `lib/actions/profile.ts` (add `changeMyPassword`)
- Create: `app/[locale]/(app)/profile/ChangePasswordForm.tsx`
- Modify: `app/[locale]/(app)/profile/page.tsx` (render the form + labels)
- Modify: `messages/fa.json`, `messages/en.json` (`profile.password.*`)
- Create: `tests/e2e/password.spec.ts`

**Interfaces:**
- Consumes: `validatePassword` (Task 4), `app_change_my_password` RPC (Task 5).
- Produces: `changeMyPassword(current: string, next: string): Promise<{ ok: true } | { ok: false; error: string }>`.

- [ ] **Step 1: Add the server action**

Append to `lib/actions/profile.ts`:
```ts
export type ChangePasswordResult = { ok: true } | { ok: false; error: string };

/** Self-service password change. The RPC verifies the current password in-DB. */
export async function changeMyPassword(
  current: string,
  next: string
): Promise<ChangePasswordResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const { error } = await supabase.rpc('app_change_my_password', {
    p_current: current,
    p_new: next,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
```

- [ ] **Step 2: Add i18n keys**

`messages/fa.json` — add a `"password"` object inside `"profile"`:
```json
"password": {
  "title": "تغییر رمز عبور",
  "current": "رمز عبور فعلی",
  "new": "رمز عبور جدید",
  "confirm": "تکرار رمز عبور جدید",
  "submit": "تغییر رمز عبور",
  "changed": "رمز عبور با موفقیت تغییر کرد.",
  "tooShort": "رمز عبور جدید باید حداقل ۸ نویسه باشد.",
  "mismatch": "تکرار رمز عبور مطابقت ندارد.",
  "emptyCurrent": "رمز عبور فعلی را وارد کنید."
}
```
`messages/en.json` — the same inside `"profile"`:
```json
"password": {
  "title": "Change password",
  "current": "Current password",
  "new": "New password",
  "confirm": "Confirm new password",
  "submit": "Change password",
  "changed": "Password changed successfully.",
  "tooShort": "New password must be at least 8 characters.",
  "mismatch": "Password confirmation does not match.",
  "emptyCurrent": "Enter your current password."
}
```

- [ ] **Step 3: Create the form component**

```tsx
// app/[locale]/(app)/profile/ChangePasswordForm.tsx
'use client';

import { useState, useTransition } from 'react';
import { changeMyPassword } from '@/lib/actions/profile';
import { validatePassword } from '@/lib/auth/passwordPolicy';

type Labels = {
  title: string;
  current: string;
  new: string;
  confirm: string;
  submit: string;
  changed: string;
  tooShort: string;
  mismatch: string;
  emptyCurrent: string;
  errorLabel: string;
};

const INPUT_CLASS =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export function ChangePasswordForm({ labels }: { labels: Labels }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const reasonMsg = (reason: 'empty_current' | 'too_short' | 'mismatch') =>
    reason === 'empty_current' ? labels.emptyCurrent
    : reason === 'too_short' ? labels.tooShort
    : labels.mismatch;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOkMsg('');
    setErrMsg('');
    const v = validatePassword(current, next, confirm);
    if (!v.ok) { setErrMsg(reasonMsg(v.reason)); return; }
    startTransition(async () => {
      const res = await changeMyPassword(current, next);
      if (res.ok) {
        setOkMsg(labels.changed);
        setCurrent(''); setNext(''); setConfirm('');
      } else {
        setErrMsg(res.error);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 border-t border-gray-200 pt-6" data-testid="password-form">
      <h2 className="text-lg font-semibold">{labels.title}</h2>
      {okMsg && (
        <p role="status" data-testid="password-success"
           className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">{okMsg}</p>
      )}
      {errMsg && (
        <p role="alert" data-testid="password-error"
           className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
          <strong>{labels.errorLabel}:</strong> {errMsg}
        </p>
      )}
      <div>
        <label htmlFor="pwd-current" className="block text-sm font-medium mb-1">{labels.current}</label>
        <input id="pwd-current" type="password" autoComplete="current-password" className={INPUT_CLASS}
               value={current} onChange={(e) => setCurrent(e.target.value)} disabled={isPending} />
      </div>
      <div>
        <label htmlFor="pwd-new" className="block text-sm font-medium mb-1">{labels.new}</label>
        <input id="pwd-new" type="password" autoComplete="new-password" className={INPUT_CLASS}
               value={next} onChange={(e) => setNext(e.target.value)} disabled={isPending} />
      </div>
      <div>
        <label htmlFor="pwd-confirm" className="block text-sm font-medium mb-1">{labels.confirm}</label>
        <input id="pwd-confirm" type="password" autoComplete="new-password" className={INPUT_CLASS}
               value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={isPending} />
      </div>
      <button type="submit" data-testid="password-submit" disabled={isPending}
              className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
        {labels.submit}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Render it on the profile page**

In `app/[locale]/(app)/profile/page.tsx`: import the form and a `password` translator, then render it under `<SettingsForm>`.

After `import { SettingsForm } from './SettingsForm';` add:
```tsx
import { ChangePasswordForm } from './ChangePasswordForm';
```
After `const t = await getTranslations('profile');` add:
```tsx
  const tp = await getTranslations('profile.password');
  const passwordLabels = {
    title: tp('title'), current: tp('current'), new: tp('new'), confirm: tp('confirm'),
    submit: tp('submit'), changed: tp('changed'), tooShort: tp('tooShort'),
    mismatch: tp('mismatch'), emptyCurrent: tp('emptyCurrent'), errorLabel: t('error'),
  };
```
Immediately after the closing `</SettingsForm>`'s `/>` (still inside `<main>`), add:
```tsx
      <div className="mt-8">
        <ChangePasswordForm labels={passwordLabels} />
      </div>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Write the e2e test**

```ts
// tests/e2e/password.spec.ts
import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee } from './_helpers';

// FR-7: a user changes their own password and can log in with the new one; a wrong
// current password is rejected. Throwaway employee → no shared-state cleanup needed.
test('self-service password change', async ({ page }) => {
  const code = `pwd${Date.now().toString().slice(-6)}`;
  const NEW_PW = 'NewPass!2026';

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const tempPw = await createEmployee(page, { code, name: 'Password Tester', roles: ['employee'] });
  await logout(page);

  await login(page, code, tempPw);
  await page.goto('/profile');

  // Wrong current password → error.
  await page.fill('#pwd-current', 'definitely-wrong');
  await page.fill('#pwd-new', NEW_PW);
  await page.fill('#pwd-confirm', NEW_PW);
  await page.click('[data-testid="password-submit"]');
  await expect(page.locator('[data-testid="password-error"]')).toBeVisible({ timeout: 10_000 });

  // Correct current password → success.
  await page.fill('#pwd-current', tempPw);
  await page.fill('#pwd-new', NEW_PW);
  await page.fill('#pwd-confirm', NEW_PW);
  await page.click('[data-testid="password-submit"]');
  await expect(page.locator('[data-testid="password-success"]')).toBeVisible({ timeout: 10_000 });
  await logout(page);

  // The new password works.
  await login(page, code, NEW_PW);
  await expect(page).toHaveURL(/\/home$/);
});
```

- [ ] **Step 7: Run the e2e test**

Run: `npx playwright test tests/e2e/password.spec.ts`
Expected: 1 passed.

- [ ] **Step 8: Commit**

```bash
git add lib/actions/profile.ts app/'[locale]'/'(app)'/profile/ChangePasswordForm.tsx app/'[locale]'/'(app)'/profile/page.tsx messages/fa.json messages/en.json tests/e2e/password.spec.ts
git commit -m "$(printf 'feat(profile): self-service password change form (FR-7)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: `validateWeekendDays` + weekday model (FR-24)

**Files:**
- Create: `lib/leave/weekend.ts`
- Test: `tests/unit/weekend.test.ts`

**Interfaces:**
- Produces: `WEEKDAYS: { iso: number; key: string }[]` (Sat→Fri display order); `validateWeekendDays(days: number[]): { ok: true; days: number[] } | { ok: false; reason: 'out_of_range' | 'all_week' }` — dedupes + sorts, rejects values outside 1..7, rejects selecting all 7 (must leave ≥1 working day).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/weekend.test.ts
import { describe, it, expect } from 'vitest';
import { validateWeekendDays, WEEKDAYS } from '@/lib/leave/weekend';

describe('WEEKDAYS', () => {
  it('lists 7 days in Sat..Fri display order (ISO numbers)', () => {
    expect(WEEKDAYS.map((d) => d.iso)).toEqual([6, 7, 1, 2, 3, 4, 5]);
  });
});

describe('validateWeekendDays', () => {
  it('accepts the default Friday-only and dedupes/sorts', () => {
    expect(validateWeekendDays([5])).toEqual({ ok: true, days: [5] });
    expect(validateWeekendDays([5, 5, 4])).toEqual({ ok: true, days: [4, 5] });
  });
  it('rejects out-of-range weekday numbers', () => {
    expect(validateWeekendDays([0])).toEqual({ ok: false, reason: 'out_of_range' });
    expect(validateWeekendDays([8])).toEqual({ ok: false, reason: 'out_of_range' });
  });
  it('rejects marking every day a weekend', () => {
    expect(validateWeekendDays([1, 2, 3, 4, 5, 6, 7])).toEqual({ ok: false, reason: 'all_week' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/weekend.test.ts`
Expected: FAIL — cannot resolve `@/lib/leave/weekend`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/leave/weekend.ts
// ISO weekday numbers: Mon=1 .. Sun=7. The Iranian/Persian week is shown Sat..Fri.
export const WEEKDAYS: { iso: number; key: string }[] = [
  { iso: 6, key: 'sat' },
  { iso: 7, key: 'sun' },
  { iso: 1, key: 'mon' },
  { iso: 2, key: 'tue' },
  { iso: 3, key: 'wed' },
  { iso: 4, key: 'thu' },
  { iso: 5, key: 'fri' },
];

export type WeekendValidation =
  | { ok: true; days: number[] }
  | { ok: false; reason: 'out_of_range' | 'all_week' };

/** Normalize + validate a weekend-day selection (ISO numbers). Must leave ≥1 working day. */
export function validateWeekendDays(days: number[]): WeekendValidation {
  const uniq = Array.from(new Set(days)).sort((a, b) => a - b);
  if (uniq.some((d) => d < 1 || d > 7)) return { ok: false, reason: 'out_of_range' };
  if (uniq.length >= 7) return { ok: false, reason: 'all_week' };
  return { ok: true, days: uniq };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/weekend.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/leave/weekend.ts tests/unit/weekend.test.ts
git commit -m "$(printf 'feat(settings): weekday model + validateWeekendDays (FR-24)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Settings server actions — direct admin RLS writes (FR-24)

**Files:**
- Create: `lib/actions/settings.ts`

**Interfaces:**
- Consumes: `validateWeekendDays` (Task 7); existing admin RLS policies on `work_settings`/`holidays`.
- Produces:
  - `getCompanyHolidays(): Promise<{ ok: true; holidays: Holiday[]; weekendDays: number[] } | { ok: false; error: string }>`
  - `updateWorkSettings(weekendDays: number[]): Promise<{ ok: true } | { ok: false; error: string }>`
  - `upsertHoliday(input: { id?: string; date: string; nameFa: string; nameEn?: string; isRecurring?: boolean }): Promise<{ ok: true } | { ok: false; error: string }>`
  - `deleteHoliday(id: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `type Holiday = { id: string; holiday_date: string; name_fa: string; name_en: string | null; is_recurring: boolean }`

- [ ] **Step 1: Create the actions file**

```ts
// lib/actions/settings.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { validateWeekendDays } from '@/lib/leave/weekend';

export type Holiday = {
  id: string;
  holiday_date: string; // YYYY-MM-DD Gregorian
  name_fa: string;
  name_en: string | null;
  is_recurring: boolean;
};

type Ctx = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  companyId: string;
  isAdmin: boolean;
};

async function getCtx(): Promise<Ctx | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', user.id),
    supabase.from('profiles').select('company_id').eq('id', user.id).single(),
  ]);
  return {
    supabase,
    userId: user.id,
    companyId: profile?.company_id ?? '',
    isAdmin: (roles ?? []).some((r) => r.role === 'admin'),
  };
}

export async function getCompanyHolidays(): Promise<
  { ok: true; holidays: Holiday[]; weekendDays: number[] } | { ok: false; error: string }
> {
  const c = await getCtx();
  if (!c) return { ok: false, error: 'Not authenticated' };
  const [{ data: hols, error: he }, { data: ws, error: we }] = await Promise.all([
    c.supabase
      .from('holidays')
      .select('id, holiday_date, name_fa, name_en, is_recurring')
      .eq('company_id', c.companyId)
      .order('holiday_date'),
    c.supabase.from('work_settings').select('weekend_days').eq('company_id', c.companyId).maybeSingle(),
  ]);
  if (he) return { ok: false, error: he.message };
  if (we) return { ok: false, error: we.message };
  return { ok: true, holidays: (hols ?? []) as Holiday[], weekendDays: ws?.weekend_days ?? [5] };
}

export async function updateWorkSettings(
  weekendDays: number[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return { ok: false, error: 'Not authenticated' };
  if (!c.isAdmin) return { ok: false, error: 'Admin role required' };
  const v = validateWeekendDays(weekendDays);
  if (!v.ok) {
    return {
      ok: false,
      error: v.reason === 'all_week' ? 'At least one working day is required' : 'Invalid weekend days',
    };
  }
  const { error } = await c.supabase
    .from('work_settings')
    .update({ weekend_days: v.days, updated_by: c.userId })
    .eq('company_id', c.companyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function upsertHoliday(input: {
  id?: string;
  date: string;
  nameFa: string;
  nameEn?: string;
  isRecurring?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return { ok: false, error: 'Not authenticated' };
  if (!c.isAdmin) return { ok: false, error: 'Admin role required' };
  if (!input.date || !input.nameFa) return { ok: false, error: 'Date and Farsi name are required' };
  const row = {
    holiday_date: input.date,
    name_fa: input.nameFa,
    name_en: input.nameEn ?? null,
    is_recurring: input.isRecurring ?? false,
  };
  const { error } = input.id
    ? await c.supabase.from('holidays').update(row).eq('id', input.id)
    : await c.supabase.from('holidays').insert({ ...row, company_id: c.companyId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteHoliday(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCtx();
  if (!c) return { ok: false, error: 'Not authenticated' };
  if (!c.isAdmin) return { ok: false, error: 'Admin role required' };
  const { error } = await c.supabase.from('holidays').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Behavior is covered by the Task 9 e2e — these actions hit Supabase, matching the house pattern of exercising server actions via e2e rather than mocked unit tests.)

- [ ] **Step 3: Commit**

```bash
git add lib/actions/settings.ts
git commit -m "$(printf 'feat(settings): admin work-settings + holiday actions via RLS (FR-24)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: Admin settings page + forms + nav link + e2e (FR-24)

**Files:**
- Create: `app/[locale]/(app)/manage/settings/page.tsx`
- Create: `app/[locale]/(app)/manage/settings/WorkSettingsForm.tsx`
- Create: `app/[locale]/(app)/manage/settings/HolidayEditor.tsx`
- Modify: `app/[locale]/(app)/manage/employees/page.tsx` (admin-only Settings link)
- Modify: `messages/fa.json`, `messages/en.json` (`manage.settingsLink`, `manage.settings.*`)
- Create: `tests/e2e/admin-settings.spec.ts`

**Interfaces:**
- Consumes: Task 8 actions; `WEEKDAYS` (Task 7); `dateObjectToGregorian` (existing `lib/leave/dateConvert`).

- [ ] **Step 1: Add i18n keys**

`messages/fa.json` — add `"settingsLink"` inside `"manage"` (sibling of `"approvalsLink"`):
```json
"settingsLink": "تنظیمات",
```
and add a `"settings"` object inside `"manage"`:
```json
"settings": {
  "title": "تنظیمات کاری",
  "weekendTitle": "روزهای تعطیل هفتگی",
  "weekendHint": "روزهایی که جزو روزهای کاری محسوب نمی‌شوند.",
  "save": "ذخیره",
  "saved": "ذخیره شد.",
  "holidaysTitle": "تعطیلات رسمی",
  "addHoliday": "افزودن تعطیلی",
  "dateLabel": "تاریخ",
  "nameFaLabel": "نام (فارسی)",
  "nameEnLabel": "نام (انگلیسی)",
  "recurringLabel": "تکرارشونده سالانه",
  "delete": "حذف",
  "noHolidays": "تعطیلی ثبت نشده است.",
  "error": "خطا",
  "days": { "sat": "شنبه", "sun": "یک‌شنبه", "mon": "دوشنبه", "tue": "سه‌شنبه", "wed": "چهارشنبه", "thu": "پنج‌شنبه", "fri": "جمعه" }
}
```
`messages/en.json` — `"settingsLink"` inside `"manage"`:
```json
"settingsLink": "Settings",
```
and `"settings"` inside `"manage"`:
```json
"settings": {
  "title": "Work settings",
  "weekendTitle": "Weekly days off",
  "weekendHint": "Days that do not count as working days.",
  "save": "Save",
  "saved": "Saved.",
  "holidaysTitle": "Official holidays",
  "addHoliday": "Add holiday",
  "dateLabel": "Date",
  "nameFaLabel": "Name (Farsi)",
  "nameEnLabel": "Name (English)",
  "recurringLabel": "Repeats yearly",
  "delete": "Delete",
  "noHolidays": "No holidays yet.",
  "error": "Error",
  "days": { "sat": "Saturday", "sun": "Sunday", "mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday", "fri": "Friday" }
}
```

- [ ] **Step 2: Create `WorkSettingsForm.tsx`**

```tsx
// app/[locale]/(app)/manage/settings/WorkSettingsForm.tsx
'use client';

import { useState, useTransition } from 'react';
import { updateWorkSettings } from '@/lib/actions/settings';
import { WEEKDAYS } from '@/lib/leave/weekend';

type Labels = {
  weekendTitle: string;
  weekendHint: string;
  save: string;
  saved: string;
  errorLabel: string;
  days: Record<string, string>;
};

export function WorkSettingsForm({ initial, labels }: { initial: number[]; labels: Labels }) {
  const [selected, setSelected] = useState<number[]>(initial);
  const [okMsg, setOkMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const toggle = (iso: number) =>
    setSelected((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso]));

  const onSave = () => {
    setOkMsg(''); setErrMsg('');
    startTransition(async () => {
      const res = await updateWorkSettings(selected);
      if (res.ok) setOkMsg(labels.saved);
      else setErrMsg(res.error);
    });
  };

  return (
    <section className="space-y-3" data-testid="work-settings">
      <h2 className="text-lg font-semibold">{labels.weekendTitle}</h2>
      <p className="text-xs text-gray-500">{labels.weekendHint}</p>
      {okMsg && <p role="status" data-testid="work-settings-saved" className="text-sm text-green-700">{okMsg}</p>}
      {errMsg && <p role="alert" data-testid="work-settings-error" className="text-sm text-red-700">{labels.errorLabel}: {errMsg}</p>}
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((d) => (
          <label key={d.iso}
                 className={`cursor-pointer select-none rounded-full border px-3 py-1.5 text-sm ${
                   selected.includes(d.iso) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}>
            <input type="checkbox" className="sr-only" data-testid={`weekend-${d.key}`}
                   checked={selected.includes(d.iso)} onChange={() => toggle(d.iso)} disabled={isPending} />
            {labels.days[d.key]}
          </label>
        ))}
      </div>
      <button type="button" data-testid="work-settings-save" onClick={onSave} disabled={isPending}
              className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
        {labels.save}
      </button>
    </section>
  );
}
```

- [ ] **Step 3: Create `HolidayEditor.tsx`**

```tsx
// app/[locale]/(app)/manage/settings/HolidayEditor.tsx
'use client';

import { useState, useTransition } from 'react';
import DatePicker from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import { dateObjectToGregorian } from '@/lib/leave/dateConvert';
import { gregorianToJalali } from '@/lib/leave/dateConvert';
import { upsertHoliday, deleteHoliday, type Holiday } from '@/lib/actions/settings';

type Labels = {
  holidaysTitle: string; addHoliday: string; dateLabel: string; nameFaLabel: string;
  nameEnLabel: string; recurringLabel: string; delete: string; noHolidays: string; errorLabel: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DateObjectLike = any;

export function HolidayEditor({
  initial, calendarPref, labels,
}: { initial: Holiday[]; calendarPref: string; labels: Labels }) {
  const isJalali = calendarPref === 'jalali';
  const [holidays, setHolidays] = useState<Holiday[]>(initial);
  const [picked, setPicked] = useState<DateObjectLike | null>(null);
  const [nameFa, setNameFa] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const show = (d: string) => (isJalali ? gregorianToJalali(d) : d);

  const refresh = (date: string, fa: string, en: string, rec: boolean, tmpId: string) =>
    setHolidays((prev) =>
      [...prev, { id: tmpId, holiday_date: date, name_fa: fa, name_en: en || null, is_recurring: rec }]
        .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)));

  const onAdd = () => {
    setErrMsg('');
    if (!picked || !nameFa) { setErrMsg(labels.errorLabel); return; }
    const date = dateObjectToGregorian(picked);
    startTransition(async () => {
      const res = await upsertHoliday({ date, nameFa, nameEn, isRecurring: recurring });
      if (!res.ok) { setErrMsg(res.error); return; }
      refresh(date, nameFa, nameEn, recurring, `tmp-${date}`);
      setPicked(null); setNameFa(''); setNameEn(''); setRecurring(false);
    });
  };

  const onDelete = (id: string) => {
    setErrMsg('');
    startTransition(async () => {
      const res = await deleteHoliday(id);
      if (!res.ok) { setErrMsg(res.error); return; }
      setHolidays((prev) => prev.filter((h) => h.id !== id));
    });
  };

  return (
    <section className="space-y-4" data-testid="holiday-editor">
      <h2 className="text-lg font-semibold">{labels.holidaysTitle}</h2>
      {errMsg && <p role="alert" data-testid="holiday-error" className="text-sm text-red-700">{labels.errorLabel}: {errMsg}</p>}

      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">{labels.dateLabel}</label>
          <DatePicker
            value={picked}
            onChange={setPicked}
            calendar={isJalali ? persian : gregorian}
            locale={isJalali ? persian_fa : gregorian_en}
            inputClass="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full"
            containerClassName="rmdp-container"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hol-name-fa" className="text-sm font-medium">{labels.nameFaLabel}</label>
          <input id="hol-name-fa" data-testid="holiday-name-fa" value={nameFa} onChange={(e) => setNameFa(e.target.value)}
                 className="border border-gray-300 rounded-lg px-3 py-2 text-sm" disabled={isPending} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hol-name-en" className="text-sm font-medium">{labels.nameEnLabel}</label>
          <input id="hol-name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)}
                 className="border border-gray-300 rounded-lg px-3 py-2 text-sm" disabled={isPending} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} disabled={isPending} />
          {labels.recurringLabel}
        </label>
        <button type="button" data-testid="holiday-add" onClick={onAdd} disabled={isPending}
                className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {labels.addHoliday}
        </button>
      </div>

      {holidays.length === 0 ? (
        <p className="text-sm text-gray-500">{labels.noHolidays}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200" data-testid="holiday-list">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span><span className="font-mono">{show(h.holiday_date)}</span> · {h.name_fa}</span>
              <button type="button" onClick={() => onDelete(h.id)} disabled={isPending}
                      className="text-red-600 hover:underline text-xs disabled:opacity-50">{labels.delete}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

> NOTE: confirm the `react-multi-date-picker` `value`/`onChange`/`calendar`/`locale` props against Context7 before relying on them; mirror exactly what `request/LeaveRequestForm.tsx` already does for the range picker.

- [ ] **Step 4: Create the page (admin guard + data load)**

```tsx
// app/[locale]/(app)/manage/settings/page.tsx
/**
 * Admin work-settings + holiday editor (FR-24). Admin-only (managers are bounced
 * to /home). Writes go through lib/actions/settings via the existing admin RLS
 * policies on work_settings / holidays.
 */
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCompanyHolidays } from '@/lib/actions/settings';
import { WorkSettingsForm } from './WorkSettingsForm';
import { HolidayEditor } from './HolidayEditor';

type Props = { params: Promise<{ locale: string }> };

export default async function SettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', user.id),
    supabase.from('profiles').select('calendar_pref').eq('id', user.id).single(),
  ]);
  const isAdmin = (roles ?? []).some((r) => r.role === 'admin');
  if (!isAdmin) redirect(`/${locale}/home`);

  const t = await getTranslations('manage.settings');
  const data = await getCompanyHolidays();
  const weekendDays = data.ok ? data.weekendDays : [5];
  const holidays = data.ok ? data.holidays : [];

  const days = { sat: t('days.sat'), sun: t('days.sun'), mon: t('days.mon'), tue: t('days.tue'),
                 wed: t('days.wed'), thu: t('days.thu'), fri: t('days.fri') };

  return (
    <main className="p-6 max-w-2xl mx-auto space-y-10">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <WorkSettingsForm
        initial={weekendDays}
        labels={{ weekendTitle: t('weekendTitle'), weekendHint: t('weekendHint'),
                  save: t('save'), saved: t('saved'), errorLabel: t('error'), days }}
      />
      <HolidayEditor
        initial={holidays}
        calendarPref={profile?.calendar_pref ?? 'jalali'}
        labels={{ holidaysTitle: t('holidaysTitle'), addHoliday: t('addHoliday'), dateLabel: t('dateLabel'),
                  nameFaLabel: t('nameFaLabel'), nameEnLabel: t('nameEnLabel'), recurringLabel: t('recurringLabel'),
                  delete: t('delete'), noHolidays: t('noHolidays'), errorLabel: t('error') }}
      />
    </main>
  );
}
```

- [ ] **Step 5: Add the admin-only nav link on the employees page**

In `app/[locale]/(app)/manage/employees/page.tsx`: fetch the caller's roles and render a Settings link only for admins.

After `const supabase = await createClient();` add:
```tsx
  const { data: { user } } = await supabase.auth.getUser();
  const { data: myRoles } = await supabase.from('user_roles').select('role').eq('user_id', user?.id ?? '');
  const isAdmin = (myRoles ?? []).some((r) => r.role === 'admin');
```
In the header `<div className="flex items-center gap-3">`, before the `approvalsLink` `<Link>`, add:
```tsx
          {isAdmin && (
            <Link href={`/${locale}/manage/settings`} className="text-blue-600 hover:underline px-2 py-2" data-testid="nav-settings">
              {t('settingsLink')}
            </Link>
          )}
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Write the e2e test (with cleanup for idempotency)**

```ts
// tests/e2e/admin-settings.spec.ts
import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee } from './_helpers';

// FR-24: admin adds a holiday and toggles a weekend day; a non-admin is blocked.
// Mutates shared company config, so the test restores it (delete the holiday,
// reset the weekend back to Friday-only) to keep the serial suite idempotent.
test('admin edits work settings + holidays; non-admin blocked', async ({ page }) => {
  // Non-admin is redirected away from /manage/settings.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const code = `set${Date.now().toString().slice(-6)}`;
  const pw = await createEmployee(page, { code, name: 'Settings Outsider', roles: ['employee'] });
  await logout(page);
  await login(page, code, pw);
  await page.goto('/manage/settings');
  await expect(page).toHaveURL(/\/home$/, { timeout: 10_000 });
  await logout(page);

  // Admin: add a holiday, see it listed, then delete it (cleanup).
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/settings');
  await expect(page.locator('[data-testid="work-settings"]')).toBeVisible({ timeout: 15_000 });

  const before = await page.locator('[data-testid="holiday-list"] li').count().catch(() => 0);
  await page.locator('.rmdp-container input').first().click();
  await page.locator('.rmdp-container input').first().fill('1405/10/01'); // Jalali → stored Gregorian
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.fill('[data-testid="holiday-name-fa"]', 'تعطیلی آزمایشی');
  await page.click('[data-testid="holiday-add"]');
  const list = page.locator('[data-testid="holiday-list"] li');
  await expect(list).toHaveCount(before + 1, { timeout: 10_000 });

  // Toggle a weekend day (add Thursday=thu) and save, then reset to Friday-only.
  await page.click('[data-testid="weekend-thu"]');
  await page.click('[data-testid="work-settings-save"]');
  await expect(page.locator('[data-testid="work-settings-saved"]')).toBeVisible({ timeout: 10_000 });

  // Cleanup: untoggle Thursday + save; delete the added holiday.
  await page.click('[data-testid="weekend-thu"]');
  await page.click('[data-testid="work-settings-save"]');
  await expect(page.locator('[data-testid="work-settings-saved"]')).toBeVisible({ timeout: 10_000 });
  await list.last().locator('button').click();
  await expect(list).toHaveCount(before, { timeout: 10_000 });
});
```

- [ ] **Step 8: Run the e2e test**

Run: `npx playwright test tests/e2e/admin-settings.spec.ts`
Expected: 1 passed.

- [ ] **Step 9: Commit**

```bash
git add app/'[locale]'/'(app)'/manage/settings app/'[locale]'/'(app)'/manage/employees/page.tsx messages/fa.json messages/en.json tests/e2e/admin-settings.spec.ts
git commit -m "$(printf 'feat(settings): admin work-settings + holiday editor UI (FR-24)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 10: Docs + full-suite verification

**Files:**
- Modify: `docs/REQUIREMENTS.md` (FR-7, FR-15, FR-24 → ☑)
- Modify: `docs/TASKS.md` (add a Phase 6 section, mark done; update the current-state banner)
- Modify: `docs/CHANGELOG.md` (Phase 6 entry under `[Unreleased]`)
- Modify: `docs/PERMISSIONS.md` (note FR-15 self-cancel + that FR-24 config edits use direct admin RLS writes)
- Modify: `docs/DATA_MODEL.md` (note `reversal` ledger entry now written by approved-cancel)
- Modify: `.superpowers/sdd/progress.md` (Phase 6 ledger entry)

- [ ] **Step 1: Update REQUIREMENTS.md statuses**

Set FR-7, FR-15, FR-24 from `◐`/`☐` to `☑` and drop the "deferred" parentheticals:
- FR-7 `☑` — "… Self-service password change after first login." (now shipped)
- FR-15 `☑` — "Employee can cancel a pending request **and an approved future request** (balance restored)."
- FR-24 `☑` — "Admin can edit work settings (weekend days) and the holiday list."

- [ ] **Step 2: Update TASKS.md**

Change the current-state banner to note Phases 0–6 complete (no v1 FR outstanding). Append:
```markdown
## Phase 6 — Settings, password, cancel-approved ✅
- ☑ FR-24 admin work-settings (weekend days) + holiday editor (direct admin RLS writes)
- ☑ FR-7 self-service password change (in-DB current-password verify)
- ☑ FR-15 cancel approved-future leave with ledger `reversal`
```

- [ ] **Step 3: Update CHANGELOG.md**

Add under `[Unreleased]`:
```markdown
### Implemented — Phase 6 (Settings, password, cancel-approved)
- **FR-15**: `cancel_leave_request` now also cancels an **approved** request whose `start_date` is in
  the future, writing a `reversal` ledger row (+requested_days) for balance-affecting types (atomic,
  row-count guarded). My Requests shows Cancel on eligible approved rows (`isCancellable`).
- **FR-7**: self-service password change — guarded `app_change_my_password` verifies the current
  password in-DB (no `service_role`); a Change-Password form on Profile/Settings.
- **FR-24**: admin work-settings (weekend days) + holiday add/edit/delete editor at
  `/manage/settings`, writing directly via the pre-existing admin RLS policies on
  `work_settings`/`holidays` (no new RPC/migration). Linked from Manage for admins only.
- 2 migrations (`20260626120001`, `20260626120002`); types regenerated. No table/enum/RLS-policy
  changes. Tests: unit +3 files, e2e +3 specs (serial, idempotent).
```

- [ ] **Step 4: Update PERMISSIONS.md + DATA_MODEL.md**

- PERMISSIONS.md: under the leave/cancel notes, add that the owner (or admin) may cancel an approved request only while `start_date > current_date`, reversing the ledger. Note FR-24 config-table edits rely on the existing admin RLS write policies on `work_settings`/`holidays` (not new RPCs).
- DATA_MODEL.md: in the `leave_ledger` / working-day section, note `reversal` rows are written when an approved-future request is cancelled (`+requested_days`).

- [ ] **Step 5: Update the SDD ledger**

Append a Phase 6 section to `.superpowers/sdd/progress.md` summarizing the three FRs, the 2 migrations, and the test counts.

- [ ] **Step 6: Run the FULL suite**

Run: `npm run test:unit`
Expected: all unit tests pass (existing 54 + new: cancellable 3, passwordPolicy 4, weekend 4).

Run: `npm run test:e2e`
Expected: all e2e pass (existing 17 + cancel-approved, password, admin-settings).

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: clean.

> If anything fails, STOP and fix before committing — do not mark Phase 6 done with a red suite.

- [ ] **Step 7: Commit**

```bash
git add docs/REQUIREMENTS.md docs/TASKS.md docs/CHANGELOG.md docs/PERMISSIONS.md docs/DATA_MODEL.md .superpowers/sdd/progress.md
git commit -m "$(printf 'docs: Phase 6 complete — FR-7, FR-15, FR-24 shipped\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** FR-15 → Tasks 1–3; FR-7 → Tasks 4–6; FR-24 → Tasks 7–9; docs/verification → Task 10. The corrected P6-7 (direct RLS writes, no FR-24 migration) is reflected — only 2 migrations (Tasks 2, 5). All P6-1…P6-8 decisions are implemented.
- **Placeholder scan:** none — every step has concrete code, commands, and expected output.
- **Type consistency:** `isCancellable(status,startDate,today)`, `validatePassword(current,next,confirm)`, `validateWeekendDays(days)`, `Holiday`, and the four `settings.ts` action signatures are defined once and consumed with matching names/params across tasks.
- **Idempotency:** cancel-approved + password use throwaway employees; admin-settings restores weekend + deletes its holiday.
