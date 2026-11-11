'use client';

import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
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
import { Button } from '@/components/ui/button';
import {
  RequestSignatureViewer,
} from '../../request/_components/RequestSignature';
import { ApproveDialog, RejectDialog } from './DecisionDialogs';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { PersonAvatar } from '@/components/PersonAvatar';

/** This screen's copy. */
function useLabels() {
  const t = useTranslations('approvals');
  const tLeave = useTranslations('leave');
  const tRepl = useTranslations('replacement');
  const tErrand = useTranslations('errand');
  const tSignature = useTranslations('signature');
  return {
    empty: t('empty'),
    reason: t('reason'),
    approve: t('approve'),
    reject: t('reject'),
    approveConfirm: t('approveConfirm'),
    rejectConfirm: t('rejectConfirm'),
    rejectReasonLabel: t('rejectReasonLabel'),
    rejectReasonPlaceholder: t('rejectReasonPlaceholder'),
    errorLabel: t('error'),
    approveSuccess: t('approveSuccess'),
    rejectSuccess: t('rejectSuccess'),
    coverLabel: tRepl('coverLabel'),
    coverConflict: tRepl('coverConflict'),
    coverSignoff: {
      pending: tRepl('signoffPending'),
      signed: tRepl('signoffSigned'),
      declined: tRepl('signoffDeclined'),
    },
    trackingNo: tLeave('trackingNo'),
    errandBadge: tErrand('badge'),
    errandLocation: tErrand('location'),
    requesterSignature: signatureLabelsFrom(tSignature, 'requesterTitle'),
    approverSignature: signatureLabelsFrom(tSignature, 'approverTitle'),
    chainTitle: t('chainTitle'),
    awaiting: t('awaiting'),
    signed: t('signed'),
    stepLabels: {
      manager: t('steps.manager'),
      departmentManager: t('steps.departmentManager'),
      hr: t('steps.hr'),
      security: t('steps.security'),
      admin: t('steps.admin'),
    } as Record<string, string>,
    ...durationLabelsFrom(tLeave), // days/hours/minutes/and
    dayPartLabels: {
      full: tLeave('dayPart.full'),
      am: tLeave('dayPart.am'),
      pm: tLeave('dayPart.pm'),
    },
  };
}

type Props = {
  requests: PendingApproval[];
  locale: string;
  /** Company day length — durations are stored in minutes. */
  hoursPerDay: number;
};

const ACTION = 'h-11 w-[calc(50%-0.25rem)] md:h-9 md:w-auto';

