/**
 * Approvals history (owner, 2026-11-02): under the queue, the decided requests
 * the caller approved or rejected a step of (admin: every decided request),
 * newest first, 20 a page. `?history=<page>` keeps the page in the URL. Each
 * row opens the printable form, which shows the whole chain.
 */

import Link from 'next/link';
import { PersonAvatar } from '@/components/PersonAvatar';
import { approvalHref, type RequestFilters } from '@/lib/leave/requestFilters';
import { RequestReviewActions, type TravelTicks } from '../requests/RequestReviewActions';
import type { EditKey } from '@/lib/leave/requestEdit';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getApprovalHistory, type ApprovalHistoryRow } from '@/lib/actions/leave/approvals';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Phones: every action is half the card wide and 44px tall.
const ACTION = 'h-11 w-[calc(50%-0.25rem)] md:h-9 md:w-auto';
import { StatusBadge } from '@/components/StatusBadge';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { formatNumber, localizedLeaveTypeName } from '@/lib/i18n/format';
import { todayInAppTz } from '@/lib/appDate';

type Props = { locale: string; page: number; hoursPerDay: number; filters: RequestFilters; travelTicks: TravelTicks; viewerId: string; canReview: boolean; canCancel?: boolean; editKeys?: readonly EditKey[]; workWindow?: { start: string; end: string } };

export async function ApprovalHistory(props: Props) {
  const result = await getApprovalHistory(props.page, props.filters);
  return <ApprovalHistoryContent {...props} result={result} />;
}

export async function ApprovalHistoryContent({ locale, page, hoursPerDay, filters, travelTicks, viewerId, canReview, canCancel, editKeys, workWindow, result: res }: Props & {
  result: Awaited<ReturnType<typeof getApprovalHistory>>;
}) {
  const [t, tLeave, tErrand] = await Promise.all([
    getTranslations({ locale, namespace: 'approvals.history' }),
    getTranslations({ locale, namespace: 'leave' }),
    getTranslations({ locale, namespace: 'errand' }),
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
      <p className="text-xs text-muted-foreground">{t(canReview ? 'reviewHint' : 'hint')}</p>
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
  const href = (p: number) => `${approvalHref(locale, filters, p)}#history`;

  return (
    <section id="history" data-testid="approval-history">
      {header}
      {res.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="approval-history-empty">
          {t('empty')}
        </p>
      ) : (
        // Same card as the pending queue: one centred column on phones;
        // details at the start and the status at the end on desktop; actions
        // in a footer row with equal-size buttons.
        <ul className="space-y-3">
          {res.rows.map((r) => {
            const dept =
              locale === 'fa' ? r.department_name_fa ?? r.department_name_en : r.department_name_en ?? r.department_name_fa;
            const mine = r.my_decisions[r.my_decisions.length - 1];
            return (
              <li key={r.id} data-testid={`history-${r.id}`}>
                <Card className="grid gap-x-6 gap-y-4 p-4 text-center md:grid-cols-[minmax(0,1fr)_auto] md:p-5 md:text-start">
                  <div className="min-w-0">
                    <div className="flex flex-col items-center gap-1.5 md:flex-row md:gap-2.5">
                      <PersonAvatar id={r.employee_id} name={r.employee_name} />
                      <div className="min-w-0 max-w-full truncate text-[15px] font-semibold">
                        <bdi>{r.employee_name}</bdi>
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">{r.personnel_no ?? '—'}</span>
                    </div>
                    <div className="mt-3 space-y-1 text-[13px] text-muted-foreground">
                      <p className="text-sm text-foreground">{describe(r)}</p>
                      {r.kind === 'errand' && r.errand_location && <p>{r.errand_location}</p>}
                      {dept && <p>{dept}</p>}
                      <p>
                        {tLeave('trackingNo')}:{' '}
                        <span className="font-mono" dir="ltr">{formatSerialLocalized(r.serial_year, r.serial_seq, locale)}</span>
                      </p>
                      <p>
                        {mine
                          ? t(mine.decision === 'approved' ? 'youApproved' : 'youRejected', {
                              date: date(todayInAppTz(new Date(mine.at))),
                            })
                          : t('decidedOn', { date: date(todayInAppTz(new Date(r.decided_at))) })}
                      </p>
                      {mine?.note && (
                        <p>
                          {t('note')}: {mine.note}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start justify-center md:justify-end">
                    <StatusBadge status={r.status} labels={statusLabels} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-border pt-3 md:col-span-2 md:gap-x-5">
                    <Button variant="outline" size="sm" className={ACTION} asChild>
                      <Link href={`/${locale}/print/request/${r.id}`}>
                        <Printer aria-hidden="true" />
                        {t('view')}
                      </Link>
                    </Button>
                    <RequestReviewActions request={r} locale={locale} travelTicks={travelTicks} viewerId={viewerId} className="contents" buttonClassName={ACTION} canCancel={canCancel} editKeys={editKeys} workWindow={workWindow} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
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
