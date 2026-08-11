import { test, expect } from '@playwright/test';
import {
  login,
  SEEDED_EMPLOYEE_CODE,
  SEEDED_MANAGER_CODE,
  SEEDED_PASSWORD,
  SEEDED_SECURITY_CODE,
} from './_helpers';

// Smoke test over the seeded demo roster (scripts/seed-demo.mjs). Proves the
// Phase 5 "done-when": the client can log in as each role and see realistic data.
test.describe('Seeded demo roles', () => {
  test('seeded manager: Manage tab + approvals card + team reports', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, SEEDED_MANAGER_CODE, SEEDED_PASSWORD);
    await expect(page.locator('[data-testid="nav-manage"]')).toBeVisible();
    await expect(page.locator('[data-testid="home-approvals-card"]')).toBeVisible();
    await page.goto('/team');
    // .first(): the responsive /team layout renders both a desktop table and
    // mobile stacked cards (one hidden via CSS per viewport), so the name
    // appears twice in the DOM — same pattern as team.spec.ts and manage.spec.ts.
    await expect(page.getByText('Ali Rezaei').first()).toBeVisible({ timeout: 10_000 }); // a direct report
  });

  test('seeded employee: home board, no Manage tab', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, SEEDED_EMPLOYEE_CODE, SEEDED_PASSWORD);
    await expect(page.locator('[data-testid="home-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="home-my-team"]')).toBeVisible();
    await expect(page.locator('[data-testid="home-my-team"]')).toContainText('Reza Karimi');
    await expect(page.locator('[data-testid="home-my-team"]')).toContainText('Hossein Ahmadi');
    await expect(page.locator('[data-testid="home-my-team"]')).toContainText('employee');
    await expect(page.locator('[data-testid="nav-manage"]')).toHaveCount(0);
  });

  test('seeded security: company calendar, no Manage tab', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, SEEDED_SECURITY_CODE, SEEDED_PASSWORD);
    await expect(page.locator('[data-testid="nav-manage"]')).toHaveCount(0);
    await page.goto('/calendar');
    await expect(page.locator('[data-testid="calendar-view"]')).toBeVisible({ timeout: 10_000 });
  });
});
