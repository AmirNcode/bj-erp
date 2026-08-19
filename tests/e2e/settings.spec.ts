import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee } from './_helpers';

test('profile settings persist, language switches locale, logout clears session', async ({ page }) => {
  test.setTimeout(120_000);
  const ts = Date.now();

  // Create a throwaway employee and log in as them.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const { code, password } = await createEmployee(page, { name: `Set ${ts}`, roles: ['employee'] });
  await logout(page);
  await login(page, code, password);

  await page.goto('/profile');
  // Persian is the only calendar; the old preference selector is gone.
  await expect(page.locator('[data-testid="settings-calendar"]')).toHaveCount(0);
  await expect(page.getByText(/Gregorian|میلادی/)).toHaveCount(0);

  // Language -> English: URL gains the /en prefix; <html> flips to en/ltr.
  await page.locator('[data-testid="settings-language"]').selectOption('en');
  await expect(page).toHaveURL(/\/en\/profile$/, { timeout: 10_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  // The request form follows the language preference, including native select options.
  await page.goto('/en/request');
  await expect(page).toHaveURL(/\/en\/request$/, { timeout: 10_000 });
  await expect(page.locator('#leave_type_id')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#leave_type_id')).toContainText('Annual Leave');
  await expect(page.locator('#leave_type_id')).not.toContainText('مرخصی استحقاقی');

  // FR-34 — the reported bug: the language chosen here must survive entering the
  // app at a URL that carries no locale. Before the fix, `language_pref` was
  // stored but never read for routing, so any unprefixed URL resolved to Farsi
  // and Settings could show English while the app rendered Persian.
  //
  // The bare root is the important one: manifest.ts sets `start_url: '/'`, so
  // this is exactly what the installed PWA opens on every launch.
  await page.goto('/');
  await expect(page).toHaveURL(/\/en\/home$/, { timeout: 10_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // An unprefixed deep link (an old bookmark, a shared URL) behaves the same.
  await page.goto('/request');
  await expect(page).toHaveURL(/\/en\/request$/, { timeout: 10_000 });
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  // Switching back must be equally sticky, and must NOT leave the user stranded
  // on the /en prefix.
  await page.goto('/en/profile');
  await page.locator('[data-testid="settings-language"]').selectOption('fa');
  await expect(page).toHaveURL(/\/profile$/, { timeout: 10_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await page.goto('/');
  await expect(page).toHaveURL(/\/home$/, { timeout: 10_000 });
  await expect(page).not.toHaveURL(/\/en\//);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // Switching to English and back again, so the round trip is covered in both
  // directions.
  await page.goto('/profile');
  await page.locator('[data-testid="settings-language"]').selectOption('en');
  await expect(page).toHaveURL(/\/en\/profile$/, { timeout: 10_000 });

  // ── Restore the shared account to Farsi before finishing ──────────────────
  //
  // MANDATORY, and the reason is not tidiness. Since FR-34 the stored
  // `language_pref` decides the locale for any URL without a prefix, and this
  // spec drives the SHARED demo admin. Seventeen other specs assert Farsi text on
  // unprefixed URLs, so leaving this account on English makes every one of them
  // depend on run order — `department.spec` and `hourly.spec` both failed exactly
  // this way, expecting Farsi and getting English, with nothing in their own code
  // at fault. A `/fa/...` prefix is NOT an escape hatch either: next-intl
  // normalises it away before the app sees it, so the preference still wins.
  await page.locator('[data-testid="settings-language"]').selectOption('fa');
  await expect(page).toHaveURL(/\/profile$/, { timeout: 10_000 });
  await expect(page).not.toHaveURL(/\/en\//);

  // Logout asks for confirmation first; cancelling keeps the session.
  await page.goto('/profile');
  await page.locator('[data-testid="settings-logout"]').click();
  await expect(page.locator('[data-testid="logout-confirm"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="logout-cancel"]').click();
  await expect(page.locator('[data-testid="logout-confirm"]')).toBeHidden();
  await expect(page).toHaveURL(/\/profile$/);

  // Confirming logs out and returns to the login page.
  await page.locator('[data-testid="settings-logout"]').click();
  await page.locator('[data-testid="logout-confirm"]').click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
});
