import { expect, type Page } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DateObject = require('react-date-object').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const persian = require('react-date-object/calendars/persian');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const persian_en = require('react-date-object/locales/persian_en');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gregorian = require('react-date-object/calendars/gregorian');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gregorian_en = require('react-date-object/locales/gregorian_en');

export const ADMIN_CODE = 'admin';
export const ADMIN_PASSWORD = 'Admin!2026';

const SEEDED_WEEKEND_ISO = [5]; // Friday = ISO 5
// Keep dynamic 2-day request ranges stable even while admin-settings.spec
// mutates shared weekend settings in the demo company.
const RANGE_HELPER_SKIP_ISO = [4, 5, 6]; // Thursday + Friday + Saturday

function getISOWeekday(d: Date): number {
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  return dow === 0 ? 7 : dow; // ISO Mon=1…Sun=7
}

function isWorkingDay(d: Date, weekendDays = SEEDED_WEEKEND_ISO): boolean {
  return !weekendDays.includes(getISOWeekday(d));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function toGregorianParts(d: Date): [number, number, number] {
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

function toJalaliStr(d: Date): string {
  const [y, m, day] = toGregorianParts(d);
  const obj = new DateObject({ calendar: gregorian, locale: gregorian_en, year: y, month: m, day });
  return obj.convert(persian, persian_en).format('YYYY/MM/DD');
}

function todayUTC(): Date {
  return new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ));
}

/**
 * Returns a Jalali picker string 'YYYY/MM/DD — YYYY/MM/DD' for the next
 * strictly-future 2-working-day window:
 *
 *   1. start_date > today  (strictly future — required by cancel-approved.spec,
 *      whose isCancellable guard needs an approved leave that hasn't started yet)
 *   2. exactly 2 working days under the seeded Fri weekend (ISO 5)
 *
 * Algorithm: walk forward from tomorrow, skip Fridays (ISO 5), pick the first
 * two consecutive working days. No month restriction — the range may spill
 * into the next Gregorian month (e.g. when run on a month-end day). That's
 * fine for leave/approval/cancel-approved, which only care about the leave
 * being in the future, not which calendar month it falls in.
 *
 * If you need the entry to show up on the *current month's* team calendar
 * (calendar.spec), use jalaliCurrentMonthRange() instead.
 */
export function jalali2DayRange(): string {
  const today = todayUTC();

  // Walk forward from tomorrow to find two adjacent calendar days that remain
  // working under both the seeded settings and the parallel admin-settings
  // mutation. Using adjacent days avoids counting any skipped day between them.
  let start = addDays(today, 1);
  let end = addDays(start, 1);
  while (
    !isWorkingDay(start, RANGE_HELPER_SKIP_ISO) ||
    !isWorkingDay(end, RANGE_HELPER_SKIP_ISO)
  ) {
    start = addDays(start, 1);
    end = addDays(start, 1);
  }

  return `${toJalaliStr(start)} — ${toJalaliStr(end)}`;
}

/**
 * Returns a Jalali picker string 'YYYY/MM/DD — YYYY/MM/DD' starting **today**
 * and ending tomorrow (calendar days, not working days — submit_leave_request
 * accepts any date, including today and weekends). Used where the entry must
 * overlap the *current* Gregorian month on the team calendar (calendar.spec),
 * which always holds since the range starts today.
 */
export function jalaliCurrentMonthRange(): string {
  const today = todayUTC();
  const end = addDays(today, 1);
  return `${toJalaliStr(today)} — ${toJalaliStr(end)}`;
}

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
export async function submitLeave(
  page: Page,
  opts: { leaveTypeValue: string; reason?: string; range?: string }
) {
  await page.goto('/request');
  await expect(page).toHaveURL(/\/request$/);
  await page.locator('#leave_type_id').selectOption({ value: opts.leaveTypeValue });
  await fillPicker(page, opts.range ?? jalali2DayRange());
  await expect(page.locator('[data-testid="leave-preview"]')).toBeVisible({ timeout: 10_000 });
  if (opts.reason) await page.fill('#reason', opts.reason);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500); // server action + revalidate
}
