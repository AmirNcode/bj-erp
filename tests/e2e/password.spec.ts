import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee } from './_helpers';

// FR-7: a user changes their own password and can log in with the new one; a wrong
// current password is rejected. Throwaway employee → no shared-state cleanup needed.
test('self-service password change', async ({ page }) => {
  test.setTimeout(180_000); // cold `next dev` compiles each route on first hit
  const code = `pwd${Date.now().toString().slice(-6)}`;
  const NEW_PW = 'NewPass!2026';

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const tempPw = await createEmployee(page, { code, name: 'Password Tester', roles: ['employee'] });
  await logout(page);

  await login(page, code, tempPw.trim());
  await page.goto('/profile');

  // Wrong current password → error.
  await page.fill('#pwd-current', 'definitely-wrong');
  await page.fill('#pwd-new', NEW_PW);
  await page.fill('#pwd-confirm', NEW_PW);
  await page.click('[data-testid="password-submit"]');
  await expect(page.locator('[data-testid="password-error"]')).toBeVisible({ timeout: 10_000 });

  // Correct current password → success.
  await page.fill('#pwd-current', tempPw.trim());
  await page.fill('#pwd-new', NEW_PW);
  await page.fill('#pwd-confirm', NEW_PW);
  await page.click('[data-testid="password-submit"]');
  await expect(page.locator('[data-testid="password-success"]')).toBeVisible({ timeout: 10_000 });
  await logout(page);

  // The new password works.
  await login(page, code, NEW_PW);
  await expect(page).toHaveURL(/\/home$/);
});
