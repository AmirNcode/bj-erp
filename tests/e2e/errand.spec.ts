import { test, expect, type Page } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  createEmployee,
  allocate,
  fillDailyErrandDateRange,
  fillPicker,
  jalali2DayRange,
  signApproval,
  signRequest,
} from './_helpers';

/**
 * FR-30 hourly work errand / ماموریت ساعتی (BJ-F 50207), end to end.
 *
 * Covers what only a real browser + database can: the errand screen submits
 * without a leave type, the row comes back tagged as an errand with its own
 * tracking number, the DIRECT MANAGER (not the admin override) can decide it in
 * the ordinary approvals queue, and — the whole point of the feature — approving
 * it leaves the employee's leave balance untouched.
 *
 * Throwaway employees from the reserved 999####### range so globalTeardown /
 * `npm run cleanup:e2e` removes them.
 */

const LOCATION = 'اداره کار اهواز';
const DESCRIPTION = 'پیگیری پرونده بیمه';

/** On the employee's edit page, set their direct manager (match by code substring). */
async function setManager(page: Page, employeeCode: string, managerCodeSubstring: string) {
  await page.goto('/manage/employees');
  const row = page.locator('tr', { hasText: employeeCode });
  await expect(row.first()).toBeVisible({ timeout: 20_000 });
  await row.first().locator('a').first().click();
  await expect(page).toHaveURL(/\/manage\/employees\/[0-9a-f-]+$/, { timeout: 20_000 });

  const mgrSelect = page.locator('#manager_id');
  await expect(mgrSelect).toBeVisible({ timeout: 20_000 });
  let mgrValue = '';
  for (const opt of await mgrSelect.locator('option').all()) {
    const text = await opt.textContent();
    if (text?.includes(managerCodeSubstring)) {
      mgrValue = (await opt.getAttribute('value')) ?? '';
      break;
    }
  }
  expect(mgrValue).not.toBe('');
  await mgrSelect.selectOption({ value: mgrValue });

  await page.click('button[type="submit"]');
  await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 20_000 });
}

test('errand request: submit, manager approves, leave balance untouched', async ({ page }) => {
  test.setTimeout(300_000); // cold `next dev` compiles each route on first hit

  // ── setup: a manager, a report, and a balance worth watching ──────────────
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const { code: mgrCode, password: mgrPw } = await createEmployee(page, {
    name: 'Errand Manager',
    roles: ['manager'],
  });
  const { code, password } = await createEmployee(page, {
    name: 'Errand Probe',
    roles: ['employee'],
  });
  await setManager(page, code, mgrCode);
  // A non-zero balance, so "unchanged" is a real assertion rather than 0 === 0.
  await allocate(page, code, 5);

  // Read the balance BEFORE. The starting figure is not ours to predict —
  // createEmployee grants the leave-type default, allocate() adds more, and
  // monthly accrual may add another day. Only "it did not move" is our claim.
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
  await logout(page);

  // ── the employee files a 09:00–11:00 errand ───────────────────────────────
  await login(page, code, password);
  await page.goto('/request/errand');
  await expect(page.locator('[data-testid="errand-form"]')).toBeVisible({ timeout: 20_000 });

  // A single working date, from the same helper the daily specs use, so the
  // suite never lands on a weekend or a holiday. (An errand is ALLOWED on one —
  // this just keeps the fixture boring.)
  const day = jalali2DayRange().split(' — ')[0];
  await fillPicker(page, day);
  await page.selectOption('[data-testid="errand-from"]', '09:00');
  await page.selectOption('[data-testid="errand-to"]', '11:00');
  await page.fill('[data-testid="errand-location"]', LOCATION);
  await page.fill('[data-testid="errand-description"]', DESCRIPTION);
  await signRequest(page, 'errand');
  await page.click('[data-testid="errand-submit"]');
  await expect(page.locator('[data-testid="errand-success"]')).toBeVisible({ timeout: 20_000 });

  // ── it comes back tagged as an errand, with its location and a tracking no ─
  await page.goto('/request');
  await expect(page.locator('[data-testid^="errand-badge-"]').first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('[data-testid^="errand-location-"]').first()).toContainText(LOCATION);
  // Only one request exists for this fresh employee, so this is that errand's.
  // `serial-*` marks the VALUE; assert its shape, and the label separately.
  await expect(page.locator('[data-testid^="serial-"]').first()).toHaveText(
    /^[۰-۹0-9]{4}-[۰-۹0-9]{4,}$/
  );
  await expect(page.getByText('شماره پیگیری').first()).toBeVisible();
  await expect(page.getByText('۰۹:۰۰–۱۱:۰۰')).toBeVisible({ timeout: 20_000 });
  await logout(page);

  // ── the DIRECT MANAGER decides it in the ordinary queue ───────────────────
  await login(page, mgrCode, mgrPw);
  await page.goto('/manage/approvals');

  const approve = page.locator('[data-testid^="approve-btn-"]');
  await expect(approve.first()).toBeVisible({ timeout: 20_000 });
  await expect(approve).toHaveCount(1); // exactly this report's errand
  await expect(page.locator('[data-testid^="errand-badge-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="errand-location-"]').first()).toContainText(LOCATION);

  await approve.first().click();
  await signApproval(page);
  await page.locator('[data-testid^="approve-confirm-"]').first().click();

  // Assert the OUTCOME, not the toast: sonner auto-dismisses, so waiting on it
  // is a race. An approved request leaves the queue.
  await expect(page.locator('[data-testid="approvals-empty"]')).toBeVisible({ timeout: 20_000 });
  await logout(page);

  // ── an errand is WORK: the balance must be exactly where it was ───────────
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const after = await openEmployee();
  expect(after).toBeCloseTo(before, 2);
});

