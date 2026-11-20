/**
 * Shared steps for the ERP › Sales specs. Throwaway 999… users and throwaway roles only:
 * the local database holds the real roster, so a spec never edits an existing person.
 */
import { expect, type Page } from '@playwright/test';

export type SalesPerm = 'sales' | 'sales_settings' | 'sales_decide' | 'project_items';

/** Create a custom role that grants `edit` on each given Sales item. Returns the role id. */
export async function createSalesRole(page: Page, name: string, edit: SalesPerm[]): Promise<string> {
  await page.goto('/settings/roles/new');
  await page.getByTestId('role-name').fill(name);
  for (const key of edit) {
    const on = page.getByTestId(`perm-${key}-edit`);
    if (!(await on.isVisible())) await page.getByTestId('perm-block-sales').click();
    await expect(on).toBeVisible({ timeout: 20_000 });
    await on.click();
  }
  await page.getByTestId('role-save').click();
  const confirm = page.getByTestId('sensitive-confirm');
  if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) await confirm.click();
  await expect(page).toHaveURL(/\/settings\/roles\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return page.url().split('/').pop()!;
}

/** Create a read-only Sales role (the `sales` item at read level). */
export async function createSalesReadRole(page: Page, name: string): Promise<string> {
  await page.goto('/settings/roles/new');
  await page.getByTestId('role-name').fill(name);
  const on = page.getByTestId('perm-sales-read');
  if (!(await on.isVisible())) await page.getByTestId('perm-block-sales').click();
  await on.click();
  await page.getByTestId('role-save').click();
  const confirm = page.getByTestId('sensitive-confirm');
  if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) await confirm.click();
  await expect(page).toHaveURL(/\/settings\/roles\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return page.url().split('/').pop()!;
}

/** Delete a role by id through Settings › Roles, if it still exists (cleanup:e2e reaps users, not roles). */
export async function deleteRoleIfPresent(page: Page, roleId: string | null) {
  if (!roleId) return;
  await page.goto('/settings/roles');
  const del = page.getByTestId(`role-delete-${roleId}`);
  if ((await del.count()) === 0) return;
  await del.click();
  await expect(page.getByTestId('delete-confirm')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('delete-confirm').click();
  await expect(page.getByTestId(`role-row-${roleId}`)).toHaveCount(0);
}

/** New bid record (RFP) through the list dialog. Returns the record id. */
export async function createBidRecord(page: Page, title: string): Promise<string> {
  await page.goto('/sales');
  await page.getByTestId('sales-new-rfp').click();
  await page.getByTestId('sales-form-title').fill(title);
  await page.getByTestId('sales-form-save').click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: 30_000 });
  return page.url().match(/\/sales\/([0-9a-f-]{36})/)![1];
}
