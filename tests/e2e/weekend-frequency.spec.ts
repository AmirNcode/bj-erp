/**
 * FR-41 — a weekday off every OTHER week.
 *
 * Covers the settings round-trip and its validation. The DURATION effect is
 * covered elsewhere and deliberately not re-tested here: `work_settings` is
 * company-wide config, so a spec that left Thursday fortnightly while submitting
 * requests would change what every other spec in a serial run counts. The
 * arithmetic is pinned by `tests/unit/weekend.test.ts` and
 * `tests/unit/workingDays.test.ts`, whose numbers were taken from
 * `public.compute_requested_minutes` on the live database (24 / 20 / 22 working
 * days over one 28-day range) and confirmed to match `private.is_company_weekend`
 * case by case, including dates on the far side of the week epoch.
 *
 * Mutates shared config, so it restores Thursday to a working day at the end.
 *
 * Runs against `/en/...`: an explicit locale prefix beats the stored preference
 * (FR-34), so the asserted text does not depend on the demo admin's language.
 */
import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login } from './_helpers';

test('admin sets a weekday off every other week, with a reference date', async ({ page }) => {
  test.setTimeout(180_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/en/manage/settings');
  await expect(page.locator('[data-testid="work-settings"]')).toBeVisible({ timeout: 30_000 });

  const thu = page.locator('[data-testid="weekend-freq-thu"]');
  const fri = page.locator('[data-testid="weekend-freq-fri"]');
  const anchor = page.locator('[data-testid="biweekly-anchor"]');
  const saved = page.locator('[data-testid="work-settings-saved"]');
  const error = page.locator('[data-testid="work-settings-error"]');

  // Friday ships off every week; that is the baseline this builds on.
  await expect(fri).toHaveValue('weekly');

  // Normalize BEFORE asserting, not only after. globalSetup already restores this,
  // but a previous spec in the same run can have changed it, and a run that dies
  // here would otherwise leave the next one failing on step 1 for a reason that
  // has nothing to do with the code.
  if ((await thu.inputValue()) !== 'working') {
    await thu.selectOption('working');
    await page.click('[data-testid="work-settings-save"]');
    await expect(saved).toBeVisible({ timeout: 15_000 });
    await page.reload();
  }

  // ── 1. The reference date only appears once a day is fortnightly ───────────
  await expect(anchor).toHaveCount(0);
  await thu.selectOption('biweekly');
  await expect(anchor).toBeVisible();

  // ── 2. Saving without a reference date is refused, and says why ────────────
  // Without one the parity — WHICH Thursdays are off — is undefined, so the
  // server refuses rather than picking for the admin.
  await page.click('[data-testid="work-settings-save"]');
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toContainText(/reference date/i);
  await expect(saved).toHaveCount(0);

  // ── 3. With a reference date it saves, and survives a reload ──────────────
  const picker = anchor.locator('input').first();
  await picker.click();
  // Any date inside an off WEEK works — the rule buckets by week, not by
  // weekday, so the reference date need not itself be the fortnightly weekday.
  await picker.fill('1405/06/04');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('h1').click(); // dismiss the calendar popup

  await page.click('[data-testid="work-settings-save"]');
  await expect(saved).toBeVisible({ timeout: 15_000 });

  await page.reload();
  // Read back from the database, not from the form's own state.
  await expect(page.locator('[data-testid="weekend-freq-thu"]')).toHaveValue('biweekly', {
    timeout: 15_000,
  });
  await expect(page.locator('[data-testid="weekend-freq-fri"]')).toHaveValue('weekly');
  await expect(page.locator('[data-testid="biweekly-anchor"]')).toBeVisible();
  await expect(page.locator('[data-testid="biweekly-anchor"] input').first()).not.toHaveValue('');

  // ── 4. Restore: Thursday back to a working day ────────────────────────────
  await page.locator('[data-testid="weekend-freq-thu"]').selectOption('working');
  await page.click('[data-testid="work-settings-save"]');
  await expect(page.locator('[data-testid="work-settings-saved"]')).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.locator('[data-testid="weekend-freq-thu"]')).toHaveValue('working', {
    timeout: 15_000,
  });
  // The reference-date field goes away with the last fortnightly day.
  await expect(page.locator('[data-testid="biweekly-anchor"]')).toHaveCount(0);
});
