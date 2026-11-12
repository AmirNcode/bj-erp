'use client';

import { useTranslations } from 'next-intl';
import type { PendingApproval } from '@/lib/actions/leave/approvals';
import { balanceFigures } from '@/lib/leave/approvalSummary';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { localizedLeaveTypeName } from '@/lib/i18n/format';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * Everything an approver needs before signing: who, what, when, and (FR-92) what
 * approving does to the requester's balance. Shown to every approver in the dialog.
 */
export function RequestSummary({ request, hoursPerDay, locale }: {
  request: PendingApproval;
  hoursPerDay: number;
  locale: string;
}) {
  const t = useTranslations('approvals.summary');
  const tLeave = useTranslations('leave');
  const tErrand = useTranslations('errand');
  const labels = durationLabelsFrom(tLeave);
  const dur = (minutes: number) => formatDuration(minutes, hoursPerDay, locale, labels);
  // Negative durations keep their minus in RTL only inside a bidi isolate.
  const bdi = (minutes: number) => <bdi>{dur(minutes)}</bdi>;
  const isolate = (minutes: number) => `⁨${dur(minutes)}⁩`;

  const r = request;
  const typeName = r.kind === 'errand'
    ? tErrand('badge')
    : localizedLeaveTypeName({ name_fa: r.leave_type_name_fa, name_en: r.leave_type_name_en }, locale);
  const dates = r.start_date === r.end_date
    ? formatCalendarDate(r.start_date, locale)
    : `${formatCalendarDate(r.start_date, locale)} — ${formatCalendarDate(r.end_date, locale)}`;
  const time = r.unit === 'hour'
    ? formatTimeRange(r.start_time, r.end_time, locale)
    : r.day_part !== 'full' ? tLeave(`dayPart.${r.day_part}`) : null;
  const figures = balanceFigures(r);

  return (
    <div data-testid={`approve-summary-${r.id}`} className="space-y-3 rounded-md border bg-muted/40 p-3 text-start">
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Row label={t('requester')}><bdi>{r.employee_name}</bdi></Row>
        <Row label={t('type')}>{typeName}</Row>
        <Row label={t('dates')}>{dates}</Row>
        {time && <Row label={t('time')}><bdi>{time}</bdi></Row>}
        <Row label={t('duration')}>{bdi(r.requested_minutes)}</Row>
        {r.errand_location && <Row label={t('location')}>{r.errand_location}</Row>}
        {r.reason && <Row label={t('reason')}>{r.reason}</Row>}
        {r.replacement_name && <Row label={t('replacement')}><bdi>{r.replacement_name}</bdi></Row>}
      </dl>
      {figures && (
        <div className="space-y-2 border-t pt-3" data-testid={`approve-summary-balance-${r.id}`}>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <Row label={t('balanceNow')}>{bdi(figures.balanceMinutes)}</Row>
            {figures.otherPendingMinutes > 0 && (
              <Row label={t('otherPending')}>{bdi(figures.otherPendingMinutes)}</Row>
            )}
            <Row label={t('available')}>{bdi(figures.availableMinutes)}</Row>
            <Row label={t('requested')}>{bdi(figures.requestedMinutes)}</Row>
            <Row label={t('after')}>{bdi(figures.afterMinutes)}</Row>
          </dl>
          {figures.overdraftMinutes > 0 && (
            <p className="rounded-sm bg-warning/10 px-2 py-1 text-sm text-warning" data-testid={`approve-summary-overdraft-${r.id}`}>
              {t('overdraft', { value: isolate(figures.overdraftMinutes) })}
            </p>
          )}
          {figures.unpaidMinutes > 0 && (
            <p className="rounded-sm bg-destructive/10 px-2 py-1 text-sm text-destructive" data-testid={`approve-summary-unpaid-${r.id}`}>
              {t('unpaid', { value: isolate(figures.unpaidMinutes) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
