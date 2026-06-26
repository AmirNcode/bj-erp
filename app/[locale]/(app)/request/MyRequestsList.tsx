'use client';

import { useState, useTransition } from 'react';
import { cancelRequest } from '@/lib/actions/leave';
import type { LeaveRequestWithType } from '@/lib/actions/leave';
import { gregorianToJalali } from '@/lib/leave/dateConvert';
import { isCancellable } from '@/lib/leave/cancellable';

// Client "today" (YYYY-MM-DD); the SQL re-checks against current_date on cancel.
const TODAY = new Date().toISOString().slice(0, 10);

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
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

function formatDate(dateStr: string, calendarPref: string): string {
  // Stored dates are Gregorian; show Jalali when that's the user's preference.
  return calendarPref === 'jalali' ? gregorianToJalali(dateStr) : dateStr;
}

export function MyRequestsList({ requests, labels, calendarPref }: Props) {
  const [localRequests, setLocalRequests] = useState(requests);
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleCancel = (id: string, status: string) => {
    const prompt =
      status === 'approved'
        ? labels.cancelApprovedConfirm ?? labels.cancelConfirm ?? 'Cancel this request?'
        : labels.cancelConfirm ?? 'Cancel this request?';
    if (!confirm(prompt)) return;
    setErrorMsg('');
    startTransition(async () => {
      const res = await cancelRequest(id);
      if (res.ok) {
        setLocalRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r))
        );
      } else {
        setErrorMsg(res.error);
      }
    });
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'pending': return labels.statusPending;
      case 'approved': return labels.statusApproved;
      case 'rejected': return labels.statusRejected;
      case 'cancelled': return labels.statusCancelled;
      default: return status;
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">{labels.myRequests}</h2>

      {errorMsg && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 mb-4">
          <strong>{labels.errorLabel}:</strong> {errorMsg}
        </div>
      )}

      {localRequests.length === 0 ? (
        <p className="text-gray-500 text-sm">{labels.noRequests}</p>
      ) : (
        <div className="space-y-3">
          {localRequests.map((req) => (
            <div
              key={req.id}
              className="border border-gray-200 rounded-xl p-4 bg-white"
              data-testid={`request-row-${req.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Leave type name */}
                  <div className="font-medium text-sm text-gray-900">
                    {req.leave_types?.name_fa ?? '—'}
                  </div>
                  {/* Date range */}
                  <div className="text-xs text-gray-500 mt-0.5">
                    {labels.from} {formatDate(req.start_date, calendarPref)}{' '}
                    {labels.to} {formatDate(req.end_date, calendarPref)}
                  </div>
                  {/* Day part */}
                  <div className="text-xs text-gray-500">
                    {labels.dayPartLabels[req.day_part]} · {req.requested_days} {labels.days}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  {/* Status badge */}
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[req.status] ?? ''}`}
                    data-testid={`status-badge-${req.id}`}
                  >
                    {statusLabel(req.status)}
                  </span>

                  {/* Cancel — pending, or an approved leave that hasn't started */}
                  {isCancellable(req.status, req.start_date, TODAY) && (
                    <button
                      onClick={() => handleCancel(req.id, req.status)}
                      disabled={isPending}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      data-testid={`cancel-btn-${req.id}`}
                    >
                      {labels.cancel}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
