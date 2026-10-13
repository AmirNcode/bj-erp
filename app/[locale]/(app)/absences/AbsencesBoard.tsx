'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Clock, Sun } from 'lucide-react';
import type { Absence } from '@/lib/actions/absences';
import { PersianDateField } from '@/components/PersianDateField';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { dateObjectToGregorian, gregorianToPersianDateObject } from '@/lib/leave/dateConvert';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatNumber, localizedLeaveTypeName } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';

type Props = {
  date: string;
  today: string;
  absences: Absence[];
  locale: string;
};

/** The day picker plus the list. Changing the day re-queries on the server. */
export function AbsencesBoard({ date, today, absences, locale }: Props) {
  const t = useTranslations('absences');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const go = (iso: string) =>
    startTransition(() => {
      router.replace(iso === today ? `/${locale}/absences` : `/${locale}/absences?date=${iso}`, {
        scroll: false,
      });
    });

  const allDay = absences.filter((a) => a.unit === 'day');
  const hourly = absences.filter((a) => a.unit === 'hour');
  const fmt = (iso: string) => formatCalendarDate(iso, locale);

  const row = (a: Absence) => {
    const dept = locale === 'fa' ? a.departmentNameFa ?? a.departmentNameEn : a.departmentNameEn ?? a.departmentNameFa;
    const what =
      a.kind === 'errand'
        ? t(a.unit === 'hour' ? 'hourlyErrand' : 'dailyErrand')
        : a.leaveTypeNameFa
          ? localizedLeaveTypeName({ name_fa: a.leaveTypeNameFa, name_en: a.leaveTypeNameEn }, locale)
          : t('leave');
    const when =
      a.unit === 'hour'
        ? formatTimeRange(a.startTime, a.endTime, locale)
        : a.startDate === a.endDate
          ? t('allDay')
          : t('dateRange', { from: fmt(a.startDate), to: fmt(a.endDate) });
    return (
      <li key={a.id} className="flex items-start justify-between gap-3 py-3" data-testid={`absence-${a.id}`}>
        <div className="min-w-0">
          <p className="font-medium">
            {a.employeeName}
            {a.personnelNo && (
              <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                {formatNumber(Number(a.personnelNo), locale, { useGrouping: false })}
              </span>
            )}
          </p>
          {dept && <p className="text-xs text-muted-foreground">{dept}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-end">
          <Badge variant={a.kind === 'errand' ? 'secondary' : 'outline'}>{what}</Badge>
          <span className="text-sm tabular-nums">{when}</span>
        </div>
      </li>
    );
  };

  const section = (title: string, icon: React.ReactNode, list: Absence[], testId: string) =>
    list.length > 0 && (
      <Card className="gap-0 px-4 py-2" data-testid={testId}>
        <h2 className="flex items-center gap-2 pt-2 text-sm font-semibold">
          {icon}
          {title}
          <span className="text-muted-foreground">({formatNumber(list.length, locale)})</span>
        </h2>
        <ul className="divide-y">{list.map(row)}</ul>
      </Card>
    );

  return (
    <div className={cn('flex flex-col gap-4', isPending && 'opacity-70')}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48">
          <PersianDateField
            locale={locale}
            value={gregorianToPersianDateObject(date, locale)}
            onChange={(d) => d && go(dateObjectToGregorian(d))}
            testId="absences-date"
          />
        </div>
        {date !== today && (
          <Button variant="outline" size="sm" onClick={() => go(today)} data-testid="absences-today">
            {t('today')}
          </Button>
        )}
        <p className="text-sm text-muted-foreground" data-testid="absences-count">
          {t('count', { n: formatNumber(absences.length, locale) })}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>

      {absences.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <>
          {section(t('allDaySection'), <Sun className="size-4" aria-hidden="true" />, allDay, 'absences-all-day')}
          {section(t('hourlySection'), <Clock className="size-4" aria-hidden="true" />, hourly, 'absences-hourly')}
        </>
      )}
    </div>
  );
}
