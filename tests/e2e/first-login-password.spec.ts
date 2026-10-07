import { test, expect, type Page } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  createEmployee,
  login,
  logout,
  setFirstPassword,
} from './_helpers';

// FR-50: an account on an issued password must choose its own before anything
// else renders, the issued password itself is refused, and an admin reset brings
// the screen back. Throwaway employee → reaped by the e2e cleanup.

/** Sign in and expect the first-login screen, not home. */
async function loginToSetPassword(page: Page, code: string, password: string) {
  await page.goto('/login');
  await expect(async () => {
    if (/\/set-password$/.test(page.url())) return;
    await page.fill('#code', code);
    await page.fill('#password', password);
    await expect(page.locator('#password')).toHaveValue(password, { timeout: 1_000 });
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/set-password$/, { timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
}

test('first login requires an own password; an admin reset requires it again', async ({ page }) => {
  test.setTimeout(240_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const { code, password: issued } = await createEmployee(page, {
    name: 'First Login Tester',
    roles: ['employee'],
  });
  await logout(page);

  // Issued password → the set-password screen, and the app stays closed.
  await loginToSetPassword(page, code, issued);
  await page.goto('/home');
  await expect(page).toHaveURL(/\/set-password$/);

  // The issued password itself is refused.
  await page.fill('#new-password', issued);
  await page.fill('#confirm-password', issued);
  await page.click('[data-testid="set-password-submit"]');
  await expect(page.locator('[data-testid="set-password-error"]')).toBeVisible({ timeout: 10_000 });

  const own = `${issued}-mine`;
  await setFirstPassword(page, own);
  await logout(page);

  // The chosen password goes straight home.
  await login(page, code, own);
  await expect(page).toHaveURL(/\/home$/);
  await logout(page);

  // An admin regenerates the password → the screen comes back.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto(`/manage/employees?q=${code}`);
  await page.locator(`[data-testid="emp-check-${code}"]`).check();
  await page.locator('[data-testid="regen-passwords"]').click();
  await page.locator('[data-testid="regen-confirm"]').click();
  const row = page.locator('[data-testid="credentials-table"] tbody tr').filter({ hasText: code });
  await expect(row).toBeVisible({ timeout: 20_000 });
  const reissued = (await row.locator('td').nth(2).textContent())?.trim() ?? '';
  expect(reissued.length).toBeGreaterThan(6);
  await expect(page.locator('[data-testid="credentials-print-slips"]')).toBeVisible();
  await logout(page);

  await loginToSetPassword(page, code, reissued);
});
