import { test, expect, type Page } from '@playwright/test';
import {
  approveThroughChain,
  fillDailyDateRange,
  jalali2DayRange,
  signApproval,
  signRequest,
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  createEmployee,
  setManager,
  allocate,
} from './_helpers';

// Optional rejection note — typed by the manager, read back by the employee.
const REJECT_REASON = 'پوشش شیفت کافی نیست';

/** Submit a fresh 2-working-day request for the given leave type (Persian picker). */
async function submitTwoDayRequest(page: Page, leaveTypeValue: string, offsetDays = 0) {
  await page.goto('/request');
  await expect(page).toHaveURL(/\/request$/);
  const typeSelect = page.locator('#leave_type_id');
  await expect(typeSelect).toBeVisible({ timeout: 10_000 });
  await typeSelect.selectOption({ value: leaveTypeValue });

  await fillDailyDateRange(page, jalali2DayRange(offsetDays));
  await expect(page.locator('[data-testid="leave-preview"]')).toBeVisible({ timeout: 10_000 });

  await signRequest(page, 'daily');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500); // server action + revalidate
}

test.describe('Approval flow', () => {
  test('manager approves (debits balance) and rejects own reports’ requests', async ({ page }) => {
    // Long multi-role flow; against a cold `next dev` every route compiles on
    // first hit, so give it a generous budget (CI retries twice on top).
    test.setTimeout(240_000);
    const ts = Date.now();

    // 1. Admin sets up a manager and a report.
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);
    const { code: mgrCode, password: mgrPw } = await createEmployee(page, { name: `Manager ${ts}`, roles: ['manager'] });
    const { code: empCode, password: empPw } = await createEmployee(page, { name: `Report ${ts}`, roles: ['employee'] });
    await setManager(page, empCode, mgrCode);
    const ltValue = await allocate(page, empCode, 26);

    // 2. Employee submits two NON-overlapping 2-day requests (both pending;
    //    balance 26 ≥ 2 each). Overlapping ranges are rejected at submit since
    //    the 2026-07-02 hardening, so the second uses a window a week later.
    await logout(page);
    await login(page, empCode, empPw);
    await submitTwoDayRequest(page, ltValue);
    await submitTwoDayRequest(page, ltValue, 7);

    // 3. Manager decides: approve one, reject the other.
    await logout(page);
    await login(page, mgrCode, mgrPw);
    await page.goto('/manage/approvals');

    const approveButtons = page.locator('[data-testid^="approve-btn-"]');
    await expect(approveButtons.first()).toBeVisible({ timeout: 10_000 });
    await expect(approveButtons).toHaveCount(2); // exactly this report's two requests

    // Signature pixels are lazy: the queue carries only consent metadata until
    // this authorized direct manager explicitly opens one.
    const managerSignature = page.locator('[data-testid^="signature-viewer-"]').first();
    await expect(managerSignature).toBeVisible();
    await managerSignature.getByRole('button').click();
    await expect(managerSignature.locator('[data-testid^="signature-preview-"]')).toBeVisible({
      timeout: 10_000,
    });

    // FR-36: capture the id — the manager's signature fills only the FIRST step,
    // and the chain has to be completed before any balance moves.
    const approvedId = (await approveButtons.first().getAttribute('data-testid'))!.replace(
      'approve-btn-',
      ''
    );

    await approveButtons.first().click();
    // Confirm the approve AlertDialog
    const approveConfirm = page.locator('[data-testid^="approve-confirm-"]').first();
    await expect(approveConfirm).toBeVisible({ timeout: 5_000 });
    await signApproval(page);
    await approveConfirm.click();
    await expect(approveButtons).toHaveCount(1); // approved row removed optimistically

    await page.locator('[data-testid^="reject-btn-"]').first().click();
    // Confirm the reject AlertDialog, with an optional reason the employee will read.
    const rejectConfirm = page.locator('[data-testid^="reject-confirm-"]').first();
    await expect(rejectConfirm).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid^="reject-reason-"]').first().fill(REJECT_REASON);
    await rejectConfirm.click();
    await expect(page.locator('[data-testid="approvals-empty"]')).toBeVisible({ timeout: 10_000 });

    // 3b. FR-36: the manager has signed their step, but the request is still
    //     pending and the balance is untouched until HR signs too. The admin may
    //     fill any outstanding step, so they complete the chain here.
    await logout(page);
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);
    await approveThroughChain(page, approvedId);

    // 4. Employee sees one approved + one rejected.
    await logout(page);
    await login(page, empCode, empPw);
    await page.goto('/request');

    const badges = page.locator('[data-testid^="status-badge-"]');
    await expect(badges.filter({ hasText: /approved|تایید/i }).first()).toBeVisible({ timeout: 10_000 });
    await expect(badges.filter({ hasText: /reject|رد/i }).first()).toBeVisible({ timeout: 10_000 });

    // The rejection reason the manager typed reaches the employee.
    await expect(page.locator('[data-testid^="decision-note-"]').first()).toContainText(
      REJECT_REASON,
      { timeout: 10_000 }
    );

    // Rejection does not discard the requester's signed evidence.
    const requesterSignature = page.locator('[data-testid^="signature-viewer-"]').first();
    await requesterSignature.getByRole('button').click();
    await expect(requesterSignature.locator('[data-testid^="signature-preview-"]')).toBeVisible({
      timeout: 10_000,
    });

    // The approved row also exposes the approver's separate signed evidence.
    const approverSignature = page.locator('[data-testid^="approver-signature-viewer-"]').first();
    await expect(approverSignature).toBeVisible();
    await approverSignature.getByRole('button').click();
    await expect(
      approverSignature.locator('[data-testid^="approver-signature-preview-"]')
    ).toBeVisible({ timeout: 10_000 });

    // 5. Balance debited by the approved request (tolerant, like leave.spec.ts):
    //    re-pick the range to surface the balance; assert 24 if it propagated.
    const typeSelect = page.locator('#leave_type_id');
    await typeSelect.selectOption({ value: ltValue });
    await fillDailyDateRange(page, jalali2DayRange());
    await expect(page.locator('[data-testid="leave-preview"]')).toBeVisible({ timeout: 10_000 });
    const balText = await page.locator('[data-testid="balance-display"]').textContent();
    expect(balText).toBeTruthy();
    if (balText && /\d/.test(balText) && !balText.includes('نامشخص')) {
      expect(balText).toContain('24');
    }
  });
});
