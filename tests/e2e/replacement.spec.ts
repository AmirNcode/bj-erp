import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  createEmployee,
  allocate,
  fillPicker,
  jalali2DayRange,
} from './_helpers';

/**
 * FR-28 replacement / cover person, end to end.
 *
 * Proves the three things only a browser plus a database can:
 *   1. naming a colleague submits and shows on the request,
 *   2. the named person sees "you are covering" on Home (D15 — no consent gate,
 *      but never a surprise),
 *   3. once that colleague has approved leave over the same dates, they are
 *      offered as UNAVAILABLE rather than quietly dropped from the list (D14).
 *
 * createEmployee always picks the first department, so both employees land in the
 * same one — which is what makes them each other's candidates.
 */
test('replacement: name a colleague, they see it, and they become unavailable when away', async ({
  page,
}) => {
  test.setTimeout(360_000); // cold `next dev` compiles each route on first hit

  const range = jalali2DayRange();
  const [firstDay] = range.split(' — ');

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const a = await createEmployee(page, { name: 'Cover Requester', roles: ['employee'] });
  const b = await createEmployee(page, { name: 'Cover Person', roles: ['employee'] });
  await allocate(page, a.code, 5);
  await allocate(page, b.code, 5);
  await logout(page);

  // ── A files a request naming B as cover ───────────────────────────────────
  await login(page, a.code, a.password);
  await page.goto('/request');
  await expect(page.locator('[data-testid="replacement-picker"]')).toBeVisible({ timeout: 20_000 });

  await page.selectOption('#leave_type_id', { index: 1 });
  await fillPicker(page, range);

  // The candidate list loads once the dates are known.
  const picker = page.locator('[data-testid="replacement-select"]');
  await expect(picker.locator('option', { hasText: 'Cover Person' })).toBeAttached({
    timeout: 20_000,
  });
  // selectOption's label must be an exact string, so read the option's value.
  const bValue = await picker
    .locator('option')
    .filter({ hasText: 'Cover Person' })
    .getAttribute('value');
  await picker.selectOption(bValue!);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="success-msg"]')).toBeVisible({ timeout: 20_000 });

  // A's own request row names the cover.
  await expect(page.getByText('Cover Person').first()).toBeVisible({ timeout: 20_000 });
  await logout(page);

  // ── B sees it on Home, and books the same dates off ───────────────────────
  await login(page, b.code, b.password);
  await expect(page.locator('[data-testid="home-covering"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="home-covering"]')).toContainText('Cover Requester');

  await page.goto('/request');
  await page.selectOption('#leave_type_id', { index: 1 });
  await fillPicker(page, range);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="success-msg"]')).toBeVisible({ timeout: 20_000 });
  await logout(page);

  // ── A tries again: B is offered, but marked unavailable, not hidden ───────
  await login(page, a.code, a.password);
  await page.goto('/request');
  await page.selectOption('#leave_type_id', { index: 1 });
  await fillPicker(page, firstDay + ' — ' + firstDay);

  const bOption = page
    .locator('[data-testid="replacement-select"] option')
    .filter({ hasText: 'Cover Person' });
  await expect(bOption).toBeAttached({ timeout: 20_000 });
  // Annotated, not filtered: still listed, disabled, and says why.
  await expect(bOption).toHaveAttribute('disabled', '');
  await expect(bOption).toContainText('در مرخصی');
});
