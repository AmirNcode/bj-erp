'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import type { FinanceRow } from '@/lib/actions/finance';
import type { JalaliMonthOption } from '@/lib/actions/reports';
import { downloadCsv } from '@/lib/csv/download';
import { nativeSelectClass } from '@/lib/native-select';
import { formatNumber, localizedLeaveTypeName } from '@/lib/i18n/format';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatRials } from '@/lib/leave/perDiem';
import { formatSerial, formatSerialLocalized } from '@/lib/leave/serial';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Props = {
  rows: FinanceRow[];
  months: JalaliMonthOption[];
  from: string;
  to: string;
  locale: string;
  hoursPerDay: number;
};

type KindFilter = 'all' | 'leave' | 'errand';

/**
 * A spreadsheet cell that Excel will not run as a formula. Errand locations
 * are typed by employees, so a value like `=HYPERLINK(...)` must stay text.
 */
function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function FinanceList({ rows, months, from, to, locale, hoursPerDay }: Props) {
  const t = useTranslations('finance');
  const tLeave = useTranslations('leave');
  const tReports = useTranslations('reports');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<KindFilter>('all');

  const durationLabels = durationLabelsFrom(tLeave);
  const num = (n: number) => formatNumber(n, locale);
  const date = (iso: string) => formatCalendarDate(iso, locale);
  // Explicit keys, not `months.m${n}`: dynamic message keys are avoided here
  // (see manage/page.tsx).
  const monthNames = [
    tReports('months.m1'), tReports('months.m2'), tReports('months.m3'), tReports('months.m4'),
    tReports('months.m5'), tReports('months.m6'), tReports('months.m7'), tReports('months.m8'),
    tReports('months.m9'), tReports('months.m10'), tReports('months.m11'), tReports('months.m12'),
  ];
  const monthLabel = (m: JalaliMonthOption) =>
    `${monthNames[m.jalaliMonth - 1] ?? m.jalaliMonth} ${formatNumber(m.jalaliYear, locale, { useGrouping: false })}`;

  const applyRange = (f: string, tt: string) =>
    startTransition(() => {
      router.replace(`/${locale}/finance?from=${f}&to=${tt}`, { scroll: false });
    });

  const shown = useMemo(() => (kind === 'all' ? rows : rows.filter((r) => r.kind === kind)), [rows, kind]);
  const totalPerDiem = shown.reduce((sum, r) => sum + (r.per_diem_rials ?? 0), 0);

  const typeName = (r: FinanceRow) =>
    r.kind === 'errand'
      ? t(r.unit === 'hour' ? 'hourlyErrand' : 'dailyErrand')
      : r.leave_type_name_fa
        ? localizedLeaveTypeName({ name_fa: r.leave_type_name_fa, name_en: r.leave_type_name_en }, locale)
        : '—';
  const dates = (r: FinanceRow) =>
    r.unit === 'hour'
      ? `${date(r.start_date)} ${formatTimeRange(r.start_time, r.end_time, locale) ?? ''}`.trim()
      : r.start_date === r.end_date
        ? date(r.start_date)
        : `${date(r.start_date)} — ${date(r.end_date)}`;
  const dept = (r: FinanceRow) =>
    (locale === 'fa' ? r.department_name_fa ?? r.department_name_en : r.department_name_en ?? r.department_name_fa) ?? '—';

  const exportCsv = () => {
    // Durations as decimal days and amounts as plain numbers, like the FR-37
    // reports, so finance can sum and sort them in Excel.
    const days = (minutes: number) => String(Math.round((minutes / (hoursPerDay * 60)) * 100) / 100);
    const header = [
      t('csv.trackingNo'),
      t('csv.personnelNo'),
      t('csv.employee'),
      t('csv.department'),
      t('csv.kind'),
      t('csv.type'),
      t('csv.start'),
      t('csv.end'),
      t('csv.startTime'),
      t('csv.endTime'),
      t('csv.days'),
      t('csv.unpaidDays'),
      t('csv.location'),
      t('csv.perDiem'),
      t('csv.perDiemBy'),
    ];
    const body = shown.map((r) => [
      formatSerial(r.serial_year, r.serial_seq),
      r.personnel_no ?? '',
      r.employee_name,
      dept(r),
      r.kind === 'errand' ? t('errand') : t('leave'),
      typeName(r),
      formatCalendarDate(r.start_date, 'fa'),
      formatCalendarDate(r.end_date, 'fa'),
      r.start_time?.slice(0, 5) ?? '',
      r.end_time?.slice(0, 5) ?? '',
      days(r.requested_minutes),
      days(r.unpaid_minutes),
      r.errand_location ?? '',
      r.per_diem_rials === null ? '' : String(r.per_diem_rials),
      r.per_diem_rials === null ? '' : r.per_diem_by_requester ? t('csv.perDiemByRequester') : t('csv.perDiemByHr'),
    ]);
    downloadCsv([header, ...body].map((row) => row.map(safeCell)), `bj-finance-${from}-${to}.csv`);
  };

  const selectClass = cn(nativeSelectClass, 'h-9 w-auto rounded-[10px] bg-card');

  return (
    <div className={cn('flex flex-col gap-4', isPending && 'opacity-70')} data-testid="finance-list">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={tReports('from')}
          value={from}
          onChange={(e) => applyRange(e.target.value, to < e.target.value ? e.target.value : to)}
          className={selectClass}
          data-testid="finance-from"
        >
          {months.map((m) => (
            <option key={m.gregorianStart} value={m.gregorianStart}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">{tReports('rangeJoin')}</span>
        <select
          aria-label={tReports('to')}
          value={to}
          onChange={(e) => applyRange(from, e.target.value)}
          className={selectClass}
          data-testid="finance-to"
        >
          {months.map((m) => (
            <option key={m.gregorianEnd} value={m.gregorianEnd}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('kind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as KindFilter)}
          className={selectClass}
          data-testid="finance-kind"
        >
          <option value="all">{t('all')}</option>
          <option value="errand">{t('errands')}</option>
          <option value="leave">{t('leaves')}</option>
        </select>
        <Button
          variant="outline"
          size="sm"
          className="ms-auto"
          onClick={exportCsv}
          disabled={shown.length === 0}
          data-testid="finance-export"
        >
          <Download aria-hidden="true" />
          {t('export')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="gap-1 px-4 py-3">
          <span className="text-xs text-muted-foreground">{t('count')}</span>
          <span className="text-xl font-semibold tabular-nums" data-testid="finance-count">
            {num(shown.length)}
          </span>
        </Card>
        <Card className="gap-1 px-4 py-3">
          <span className="text-xs text-muted-foreground">{t('totalPerDiem')}</span>
          <span className="text-xl font-semibold tabular-nums" data-testid="finance-total">
            {formatRials(totalPerDiem, locale)} <span className="text-sm font-normal">{t('rials')}</span>
          </span>
        </Card>
      </div>

      {shown.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr className="text-start">
                <th className="px-3 py-2 text-start font-medium">{t('trackingNo')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('employee')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('type')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('dates')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('duration')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('location')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('perDiem')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((r) => (
                <tr key={r.id} data-testid={`finance-row-${r.id}`}>
                  <td className="px-3 py-2 tabular-nums">{formatSerialLocalized(r.serial_year, r.serial_seq, locale)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.employee_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.personnel_no ? `${formatNumber(Number(r.personnel_no), locale, { useGrouping: false })} · ` : ''}
                      {dept(r)}
                    </div>
                  </td>
                  <td className="px-3 py-2">{typeName(r)}</td>
                  <td className="px-3 py-2 tabular-nums">{dates(r)}</td>
                  <td className="px-3 py-2">
                    {formatDuration(r.requested_minutes, hoursPerDay, locale, durationLabels)}
                    {r.unpaid_minutes > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {t('unpaid', { value: formatDuration(r.unpaid_minutes, hoursPerDay, locale, durationLabels) })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.errand_location ?? '—'}</td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {r.per_diem_rials === null ? '—' : formatRials(r.per_diem_rials, locale)}
                    {r.per_diem_by_requester && (
                      <div className="text-xs text-muted-foreground" data-testid={`finance-per-diem-by-requester-${r.id}`}>
                        {t('perDiemByRequester')}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
