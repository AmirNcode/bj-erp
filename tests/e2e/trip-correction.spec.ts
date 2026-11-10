/**
 * FR-84/FR-91: an editor (here the admin) edits an approved daily trip from Manage › Requests. The signed dates
 * stay on the print form, with the correction listed after them. Uses throwaway users.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee, setManager, signRequest,
  signApproval, approveThroughChain, fillDailyErrandDateRange, jalali2DayRange,
} from './_helpers';

/** An approved two-day trip; leaves the admin signed in and returns the request id. */
async function approvedTrip(page: Page, location: string, offsetDays: number, booked = false) {
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const mgr = await createEmployee(page, { name: 'Correction Manager', roles: ['manager'] });
  const emp = await createEmployee(page, { name: 'Correction Probe', roles: ['employee'] });
  await setManager(page, emp.code, mgr.code);
  await logout(page);

  await login(page, emp.code, emp.password);
  await page.goto('/request?form=1&all=1');
  await page.locator('[data-testid="request-tab-dailyErrand"]').click();
  await fillDailyErrandDateRange(page, jalali2DayRange(offsetDays));
  await page.fill('[data-testid="daily-errand-location"]', location);
  await signRequest(page, 'daily-errand');
  await page.click('[data-testid="daily-errand-submit"]');
  await expect(page.locator('[data-testid="daily-errand-success"]')).toBeVisible({ timeout: 20_000 });
  await logout(page);

  if (booked) {
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);
    // Tick this trip, not whichever pending errand Approvals lists first (FR-87).
    await page.goto('/en/manage/approvals');
    const card = page.locator('[data-testid^="approval-row-"]', { hasText: location }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const tripId = ((await card.getAttribute('data-testid')) ?? '').replace('approval-row-', '');
    await page.locator(`[data-testid="travel-tick-${tripId}"]`).click();
    await expect(page.locator(`[data-testid="travel-tick-${tripId}"]`)).toBeChecked({ timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await logout(page);
  }

  await login(page, mgr.code, mgr.password);
  await page.goto('/manage/approvals');
  const row = page.locator('[data-testid^="approval-row-"]', { hasText: location }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const id = ((await row.getAttribute('data-testid')) ?? '').replace('approval-row-', '');
  await approveThroughChain(page, id);
  await logout(page);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await approveThroughChain(page, id);
  return id;
}

async function openEdit(page: Page, id: string, reason: string, perDiem?: string) {
  await page.goto('/en/manage/requests');
  await page.click(`[data-testid="edit-request-${id}"]`);
  if (perDiem) await page.fill('[data-testid="edit-per-diem"]', perDiem);
  await page.fill('[data-testid="edit-reason"]', reason);
}

test('an editor adds a missing per diem to an approved trip', async ({ page }) => {
  test.setTimeout(240_000);
  const id = await approvedTrip(page, 'Per diem site', 20);
  await openEdit(page, id, 'Forgot the per diem', '2500000');
  const canvas = page.locator('[data-testid^="edit-"][data-testid$="-signature-canvas"]');
  await expect(canvas).toBeVisible();
  await signApproval(page, 'edit');
  await page.click('[data-testid="edit-submit"]');
  await expect(page.locator('[data-testid="edit-submit"]')).toHaveCount(0, { timeout: 20_000 });

  await page.goto(`/en/print/request/${id}`);
  await expect(page.locator('[data-testid="print-correction"]')).toContainText('Forgot the per diem');
  await expect(page.locator('[data-testid="print-correction"]')).toContainText('2,500,000');
  await expect(page.locator('[data-testid="print-per-diem"]')).toHaveCount(0);
});

test('an editor changes the end date and the print form keeps the signed date', async ({ page }) => {
  test.setTimeout(240_000);
  const id = await approvedTrip(page, 'Date fix site', 40);
  await page.goto(`/en/print/request/${id}`);
  const signed = await page.locator('main').innerText();
  await openEdit(page, id, 'Wrong end date on the form');
  const newEnd = jalali2DayRange(90).split(/\s+—\s+/)[1];
  const input = page.locator('[data-testid="edit-end"] input');
  await input.click();
  await input.fill(newEnd);
  await page.keyboard.press('Enter');
  await page.locator('[data-testid="edit-reason"]').click();
  await signApproval(page, 'edit');
  await page.click('[data-testid="edit-submit"]');
  await expect(page.locator('[data-testid="edit-submit"]')).toHaveCount(0, { timeout: 20_000 });

  await page.goto(`/en/print/request/${id}`);
  const line = page.locator('[data-testid="print-correction"]');
  await expect(line).toContainText('Wrong end date on the form');
  // Everything printed before still reads as it did when signed, apart from the header's
  // live duration, which follows the current dates as it does after an extension.
  const after = await page.locator('main').innerText();
  for (const printed of signed.split('\n').filter((l) => l && !l.includes('Duration'))) {
    expect(after).toContain(printed);
  }
});

test('an edited booking goes back to procurement with the old and new dates', async ({ page }) => {
  test.setTimeout(240_000);
  const id = await approvedTrip(page, 'Booked site', 50, true);
  await openEdit(page, id, 'Return flight moved');
  const newEnd = jalali2DayRange(100).split(/\s+—\s+/)[1];
  const input = page.locator('[data-testid="edit-end"] input');
  await input.click();
  await input.fill(newEnd);
  await page.keyboard.press('Enter');
  await page.locator('[data-testid="edit-reason"]').click();
  await signApproval(page, 'edit');
  await page.click('[data-testid="edit-submit"]');
  await expect(page.locator('[data-testid="edit-submit"]')).toHaveCount(0, { timeout: 20_000 });

  await page.goto('/en/procurement');
  await expect(page.locator('[data-testid="procurement-group-corrected"]')).toContainText('Booked site', { timeout: 20_000 });
  await page.goto(`/en/procurement/${id}`);
  await expect(page.locator('[data-testid="procurement-correction-note"]')).toContainText('Return flight moved');
});

test('Save stays disabled until something changed', async ({ page }) => {
  test.setTimeout(240_000);
  const id = await approvedTrip(page, 'No change site', 30);
  await openEdit(page, id, 'No real change');
  await signApproval(page, 'edit');
  await expect(page.locator('[data-testid="edit-submit"]')).toBeDisabled();
});
