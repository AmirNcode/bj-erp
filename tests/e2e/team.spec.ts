/**
 * e2e: Manager "My Team" view + editing direct reports.
 *
 * Flow:
 * 1. Admin logs in, creates manager M and two employees E (report of M) and X (no manager).
 * 2. Log in as M.
 * 3. /team lists E but not X.
 * 4. M edits E → only full_name + hire_date fields visible → change saves.
 * 5. M tries to edit X via direct URL → action returns error / no change (RLS blocks).
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
  await page.fill('#full_name', opts.name);

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
  const labels = page.locator('label');
  const count = await labels.count();
  for (let i = 0; i < count; i++) {
    const labelText = await labels.nth(i).textContent();
    const trimmed = labelText?.trim();
    if (['admin', 'manager', 'employee', 'security'].includes(trimmed ?? '')) {
      const cb = labels.nth(i).locator('input[type="checkbox"]');
      const isChecked = await cb.isChecked();
      if (trimmed === opts.role && !isChecked) {
        await cb.check();
      } else if (trimmed !== opts.role && isChecked) {
        await cb.uncheck();
      }
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

test.describe('Manager "My Team" view + direct-report edits', () => {
  test('manager sees only reports, can edit report, cannot persist X change', async ({ page }) => {
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

    // ── 7. Open E's edit page → only full_name + hire_date editable ────────
    await page.goto(`/fa/manage/employees/${empId}`);
    await expect(page).toHaveURL(new RegExp(`/manage/employees/${empId}$`), { timeout: 10000 });

    // department select must not exist (admin-only)
    await expect(page.locator('#department_id')).not.toBeVisible();
    // manager select must not exist
    await expect(page.locator('#manager_id')).not.toBeVisible();
    // roles checkboxes must not exist
    await expect(page.locator('input[type="checkbox"]')).not.toBeVisible();

    // full_name and hire_date must exist
    await expect(page.locator('#full_name')).toBeVisible();
    await expect(page.locator('#hire_date')).toBeVisible();

    // Change full_name and save
    const newName = `Updated Report ${ts}`;
    await page.fill('#full_name', newName);
    await page.click('button[type="submit"]');

    // Success banner should appear
    await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 10000 });

    // Reload to confirm the name persisted
    await page.reload();
    await expect(page.locator('#full_name')).toHaveValue(newName, { timeout: 8000 });

    // ── 8. Negative: M navigates to X's edit page and tries to save ────────
    await page.goto(`/fa/manage/employees/${nonId}`);
    // Page loads (managers can read all profiles via RLS SELECT policy)
    await expect(page.locator('#full_name')).toBeVisible({ timeout: 10000 });

    const xOrigName = (await page.locator('#full_name').inputValue()) ?? '';
    const xBadName = `BLOCKED_CHANGE_${ts}`;
    await page.fill('#full_name', xBadName);
    await page.click('button[type="submit"]');

    // Expect an error alert (RLS blocks the UPDATE)
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 10000 });

    // Reload and confirm X's name is unchanged
    await page.reload();
    const xCurrentName = await page.locator('#full_name').inputValue();
    expect(xCurrentName).toBe(xOrigName);
    expect(xCurrentName).not.toBe(xBadName);
  });
});
