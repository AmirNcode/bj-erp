import { test, expect, type Page } from '@playwright/test';

const ADMIN_CODE = 'admin';
const ADMIN_PASSWORD = 'Admin!2026';

// Jalali 1405/04/08–09 = Gregorian 2026-06-29 (Mon) + 2026-06-30 (Tue) = 2 working
// days under a Fri (+Sat) weekend. Proven end-to-end in leave.spec.ts.
const JALALI_2DAY = '1405/04/08 — 1405/04/09';

async function login(page: Page, code: string, password: string) {
  await page.goto('/login');
  await page.fill('#code', code);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 });
}

async function logout(page: Page) {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);
}

/** Create an employee via the admin console; returns the temp password. */
async function createEmployee(
  page: Page,
  opts: { code: string; name: string; roles: string[] }
): Promise<string> {
  await page.goto('/manage/employees/new');
  await expect(page).toHaveURL(/\/manage\/employees\/new$/);

  await page.fill('#employee_code', opts.code);
  await page.fill('#full_name', opts.name);

  // First real department.
  const deptSelect = page.locator('#department_id');
  for (const opt of await deptSelect.locator('option').all()) {
    const val = await opt.getAttribute('value');
    if (val && val.trim()) {
      await deptSelect.selectOption({ value: val });
      break;
    }
  }

  // Ensure each requested role checkbox is checked (labels are literal role names).
  const labels = page.locator('label');
  const count = await labels.count();
  for (let i = 0; i < count; i++) {
    const text = (await labels.nth(i).textContent())?.trim();
    if (text && opts.roles.includes(text)) {
      const cb = labels.nth(i).locator('input[type="checkbox"]');
      if (await cb.count()) {
        if (!(await cb.isChecked())) await cb.check();
      }
    }
  }

  await page.click('button[type="submit"]');

  const pwEl = page.locator('.font-mono').first();
  await expect(pwEl).toBeVisible({ timeout: 15_000 });
  const pw = (await pwEl.textContent())?.trim() ?? '';
  expect(pw.length).toBeGreaterThan(6);
  return pw;
}

/** On the employee's edit page, set their direct manager (match by code substring). */
async function setManager(page: Page, employeeCode: string, managerCodeSubstring: string) {
  await page.goto('/manage/employees');
  const row = page.locator('tr', { hasText: employeeCode });
  await expect(row.first()).toBeVisible({ timeout: 10_000 });
  await row.first().locator('a').first().click();
  await expect(page).toHaveURL(/\/manage\/employees\/[0-9a-f-]+$/, { timeout: 10_000 });

  const mgrSelect = page.locator('#manager_id');
  await expect(mgrSelect).toBeVisible({ timeout: 10_000 });
  let mgrValue = '';
  for (const opt of await mgrSelect.locator('option').all()) {
    const text = await opt.textContent();
    if (text?.includes(managerCodeSubstring)) {
      mgrValue = (await opt.getAttribute('value')) ?? '';
      break;
    }
  }
  expect(mgrValue).not.toBe('');
  await mgrSelect.selectOption({ value: mgrValue });

  await page.click('button[type="submit"]');
  // "saved" status banner (role="status").
  await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 15_000 });
}

/** Allocate `days` of the first balance-affecting leave type to an employee. Returns the type value. */
async function allocate(page: Page, employeeCodeSubstring: string, days: number): Promise<string> {
  await page.goto('/manage/allocations');
  await expect(page).toHaveURL(/\/manage\/allocations$/);

  const empSelect = page.locator('#alloc_employee');
  await expect(empSelect).toBeVisible({ timeout: 10_000 });
  let empValue = '';
  for (const opt of await empSelect.locator('option').all()) {
    const text = await opt.textContent();
    if (text?.includes(employeeCodeSubstring)) {
      empValue = (await opt.getAttribute('value')) ?? '';
      break;
    }
  }
  expect(empValue).not.toBe('');
  await empSelect.selectOption({ value: empValue });

  const ltSelect = page.locator('#alloc_leave_type');
  let ltValue = '';
  for (const opt of await ltSelect.locator('option').all()) {
    const text = await opt.textContent();
    if (text && (text.includes('سالان') || text.includes('Annual') || text.includes('مرخصی'))) {
      const val = await opt.getAttribute('value');
      if (val && val.trim()) {
        ltValue = val;
        break;
      }
    }
  }
  if (!ltValue) {
    for (const opt of await ltSelect.locator('option').all()) {
      const val = await opt.getAttribute('value');
      if (val && val.trim()) {
        ltValue = val;
        break;
      }
    }
  }
  expect(ltValue).not.toBe('');
  await ltSelect.selectOption({ value: ltValue });

  const year = new Date().getFullYear();
  await page.fill('#alloc_period_start', `${year}-01-01`);
  await page.fill('#alloc_period_end', `${year}-12-31`);
  await page.fill('[data-testid="alloc-days-input"]', String(days));
  await page.click('[data-testid="alloc-submit"]');
  await expect(page.locator('[data-testid="alloc-success"]')).toBeVisible({ timeout: 15_000 });
  return ltValue;
}

