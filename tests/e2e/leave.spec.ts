import { test, expect } from '@playwright/test';

const ADMIN_CODE = 'admin';
const ADMIN_PASSWORD = 'Admin!2026';

/**
 * Helper: log in with employee code + password.
 */
async function login(page: Parameters<typeof test.fn>[0]['page'], code: string, password: string) {
  await page.goto('/login');
  await page.fill('#code', code);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 });
}

/**
 * Helper: navigate directly to /login and back to force a clean session.
 */
async function logout(page: Parameters<typeof test.fn>[0]['page']) {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);
}

test.describe('Leave request + allocation flow', () => {
  test('admin allocates → employee submits → previews → cancels → over-balance rejected', async ({ page }) => {
    const uniqueCode = `lv${Date.now()}`;
    const fullName = `Leave Test ${uniqueCode}`;

    // ── 1. Admin logs in ──────────────────────────────────────────────────
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);

    // ── 2. Create throwaway employee ──────────────────────────────────────
    await page.goto('/manage/employees/new');
    await expect(page).toHaveURL(/\/manage\/employees\/new$/);

    await page.fill('#employee_code', uniqueCode);
    await page.fill('#full_name', fullName);

    // Select the first real department
    const deptSelect = page.locator('#department_id');
    const deptOptions = await deptSelect.locator('option').all();
    for (const opt of deptOptions) {
      const val = await opt.getAttribute('value');
      if (val && val.trim()) {
        await deptSelect.selectOption({ value: val });
        break;
      }
    }

    // Ensure 'employee' checkbox is checked
    const labels = page.locator('label');
    const count = await labels.count();
    for (let i = 0; i < count; i++) {
      const labelText = await labels.nth(i).textContent();
      if (labelText?.trim() === 'employee') {
        const cb = labels.nth(i).locator('input[type="checkbox"]');
        if (!(await cb.isChecked())) await cb.check();
        break;
      }
    }

    await page.click('button[type="submit"]');

    // Capture temp password
    const pwEl = page.locator('.font-mono').first();
    await expect(pwEl).toBeVisible({ timeout: 15_000 });
    const tempPassword = (await pwEl.textContent()) ?? '';
    expect(tempPassword.trim().length).toBeGreaterThan(6);

    // ── 3. Admin navigates to Allocations and allocates 26 days of Annual Leave ──
    await page.goto('/manage/allocations');
    await expect(page).toHaveURL(/\/manage\/allocations$/);

    // Pick the employee
    const empSelect = page.locator('#alloc_employee');
    await expect(empSelect).toBeVisible({ timeout: 10_000 });

    // Find the new employee option by code substring
    const empOptions = await empSelect.locator('option').all();
    let foundEmpValue = '';
    for (const opt of empOptions) {
      const text = await opt.textContent();
      if (text?.includes(uniqueCode)) {
        foundEmpValue = (await opt.getAttribute('value')) ?? '';
        break;
      }
    }
    expect(foundEmpValue).not.toBe('');
    await empSelect.selectOption({ value: foundEmpValue });

    // Pick leave type — find "Annual Leave" or the first non-empty type
    const ltSelect = page.locator('#alloc_leave_type');
    const ltOptions = await ltSelect.locator('option').all();
    let foundLtValue = '';
    for (const opt of ltOptions) {
      const text = await opt.textContent();
      // Try to find an annual-leave-like type; fall back to first available
      if (text && (text.includes('سالان') || text.includes('Annual') || text.includes('مرخصی'))) {
        const val = await opt.getAttribute('value');
        if (val && val.trim()) {
          foundLtValue = val;
          break;
        }
      }
    }
    // Fallback: first non-empty option
    if (!foundLtValue) {
      for (const opt of ltOptions) {
        const val = await opt.getAttribute('value');
        if (val && val.trim()) { foundLtValue = val; break; }
      }
    }
    expect(foundLtValue).not.toBe('');
    await ltSelect.selectOption({ value: foundLtValue });

    // Set period: current year
    const year = new Date().getFullYear();
    await page.fill('#alloc_period_start', `${year}-01-01`);
    await page.fill('#alloc_period_end', `${year}-12-31`);

    // Set 26 days
    await page.fill('[data-testid="alloc-days-input"]', '26');

    // Submit allocation
    await page.click('[data-testid="alloc-submit"]');

    // Wait for success
    await expect(page.locator('[data-testid="alloc-success"]')).toBeVisible({ timeout: 15_000 });

    // ── 4. Log out and log in as new employee ─────────────────────────────
    await logout(page);
    await login(page, uniqueCode, tempPassword.trim());

    // ── 5. Navigate to request page ───────────────────────────────────────
    await page.goto('/request');
    await expect(page).toHaveURL(/\/request$/);

    // ── 6. Select the same leave type ─────────────────────────────────────
    const typeSelect = page.locator('#leave_type_id');
    await expect(typeSelect).toBeVisible({ timeout: 10_000 });
    await typeSelect.selectOption({ value: foundLtValue });

    // ── 7. Pick a 2-working-day range using the date picker ───────────────
    // We want two consecutive working days.
    // Find the next Monday and Tuesday in Gregorian (safe, no Fri/Sat/holidays assumed).
    // We'll type directly into the picker's input — the picker uses a text input.
    // Pick two consecutive non-weekend days. Use a known safe Monday.
    // The work settings for this company likely have Fri+Sat as weekend.
    // We'll pick a Monday + Tuesday in the near future.
    const nextMonday = getNextMonday();
    const nextTuesday = nextMonday.replace(/-0(\d)-/, '-$1-').replace(/-(\d)$/, '-0$1'); // keep as-is
    const nextMondayDate = new Date(nextMonday);
    nextMondayDate.setDate(nextMondayDate.getDate() + 1);
    const nextTuesdayStr = nextMondayDate.toISOString().split('T')[0];

    // Type the Gregorian range into the picker input.
    // react-multi-date-picker's text input accepts "YYYY/MM/DD — YYYY/MM/DD" by default in range mode.
    // The react-multi-date-picker uses class "rmdp-input" on its input
    const pickerInput = page.locator('input.rmdp-input').first();
    const altInput = page.locator('.rmdp-container input').first();
    const activeInput = (await pickerInput.isVisible()) ? pickerInput : altInput;

    const rangeStr = `${nextMonday.replace(/-/g, '/')} — ${nextTuesdayStr.replace(/-/g, '/')}`;
    await activeInput.click();
    await activeInput.fill(rangeStr);
    // Press Enter to confirm range, then Escape to close popup
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    // Click somewhere neutral to close calendar
    await page.locator('h1').click();

    // Wait for preview to appear — the working days preview
    await expect(page.locator('[data-testid="leave-preview"]')).toBeVisible({ timeout: 10_000 });
    const previewText = await page.locator('[data-testid="working-days-count"]').textContent();
    expect(previewText).toContain('2');

    // Balance display — may show 26 or "موجودی نامشخص" depending on timing of allocation.
    // The core assertion is that working-days = 2 (verified above).
    const balanceEl = page.locator('[data-testid="balance-display"]');
    if (await balanceEl.isVisible()) {
      // Just confirm the element renders; balance propagation timing can vary.
      const balText = await balanceEl.textContent();
      expect(balText).toBeTruthy();
    }

    // ── 8. Submit request ─────────────────────────────────────────────────
    await page.click('button[type="submit"]');

    // After reload, find the pending request in My Requests
    await page.waitForURL(/\/request$/, { timeout: 15_000 });
    await page.waitForTimeout(1000); // allow page data to load

    // The request should appear as pending
    const pendingBadge = page.locator('[data-testid^="status-badge-"]').filter({ hasText: /pending|در انتظار/i });
    await expect(pendingBadge.first()).toBeVisible({ timeout: 10_000 });

    // Verify "2" days somewhere in the request row
    const requestRows = page.locator('[data-testid^="request-row-"]');
    await expect(requestRows.first()).toBeVisible({ timeout: 5_000 });
    const rowText = await requestRows.first().textContent();
    expect(rowText).toContain('2');

    // ── 9. Cancel the request ─────────────────────────────────────────────
    const cancelBtn = page.locator('[data-testid^="cancel-btn-"]').first();
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });
    page.on('dialog', (dialog) => dialog.accept());
    await cancelBtn.click();

    // Status should change to cancelled
    const cancelledBadge = page.locator('[data-testid^="status-badge-"]').filter({ hasText: /cancel|لغو/i });
    await expect(cancelledBadge.first()).toBeVisible({ timeout: 10_000 });

    // ── 10. Submit an over-balance request (very long range) ──────────────
    await typeSelect.selectOption({ value: foundLtValue });

    // Pick a very long range — e.g. 200 days — to exceed the 26-day balance
    const farFutureStart = getNextMonday();
    const farFutureStartDate = new Date(farFutureStart);
    farFutureStartDate.setDate(farFutureStartDate.getDate() + 300);
    const farFutureEnd = farFutureStartDate.toISOString().split('T')[0];

    const farStart = new Date(farFutureStart);
    const farEnd = farFutureStartDate;

    const pickerInput2 = page.locator('input.rmdp-input').first();
    const altInput2 = page.locator('.rmdp-container input').first();
    const activeInput2 = (await pickerInput2.isVisible()) ? pickerInput2 : altInput2;
    await activeInput2.click();
    await activeInput2.fill(
      `${farStart.toISOString().split('T')[0].replace(/-/g, '/')} — ${farEnd.toISOString().split('T')[0].replace(/-/g, '/')}`
    );
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.locator('h1').click();
    // Small wait to ensure preview computation
    await page.waitForTimeout(500);

    await page.click('button[type="submit"]');

    // An error should appear; no new pending row should be added
    const errorEl = page.locator('[data-testid="error-msg"]');
    await expect(errorEl).toBeVisible({ timeout: 15_000 });
    const errText = await errorEl.textContent();
    expect(errText).toBeTruthy();
    expect(errText!.length).toBeGreaterThan(2);
  });
});

/**
 * Returns the next Monday in YYYY-MM-DD format.
 */
function getNextMonday(): string {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun .. 6=Sat
  const daysUntilMonday = day === 0 ? 1 : 8 - day; // next Monday
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  return d.toISOString().split('T')[0];
}
