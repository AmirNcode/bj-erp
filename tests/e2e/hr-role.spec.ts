import { test, expect, type Page } from '@playwright/test';
import {
  ADMIN_CODE,
  ADMIN_PASSWORD,
  login,
  logout,
  createEmployee,
  allocate,
  submitLeave,
  signApproval,
} from './_helpers';


/**
 * Point an employee at a manager, via the admin edit screen.
 *
 * A THIRD copy of this — approval.spec.ts:91 and errand.spec.ts:33 have their
 * own, and they differ (10s vs 20s timeouts, plus an extra saved-banner
 * assertion). Promoting one to _helpers.ts would silently change the other
 * spec's behaviour, so it is duplicated here deliberately rather than as an
 * oversight. Worth consolidating as its own small change, with a full run.
 */
async function setManager(page: Page, employeeCode: string, managerCodeSubstring: string) {
  await page.goto('/manage/employees');
  const row = page.locator('tr', { hasText: employeeCode });
  await expect(row.first()).toBeVisible({ timeout: 20_000 });
  await row.first().locator('a').first().click();
  await expect(page).toHaveURL(/\/manage\/employees\/[0-9a-f-]+$/, { timeout: 20_000 });

  const mgrSelect = page.locator('#manager_id');
  await expect(mgrSelect).toBeVisible({ timeout: 20_000 });
  let mgrValue = '';
  for (const opt of await mgrSelect.locator('option').all()) {
    const text = await opt.textContent();
    if (text?.includes(managerCodeSubstring)) {
      mgrValue = (await opt.getAttribute('value')) ?? '';
      break;
    }
  }
  expect(mgrValue).not.toBe('');
  await mgrSelect.selectOption({ value: mgrValue });
  await page.click('button[type="submit"]');
  await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 20_000 });
}

/**
 * FR-35 — the `hr` role, batch 2: it exists, it reaches /manage, it reads
 * company-wide, and it stops at the doors it is not meant to open.
 *
 * The boundary is the whole point of this spec. `hr` is a new role with broad
 * read access, so what it CANNOT do is worth more test coverage than what it
 * can. Creating employees (FR-35 part 2), co-signing (FR-36) and reports
 * (FR-37) arrive in later batches and are not asserted here.
 *
 * Throwaway users come from the reserved 999####### range so globalTeardown /
 * `npm run cleanup:e2e` reaps them.
 */
test('hr role: reaches Manage and reads company-wide, but not admin-only config', async ({
  page,
}) => {
  test.setTimeout(300_000); // cold `next dev` compiles each route on first hit

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);

  // DIFFERENT departments, and that is load-bearing. `profiles_select` grants a
  // read via `same_team` OR `can_read_all`; put both users in one department and
  // this test passes even with the migration reverted, proving nothing. Verified
  // the hard way — the first version of this spec did exactly that.
  const other = await createEmployee(page, {
    name: 'HR Subject',
    roles: ['employee'],
    departmentIndex: 0,
  });
  const hr = await createEmployee(page, {
    name: 'HR Officer',
    roles: ['hr'],
    departmentIndex: 1,
  });
  await logout(page);

  await login(page, hr.code, hr.password);

  // The Manage tab is offered at all — it was not, before this batch.
  await expect(page.locator('[data-testid="nav-manage"]')).toBeVisible({ timeout: 20_000 });

  // …and the door actually opens, rather than bouncing back to /home.
  await page.locator('[data-testid="nav-manage"]').click();
  await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 20_000 });

  // Company-wide read: an employee HR has no relationship with is listed.
  // This is `can_read_all` gaining 'hr'; without the migration the list is empty.
  // `.first()` because the page renders every row twice — a desktop table and a
  // mobile card — so a bare text match is a strict-mode violation, not a bug.
  await expect(page.getByText('HR Subject').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(other.code).first()).toBeVisible();

  // ── the boundaries ────────────────────────────────────────────────────────
  //
  // CHANGED BY FR-42: /manage/settings no longer bounces HR, because HR now
  // configures the approval chain. The boundary did not disappear, it moved
  // INSIDE the page — HR gets the approval card and nothing else, and the
  // admin-only cards are not rendered at all rather than merely hidden by CSS.
  // Asserting their absence is what keeps this a real boundary test.
  await page.goto('/manage/settings');
  await expect(page.locator('[data-testid="approval-steps-card"]')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('[data-testid="work-settings"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="holiday-editor"]')).toHaveCount(0);

  await page.goto('/manage/allocations');
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });

  // Departments are company-wide config too; admins only.
  await page.goto('/manage/departments/new');
  await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 20_000 });

  // Onboarding controls ARE offered to hr (FR-35 D4). Asserted on real testids:
  // an earlier version of this test looked for `dept-add-employee`, which does
  // not exist on this page at all, so it passed no matter what the code did.
  await page.goto('/manage/employees');
  await expect(page.locator('[data-testid="add-employee-link"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="import-link"]')).toHaveCount(1);
});

