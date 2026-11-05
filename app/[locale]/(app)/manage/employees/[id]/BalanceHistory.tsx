'use client';

/**
 * FR-85: the person's full balance ledger, loaded the first time it is opened.
 * A <details>, not a button: the leave part of the form can sit in a disabled
 * fieldset (read-only viewers), and a <summary> still opens there.
 */

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { getLeaveHistory, type LedgerHistoryRow } from '@/lib/actions/leave/balances';
import type { BalanceItem } from '@/lib/leave/balances';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { formatPersianConsentTimestamp } from '@/lib/i18n/format';

/** The fixed note set_leave_balance writes. */
const HAND_EDIT_NOTE = 'admin balance set';

export function BalanceHistory({ employeeId, balances, hoursPerDay }: {
  employeeId: string;
  balances: BalanceItem[];
  hoursPerDay: number;
}) {
  const t = useTranslations('manage.employees.quickAdd');
  const tLeave = useTranslations('leave');
  const locale = useLocale();
  const [rows, setRows] = useState<LedgerHistoryRow[] | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const duration = (minutes: number) => formatDuration(minutes, hoursPerDay, locale, durationLabelsFrom(tLeave));

  const load = () => {
    setError('');
    startTransition(async () => {
      const result = await getLeaveHistory(employeeId);
      if (result.ok) setRows(result.rows);
      else setError(result.error);
    });
  };

  const typeName = (id: string) => {
    const type = balances.find((b) => b.leaveTypeId === id);
    return type ? (locale === 'fa' ? type.name_fa : type.name_en ?? type.name_fa) : '';
  };
  const entryLabel = (r: LedgerHistoryRow) => {
    if (r.quickAdd) return t('entry.quickAdd');
    if (r.entryType === 'adjustment' && r.note === HAND_EDIT_NOTE) return t('entry.handEdit');
    if (r.entryType === 'allocation') return r.periodMonth ? t('entry.accrual') : t('entry.allocation');
    if (r.entryType === 'consumption') return t('entry.consumption');
    if (r.entryType === 'reversal') return t('entry.reversal');
    if (r.entryType === 'carryover_forfeit') return t('entry.forfeit');
    return t('entry.adjustment');
  };

  return (
    <details className="group text-sm" data-testid="balance-history"
      onToggle={(e) => { if (e.currentTarget.open && rows === null && !pending) load(); }}>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-md py-1 text-muted-foreground hover:text-foreground">
        <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        <span className="group-open:hidden">{t('showHistory')}</span>
        <span className="hidden group-open:inline">{t('hideHistory')}</span>
      </summary>
      <div className="mt-2 space-y-2">
        {pending && <p className="text-muted-foreground">{t('loading')}</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {rows?.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}
        {rows && rows.length > 0 && (
          <ol className="divide-y divide-border rounded-lg border border-border bg-background">
            {rows.map((r) => (
              <li key={r.id} className="space-y-0.5 px-3 py-2" data-testid="balance-history-row">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{entryLabel(r)} · {typeName(r.leaveTypeId)}</span>
                  <span className="tabular-nums" dir="auto">
                    {r.deltaMinutes > 0 ? '+' : ''}{duration(r.deltaMinutes)}
                  </span>
                </div>
                {r.quickAdd && r.note && <p className="text-start" dir="auto">{r.note}</p>}
                <p className="text-xs text-muted-foreground">
                  {formatPersianConsentTimestamp(r.at, locale)}
                  {r.byName && <> · <bdi>{r.byName}</bdi></>}
                  {r.requestSerial && (
                    <> · <span dir="ltr">{formatSerialLocalized(r.requestSerial.year, r.requestSerial.seq, locale)}</span></>
                  )}
                  {' · '}{t('balanceAfter', { balance: duration(r.balanceAfterMinutes) })}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
