'use client';

/**
 * HR reports (FR-37), kept basic on purpose (2026-10 redesign): two bar cards —
 * department capacity today and approved time off by department for the
 * period — while the head of HR decides what else belongs on screen.
 *
 * The five tabular reports from `lib/reports/reports.ts` remain available
 * through the Excel export menu, each as CSV with a UTF-8 BOM (`buildCsv`),
 * which Excel opens directly with Persian text intact. Durations there are
 * decimal days, because HR will sum and sort them.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, TriangleAlert } from 'lucide-react';
import { buildCsv } from '@/lib/csv/parse';
import { nativeSelectClass } from '@/lib/native-select';
import { formatNumber } from '@/lib/i18n/format';
import {
  absenceDaysByDepartment,
  buildAbsenceByDepartment,
  buildBalanceReport,
  buildHeadcount,
  buildPendingAgeing,
  buildRequestSummary,
  tableToCsvRows,
  type CapacityRow,
  type ReportTable,
} from '@/lib/reports/reports';
import type { ReportData, JalaliMonthOption } from '@/lib/actions/reports';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';

type Labels = {
  breadcrumb: string;
  title: string;
  from: string;
  to: string;
  rangeJoin: string;
  export: string;
  download: string;
  empty: string;
  capacityTitle: string;
  capacitySub: string;
  lowCapacity: string;
  absenceChartTitle: string;
  /** Raw: {from} {to}. */
  absenceChartSub: string;
  /** Raw: {days}. */
  totalDays: string;
  /** Raw: {days}. */
  daysValue: string;
  months: Record<string, string>;
  balances: { title: string; name: string; code: string; department: string; manager: string };
  requests: {
    title: string;
    kind: string;
    status: string;
    count: string;
    days: string;
    unpaidDays: string;
  };
  absence: { title: string; department: string; people: string; requests: string; days: string };
  ageing: {
    title: string;
    name: string;
    department: string;
    submitted: string;
    waitingDays: string;
    days: string;
    waitingOn: string;
  };
  headcount: { title: string; department: string; headcount: string; joiners: string };
  kindLeave: string;
  kindErrand: string;
  statuses: Record<string, string>;
  stepLabels: Record<string, string>;
};

type Props = {
  data: ReportData;
  months: JalaliMonthOption[];
  /** Present today per department (server-side, from the pulse read). */
  capacity: CapacityRow[];
  labels: Labels;
  locale: string;
};

