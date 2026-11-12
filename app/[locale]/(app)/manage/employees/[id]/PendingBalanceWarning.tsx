'use client';

import { useTranslations } from 'next-intl';

/**
 * FR-92 (spec 10): editing a balance while the person has pending requests of
 * that type. Not blocking: approval simply uses whatever balance is set then.
 */
export function PendingBalanceWarning({ count, typeName }: { count: number; typeName: string }) {
  const t = useTranslations('manage.employees');
  if (count === 0) return null;
  return (
    <p
      role="note"
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700"
      data-testid="pending-balance-warning"
    >
      {t('pendingWarning', { count, type: typeName })}
    </p>
  );
}
