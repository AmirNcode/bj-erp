/**
 * FR-42 — approval steps by role or named person, configurable by HR.
 *
 * Covers the configuration surface and HR's access to it. The SIGNING behaviour
 * is deliberately not exercised here: `approval_steps` is company-wide config, so
 * a spec that left an extra required step in place would make every other leave
 * spec in a serial run wait for a signature it never provides. The engine is
 * pinned instead by `tests/unit/approval-chain.test.ts`, whose expectations were
 * taken from `public.approve_leave_request` on the live database — a named
 * approver holding no role signed their step; an admin filling the chain got the
 * MANAGER step and could not complete it alone; a deactivated approver was
 * refused with "not allowed to decide this request".
 *
 * Restores the chain to the seeded manager + hr before finishing.
 *
 * Runs against `/en/...`: an explicit locale prefix beats the stored preference
 * (FR-34), so the asserted text does not depend on the demo admin's language.
 */
import { test, expect } from '@playwright/test';
import { ADMIN_CODE, ADMIN_PASSWORD, login, logout, createEmployee } from './_helpers';

test('admin adds a named-person approval step; HR can configure the chain', async ({ page }) => {
  test.setTimeout(240_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);

  // A person to name, and an HR user to check access with.
  const subject = await createEmployee(page, { name: 'Chain Signer', roles: ['employee'] });
  const hrUser = await createEmployee(page, { name: 'Chain HR', roles: ['hr'] });

  await page.goto('/en/manage/settings');
  const card = page.locator('[data-testid="approval-steps-card"]');
  await expect(card).toBeVisible({ timeout: 30_000 });

  // The seeded chain, and the Add button below it.
  await expect(page.locator('[data-testid="approval-step-manager"]')).toBeVisible();
  await expect(page.locator('[data-testid="approval-step-hr"]')).toBeVisible();

  // ── 1. Add a step naming one specific person ──────────────────────────────
  await page.click('[data-testid="approval-step-add-open"]');
  await page.locator('[data-testid="approval-step-kind"]').selectOption('person');
  await page.fill('[data-testid="approval-step-person-search"]', 'Chain Signer');

  const results = page.locator('[data-testid="approval-step-person-results"]');
  await expect(results).toBeVisible({ timeout: 20_000 });
  await results.locator('button').first().click();
  await expect(page.locator('[data-testid="approval-step-person-selected"]')).toContainText(
    'Chain Signer'
  );

  await page.fill('[data-testid="approval-step-new-order"]', '3');
  await page.locator('[data-testid="approval-step-add-confirm"]').press('Enter');

  // The row shows the person's NAME, not a role.
  const personRow = card.locator('li', { hasText: 'Chain Signer' });
  await expect(personRow).toBeVisible({ timeout: 20_000 });

  // It survives a reload — proof the write landed, not just that the form said so.
  await page.reload();
  await expect(
    page.locator('[data-testid="approval-steps-card"]').locator('li', { hasText: 'Chain Signer' })
  ).toBeVisible({ timeout: 20_000 });

  // ── 2. HR reaches Settings, and sees ONLY the approval chain ──────────────
  await logout(page);
  await login(page, hrUser.code, hrUser.password);
  await page.goto('/en/manage/settings');

  await expect(page.locator('[data-testid="approval-steps-card"]')).toBeVisible({
    timeout: 30_000,
  });
  // Work settings, holidays and departments stay admin-only and are not rendered.
  await expect(page.locator('[data-testid="work-settings"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="holiday-editor"]')).toHaveCount(0);
  // The order switch writes work_settings, which is still admin-only, so HR sees
  // it disabled rather than getting a database error on click.
  await expect(page.locator('[data-testid="approval-order-enforced"]')).toBeDisabled();
  // ...but HR can add a step, which is the point of FR-42.
  await expect(page.locator('[data-testid="approval-step-add-open"]')).toBeEnabled();

  // ── 3. Restore: remove the added step ─────────────────────────────────────
  await logout(page);
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/en/manage/settings');
  const row = page
    .locator('[data-testid="approval-steps-card"]')
    .locator('li', { hasText: 'Chain Signer' });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('button', { hasText: 'Remove' }).click();
  await page.locator('[data-testid^="approval-step-delete-confirm-"]').click();
  await expect(
    page.locator('[data-testid="approval-steps-card"]').locator('li', { hasText: 'Chain Signer' })
  ).toHaveCount(0, { timeout: 20_000 });

  // The seeded chain is back to exactly what it was.
  await page.reload();
  await expect(page.locator('[data-testid="approval-steps-card"] li')).toHaveCount(2, {
    timeout: 20_000,
  });

  void subject;
});
