import { test, expect } from '@playwright/test';

const ADMIN_CODE = 'admin';
const ADMIN_PASSWORD = 'Admin!2026';

test.describe('Employee CRUD — admin flow', () => {
  test('admin creates employee → appears in list → new employee can log in', async ({ page }) => {
    test.setTimeout(120_000);
    const uniqueCode = `e2e${Date.now()}`;
    const fullName = `Test Worker ${uniqueCode}`;

    // ── 1. Admin logs in ──────────────────────────────────────────────────
    await page.goto('/login');
    await page.fill('#code', ADMIN_CODE);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/home$/);

    // ── 2. Navigate to Manage ─────────────────────────────────────────────
    await page.click('a[href*="/manage/employees"]');
    await expect(page).toHaveURL(/\/manage\/employees$/);

    // ── 3. Open new employee form ─────────────────────────────────────────
    await page.click('a[href*="/manage/employees/new"]');
    await expect(page).toHaveURL(/\/manage\/employees\/new$/);

    // ── 4. Fill the form ──────────────────────────────────────────────────
    await page.fill('#employee_code', uniqueCode);
    await page.fill('#full_name', fullName);
    await page.fill('[data-testid="alloc-days-annual"]', '12');
    await page.fill('[data-testid="alloc-days-sick"]', '3');

    // Select a department by choosing the first non-empty option
    const deptSelect = page.locator('#department_id');
    const deptOptions = await deptSelect.locator('option').all();
    // Pick the first real dept (skip blank placeholder)
    for (const opt of deptOptions) {
      const val = await opt.getAttribute('value');
      if (val && val.trim()) {
        await deptSelect.selectOption({ value: val });
        break;
      }
    }

    // Make sure 'employee' role checkbox is checked
    // Labels are <label> elements wrapping an input + text
    const labels = page.locator('label');
    const count = await labels.count();
    for (let i = 0; i < count; i++) {
      const labelText = await labels.nth(i).textContent();
      if (labelText?.trim() === 'employee') {
        const cb = labels.nth(i).locator('input[type="checkbox"]');
        if (!(await cb.isChecked())) {
          await cb.check();
        }
        break;
      }
    }

    // Submit the form
    await page.click('button[type="submit"]');

    // ── 5. Capture temp password ──────────────────────────────────────────
    // The font-mono element with the temp password appears after success
    const pwEl = page.locator('.font-mono').first();
    await expect(pwEl).toBeVisible({ timeout: 15000 });
    const tempPassword = (await pwEl.textContent()) ?? '';
    expect(tempPassword.trim().length).toBeGreaterThan(6);

    // ── 6. Navigate back to list ─────────────────────────────────────────
    // Click the done link (full page navigation to get fresh server data)
    await page.click('[data-testid="done-link"]');
    await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 10000 });

    // Wait for the table to have the new code (full-page nav ensures fresh data)
    // Use .first() to avoid strict-mode failure when code appears in both code and name columns
    await expect(page.getByText(uniqueCode).first()).toBeVisible({ timeout: 10000 });

    // ── 7. Admin can edit the employee's current balances ────────────────
    const row = page.locator('tr', { hasText: uniqueCode }).first();
    await row.locator('a[href*="/manage/employees/"]').click();
    await expect(page).toHaveURL(/\/manage\/employees\/[^/]+$/);
    await expect(page.locator('[data-testid="balances-section"]')).toBeVisible({ timeout: 10000 });
    await page.fill('[data-testid="balance-days-annual"]', '7');
    await page.click('button[type="submit"]');
    await expect(page.getByRole('status')).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.locator('[data-testid="balance-days-annual"]')).toHaveValue('7');

    // ── 8. Sign out by navigating directly to login ────────────────────
    // There's no /logout route; we go to login directly
    // The existing session will be cleared on next sign-in attempt
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login$/);

    // ── 9. Log in as the new employee ─────────────────────────────────────
    await page.fill('#code', uniqueCode);
    await page.fill('#password', tempPassword.trim());
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/home$/, { timeout: 15000 });
    await expect(page.locator('[data-testid="home-board"]')).toContainText('7');
    await expect(page.locator('[data-testid="home-board"]')).toContainText('3');
  });
});
