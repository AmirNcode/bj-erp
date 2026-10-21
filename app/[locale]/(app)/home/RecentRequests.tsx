'use client';

/**
 * Home's recent requests (FR-72): one line each, with "Show more" opening the
 * full details the Requests tab shows (procurement's note included), and a
 * "Remove" button on rejected requests. Which requests are here is decided on
 * the server (`recentOnHome`): until the return-to-work day.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import type { LeaveRequestWithType } from '@/lib/actions/leave/requests';
import { dismissFromHome } from '@/lib/actions/leave/requests';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RequestCancelButton } from '../request/_components/RequestCancelButton';
import { RequestDetails, type TravelNote } from '../request/_components/RequestDetails';

export function RecentRequests({
  requests,
  locale,
  hoursPerDay,
  travelBookings,
}: {
  requests: LeaveRequestWithType[];
  locale: string;
  hoursPerDay: number;
  travelBookings: Record<string, TravelNote>;
}) {
  const t = useTranslations('home');
  const tLeave = useTranslations('leave');
  const tErrand = useTranslations('errand');
  const durationLabels = durationLabelsFrom(tLeave);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const statusLabels = {
    pending: tLeave('status.pending'),
    approved: tLeave('status.approved'),
    rejected: tLeave('status.rejected'),
    cancelled: tLeave('status.cancelled'),
  };
  const formatDate = (date: string) => formatCalendarDate(date, locale);
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const remove = (id: string) => {
    setError('');
    setRemoved((prev) => new Set(prev).add(id));
    startTransition(async () => {
      const res = await dismissFromHome(id);
      if (!res.ok) {
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setError(t('removeFailed'));
      }
    });
  };

  const visible = requests.filter((r) => !removed.has(r.id));
  if (visible.length === 0) {
    return (
      <div className="space-y-2">
        <EmptyState message={t('noRecent')} />
        <Link href={`/${locale}/request`} className="block text-center text-sm font-medium text-primary underline">
          {t('openRequests')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {visible.map((r) => {
        const open = openIds.has(r.id);
        return (
          <div key={r.id} data-testid={`home-recent-request-${r.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* An errand has no leave type; naming it by its tag keeps
                    the row from rendering as a bare em dash. */}
                <div className="text-sm font-medium truncate">
                  {r.kind === 'errand'
                    ? `${tErrand('badge')}: ${r.errand_location ?? '—'}`
                    : r.leave_types
                      ? localizedLeaveTypeName(r.leave_types, locale)
                      : '—'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(r.start_date)} — {formatDate(r.end_date)} -{' '}
                  {formatDuration(r.requested_minutes, hoursPerDay, locale, durationLabels)}
                </div>
                <button
                  type="button"
                  onClick={() => toggle(r.id)}
                  aria-expanded={open}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary"
                  data-testid={`home-show-more-${r.id}`}
                >
                  {open ? t('showLess') : t('showMore')}
                  <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
                </button>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span data-testid={`home-status-${r.id}`}>
                  <StatusBadge
                    status={r.status as 'pending' | 'approved' | 'rejected' | 'cancelled'}
                    labels={statusLabels}
                  />
                </span>
                <RequestCancelButton requestId={r.id} status={r.status} startDate={r.start_date} />
                {r.status === 'rejected' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => remove(r.id)}
                    data-testid={`home-remove-${r.id}`}
                  >
                    {t('removeFromHome')}
                  </Button>
                )}
              </div>
            </div>
            {open && (
              <div className="mt-2 border-s-2 border-muted ps-3" data-testid={`home-details-${r.id}`}>
                <RequestDetails
                  req={r}
                  locale={locale}
                  hoursPerDay={hoursPerDay}
                  travel={travelBookings[r.id]}
                  progressOpen
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
