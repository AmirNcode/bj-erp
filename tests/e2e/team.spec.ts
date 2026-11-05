/**
 * e2e: Manager "My Team" view, read-only (FR-74).
 *
 * Flow:
 * 1. Admin logs in, creates manager M and two employees E (report of M) and X (no manager).
 * 2. Log in as M.
 * 3. /team lists E but not X.
 * 4. M opens E → read-only: name and hire date shown disabled, no Save, no Add.
 * 5. M opens X via direct URL → not found (managers see only direct reports).
 */

import { test, expect, type Page } from '@playwright/test';
import {
  nextTestPersonnelNo,
  pickManager,
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
} from './_helpers';

/**
 * Unlike the shared `createEmployee`, this one sets exactly one role and can
 * name the new employee's manager in the same form.
 */
async function createEmployeeWithManager(
  page: Page,
  opts: {
    name: string;
    role: string;
    managerCode?: string; // the manager's code, typed into the Direct Manager search
    deptFirst?: boolean;
  }
): Promise<{ code: string; password: string }> {
  // Navigate to new employee form
  await page.goto('/fa/manage/employees/new');
  await expect(page).toHaveURL(/\/manage\/employees\/new$/);

  await page.fill('#personnel_no', nextTestPersonnelNo());
  await page.fill('#first_name', opts.name);
  await page.fill('#last_name', 'E2E');

  // Pick the first real department
  const deptSelect = page.locator('#department_id');
  const deptOptions = await deptSelect.locator('option').all();
  for (const opt of deptOptions) {
    const val = await opt.getAttribute('value');
    if (val && val.trim()) {
      await deptSelect.selectOption({ value: val });
      break;
    }
  }

  // If a manager option text was supplied, select it
  if (opts.managerCode) {
    await pickManager(page, opts.managerCode);
  }

  // Ensure the desired role checkbox is checked (uncheck all others)
  for (const slug of ['admin', 'manager', 'employee', 'security']) {
    const cb = page.locator(`[data-testid="role-${slug}"] input[type="checkbox"]`);
    if (!(await cb.count())) continue;
    const isChecked = await cb.isChecked();
    if (slug === opts.role && !isChecked) {
      await cb.check();
    } else if (slug !== opts.role && isChecked) {
      await cb.uncheck();
    }
  }

  const code = (await page.locator('[data-testid="code-preview"]').textContent())?.trim() ?? '';
  expect(code).toMatch(/^999[0-9]{7}$/);

  await page.click('button[type="submit"]');

  // Grab temp password
  const pwEl = page.locator('[data-testid="temp-password"]');
  await expect(pwEl).toBeVisible({ timeout: 15000 });
  const tempPassword = (await pwEl.textContent()) ?? '';
  expect(tempPassword.trim().length).toBeGreaterThan(6);

  return { code, password: tempPassword.trim() };
}

test.describe('Manager "My Team" view, read-only (FR-74)', () => {
  test('manager sees only reports, read-only, and cannot open a non-report', async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();

    // ── 1. Log in as admin ─────────────────────────────────────────────────
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);

    // ── 2. Create manager M ────────────────────────────────────────────────
    const { code: mgrCode, password: mgrPassword } = await createEmployeeWithManager(page, {
      name: `Manager ${ts}`,
      role: 'manager',
    });

    // Done link back to list
    await page.click('[data-testid="done-link"]');
    await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 10000 });

    // The list is paginated (25/page): search for M's row by code.
    await page.goto(`/fa/manage/employees?q=${mgrCode}`);
    const mgrRow = page.locator('tr').filter({ hasText: mgrCode });
    const mgrHref = await mgrRow.locator('a[href*="/manage/employees/"]').getAttribute('href');
    const mgrId = mgrHref?.split('/manage/employees/')[1]?.split('?')[0] ?? '';
    expect(mgrId).toBeTruthy();

    // ── 3. Create employee E (report of M) ─────────────────────────────────
    const { code: empCode } = await createEmployeeWithManager(page, {
      name: `Employee Report ${ts}`,
      role: 'employee',
      managerCode: mgrCode,
    });

    await page.click('[data-testid="done-link"]');
    await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 10000 });

    // Capture E's UUID
    await page.goto(`/fa/manage/employees?q=${empCode}`);
    const empRow = page.locator('tr').filter({ hasText: empCode });
    const empHref = await empRow.locator('a[href*="/manage/employees/"]').getAttribute('href');
    const empId = empHref?.split('/manage/employees/')[1]?.split('?')[0] ?? '';
    expect(empId).toBeTruthy();

    // ── 4. Create employee X (no manager) ─────────────────────────────────
    const { code: nonCode } = await createEmployeeWithManager(page, {
      name: `Non-Report ${ts}`,
      role: 'employee',
    });

    await page.click('[data-testid="done-link"]');
    await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 10000 });

    // Capture X's UUID
    await page.goto(`/fa/manage/employees?q=${nonCode}`);
    const nonRow = page.locator('tr').filter({ hasText: nonCode });
    const nonHref = await nonRow.locator('a[href*="/manage/employees/"]').getAttribute('href');
    const nonId = nonHref?.split('/manage/employees/')[1]?.split('?')[0] ?? '';
    expect(nonId).toBeTruthy();

    // ── 5. Log in as manager M ─────────────────────────────────────────────
    await login(page, mgrCode, mgrPassword);
    await expect(page).toHaveURL(/\/home$/, { timeout: 15000 });

    // ── 6. /team (now Employees › my direct reports) — E but NOT X ─────────
    await page.goto('/fa/team');
    await expect(page).toHaveURL(/\/manage\/employees\?filter=reports$/, { timeout: 10000 });

    // E's code should be visible
    await expect(page.getByText(empCode).first()).toBeVisible({ timeout: 8000 });

    // X's code must NOT appear on this page
    await expect(page.getByText(nonCode)).not.toBeVisible();

    // FR-74: no Add employee for a manager.
    await expect(page.locator('[data-testid="add-employee-link"]')).toHaveCount(0);

    // ── 7. Open E's page → read-only ─────────────────────────────────────
    await page.goto(`/fa/manage/employees/${empId}`);
    await expect(page).toHaveURL(new RegExp(`/manage/employees/${empId}$`), { timeout: 10000 });

    // department / manager / roles are never shown to a manager
    await expect(page.locator('#department_id')).not.toBeVisible();
    await expect(page.locator('#manager_id')).not.toBeVisible();
    await expect(page.locator('input[type="checkbox"]')).not.toBeVisible();

    // name and hire date shown, but disabled; nothing to save
    await expect(page.locator('#first_name')).toBeVisible();
    await expect(page.locator('#first_name')).toBeDisabled();
    await expect(page.locator('[data-testid="edit-scope-note"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-save"]')).toHaveCount(0);

    // ── 8. Negative: M opens X's page → not found ───────────────────────
    await page.goto(`/fa/manage/employees/${nonId}`);
    await expect(page.locator('#first_name')).toHaveCount(0, { timeout: 10000 });

    // /new is HR and admin only
    await page.goto('/fa/manage/employees/new');
    await expect(page).toHaveURL(/\/home$/, { timeout: 10000 });
  });
});
