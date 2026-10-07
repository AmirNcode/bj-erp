/**
 * Leave balances are edited as whole days + whole hours.
 *
 * The Edit Employee form used to show a balance as decimal days in a box that
 * stepped by half days. A personnel-CSV balance of "3 days 6 hours" (3.75 days)
 * failed the browser's step check, so the WHOLE form refused to submit — an admin
 * could not even change that employee's roles.
 *
 * Runs against `/en/...`: an explicit locale prefix beats the stored preference
 * (FR-34), so the asserted text does not depend on the demo admin's language.
 */
import { test, expect, type Page } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, createEmployee } from './_helpers';

const days = '[data-testid="balance-days-annual"]';
const hours = '[data-testid="balance-hours-annual"]';

async function openEdit(page: Page, code: string) {
  await page.goto(`/en/manage/employees?q=${code}`);
  await page.locator('tr', { hasText: code }).first().locator('a[href*="/manage/employees/"]').click();
  await expect(page.locator('[data-testid="balances-section"]')).toBeVisible({ timeout: 30_000 });
}

async function save(page: Page) {
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="edit-success"]')).toBeVisible({ timeout: 30_000 });
}

test('a days + hours balance survives an unrelated save, and negatives work', async ({ page }) => {
  test.setTimeout(240_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const emp = await createEmployee(page, { name: 'Days Hours Probe', roles: ['employee'] });

  // ── 1. Set 3 days 6 hours — the uploaded HR manager's shape ──────────────
  await openEdit(page, emp.code);
  await page.fill(days, '3');
  await page.fill(hours, '6');
  await save(page);
  await page.reload();
  await expect(page.locator(days)).toHaveValue('3', { timeout: 20_000 });
  await expect(page.locator(hours)).toHaveValue('6');
  // 3 days at the 8h demo day + 6 hours, stored exactly.
  await expect(page.locator(days)).toHaveAttribute('data-minutes', '1800');

  // ── 2. Change only the roles: the save goes through, the balance stays ───
  await page.getByLabel('hr', { exact: true }).check();
  await save(page);
  await page.reload();
  await expect(page.getByLabel('hr', { exact: true })).toBeChecked({ timeout: 20_000 });
  await expect(page.locator(days)).toHaveAttribute('data-minutes', '1800');

  // ── 3. A mixed sign is refused before anything is written ────────────────
  await page.fill(days, '-1');
  await page.fill(hours, '4');
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="edit-error"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('put the minus sign on both days and hours')).toBeVisible();
  await page.reload();
  await expect(page.locator(days)).toHaveAttribute('data-minutes', '1800', { timeout: 20_000 });

  // ── 4. A negative balance (leave taken in advance, FR-48) ────────────────
  await page.fill(days, '-1');
  await page.fill(hours, '-4');
  await save(page);
  await page.reload();
  await expect(page.locator(days)).toHaveValue('-1', { timeout: 20_000 });
  await expect(page.locator(hours)).toHaveValue('-4');
  await expect(page.locator(days)).toHaveAttribute('data-minutes', '-720');
});
