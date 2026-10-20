'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { TravelBookingRow, TravelState } from '@/lib/actions/travel';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';

/** What procurement must do next, first; finished work last. */
export const STATE_ORDER: TravelState[] = ['to_book', 'extension', 'cancel_undo', 'done', 'settled'];

export function ProcurementList({ rows, locale }: { rows: TravelBookingRow[]; locale: string }) {
  const t = useTranslations('travel');
  if (!rows.length) return <EmptyState message={t('procurementEmpty')} />;
  const dates = (r: TravelBookingRow) => r.start_date === r.end_date
    ? formatCalendarDate(r.start_date, locale)
    : `${formatCalendarDate(r.start_date, locale)} — ${formatCalendarDate(r.end_date, locale)}`;
  return (
    <div className="space-y-6">
      {STATE_ORDER.map((state) => {
        const group = rows.filter((r) => r.state === state);
        if (!group.length) return null;
        return (
          <section key={state} className="space-y-2" data-testid={`procurement-group-${state}`}>
            <h2 className="text-sm font-semibold">{t(`states.${state}`)} ({group.length})</h2>
            {group.map((r) => (
              <Link key={r.request_id} href={`/${locale}/procurement/${r.request_id}`} className="block" data-testid={`procurement-row-${r.request_id}`}>
                <Card className="transition-colors hover:bg-secondary/50">
                  <CardContent className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">{r.employee_name}</div>
                      <div className="text-sm text-muted-foreground">{r.errand_location ?? '—'} · {dates(r)}</div>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {formatSerialLocalized(r.serial_year, r.serial_seq, locale)}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </section>
        );
      })}
    </div>
  );
}
