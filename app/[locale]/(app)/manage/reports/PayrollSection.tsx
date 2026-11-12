'use client';

/**
 * FR-92: unpaid leave per person, for HR to pass to payroll. Self-contained (own data
 * function, builders and messages) so a future Payroll module can take it over.
 */

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { downloadCsv, fileDateStamp } from '@/lib/csv/download';
import { tableToCsvRows } from '@/lib/reports/reports';
import { payrollCsv, type PayrollPerson, type PayrollSource } from '@/lib/reports/payroll';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { cn } from '@/lib/utils';

const SOURCES: PayrollSource[] = ['unpaid_type', 'unpaid_part', 'conversion'];

type Props = {
  people: PayrollPerson[];
  hoursPerDay: number;
  locale: string;
  /** The reports range, already formatted for display. */
  rangeLabel: string;
};

export function PayrollSection({ people, hoursPerDay, locale, rangeLabel }: Props) {
  const t = useTranslations('payroll');
  const tLeave = useTranslations('leave');
  const durationLabels = durationLabelsFrom(tLeave);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const fmt = (m: number) => formatDuration(m, hoursPerDay, locale, durationLabels);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sourceLabel = (s: PayrollSource) => t(`source.${s}`);

  const exportCsv = () => {
    const table = payrollCsv(
      people,
      {
        columns: [
          t('col.name'),
          t('col.personnelNo'),
          t('col.department'),
          t('col.source'),
          t('col.ref'),
          t('col.date'),
          t('col.type'),
          t('col.unpaid'),
          t('col.balance'),
        ],
        source: Object.fromEntries(SOURCES.map((s) => [s, sourceLabel(s)])) as Record<
          PayrollSource,
          string
        >,
      },
      Math.round(hoursPerDay * 60)
    );
    downloadCsv(tableToCsvRows(table), `${fileDateStamp()}-payroll.csv`);
  };

  return (
    <section className="flex flex-col gap-3" data-testid="payroll-section">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-[13px] text-muted-foreground">
            {t('hint', { range: `⁨${rangeLabel}⁩` })}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="rounded-md"
          disabled={people.length === 0}
          onClick={exportCsv}
          data-testid="payroll-export"
        >
          <Download aria-hidden="true" />
          {t('export')}
        </Button>
      </div>

      {people.length === 0 ? (
        <EmptyState message={t('empty')} />
      ) : (
        <div className="border-b border-border">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2.5 text-start">{t('col.name')}</th>
                <th className="px-3 py-2.5 text-start max-md:hidden">{t('col.personnelNo')}</th>
                <th className="px-3 py-2.5 text-start max-md:hidden">{t('col.department')}</th>
                <th className="px-3 py-2.5 text-start">{t('col.unpaid')}</th>
                <th className="px-3 py-2.5 text-start">{t('col.balance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {people.map((p) => {
                const expanded = open.has(p.employeeId);
                return (
                  <Fragment key={p.employeeId}>
                    <tr>
                      <td className="h-14 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="-ms-1 shrink-0"
                            aria-expanded={expanded}
                            aria-label={expanded ? t('hideDetails') : t('showDetails')}
                            data-testid={`payroll-expand-${p.employeeId}`}
                            onClick={() => toggle(p.employeeId)}
                          >
                            <ChevronDown
                              aria-hidden="true"
                              className={cn('transition-transform', expanded && 'rotate-180')}
                            />
                          </Button>
                          <span className="font-medium">
                            <bdi>{p.fullName}</bdi>
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground max-md:hidden">
                        <bdi dir="ltr">{p.personnelNo ?? '—'}</bdi>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground max-md:hidden">
                        {p.department}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <bdi>{fmt(p.unpaidMinutes)}</bdi>
                      </td>
                      <td
                        className={cn(
                          'whitespace-nowrap px-3 py-2.5',
                          p.balanceMinutes !== null && p.balanceMinutes < 0 && 'text-destructive'
                        )}
                      >
                        {p.balanceMinutes === null ? '—' : <bdi>{fmt(p.balanceMinutes)}</bdi>}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-muted/30" data-testid={`payroll-items-${p.employeeId}`}>
                        <td colSpan={5} className="px-3 py-3">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="px-2 py-1 text-start font-medium">{t('col.date')}</th>
                                <th className="px-2 py-1 text-start font-medium">{t('col.source')}</th>
                                <th className="px-2 py-1 text-start font-medium">{t('col.ref')}</th>
                                <th className="px-2 py-1 text-start font-medium">{t('col.type')}</th>
                                <th className="px-2 py-1 text-start font-medium">{t('col.unpaid')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.items.map((i, idx) => (
                                <tr key={idx}>
                                  <td className="whitespace-nowrap px-2 py-1">{i.onDate}</td>
                                  <td className="px-2 py-1">{sourceLabel(i.source)}</td>
                                  <td className="px-2 py-1">
                                    <bdi dir="ltr">{i.ref ?? '—'}</bdi>
                                  </td>
                                  <td className="px-2 py-1">{i.leaveType}</td>
                                  <td className="whitespace-nowrap px-2 py-1">
                                    <bdi>{fmt(i.unpaidMinutes)}</bdi>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
