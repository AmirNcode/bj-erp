import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  createEmployee,
  allocate,
  submitLeave,
  jalaliCurrentMonthRange,
} from './_helpers';

test.describe('Calendar visibility + reason privacy (FR-22, FR-25)', () => {
  test('teammate sees a coworker’s leave on the calendar but never the reason', async ({ page }) => {
    // Long multi-role flow against a cold `next dev`; generous budget.
    test.setTimeout(240_000);
    const ts = Date.now();
    const authCode = `auth${ts}`;
    const peerCode = `peer${ts}`;
    const requesterName = `Requester ${ts}`;
    const SECRET = `SECRETMED${ts}`; // distinctive, space-free reason string

    // 1. Admin creates a requester + a teammate (same department → same_team) and
    //    allocates balance to the requester.
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);
    const authPw = await createEmployee(page, { code: authCode, name: requesterName, roles: ['employee'] });
    const peerPw = await createEmployee(page, { code: peerCode, name: `Peer ${ts}`, roles: ['employee'] });
    const ltValue = await allocate(page, authCode, 26);

    // 2. Requester submits a request carrying a private reason.
    await logout(page);
    await login(page, authCode, authPw.trim());
    await submitLeave(page, { leaveTypeValue: ltValue, reason: SECRET, range: jalaliCurrentMonthRange() });

    // 3. Teammate opens the calendar.
    await logout(page);
    await login(page, peerCode, peerPw.trim());
    await page.goto('/calendar');
    await expect(page.locator('[data-testid="calendar-view"]')).toBeVisible({ timeout: 10_000 });

    // Sees the coworker's leave entry (name + dates + type)...
    await expect(
      page.locator('[data-testid^="cal-entry-"]').filter({ hasText: requesterName }).first()
    ).toBeVisible({ timeout: 10_000 });

    // The month toggle highlights days with time-off, shows a count, and the
    // selected-day detail lists who is off plus their return date.
    await page.locator('[data-testid="calendar-month-toggle"]').click();
    await expect(page.locator('[data-testid="calendar-month-grid"]')).toBeVisible();

    const todayIso = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
    )
      .toISOString()
      .slice(0, 10);
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
  });
});
