import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee } from './_helpers';

test('profile settings persist, language switches locale, logout clears session', async ({ page }) => {
  test.setTimeout(120_000);
  const ts = Date.now();

  // Create a throwaway employee and log in as them.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const pw = await createEmployee(page, { code: `set${ts}`, name: `Set ${ts}`, roles: ['employee'] });
  await logout(page);
  await login(page, `set${ts}`, pw.trim());

  await page.goto('/profile');
  await expect(page.locator('[data-testid="settings-calendar"]')).toBeVisible({ timeout: 10_000 });

  // Calendar pref persists across a reload.
  await page.locator('[data-testid="settings-calendar"]').selectOption('gregorian');
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('[data-testid="settings-calendar"]')).toHaveValue('gregorian');

  // Language -> English: URL gains the /en prefix; <html> flips to en/ltr.
  await page.locator('[data-testid="settings-language"]').selectOption('en');
  await expect(page).toHaveURL(/\/en\/profile$/, { timeout: 10_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  // Logout returns to the login page.
  await page.locator('[data-testid="settings-logout"]').click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
});
