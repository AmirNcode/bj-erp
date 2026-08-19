/**
 * FR-40 — bulk holiday upload.
 *
 * Mutates shared company config, so the test deletes every row it added and
 * leaves the holiday list as it found it — the serial suite must stay idempotent.
 *
 * Runs against `/en/...`: an explicit locale prefix beats the stored preference
 * (FR-34), so the asserted text does not depend on the demo admin's language.
 */
import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login } from './_helpers';

// A far-future Jalali year, so these can never collide with a real holiday the
// client enters.
const YEAR = 1449;

test('admin bulk-uploads holidays, then re-uploads to overwrite them', async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();

  // The DATES must be unique per run, not just the names: duplicates are keyed on
  // the date, so a run that fails before its cleanup would leave rows that make
  // the next run's "2 new" assertion read "0 new, 2 updated". Learned the hard
  // way. Jalali months 1-11 all have at least 30 days, so day+1 is always valid.
  const offset = stamp % 300;
  const month = String(Math.floor(offset / 28) + 1).padStart(2, '0');
  const day1 = String((offset % 28) + 1).padStart(2, '0');
  const day2 = String((offset % 28) + 2).padStart(2, '0');
  const dateA = `${YEAR}/${month}/${day1}`;
  const dateB = `${YEAR}/${month}/${day2}`;

  const nameA = `تعطیلی گروهی الف ${stamp}`;
  const nameB = `تعطیلی گروهی ب ${stamp}`;
  const nameAFixed = `${nameA} اصلاح‌شده`;

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/en/manage/settings');
  await expect(page.locator('[data-testid="work-settings"]')).toBeVisible({ timeout: 30_000 });

  const header = 'تاریخ (holiday_date),نام فارسی (name_fa),نام انگلیسی (name_en),تکرار سالانه (is_recurring)';

  const fileInput = page.locator('[data-testid="holiday-csv-input"]');

  const upload = async (csv: string) => {
    // Retry the open click until the dialog is actually mounted. A successful
    // import closes the dialog, and Radix animates that unmount — a click on the
    // trigger during the animation is swallowed, so the second and third uploads
    // would otherwise wait forever on an input that never appears.
    await expect(async () => {
      if (!(await fileInput.isVisible())) {
        await page.click('[data-testid="holiday-import-open"]');
      }
      await expect(fileInput).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });

    await fileInput.setInputFiles({
      name: 'holidays.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
  };

  const confirmButton = page.locator('[data-testid="holiday-import-confirm"]');

  // Activated by KEYBOARD, not by a coordinate click. The dialog grows when the
  // preview table mounts, and a mouse click aimed at a moving target failed here
  // in two ways: Playwright reported "element is not stable", and a click that
  // landed just after a reflow hit the overlay instead, closing the dialog and
  // discarding the upload with no message at all. `press` needs no coordinates,
  // so it cannot miss — and it exercises keyboard operability (NFR-7) for free.
  const confirmImport = async () => {
    await expect(confirmButton).toBeVisible();
    await expect(confirmButton).toBeEnabled();
    await confirmButton.press('Enter');
    // The dialog closes only on the success path, so this IS the assertion that
    // the import went through.
    await expect(fileInput).toBeHidden({ timeout: 25_000 });
  };

  // ── 1. A file with problems is refused, and every problem is listed ────────
  await upload(
    [header, `nonsense,${nameA},A,no`, `${dateB},,B,no`, `${dateA},C name,C,maybe`].join('\n')
  );
  await expect(page.locator('[data-testid="holiday-import-errors"]')).toBeVisible();
  // Three bad rows, one problem each — not "the first error".
  await expect(page.locator('[data-testid="holiday-import-errors"] tbody tr')).toHaveCount(3);
  // Nothing may be written while a line is bad.
  await expect(confirmButton).toBeDisabled();
  await page.click('[data-testid="holiday-import-cancel"]');

  // ── 2. A clean file previews as two additions, then imports ───────────────
  await upload([header, `${dateA},${nameA},Bulk A,no`, `${dateB},${nameB},Bulk B,بله`].join('\n'));
  await expect(page.locator('[data-testid="holiday-import-preview"]')).toBeVisible();
  await expect(page.locator('[data-testid="holiday-import-added"]')).toContainText('2');
  // Neither date exists yet, so nothing is announced as an overwrite.
  await expect(page.locator('[data-testid="holiday-import-updated"]')).toHaveCount(0);

  await confirmImport();

  const list = page.locator('[data-testid="holiday-list"]');
  await expect(list.locator('li', { hasText: nameA })).toBeVisible({ timeout: 20_000 });
  await expect(list.locator('li', { hasText: nameB })).toBeVisible();

  // ── 3. Re-uploading a corrected file OVERWRITES rather than duplicating ───
  // This is the owner's chosen behaviour and the reason to prefer upsert.
  await upload([header, `${dateA},${nameAFixed},Bulk A fixed,no`].join('\n'));
  await expect(page.locator('[data-testid="holiday-import-preview"]')).toBeVisible();
  await expect(page.locator('[data-testid="holiday-import-updated"]')).toContainText('1');
  await expect(page.locator('[data-testid="holiday-import-added"]')).toContainText('0');
  await confirmImport();

  await expect(list.locator('li', { hasText: nameAFixed })).toBeVisible({ timeout: 20_000 });
  // The old name is gone and there is exactly one row for that date, not two.
  await expect(list.locator('li', { hasText: nameA })).toHaveCount(1);

  // ── 4. Restore: delete both rows this test created ────────────────────────
  for (const name of [nameAFixed, nameB]) {
    const row = list.locator('li', { hasText: name });
    await row.getByRole('button').click();
    await page.locator('[data-testid^="holiday-delete-confirm-"]').click();
    await expect(list.locator('li', { hasText: name })).toHaveCount(0, { timeout: 20_000 });
  }
});