test('a plain employee still cannot reach Manage', async ({ page }) => {
  test.setTimeout(300_000);

  // Guards the inverse of the change above: widening canManage for `hr` must not
  // have widened it for everyone.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const worker = await createEmployee(page, {
    name: 'HR Negative',
    roles: ['employee'],
  });
  await logout(page);

  await login(page, worker.code, worker.password);
  await expect(page.locator('[data-testid="nav-manage"]')).toHaveCount(0);
  await page.goto('/manage/employees');
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
});

/**
 * FR-38 — HR reviews every request and prints the paper-equivalent form.
 *
 * The two things the owner asked for are asserted directly: HR can see a request
 * belonging to someone in another department (so `same_team` cannot be what
 * granted it), including the requester's signature IMAGE; and the printed sheet
 * is the right one of the client's forms with the right four signature boxes.
 */
test('hr reviews a company-wide request and prints its paper form', async ({ page }) => {
  test.setTimeout(300_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const worker = await createEmployee(page, {
    name: 'Print Subject',
    roles: ['employee'],
    departmentIndex: 0,
  });
  await allocate(page, worker.code, 5);
  const hr = await createEmployee(page, {
    name: 'Print Officer',
    roles: ['hr'],
    departmentIndex: 1, // different department — see the note in the first test
  });
  await logout(page);

  // The worker files a daily leave request, signing it.
  await login(page, worker.code, worker.password);
  const typeValue = await page
    .goto('/request')
    .then(() => page.locator('#leave_type_id option').nth(1).getAttribute('value'));
  await submitLeave(page, {
    leaveTypeValue: typeValue!,
    reason: 'HR print probe reason',
  });
  await logout(page);

  // HR finds it on the review screen.
  await login(page, hr.code, hr.password);
  await page.goto('/manage/requests');
  await expect(page.locator('[data-testid="requests-review"]')).toBeVisible({ timeout: 20_000 });
  await page.fill('[data-testid="review-search"]', 'Print Subject');
  const row = page.locator('[data-testid^="review-row-"]').first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  // The requester's signature is recorded and shown as such.
  await expect(row.locator('[data-testid^="review-signed-requester-"]')).toBeVisible();

  // Filtering by a status the request does not have empties the list — proves
  // the filter does something rather than always rendering everything.
  await page.selectOption('[data-testid="review-status"]', 'rejected');
  await expect(page.locator('[data-testid^="review-row-"]')).toHaveCount(0);
  await page.selectOption('[data-testid="review-status"]', 'pending');
  await expect(page.locator('[data-testid^="review-row-"]').first()).toBeVisible();

  // Open the printable form directly (the row's link opens a new tab).
  const requestId = (await row.getAttribute('data-testid'))!.replace('review-row-', '');
  await page.goto(`/print/request/${requestId}`);

  const form = page.locator('[data-testid="print-form"]');
  await expect(form).toBeVisible({ timeout: 20_000 });
  // Daily leave must print BJ-F 50210, not the hourly or errand form.
  await expect(form).toHaveAttribute('data-form-code', 'BJ-F 50210(R0)');
  await expect(page.locator('[data-testid="print-body-leave"]')).toBeVisible();

  // All four boxes from the photographed 50210, including جانشین and no حراست.
  await expect(page.locator('[data-testid="print-box-requester"]')).toBeVisible();
  await expect(page.locator('[data-testid="print-box-replacement"]')).toBeVisible();
  await expect(page.locator('[data-testid="print-box-approver"]')).toBeVisible();
  await expect(page.locator('[data-testid="print-box-hrManager"]')).toBeVisible();
  await expect(page.locator('[data-testid="print-box-security"]')).toHaveCount(0);

  // HR can see the actual signature image, not merely that one exists.
  await expect(page.locator('[data-testid="print-signature-requester"]')).toBeVisible();
  // Unapproved, so the approver box prints empty for a wet signature.
  await expect(page.locator('[data-testid="print-signature-approver"]')).toHaveCount(0);

  // The HR balance line is 50210-only.
  await expect(page.locator('[data-testid="print-balance-line"]')).toBeVisible();

  // The private reason is on the sheet — that is the point of FR-38, and the
  // migration that allows it is a deliberate FR-25 widening.
  await expect(form).toContainText('HR print probe reason');
});

test('an employee cannot reach the HR review screen or a colleague’s printed form', async ({
  page,
}) => {
  test.setTimeout(300_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const owner = await createEmployee(page, {
    name: 'Print Owner',
    roles: ['employee'],
    departmentIndex: 0,
  });
  await allocate(page, owner.code, 5);
  const stranger = await createEmployee(page, {
    name: 'Print Stranger',
    roles: ['employee'],
    departmentIndex: 1,
  });
  await logout(page);

  await login(page, owner.code, owner.password);
  const typeValue = await page
    .goto('/request')
    .then(() => page.locator('#leave_type_id option').nth(1).getAttribute('value'));
  await submitLeave(page, { leaveTypeValue: typeValue!, reason: 'Not for strangers' });
  await page.goto('/manage/requests');
  // Not even the outer /manage door opens for a plain employee.
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
  await logout(page);

  // A colleague in another department gets the not-found page, not the form —
  // RLS returns no row, so nothing leaks, not even that the request exists.
  await login(page, stranger.code, stranger.password);
  await page.goto('/manage/requests');
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
});

/**
 * FR-35 D4 — HR onboards into any department, but only ever plain employees.
 *
 * SCOPE OF THIS TEST, precisely: it covers the UI path — that HR gets the
 * department and manager pickers, gets no role/allocation/policy controls, and
 * that the account it produces is a plain employee.
 *
 * It does NOT prove the role clamp in `app_create_employee`, and cannot: HR's
 * form has no role checkboxes, so it never sends `p_roles` and the default
 * (`{employee}`) would be used even if the clamp were deleted. The clamp was
 * verified separately by calling the RPC directly as an HR user with
 * `p_roles => array['admin','manager']` inside a rolled-back transaction, which
 * returned exactly `employee` and audited the path as `hr` — see
 * docs/AGENT-LOG.md 2026-08-18. Anyone touching that branch should re-run it.
 */
test('hr creates an employee in another department, and cannot grant a role', async ({ page }) => {
  test.setTimeout(300_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const hr = await createEmployee(page, {
    name: 'HR Recruiter',
    roles: ['hr'],
    departmentIndex: 0,
  });
  await logout(page);

  await login(page, hr.code, hr.password);
  await page.goto('/manage/employees/new');
  await expect(page).toHaveURL(/\/manage\/employees\/new$/, { timeout: 20_000 });

  // HR picks the department — a manager cannot, and sees a locked label instead.
  await expect(page.locator('#department_id')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="dept-locked"]')).toHaveCount(0);
  await expect(page.locator('#manager_id')).toBeVisible();
  await expect(page.locator('[data-testid="mgr-locked"]')).toHaveCount(0);

  // No role checkboxes — granting a role stays admin-only, and this is the
  // boundary that has NOT moved: `app_create_employee` clamps an HR caller's role
  // list to {employee} in the database (FR-35 D4).
  await expect(page.locator('input[type="checkbox"][value="admin"]')).toHaveCount(0);

  // CHANGED BY FR-43: the allocation and accrual-policy fields ARE offered to HR
  // now. They were hidden only because `allocate_leave` and
  // `set_employee_leave_policy` were admin-only in the database, so a form
  // showing them would have failed on submit; both admit hr since
  // 20260819120001, and the fields moved with them.
  await expect(page.locator('[data-testid="alloc-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="policy-section"]')).toBeVisible();
  // ...so the "defaults are applied automatically" hint is gone: HR types the
  // real numbers in, and telling them defaults apply would contradict that.
  await expect(page.locator('[data-testid="default-quota-hint"]')).toHaveCount(0);

  // Create into the SECOND department — proving "any department", not "my own".
  const hire = await createEmployee(page, {
    name: 'HR Hire',
    roles: [], // no role controls exist on HR's form; the database decides
    departmentIndex: 1,
  });
  await logout(page);

  // The new account works, and is a plain employee: no Manage tab.
  await login(page, hire.code, hire.password);
  await expect(page.locator('[data-testid="nav-manage"]')).toHaveCount(0);
  await logout(page);

  // And an admin sees exactly one role on it.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  await page.goto('/manage/employees');
  await page.waitForLoadState('networkidle');
  const row = page.getByText('HR Hire').first();
  await expect(row).toBeVisible({ timeout: 20_000 });
});

/**
 * FR-36 — the approval chain, end to end.
 *
 * The contract that matters and that only a real run can prove: a manager's
 * signature alone changes NOTHING. The request stays pending and the balance is
 * untouched until HR signs too, and the ledger is then debited exactly once.
 */
test('a request needs both the manager and HR before it is approved', async ({ page }) => {
  test.setTimeout(300_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const mgr = await createEmployee(page, {
    name: 'Chain Manager',
    roles: ['manager'],
    departmentIndex: 0,
  });
  const emp = await createEmployee(page, {
    name: 'Chain Worker',
    roles: ['employee'],
    departmentIndex: 0,
  });
  await setManager(page, emp.code, mgr.code);
  const ltValue = await allocate(page, emp.code, 20);
  const hr = await createEmployee(page, {
    name: 'Chain Officer',
    roles: ['hr'],
    departmentIndex: 1,
  });
  await logout(page);

  // Worker files a two-day request.
  await login(page, emp.code, emp.password);
  await submitLeave(page, { leaveTypeValue: ltValue, reason: 'chain e2e' });
  await logout(page);

  // ── the manager signs ─────────────────────────────────────────────────────
  await login(page, mgr.code, mgr.password);
  await page.goto('/manage/approvals');
  const btn = page.locator('[data-testid^="approve-btn-"]').first();
  await expect(btn).toBeVisible({ timeout: 20_000 });
  const reqId = (await btn.getAttribute('data-testid'))!.replace('approve-btn-', '');

  // The queue shows the whole chain, not just "pending".
  await expect(page.locator(`[data-testid="chain-${reqId}-manager"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="chain-${reqId}-hr"]`)).toBeVisible();

  await btn.click();
  const confirm = page.locator(`[data-testid="approve-confirm-${reqId}"]`);
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await signApproval(page);
  await confirm.click();
  await expect(btn).toHaveCount(0, { timeout: 20_000 });
  await logout(page);

  // ── the request is STILL PENDING and the balance is untouched ─────────────
  await login(page, emp.code, emp.password);
  await page.goto('/request');
  await expect(
    page.locator(`[data-testid^="status-badge-"]`).first()
  ).toContainText(/pending|انتظار/i, { timeout: 20_000 });
  await logout(page);

  // ── HR signs, which completes the chain ───────────────────────────────────
  await login(page, hr.code, hr.password);
  await page.goto('/manage/approvals');
  const hrBtn = page.locator(`[data-testid="approve-btn-${reqId}"]`);
  await expect(hrBtn).toBeVisible({ timeout: 20_000 });
  // The manager's step already reads as signed on HR's copy of the queue.
  await expect(page.locator(`[data-testid="chain-${reqId}-manager"]`)).toContainText('✓');
  await hrBtn.click();
  const hrConfirm = page.locator(`[data-testid="approve-confirm-${reqId}"]`);
  await expect(hrConfirm).toBeVisible({ timeout: 10_000 });
  await signApproval(page);
  await hrConfirm.click();
  await expect(hrBtn).toHaveCount(0, { timeout: 20_000 });

  // ── now it is approved, and the printed form carries BOTH signatures ──────
  await page.goto(`/print/request/${reqId}`);
  await expect(page.locator('[data-testid="print-form"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="print-signature-requester"]')).toBeVisible();
  await expect(page.locator('[data-testid="print-signature-approver"]')).toBeVisible();
  await expect(page.locator('[data-testid="print-signature-hrManager"]')).toBeVisible();
  await logout(page);

  await login(page, emp.code, emp.password);
  await page.goto('/request');
  await expect(
    page.locator(`[data-testid^="status-badge-"]`).first()
  ).toContainText(/approved|تایید/i, { timeout: 20_000 });
});

/**
 * FR-37 — the HR reports screen and its CSV export.
 *
 * Asserts the two things a report has to get right: it contains the employee's
 * real data (not an empty shell), and the downloaded file's header row matches
 * the columns on screen — a CSV whose header drifts from the table is worse than
 * no export, because nobody checks it before mailing it on.
 */
test('hr opens the reports screen and downloads a CSV that matches the table', async ({ page }) => {
  test.setTimeout(300_000);

  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const worker = await createEmployee(page, {
    name: 'Report Subject',
    roles: ['employee'],
    departmentIndex: 0,
  });
  await allocate(page, worker.code, 12);
  const hr = await createEmployee(page, {
    name: 'Report Officer',
    roles: ['hr'],
    departmentIndex: 1,
  });
  await logout(page);

  await login(page, hr.code, hr.password);
  await page.goto('/manage/reports');
  await expect(page.locator('[data-testid="reports-dashboard"]')).toBeVisible({ timeout: 30_000 });

  // All five reports render.
  for (const id of ['balances', 'requests', 'absence', 'ageing', 'headcount']) {
    await expect(page.locator(`[data-testid="report-${id}"]`)).toBeVisible();
  }

  // The balance report carries real data: the employee just allocated 12 days.
  const balances = page.locator('[data-testid="report-table-balances"]');
  await expect(balances).toBeVisible();
  await expect(balances).toContainText('Report Subject');

  // Headcount is never empty — there is always at least the admin.
  await expect(page.locator('[data-testid="report-table-headcount"]')).toBeVisible();

  // ── the export ────────────────────────────────────────────────────────────
  const onScreenHeaders = await balances.locator('thead th').allTextContents();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-testid="report-download-balances"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/balances\.csv$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString('utf8');

  // A UTF-8 BOM is what makes Excel read the Persian columns correctly.
  expect(csv.charCodeAt(0)).toBe(0xfeff);

  const headerLine = csv.replace(/^﻿/, '').split('\r\n')[0];
  const csvHeaders = headerLine.split(',').map((h) => h.replace(/^"|"$/g, ''));
  expect(csvHeaders).toEqual(onScreenHeaders.map((h) => h.trim()));

  // And the employee is actually in the file, not just on the screen.
  expect(csv).toContain('Report Subject');
});

test('a manager cannot reach the HR reports screen', async ({ page }) => {
  test.setTimeout(300_000);

  // A manager reaches /manage for their own approvals, but company-wide reports
  // are a different audience — this is the narrower guard on the page itself.
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const mgr = await createEmployee(page, {
    name: 'Report Manager',
    roles: ['manager'],
    departmentIndex: 0,
  });
  await logout(page);

  await login(page, mgr.code, mgr.password);
  await page.goto('/manage/employees');
  await expect(page).toHaveURL(/\/manage\/employees$/, { timeout: 20_000 });
  await expect(page.locator('[data-testid="nav-reports"]')).toHaveCount(0);
  await page.goto('/manage/reports');
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
});
