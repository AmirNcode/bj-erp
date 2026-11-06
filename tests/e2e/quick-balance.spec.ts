/**
 * FR-85: HR adds time to a balance with a reason. The add updates the absolute
 * field, stays through a Save of the form, and shows up in the breakdown and history.
 * Uses its own throwaway employee.
 */
import { test, expect, type Page } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee, openLeaveSections } from './_helpers';

const days = '[data-testid="balance-days-annual"]';

async function openEdit(page: Page, code: string) {
  await page.goto(`/en/manage/employees?q=${code}`);
  await page.locator('tr', { hasText: code }).first().locator('a[href*="/manage/employees/"]').click();
  await expect(page.locator('[data-testid="quick-add-section"]')).toBeVisible({ timeout: 30_000 });
}

async function quickAdd(page: Page, dayCount: string, reason: string) {
  await page.fill('[data-testid="quick-add-amount-days"]', dayCount);
  await page.fill('[data-testid="quick-add-reason"]', reason);
  await page.click('[data-testid="quick-add-submit"]');
  await expect(page.locator('[data-testid="quick-add-done"]')).toBeVisible({ timeout: 30_000 });
}

async function minutes(page: Page) {
  return Number(await page.locator(days).getAttribute('data-minutes'));
}

test.describe.configure({ mode: 'serial' });

test('quick add, breakdown, history and collapsed sections', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const emp = await createEmployee(page, { name: 'Quick Add Probe', roles: ['employee'] });
  await openEdit(page, emp.code);

  // Both sections start closed, and the totals still show.
  await expect(page.locator('[data-testid="balances-section"]')).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-testid="policy-section"]')).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-testid="balance-total-annual"]')).toBeVisible();
  const before = await minutes(page);

  // The add reaches the absolute field, with its reason beside it.
  await quickAdd(page, '3', 'Returned early from leave');
  await expect(page.locator(days)).toHaveAttribute('data-minutes', String(before + 3 * 8 * 60), { timeout: 20_000 });
  await openLeaveSections(page);
  await expect(page.locator(days)).toHaveValue(String(Math.trunc((before + 1440) / 480)));
  await expect(page.locator('[data-testid="balance-breakdown-annual"]')).toContainText('Returned early from leave');

  // Saving the form afterwards keeps the add.
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="edit-success"]')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.locator(days)).toHaveAttribute('data-minutes', String(before + 1440), { timeout: 20_000 });

  // A value typed but not saved does not undo the next add.
  await openLeaveSections(page);
  await page.fill(days, '50');
  await quickAdd(page, '1', 'Second add');
  await expect(page.locator(days)).toHaveAttribute('data-minutes', String(before + 1920), { timeout: 20_000 });
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="edit-success"]')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.locator(days)).toHaveAttribute('data-minutes', String(before + 1920), { timeout: 20_000 });

  // History lists both, newest first, with who added them and no hand edit.
  await page.locator('[data-testid="balance-history"] summary').click();
  const rows = page.locator('[data-testid="balance-history-row"]');
  await expect(rows.first()).toContainText('Second add', { timeout: 20_000 });
  await expect(page.locator('[data-testid="balance-history"]')).not.toContainText('Set by hand');
  const count = await rows.count();

  // A double click posts one row.
  await page.fill('[data-testid="quick-add-amount-days"]', '1');
  await page.fill('[data-testid="quick-add-reason"]', 'Double click');
  await page.dblclick('[data-testid="quick-add-submit"]');
  await expect(page.locator('[data-testid="quick-add-done"]')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.locator(days)).toHaveAttribute('data-minutes', String(before + 2400), { timeout: 20_000 });
  await page.locator('[data-testid="balance-history"] summary').click();
  await expect(rows.first()).toContainText('Double click', { timeout: 20_000 });
  await expect(rows).toHaveCount(count + 1);
});

test('open history picks up a quick add without a reload', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const emp = await createEmployee(page, { name: 'Live History Probe', roles: ['employee'] });
  await openEdit(page, emp.code);
  await page.locator('[data-testid="balance-history"] summary').click();
  await expect(page.locator('[data-testid="balance-history-row"]').first()).toBeVisible({ timeout: 20_000 });
  await quickAdd(page, '2', 'Added with history open');
  await expect(page.locator('[data-testid="balance-history-row"]').first()).toContainText('Added with history open', {
    timeout: 20_000,
  });
});

test('an invalid value in a closed section opens it', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const emp = await createEmployee(page, { name: 'Closed Section Probe', roles: ['employee'] });
  await openEdit(page, emp.code);
  await openLeaveSections(page);
  await page.fill('[data-testid="balance-hours-annual"]', '999');
  await page.locator('[data-testid="balances-section"] summary').click();
  await expect(page.locator('[data-testid="balances-section"]')).not.toHaveAttribute('open', '');
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="balances-section"]')).toHaveAttribute('open', '', { timeout: 10_000 });
});

test('quick add refuses an empty reason and a zero amount', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const emp = await createEmployee(page, { name: 'Quick Add Refused', roles: ['employee'] });
  await openEdit(page, emp.code);
  await page.fill('[data-testid="quick-add-amount-days"]', '1');
  await page.fill('[data-testid="quick-add-reason"]', '   ');
  await page.click('[data-testid="quick-add-submit"]');
  await expect(page.locator('[data-testid="quick-add-error"]')).toBeVisible({ timeout: 20_000 });
  await page.fill('[data-testid="quick-add-amount-days"]', '0');
  await page.fill('[data-testid="quick-add-reason"]', 'A reason');
  await page.click('[data-testid="quick-add-submit"]');
  await expect(page.locator('[data-testid="quick-add-error"]')).toBeVisible();
  await expect(page.locator('[data-testid="quick-add-done"]')).toHaveCount(0);
});

test('a viewer who cannot edit balances sees history, not the add fields', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const hr = await createEmployee(page, { name: 'Read Only HR', roles: ['hr', 'employee'] });
  await openEdit(page, hr.code);
  await quickAdd(page, '1', 'Seen on own record');
  const url = page.url();
  await logout(page);

  // HR holds leave_balances edit, but never on their own record.
  await login(page, hr.code, hr.password);
  await page.goto(url);
  await expect(page.locator('[data-testid="quick-add-section"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="quick-add-submit"]')).toHaveCount(0);
  await page.locator('[data-testid="balance-history"] summary').click();
  await expect(page.locator('[data-testid="balance-history-row"]').first()).toContainText('Seen on own record', {
    timeout: 20_000,
  });
});
