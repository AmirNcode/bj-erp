'use client';

/**
 * Sign one row of a clearance form, or the final finance box (FR-54 D5, D6):
 * an optional remark (شرح) plus the signature, pre-filled with the saved one
 * (FR-52), consent ticked every time. Finance also confirms the settlement date.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PersianDateField } from '@/components/PersianDateField';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { RequestSignatureFields } from '../../request/_components/RequestSignature';
import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';
import {
  dateObjectToGregorian,
  gregorianToPersianDateObject,
  type PickerDate,
} from '@/lib/leave/dateConvert';
import { todayInAppTz } from '@/lib/appDate';
import { signClearanceFinance, signClearanceRow } from '@/lib/actions/clearance';

type Props =
  | { kind: 'row'; id: string; unitName: string; locale: string }
  | { kind: 'finance'; id: string; locale: string };

export function SignDialog(props: Props) {
  const t = useTranslations('clearance.detail');
  const tSig = useTranslations('signature');
  const tc = useTranslations('common');
  const tf = useTranslations('clearance.fields');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [signatureData, setSignatureData] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [note, setNote] = useState('');
  const [settlement, setSettlement] = useState<PickerDate | null>(null);
  const [error, setError] = useState('');

  const labels = signatureLabelsFrom(tSig);
  const idPrefix = `clearance-${props.kind}-${props.id}`;
  const title = props.kind === 'row' ? t('signTitle', { unit: props.unitName }) : t('financeTitle');

  const submit = () => {
    setError('');
    if (!signatureData) return setError(labels.validationSignature);
    if (!authorized) return setError(labels.validationAuthorization);
    startTransition(async () => {
      const input = { signatureData, signatureAuthorized: authorized, note };
      const res =
        props.kind === 'row'
          ? await signClearanceRow(props.id, input)
          : await signClearanceFinance(props.id, {
              ...input,
              settlementDate: settlement ? dateObjectToGregorian(settlement) : null,
            });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSignatureData('');
          setAuthorized(false);
          setNote('');
          setError('');
          setSettlement(gregorianToPersianDateObject(todayInAppTz(), props.locale));
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" data-testid={`${idPrefix}-open`}>
          {props.kind === 'row' ? t('sign') : t('financeSign')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{props.kind === 'row' ? t('signBody') : t('financeBody')}</AlertDialogDescription>
        </AlertDialogHeader>

        {props.kind === 'finance' && (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-settlement`}>{tf('settlementDate')}</Label>
            <PersianDateField
              id={`${idPrefix}-settlement`}
              locale={props.locale}
              value={settlement}
              onChange={setSettlement}
              testId={`${idPrefix}-settlement`}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-note`}>{t('remark')}</Label>
          <Textarea
            id={`${idPrefix}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('remarkPlaceholder')}
            maxLength={500}
            data-testid={`${idPrefix}-note`}
          />
        </div>

        <RequestSignatureFields
          idPrefix={idPrefix}
          value={signatureData}
          onChange={setSignatureData}
          authorized={authorized}
          onAuthorizedChange={setAuthorized}
          labels={labels}
        />

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{tc('dismiss')}</AlertDialogCancel>
          <Button type="button" onClick={submit} disabled={isPending} data-testid={`${idPrefix}-confirm`}>
            {props.kind === 'row' ? t('sign') : t('financeSign')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
