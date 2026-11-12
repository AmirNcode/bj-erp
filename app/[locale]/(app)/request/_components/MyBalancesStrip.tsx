/**
 * The caller's leave balances in one line above the New request section:
 * "My balances  10 days and 4 hours Annual leave | 3 days Sick leave".
 * Balance types only (unpaid leave has nothing to show). A negative balance
 * (FR-92, Managers) reads in red with its minus sign kept in place in RTL.
 */

import { Wallet } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getMyBalanceUsage } from '@/lib/actions/home';
import { formatDuration, type DurationLabels } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import type { BalanceUsage } from '@/lib/home/pulse';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';

export async function MyBalancesStrip({ locale, hoursPerDay }: { locale: string; hoursPerDay: number }) {
  const [t, tLeave, res] = await Promise.all([
    getTranslations('request'),
    getTranslations('leave'),
    getMyBalanceUsage(),
  ]);
  if (!res.ok) return null;
  const items = res.usage.filter((u) => u.hasBalance);
  if (items.length === 0) return null;
  return <MyBalancesView title={t('myBalances')} items={items} labels={durationLabelsFrom(tLeave)} locale={locale} hoursPerDay={hoursPerDay} />;
}

/** Presentational: one line of balances (also used by the temporary UI check pages). */
export function MyBalancesView({ title, items, labels, locale, hoursPerDay }: {
  title: string;
  items: Pick<BalanceUsage, 'leaveTypeId' | 'name_fa' | 'name_en' | 'leftMinutes'>[];
  labels: DurationLabels;
  locale: string;
  hoursPerDay: number;
}) {
  // Sized by its own width (container query): on a phone the label hides and each
  // balance stacks its type name under the amount, so the strip stays one row.
  return (
    <div className="@container">
      <section
        aria-label={title}
        data-testid="my-balances"
        className="flex items-center gap-3 overflow-x-auto whitespace-nowrap rounded-xl border bg-card px-4 py-3 text-sm"
      >
        <span className="flex shrink-0 items-center gap-2 font-semibold text-muted-foreground">
          <Wallet aria-hidden="true" className="size-4 text-primary" />
          <span className="sr-only @xl:not-sr-only">{title}</span>
        </span>
        <ul className="flex min-w-0 items-center">
          {items.map((u, i) => (
            <li
              key={u.leaveTypeId}
              className={cn(
                'flex flex-col px-3 @xl:flex-row @xl:items-baseline @xl:gap-1.5',
                i > 0 && 'border-s border-border',
              )}
              data-testid={`my-balance-${u.leaveTypeId}`}
            >
            <bdi className={cn('font-bold', u.leftMinutes < 0 ? 'text-destructive' : 'text-foreground')}>
              {formatDuration(u.leftMinutes, hoursPerDay, locale, labels)}
            </bdi>
            <span className="text-xs text-muted-foreground @xl:text-sm">{localizedLeaveTypeName(u, locale)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
