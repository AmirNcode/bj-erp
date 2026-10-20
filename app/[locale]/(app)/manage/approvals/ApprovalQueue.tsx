'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { progressLabel } from '@/lib/leave/approval-context';
import { toast } from 'sonner';
import { approveRequest, rejectRequest } from '@/lib/actions/leave/approvals';
import type { PendingApproval, DecisionResult } from '@/lib/actions/leave/approvals';
import { formatDuration } from '@/lib/leave/duration';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { Card, CardContent } from '@/components/ui/card';
import {
  RequestSignatureViewer,
  type SignatureLabels,
} from '../../request/_components/RequestSignature';
import { ApproveDialog, RejectDialog } from './DecisionDialogs';

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

export function ApprovalQueue({ requests, labels, locale, hoursPerDay }: Props) {
  const router = useRouter();
  // A decision can leave another step for the same signer; refresh the live queue.
  const tEvidence = useTranslations('approvalEvidence');
  const localRequests = requests;
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
        toast.success(successMsg);
        if (res.warning) toast.warning(res.warning);
        // Re-fetch server data so badges/counts elsewhere reflect the decision.
        router.refresh();
      } else {
        setErrorMsg(res.error);
        toast.error(res.error);
        // Most often the requester cancelled, or another approver decided,
        // since this page loaded: refresh so the stale row goes away.
        router.refresh();
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
                        - {formatDuration(req.requested_minutes, hoursPerDay, locale, labels)}
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
                        {(req.progress ?? []).map((step, index) => (
                          <span key={step.step_id ?? `legacy-${index}`} className="rounded bg-secondary px-1.5 py-0.5" data-testid={`chain-${req.id}-${step.step_id ?? index}`}>
                            {step.decision === 'approved' || step.evidence_kind === 'hr_exempt' ? '✓ ' : '○ '}
                            {step.named ? step.expected_name : labels.stepLabels[progressLabel(step)]}
                            {step.evidence_kind === 'automatic' && ` · ${tEvidence('automaticShort')}`}
                            {step.evidence_kind === 'hr_exempt' && ` · ${tEvidence('hrExempt')}`}
                            {step.evidence_kind === 'delegated' && ` · ${tEvidence('onBehalf', { name: step.principal_name ?? '—' })}`}
                          </span>
                        ))}
                      </div>
                      {req.configuration_changed && <p className="mt-2 text-xs text-warning">{tEvidence('configurationChanged')}</p>}
                      {req.legacy_reconciliation_required && <p className="mt-2 text-xs text-warning">{tEvidence('legacyReconciliation')}</p>}
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
                        disabled={isPending || (!req.natural_step && !req.can_override)}
                        options={{
                          hasNaturalStep: req.natural_step !== null,
                          canOverride: req.can_override,
                          perDiemNatural: req.per_diem_natural,
                          perDiemOverride: req.per_diem_override,
                          steps: req.decision_steps,
                          travel: req.travel,
                        }}
                        onApprove={(signatureData, signatureAuthorized, extras) =>
                          decide(req.id, labels.approveSuccess, (id) =>
                            approveRequest(id, { signatureData, signatureAuthorized, ...extras })
                          )
                        }
                      />

                      <RejectDialog
                        id={req.id}
                        labels={labels}
                        disabled={isPending || req.can_reject === false}
                        steps={req.rejection_steps}
                        note={rejectNotes[req.id] ?? ''}
                        onNoteChange={(v) => setRejectNotes((n) => ({ ...n, [req.id]: v }))}
                        onReject={(stepId) =>
                          decide(req.id, labels.rejectSuccess, (id) =>
                            rejectRequest(id, rejectNotes[id], stepId)
                          )
                        }
                      />
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
