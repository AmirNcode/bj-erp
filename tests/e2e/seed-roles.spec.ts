import { test, expect } from '@playwright/test';
import { login } from './_helpers';

// Smoke test over the seeded demo roster (scripts/seed-demo.mjs). Proves the
// Phase 5 "done-when": the client can log in as each role and see realistic data.
const PW = 'Demo!2026';

test.describe('Seeded demo roles', () => {
  test('manager (m-prod): Manage tab + approvals card + team reports', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, 'm-prod', PW);
    await expect(page.locator('[data-testid="nav-manage"]')).toBeVisible();
    await expect(page.locator('[data-testid="home-approvals-card"]')).toBeVisible();
    await page.goto('/team');
    // .first(): the responsive /team layout renders both a desktop table and
    // mobile stacked cards (one hidden via CSS per viewport), so the name
    // appears twice in the DOM — same pattern as team.spec.ts and manage.spec.ts.
    await expect(page.getByText('Ali Rezaei').first()).toBeVisible({ timeout: 10_000 }); // a direct report
  });

  test('employee (e-prod-1): home board, no Manage tab', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, 'e-prod-1', PW);
    await expect(page.locator('[data-testid="home-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-manage"]')).toHaveCount(0);
  });

  test('security (s-sup): company calendar, no Manage tab', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, 's-sup', PW);
    await expect(page.locator('[data-testid="nav-manage"]')).toHaveCount(0);
    await page.goto('/calendar');
    await expect(page.locator('[data-testid="calendar-view"]')).toBeVisible({ timeout: 10_000 });
  });
});
