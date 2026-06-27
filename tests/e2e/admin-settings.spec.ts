import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee } from './_helpers';

// FR-24: admin adds a holiday and toggles a weekend day; a non-admin is blocked.
// Mutates shared company config, so the test restores it (delete the holiday it
// added; toggle the weekend day back) to keep the serial suite idempotent.
test('admin edits work settings + holidays; non-admin blocked', async ({ page }) => {
  test.setTimeout(180_000); // cold `next dev` compiles each route on first hit
  const ts = Date.now();
  const HOLIDAY_NAME = `تعطیلی آزمایشی ${ts}`; // unique per run → robust to any leaked row

  // A non-admin is redirected away from /manage/settings (manage layout guard).
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const code = `set${ts.toString().slice(-6)}`;
  const pw = await createEmployee(page, { code, name: 'Settings Outsider', roles: ['employee'] });
  await logout(page);
  await login(page, code, pw.trim());
  await page.goto('/manage/settings');
  await expect(page).toHaveURL(/\/home$/, { timeout: 10_000 });
  await logout(page);

  // Admin: add a holiday and see it listed.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/settings');
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

  // Toggle a weekend day (add Thursday), save, then toggle back and save (reset).
  await page.click('[data-testid="weekend-thu"]');
  await page.click('[data-testid="work-settings-save"]');
  await expect(page.locator('[data-testid="work-settings-saved"]')).toBeVisible({ timeout: 10_000 });
  await page.click('[data-testid="weekend-thu"]');
  await page.click('[data-testid="work-settings-save"]');
  await expect(page.locator('[data-testid="work-settings-saved"]')).toBeVisible({ timeout: 10_000 });

  // Cleanup: delete the holiday we added; it disappears from the list.
  await addedRow.locator('button').click();
  await expect(addedRow).toHaveCount(0, { timeout: 10_000 });
});
