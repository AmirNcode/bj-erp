/**
 * ERP › Sales record removal (admin only). The admin archives one fresh record (it reads Archived and
 * Archive is then disabled), deletes a second one (back on the Records list, hidden there, listed under
 * Deleted, read-only with a banner) and restores it. A throwaway 999… Sales editor sees no
 * Delete / Archive button. Local stack only: the records created here stay (archived / restored).
 */
import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, createEmployee, login } from './_helpers';
import { createBidRecord, createSalesRole, deleteRoleIfPresent } from './_sales';

test('sales remove: admin archives, deletes and restores; a Sales editor has no button', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const tag = String(Date.now() % 100000);
  let role: string | null = null;
  try {
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);

    // Archive.
    const archiveId = await createBidRecord(page, `E2E remove archive ${tag}`);
    await page.getByTestId('sales-remove-open').click();
    await expect(page.getByTestId('sales-remove-confirm')).toBeDisabled();
    await page.getByTestId('sales-remove-archive').check();
    await expect(page.getByTestId('sales-remove-confirm')).toBeEnabled();
    await page.getByTestId('sales-remove-confirm').click();
    await expect(page.getByTestId('sales-stage-archived')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('sales-remove-open').click();
    await expect(page.getByTestId('sales-remove-archive')).toBeDisabled();
    await page.getByTestId('sales-remove-cancel').click();
    await expect(page.getByTestId('sales-remove-confirm')).toHaveCount(0);

    // Delete: lands on the Records list, the record is not listed under All, listed under Deleted.
    const title = `E2E remove delete ${tag}`;
    const deleteId = await createBidRecord(page, title);
    await page.getByTestId('sales-remove-open').click();
    await page.getByTestId('sales-remove-delete').check();
    await page.getByTestId('sales-remove-confirm').click();
    await expect(page).toHaveURL(/\/sales(\?.*)?$/, { timeout: 30_000 });
    await page.goto(`/sales?state=all&q=${encodeURIComponent(title)}`);
    await expect(page.getByTestId('sales-list-count')).toBeVisible();
    await expect(page.locator(`a[href$="/sales/${deleteId}"]`)).toHaveCount(0);
    await page.goto(`/sales?state=deleted&q=${encodeURIComponent(title)}`);
    await expect(page.locator(`a[href$="/sales/${deleteId}"]`).first()).toBeVisible({ timeout: 30_000 });

    // Deleted record: banner, no Delete / Archive button, Restore brings it back.
    await page.goto(`/sales/${deleteId}`);
    await expect(page.getByTestId('sales-deleted-banner')).toBeVisible();
    await expect(page.getByTestId('sales-remove-open')).toHaveCount(0);
    await page.getByTestId('sales-restore').click();
    await expect(page.getByTestId('sales-deleted-banner')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('sales-remove-open')).toBeVisible();
    await page.goto(`/sales?state=all&q=${encodeURIComponent(title)}`);
    await expect(page.locator(`a[href$="/sales/${deleteId}"]`).first()).toBeVisible({ timeout: 30_000 });

    // A Sales editor (not admin) sees no button, on a live and on an archived record.
    role = await createSalesRole(page, `E2E Sales Remove ${tag}`, ['sales', 'sales_decide']);
    const u = await createEmployee(page, { name: 'E2E Sales Editor', roles: ['employee', role] });
    const ctx = await browser.newContext();
    const pu = await ctx.newPage();
    await login(pu, u.code, u.password);
    await pu.goto(`/sales/${deleteId}`);
    await expect(pu.getByTestId('sales-record')).toBeVisible({ timeout: 30_000 });
    await expect(pu.getByTestId('sales-remove-open')).toHaveCount(0);
    await pu.goto(`/sales/${archiveId}`);
    await expect(pu.getByTestId('sales-record')).toBeVisible({ timeout: 30_000 });
    await expect(pu.getByTestId('sales-remove-open')).toHaveCount(0);
    await ctx.close();
  } finally {
    await login(page, ADMIN_CODE, ADMIN_PASSWORD).catch(() => {});
    await deleteRoleIfPresent(page, role).catch(() => {});
  }
});
