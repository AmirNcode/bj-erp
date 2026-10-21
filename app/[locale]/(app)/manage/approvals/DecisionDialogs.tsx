'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseRials } from '@/lib/leave/perDiem';
import type { TravellerField } from '@/lib/travel/fields';
import { bundleStepIds, type ApprovalChoice } from '@/lib/leave/approval-context';
import { nativeSelectClass } from '@/lib/native-select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  RequestSignatureFields,
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

/**
 * Approve (with the approver's signature) and reject (with an optional note)
 * confirm dialogs. Shared by the Approvals queue and the home dashboard's
 * inline approval rows, so both decide through the same flow.
 */

export type ApproveDialogLabels = {
  approve: string;
  approveConfirm: string;
  approverSignature: SignatureLabels;
};

export type RejectDialogLabels = {
  reject: string;
  rejectConfirm: string;
  rejectReasonLabel: string;
  rejectReasonPlaceholder: string;
};

/**
 * What this approval may do (FR-58, FR-61). Absent = sign one step, no per diem
 * (the pre-2026-10-12 behaviour).
 */
export type ApproveOptions = {
  /** The caller has a step of their own to sign. */
  hasNaturalStep: boolean;
  /** Admin: may sign every outstanding step at once. */
  canOverride: boolean;
  /** Whether the natural step / the override takes a per diem. */
  perDiemNatural: boolean;
  perDiemOverride: boolean;
  steps?: ApprovalChoice[];
  /**
   * FR-70: a daily errand whose HR step may mark «نیاز به رزرو سفر». Shown with the
   * per diem field; `missingFields` are the traveller details still empty.
   */
  travel?: { employeeId: string; missingFields: TravellerField[] } | null;
};

export type ApproveExtras = {
  override: boolean;
  perDiemRials: number | null;
  /** FR-71: every step the one signature approves; empty with the override. */
  stepIds: string[];
  /** FR-70: HR marked the trip as needing travel booking. */
  travelBooking: boolean;
};

function TravelBookingBox({ id, travel, checked, onChange }: {
  id: string;
  travel: NonNullable<ApproveOptions['travel']>;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations('travel');
  const locale = useLocale();
  return (
    <div className="space-y-1.5 text-start">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-4"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={`travel-booking-${id}`}
        />
        <span>
          <span className="font-medium">{t('tickLabel')}</span>
          <span className="block text-xs text-muted-foreground">{t('tickHint')}</span>
        </span>
      </label>
      {checked && travel.missingFields.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-testid={`travel-missing-${id}`}>
          {t('missingWarning', { fields: new Intl.ListFormat(locale, { type: 'conjunction' }).format(travel.missingFields.map((f) => t(`fields.${f}`))) })}{' '}
          <Link href={`/${locale}/manage/employees/${travel.employeeId}`} className="font-medium underline">
            {t('missingLink')}
          </Link>
        </p>
      )}
    </div>
  );
}

function useStepName() {
  const t = useTranslations('approvalEvidence');
  const tSteps = useTranslations('approvals.steps');
  return (step: ApprovalChoice) => {
    const title = step.name ?? tSteps(step.label);
    return step.delegated ? `${title} · ${t('onBehalf', { name: step.principalName ?? '—' })}` : title;
  };
}

/** FR-71: the steps one signature approves, listed rather than picked. */
function SigningAs({ id, steps }: { id: string; steps: ApprovalChoice[] }) {
  const t = useTranslations('approvals');
  const locale = useLocale();
  const stepName = useStepName();
  if (!steps.length) return null;
  return (
    <div className="rounded-md bg-muted px-3 py-2 text-sm" data-testid={`approve-steps-${id}`}>
      <span className="font-medium">{t('signingAs')}</span>{' '}
      {new Intl.ListFormat(locale, { type: 'conjunction' }).format(steps.map(stepName))}
    </div>
  );
}

function StepChoice({ id, steps, value, onChange }: {
  id: string; steps: ApprovalChoice[]; value: string; onChange: (id: string) => void;
}) {
  const t = useTranslations('approvalEvidence');
  const stepName = useStepName();
  if (!steps.length) return null;
  if (steps.length === 1) return <p className="rounded-md bg-muted px-3 py-2 text-sm">{stepName(steps[0])}</p>;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t('selectStep')}</Label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={nativeSelectClass}>
        {steps.map((step) => <option key={step.stepId ?? 'legacy'} value={step.stepId ?? ''}>{stepName(step)}</option>)}
      </select>
    </div>
  );
}

type TriggerProps = {
  /** Extra classes for the trigger button (the home rows use larger buttons). */
  triggerClassName?: string;
  /** Optional icon before the trigger label. */
  triggerIcon?: React.ReactNode;
};

