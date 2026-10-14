/**
 * FR-55 — admin-configurable roles. Throwaway 999… users only (local DB holds the
 * real roster). Transfer admin is covered in tests/sql/fr55-roles-permissions.sql.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  ADMIN_CODE, ADMIN_PASSWORD, createEmployee, firstLoginPassword, login, setFirstPassword,
} from './_helpers';

/** Open an employee's edit page from the (server-filtered) list. */
async function openEmployee(page: Page, code: string) {
  await page.goto(`/manage/employees?q=${code}`);
  const row = page.locator('tr', { hasText: code });
  await expect(row.first()).toBeVisible({ timeout: 20_000 });
  await row.first().locator('a').first().click();
  await expect(page).toHaveURL(/\/manage\/employees\/[0-9a-f-]{36}$/, { timeout: 20_000 });
}

test('admin creates Helpdesk; helpdesk resets an employee, not a manager; delete lists holders', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const helper = await createEmployee(page, { name: 'E2E Helpdesk', roles: ['employee'] });
  const worker = await createEmployee(page, { name: 'E2E Worker', roles: ['employee'] });
  const boss = await createEmployee(page, { name: 'E2E Boss', roles: ['employee', 'manager'] });

  // 1. create the role; Passwords raises Employee records to Read only
  const roleName = `Helpdesk ${Date.now() % 100000}`;
  await page.goto('/settings/roles/new');
  await page.getByTestId('role-name').fill(roleName);
  await page.getByTestId('perm-passwords-edit').click();
  await expect(page.getByTestId('perm-people-read')).toHaveAttribute('data-state', 'on');
  await page.getByTestId('role-save').click();
  await expect(page).toHaveURL(/\/settings\/roles\/[0-9a-f-]{36}$/);
  const roleId = page.url().split('/').pop()!;

  // 2. assign it to the helper
  await openEmployee(page, helper.code);
  const box = page.locator(`[data-testid="role-${roleId}"] input`);
  await box.check();
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('edit-success')).toBeVisible({ timeout: 20_000 });
  await expect(box).toBeChecked();

  // 3. helpdesk session (fresh account: first-login password screen first)
  const ctx = await browser.newContext();
  const hp = await ctx.newPage();
  await login(hp, helper.code, helper.password);
  await setFirstPassword(hp, firstLoginPassword(helper.password));
  await openEmployee(hp, worker.code);
  await expect(hp.getByTestId('reset-password')).toBeVisible();
  await openEmployee(hp, boss.code);
  await expect(hp.getByTestId('reset-password')).toHaveCount(0);
  await expect(hp.getByTestId('edit-scope-note')).toBeVisible();
  await ctx.close();

  // 4. delete lists the holder's personnel number, then removes the role
  await page.goto('/settings/roles');
  await page.getByTestId(`role-delete-${roleId}`).click();
  await expect(page.getByTestId('delete-holders')).toContainText(helper.code);
  await page.getByTestId('delete-confirm').click();
  await expect(page.getByTestId(`role-row-${roleId}`)).toHaveCount(0);
});
