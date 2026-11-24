import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login } from './_helpers';

// Owner rule: no field may trigger the iPhone zoom, i.e. every input, select, textarea and
// date field has a computed font-size of at least 16px on a touch screen (globals.css,
// `@media (pointer: coarse)`). Landscape (932px) matters: `md:text-sm` kicks in there.

async function fontSize(el: Locator): Promise<number> {
  return el.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
}

async function expectCoarse(page: Page) {
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  expect(coarse, 'touch emulation must set (pointer: coarse)').toBe(true);
}

const SIZES = [
  { name: 'portrait', viewport: { width: 390, height: 844 } },
  { name: 'landscape', viewport: { width: 932, height: 430 } },
];

for (const { name, viewport } of SIZES) {
  test.describe(`touch fields: ${name}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport });

    test('login code field is at least 16px', async ({ page }) => {
      await page.goto('/login');
      await expectCoarse(page);
      const code = page.locator('#code');
      await expect(code).toBeVisible();
      expect(await fontSize(code)).toBeGreaterThanOrEqual(16);
      expect(await fontSize(page.locator('#password'))).toBeGreaterThanOrEqual(16);
    });

    test('signed-in fields are at least 16px', async ({ page }) => {
      test.setTimeout(90_000);
      await login(page, ADMIN_CODE, ADMIN_PASSWORD);
      await expectCoarse(page);

      // Employees search.
      await page.goto('/manage/employees');
      const search = page.getByTestId('emp-search');
      await expect(search).toBeVisible();
      expect(await fontSize(search)).toBeGreaterThanOrEqual(16);

      // A native select on Settings > Working times.
      await page.goto('/settings');
      await page.getByTestId('settings-tab-workingTimes').click();
      await page.getByTestId('weekend-weekly-add').click();
      const select = page.locator('select[data-testid^="weekend-weekly-"]').first();
      await expect(select).toBeVisible();
      expect(await fontSize(select)).toBeGreaterThanOrEqual(16);

      // The Persian date field on the request form.
      await page.goto('/request?form=1');
      const date = page.getByTestId('daily-start-date').locator('input').first();
      await expect(date).toBeVisible();
      expect(await fontSize(date)).toBeGreaterThanOrEqual(16);
    });
  });
}
