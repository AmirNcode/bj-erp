import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee } from './_helpers';

test('bottom nav shows role-correct tabs and navigates', async ({ page }) => {
  test.setTimeout(120_000);
  const ts = Date.now();

  // Admin sees the Manage tab.
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
