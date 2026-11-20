/**
 * ERP › Sales record files (CEO feedback round 1). Throwaway 999… users and a throwaway role
 * pair; the local database holds the real roster. User A (sales edit) uploads on Received,
 * user B (sales read) sees and downloads the same bytes but cannot delete, A deletes it, and
 * a 50 MB + 1 byte file is refused in the browser before any request is sent.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ADMIN_CODE, ADMIN_PASSWORD, createEmployee, login } from './_helpers';
import { createBidRecord, createSalesReadRole, createSalesRole, deleteRoleIfPresent } from './_sales';

test('sales files: upload, a reader downloads it, only the uploader deletes, 50 MB + 1 is refused', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const tag = String(Date.now() % 100000);
  let editRole: string | null = null;
  let readRole: string | null = null;
  try {
    await login(page, ADMIN_CODE, ADMIN_PASSWORD);
    editRole = await createSalesRole(page, `E2E Sales Edit ${tag}`, ['sales']);
    readRole = await createSalesReadRole(page, `E2E Sales Read ${tag}`);
    const a = await createEmployee(page, { name: 'E2E Sales Uploader', roles: ['employee', editRole] });
    const b = await createEmployee(page, { name: 'E2E Sales Reader', roles: ['employee', readRole] });

    const ctxA = await browser.newContext({ acceptDownloads: true });
    const pa = await ctxA.newPage();
    await login(pa, a.code, a.password);
    const recordId = await createBidRecord(pa, `E2E files ${tag}`);

    // A uploads rfp.pdf on the current (Received) stage.
    const bytes = Buffer.from(`%PDF-1.4 e2e ${tag} `.repeat(400));
    await pa.getByTestId('sales-record-tab-files').click();
    await expect(pa.getByTestId('sales-files')).toBeVisible();
    await pa.getByTestId('sales-files-upload-input').setInputFiles({ name: 'rfp.pdf', mimeType: 'application/pdf', buffer: bytes });
    const row = pa.getByTestId('sales-file-row').filter({ hasText: 'rfp.pdf' });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row.getByTestId('sales-file-delete')).toBeVisible();

    // B sees it and downloads identical bytes; no Delete for B.
    const ctxB = await browser.newContext({ acceptDownloads: true });
    const pb = await ctxB.newPage();
    await login(pb, b.code, b.password);
    await pb.goto(`/sales/${recordId}`);
    await pb.getByTestId('sales-record-tab-files').click();
    const rowB = pb.getByTestId('sales-file-row').filter({ hasText: 'rfp.pdf' });
    await expect(rowB).toHaveCount(1, { timeout: 30_000 });
    await expect(pb.getByTestId('sales-files-upload')).toHaveCount(0);
    await expect(pb.getByTestId('sales-file-delete')).toHaveCount(0);
    const [download] = await Promise.all([pb.waitForEvent('download'), rowB.getByTestId('sales-file-download').click()]);
    expect(download.suggestedFilename()).toBe('rfp.pdf');
    const path = await download.path();
    expect(readFileSync(path).equals(bytes)).toBe(true);

    // A: a file over 50 MB is refused in the browser (no upload request is sent).
    let posted = false;
    pa.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/sales/files')) posted = true; });
    await pa.getByTestId('sales-files-upload-input').setInputFiles({
      name: 'huge.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(52_428_800 + 1),
    });
    const progress = pa.getByTestId('sales-files-progress');
    await expect(progress).toContainText('huge.bin');
    await expect(progress).toContainText('۵۰'); // the Farsi size message names the 50 MB limit
    expect(posted).toBe(false);
    await expect(pa.getByTestId('sales-file-row').filter({ hasText: 'huge.bin' })).toHaveCount(0);

    // A deletes rfp.pdf.
    await row.getByTestId('sales-file-delete').click();
    await pa.getByTestId('sales-confirm').click();
    await expect(pa.getByTestId('sales-file-row').filter({ hasText: 'rfp.pdf' })).toHaveCount(0, { timeout: 30_000 });
    await pb.reload();
    await pb.getByTestId('sales-record-tab-files').click();
    await expect(pb.getByTestId('sales-file-row')).toHaveCount(0);
    await ctxA.close();
    await ctxB.close();
  } finally {
    await deleteRoleIfPresent(page, editRole).catch((e) => console.warn('role cleanup failed:', e));
    await deleteRoleIfPresent(page, readRole).catch((e) => console.warn('role cleanup failed:', e));
  }
});
