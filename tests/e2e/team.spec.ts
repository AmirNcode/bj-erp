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

import { test, expect } from '@playwright/test';

const ADMIN_CODE = 'admin';
const ADMIN_PASSWORD = 'Admin!2026';

// Helper: log in as given code/password and expect redirect to /home
async function loginAs(page: ReturnType<typeof test.info>['_test']['page'] extends infer P ? P : never, code: string, password: string) {
  await page.goto('/login');
  await page.fill('#code', code);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/home$/, { timeout: 15000 });
}

async function createEmployee(
  page: Parameters<typeof loginAs>[0],
  opts: {
    code: string;
    name: string;
    role: string;
    managerId?: string; // value of the manager <option>
    deptFirst?: boolean;
  }
): Promise<string> {
  // Navigate to new employee form
  await page.goto('/fa/manage/employees/new');
  await expect(page).toHaveURL(/\/manage\/employees\/new$/);

  await page.fill('#employee_code', opts.code);
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
  if (opts.managerId) {
    await page.locator('#manager_id').selectOption({ value: opts.managerId });
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

  await page.click('button[type="submit"]');

  // Grab temp password
  const pwEl = page.locator('.font-mono').first();
  await expect(pwEl).toBeVisible({ timeout: 15000 });
  const tempPassword = (await pwEl.textContent()) ?? '';
  expect(tempPassword.trim().length).toBeGreaterThan(6);

  return tempPassword.trim();
}

test.describe('Manager "My Team" view + direct-report edits', () => {
  test('manager sees only reports, can edit report, cannot persist X change', async ({ page }) => {
    const ts = Date.now();
    const mgrCode = `mgr${ts}`;
    const empCode = `emp${ts}`;
    const nonCode = `non${ts}`;

    // ── 1. Log in as admin ─────────────────────────────────────────────────
    await loginAs(page as any, ADMIN_CODE, ADMIN_PASSWORD);

    // ── 2. Create manager M ────────────────────────────────────────────────
    const mgrPassword = await createEmployee(page as any, {
      code: mgrCode,
      name: `Manager ${ts}`,
      role: 'manager',
    });

    // Done link back to list
    await page.click('[data-testid="done-link"]');
    await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 10000 });

    // Grab manager's UUID from the edit link in the list
    const mgrEditLink = page.locator(`a[href*="/manage/employees/"]`).filter({ hasText: /edit|ویرایش/i }).first();
    // We need to find M's row specifically. Use the code to find the row.
    const mgrRow = page.locator('tr').filter({ hasText: mgrCode });
    const mgrHref = await mgrRow.locator('a[href*="/manage/employees/"]').getAttribute('href');
    const mgrId = mgrHref?.split('/manage/employees/')[1]?.split('?')[0] ?? '';
    expect(mgrId).toBeTruthy();

    // ── 3. Create employee E (report of M) ─────────────────────────────────
    const empPassword = await createEmployee(page as any, {
      code: empCode,
      name: `Employee Report ${ts}`,
      role: 'employee',
      managerId: mgrId,
    });

    await page.click('[data-testid="done-link"]');
    await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 10000 });

    // Capture E's UUID
    const empRow = page.locator('tr').filter({ hasText: empCode });
    const empHref = await empRow.locator('a[href*="/manage/employees/"]').getAttribute('href');
    const empId = empHref?.split('/manage/employees/')[1]?.split('?')[0] ?? '';
    expect(empId).toBeTruthy();

    // ── 4. Create employee X (no manager) ─────────────────────────────────
    const nonPassword = await createEmployee(page as any, {
      code: nonCode,
      name: `Non-Report ${ts}`,
      role: 'employee',
    });

    await page.click('[data-testid="done-link"]');
    await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 10000 });

    // Capture X's UUID
    const nonRow = page.locator('tr').filter({ hasText: nonCode });
    const nonHref = await nonRow.locator('a[href*="/manage/employees/"]').getAttribute('href');
    const nonId = nonHref?.split('/manage/employees/')[1]?.split('?')[0] ?? '';
    expect(nonId).toBeTruthy();

    // ── 5. Log in as manager M ─────────────────────────────────────────────
    await page.goto('/login');
    await page.fill('#code', mgrCode);
    await page.fill('#password', mgrPassword);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/home$/, { timeout: 15000 });

    // ── 6. Navigate to /team — should see E but NOT X ─────────────────────
    await page.goto('/fa/team');
    await expect(page).toHaveURL(/\/team$/, { timeout: 10000 });

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
