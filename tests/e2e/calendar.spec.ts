import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  createEmployee,
  allocate,
  submitLeave,
  signApproval,
  jalaliCurrentMonthRange,
} from './_helpers';

test.describe('Calendar visibility + reason privacy (FR-22, FR-25)', () => {
  test('teammate sees a coworker’s leave on the calendar but never the reason', async ({ page }) => {
    // Long multi-role flow against a cold `next dev`; generous budget.
    test.setTimeout(240_000);
    const ts = Date.now();

    const requesterName = `Requester ${ts}`;
    const SECRET = `SECRETMED${ts}`; // distinctive, space-free reason string

    // 1. Admin creates a requester + a teammate (same department → same_team) and
    //    allocates balance to the requester.
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);
    const { code: authCode, password: authPw } = await createEmployee(page, { name: requesterName, roles: ['employee'] });
    const { code: peerCode, password: peerPw } = await createEmployee(page, { name: `Peer ${ts}`, roles: ['employee'] });
    const ltValue = await allocate(page, authCode, 26);

    // 2. Requester submits a request carrying a private reason.
    await logout(page);
    await login(page, authCode, authPw);
    await submitLeave(page, { leaveTypeValue: ltValue, reason: SECRET, range: jalaliCurrentMonthRange() });

    // 3. Teammate opens the calendar.
    await logout(page);
    await login(page, peerCode, peerPw);
    await page.goto('/calendar');
    await expect(page.locator('[data-testid="calendar-view"]')).toBeVisible({ timeout: 10_000 });

    // Sees the coworker's leave entry (name + dates + type)...
    await expect(
      page.locator('[data-testid^="cal-entry-"]').filter({ hasText: requesterName }).first()
    ).toBeVisible({ timeout: 10_000 });
    // Teammates receive neither the private image nor its consent metadata.
    await expect(page.locator('[data-testid^="signature-viewer-"]')).toHaveCount(0);

    // The month toggle highlights days with time-off, shows a count, and the
    // selected-day detail lists who is off plus their return date.
    await page.locator('[data-testid="calendar-month-toggle"]').click();
    await expect(page.locator('[data-testid="calendar-month-grid"]')).toBeVisible();

    // "Today" is Asia/Tehran (lib/appDate.ts) — the UTC date is one day
    // behind between 20:30 and 24:00 UTC.
    const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(
      new Date()
    );
    await expect(page.locator(`[data-testid="calendar-day-count-${todayIso}"]`)).toBeVisible({
      timeout: 10_000,
    });
    await page.locator(`[data-testid="calendar-day-${todayIso}"]`).click();
    await expect(page.locator('[data-testid="calendar-day-detail"]')).toContainText(requesterName);
    await expect(page.locator('[data-testid="calendar-day-detail"]')).toContainText(/Returns|بازگشت/);

    // Mobile must stay as a seven-column month grid, not one day per row.
    await page.setViewportSize({ width: 390, height: 844 });
    const firstWeekBoxes = await page
      .locator('button[data-testid^="calendar-day-"]')
      .evaluateAll((nodes) =>
        nodes.slice(0, 7).map((node) => {
          const box = node.getBoundingClientRect();
          return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) };
        })
      );
    expect(new Set(firstWeekBoxes.map((box) => box.y)).size).toBe(1);
    expect(new Set(firstWeekBoxes.map((box) => box.x)).size).toBe(7);
    expect(Math.max(...firstWeekBoxes.map((box) => box.width))).toBeLessThan(60);

    // ...but the private reason must NOT appear anywhere on the calendar (FR-25).
    await expect(page.locator('body')).not.toContainText(SECRET);

    // 4. And it must not leak on the teammate's own request page either.
    await page.goto('/request');
    await expect(page.locator('body')).not.toContainText(SECRET);

    // 5. A plain employee never sees approve/reject buttons on the calendar.
    await page.goto('/calendar');
    await expect(page.locator('[data-testid="calendar-view"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid^="cal-approve-btn-"]')).toHaveCount(0);

    // 6. An approver can decide the pending request straight from the calendar.
    await page.setViewportSize({ width: 1280, height: 800 });
    await logout(page);
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);
    await page.goto('/calendar');
    const entryCard = page
      .locator('[data-testid^="cal-entry-"]')
      .filter({ hasText: requesterName })
      .first();
    await expect(entryCard).toBeVisible({ timeout: 10_000 });
    const adminSignature = entryCard.locator('[data-testid^="signature-viewer-"]');
    await expect(adminSignature).toBeVisible();
    await adminSignature.getByRole('button').click();
    await expect(adminSignature.locator('[data-testid^="signature-preview-"]')).toBeVisible({
      timeout: 10_000,
    });
    await entryCard.locator('[data-testid^="cal-approve-btn-"]').click();
    const confirmBtn = page.locator('[data-testid^="cal-approve-confirm-"]').first();
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await signApproval(page, 'calendar');
    await confirmBtn.click();
    // Buttons disappear once decided; entry stays (now approved).
    await expect(entryCard.locator('[data-testid^="cal-approve-btn-"]')).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(
      page.locator('[data-testid^="cal-entry-"]').filter({ hasText: requesterName }).first()
    ).toBeVisible();
  });
});
