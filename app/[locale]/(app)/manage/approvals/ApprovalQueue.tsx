'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { approveRequest, rejectRequest } from '@/lib/actions/leave';
import type { PendingApproval, DecisionResult } from '@/lib/actions/leave';
import { formatDuration } from '@/lib/leave/duration';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

type Labels = {
  empty: string;
  reason: string;
  approve: string;
  reject: string;
  approveConfirm: string;
  rejectConfirm: string;
  rejectReasonLabel: string;
  rejectReasonPlaceholder: string;
  errorLabel: string;
  approveSuccess: string;
  rejectSuccess: string;
  coverLabel: string;
  coverConflict: string;
  trackingNo: string;
  errandBadge: string;
  errandLocation: string;
  days: string;
  hours: string;
  minutes: string;
  and: string;
  dayPartLabels: { full: string; am: string; pm: string };
};

type Props = {
  requests: PendingApproval[];
  labels: Labels;
  locale: string;
  /** Company day length — durations are stored in minutes. */
  hoursPerDay: number;
};

export function ApprovalQueue({ requests, labels, locale, hoursPerDay }: Props) {
  const tc = useTranslations('common');
  const router = useRouter();
  const [localRequests, setLocalRequests] = useState(requests);
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();
  // Per-request rejection note. Optional — an untouched field sends nothing.
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

  const decide = (
    id: string,
    successMsg: string,
    action: (id: string) => Promise<DecisionResult>
  ) => {
    setErrorMsg('');
    startTransition(async () => {
      const res = await action(id);
      if (res.ok) {
        setLocalRequests((prev) => prev.filter((r) => r.id !== id));
        toast.success(successMsg);
        // Re-fetch server data so badges/counts elsewhere reflect the decision.
        router.refresh();
      } else {
        setErrorMsg(res.error);
        toast.error(res.error);
      }
    });
  };

  return (
    <div>
      {errorMsg && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-4">
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
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-sm text-foreground truncate">
                          {req.employee_name}
                        </div>
                        {/* A work errand is not time off — tag it so the manager
                            never reads one as a leave request. */}
                        {req.kind === 'errand' && (
                          <span
                            className="inline-flex shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
                            data-testid={`errand-badge-${req.id}`}
                          >
                            {labels.errandBadge}
                          </span>
                        )}
                      </div>
                      {req.kind === 'errand' ? (
                        <div
                          className="text-xs text-muted-foreground mt-0.5"
                          data-testid={`errand-location-${req.id}`}
                        >
                          {labels.errandLocation}: {req.errand_location ?? '—'}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground mt-0.5">{typeName}</div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {req.start_date} — {req.end_date}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {req.unit === 'hour'
                          ? formatTimeRange(req.start_time, req.end_time, locale)
                          : labels.dayPartLabels[req.day_part]}{' '}
                        · {formatDuration(req.requested_minutes, hoursPerDay, locale, labels)}
                      </div>
                      {/* Labelled شماره پیگیری — NOT the شماره on the paper form,
                          which is the requester's personnel number (spec §5). */}
                      <div className="text-xs text-muted-foreground" data-testid={`serial-${req.id}`}>
                        {labels.trackingNo}:{' '}
                        <span className="font-mono" dir="ltr">
                          {formatSerialLocalized(req.serial_year, req.serial_seq, locale)}
                        </span>
                      </div>
                      {req.replacement_name && (
                        <div className="text-xs text-muted-foreground mt-1" data-testid={`cover-${req.id}`}>
                          {labels.coverLabel}: {req.replacement_name}
                          {req.replacement_conflict && (
                            <span className="ms-1 text-destructive" data-testid={`cover-conflict-${req.id}`}>
                              ({labels.coverConflict})
                            </span>
                          )}
                        </div>
                      )}
                      {req.reason && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {labels.reason}: {req.reason}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {/* Approve */}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            disabled={isPending}
                            data-testid={`approve-btn-${req.id}`}
                          >
                            {labels.approve}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent size="sm">
                          <AlertDialogHeader>
                            <AlertDialogTitle>{labels.approve}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {labels.approveConfirm}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => decide(req.id, labels.approveSuccess, approveRequest)}
                              data-testid={`approve-confirm-${req.id}`}
                            >
                              {labels.approve}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      {/* Reject */}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            data-testid={`reject-btn-${req.id}`}
                          >
                            {labels.reject}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent size="sm">
                          <AlertDialogHeader>
                            <AlertDialogTitle>{labels.reject}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {labels.rejectConfirm}
                            </AlertDialogDescription>
                          </AlertDialogHeader>

                          <div className="space-y-1.5 text-start">
                            <Label htmlFor={`reject-reason-${req.id}`}>
                              {labels.rejectReasonLabel}
                            </Label>
                            <Textarea
                              id={`reject-reason-${req.id}`}
                              data-testid={`reject-reason-${req.id}`}
                              rows={3}
                              maxLength={500}
                              placeholder={labels.rejectReasonPlaceholder}
                              value={rejectNotes[req.id] ?? ''}
                              onChange={(e) =>
                                setRejectNotes((n) => ({ ...n, [req.id]: e.target.value }))
                              }
                            />
                          </div>

                          <AlertDialogFooter>
                            <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                decide(req.id, labels.rejectSuccess, (id) =>
                                  rejectRequest(id, rejectNotes[id])
                                )
                              }
                              data-testid={`reject-confirm-${req.id}`}
                            >
                              {labels.reject}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
