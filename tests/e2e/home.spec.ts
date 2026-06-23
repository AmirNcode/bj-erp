import { test, expect } from '@playwright/test';

test('default locale is fa and RTL', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
});

test('home page renders Farsi title', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('سامانه منابع انسانی');
});

test('manifest.webmanifest served with 200', async ({ page }) => {
  const response = await page.request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.display).toBe('standalone');
});
