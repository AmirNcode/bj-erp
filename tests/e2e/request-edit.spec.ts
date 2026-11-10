/**
 * FR-91: an editor edits an approved request from Manage › Requests. Throwaway 999… users
 * only (the local DB holds the real roster). The `hr` preset holds the four type toggles; a
 * plain manager holds none and must not be offered Edit.
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee, allocate, submitLeave,
  approveThroughChain, requestIdFromQueueRow, signApproval,
} from './_helpers';

test('an hr user edits an approved daily leave into an hourly one; the employee sees the edit', async ({ page }) => {
  test.setTimeout(300_000);
  const name = `Edit Subject ${Date.now() % 100000}`;

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const emp = await createEmployee(page, { name, roles: ['employee'] });
  const hr = await createEmployee(page, { name: 'Edit HR Officer', roles: ['hr'] });
  const plain = await createEmployee(page, { name: 'Edit Plain Manager', roles: ['manager'] });
  const leaveTypeValue = await allocate(page, emp.code, 26);
  await logout(page);

  // The employee files a daily leave; the admin approves it through every step.
  await login(page, emp.code, emp.password);
  await submitLeave(page, { leaveTypeValue, reason: 'Edit probe' });
  await logout(page);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/approvals');
  const row = page.locator('[data-testid^="approval-row-"]').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 20_000 });
  const id = await requestIdFromQueueRow(row);
  await approveThroughChain(page, id);
  await logout(page);

  // A manager without the toggle is offered no Edit button.
  await login(page, plain.code, plain.password);
  await page.goto('/en/manage/requests');
  await expect(page.locator(`[data-testid="edit-request-${id}"]`)).toHaveCount(0);
  await logout(page);

  // HR edits it: daily -> hourly, with a reason and a signature.
  await login(page, hr.code, hr.password);
  await page.goto('/en/manage/requests');
  await page.click(`[data-testid="edit-request-${id}"]`);
  await page.click('[data-testid="edit-unit-hour"]');
  await page.fill('[data-testid="edit-reason"]', 'Only needed two hours');
  await expect(page.locator('[data-testid="edit-submit"]')).toBeDisabled(); // no signature yet
  await signApproval(page, 'edit');
  await expect(page.locator('[data-testid="edit-submit"]')).toBeEnabled();
  await page.click('[data-testid="edit-submit"]');
  await expect(page.locator('[data-testid="edit-submit"]')).toHaveCount(0, { timeout: 20_000 });
  await logout(page);

  // The employee sees the edit on the request.
  await login(page, emp.code, emp.password);
  await page.goto('/en/request?form=1&all=1');
  await page.click(`[data-testid="progress-toggle-${id}"]`);
  await expect(page.locator(`[data-testid="progress-corrections-${id}"]`)).toContainText('Only needed two hours', { timeout: 20_000 });
});
