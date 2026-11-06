'use client';

/** FR-85: what makes up a balance that holds quick adds, and why they were added. */

import { useLocale, useTranslations } from 'next-intl';
import { balanceBreakdown, type QuickAddRow } from '@/lib/leave/balanceBreakdown';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatPersianConsentTimestamp } from '@/lib/i18n/format';

export function BalanceBreakdownLines({ balanceMinutes, leaveTypeId, quickAdds, hoursPerDay, testId }: {
  balanceMinutes: number;
  leaveTypeId: string;
  quickAdds: QuickAddRow[];
  hoursPerDay: number;
  testId: string;
}) {
  const t = useTranslations('manage.employees.quickAdd');
  const tLeave = useTranslations('leave');
  const locale = useLocale();
  const breakdown = balanceBreakdown(balanceMinutes, quickAdds, leaveTypeId);
  if (!breakdown) return null;
  const duration = (minutes: number) => formatDuration(minutes, hoursPerDay, locale, durationLabelsFrom(tLeave));

  return (
    <div className="space-y-1 text-xs text-muted-foreground" data-testid={testId}>
      <p className="font-medium text-foreground">
        {t('total', {
          total: duration(balanceMinutes),
          other: duration(breakdown.otherMinutes),
          added: duration(breakdown.addedMinutes),
        })}
      </p>
      <ul className="space-y-0.5">
        {breakdown.rows.map((r) => (
          <li key={r.id} dir="auto" className="text-start">
            +{duration(r.minutes)} · {formatPersianConsentTimestamp(r.at, locale)}
            {r.byName && <> · <bdi>{r.byName}</bdi></>}: {r.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
