'use client';

import { useState, useEffect } from 'react';
import type { LeaveRequestWithType } from '@/lib/actions/leave';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { RequestCancelButton } from './_components/RequestCancelButton';

type Labels = {
  myRequests: string;
  noRequests: string;
  errorLabel: string;
  statusPending: string;
  statusApproved: string;
  statusRejected: string;
  statusCancelled: string;
  dayPartLabels: { full: string; am: string; pm: string };
  coverLabel: string;
  days: string;
  hours: string;
  minutes: string;
  and: string;
  from: string;
  to: string;
  rejectedReason: string;
  trackingNo: string;
  errandBadge: string;
  errandLocation: string;
};

type Props = {
  requests: LeaveRequestWithType[];
  labels: Labels;
  calendarPref: string;
  locale: string;
  /** Company day length — durations are stored in minutes. */
  hoursPerDay: number;
};

export function MyRequestsList({
  requests,
  labels,
  calendarPref,
  locale,
  hoursPerDay,
}: Props) {
  const [localRequests, setLocalRequests] = useState(requests);
  const [errorMsg, setErrorMsg] = useState('');

  // Sync localRequests when the server re-renders with fresh data (e.g. after
  // router.refresh() surfaces a newly-submitted request). This server→local
  // resync is the intended use of the effect, not a derived-state smell.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop→state sync
    setLocalRequests(requests);
  }, [requests]);

  const statusLabels = {
    pending: labels.statusPending,
    approved: labels.statusApproved,
    rejected: labels.statusRejected,
    cancelled: labels.statusCancelled,
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">{labels.myRequests}</h2>

      {errorMsg && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-4">
          <strong>{labels.errorLabel}:</strong> {errorMsg}
        </div>
      )}

      {localRequests.length === 0 ? (
        <p className="text-muted-foreground text-sm">{labels.noRequests}</p>
      ) : (
        <div className="space-y-3">
          {localRequests.map((req) => {
            return (
              <Card
                key={req.id}
                className="p-4 gap-0"
                data-testid={`request-row-${req.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* An errand has no leave type — it is tagged instead, so a
                        work trip never reads as time off. */}
                    <div className="flex items-center gap-2">
                      {req.kind === 'errand' && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
                          data-testid={`errand-badge-${req.id}`}
                        >
                          {labels.errandBadge}
                        </span>
                      )}
                      {req.kind === 'errand' ? (
                        <div
                          className="font-medium text-sm text-foreground truncate"
                          data-testid={`errand-location-${req.id}`}
                          title={req.errand_location ?? undefined}
                        >
                          {labels.errandLocation}: {req.errand_location ?? '—'}
                        </div>
                      ) : (
                        <div className="font-medium text-sm text-foreground truncate">
                          {req.leave_types ? localizedLeaveTypeName(req.leave_types, locale) : '—'}
                        </div>
                      )}
                    </div>
                    {/* Date range */}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {labels.from} {formatCalendarDate(req.start_date, calendarPref, locale)}{' '}
                      {labels.to} {formatCalendarDate(req.end_date, calendarPref, locale)}
                    </div>
                    {/* Day part */}
                    <div className="text-xs text-muted-foreground">
                      {req.unit === 'hour'
                        ? formatTimeRange(req.start_time, req.end_time, locale)
                        : labels.dayPartLabels[req.day_part]}{' '}
                      · {formatDuration(req.requested_minutes, hoursPerDay, locale, labels)}
                    </div>
                    {/* Labelled شماره پیگیری — NOT the شماره on the paper form,
                        which is the requester's personnel number (spec §5). */}
                    <div className="text-xs text-muted-foreground">
                      {labels.trackingNo}:{' '}
                      {/* testid marks the VALUE, not the label — a caller reading
                          `serial-*` wants the number, not the chrome around it. */}
                      <span className="font-mono" dir="ltr" data-testid={`serial-${req.id}`}>
                        {formatSerialLocalized(req.serial_year, req.serial_seq, locale)}
                      </span>
                    </div>
                    {req.replacement_name && (
                      <div className="text-xs text-muted-foreground">
                        {labels.coverLabel}: {req.replacement_name}
                      </div>
                    )}
                    {/* Why it was rejected — optional, set by the decider. */}
                    {req.status === 'rejected' && req.decision_note && (
                      <div
                        className="mt-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                        data-testid={`decision-note-${req.id}`}
                      >
                        <span className="font-medium">{labels.rejectedReason}:</span>{' '}
                        {req.decision_note}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {/* Status badge */}
                    <span data-testid={`status-badge-${req.id}`}>
                      <StatusBadge
                        status={req.status as 'pending' | 'approved' | 'rejected' | 'cancelled'}
                        labels={statusLabels}
                      />
                    </span>

                    <RequestCancelButton
                      requestId={req.id}
                      status={req.status}
                      startDate={req.start_date}
                      onCancelled={() =>
                        setLocalRequests((prev) =>
                          prev.map((item) =>
                            item.id === req.id ? { ...item, status: 'cancelled' } : item
                          )
                        )
                      }
                      onError={setErrorMsg}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
