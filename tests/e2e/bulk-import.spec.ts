import { test, expect, type Page } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  fillPicker,
  jalaliRangeFromGregorian,
  login,
  logout,
  nextTestDepartmentCode,
  nextTestPersonnelNo,
  SEEDED_MANAGER_CODE,
  SEEDED_PASSWORD,
} from './_helpers';
import { templateHeader } from '../../lib/csv/import-rows';

/**
 * Admin bulk CSV import v2 (FR-45) + one-time credentials export + bulk
 * password regeneration (spec 2026-07-13). Personnel numbers use the
 * 999####### test range and the new department's English name starts with a
 * `zz` token (code ZZ…), so cleanup-e2e removes everything afterwards.
 */

function csvBuffer(rows: string[][]): Buffer {
  return Buffer.from(
    '﻿' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n',
    'utf-8'
  );
}

async function uploadCsv(page: Page, rows: string[][]) {
  // Retry the whole set-file → preview cycle: on a fast warm load the input
  // can receive the file before React hydration attaches its onChange
  // (same race family as the login helper in _helpers.ts).
  await expect(async () => {
    await page.locator('[data-testid="csv-file"]').setInputFiles({
      name: 'employees.csv',
      mimeType: 'text/csv',
      buffer: csvBuffer(rows),
    });
    await expect(page.locator('[data-testid="import-preview"]')).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

/** Reads {code -> password} from the credentials table. */
async function readCredentials(page: Page): Promise<Map<string, string>> {
  const table = page.locator('[data-testid="credentials-table"]');
  await expect(table).toBeVisible({ timeout: 20_000 });
  const out = new Map<string, string>();
  for (const row of await table.locator('tbody tr').all()) {
    const cells = row.locator('td');
    out.set(
      (await cells.nth(1).textContent())?.trim() ?? '',
      (await cells.nth(2).textContent())?.trim() ?? ''
    );
  }
  return out;
}

test('bulk import, credentials export, duplicate rejection, password regeneration', async ({ page }) => {
  test.setTimeout(180_000);
  const mgrPno = nextTestPersonnelNo();
  const empPno1 = nextTestPersonnelNo();
  const empPno2 = nextTestPersonnelNo();

  const deptToken = nextTestDepartmentCode();
  const header = templateHeader();
  const dataRows = [
    // full_name, personnel_no, job_title, role, department_code, name_fa, name_en,
    // supervisor_personnel_no, manager_personnel_no, hire_date, pto_days, pto_hours
    // The employee comes BEFORE their supervisor: the importer sorts.
    [`Bulk Emp ${empPno1}`, empPno1, 'Welder', 'employee', '', `بخش ${deptToken}`, `${deptToken} Bulk`, mgrPno, '', '2025-07-13', '-1', '-4'],
    [`Bulk Mgr ${mgrPno}`, mgrPno, 'Line Lead', 'manager', '', `بخش ${deptToken}`, `${deptToken} Bulk`, '', '', '1404/04/22', '12', '3'],
    [`Bulk Emp ${empPno2}`, empPno2, '', 'employee', 'qc', '', '', '', '', '', '0', '0'],
  ];
  const balanceDate = jalaliRangeFromGregorian(new Date(), new Date()).split(' — ')[0];

  // ── import happy path ─────────────────────────────────────────────────────
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/employees');
  await expect(page.locator('[data-testid="import-link"]')).toBeVisible({ timeout: 10_000 });

  // Navigate with retry — a cold `next dev` can 404 a route on its very
  // first request while the route is still compiling.
  await expect(async () => {
    await page.goto('/manage/employees/import');
    await expect(page.locator('[data-testid="template-download"]')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await uploadCsv(page, [header, ...dataRows]);
  await expect(page.locator('[data-testid="import-errors"]')).toHaveCount(0);
  // The new department is listed and must be acknowledged; the date is required.
  await expect(page.locator('[data-testid="import-departments"]')).toContainText(`${deptToken} Bulk`);
  await expect(page.locator('[data-testid="import-submit"]')).toBeDisabled();
  await page.locator('[data-testid="import-ack-departments"]').check();
  await fillPicker(page, balanceDate, '[data-testid="import-balance-date-field"]');
  await expect(page.locator('[data-testid="import-accrual-start"]')).toBeVisible();
  await page.locator('[data-testid="import-submit"]').click();

  const creds = await readCredentials(page);
  expect(creds.size).toBe(3);
  // Since 20260730130002 the generated login code is the personnel number.
  const empCode = empPno1;
  const empPw = creds.get(empCode) ?? '';
  expect(empPw.length).toBeGreaterThan(6);

  // ── imported employee can log in ──────────────────────────────────────────
  await logout(page);
  await login(page, empCode, empPw);
  await expect(page.locator('[data-testid="home-board"]')).toBeVisible({ timeout: 10_000 });

  // ── re-importing the same file is rejected in the preview ────────────────
  await logout(page);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/employees/import');
  await uploadCsv(page, [header, ...dataRows]);
  await expect(page.locator('[data-testid="import-errors"]')).toBeVisible();
  await expect(page.locator('[data-testid="import-submit"]')).toBeDisabled();

  // ── manager cannot reach the import page ─────────────────────────────────
  await logout(page);
  await login(page, SEEDED_MANAGER_CODE, SEEDED_PASSWORD);
  await page.goto('/manage/employees/import');
  await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 10_000 });

  // ── bulk password regeneration ────────────────────────────────────────────
  await logout(page);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  // The list is paginated (25/page) and selection lives on one page: narrow it
  // to this file's people, whose names all start with "Bulk".
  await page.goto('/manage/employees?q=Bulk');
  await page.locator(`[data-testid="emp-check-${empCode}"]`).check();
  await page.locator(`[data-testid="emp-check-${mgrPno}"]`).check();
  await page.locator('[data-testid="regen-passwords"]').click();
  await page.locator('[data-testid="regen-confirm"]').click();

  const regen = await readCredentials(page);
  expect(regen.size).toBe(2);
  const newPw = regen.get(empCode) ?? '';
  expect(newPw.length).toBeGreaterThan(6);
  expect(newPw).not.toBe(empPw);

  // The regenerated password logs in (the reset RPC replaces the old hash,
  // so the old password cannot also work).
  await logout(page);
  await login(page, empCode, newPw);
  await expect(page.locator('[data-testid="home-board"]')).toBeVisible({ timeout: 10_000 });
});

test('import modes: add & update changes a title; replace deactivates who is not in the file', async ({ page }) => {
  test.setTimeout(180_000);
  const boss = nextTestPersonnelNo();
  const keep = nextTestPersonnelNo();
  const gone = nextTestPersonnelNo();
  const token = nextTestDepartmentCode();
  const header = templateHeader();
  const balanceDate = jalaliRangeFromGregorian(new Date(), new Date()).split(' — ')[0];
  const r = (name: string, pno: string, title: string, role: string, mgr: string) => [
    name, pno, title, role, '', `بخش ${token}`, `${token} Modes`, '', mgr, '', '0', '0',
  ];

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const open = async () => {
    await expect(async () => {
      await page.goto('/manage/employees/import');
      await expect(page.locator('[data-testid="template-download"]')).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  };

  // ── 1. add: three people in a new department ──────────────────────────────
  await open();
  await uploadCsv(page, [
    header,
    r(`Modes Boss ${boss}`, boss, 'Head', 'manager', ''),
    r(`Modes Keep ${keep}`, keep, 'Welder', 'employee', boss),
    r(`Modes Gone ${gone}`, gone, 'Welder', 'employee', boss),
  ]);
  await page.locator('[data-testid="import-ack-departments"]').check();
  await fillPicker(page, balanceDate, '[data-testid="import-balance-date-field"]');
  await page.locator('[data-testid="import-submit"]').click();
  await expect(page.locator('[data-testid="import-done"]')).toBeVisible({ timeout: 20_000 });

  // ── 2. add & update: same people, a new title for one ─────────────────────
  await open();
  await page.locator('[data-testid="import-mode-update"]').check();
  await uploadCsv(page, [
    header,
    r(`Modes Boss ${boss}`, boss, 'Head', 'manager', ''),
    r(`Modes Keep ${keep}`, keep, 'Senior Welder', 'employee', boss),
    r(`Modes Gone ${gone}`, gone, 'Welder', 'employee', boss),
  ]);
  await expect(page.locator('[data-testid="import-errors"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="import-plan-summary"]')).toBeVisible();
  await fillPicker(page, balanceDate, '[data-testid="import-balance-date-field"]');
  await page.locator('[data-testid="import-submit"]').click();
  await expect(page.locator('[data-testid="import-done"]')).toContainText('3', { timeout: 20_000 });

  // ── 3. replace: the file leaves one out → deactivated after confirming ─────
  await open();
  await page.locator('[data-testid="import-mode-replace"]').check();
  await uploadCsv(page, [
    header,
    r(`Modes Boss ${boss}`, boss, 'Head', 'manager', ''),
    r(`Modes Keep ${keep}`, keep, 'Senior Welder', 'employee', boss),
  ]);
  const missing = page.locator('[data-testid="import-missing"]');
  await expect(missing).toContainText(`Modes Gone ${gone}`);
  // Everyone else the local DB holds is listed too: keep them all, deactivate only ours.
  await page.locator('[data-testid="import-missing-default-keep"]').check();
  const goneRow = missing.locator('li', { hasText: `Modes Gone ${gone}` });
  await goneRow.locator('select').selectOption('deactivate');
  // Answer any conflicts the shared DB produces by keeping things as they are.
  for (const radio of await page.locator('[data-testid$="-keepBoth"], [data-testid$="-noManager"], [data-testid$="-keepAsManager"]').all()) {
    await radio.check();
  }
  await fillPicker(page, balanceDate, '[data-testid="import-balance-date-field"]');
  await page.locator('[data-testid="import-submit"]').click();
  await expect(page.locator('[data-testid="import-replace-confirm-body"]')).toBeVisible();
  await page.locator('[data-testid="import-replace-confirm"]').click();
  await expect(page.locator('[data-testid="import-done"]')).toBeVisible({ timeout: 20_000 });

  // The deactivated person can no longer sign in? Check the list instead: inactive filter.
  await page.goto(`/manage/employees?filter=inactive&q=${gone}`);
  await expect(page.locator('body')).toContainText(`Modes Gone ${gone}`, { timeout: 10_000 });
});
