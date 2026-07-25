import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  nextTestDepartmentCode,
  nextTestPersonnelNo,
} from './_helpers';

/**
 * Admin adds a department from the Manage tab, then hires into it — the gap
 * this closes: before, a new employee could only join a department that
 * already existed in the seed.
 *
 * The department uses a zz#### code (reserved for tests) so the run's rows are
 * removed by scripts/cleanup-e2e.mjs; the employee's zz####-999####### login
 * code is removed by app_cleanup_e2e_users().
 */
test('admin creates a department and hires an employee into it', async ({ page }) => {
  test.setTimeout(180_000); // cold `next dev` compiles each route on first hit
  const deptCode = nextTestDepartmentCode();
  const pno = nextTestPersonnelNo();
  const nameFa = `واحد آزمایشی ${deptCode}`;
  const nameEn = `E2E Department ${deptCode}`;

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/employees');

  // The button sits beside "Add Employee" in the page header.
  const addDept = page.locator('[data-testid="add-department-link"]');
  await expect(addDept).toBeVisible({ timeout: 15_000 });
  await addDept.click();
  await expect(page).toHaveURL(/\/manage\/departments\/new$/, { timeout: 15_000 });

  await page.fill('[data-testid="dept-name-fa"]', nameFa);
  await page.fill('[data-testid="dept-name-en"]', nameEn);
  // The English name auto-suggests a code; typing one overrides the suggestion.
  await page.fill('[data-testid="dept-code"]', deptCode);
  await page.locator('#kind').selectOption({ value: 'office' });
  await page.click('[data-testid="dept-submit"]');

  const created = page.locator('[data-testid="dept-created"]');
  await expect(created).toBeVisible({ timeout: 15_000 });
  await expect(created).toContainText(deptCode);

  // Follow the success screen straight into employee creation.
  await page.click('[data-testid="dept-add-employee"]');
  await expect(page).toHaveURL(/\/manage\/employees\/new$/, { timeout: 15_000 });

  // The brand-new department is selectable, and drives the generated login code.
  const deptSelect = page.locator('#department_id');
  await expect(deptSelect).toBeVisible({ timeout: 10_000 });
  let deptValue = '';
  for (const opt of await deptSelect.locator('option').all()) {
    if ((await opt.textContent())?.trim() === nameFa) {
      deptValue = (await opt.getAttribute('value')) ?? '';
      break;
    }
  }
  expect(deptValue).not.toBe('');
  await deptSelect.selectOption({ value: deptValue });

  await page.fill('#personnel_no', pno);
  await page.fill('#full_name', `New Dept Hire ${pno}`);
  await expect(page.locator('[data-testid="code-preview"]')).toHaveText(`${deptCode}-${pno}`);

  await page.click('button[type="submit"]');
  const pwEl = page.locator('[data-testid="temp-password"]');
  await expect(pwEl).toBeVisible({ timeout: 15_000 });
  const password = (await pwEl.textContent())?.trim() ?? '';

  // The employee can log in with the code built from the new department.
  await logout(page);
  await login(page, `${deptCode}-${pno}`, password);
  await expect(page.locator('[data-testid="home-board"]')).toBeVisible({ timeout: 10_000 });
});

/** Departments are company-wide config: admin only, even inside /manage. */
test('a manager cannot reach the new-department page', async ({ page }) => {
  test.setTimeout(120_000);

  await login(page, 'm-prod', 'Demo!2026');
  await page.goto('/manage/employees');
  await expect(page.locator('[data-testid="add-department-link"]')).toHaveCount(0);

  await page.goto('/manage/departments/new');
  await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 15_000 });
});
