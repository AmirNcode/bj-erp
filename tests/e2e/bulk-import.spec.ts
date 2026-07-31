import { test, expect, type Page } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, nextTestPersonnelNo } from './_helpers';
import { templateHeader } from '../../lib/csv/import-rows';

/**
 * Admin bulk CSV import + one-time credentials export + bulk password
 * regeneration (spec 2026-07-13). Personnel numbers use the 999####### test
 * range so app_cleanup_e2e_users() removes everything afterwards.
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

  const header = templateHeader();
  const dataRows = [
    // full_name, personnel_no, hire_date, department_code, manager_personnel_no, role, job_title, annual, sick
    [`Bulk Mgr ${mgrPno}`, mgrPno, '1404/04/22', 'prod', '', 'manager', 'Line Lead', '26', '10'],
    [`Bulk Emp ${empPno1}`, empPno1, '2025-07-13', 'prod', mgrPno, 'employee', 'Welder', '26', '10'],
    [`Bulk Emp ${empPno2}`, empPno2, '', 'qc', '', 'employee', '', '20', '5'],
  ];

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
  await login(page, 'm-prod', 'Demo!2026');
  await page.goto('/manage/employees/import');
  await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 10_000 });

  // ── bulk password regeneration ────────────────────────────────────────────
  await logout(page);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/employees');
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
