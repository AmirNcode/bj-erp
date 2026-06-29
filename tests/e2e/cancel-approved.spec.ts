import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee, allocate, submitLeave,
} from './_helpers';

// FR-15: an employee cancels their own APPROVED future leave; the row flips to
// cancelled and the Cancel control disappears. Throwaway employee (the seed
// deactivates such codes), so no shared-state cleanup. Admin approves via override.
//
// submitLeave uses the fixed JALALI_2DAY (= 2026-06-29/30); this test requires
// "today" to be before that start date so the approved leave is still cancellable.
test('employee cancels an approved future leave', async ({ page }) => {
  test.setTimeout(240_000); // a cold `next dev` compiles each route on first hit
  const ts = Date.now();
  const code = `cxl${ts}`;
  const name = `Cancel Tester ${ts}`;

  // Admin: create the employee and allocate annual leave.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const pw = await createEmployee(page, { code, name, roles: ['employee'] });
  const leaveTypeValue = await allocate(page, code, 26);
  await logout(page);

  // Employee: submit a future 2-day leave request (pending).
  await login(page, code, pw.trim());
  await submitLeave(page, { leaveTypeValue });
  await logout(page);

  // Admin approves this employee's request. Scope the queue row by employee name
  // so other pending rows in the admin-wide queue don't interfere.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/approvals');
  const approvalRow = page.locator('[data-testid^="approval-row-"]').filter({ hasText: name });
  await expect(approvalRow).toBeVisible({ timeout: 15_000 });
  // Get the request id from the approval row's data-testid, then click approve trigger + confirm.
  const approveBtn = approvalRow.locator('[data-testid^="approve-btn-"]');
  await approveBtn.click();
  // Confirm the approve AlertDialog
  const approveConfirm = page.locator('[data-testid^="approve-confirm-"]').first();
  await expect(approveConfirm).toBeVisible({ timeout: 5_000 });
  await approveConfirm.click();
  await expect(approvalRow).toHaveCount(0, { timeout: 10_000 }); // removed optimistically
  await logout(page);

  // Employee: the approved future request shows Cancel; cancelling opens an AlertDialog,
  // confirming flips the badge to "cancelled" and removes the button.
  await login(page, code, pw.trim());
  await page.goto('/request');
  const row = page.locator('[data-testid^="request-row-"]').first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const cancelBtn = row.locator('[data-testid^="cancel-btn-"]');
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();
  // Click the AlertDialog confirm button (replaces native confirm() dialog)
  const confirmBtn = page.locator('[data-testid^="cancel-confirm-"]').first();
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await confirmBtn.click();
  const badge = row.locator('[data-testid^="status-badge-"]');
  await expect(badge).toHaveText(/لغو|cancel/i, { timeout: 10_000 });
  await expect(cancelBtn).toHaveCount(0);
});
