import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login } from './_helpers';

test('responsive: nav usable and no horizontal overflow on mobile + desktop', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);

  // ── Mobile ──
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/home');
  await expect(page.locator('[data-testid="home-board"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-home"]')).toBeVisible();

  // No horizontal scroll (allow 1px for sub-pixel rounding).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // Nav touch target is tall enough (NFR-7).
  const box = await page.locator('[data-testid="nav-home"]').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  // ── Desktop ──
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/home');
  await expect(page.locator('[data-testid="nav-home"]')).toBeVisible();
  const overflowDesktop = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflowDesktop).toBeLessThanOrEqual(1);
});
