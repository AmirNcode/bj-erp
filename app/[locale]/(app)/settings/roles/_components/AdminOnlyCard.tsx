'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * D2: what no role can ever hold, shown read-only under the matrix so the admin
 * sees the whole picture. Hours per working day joined the list with main's
 * FR-62/66 work_settings trigger.
 */
export function AdminOnlyCard() {
  const t = useTranslations('rolesAdmin.adminOnly');
  // Explicit keys, not a loop over t.raw(): each line is checked against both message files.
  const items = [
    t('items.roleEditor'),
    t('items.adminTransfer'),
    t('items.approvalOverride'),
    t('items.bulkImport'),
    t('items.auditLog'),
    t('items.devTools'),
    t('items.hoursPerDay'),
  ];
  return (
    <section className="rounded-xl border bg-muted/40 px-4 py-3" data-testid="admin-only-card">
      <h2 className="flex items-center gap-2 font-semibold">
        <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
        {t('title')}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t('intro')}</p>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
        {items.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
