'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/i18n/format';

/**
 * FR-92 (spec 10): editing a balance while the person has pending requests of
 * that type. Not blocking: approval simply uses whatever balance is set then.
 */
export function PendingBalanceWarning({ count, typeName }: { count: number; typeName: string }) {
  const t = useTranslations('manage.employees');
  const locale = useLocale();
  if (count === 0) return null;
  return (
    <p
      role="note"
      className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
      data-testid="pending-balance-warning"
    >
      {t('pendingWarning', { count, countText: formatNumber(count, locale), type: typeName })}
    </p>
  );
}
