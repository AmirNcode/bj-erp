'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { approveRequest, rejectRequest } from '@/lib/actions/leave';
import type { PendingApproval, DecisionResult } from '@/lib/actions/leave';
import { formatDuration } from '@/lib/leave/duration';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  RequestSignatureFields,
  RequestSignatureViewer,
  type SignatureLabels,
} from '../../request/_components/RequestSignature';
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
  requesterSignature: SignatureLabels;
  approverSignature: SignatureLabels;
  /** FR-36 chain progress. */
  chainTitle: string;
  awaiting: string;
  signed: string;
  stepLabels: Record<string, string>;
};

type Props = {
  requests: PendingApproval[];
  labels: Labels;
  locale: string;
  /** Company day length — durations are stored in minutes. */
  hoursPerDay: number;
};

function ApproveDialog({
  id,
  labels,
  disabled,
  onApprove,
}: {
  id: string;
  labels: Labels;
  disabled: boolean;
  onApprove: (signatureData: string, signatureAuthorized: boolean) => void;
}) {
  const tc = useTranslations('common');
  const [signatureData, setSignatureData] = useState('');
  const [signatureAuthorized, setSignatureAuthorized] = useState(false);
  const [validationError, setValidationError] = useState('');

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (open) {
          setSignatureData('');
          setSignatureAuthorized(false);
          setValidationError('');
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" disabled={disabled} data-testid={`approve-btn-${id}`}>
          {labels.approve}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.approve}</AlertDialogTitle>
          <AlertDialogDescription>{labels.approveConfirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <RequestSignatureFields
          idPrefix={`approval-${id}`}
          value={signatureData}
          onChange={setSignatureData}
          authorized={signatureAuthorized}
          onAuthorizedChange={setSignatureAuthorized}
          labels={labels.approverSignature}
        />
        {validationError && (
          <p className="text-sm text-destructive" role="alert">
            {validationError}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              if (!signatureData) {
                event.preventDefault();
                setValidationError(labels.approverSignature.validationSignature);
                return;
              }
              if (!signatureAuthorized) {
                event.preventDefault();
                setValidationError(labels.approverSignature.validationAuthorization);
                return;
              }
              onApprove(signatureData, signatureAuthorized);
            }}
            data-testid={`approve-confirm-${id}`}
          >
            {labels.approve}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
                        {formatCalendarDate(req.start_date, locale)} —{' '}
                        {formatCalendarDate(req.end_date, locale)}
                      </div>
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
                      {/* FR-36: who has signed and who is still needed. A queue
                          that only says "pending" hides half the state now that
                          two people must sign. */}
                      <div
                        className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"
                        data-testid={`chain-${req.id}`}
                      >
                        <span className="text-muted-foreground">{labels.chainTitle}:</span>
                        {(() => {
                          const approved = new Set(
                            req.signed.filter((x) => x.decision === 'approved').map((x) => x.stepRole)
                          );
                          // Everyone required, in order: those already approved
                          // plus those still outstanding.
                          const all = [...approved, ...req.outstanding.filter((r) => !approved.has(r))];
                          return all.map((role) => (
                            <span
                              key={role}
                              data-testid={`chain-${req.id}-${role}`}
                              className={
                                approved.has(role)
                                  ? 'rounded bg-success/10 px-1.5 py-0.5 text-success'
                                  : 'rounded bg-secondary px-1.5 py-0.5 text-muted-foreground'
                              }
                            >
                              {approved.has(role) ? '✓' : '○'}{' '}
                              {labels.stepLabels[role] ?? role}
                            </span>
                          ));
                        })()}
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
                      <RequestSignatureViewer
                        requestId={req.id}
                        consentAt={req.signature_consent_at}
                        labels={labels.requesterSignature}
                        locale={locale}
                      />
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <ApproveDialog
                        id={req.id}
                        labels={labels}
                        disabled={isPending}
                        onApprove={(signatureData, signatureAuthorized) =>
                          decide(req.id, labels.approveSuccess, (id) =>
                            approveRequest(id, { signatureData, signatureAuthorized })
                          )
                        }
                      />

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
