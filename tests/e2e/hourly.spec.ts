import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  createEmployee,
  allocate,
  fillPicker,
  jalali2DayRange,
  approveThroughChain,
  requestIdFromQueueRow,
  signRequest,
} from './_helpers';

/**
 * FR-26 hourly leave / مرخصی ساعتی, end to end.
 *
 * Covers what only a real browser + database can: the hourly screen submits, a
 * manager sees the time range rather than a bare duration, approval debits the
 * balance by hours, and the per-day cap refuses the second request.
 *
 * Throwaway employee from the reserved 999####### range so globalTeardown /
 * `npm run cleanup:e2e` removes it.
 */
test('hourly request: submit, approve, and the per-day cap', async ({ page }) => {
  test.setTimeout(300_000); // cold `next dev` compiles each route on first hit

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const { code, password } = await createEmployee(page, {
    name: 'Hourly Probe',
    roles: ['employee'],
  });
  // Enough balance that the cap, not the balance, is what refuses the second one.
  await allocate(page, code, 5);
  await logout(page);

  // ── the employee files a 2h request ────────────────────────────────────────
  await login(page, code, password);
  await page.goto('/request/hourly');
  await expect(page.locator('[data-testid="hourly-form"]')).toBeVisible({ timeout: 20_000 });

  // A single working date, taken from the same helper the daily specs use so the
  // suite never lands on a weekend or a holiday.
  const day = jalali2DayRange().split(' — ')[0];

  const submitHourly = async (from: string, to: string) => {
    await page.selectOption('[data-testid="hourly-type"]', { index: 1 });
    await fillPicker(page, day);
    await page.selectOption('[data-testid="hourly-from"]', from);
    await page.selectOption('[data-testid="hourly-to"]', to);
    await signRequest(page, 'hourly');
    await page.click('[data-testid="hourly-submit"]');
  };

  await submitHourly('09:00', '11:00');
  await expect(page.locator('[data-testid="hourly-success"]')).toBeVisible({ timeout: 20_000 });

  // The employee's own list shows the time range, not just a duration.
  await page.goto('/request');
  await expect(page.getByText('۰۹:۰۰–۱۱:۰۰')).toBeVisible({ timeout: 20_000 });

  // ── the per-day cap refuses a 3h addition (2h + 3h > 4h) ──────────────────
  await page.goto('/request/hourly');
  await expect(page.locator('[data-testid="hourly-form"]')).toBeVisible({ timeout: 20_000 });
  await submitHourly('11:00', '14:00');
  const capError = page.locator('[data-testid="hourly-error"]');
  await expect(capError).toBeVisible({ timeout: 20_000 });
  await expect(capError).toContainText('سقف روزانه'); // the mapped fa message
  await logout(page);

  // ── an admin approves it and sees the time range in the queue ─────────────
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);

  // Read the balance BEFORE approving and assert the DELTA. The starting figure is
  // not ours to predict: createEmployee grants the leave-type default, allocate()
  // adds more, and monthly accrual may add another day. Only the -2h is this
  // test's claim.
  const balanceField = page.locator('[data-testid="balance-days-annual"]');
  const openEmployee = async () => {
    await page.goto('/manage/employees');
    await page.click(
      `tr:has-text("${code}") a:has-text("ویرایش"), tr:has-text("${code}") a:has-text("Edit")`
    );
    await expect(page.locator('[data-testid="balances-section"]')).toBeVisible({ timeout: 20_000 });
    return Number(await balanceField.inputValue());
  };
  const before = await openEmployee();

  await page.goto('/manage/approvals');
  const card = page.locator('div', { hasText: 'Hourly Probe' }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('۰۹:۰۰–۱۱:۰۰').first()).toBeVisible();

  // FR-36: approval is a chain (manager then HR). The admin may fill any step,
  // so this signs each outstanding one until the request is actually approved —
  // a single signature no longer debits anything.
  //
  // Target THIS employee's row, not `.first()`. The admin's queue is
  // company-wide, so in a full-suite run the first row can belong to another
  // spec's pending request — which is exactly how this test failed twice while
  // passing in isolation.
  const hourlyRow = page.locator('[data-testid^="approval-row-"]', { hasText: 'Hourly Probe' });
  await expect(hourlyRow).toHaveCount(1, { timeout: 20_000 });
  const hourlyId = await requestIdFromQueueRow(hourlyRow);
  await approveThroughChain(page, hourlyId);

  // Assert the OUTCOME, not the toast: sonner auto-dismisses, so waiting on it is
  // a race. A fully approved request leaves the queue for good.
  await expect(page.locator(`[data-testid="approve-btn-${hourlyId}"]`)).toHaveCount(0, {
    timeout: 20_000,
  });

  // 2 hours on an 8h day is exactly a quarter of a day.
  const after = await openEmployee();
  expect(after).toBeCloseTo(before - 0.25, 2);
});

test('sick leave is not offered hourly', async ({ page }) => {
  test.setTimeout(180_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/request/hourly');
  await expect(page.locator('[data-testid="hourly-form"]')).toBeVisible({ timeout: 20_000 });

  // allow_hourly is false for sick leave, so it must not be selectable at all.
  const options = await page.locator('[data-testid="hourly-type"] option').allTextContents();
  expect(options.join(' ')).not.toContain('استعلاجی');
  expect(options.join(' ')).not.toContain('Sick');
});
