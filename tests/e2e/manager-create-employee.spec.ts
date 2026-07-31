import { test, expect } from '@playwright/test';
import { login, logout, nextTestPersonnelNo } from './_helpers';

/**
 * FR: manager-scoped employee creation (spec 2026-07-13).
 * A manager (m-prod, Production Line A) creates an employee from the Manage
 * tab: department and direct manager are locked to their own, no role or
 * allocation inputs, code generated as the bare <personnel_no>, default leave
 * quotas applied in-DB. The new employee can log in immediately.
 */
test('manager creates an employee scoped to their own team', async ({ page }) => {
  test.setTimeout(120_000);
  const pno = nextTestPersonnelNo();

  await login(page, 'm-prod', 'Demo!2026');
  await page.goto('/manage/employees/new');
  await expect(page).toHaveURL(/\/manage\/employees\/new$/);

  // Locked variant: fixed department/manager text, no selects, no role or
  // allocation inputs, default-quota hint shown.
  await expect(page.locator('[data-testid="dept-locked"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="mgr-locked"]')).toContainText('Reza');
  await expect(page.locator('#department_id')).toHaveCount(0);
  await expect(page.locator('#manager_id')).toHaveCount(0);
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="alloc-section"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="default-quota-hint"]')).toBeVisible();

  // Live code preview follows the personnel number.
  await page.fill('#personnel_no', pno);
  await page.fill('#full_name', `Team Hire ${pno}`);
  await page.fill('#job_title', 'جوشکار');
  await expect(page.locator('[data-testid="code-preview"]')).toHaveText(pno);

  await page.click('button[type="submit"]');
  const pwEl = page.locator('[data-testid="temp-password"]');
  await expect(pwEl).toBeVisible({ timeout: 15_000 });
  const password = (await pwEl.textContent())?.trim() ?? '';

  // The new employee can log in and sees a balance from default quotas.
  await logout(page);
  await login(page, pno, password);
  await expect(page.locator('[data-testid="home-board"]')).toBeVisible({ timeout: 10_000 });

  // The new employee shows up on the manager's team page.
  await logout(page);
  await login(page, 'm-prod', 'Demo!2026');
  await page.goto('/team');
  await expect(page.getByText(pno).first()).toBeVisible({ timeout: 10_000 });
});
