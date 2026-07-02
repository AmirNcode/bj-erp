/**
 * Regression for the 2026-07-02 hardening:
 *   1. submit_leave_request rejects a range overlapping the caller's own
 *      pending/approved requests, and
 *   2. the SQL error surfaces LOCALIZED (fa) in the UI — which also proves
 *      getTranslations() resolves inside a server action at runtime
 *      (lib/errors/db-error.ts).
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee, allocate, submitLeave,
} from './_helpers';

test('overlapping request is rejected with a localized error', async ({ page }) => {
  test.setTimeout(180_000);
  const ts = Date.now();
  const code = `ov${ts}`;

  // Admin creates a throwaway employee with balance.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const pw = await createEmployee(page, { code, name: `Overlap Test ${ts}`, roles: ['employee'] });
  const ltValue = await allocate(page, code, 10);
  await logout(page);

  // Employee submits the same 2-day window twice.
  await login(page, code, pw.trim());
  await submitLeave(page, { leaveTypeValue: ltValue });
  await expect(page.locator('[data-testid="success-msg"]')).toBeVisible({ timeout: 10_000 });

  await submitLeave(page, { leaveTypeValue: ltValue });
  const error = page.locator('[data-testid="error-msg"]');
  await expect(error).toBeVisible({ timeout: 10_000 });
  // Localized fa message from messages/fa.json dbErrors.overlap — must NOT be
  // the raw Postgres English string.
  await expect(error).toContainText('درخواست مرخصی');
  await expect(error).not.toContainText('overlapping leave request exists');
});
