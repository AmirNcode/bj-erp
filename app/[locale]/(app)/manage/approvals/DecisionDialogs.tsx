'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
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
  triggerClassName,
  triggerIcon,
}: {
  id: string;
  labels: ApproveDialogLabels;
  disabled: boolean;
  onApprove: (signatureData: string, signatureAuthorized: boolean) => void;
} & TriggerProps) {
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