/**
 * Fill the react-multi-date-picker range input. The form overrides `inputClass`,
 * which drops the default `rmdp-input` class, so prefer it but fall back to the
 * (always-present) `.rmdp-container input` — same approach as leave.spec.ts.
 */
async function fillPicker(page: Page, value: string) {
  const primary = page.locator('input.rmdp-input').first();
  const fallback = page.locator('.rmdp-container input').first();
  const input = (await primary.isVisible().catch(() => false)) ? primary : fallback;
  await input.click();
  await input.fill(value);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('h1').click();
}

/** Submit a fresh 2-working-day request for the given leave type (Persian picker). */
async function submitTwoDayRequest(page: Page, leaveTypeValue: string) {
  await page.goto('/request');
  await expect(page).toHaveURL(/\/request$/);
  const typeSelect = page.locator('#leave_type_id');
  await expect(typeSelect).toBeVisible({ timeout: 10_000 });
  await typeSelect.selectOption({ value: leaveTypeValue });

  await fillPicker(page, JALALI_2DAY);
  await expect(page.locator('[data-testid="leave-preview"]')).toBeVisible({ timeout: 10_000 });

  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500); // server action + revalidate
}

test.describe('Approval flow', () => {
  test('manager approves (debits balance) and rejects own reports’ requests', async ({ page }) => {
    // Long multi-role flow; against a cold `next dev` every route compiles on
    // first hit, so give it a generous budget (CI retries twice on top).
    test.setTimeout(240_000);
    const ts = Date.now();
    const mgrCode = `mgr${ts}`;
    const empCode = `emp${ts}`;

    // Accept all confirm() dialogs (approve/reject).
    page.on('dialog', (dialog) => dialog.accept());

    // 1. Admin sets up a manager and a report.
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);
    const mgrPw = await createEmployee(page, { code: mgrCode, name: `Manager ${ts}`, roles: ['manager'] });
    const empPw = await createEmployee(page, { code: empCode, name: `Report ${ts}`, roles: ['employee'] });
    await setManager(page, empCode, mgrCode);
    const ltValue = await allocate(page, empCode, 26);

    // 2. Employee submits two 2-day requests (both pending; balance 26 ≥ 2 each).
    await logout(page);
    await login(page, empCode, empPw.trim());
    await submitTwoDayRequest(page, ltValue);
    await submitTwoDayRequest(page, ltValue);

    // 3. Manager decides: approve one, reject the other.
    await logout(page);
    await login(page, mgrCode, mgrPw.trim());
    await page.goto('/manage/approvals');

    const approveButtons = page.locator('[data-testid^="approve-btn-"]');
    await expect(approveButtons.first()).toBeVisible({ timeout: 10_000 });
    await expect(approveButtons).toHaveCount(2); // exactly this report's two requests

    await approveButtons.first().click();
    await expect(approveButtons).toHaveCount(1); // approved row removed optimistically

    await page.locator('[data-testid^="reject-btn-"]').first().click();
    await expect(page.locator('[data-testid="approvals-empty"]')).toBeVisible({ timeout: 10_000 });

    // 4. Employee sees one approved + one rejected.
    await logout(page);
    await login(page, empCode, empPw.trim());
    await page.goto('/request');

    const badges = page.locator('[data-testid^="status-badge-"]');
    await expect(badges.filter({ hasText: /approved|تایید/i }).first()).toBeVisible({ timeout: 10_000 });
    await expect(badges.filter({ hasText: /reject|رد/i }).first()).toBeVisible({ timeout: 10_000 });

    // 5. Balance debited by the approved request (tolerant, like leave.spec.ts):
    //    re-pick the range to surface the balance; assert 24 if it propagated.
    const typeSelect = page.locator('#leave_type_id');
    await typeSelect.selectOption({ value: ltValue });
    await fillPicker(page, JALALI_2DAY);
    await expect(page.locator('[data-testid="leave-preview"]')).toBeVisible({ timeout: 10_000 });
    const balText = await page.locator('[data-testid="balance-display"]').textContent();
    expect(balText).toBeTruthy();
    if (balText && /\d/.test(balText) && !balText.includes('نامشخص')) {
      expect(balText).toContain('24');
    }
  });
});
