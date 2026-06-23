import { test, expect } from '@playwright/test';

// '/' now redirects unauthenticated users to '/login' (which is '/fa/login'
// because 'fa' is the default locale served without a prefix).
// The login page still renders with lang="fa" dir="rtl" and an h1 heading.

test('default locale is fa and RTL', async ({ page }) => {
  await page.goto('/');
  // Redirects to /fa/login (or /login after next-intl strips the default locale prefix)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
});

test('login page renders Farsi title', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('ورود به سامانه');
});

test('manifest.webmanifest served with 200', async ({ page }) => {
  const response = await page.request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.display).toBe('standalone');
});
