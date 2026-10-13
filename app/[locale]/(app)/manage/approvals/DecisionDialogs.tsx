'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseRials } from '@/lib/leave/perDiem';
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
};

export type ApproveExtras = { override: boolean; perDiemRials: number | null };

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

  // An admin with no step of their own can only override; the database does
  // the same when asked to approve without one.
  const overrideOnly = !!options?.canOverride && !options.hasNaturalStep;
  const override = overrideOnly || (!!options?.canOverride && overrideChecked);
  const showPerDiem = override ? !!options?.perDiemOverride : !!options?.perDiemNatural;

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (open) {
          setSignatureData('');
          setSignatureAuthorized(false);
          setValidationError('');
          setOverrideChecked(false);
          setPerDiem('');
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
              onApprove(signatureData, signatureAuthorized, { override, perDiemRials });
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
  triggerClassName,
  triggerIcon,
}: {
  id: string;
  labels: RejectDialogLabels;
  disabled: boolean;
  /** Optional rejection note — an untouched field sends nothing. */
  note: string;
  onNoteChange: (value: string) => void;
  onReject: () => void;
} & TriggerProps) {
  const tc = useTranslations('common');
  return (
    <AlertDialog>
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
            onClick={onReject}
            data-testid={`reject-confirm-${id}`}
          >
            {labels.reject}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
