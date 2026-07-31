import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  nextTestDepartmentCode,
  nextTestPersonnelNo,
} from './_helpers';

/**
 * SKIPPED 2026-07-30 — department **code editing** was deactivated at the
 * client's request (D7 in
 * docs/specs/2026-07-30-work-errand-and-login-codes-design.md). The Add
 * Department form no longer has a code field, so this test's `dept-code` fill
 * and its `${deptCode}-${pno}` login code cannot exist any more.
 *
 * Kept rather than deleted: `updateDepartmentCode` and the
 * `departments_update_admin` RLS policy are still in place, so if the client
 * brings code editing back this is the coverage to un-skip. The behaviour that
 * replaced it is covered by the two tests below.
 */
test.skip('admin creates a department and hires an employee into it', async ({ page }) => {
  test.setTimeout(180_000); // cold `next dev` compiles each route on first hit
  const deptCode = nextTestDepartmentCode();
  const pno = nextTestPersonnelNo();
  const nameFa = `واحد آزمایشی ${deptCode}`;
  const nameEn = `E2E Department ${deptCode}`;

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/employees');

  // The button sits beside "Add Employee" in the page header.
  const addDept = page.locator('[data-testid="add-department-link"]');
  await expect(addDept).toBeVisible({ timeout: 15_000 });
  await addDept.click();
  await expect(page).toHaveURL(/\/manage\/departments\/new$/, { timeout: 15_000 });

  await page.fill('[data-testid="dept-name-fa"]', nameFa);
  await page.fill('[data-testid="dept-name-en"]', nameEn);
  // The English name auto-suggests a code; typing one overrides the suggestion.
  await page.fill('[data-testid="dept-code"]', deptCode);
  await page.locator('#kind').selectOption({ value: 'office' });
  await page.click('[data-testid="dept-submit"]');

  const created = page.locator('[data-testid="dept-created"]');
  await expect(created).toBeVisible({ timeout: 15_000 });
  await expect(created).toContainText(deptCode);

  // Follow the success screen straight into employee creation.
  await page.click('[data-testid="dept-add-employee"]');
  await expect(page).toHaveURL(/\/manage\/employees\/new$/, { timeout: 15_000 });

  // The brand-new department is selectable, and drives the generated login code.
  const deptSelect = page.locator('#department_id');
  await expect(deptSelect).toBeVisible({ timeout: 10_000 });
  let deptValue = '';
  for (const opt of await deptSelect.locator('option').all()) {
    if ((await opt.textContent())?.trim() === nameFa) {
      deptValue = (await opt.getAttribute('value')) ?? '';
      break;
    }
  }
  expect(deptValue).not.toBe('');
  await deptSelect.selectOption({ value: deptValue });

  await page.fill('#personnel_no', pno);
  await page.fill('#full_name', `New Dept Hire ${pno}`);
  await expect(page.locator('[data-testid="code-preview"]')).toHaveText(`${deptCode}-${pno}`);

  await page.click('button[type="submit"]');
  const pwEl = page.locator('[data-testid="temp-password"]');
  await expect(pwEl).toBeVisible({ timeout: 15_000 });
  const password = (await pwEl.textContent())?.trim() ?? '';

  // The employee can log in with the code built from the new department.
  await logout(page);
  await login(page, `${deptCode}-${pno}`, password);
  await expect(page.locator('[data-testid="home-board"]')).toBeVisible({ timeout: 10_000 });
});

/**
 * The replacement for the test above (spec 2026-07-30 §7): Add Department now
 * lives in Manage → Settings, has no code field, and Cancel returns to
 * Settings. Creating a department still lets the admin hire into it, and the
 * generated login code is now the bare personnel number.
 *
 * The English name starts with a `zz####` token so the auto-generated code
 * (first 4 latin chars of the English name) stays `zz`-prefixed and is reaped
 * by scripts/cleanup-e2e.mjs; the 999####### login code is reaped by
 * app_cleanup_e2e_users().
 */
