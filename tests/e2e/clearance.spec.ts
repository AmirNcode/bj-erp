/**
 * FR-54 — clearance form (فرم تسویه حساب).
 *
 * hr files a form for a throwaway leaver with an IT row; hr signs the HR row, the
 * IT person signs theirs, finance signs last, and the printed sheet shows it all.
 * A second form with yesterday as the last working day switches the account off
 * at once. The database rules are covered row by row in tests/sql/fr54-clearance.sql;
 * this proves the screens drive them.
 *
 * Touches only its own `999…` users (reaped by scripts/cleanup-e2e.mjs; their
 * forms cascade away with them). Never edits the default rows. Runs on /en/.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  createEmployee,
  fillPicker,
  jalaliRangeFromGregorian,
  login,
  logout,
} from './_helpers';

/** A Jalali picker string for Tehran-today + `offset` days. */
function jalaliDay(offset: number): string {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' })
    .format(new Date())
    .split('-')
    .map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + offset));
  return jalaliRangeFromGregorian(day, day).split(' — ')[0];
}

/** Type into a person search box and click the suggestion carrying `code`. */
async function pickPerson(page: Page, testId: string, code: string) {
  await page.fill(`[data-testid="${testId}"]`, code);
  const option = page.locator(`[data-testid="${testId}-option"]`, { hasText: code });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(page.locator(`[data-testid="${testId}"]`)).toHaveValue(new RegExp(code));
}

async function fileForm(page: Page, leaverCode: string, lastDay: string, signerCode: string | null) {
  // Admin and hr reach clearance forms from Manage › Employees.
  await page.goto('/en/manage/employees');
  await page.click('[data-testid="clearance-link"]');
  await expect(page).toHaveURL(/\/clearance$/);
  await page.click('[data-testid="clearance-new"]');
  await expect(page).toHaveURL(/\/clearance\/new$/);
  await page.waitForLoadState('networkidle');
  // One character is not enough to search.
  await page.fill('[data-testid="clearance-employee"]', '9');
  await expect(page.locator('[data-testid="clearance-employee-results"]')).toHaveCount(0);
  await pickPerson(page, 'clearance-employee', leaverCode);
  // A new account has no personal info, so the father's name is typed here.
  await expect(page.locator('[data-testid="clearance-father"]')).toBeEditable({ timeout: 20_000 });
  await page.fill('[data-testid="clearance-father"]', 'Karim');
  await page.fill('[data-testid="clearance-cert"]', '4321');

  // Keep only the locked HR row, then add one IT row (or none).
  const removes = page.locator('[data-testid^="clearance-row-remove-"]');
  while ((await removes.count()) > 0) await removes.first().click();
  await expect(page.locator('[data-testid="clearance-row-0"][data-hr="true"]')).toBeVisible();
  if (signerCode) {
    await page.click('[data-testid="clearance-row-add"]');
    await page.fill('[data-testid="clearance-row-name-fa-1"]', 'فناوری اطلاعات');
    await page.fill('[data-testid="clearance-row-name-en-1"]', 'IT');
    await pickPerson(page, 'clearance-row-signer-1', signerCode);
  }

  await page.check('[data-testid="clearance-reason-resignation"]');
  await fillPicker(page, lastDay, '[data-testid="clearance-last-day"]');
  await page.click('[data-testid="clearance-submit"]');
  await expect(page).toHaveURL(/\/clearance\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.locator('[data-testid="clearance-detail"]')).toBeVisible();
}

/** Open the sign dialog of `scope`, draw, consent, confirm. */
async function sign(page: Page, scope: string) {
  await page.locator(`${scope} [data-testid$="-open"]`).first().click();
  const canvas = page.locator('[role="alertdialog"] [data-testid$="-signature-canvas"]');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('signature canvas has no box');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await page.locator('[role="alertdialog"] [data-testid$="-note"]').fill('Returned laptop');
  await page.locator('[role="alertdialog"] [data-testid$="-signature-authorized"]').check();
  await page.locator('[role="alertdialog"] [data-testid$="-confirm"]').click();
  await expect(page.locator('[role="alertdialog"]')).toBeHidden({ timeout: 30_000 });
}

test('hr files a clearance form; units and finance sign; a past last day deactivates', async ({ page }) => {
  test.setTimeout(420_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const hr = await createEmployee(page, { name: 'FR54 HR', roles: ['hr'] });
  const fin = await createEmployee(page, { name: 'FR54 Finance', roles: ['finance'] });
  const it = await createEmployee(page, { name: 'FR54 IT', roles: ['employee'] });
  const leaverA = await createEmployee(page, { name: 'FR54 Leaver A', roles: ['employee'] });
  const leaverB = await createEmployee(page, { name: 'FR54 Leaver B', roles: ['employee'] });
  await logout(page);

  // ── 1. a future last day: everyone signs ─────────────────────────────────
  await login(page, hr.code, hr.password);
  await fileForm(page, leaverA.code, jalaliDay(30), it.code);
  const formUrl = new URL(page.url()).pathname;
  const formId = formUrl.split('/').pop() as string;
  await expect(page.locator('[data-testid="clearance-signoffs"] > li')).toHaveCount(2);
  await expect(page.locator('[data-testid="clearance-detail"]')).toHaveAttribute('data-status', 'in_progress');

  await sign(page, '[data-testid="clearance-signoff-0"]');
  await expect(page.locator('[data-testid="clearance-signoff-0"]')).toHaveAttribute('data-signed', 'true', {
    timeout: 30_000,
  });
  // The IT row is not hr's to sign.
  await expect(page.locator('[data-testid="clearance-signoff-1"] [data-testid$="-open"]')).toHaveCount(0);
  await logout(page);

  await login(page, it.code, it.password);
  await expect(page.locator('[data-testid="home-clearance-awaiting"]')).toBeVisible({ timeout: 30_000 });
  await page.goto(`/en${formUrl.replace(/^\/(en|fa)/, '')}`);
  await sign(page, '[data-testid="clearance-signoff-1"]');
  await expect(page.locator('[data-testid="clearance-detail"]')).toHaveAttribute('data-status', 'awaiting_finance', {
    timeout: 30_000,
  });
  await logout(page);

  await login(page, fin.code, fin.password);
  await page.goto(`/en/clearance/${formId}`);
  await sign(page, '[data-testid="clearance-finance"]');
  await expect(page.locator('[data-testid="clearance-detail"]')).toHaveAttribute('data-status', 'completed', {
    timeout: 30_000,
  });

  await page.goto(`/en/print/clearance/${formId}`);
  await expect(page.locator('[data-testid="print-clearance"]')).toBeVisible();
  await expect(page.locator('[data-testid^="print-clearance-row-"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="print-reason-ticked"]')).toContainText('Resignation');
  await expect(page.locator('[data-testid="print-clearance-row-1"] img')).toBeVisible();
  await expect(page.locator('[data-testid="print-clearance-finance"] img')).toBeVisible();
  await logout(page);

  // ── 2. yesterday as the last day: the account goes off at once ───────────
  await login(page, hr.code, hr.password);
  await fileForm(page, leaverB.code, jalaliDay(-1), null);
  await expect(page.locator('[data-testid="clearance-deactivation"]')).toContainText('deactivated');
  await logout(page);

  await page.goto('/en/login');
  await page.fill('#code', leaverB.code);
  await page.fill('#password', leaverB.password);
  await page.click('button[type="submit"]');
  await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/login$/);
});
