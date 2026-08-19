'use client';

/**
 * HR reports (FR-37).
 *
 * Every report is a `ReportTable` from `lib/reports/reports.ts`, so this file has
 * ONE table renderer and ONE download button rather than five of each. Adding a
 * sixth report means a builder and a label block, not another screen.
 *
 * The export is CSV with a UTF-8 BOM (`buildCsv`), which Excel opens directly
 * with Persian text intact — the same writer the credentials export already
 * uses. Durations are decimal days, because HR will sum and sort them in the
 * spreadsheet and a formatted string cannot be summed.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildCsv } from '@/lib/csv/parse';
import { nativeSelectClass } from '@/lib/native-select';
import {
  buildAbsenceByDepartment,
  buildBalanceReport,
  buildHeadcount,
  buildPendingAgeing,
  buildRequestSummary,
  tableToCsvRows,
  type ReportTable,
} from '@/lib/reports/reports';
import type { ReportData, JalaliMonthOption } from '@/lib/actions/reports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/EmptyState';

type Labels = {
  from: string;
  to: string;
  apply: string;
  download: string;
  empty: string;
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
  labels: Labels;
  locale: string;
};

/** One report: a heading, a download button, and the table. */
function ReportCard({
  id,
  title,
  table,
  labels,
  filenameStem,
}: {
  id: string;
  title: string;
  table: ReportTable;
  labels: { download: string; empty: string };
  filenameStem: string;
}) {
  const download = () => {
    const blob = new Blob([buildCsv(tableToCsvRows(table))], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameStem}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card data-testid={`report-${id}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={download}
          disabled={table.rows.length === 0}
          data-testid={`report-download-${id}`}
        >
          {labels.download}
        </Button>
      </CardHeader>
      <CardContent>
        {table.rows.length === 0 ? (
          <EmptyState message={labels.empty} />
        ) : (
          // Wide tables scroll inside their own box; the page never scrolls
          // sideways.
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid={`report-table-${id}`}>
              <thead>
                <tr className="border-b border-border text-start">
                  {table.columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-start font-medium text-muted-foreground">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReportsDashboard({ data, months, labels, locale }: Props) {
  const router = useRouter();
  const [from, setFrom] = useState(data.rangeStart);
  const [to, setTo] = useState(data.rangeEnd);

  const monthLabel = (m: JalaliMonthOption) =>
    `${labels.months[`m${m.jalaliMonth}`] ?? m.jalaliMonth} ${m.jalaliYear}`;

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

  const stem = `bj-${data.rangeStart}-${data.rangeEnd}`;
  const cardLabels = { download: labels.download, empty: labels.empty };

  return (
    <div className="space-y-4" data-testid="reports-dashboard">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-from">{labels.from}</Label>
            <select
              id="report-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={nativeSelectClass}
              data-testid="report-from"
            >
              {months.map((m) => (
                <option key={m.gregorianStart} value={m.gregorianStart}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-to">{labels.to}</Label>
            <select
              id="report-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={nativeSelectClass}
              data-testid="report-to"
            >
              {months.map((m) => (
                <option key={m.gregorianEnd} value={m.gregorianEnd}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          {/* The range lives in the URL so a report can be linked and reloaded,
              and so the server re-queries rather than filtering in the browser. */}
          <Button
            type="button"
            onClick={() => router.push(`/${locale}/manage/reports?from=${from}&to=${to}`)}
            data-testid="report-apply"
          >
            {labels.apply}
          </Button>
        </CardContent>
      </Card>

      <ReportCard
        id="balances"
        title={labels.balances.title}
        table={tables.balances}
        labels={cardLabels}
        filenameStem={`${stem}-balances`}
      />
      <ReportCard
        id="requests"
        title={labels.requests.title}
        table={tables.requests}
        labels={cardLabels}
        filenameStem={`${stem}-requests`}
      />
      <ReportCard
        id="absence"
        title={labels.absence.title}
        table={tables.absence}
        labels={cardLabels}
        filenameStem={`${stem}-absence`}
      />
      <ReportCard
        id="ageing"
        title={labels.ageing.title}
        table={tables.ageing}
        labels={cardLabels}
        filenameStem={`${stem}-waiting`}
      />
      <ReportCard
        id="headcount"
        title={labels.headcount.title}
        table={tables.headcount}
        labels={cardLabels}
        filenameStem={`${stem}-headcount`}
      />
    </div>
  );
}