function downloadCsv(table: ReportTable, filename: string) {
  const blob = new Blob([buildCsv(tableToCsvRows(table))], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** One Excel button; a small menu picks which report to export. */
function ExportMenu({
  items,
  label,
}: {
  items: { id: string; title: string; disabled: boolean; onSelect: () => void }[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="outline"
        className="rounded-[10px]"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="report-export"
      >
        <Download aria-hidden="true" />
        {label}
      </Button>
      {open && (
        <ul
          role="menu"
          className="absolute end-0 z-20 mt-1 min-w-56 overflow-hidden rounded-xl border bg-popover py-1 text-sm shadow-md"
        >
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect();
                  setOpen(false);
                }}
                data-testid={`report-download-${item.id}`}
                className="w-full whitespace-nowrap px-3 py-2 text-start transition-colors hover:bg-muted/60 disabled:opacity-50"
              >
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReportsDashboard({ data, months, capacity, labels, locale }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const num = (n: number) => formatNumber(n, locale);

  const monthLabel = (m: JalaliMonthOption) =>
    `${labels.months[`m${m.jalaliMonth}`] ?? m.jalaliMonth} ${formatNumber(m.jalaliYear, locale, { useGrouping: false })}`;

  // The range lives in the URL so a report can be linked and reloaded, and so
  // the server re-queries rather than filtering in the browser. Applies as soon
  // as either select changes.
  const applyRange = (from: string, to: string) =>
    startTransition(() => {
      router.replace(`/${locale}/manage/reports?from=${from}&to=${to}`, { scroll: false });
    });

  const tables = useMemo(() => {
    const { employees, ledger, leaveTypes, requests, hoursPerDay, today, rangeStart, rangeEnd } =
      data;
    return {
      balances: buildBalanceReport({
        employees,
        ledger,
        leaveTypes,
        hoursPerDay,
        labels: labels.balances,
      }),
      requests: buildRequestSummary({
        requests,
        hoursPerDay,
        labels: {
          ...labels.requests,
          kindLeave: labels.kindLeave,
          kindErrand: labels.kindErrand,
          statuses: labels.statuses,
        },
      }),
      absence: buildAbsenceByDepartment({
        requests,
        employees,
        hoursPerDay,
        labels: labels.absence,
      }),
      ageing: buildPendingAgeing({
        requests,
        employees,
        today,
        hoursPerDay,
        labels: { ...labels.ageing, stepLabels: labels.stepLabels },
      }),
      headcount: buildHeadcount({
        employees,
        rangeStart,
        rangeEnd,
        labels: labels.headcount,
      }),
    };
  }, [data, labels]);

  const absence = useMemo(
    () =>
      absenceDaysByDepartment({
        requests: data.requests,
        employees: data.employees,
        hoursPerDay: data.hoursPerDay,
      }),
    [data]
  );
  const maxDays = absence.reduce((m, r) => Math.max(m, r.days), 0);
  const totalAbsence = Math.round(absence.reduce((sum, r) => sum + r.days, 0) * 100) / 100;
  const present = capacity.reduce((sum, r) => sum + r.present, 0);
  const headcount = capacity.reduce((sum, r) => sum + r.headcount, 0);

  const fromMonth = months.find((m) => m.gregorianStart === data.rangeStart);
  const toMonth = months.find((m) => m.gregorianEnd === data.rangeEnd);

  const stem = `bj-${data.rangeStart}-${data.rangeEnd}`;
  const exportItems = [
    { id: 'balances', title: labels.balances.title, table: tables.balances, file: 'balances' },
    { id: 'requests', title: labels.requests.title, table: tables.requests, file: 'requests' },
    { id: 'absence', title: labels.absence.title, table: tables.absence, file: 'absence' },
    { id: 'ageing', title: labels.ageing.title, table: tables.ageing, file: 'waiting' },
    { id: 'headcount', title: labels.headcount.title, table: tables.headcount, file: 'headcount' },
  ].map((r) => ({
    id: r.id,
    title: r.title,
    disabled: r.table.rows.length === 0,
    onSelect: () => downloadCsv(r.table, `${stem}-${r.file}.csv`),
  }));

  const selectClass = cn(nativeSelectClass, 'h-9 w-auto rounded-[10px] bg-card');

  return (
    <div className="flex flex-col gap-5" data-testid="reports-dashboard">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[12.5px] text-muted-foreground">{labels.breadcrumb}</p>
          <h1 className="text-2xl font-bold tracking-tight">{labels.title}</h1>
        </div>
        <div className={cn('flex flex-wrap items-center gap-2', isPending && 'opacity-70')}>
          <select
            aria-label={labels.from}
            value={data.rangeStart}
            onChange={(e) => applyRange(e.target.value, data.rangeEnd)}
            className={selectClass}
            data-testid="report-from"
          >
            {months.map((m) => (
              <option key={m.gregorianStart} value={m.gregorianStart}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">{labels.rangeJoin}</span>
          <select
            aria-label={labels.to}
            value={data.rangeEnd}
            onChange={(e) => applyRange(data.rangeStart, e.target.value)}
            className={selectClass}
            data-testid="report-to"
          >
            {months.map((m) => (
              <option key={m.gregorianEnd} value={m.gregorianEnd}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <ExportMenu items={exportItems} label={labels.export} />
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card className="gap-4 px-[22px] py-5" data-testid="report-capacity">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{labels.capacityTitle}</h2>
              <p className="text-[13px] text-muted-foreground">{labels.capacitySub}</p>
            </div>
            <span className="whitespace-nowrap text-sm font-semibold" dir="ltr">
              {num(present)} / {num(headcount)}
            </span>
          </div>
          {capacity.length === 0 ? (
            <EmptyState message={labels.empty} />
          ) : (
            <ul className="grid grid-cols-[minmax(0,130px)_1fr_56px] items-center gap-x-3.5 gap-y-3 text-sm">
              {capacity.map((row) => {
                const pct = Math.round((row.present / row.headcount) * 100);
                return (
                  <li key={row.department} className="contents">
                    <span
                      className={cn('flex items-center gap-1 truncate', row.low && 'text-warning')}
                      title={row.low ? labels.lowCapacity : undefined}
                    >
                      {row.low && <TriangleAlert aria-label={labels.lowCapacity} className="size-3.5 shrink-0" />}
                      <span className="truncate">{row.department}</span>
                    </span>
                    <span
                      className={cn(
                        'h-2.5 overflow-hidden rounded-full',
                        row.low ? 'bg-warning-foreground' : 'bg-muted'
                      )}
                    >
                      <span
                        className={cn('block h-full rounded-full', row.low ? 'bg-warning' : 'bg-primary')}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span
                      className={cn('whitespace-nowrap text-end text-muted-foreground', row.low && 'text-warning')}
                      dir="ltr"
                    >
                      {num(row.present)} / {num(row.headcount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="gap-4 px-[22px] py-5" data-testid="report-absence-chart">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{labels.absenceChartTitle}</h2>
              <p className="text-[13px] text-muted-foreground">
                {labels.absenceChartSub
                  .replace('{from}', fromMonth ? monthLabel(fromMonth) : data.rangeStart)
                  .replace('{to}', toMonth ? monthLabel(toMonth) : data.rangeEnd)}
              </p>
            </div>
            <span className="whitespace-nowrap text-sm font-semibold">
              {labels.totalDays.replace('{days}', num(totalAbsence))}
            </span>
          </div>
          {absence.length === 0 ? (
            <EmptyState message={labels.empty} />
          ) : (
            <ul className="grid grid-cols-[minmax(0,130px)_1fr_auto] items-center gap-x-3.5 gap-y-3 text-sm">
              {absence.map((row) => (
                <li key={row.department} className="contents">
                  <span className="truncate">{row.department}</span>
                  <span className="h-3.5">
                    <span
                      className="block h-full rounded-[3px] bg-primary"
                      style={{ width: `${maxDays > 0 ? Math.max((row.days / maxDays) * 100, 2) : 0}%` }}
                    />
                  </span>
                  <span className="whitespace-nowrap text-muted-foreground">
                    {labels.daysValue.replace('{days}', num(row.days))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
