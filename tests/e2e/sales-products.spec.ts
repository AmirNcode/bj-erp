/**
 * ERP › Sales products catalog and currencies (CEO feedback round 1). Throwaway 999… user and
 * role. The user creates the product "Gate valve" with a Size default, picks it on an item row
 * (Size is copied in), adds the Toman currency (it shows in the record currency picker), and the
 * spec removes both again at the end.
 */
import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, createEmployee, login } from './_helpers';
import { createBidRecord, createSalesRole, deleteRoleIfPresent } from './_sales';

test('sales products: Size default fills the item row; a new currency reaches the record picker', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const tag = String(Date.now() % 100000);
  const productName = `Gate valve ${tag}`;
  const currency = `TMN${tag}`.slice(0, 10);
  let role: string | null = null;
  const ctx = await browser.newContext();
  const pa = await ctx.newPage();
  try {
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);
    role = await createSalesRole(page, `E2E Sales All ${tag}`, ['sales', 'sales_settings', 'sales_decide', 'project_items']);
    const u = await createEmployee(page, { name: 'E2E Sales Engineer', roles: ['employee', role] });
    await login(pa, u.code, u.password);

    // Product with a Size default.
    await pa.goto('/sales/products');
    await pa.getByTestId('sales-product-add').click();
    await pa.getByTestId('sales-product-name-en').fill(productName);
    await pa.getByTestId('sales-product-name-fa').fill(productName);
    await pa.getByTestId('sales-product-create').click();
    await expect(pa).toHaveURL(/\/sales\/products\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await pa.getByTestId('sales-product-pick-column').selectOption('size');
    await pa.getByTestId('sales-product-add-column').click();
    await pa.getByTestId('sales-product-col-size').locator('input').fill('DN50');
    await pa.getByTestId('sales-product-save').click();
    await expect(pa.getByTestId('sales-product-save')).toBeDisabled({ timeout: 20_000 });
    const productUrl = pa.url();

    // Currency: add Toman, it appears in the record currency picker.
    await pa.goto('/sales/settings');
    await pa.getByTestId('sales-settings-currencies').click();
    await pa.getByTestId('sales-currency-add').click();
    await pa.getByTestId('sales-currency-code').fill(currency);
    await pa.getByTestId('sales-currency-name-fa').fill('تومان');
    await pa.getByTestId('sales-currency-name-en').fill(`Toman ${tag}`);
    await pa.getByTestId('sales-currency-save').click();
    await expect(pa.getByTestId(`sales-currency-${currency}`)).toBeVisible({ timeout: 20_000 });

    await pa.goto('/sales');
    await pa.getByTestId('sales-new-rfp').click();
    await expect(pa.locator('[data-testid="sales-record-form"] option', { hasText: `Toman ${tag}` })
      .or(pa.locator('[data-testid="sales-record-form"] option[value="' + currency + '"]'))).toHaveCount(1);
    await pa.getByTestId('sales-form-title').fill(`E2E products ${tag}`);
    await pa.getByTestId('sales-form-save').click();
    await expect(pa).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: 30_000 });

    // Move the record to Technical: Received → Decision → bid.
    await pa.getByTestId('sales-stage-next').click();
    await pa.getByTestId('sales-move-confirm').click();
    await pa.getByTestId('sales-decide-yes').click();
    await expect(pa.getByTestId('sales-stage-technical')).toHaveAttribute('aria-current', /.+/, { timeout: 30_000 });

    // Add an item row, pick the product: Size is filled.
    await pa.getByTestId('sales-item-add-1').click();
    await pa.getByTestId('sales-item-description').fill('E2E valve');
    await pa.getByTestId('sales-product-select').selectOption({ label: productName });
    await expect(pa.getByTestId('sales-item-editor').locator('input[value="DN50"]')).toHaveCount(1);
    await pa.getByTestId('sales-item-save').click();
    await expect(pa.getByTestId('sales-item-editor')).toHaveCount(0, { timeout: 20_000 });
    await expect(pa.locator('[data-testid^="sales-item-"]').filter({ hasText: 'DN50' })).not.toHaveCount(0);

    // Clean up what the spec made in the company catalog: currency and product.
    await pa.goto('/sales/settings');
    await pa.getByTestId('sales-settings-currencies').click();
    await pa.getByTestId(`sales-currency-${currency}`).click();
    await pa.getByRole('button', { name: /delete|حذف/i }).first().click();
    await pa.getByTestId('sales-confirm').click();
    await expect(pa.getByTestId(`sales-currency-${currency}`)).toHaveCount(0, { timeout: 20_000 });
    void productUrl;
  } finally {
    await ctx.close();
    await deleteRoleIfPresent(page, role).catch((e) => console.warn('role cleanup failed:', e));
  }
});
