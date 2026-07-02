'use client';

import { useState, useEffect, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { cancelRequest } from '@/lib/actions/leave';
import type { LeaveRequestWithType } from '@/lib/actions/leave';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatNumber, localizedLeaveTypeName } from '@/lib/i18n/format';
import { isCancellable } from '@/lib/leave/cancellable';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

// Client "today" (YYYY-MM-DD); the SQL re-checks against current_date on cancel.
// Computed per call (not module scope) so a tab left open overnight stays correct.
const today = () => new Date().toISOString().slice(0, 10);

type Labels = {
  myRequests: string;
  noRequests: string;
  cancel: string;
  cancelConfirm?: string;
  cancelApprovedConfirm?: string;
  cancelSuccess: string;
  errorLabel: string;
  statusPending: string;
  statusApproved: string;
  statusRejected: string;
  statusCancelled: string;
  dayPartLabels: { full: string; am: string; pm: string };
  days: string;
  from: string;
  to: string;
};

type Props = {
  requests: LeaveRequestWithType[];
  labels: Labels;
  calendarPref: string;
  locale: string;
};

export function MyRequestsList({ requests, labels, calendarPref, locale }: Props) {
  const tc = useTranslations('common');
  const [localRequests, setLocalRequests] = useState(requests);
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  // Sync localRequests when the server re-renders with fresh data (e.g. after
  // router.refresh() surfaces a newly-submitted request). This server→local
  // resync is the intended use of the effect, not a derived-state smell.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop→state sync
    setLocalRequests(requests);
  }, [requests]);

  const handleCancel = (id: string) => {
    setErrorMsg('');
    startTransition(async () => {
      const res = await cancelRequest(id);
      if (res.ok) {
        setLocalRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r))
        );
        toast.success(labels.cancelSuccess);
      } else {
        setErrorMsg(res.error);
        toast.error(res.error);
      }
    });
  };

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
            const cancelPrompt =
              req.status === 'approved' ? labels.cancelApprovedConfirm : labels.cancelConfirm;

            return (
              <Card
                key={req.id}
                className="p-4 gap-0"
                data-testid={`request-row-${req.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Leave type name */}
                    <div className="font-medium text-sm text-foreground">
                      {req.leave_types ? localizedLeaveTypeName(req.leave_types, locale) : '—'}
                    </div>
                    {/* Date range */}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {labels.from} {formatCalendarDate(req.start_date, calendarPref, locale)}{' '}
                      {labels.to} {formatCalendarDate(req.end_date, calendarPref, locale)}
                    </div>
                    {/* Day part */}
                    <div className="text-xs text-muted-foreground">
                      {labels.dayPartLabels[req.day_part]} ·{' '}
                      {formatNumber(req.requested_days, locale)} {labels.days}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {/* Status badge */}
                    <span data-testid={`status-badge-${req.id}`}>
                      <StatusBadge
                        status={req.status as 'pending' | 'approved' | 'rejected' | 'cancelled'}
                        labels={statusLabels}
                      />
                    </span>

                    {/* Cancel — pending, or an approved leave that hasn't started */}
                    {isCancellable(req.status, req.start_date, today()) && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isPending}
                            className="text-destructive h-auto px-2 py-0.5 text-xs"
                            data-testid={`cancel-btn-${req.id}`}
                          >
                            {labels.cancel}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent size="sm">
                          <AlertDialogHeader>
                            <AlertDialogTitle>{labels.cancel}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {cancelPrompt}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => handleCancel(req.id)}
                              data-testid={`cancel-confirm-${req.id}`}
                            >
                              {labels.cancel}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
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
