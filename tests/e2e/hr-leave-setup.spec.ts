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
  openLeaveSections,
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
  await expect(page.locator('[data-testid="role-admin"] input')).toBeDisabled();

  // ── 2. Create an employee with a balance and an accrual rule ──────────────
  const pno = nextTestPersonnelNo();
  await page.fill('[data-testid="personnel-no"]', pno);
  await page.fill('#first_name', 'HR Provisioned Worker');
  await page.fill('#last_name', 'E2E');
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
  await page.goto(`/en/manage/employees?q=${pno}`);
  await page.locator('tr', { hasText: pno }).first().locator('a[href*="/manage/employees/"]').click();
  await expect(page.locator('[data-testid="balances-section"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="policy-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="policy-rate-annual"]')).toHaveValue('2');

  // ── 4. HR may EDIT the balance too, not only set it once ──────────────────
  await openLeaveSections(page);
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
  await page.goto(`/en/manage/employees?q=${hr.code}`);
  await page
    .locator('tr', { hasText: hr.code })
    .first()
    .locator('a[href*="/manage/employees/"]')
    .click();
  await expect(page.locator('[data-testid="balances-section"]')).toBeVisible({ timeout: 30_000 });

  // HR reads their own record like anyone else's, but the leave fields are locked:
  // the form disables them, and the database refuses the write anyway ("you cannot
  // change your own leave balance").
  await openLeaveSections(page);
  await expect(page.locator('[data-testid="balance-days-annual"]')).toBeDisabled();
});