export function ApprovalQueue({ requests, locale, hoursPerDay }: Props) {
  const labels = useLabels();
  const tHistory = useTranslations('approvals.history');
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
              <Card key={req.id} className="gap-0 py-0" data-testid={`approval-row-${req.id}`}>
                {/* Phones: one centred column — who, what, signature, then
                    Approve/Reject on one line and View form + travel tick below.
                    Desktop: details at the start, the two decisions at the end,
                    secondary actions in a footer row. Nothing here is shrink-0
                    with free text in it: a long travel warning once squeezed the
                    details into a one-word column. */}
                <CardContent className="grid gap-x-6 gap-y-4 p-4 text-center md:grid-cols-[minmax(0,1fr)_9rem] md:p-5 md:text-start">
                  <div className="min-w-0">
                    <div className="flex flex-col items-center gap-1.5 md:flex-row md:gap-2.5">
                      <PersonAvatar id={req.employee_id} name={req.employee_name} />
                      <div className="min-w-0 max-w-full truncate text-[15px] font-semibold text-foreground">
                        <bdi>{req.employee_name}</bdi>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">{req.personnel_no ?? '—'}</span>
                        {/* A work errand is not time off — tag it so the manager
                            never reads one as a leave request. */}
                        {req.kind === 'errand' && (
                          <span
                            className="inline-flex shrink-0 items-center rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-primary"
                            data-testid={`errand-badge-${req.id}`}
                          >
                            {labels.errandBadge}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 space-y-1 text-[13px] text-muted-foreground">
                      {req.kind === 'errand' ? (
                        <div className="text-sm text-foreground" data-testid={`errand-location-${req.id}`}>
                          {labels.errandLocation}: {req.errand_location ?? '—'}
                        </div>
                      ) : (
                        <div className="text-sm text-foreground">{typeName}</div>
                      )}
                      <div>
                        {formatCalendarDate(req.start_date, locale)} —{' '}
                        {formatCalendarDate(req.end_date, locale)}
                      </div>
                      <div>
                        {req.unit === 'hour'
                          ? formatTimeRange(req.start_time, req.end_time, locale)
                          : labels.dayPartLabels[req.day_part]}{' '}
                        - {formatDuration(req.requested_minutes, hoursPerDay, locale, labels)}
                      </div>
                      {/* Labelled شماره پیگیری — NOT the شماره on the paper form,
                          which is the requester's personnel number (spec §5). */}
                      <div>
                        {labels.trackingNo}:{' '}
                        {/* testid marks the VALUE, not the label — a caller reading
                            `serial-*` wants the number, not the chrome around it. */}
                        <span className="font-mono" dir="ltr" data-testid={`serial-${req.id}`}>
                          {formatSerialLocalized(req.serial_year, req.serial_seq, locale)}
                        </span>
                      </div>
                      {req.replacement_name && (
                        <div data-testid={`cover-${req.id}`}>
                          {labels.coverLabel}: {req.replacement_name}
                          {req.replacement_conflict && (
                            <span className="ms-1 text-destructive" data-testid={`cover-conflict-${req.id}`}>
                              ({labels.coverConflict})
                            </span>
                          )}
                          {/* FR-88: for information only; approval never waits for it. */}
                          {req.replacement_signoff_status && (
                            <span className="ms-1 text-muted-foreground" data-testid={`cover-signoff-${req.id}`}>
                              · {labels.coverSignoff[req.replacement_signoff_status]}
                            </span>
                          )}
                        </div>
                      )}
                      {req.reason && (
                        <div>
                          {labels.reason}: {req.reason}
                        </div>
                      )}
                    </div>

                    {/* FR-36: who has signed and who is still needed. A queue
                        that only says "pending" hides half the state now that
                        two people must sign. */}
                    <div
                      className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-xs md:justify-start"
                      data-testid={`chain-${req.id}`}
                    >
                      <span className="text-muted-foreground">{labels.chainTitle}:</span>
                      {(req.progress ?? []).map((step, index) => (
                        <span key={step.step_id ?? `legacy-${index}`} className="rounded-sm bg-secondary px-1.5 py-0.5" data-testid={`chain-${req.id}-${step.step_id ?? index}`}>
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

                    {/* View signature and the paper form side by side, like History's
                        View form + Edit. The travel tick lives in the approve dialog. */}
                    <div className="flex flex-wrap items-start gap-x-2 md:gap-x-5">
                      {/* The button already says "View signature": no title above it. */}
                      <RequestSignatureViewer
                        requestId={req.id}
                        consentAt={req.signature_consent_at}
                        labels={labels.requesterSignature}
                        locale={locale}
                        hideTitle
                        buttonClassName={ACTION}
                      />
                      <Button variant="outline" size="sm" className={`mt-3 ${ACTION}`} asChild>
                        <Link href={`/${locale}/print/request/${req.id}`} target="_blank" rel="noopener">
                          <Printer aria-hidden="true" />
                          {tHistory('view')}
                        </Link>
                      </Button>
                    </div>
                  </div>

                  {/* Decisions: one line on phones, stacked at the end on desktop. */}
                  <div className="flex gap-2 md:flex-col">
                    {(req.natural_step || req.can_override) && <ApproveDialog
                      id={req.id}
                      labels={labels}
                      disabled={isPending || (!req.natural_step && !req.can_override)}
                      triggerClassName="h-11 flex-1 md:h-9 md:flex-none"
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
                    />}

                    {(req.can_reject !== false) && <RejectDialog
                      id={req.id}
                      labels={labels}
                      disabled={isPending}
                      triggerClassName="h-11 flex-1 md:h-9 md:flex-none"
                      steps={req.rejection_steps}
                      note={rejectNotes[req.id] ?? ''}
                      onNoteChange={(v) => setRejectNotes((n) => ({ ...n, [req.id]: v }))}
                      onReject={(stepId) =>
                        decide(req.id, labels.rejectSuccess, (id) =>
                          rejectRequest(id, rejectNotes[id], stepId)
                        )
                      }
                    />}
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
