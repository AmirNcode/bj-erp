'use client';

import { useState, useTransition } from 'react';
import { approveRequest, rejectRequest } from '@/lib/actions/leave';
import type { PendingApproval, DecisionResult } from '@/lib/actions/leave';

type Labels = {
  empty: string;
  reason: string;
  approve: string;
  reject: string;
  approveConfirm: string;
  rejectConfirm: string;
  errorLabel: string;
  days: string;
  dayPartLabels: { full: string; am: string; pm: string };
};

type Props = {
  requests: PendingApproval[];
  labels: Labels;
  locale: string;
};

export function ApprovalQueue({ requests, labels, locale }: Props) {
  const [localRequests, setLocalRequests] = useState(requests);
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const decide = (
    id: string,
    confirmMsg: string,
    action: (id: string) => Promise<DecisionResult>
  ) => {
    if (!confirm(confirmMsg)) return;
    setErrorMsg('');
    startTransition(async () => {
      const res = await action(id);
      if (res.ok) {
        setLocalRequests((prev) => prev.filter((r) => r.id !== id));
      } else {
        setErrorMsg(res.error);
      }
    });
  };

  return (
    <div>
      {errorMsg && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 mb-4">
          <strong>{labels.errorLabel}:</strong> {errorMsg}
        </div>
      )}

      {localRequests.length === 0 ? (
        <p className="text-gray-500 text-sm" data-testid="approvals-empty">
          {labels.empty}
        </p>
      ) : (
        <div className="space-y-3">
          {localRequests.map((req) => {
            const typeName =
              locale === 'fa'
                ? req.leave_type_name_fa
                : req.leave_type_name_en ?? req.leave_type_name_fa;
            return (
              <div
                key={req.id}
                className="border border-gray-200 rounded-xl p-4 bg-white"
                data-testid={`approval-row-${req.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900">{req.employee_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{typeName}</div>
                    <div className="text-xs text-gray-500">
                      {req.start_date} — {req.end_date}
                    </div>
                    <div className="text-xs text-gray-500">
                      {labels.dayPartLabels[req.day_part]} · {req.requested_days} {labels.days}
                    </div>
                    {req.reason && (
                      <div className="text-xs text-gray-600 mt-1">
                        {labels.reason}: {req.reason}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <button
                      onClick={() => decide(req.id, labels.approveConfirm, approveRequest)}
                      disabled={isPending}
                      className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50"
                      data-testid={`approve-btn-${req.id}`}
                    >
                      {labels.approve}
                    </button>
                    <button
                      onClick={() => decide(req.id, labels.rejectConfirm, (id) => rejectRequest(id))}
                      disabled={isPending}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      data-testid={`reject-btn-${req.id}`}
                    >
                      {labels.reject}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
