'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { approveRequest, rejectRequest } from '@/lib/actions/leave';
import type { PendingApproval, DecisionResult } from '@/lib/actions/leave';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Labels = {
  empty: string;
  reason: string;
  approve: string;
  reject: string;
  approveConfirm: string;
  rejectConfirm: string;
  errorLabel: string;
  approveSuccess: string;
  rejectSuccess: string;
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
    successMsg: string,
    action: (id: string) => Promise<DecisionResult>
  ) => {
    if (!confirm(confirmMsg)) return;
    setErrorMsg('');
    startTransition(async () => {
      const res = await action(id);
      if (res.ok) {
        setLocalRequests((prev) => prev.filter((r) => r.id !== id));
        toast.success(successMsg);
      } else {
        setErrorMsg(res.error);
        toast.error(res.error);
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
        <p className="text-muted-foreground text-sm" data-testid="approvals-empty">
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
              <Card key={req.id} data-testid={`approval-row-${req.id}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-foreground">{req.employee_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{typeName}</div>
                      <div className="text-xs text-muted-foreground">
                        {req.start_date} — {req.end_date}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {labels.dayPartLabels[req.day_part]} · {req.requested_days} {labels.days}
                      </div>
                      {req.reason && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {labels.reason}: {req.reason}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() =>
                          decide(req.id, labels.approveConfirm, labels.approveSuccess, approveRequest)
                        }
                        disabled={isPending}
                        data-testid={`approve-btn-${req.id}`}
                      >
                        {labels.approve}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          decide(req.id, labels.rejectConfirm, labels.rejectSuccess, (id) =>
                            rejectRequest(id)
                          )
                        }
                        disabled={isPending}
                        data-testid={`reject-btn-${req.id}`}
                      >
                        {labels.reject}
                      </Button>
                    </div>
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
