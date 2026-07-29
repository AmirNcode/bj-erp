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

  test('password field reveals on toggle and stays latin LTR', async ({ page }) => {
    await page.goto('/login');
    const field = page.locator('#password');
    const toggle = page.locator('[data-testid="password-toggle"]');

    // Latin-only + left-to-right: a Farsi keyboard must not be able to put
    // Persian characters into a password that could then never match.
    await expect(field).toHaveAttribute('dir', 'ltr');
    await field.fill('رمز۱۲۳abc!');
    await expect(field).toHaveValue('123abc!');

    // Hidden by default, revealed on toggle, hidden again on second press.
    await expect(field).toHaveAttribute('type', 'password');
    await toggle.click();
    await expect(field).toHaveAttribute('type', 'text');
    await toggle.click();
    await expect(field).toHaveAttribute('type', 'password');
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
