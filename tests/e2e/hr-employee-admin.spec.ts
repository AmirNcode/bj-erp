/**
 * FR-51 — hr administers employees and departments.
 *
 * hr edits department, direct manager and job title, deactivates and reactivates,
 * and adds or removes the `manager` role — on anyone except an admin, and never
 * on their own record. hr also creates and renames departments and sets their
 * manager. The database enforces all of it (tests/sql/fr51-hr-employee-admin.sql);
 * this proves the screens offer exactly that and that the saves land.
 *
 * Touches only its own throwaway users and a `zz…` department (reaped by
 * scripts/cleanup-e2e.mjs). It does NOT press the accrual button: that posts for
 * every employee in the company.
 *
 * Runs against `/en/...`: an explicit locale prefix beats the stored preference
 * (FR-34), so the asserted text does not depend on a user's language.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  createEmployee,
  nextTestDepartmentCode,
} from './_helpers';

const slug = (nameEn: string) =>
  nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function openEdit(page: Page, code: string) {
  await page.goto(`/en/manage/employees?q=${encodeURIComponent(code)}`);
  await page.locator('tr', { hasText: code }).first().locator('a[href*="/manage/employees/"]').click();
  await expect(page).toHaveURL(/\/manage\/employees\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.locator('#full_name')).toBeVisible({ timeout: 30_000 });
}

async function save(page: Page) {
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="edit-success"]')).toBeVisible({ timeout: 30_000 });
}

test('hr edits, deactivates and promotes an employee, but not an admin or themselves', async ({ page }) => {
  test.setTimeout(300_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const hr = await createEmployee(page, { name: 'FR51 HR', roles: ['hr'] });
  const boss = await createEmployee(page, { name: 'FR51 Boss', roles: ['manager'] });
  const worker = await createEmployee(page, { name: 'FR51 Worker', roles: ['employee'] });
  await logout(page);

  await login(page, hr.code, hr.password);

  // ── 1. department, manager, title and the manager role ───────────────────
  await openEdit(page, worker.code);
  await expect(page.getByLabel('security', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('admin', { exact: true })).toBeDisabled();
  await expect(page.locator('[data-testid="employee-deactivate"]')).toBeVisible();

  const dept = page.locator('#department_id');
  const newDept = (await dept.locator('option').nth(2).getAttribute('value')) ?? '';
  expect(newDept).not.toBe('');
  await dept.selectOption(newDept);
  const bossId =
    (await page.locator('#manager_id option', { hasText: boss.code }).getAttribute('value')) ?? '';
  expect(bossId).not.toBe('');
  await page.locator('#manager_id').selectOption(bossId);
  await page.fill('[data-testid="job-title"]', 'Welder');
  await page.getByLabel('manager', { exact: true }).check();
  await save(page);

  await page.reload();
  await expect(page.locator('[data-testid="job-title"]')).toHaveValue('Welder', { timeout: 30_000 });
  await expect(dept).toHaveValue(newDept);
  await expect(page.locator('#manager_id')).toHaveValue(bossId);
  await expect(page.getByLabel('manager', { exact: true })).toBeChecked();

  // ── 2. and the role comes off again ──────────────────────────────────────
  await page.getByLabel('manager', { exact: true }).uncheck();
  await save(page);
  await page.reload();
  await expect(page.getByLabel('manager', { exact: true })).not.toBeChecked({ timeout: 30_000 });

  // ── 3. deactivate, then reactivate ───────────────────────────────────────
  await page.click('[data-testid="employee-deactivate"]');
  await page.click('[data-testid="employee-deactivate-confirm"]');
  await expect(page.locator('[data-testid="employee-activate"]')).toBeVisible({ timeout: 30_000 });
  await page.click('[data-testid="employee-activate"]');
  await expect(page.locator('[data-testid="employee-deactivate"]')).toBeVisible({ timeout: 30_000 });

  // ── 4. an admin's record is read-only for hr ─────────────────────────────
  await openEdit(page, ADMIN_CODE);
  await expect(page.locator('[data-testid="edit-scope-note"]')).toContainText('Only an admin');
  await expect(page.locator('[data-testid="job-title"]')).toBeDisabled();
  await expect(page.locator('#department_id')).toBeDisabled();
  await expect(page.getByLabel('manager', { exact: true })).toBeDisabled();
  await expect(page.locator('[data-testid="employee-deactivate"]')).toHaveCount(0);

  // ── 5. so are hr's own org fields ────────────────────────────────────────
  await openEdit(page, hr.code);
  await expect(page.locator('[data-testid="edit-scope-note"]')).toContainText('your own department');
  await expect(page.locator('#department_id')).toBeDisabled();
  await expect(page.locator('#manager_id')).toBeDisabled();
  await expect(page.locator('[data-testid="employee-deactivate"]')).toHaveCount(0);
});

test('hr creates a department, renames it and sets its manager', async ({ page }) => {
  test.setTimeout(300_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const hr = await createEmployee(page, { name: 'FR51 Dept HR', roles: ['hr'] });
  const boss = await createEmployee(page, { name: 'FR51 Dept Boss', roles: ['manager'] });
  await logout(page);

  await login(page, hr.code, hr.password);
  await page.goto('/en/home');
  await expect(page.locator('[data-testid="nav-departments"]').first()).toBeVisible({ timeout: 30_000 });

  // ── create ───────────────────────────────────────────────────────────────
  const token = nextTestDepartmentCode();
  const nameEn = `${token} FR51 Unit`;
  await page.goto('/en/manage/departments');
  await expect(page.locator('[data-testid="dept-list"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="accrual-runner"]')).toBeVisible();
  await page.locator('[data-testid="add-department-link"]').click();
  await page.fill('[data-testid="dept-name-fa"]', `واحد ${token}`);
  await page.fill('[data-testid="dept-name-en"]', nameEn);
  await page.click('[data-testid="dept-submit"]');
  await expect(page.locator('[data-testid="dept-created"]')).toBeVisible({ timeout: 30_000 });

  // ── rename ───────────────────────────────────────────────────────────────
  const renamed = `${token} FR51 Renamed`;
  await page.goto('/en/manage/departments');
  await page.click(`[data-testid="dept-rename-${slug(nameEn)}"]`);
  await page.fill('[data-testid="dept-name-fa-input"]', `واحد تازه ${token}`);
  await page.fill('[data-testid="dept-name-en-input"]', renamed);
  await page.click('[data-testid="dept-rename-save"]');
  const row = page.locator(`[data-testid="dept-row-${slug(renamed)}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  // The code is the import key and did not move: still the zz… token's prefix.
  await expect(page.locator(`[data-testid="dept-code-${slug(renamed)}"]`)).toHaveText(
    token.slice(0, 4).toUpperCase()
  );

  // ── manager ──────────────────────────────────────────────────────────────
  const picker = page.locator(`[data-testid="dept-manager-${slug(renamed)}"]`);
  const bossId =
    (await picker.locator('option', { hasText: 'FR51 Dept Boss' }).first().getAttribute('value')) ?? '';
  expect(bossId).not.toBe('');
  await picker.selectOption(bossId);
  await page.waitForTimeout(1500); // server action + refresh
  await page.reload();
  await expect(page.locator(`[data-testid="dept-manager-${slug(renamed)}"]`)).toHaveValue(bossId, {
    timeout: 30_000,
  });
  expect(boss.code).toMatch(/^999/);
});
