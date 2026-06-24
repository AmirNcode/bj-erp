import { expect, type Page } from '@playwright/test';

export const ADMIN_CODE = 'admin';
export const ADMIN_PASSWORD = 'Admin!2026';

// Jalali 1405/04/08–09 = Gregorian 2026-06-29 (Mon) + 2026-06-30 (Tue): 2 working
// days under a Fri(+Sat) weekend, and within June 2026 (the current month) so the
// resulting request shows on the current-month calendar.
export const JALALI_2DAY = '1405/04/08 — 1405/04/09';

export async function login(page: Page, code: string, password: string) {
  await page.goto('/login');
  await page.fill('#code', code);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 });
}

export async function logout(page: Page) {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);
}

/** Create an employee via the admin console; returns the temp password. */
export async function createEmployee(
  page: Page,
  opts: { code: string; name: string; roles: string[] }
): Promise<string> {
  await page.goto('/manage/employees/new');
  await expect(page).toHaveURL(/\/manage\/employees\/new$/);

  await page.fill('#employee_code', opts.code);
  await page.fill('#full_name', opts.name);

  const deptSelect = page.locator('#department_id');
  for (const opt of await deptSelect.locator('option').all()) {
    const val = await opt.getAttribute('value');
    if (val && val.trim()) {
      await deptSelect.selectOption({ value: val });
      break;
    }
  }

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

/**
 * Fill the react-multi-date-picker range input. The form overrides `inputClass`,
 * dropping the default `rmdp-input` class, so fall back to `.rmdp-container input`.
 */
export async function fillPicker(page: Page, value: string) {
  const primary = page.locator('input.rmdp-input').first();
  const fallback = page.locator('.rmdp-container input').first();
  const input = (await primary.isVisible().catch(() => false)) ? primary : fallback;
  await input.click();
  await input.fill(value);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('h1').click();
}

/** Allocate `days` of the first balance-affecting leave type to an employee. Returns the type value. */
export async function allocate(page: Page, employeeCodeSubstring: string, days: number): Promise<string> {
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

/** Submit a fresh 2-working-day request for the given leave type, optionally with a reason. */
export async function submitLeave(page: Page, opts: { leaveTypeValue: string; reason?: string }) {
  await page.goto('/request');
  await expect(page).toHaveURL(/\/request$/);
  await page.locator('#leave_type_id').selectOption({ value: opts.leaveTypeValue });
  await fillPicker(page, JALALI_2DAY);
  await expect(page.locator('[data-testid="leave-preview"]')).toBeVisible({ timeout: 10_000 });
  if (opts.reason) await page.fill('#reason', opts.reason);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500); // server action + revalidate
}
