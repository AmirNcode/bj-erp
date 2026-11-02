/**
 * Approvals history (owner, 2026-11-02): under the queue, the decided requests
 * the caller approved or rejected a step of (admin: every decided request),
 * newest first, 20 a page. `?history=<page>` keeps the page in the URL. Each
 * row opens the printable form, which shows the whole chain.
 */

import Link from 'next/link';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getApprovalHistory, type ApprovalHistoryRow } from '@/lib/actions/leave/approvals';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { formatNumber, localizedLeaveTypeName } from '@/lib/i18n/format';
import { todayInAppTz } from '@/lib/appDate';

type Props = { locale: string; page: number; hoursPerDay: number };

export async function ApprovalHistory({ locale, page, hoursPerDay }: Props) {
  const [t, tLeave, tErrand, res] = await Promise.all([
    getTranslations('approvals.history'),
    getTranslations('leave'),
    getTranslations('errand'),
    getApprovalHistory(page),
  ]);
  const statusLabels = {
    pending: tLeave('status.pending'),
    approved: tLeave('status.approved'),
    rejected: tLeave('status.rejected'),
    cancelled: tLeave('status.cancelled'),
  };
  const durationLabels = durationLabelsFrom(tLeave);
  const date = (iso: string) => formatCalendarDate(iso, locale);

  const describe = (r: ApprovalHistoryRow) => {
    const what =
      r.kind === 'errand'
        ? tErrand('badge')
        : r.leave_type_name_fa
          ? localizedLeaveTypeName({ name_fa: r.leave_type_name_fa, name_en: r.leave_type_name_en }, locale)
          : '—';
    const when =
      r.unit === 'hour'
        ? `${date(r.start_date)} ${formatTimeRange(r.start_time, r.end_time, locale) ?? ''}`.trim()
        : r.start_date === r.end_date
          ? date(r.start_date)
          : `${date(r.start_date)} — ${date(r.end_date)}`;
    return [what, when, formatDuration(r.requested_minutes, hoursPerDay, locale, durationLabels)].join(' ، ');
  };

  const header = (
    <div className="mb-3 mt-8">
      <h2 className="text-lg font-semibold">{t('title')}</h2>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </div>
  );

  if (!res.ok) {
    return (
      <section data-testid="approval-history">
        {header}
        <p role="alert" className="text-sm text-destructive">
          {res.error}
        </p>
      </section>
    );
  }

  const lastPage = Math.max(1, Math.ceil(res.total / res.pageSize));
  const current = Math.min(Math.max(page, 1), lastPage);
  const Prev = locale === 'fa' ? ChevronRight : ChevronLeft;
  const Next = locale === 'fa' ? ChevronLeft : ChevronRight;
  const href = (p: number) => `/${locale}/manage/approvals${p > 1 ? `?history=${p}` : ''}#history`;

  return (
    <section id="history" data-testid="approval-history">
      {header}
      {res.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="approval-history-empty">
          {t('empty')}
        </p>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <ul className="divide-y">
            {res.rows.map((r) => {
              const dept =
                locale === 'fa' ? r.department_name_fa ?? r.department_name_en : r.department_name_en ?? r.department_name_fa;
              const mine = r.my_decisions[r.my_decisions.length - 1];
              return (
                <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3" data-testid={`history-${r.id}`}>
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium">
                      <bdi>{r.employee_name}</bdi>
                      <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                        {formatSerialLocalized(r.serial_year, r.serial_seq, locale)}
                      </span>
                    </p>
                    {dept && <p className="text-xs text-muted-foreground">{dept}</p>}
                    <p className="text-sm">{describe(r)}</p>
                    {r.kind === 'errand' && r.errand_location && (
                      <p className="text-xs text-muted-foreground">{r.errand_location}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {mine
                        ? t(mine.decision === 'approved' ? 'youApproved' : 'youRejected', {
                            date: date(todayInAppTz(new Date(mine.at))),
                          })
                        : t('decidedOn', { date: date(todayInAppTz(new Date(r.decided_at))) })}
                    </p>
                    {mine?.note && (
                      <p className="text-xs text-muted-foreground">
                        {t('note')}: {mine.note}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <StatusBadge status={r.status} labels={statusLabels} />
                    <Link
                      href={`/${locale}/print/request/${r.id}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Printer className="size-3.5" aria-hidden="true" />
                      {t('view')}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {lastPage > 1 && (
        <nav className="mt-3 flex items-center justify-between text-sm" aria-label={t('title')}>
          <span className="text-muted-foreground">
            {t('pageOf', { page: formatNumber(current, locale), pages: formatNumber(lastPage, locale) })}
          </span>
          <span className="flex gap-2">
            {current > 1 && (
              <Link href={href(current - 1)} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-muted" data-testid="history-prev">
                <Prev className="size-4" aria-hidden="true" />
                {t('prev')}
              </Link>
            )}
            {current < lastPage && (
              <Link href={href(current + 1)} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-muted" data-testid="history-next">
                {t('next')}
                <Next className="size-4" aria-hidden="true" />
              </Link>
            )}
          </span>
        </nav>
      )}
    </section>
  );
}