test('daily work errand: date range submission and signed manager approval', async ({ page }) => {
  test.setTimeout(300_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const { code: mgrCode, password: mgrPw } = await createEmployee(page, {
    name: 'Daily Errand Manager',
    roles: ['manager'],
  });
  const { code, password } = await createEmployee(page, {
    name: 'Daily Errand Probe',
    roles: ['employee'],
  });
  await setManager(page, code, mgrCode);
  await logout(page);

  await login(page, code, password);
  await page.goto('/request');
  await expect(page.locator('[data-testid="request-tab-dailyErrand"]')).toContainText(
    /Daily Work Errands|ماموریت روزانه/
  );
  await expect(page.locator('[data-testid="request-tab-errand"]')).toContainText(
    /Hourly Work Errand|ماموریت ساعتی/
  );
  await page.locator('[data-testid="request-tab-dailyErrand"]').click();
  await expect(page).toHaveURL(/\/request\/daily-errand$/);
  await expect(page.locator('[data-testid="daily-errand-form"]')).toBeVisible();

  await fillDailyErrandDateRange(page, jalali2DayRange(14));
  await page.fill('[data-testid="daily-errand-location"]', 'Tehran head office');
  await page.fill('[data-testid="daily-errand-description"]', 'Supplier planning meeting');
  await expect(page.locator('[data-testid="daily-errand-preview"]')).toContainText(/[2۲]/);
  await signRequest(page, 'daily-errand');
  await page.click('[data-testid="daily-errand-submit"]');
  await expect(page.locator('[data-testid="daily-errand-success"]')).toBeVisible({
    timeout: 20_000,
  });

  await page.goto('/request');
  const row = page.locator('[data-testid^="request-row-"]').first();
  await expect(row).toContainText('Tehran head office');
  await expect(row).toContainText(/[2۲]/);
  await logout(page);

  await login(page, mgrCode, mgrPw);
  await page.goto('/manage/approvals');
  const approval = page.locator('[data-testid^="approval-row-"]').first();
  await expect(approval).toContainText('Tehran head office', { timeout: 20_000 });
  await approval.locator('[data-testid^="approve-btn-"]').click();
  await signApproval(page);
  await page.locator('[data-testid^="approve-confirm-"]').first().click();
  await expect(page.locator('[data-testid="approvals-empty"]')).toBeVisible({ timeout: 20_000 });
});
