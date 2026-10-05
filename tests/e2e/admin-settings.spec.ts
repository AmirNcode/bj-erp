import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee } from './_helpers';

// FR-24: admin adds a holiday and toggles a weekend day; a non-admin is blocked.
// Mutates shared company config, so the test restores it (delete the holiday it
// added; toggle the weekend day back) to keep the serial suite idempotent.
test('admin edits work settings + holidays; non-admin blocked', async ({ page }) => {
  test.setTimeout(180_000); // cold `next dev` compiles each route on first hit
  const ts = Date.now();
  const HOLIDAY_NAME = `تعطیلی آزمایشی ${ts}`; // unique per run → robust to any leaked row

  // A non-admin is redirected away from /settings (admin-only page guard).
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const { code, password } = await createEmployee(page, { name: 'Settings Outsider', roles: ['employee'] });
  await logout(page);
  await login(page, code, password);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/home$/, { timeout: 10_000 });
  await logout(page);

  // Admin: add a holiday and see it listed.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/settings');
  await expect(page.locator('[data-testid="work-settings"]')).toBeVisible({ timeout: 15_000 });

  const picker = page.locator('.rmdp-container input').first();
  await picker.click();
  await picker.fill('1405/10/01'); // Jalali (admin default calendar) → stored Gregorian
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('h1').click(); // close the calendar popup
  await page.fill('[data-testid="holiday-name-fa"]', HOLIDAY_NAME);
  await page.click('[data-testid="holiday-add"]');

  const addedRow = page.locator('[data-testid="holiday-list"] li', { hasText: HOLIDAY_NAME });
  await expect(addedRow).toBeVisible({ timeout: 10_000 });

  // Add Thursday as a second weekly day off, save, then remove it again (reset).
  //
  // Driven with selectOption on the native day dropdowns: the "off every week"
  // row is a list of <select>s, one per day, plus an "Add day" button.
  const weeklyValues = () =>
    page
      .locator('select[data-testid^="weekend-weekly-"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
  await page.click('[data-testid="weekend-weekly-add"]');
  const added = page.locator('[data-testid="weekend-weekly-1"]');
  await added.selectOption('thu');
  await expect(added).toHaveValue('thu');
  await page.click('[data-testid="work-settings-save"]');
  await expect(page.locator('[data-testid="work-settings-saved"]')).toBeVisible({ timeout: 10_000 });

  await page.reload();
  // The saved value survives a reload — proof the write landed, not just that the
  // form said so. Days come back in week order, so Thursday may move slots.
  await expect(page.locator('[data-testid="weekend-weekly-0"]')).toBeVisible({ timeout: 15_000 });
  expect(await weeklyValues()).toEqual(expect.arrayContaining(['thu', 'fri']));

  const thuIndex = (await weeklyValues()).indexOf('thu');
  await page.click(`[data-testid="weekend-weekly-remove-${thuIndex}"]`);
  await page.click('[data-testid="work-settings-save"]');
  await expect(page.locator('[data-testid="work-settings-saved"]')).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator('[data-testid="weekend-weekly-0"]')).toBeVisible({ timeout: 15_000 });
  expect(await weeklyValues()).toEqual(['fri']);

  // Cleanup: delete the holiday we added via AlertDialog confirm; it disappears from the list.
  await addedRow.locator('button').click(); // opens AlertDialog
  // Click the confirm action button inside the AlertDialog (data-testid includes the holiday id)
  await page.locator('[data-testid^="holiday-delete-confirm-"]').click();
  await expect(addedRow).toHaveCount(0, { timeout: 10_000 });
});
