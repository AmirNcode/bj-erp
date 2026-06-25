import { test, expect } from '@playwright/test';

const ADMIN_CODE = 'admin';
const ADMIN_PASSWORD = 'Admin!2026';
const ADMIN_FULL_NAME = 'مدیر سیستم';

test.describe('Login flow', () => {
  test('correct credentials land on /home and show full_name', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#code', ADMIN_CODE);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // Should redirect to /fa/home (or /home with default locale prefix stripped)
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.locator('h1')).toContainText(ADMIN_FULL_NAME);
  });

  test('wrong password shows error and stays on login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#code', ADMIN_CODE);
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Should stay on login page
    await expect(page).toHaveURL(/\/login$/);
    // Error message should be visible
    await expect(page.locator('p[role="alert"]')).toBeVisible();
    await expect(page.locator('p[role="alert"]')).toContainText('کد پرسنلی یا رمز عبور اشتباه است');
  });

  test('reloading /home after login keeps session (no redirect to login)', async ({ page }) => {
    // Log in first
    await page.goto('/login');
    await page.fill('#code', ADMIN_CODE);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/home$/);

    // Reload — should stay on home, not redirect to login
    await page.reload();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.locator('h1')).toContainText(ADMIN_FULL_NAME);
  });
});