test('admin adds a department from Settings and hires into it', async ({ page }) => {
  test.setTimeout(180_000); // cold `next dev` compiles each route on first hit
  const token = nextTestDepartmentCode();
  const pno = nextTestPersonnelNo();
  const nameFa = `واحد آزمایشی ${token}`;
  const nameEn = `${token} E2E Department`;

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/settings');

  // The button now lives at the bottom of the Departments card, not on the
  // Employees page.
  await expect(page.locator('[data-testid="dept-list"]')).toBeVisible({ timeout: 15_000 });
  const addDept = page.locator('[data-testid="add-department-link"]');
  await expect(addDept).toBeVisible();
  await addDept.click();
  await expect(page).toHaveURL(/\/manage\/departments\/new$/, { timeout: 15_000 });

  // Cancel returns to Settings (it used to go to the Employees list).
  await page.click('[data-testid="dept-cancel"]');
  await expect(page).toHaveURL(/\/manage\/settings$/, { timeout: 15_000 });

  await page.locator('[data-testid="add-department-link"]').click();
  await expect(page).toHaveURL(/\/manage\/departments\/new$/, { timeout: 15_000 });

  // No code field: the code is generated server-side and never shown.
  await expect(page.locator('[data-testid="dept-code"]')).toHaveCount(0);

  await page.fill('[data-testid="dept-name-fa"]', nameFa);
  await page.fill('[data-testid="dept-name-en"]', nameEn);
  await page.locator('#kind').selectOption({ value: 'office' });
  await page.click('[data-testid="dept-submit"]');

  const created = page.locator('[data-testid="dept-created"]');
  await expect(created).toBeVisible({ timeout: 15_000 });
  await expect(created).toContainText(nameFa);
  await expect(page.locator('[data-testid="dept-back-to-settings"]')).toBeVisible();

  // Follow the success screen straight into employee creation.
  await page.click('[data-testid="dept-add-employee"]');
  await expect(page).toHaveURL(/\/manage\/employees\/new$/, { timeout: 15_000 });

  const deptSelect = page.locator('#department_id');
  await expect(deptSelect).toBeVisible({ timeout: 10_000 });
  let deptValue = '';
  for (const opt of await deptSelect.locator('option').all()) {
    if ((await opt.textContent())?.trim() === nameFa) {
      deptValue = (await opt.getAttribute('value')) ?? '';
      break;
    }
  }
  expect(deptValue).not.toBe('');
  await deptSelect.selectOption({ value: deptValue });

  await page.fill('#personnel_no', pno);
  await page.fill('#full_name', `New Dept Hire ${pno}`);
  // The department no longer prefixes the code.
  await expect(page.locator('[data-testid="code-preview"]')).toHaveText(pno);

  await page.click('button[type="submit"]');
  const pwEl = page.locator('[data-testid="temp-password"]');
  await expect(pwEl).toBeVisible({ timeout: 15_000 });
  const password = (await pwEl.textContent())?.trim() ?? '';

  // The bare numeric code logs in.
  await logout(page);
  await login(page, pno, password);
  await expect(page.locator('[data-testid="home-board"]')).toBeVisible({ timeout: 10_000 });
});

/**
 * Settings → Departments card (spec 2026-07-30 §7 / D10): names only, each row
 * opens a members panel grouped Managers then Workers, dismissable by the X,
 * an outside click, and Esc.
 */
test('the Departments card opens a members dialog and closes three ways', async ({ page }) => {
  test.setTimeout(120_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/settings');

  const list = page.locator('[data-testid="dept-list"]');
  await expect(list).toBeVisible({ timeout: 15_000 });

  // Seeded "Production Line A" — has both a manager and workers.
  const row = page.locator('[data-testid="dept-row-production-line-a"]');
  await expect(row).toBeVisible();
  // Codes are hidden here now; the row shows the name only.
  await expect(row).not.toContainText('prod');

  const dialog = page.locator('[data-testid="dept-members-dialog"]');

  // ── opens, and groups Managers before Workers ────────────────────────────
  await row.click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const members = dialog.locator('[data-testid="dept-members-list"]');
  await expect(members).toBeVisible({ timeout: 10_000 });
  const groupTitles = await members.locator('h3').allTextContents();
  expect(groupTitles.length).toBeGreaterThan(0);
  await expect(members.locator('li').first()).toBeVisible();

  // ── closes via the built-in X (top-4 end-4: top-left in RTL fa) ──────────
  await dialog.locator('[data-slot="dialog-close"]').click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  // ── closes on an outside click ───────────────────────────────────────────
  await row.click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  // ── closes on Esc ────────────────────────────────────────────────────────
  await row.click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 10_000 });
});

/** Departments are company-wide config: admin only, even inside /manage. */
test('a manager cannot reach the new-department page', async ({ page }) => {
  test.setTimeout(120_000);

  await login(page, 'm-prod', 'Demo!2026');

  // Settings (which now hosts the Add Department button) is admin-only.
  await page.goto('/manage/settings');
  await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 });

  await page.goto('/manage/departments/new');
  await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 15_000 });
});