export function ApproveDialog({
  id,
  labels,
  disabled,
  onApprove,
  options,
  triggerClassName,
  triggerIcon,
}: {
  id: string;
  labels: ApproveDialogLabels;
  disabled: boolean;
  onApprove: (signatureData: string, signatureAuthorized: boolean, extras: ApproveExtras) => void;
  options?: ApproveOptions;
} & TriggerProps) {
  const tc = useTranslations('common');
  const t = useTranslations('approvals');
  const [signatureData, setSignatureData] = useState('');
  const [signatureAuthorized, setSignatureAuthorized] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [perDiem, setPerDiem] = useState('');
  const [travelBooking, setTravelBooking] = useState(false);
  const steps = options?.steps ?? [];

  // An admin with no step of their own can only override; the database does
  // the same when asked to approve without one.
  const overrideOnly = !!options?.canOverride && !options.hasNaturalStep;
  const override = overrideOnly || (!!options?.canOverride && overrideChecked);
  const showPerDiem = override ? !!options?.perDiemOverride : (steps.some((step) => step.perDiem) || !!options?.perDiemNatural);
  const showTravel = showPerDiem && !!options?.travel;

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (open) {
          setSignatureData('');
          setSignatureAuthorized(false);
          setValidationError('');
          setOverrideChecked(false);
          setPerDiem('');
          setTravelBooking(false);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          disabled={disabled}
          data-testid={`approve-btn-${id}`}
          className={triggerClassName}
        >
          {triggerIcon}
          {labels.approve}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.approve}</AlertDialogTitle>
          <AlertDialogDescription>{labels.approveConfirm}</AlertDialogDescription>
        </AlertDialogHeader>
        {!override && <SigningAs id={id} steps={steps} />}
        {overrideOnly && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm" data-testid={`approve-override-only-${id}`}>
            {t('overrideOnly')}
          </p>
        )}
        {options?.canOverride && !overrideOnly && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={overrideChecked}
              onChange={(e) => setOverrideChecked(e.target.checked)}
              data-testid={`approve-override-${id}`}
            />
            <span>{t('overrideLabel')}</span>
          </label>
        )}
        {showPerDiem && (
          <div className="space-y-1.5 text-start">
            <Label htmlFor={`per-diem-${id}`}>{t('perDiemLabel')}</Label>
            <Input
              id={`per-diem-${id}`}
              data-testid={`per-diem-${id}`}
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              value={perDiem}
              onChange={(e) => setPerDiem(e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">{t('perDiemHint')}</p>
          </div>
        )}
        {showTravel && options?.travel && (
          <TravelBookingBox id={id} travel={options.travel} checked={travelBooking} onChange={setTravelBooking} />
        )}
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
              let perDiemRials: number | null = null;
              if (showPerDiem && perDiem.trim() !== '') {
                perDiemRials = parseRials(perDiem);
                if (Number.isNaN(perDiemRials)) {
                  event.preventDefault();
                  setValidationError(t('perDiemInvalid'));
                  return;
                }
              }
              onApprove(signatureData, signatureAuthorized, {
                override, perDiemRials,
                stepIds: override ? [] : bundleStepIds(steps),
                travelBooking: showTravel && travelBooking,
              });
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

export function RejectDialog({
  id,
  labels,
  disabled,
  note,
  onNoteChange,
  onReject,
  steps,
  triggerClassName,
  triggerIcon,
}: {
  id: string;
  labels: RejectDialogLabels;
  disabled: boolean;
  /** Optional rejection note — an untouched field sends nothing. */
  note: string;
  onNoteChange: (value: string) => void;
  onReject: (stepId?: string | null) => void;
  steps?: ApprovalChoice[];
} & TriggerProps) {
  const tc = useTranslations('common');
  const [selectedStepId, setSelectedStepId] = useState('');
  const selected = steps?.find((step) => (step.stepId ?? '') === selectedStepId) ?? steps?.[0];
  return (
    <AlertDialog onOpenChange={(open) => { if (open) setSelectedStepId(steps?.[0]?.stepId ?? ''); }}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          data-testid={`reject-btn-${id}`}
          className={triggerClassName}
        >
          {triggerIcon}
          {labels.reject}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.reject}</AlertDialogTitle>
          <AlertDialogDescription>{labels.rejectConfirm}</AlertDialogDescription>
        </AlertDialogHeader>
        {steps && <StepChoice id={`reject-step-${id}`} steps={steps} value={selected?.stepId ?? ''} onChange={setSelectedStepId} />}

        <div className="space-y-1.5 text-start">
          <Label htmlFor={`reject-reason-${id}`}>{labels.rejectReasonLabel}</Label>
          <Textarea
            id={`reject-reason-${id}`}
            data-testid={`reject-reason-${id}`}
            rows={3}
            maxLength={500}
            placeholder={labels.rejectReasonPlaceholder}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => onReject(selected?.stepId ?? null)}
            data-testid={`reject-confirm-${id}`}
          >
            {labels.reject}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
