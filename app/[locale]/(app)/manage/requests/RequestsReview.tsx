'use client';

/**
 * HR review list (FR-38): every request in the company, filterable, each row
 * linking to its printable paper form.
 *
 * Filtering is client-side on an already-fetched list. Deliberate: the company
 * is a few hundred employees, the rows are small, and it keeps typing in the
 * search box instant with no round-trip. If this ever needs paging, move the
 * filters into the query rather than adding a second filtering path here.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ReviewRequestRow } from '@/lib/actions/leave';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatSerial, formatSerialLocalized } from '@/lib/leave/serial';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import { nativeSelectClass } from '@/lib/native-select';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';

type Labels = {
  search: string;
  searchPlaceholder: string;
  status: string;
  kind: string;
  all: string;
  kindLeave: string;
  kindErrand: string;
  trackingNo: string;
  employee: string;
  dates: string;
  duration: string;
  signatures: string;
  print: string;
  empty: string;
  signedRequester: string;
  signedApprover: string;
  errandBadge: string;
  statusPending: string;
  statusApproved: string;
  statusRejected: string;
  statusCancelled: string;
  days: string;
  hours: string;
  minutes: string;
  and: string;
};

type Props = {
  requests: ReviewRequestRow[];
  labels: Labels;
  locale: string;
  hoursPerDay: number;
};

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

export function RequestsReview({ requests, labels, locale, hoursPerDay }: Props) {
  const [status, setStatus] = useState<string>('all');
  const [kind, setKind] = useState<string>('all');
  const [query, setQuery] = useState('');

  const statusLabels = {
    pending: labels.statusPending,
    approved: labels.statusApproved,
    rejected: labels.statusRejected,
    cancelled: labels.statusCancelled,
  };

  const filtered = useMemo(() => {
    // Search matches the LATIN serial as well as the localized one, so an HR
    // officer can paste `1404-0042` from an email while the screen shows Persian
    // digits — otherwise the number they can see is not the number they can find.
    const q = query.trim().toLowerCase();
    return requests.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (kind !== 'all' && r.kind !== kind) return false;
      if (!q) return true;
      const haystack = [
        r.employee_name,
        r.personnel_no ?? '',
        formatSerial(r.serial_year, r.serial_seq),
        formatSerialLocalized(r.serial_year, r.serial_seq, locale),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [requests, status, kind, query, locale]);

  return (
    <div className="space-y-4" data-testid="requests-review">
      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="review-search">{labels.search}</Label>
            <Input
              id="review-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={labels.searchPlaceholder}
              data-testid="review-search"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-status">{labels.status}</Label>
            <select
              id="review-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={nativeSelectClass}
              data-testid="review-status"
            >
              <option value="all">{labels.all}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-kind">{labels.kind}</Label>
            <select
              id="review-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={nativeSelectClass}
              data-testid="review-kind"
            >
              <option value="all">{labels.all}</option>
              <option value="leave">{labels.kindLeave}</option>
              <option value="errand">{labels.kindErrand}</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState message={labels.empty} />
      ) : (
        <div className="space-y-2" data-testid="review-list">
          {filtered.map((r) => {
            const times = formatTimeRange(r.start_time, r.end_time, locale);
            return (
              <Card key={r.id} data-testid={`review-row-${r.id}`}>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.employee_name}</span>
                      {r.personnel_no ? (
                        <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                          {r.personnel_no}
                        </span>
                      ) : null}
                      {r.kind === 'errand' ? (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                          {labels.errandBadge}
                        </span>
                      ) : null}
                    </div>

                    <div className="text-sm text-muted-foreground">
                      {r.kind === 'errand'
                        ? labels.kindErrand
                        : r.leave_type_name_fa
                          ? localizedLeaveTypeName(
                              { name_fa: r.leave_type_name_fa, name_en: r.leave_type_name_en },
                              locale
                            )
                          : '—'}{' '}
                      ·{' '}
                      {r.start_date === r.end_date
                        ? formatCalendarDate(r.start_date, locale)
                        : `${formatCalendarDate(r.start_date, locale)} — ${formatCalendarDate(r.end_date, locale)}`}
                      {times ? ` · ${times}` : ''} ·{' '}
                      {formatDuration(r.requested_minutes, hoursPerDay, locale, labels)}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {labels.trackingNo}:{' '}
                        <span className="font-mono" dir="ltr">
                          {formatSerialLocalized(r.serial_year, r.serial_seq, locale)}
                        </span>
                      </span>
                      {/* Which of the two capturable signatures are on file.
                          Timestamps only — the images are never listed. */}
                      {r.signature_consent_at ? (
                        <span
                          className="rounded bg-success/10 px-1.5 py-0.5 text-success"
                          data-testid={`review-signed-requester-${r.id}`}
                        >
                          ✓ {labels.signedRequester}
                        </span>
                      ) : null}
                      {r.approver_signature_consent_at ? (
                        <span
                          className="rounded bg-success/10 px-1.5 py-0.5 text-success"
                          data-testid={`review-signed-approver-${r.id}`}
                        >
                          ✓ {labels.signedApprover}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <StatusBadge status={r.status} labels={statusLabels} />
                    <Link
                      href={`/${locale}/print/request/${r.id}`}
                      target="_blank"
                      rel="noopener"
                      data-testid={`review-print-${r.id}`}
                      className="rounded-md border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
                    >
                      {labels.print}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
