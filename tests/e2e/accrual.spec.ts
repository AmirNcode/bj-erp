import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, createEmployee } from './_helpers';

/**
 * FR-27 monthly accrual, end to end.
 *
 * The point of the test is idempotency: accrual runs on every balance read AND on
 * the admin button, so the thing that must be proven through the UI is that
 * running it twice does not credit twice. A unit test cannot prove that — the
 * guarantee lives in a partial unique index in Postgres.
 *
 * Uses a throwaway employee from the reserved 999####### personnel range so
 * `npm run cleanup:e2e` / globalTeardown removes it.
 */
test('accrual posts earned months once, and re-running changes nothing', async ({ page }) => {
  test.setTimeout(240_000); // cold `next dev` compiles each route on first hit

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);

  // A fresh employee. createEmployee fills the policy block with the leave-type
  // defaults (1 day/month for annual), and the start month defaults to the
  // current Jalali month — so at most the current month can be due.
  const { code } = await createEmployee(page, { name: 'Accrual Probe', roles: ['employee'] });

  // Post accruals for everyone and capture the summary.
  await page.goto('/manage/settings');
  await expect(page.locator('[data-testid="accrual-runner"]')).toBeVisible({ timeout: 20_000 });
  await page.click('[data-testid="accrual-run-btn"]');
  await expect(page.locator('[data-testid="accrual-result"]')).toBeVisible({ timeout: 30_000 });
  const firstRun = (await page.locator('[data-testid="accrual-result"]').textContent())?.trim() ?? '';

  // The employee's balance after the first run, as the admin sees it.
  await page.goto('/manage/employees');
  await page.click(`tr:has-text("${code}") a:has-text("ویرایش"), tr:has-text("${code}") a:has-text("Edit")`);
  await expect(page.locator('[data-testid="balances-section"]')).toBeVisible({ timeout: 20_000 });
  const balanceAfterFirst = await page
    .locator('[data-testid="balance-days-annual"]')
    .inputValue();

  // Run it again. Every month is already posted, so nothing may change.
  await page.goto('/manage/settings');
  await expect(page.locator('[data-testid="accrual-runner"]')).toBeVisible({ timeout: 20_000 });
  await page.click('[data-testid="accrual-run-btn"]');
  await expect(page.locator('[data-testid="accrual-result"]')).toBeVisible({ timeout: 30_000 });

  await page.goto('/manage/employees');
  await page.click(`tr:has-text("${code}") a:has-text("ویرایش"), tr:has-text("${code}") a:has-text("Edit")`);
  await expect(page.locator('[data-testid="balances-section"]')).toBeVisible({ timeout: 20_000 });
  const balanceAfterSecond = await page
    .locator('[data-testid="balance-days-annual"]')
    .inputValue();

  expect(balanceAfterSecond).toBe(balanceAfterFirst);
  expect(firstRun.length).toBeGreaterThan(0);

  // The policy editor is present and pre-filled with the company default rate.
  await expect(page.locator('[data-testid="policy-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="policy-rate-annual"]')).toHaveValue('1');
});
