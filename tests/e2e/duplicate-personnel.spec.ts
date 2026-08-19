/**
 * FR-39 — a personnel number that is already taken is reported ON THE FIELD.
 *
 * Regression guard for the reported bug: the database raises
 * `personnel number already exists`, no rule in lib/errors/db-error.ts matched
 * it, so `localizeDbError` fell through to `dbErrors.unexpected` and the admin
 * saw "An unexpected error occurred" in the page banner — naming neither the
 * field nor the cause.
 *
 * Runs against `/en/...` deliberately. An explicit locale prefix wins over the
 * stored preference (FR-34), so the asserted text does not depend on whichever
 * language the demo admin happens to have saved.
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  createEmployee,
  nextTestPersonnelNo,
} from './_helpers';

test.describe('duplicate personnel number', () => {
  test.setTimeout(120_000);

  test('is reported at the field, not as a generic banner error', async ({ page }) => {
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);

    // Reserved 999####### range, so global-teardown reaps this account.
    const personnelNo = nextTestPersonnelNo();
    await createEmployee(page, {
      name: 'Dup Original',
      roles: ['employee'],
      personnelNo,
    });

    // Second employee, same personnel number.
    await page.goto('/en/manage/employees/new');
    await expect(page).toHaveURL(/\/en\/manage\/employees\/new$/);

    await page.fill('#personnel_no', personnelNo);
    await page.fill('#full_name', 'Dup Second');

    const deptSelect = page.locator('#department_id');
    const firstDept = await deptSelect.locator('option').nth(1).getAttribute('value');
    await deptSelect.selectOption({ value: firstDept! });

    const fieldError = page.locator('[data-testid="personnel-no-error"]');
    const banner = page.locator('[data-testid="form-error"]');

    // Same swallowed-first-click race the createEmployee helper documents: retry
    // the submit until one of the two outcomes actually appears.
    await expect(async () => {
      if (await fieldError.isVisible()) return;
      await page.click('button[type="submit"]');
      await expect(fieldError).toBeVisible({ timeout: 20_000 });
    }).toPass({ timeout: 60_000 });

    // The message must name the problem, not be the unmapped-error fallback.
    await expect(fieldError).toContainText(/personnel number is already in use/i);
    await expect(fieldError).not.toContainText(/unexpected/i);

    // And it must appear exactly once on the page.
    await expect(banner).toHaveCount(0);

    // The input is marked invalid for assistive technology, and points at the
    // message (NFR-7).
    const input = page.locator('#personnel_no');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAttribute('aria-describedby', 'personnel_no-error');

    // Editing the field clears the stale message — it named a number the user
    // is no longer typing.
    await page.fill('#personnel_no', nextTestPersonnelNo());
    await expect(fieldError).toHaveCount(0);
    await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  });
});
