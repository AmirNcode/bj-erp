/**
 * FR-52 saved signature + FR-53 personal information.
 *
 * An employee saves a drawn signature and finds every request form pre-filled
 * with it (consent still unticked); replaces it with an uploaded photo; fills in
 * personal information with a typo first. hr then sees and corrects it from the
 * employee's edit page, and the "Info incomplete" filter tracks it.
 * The database rules are covered by tests/sql/fr52-53-signature-personal-info.sql.
 *
 * Touches only its own throwaway users (reaped by scripts/cleanup-e2e.mjs).
 * Runs against `/en/...` so asserted text does not depend on a stored language.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  createEmployee,
  fillDailyErrandDateRange,
  jalali2DayRange,
} from './_helpers';

async function drawOn(page: Page, selector: string) {
  const canvas = page.locator(selector);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.3, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 6 });
  await page.mouse.up();
}

/** A "photo": grey paper with a dark scribble, made by the browser itself. */
async function photoOfSignature(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const g = c.getContext('2d')!;
    g.fillStyle = '#c8c4bc';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#1a1a2e';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(400, 500);
    g.bezierCurveTo(480, 350, 560, 650, 640, 450);
    g.bezierCurveTo(700, 380, 760, 560, 820, 470);
    g.stroke();
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

test('saved signature pre-fills requests; personal info for self and hr', async ({ page }) => {
  test.setTimeout(300_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const hr = await createEmployee(page, { name: 'FR53 HR', roles: ['hr'] });
  const worker = await createEmployee(page, { name: 'FR53 Worker', roles: ['employee'] });
  await logout(page);

  // ── employee: nudge, saved signature, pre-filled request ─────────────────
  await login(page, worker.code, worker.password);
  await page.goto('/en/home');
  await expect(page.locator('[data-testid="profile-reminder"]')).toBeVisible({ timeout: 30_000 });

  await page.goto('/en/profile');
  await expect(page.locator('[data-testid="saved-signature-none"]')).toBeVisible({ timeout: 30_000 });
  await page.click('[data-testid="saved-signature-draw"]');
  await drawOn(page, '[data-testid="saved-signature-canvas"]');
  await page.click('[data-testid="saved-signature-draw-done"]');
  await expect(page.locator('[data-testid="saved-signature-preview"]')).toBeVisible();
  await page.click('[data-testid="saved-signature-save"]');
  await expect(page.locator('[data-testid="saved-signature-image"]')).toBeVisible({ timeout: 30_000 });

  await page.goto('/en/request');
  await expect(page.locator('[data-testid="daily-signature-canvas"]')).toBeVisible({ timeout: 30_000 });
  // Pre-filled: Clear is enabled before any drawing, consent is still unticked.
  await expect(page.locator('[data-testid="daily-signature-clear"]')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('[data-testid="daily-signature-authorized"]')).not.toBeChecked();
  await page.click('[data-testid="daily-signature-clear"]');
  await expect(page.locator('[data-testid="daily-signature-use-saved"]')).toBeVisible();
  // Clear must wipe the saved image, or a fresh drawing lands on top of it.
  await page.waitForTimeout(500);
  const inked = await page.locator('[data-testid="daily-signature-canvas"]').evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
    return n;
  });
  expect(inked).toBe(0);
  await page.click('[data-testid="daily-signature-use-saved"]');
  await expect(page.locator('[data-testid="daily-signature-use-saved"]')).toHaveCount(0);

  // A request goes through with the saved signature and only the consent tick.
  await page.goto('/en/request/daily-errand');
  await expect(page.locator('[data-testid="daily-errand-form"]')).toBeVisible({ timeout: 30_000 });
  await fillDailyErrandDateRange(page, jalali2DayRange(21));
  await page.fill('[data-testid="daily-errand-location"]', 'FR52 saved signature');
  await expect(page.locator('[data-testid="daily-errand-signature-clear"]')).toBeEnabled({ timeout: 30_000 });
  await page.check('[data-testid="daily-errand-signature-authorized"]');
  await page.click('[data-testid="daily-errand-submit"]');
  await expect(page.locator('[data-testid="daily-errand-success"]')).toBeVisible({ timeout: 30_000 });

  // ── replace it with an uploaded photo ────────────────────────────────────
  await page.goto('/en/profile');
  // The file input's onChange exists only once React has hydrated.
  await page.waitForLoadState('networkidle');
  const photo = await photoOfSignature(page);
  await page.setInputFiles('[data-testid="saved-signature-file"]', {
    name: 'signature.jpg',
    mimeType: 'image/jpeg',
    buffer: photo,
  });
  await expect(page.locator('[data-testid="saved-signature-preview"]')).toBeVisible({ timeout: 30_000 });
  const processed = await page.locator('[data-testid="saved-signature-preview"]').getAttribute('src');
  expect(processed).toMatch(/^data:image\/png;base64,/);
  expect((processed ?? '').length).toBeLessThanOrEqual(300_000);
  await page.click('[data-testid="saved-signature-save"]');
  await expect(page.locator('[data-testid="saved-signature-image"]')).toBeVisible({ timeout: 30_000 });

  // ── personal information, with a typo first ──────────────────────────────
  await page.click('[data-testid="profile-personal-info-link"]');
  await expect(page.locator('[data-testid="personal-info-form"]')).toBeVisible({ timeout: 30_000 });
  await page.fill('[data-testid="pi-national_id"]', '0012345678');
  await page.click('[data-testid="personal-info-save"]');
  await expect(page.locator('#pi-national_id-problem')).toBeVisible();

  await page.fill('[data-testid="pi-national_id"]', '۰۰۱۲۳۴۵۶۷۹');
  await page.fill('[data-testid="pi-father_name"]', 'Ali');
  await page.fill('[data-testid="pi-birth_date"]', '1370/01/01');
  await page.fill('[data-testid="pi-sheba"]', 'IR82 0540 1026 8002 0817 9090 02');
  await page.fill('[data-testid="pi-mobile"]', '09121234567');
  await page.selectOption('[data-testid="pi-education"]', 'diploma');
  await page.click('[data-testid="personal-info-save"]');
  await expect(page.locator('[data-testid="personal-info-status"]')).toHaveText('Saved.', { timeout: 30_000 });
  await page.reload();
  await expect(page.locator('[data-testid="pi-sheba"]')).toHaveValue('IR820540102680020817909002', {
    timeout: 30_000,
  });
  await expect(page.locator('[data-testid="pi-birth_date"]')).toHaveValue('1370/01/01');

  await page.goto('/en/home');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-testid="profile-reminder"]')).toHaveCount(0);
  await logout(page);

  // ── hr: sees and corrects it; the incomplete filter follows ──────────────
  await login(page, hr.code, hr.password);
  await page.goto(`/en/manage/employees?filter=incomplete&q=${encodeURIComponent(worker.code)}`);
  await expect(page.locator('[data-testid="emp-filter-incomplete"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('tr', { hasText: worker.code })).toHaveCount(0);

  await page.goto(`/en/manage/employees?q=${encodeURIComponent(worker.code)}`);
  await page.locator('tr', { hasText: worker.code }).first().locator('a[href*="/manage/employees/"]').click();
  const card = page.locator('[data-testid="employee-personal-info"]');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator('[data-testid="pi-national_id"]')).toHaveValue('0012345679');
  await card.locator('[data-testid="pi-mobile"]').fill('');
  await card.locator('[data-testid="personal-info-save"]').click();
  await expect(card.locator('[data-testid="personal-info-status"]')).toHaveText('Saved.', { timeout: 30_000 });

  await page.goto(`/en/manage/employees?filter=incomplete&q=${encodeURIComponent(worker.code)}`);
  await expect(page.locator('tr', { hasText: worker.code }).first()).toBeVisible({ timeout: 30_000 });

  // ── hr: CSV export, then import the mobile back ──────────────────────────
  await page.goto('/en/manage/employees/personal-info');
  await page.waitForLoadState('networkidle');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-testid="personal-info-export"]'),
  ]);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('(national_id)');
  expect(csv).toMatch(new RegExp(`${worker.code},[^\\r\\n]*0012345679`));

  await page.setInputFiles('[data-testid="personal-info-import-file"]', {
    name: 'personal-info.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`personnel_no,mobile\r\n${worker.code},۰۹۳۵۱۲۳۴۵۶۷\r\n`, 'utf8'),
  });
  await expect(page.locator('[data-testid="personal-info-import-plan"]')).toBeVisible({ timeout: 30_000 });
  await page.click('[data-testid="personal-info-import-apply"]');
  await expect(page.locator('[data-testid="personal-info-import-done"]')).toBeVisible({ timeout: 30_000 });

  await page.goto(`/en/manage/employees?filter=incomplete&q=${encodeURIComponent(worker.code)}`);
  await expect(page.locator('[data-testid="emp-filter-incomplete"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('tr', { hasText: worker.code })).toHaveCount(0);
  await logout(page);
});
