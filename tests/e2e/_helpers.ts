import { expect, type Locator, type Page } from '@playwright/test';

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
export const SEEDED_MANAGER_CODE = '1001';
export const SEEDED_EMPLOYEE_CODE = '2001';
export const SEEDED_SECURITY_CODE = '1004';
export const SEEDED_PASSWORD = 'Demo!2026';

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

export function jalaliRangeFromGregorian(start: Date, end: Date): string {
  return `${toJalaliStr(start)} — ${toJalaliStr(end)}`;
}

/**
 * "Today" as the app defines it: the current date in Asia/Tehran
 * (lib/appDate.ts + the SQL company-tz helpers). Using the UTC date here
 * breaks every night 20:30–24:00 UTC, when Tehran has already rolled to the
 * next day and "tomorrow (UTC)" is no longer strictly future for the
 * cancel-approved guard.
 */
function todayUTC(): Date {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' })
    .format(new Date())
    .split('-')
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d));
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
export function jalali2DayRange(offsetDays = 0): string {
  const today = todayUTC();

  // Walk forward from tomorrow to find two adjacent calendar days that remain
  // working under both the seeded settings and the parallel admin-settings
  // mutation. Using adjacent days avoids counting any skipped day between them.
  // `offsetDays` shifts the walk start — submit_leave_request rejects ranges
  // overlapping the caller's own pending/approved requests, so a second
  // request for the same employee must use a later window.
  let start = addDays(today, 1 + offsetDays);
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
 * and ending today+3. Used where the entry must overlap the *current* month
 * on the team calendar (calendar.spec), which always holds since the range
 * starts today.
 *
 * Why 4 calendar days: since the 2026-07-02 hardening, submit_leave_request
 * rejects ranges with ZERO working days. The shared demo weekend can be left
 * mutated by admin-settings.spec (Thu/Fri or Fri/Sat instead of the seeded
 * Fri-only), so any shorter window can land entirely on a weekend (e.g. a
 * Friday run with a Fri+Sat weekend). Four consecutive days always include
 * at least one day outside {Thu, Fri, Sat}.
 */
export function jalaliCurrentMonthRange(): string {
  const today = todayUTC();
  const end = addDays(today, 3);
  return `${toJalaliStr(today)} — ${toJalaliStr(end)}`;
}

export async function login(page: Page, code: string, password: string) {
  await page.goto('/login');
  // Fill-and-verify, then click-and-verify, all inside one retry loop: on a
  // cold `next dev` the first fill can land before React hydrates (hydration
  // resets the controlled inputs) and the first submit click can hit a
  // not-yet-hydrated button (the form never submits). Retrying the whole
  // cycle covers both races.
  await expect(async () => {
    if (/\/home$/.test(page.url())) return; // already navigated on a prior pass
    await page.fill('#code', code);
    await page.fill('#password', password);
    await expect(page.locator('#code')).toHaveValue(code, { timeout: 1_000 });
    await expect(page.locator('#password')).toHaveValue(password, { timeout: 1_000 });
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/home$/, { timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
}

export async function logout(page: Page) {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);
}

/**
 * Test personnel numbers are 999####### (10 digits) — the pattern
 * app_cleanup_e2e_users() reserves for throwaway accounts. Since
 * 20260730130002 the login code IS the personnel number, so the resulting
 * codes look like 9991234567 (they used to be prod-9991234567; the cleanup
 * function reaps both shapes).
 */
let pnoCounter = Date.now() % 10_000_000;
export function nextTestPersonnelNo(): string {
  pnoCounter = (pnoCounter + 1) % 10_000_000;
  return `999${String(pnoCounter).padStart(7, '0')}`;
}

/**
 * Test department codes are zz#### — the `zz` prefix is reserved for throwaway
 * departments and is deleted after the run by scripts/cleanup-e2e.mjs.
 *
 * Admins no longer type a code (spec 2026-07-30 §6.1): `createDepartment`
 * derives it from the first 4 latin characters of the English name. So this
 * value is used as the START of the English name a test types, which keeps the
 * generated code `zz`-prefixed and therefore still reapable.
 */
export function nextTestDepartmentCode(): string {
  return `zz${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}

/**
 * Create an employee via the admin console. The login code is generated by
 * the app (the personnel number, since 20260730130002) and read from the
 * preview. Returns the generated code and the temp password.
 */
/**
 * `departmentIndex` selects among the non-blank department options, 0 being the
 * first — which is what every caller got implicitly before this existed, so the
 * default preserves their behaviour exactly.
 *
 * It matters for any test about company-wide visibility. `profiles_select`
 * grants a read via `same_team` OR `can_read_all`, so two throwaway users in the
 * same department can see each other for the *wrong* reason, and a test meaning
 * to prove broad access silently proves nothing. Put them in different
 * departments and only the broad-access path can be responsible.
 */
export async function createEmployee(
  page: Page,
  opts: { name: string; roles: string[]; personnelNo?: string; departmentIndex?: number }
): Promise<{ code: string; password: string }> {
  await page.goto('/manage/employees/new');
  await expect(page).toHaveURL(/\/manage\/employees\/new$/);

  await page.fill('#personnel_no', opts.personnelNo ?? nextTestPersonnelNo());
  await page.fill('#full_name', opts.name);

  const deptSelect = page.locator('#department_id');
  const deptValues: string[] = [];
  for (const opt of await deptSelect.locator('option').all()) {
    const val = await opt.getAttribute('value');
    if (val && val.trim()) deptValues.push(val);
  }
  const wanted = opts.departmentIndex ?? 0;
  if (deptValues.length <= wanted) {
    throw new Error(
      `createEmployee: departmentIndex ${wanted} requested but only ${deptValues.length} department(s) exist`
    );
  }
  await deptSelect.selectOption({ value: deptValues[wanted] });

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

  const code = (await page.locator('[data-testid="code-preview"]').textContent())?.trim() ?? '';
  expect(code).toMatch(/^999[0-9]{7}$/);

  const pwEl = page.locator('[data-testid="temp-password"]');
  const formError = page.locator('form [role="alert"]');

  // Retry the whole submit-and-assert cycle, exactly as `login` does.
  //
  // On a busy suite the first click can land before React has hydrated the form,
  // and a swallowed click produces NEITHER the success screen nor an error — the
  // page just sits there. This is the same cold-dev hydration race documented in
  // docs/MEMORY.md; `createEmployee` was simply missing the retry that `login`
  // already had, and it flaked three times before the diagnostics below made the
  // cause visible ("neither the temp password nor an error appeared").
  //
  // Re-clicking cannot double-create: each attempt returns early if the success
  // screen is already up, and the personnel number is fixed outside this loop, so
  // a genuine second submit would be refused as a duplicate rather than creating
  // a second employee.
  await expect(async () => {
    if (await pwEl.isVisible()) return;
    if (await formError.isVisible()) {
      throw new Error(`createEmployee failed: ${(await formError.textContent())?.trim()}`);
    }
    await page.click('button[type="submit"]');
    // Generous inner wait: a slow-but-working submit must not be re-clicked. The
    // outer toPass is for a click that was genuinely swallowed before hydration,
    // not for impatience.
    await expect(pwEl).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 60_000 });
  const password = (await pwEl.textContent())?.trim() ?? '';
  expect(password.length).toBeGreaterThan(6);
  return { code, password };
}

/** Fill a single react-multi-date-picker input (hourly leave or errand). */
export async function fillPicker(page: Page, value: string, selector?: string) {
  const scope = selector ? page.locator(selector) : page;
  const primary = scope.locator('input.rmdp-input').first();
  const fallback = scope.locator('.rmdp-container input').first();
  const input = (await primary.isVisible().catch(() => false)) ? primary : fallback;
  await input.click();
  await input.fill(value);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('h1').click();
}

/** Fill the daily form's separate start and end Persian-calendar inputs. */
export async function fillDailyDateRange(page: Page, value: string) {
  const [start, end] = value.split(/\s+—\s+/);
  expect(start).toBeTruthy();
  expect(end).toBeTruthy();

  for (const [testId, date] of [
    ['daily-start-date', start],
    ['daily-end-date', end],
  ] as const) {
    const input = page.locator(`[data-testid="${testId}"] input`);
    await input.click();
    await input.fill(date);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.locator('h1').click();
  }
}

/** Fill the daily work errand form's separate Persian start/end inputs. */
export async function fillDailyErrandDateRange(page: Page, value: string) {
  const [start, end] = value.split(/\s+—\s+/);
  expect(start).toBeTruthy();
  expect(end).toBeTruthy();

  for (const [testId, date] of [
    ['daily-errand-start-date', start],
    ['daily-errand-end-date', end],
  ] as const) {
    const input = page.locator(`[data-testid="${testId}"] input`);
    await input.click();
    await input.fill(date);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.locator('h1').click();
  }
}

/** Draw enough pointer movement to produce a PNG and authorize its use. */
export async function signRequest(
  page: Page,
  prefix: 'daily' | 'hourly' | 'errand' | 'daily-errand'
) {
  await drawAndAuthorizeSignature(page, `[data-testid="${prefix}-signature-canvas"]`, prefix);
}

/** Sign the currently-open approval dialog on the queue or calendar surface. */
export async function signApproval(page: Page, surface: 'queue' | 'calendar' = 'queue') {
  const prefix = surface === 'calendar' ? 'cal-approval-' : 'approval-';
  await drawAndAuthorizeSignature(
    page,
    `[data-testid^="${prefix}"][data-testid$="-signature-canvas"]`,
    prefix
  );
}

async function drawAndAuthorizeSignature(page: Page, canvasSelector: string, prefix: string) {
  const canvas = page.locator(canvasSelector).first();
  await expect(canvas).toBeVisible();
  // The signature sits below the fold on desktop. Mouse coordinates outside
  // the viewport do not dispatch pointer events to the canvas.
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.35, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.65, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 5 });
  await page.mouse.up();

  await expect(
    page.locator(`[data-testid^="${prefix}"][data-testid$="-signature-clear"]`).first()
  ).toBeEnabled();
  await page
    .locator(`[data-testid^="${prefix}"][data-testid$="-signature-authorized"]`)
    .first()
    .check();
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
  const [periodStart, periodEnd] = jalaliRangeFromGregorian(
    new Date(Date.UTC(year, 0, 1)),
    new Date(Date.UTC(year, 11, 31))
  ).split(/\s+—\s+/);
  await fillPicker(page, periodStart, '[data-testid="allocation-start-date-picker"]');
  await fillPicker(page, periodEnd, '[data-testid="allocation-end-date-picker"]');
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
  await fillDailyDateRange(page, opts.range ?? jalali2DayRange());
  await expect(page.locator('[data-testid="leave-preview"]')).toBeVisible({ timeout: 10_000 });
  if (opts.reason) await page.fill('#reason', opts.reason);
  await signRequest(page, 'daily');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500); // server action + revalidate
}

/**
 * Approve one request through EVERY step it still needs, as whoever is logged in.
 *
 * FR-36 made approval a chain: a manager's signature alone no longer approves
 * anything, so a test that signs once and then asserts a debited balance is
 * asserting the old contract. An admin may fill any step, so calling this while
 * signed in as the admin completes the whole chain; calling it as a manager
 * fills their step and stops.
 *
 * Re-navigates each pass because the queue removes a decided row optimistically —
 * the button for the NEXT step only appears after a real server round-trip.
 */
export async function approveThroughChain(page: Page, requestId: string, maxSteps = 4) {
  for (let i = 0; i < maxSteps; i++) {
    await page.goto('/manage/approvals');
    const btn = page.locator(`[data-testid="approve-btn-${requestId}"]`);
    // Wait for the queue to actually RENDER before counting. It streams inside a
    // Suspense boundary, and `networkidle` resolves before the streamed content
    // arrives — counting then returns 0, so the helper would report success
    // having signed only the first step, leaving the balance untouched. That
    // exact bug cost two spec failures; do not replace this with networkidle.
    await expect(
      page.locator('[data-testid="approvals-empty"], [data-testid^="approve-btn-"]').first()
    ).toBeVisible({ timeout: 20_000 });
    if ((await btn.count()) === 0) return i; // nothing left this caller can sign
    await btn.click();
    const confirm = page.locator(`[data-testid="approve-confirm-${requestId}"]`);
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await signApproval(page);
    await confirm.click();
    await expect(btn).toHaveCount(0, { timeout: 20_000 });
  }
  return maxSteps;
}

/** The request id behind an approvals-queue row, from its testid. */
export async function requestIdFromQueueRow(row: Locator): Promise<string> {
  const testId = await row.getAttribute('data-testid');
  if (!testId) throw new Error('queue row has no data-testid');
  return testId.replace('approval-row-', '');
}
