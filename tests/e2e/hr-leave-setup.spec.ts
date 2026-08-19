/**
 * FR-43 — HR sets an employee's opening leave balance and accrual policy.
 *
 * Until now those fields were hidden from HR on the Add and Edit Employee
 * screens, because `allocate_leave` / `set_employee_leave_policy` /
 * `set_leave_balance` were admin-only in the database: showing them would have
 * built a form that fails on submit. Both halves moved together, so this asserts
 * the fields are VISIBLE **and** that what HR types actually lands.
 *
 * Runs against `/en/...`: an explicit locale prefix beats the stored preference
 * (FR-34), so the asserted text does not depend on the demo admin's language.
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  createEmployee,
  nextTestPersonnelNo,
} from './_helpers';

test('hr sets an opening balance and accrual policy when adding an employee', async ({ page }) => {
  test.setTimeout(240_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const hr = await createEmployee(page, { name: 'HR Leave Setter', roles: ['hr'] });
  await logout(page);

  await login(page, hr.code, hr.password);
  await page.goto('/en/manage/employees/new');
  await expect(page.locator('[data-testid="personnel-no"]')).toBeVisible({ timeout: 30_000 });

  // ── 1. The two sections are offered to HR ─────────────────────────────────
  await expect(page.locator('[data-testid="alloc-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="policy-section"]')).toBeVisible();
  // ...and the "defaults will be applied" hint is gone, since HR now types them.
  await expect(page.locator('[data-testid="default-quota-hint"]')).toHaveCount(0);
  // Role checkboxes stay admin-only (FR-35 D4) — this is the boundary that did
  // NOT move, and asserting it is what keeps this a real permissions test.
  await expect(page.locator('input[type="checkbox"][value="admin"]')).toHaveCount(0);

  // ── 2. Create an employee with a balance and an accrual rule ──────────────
  const pno = nextTestPersonnelNo();
  await page.fill('[data-testid="personnel-no"]', pno);
  await page.fill('#full_name', 'HR Provisioned Worker');
  // Department is a required field — without it the browser blocks submit and
  // nothing reaches the server at all.
  const deptSelect = page.locator('#department_id');
  const deptValue = await deptSelect
    .locator('option')
    .nth(1)
    .getAttribute('value');
  await deptSelect.selectOption(deptValue!);
  await page.fill('[data-testid="alloc-days-annual"]', '12');
  await page.fill('[data-testid="policy-rate-annual"]', '2');

  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="temp-password"]')).toBeVisible({ timeout: 30_000 });
  // Neither warning banner may appear: they are shown when the allocation or the
  // policy write is refused, which is exactly what used to happen for HR.
  await expect(page.locator('[data-testid="alloc-error"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="policy-error"]')).toHaveCount(0);

  // ── 3. It actually landed — read it back on the edit screen ───────────────
  await page.goto('/en/manage/employees');
  await page.locator('tr', { hasText: pno }).first().locator('a[href*="/manage/employees/"]').click();
  await expect(page.locator('[data-testid="balances-section"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="policy-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="policy-rate-annual"]')).toHaveValue('2');

  // ── 4. HR may EDIT the balance too, not only set it once ──────────────────
  await page.fill('[data-testid="balance-days-annual"]', '15');
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="edit-success"]')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.locator('[data-testid="balance-days-annual"]')).toHaveValue('15', {
    timeout: 20_000,
  });
});

test('hr is refused when editing their own record', async ({ page }) => {
  test.setTimeout(180_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const hr = await createEmployee(page, { name: 'HR Self Editor', roles: ['hr'] });
  await logout(page);

  await login(page, hr.code, hr.password);
  await page.goto('/en/manage/employees');
  await page
    .locator('tr', { hasText: hr.code })
    .first()
    .locator('a[href*="/manage/employees/"]')
    .click();
  await expect(page.locator('[data-testid="balances-section"]')).toBeVisible({ timeout: 30_000 });

  // HR reads their own record like anyone else's, but the save is refused.
  //
  // The refusal comes from the PROFILE scope rule, not from the balance guard:
  // this form always submits the basic fields first, and `hire_date` is
  // manager-of/admin-only, so `updateEmployee` rejects before a balance write is
  // ever attempted. That is why the message here is the generic one.
  //
  // The balance guard added by FR-43 sits behind it as defence in depth and is
  // verified directly against the database (see the migration's own scenarios in
  // docs/AGENT-LOG.md): calling `set_leave_balance` or `set_employee_leave_policy`
  // as an HR user on their OWN id raises "you cannot change your own leave
  // balance", while an admin doing the same is allowed.
  await page.fill('[data-testid="balance-days-annual"]', '99');
  await page.click('button[type="submit"]');

  const error = page.locator('[data-testid="edit-error"]');
  await expect(error).toBeVisible({ timeout: 30_000 });

  // And nothing changed.
  await page.reload();
  await expect(page.locator('[data-testid="balance-days-annual"]')).not.toHaveValue('99', {
    timeout: 20_000,
  });
});
