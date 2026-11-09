'use client';

/**
 * FR-84: HR corrects the dates and per diem of an approved daily trip. Unchanged
 * fields go as null. The signed values stay on record; the database refuses a
 * correction that changes nothing.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PersianDateField } from '@/components/PersianDateField';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { correctTrip } from '@/lib/actions/travel';
import type { ReviewActionRequest } from './RequestReviewActions';
import { dateObjectToGregorian, gregorianToPersianDateObject, type PickerDate } from '@/lib/leave/dateConvert';
import { parseRials } from '@/lib/leave/perDiem';
import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';
import { RequestSignatureFields } from '../../request/_components/RequestSignature';

export function CorrectTripDialog({ trip, locale, buttonClassName }: { trip: ReviewActionRequest; locale: string; buttonClassName?: string }) {
  const t = useTranslations('travel.correction');
  const tc = useTranslations('common');
  const tSignature = useTranslations('signature');
  const router = useRouter();
  const signatureLabels = signatureLabelsFrom(tSignature, 'approverTitle');
  const currentPerDiem = trip.per_diem_rials == null ? '' : String(trip.per_diem_rials);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<PickerDate | null>(null);
  const [end, setEnd] = useState<PickerDate | null>(null);
  const [perDiem, setPerDiem] = useState(currentPerDiem);
  const [reason, setReason] = useState('');
  const [signatureData, setSignatureData] = useState('');
  const [signatureAuthorized, setSignatureAuthorized] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setStart(gregorianToPersianDateObject(trip.start_date, locale));
    setEnd(gregorianToPersianDateObject(trip.end_date, locale));
    setPerDiem(currentPerDiem);
    setReason(''); setSignatureData(''); setSignatureAuthorized(false); setError('');
  };

  const submit = () => {
    setError('');
    const newStart = start ? dateObjectToGregorian(start) : '';
    const newEnd = end ? dateObjectToGregorian(end) : '';
    let perDiemRials: number | null = null;
    if (perDiem.trim() !== '' && perDiem !== currentPerDiem) {
      perDiemRials = parseRials(perDiem);
      if (Number.isNaN(perDiemRials)) { setError(t('perDiemInvalid')); return; }
    }
    if (!reason.trim()) { setError(t('reasonRequired')); return; }
    if (!signatureData) { setError(signatureLabels.validationSignature); return; }
    if (!signatureAuthorized) { setError(signatureLabels.validationAuthorization); return; }
    startTransition(async () => {
      const res = await correctTrip({
        requestId: trip.id,
        newStart: newStart && newStart !== trip.start_date ? newStart : null,
        newEnd: newEnd && newEnd !== trip.end_date ? newEnd : null,
        perDiemRials,
        reason: reason.trim(),
        signatureData,
        signatureAuthorized,
      });
      if (!res.ok) { setError(res.error); return; }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); if (next) reset(); }}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className={buttonClassName} data-testid={`correct-trip-${trip.id}`}>{t('open')}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="default" className="max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`correct-start-${trip.id}`}>{t('start')}</Label>
            <PersianDateField id={`correct-start-${trip.id}`} locale={locale} value={start} onChange={setStart} testId="correct-start" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`correct-end-${trip.id}`}>{t('end')}</Label>
            <PersianDateField id={`correct-end-${trip.id}`} locale={locale} value={end} onChange={setEnd} testId="correct-end" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`correct-per-diem-${trip.id}`}>{t('perDiemLabel')}</Label>
          <Input id={`correct-per-diem-${trip.id}`} inputMode="numeric" dir="ltr" autoComplete="off" value={perDiem}
            onChange={(e) => setPerDiem(e.target.value)} data-testid="correct-per-diem" />
          <p className="text-xs text-muted-foreground">{t('perDiemHint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`correct-reason-${trip.id}`}>{t('reason')}</Label>
          <Textarea id={`correct-reason-${trip.id}`} maxLength={1000} value={reason}
            onChange={(e) => setReason(e.target.value)} data-testid="correct-reason" />
        </div>
        <RequestSignatureFields
          idPrefix={`correct-${trip.id}`}
          value={signatureData}
          onChange={setSignatureData}
          authorized={signatureAuthorized}
          onAuthorizedChange={setSignatureAuthorized}
          labels={signatureLabels}
        />
        {error && <p role="alert" className="text-sm text-destructive" data-testid="correct-error">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
          <Button disabled={pending} onClick={submit} data-testid="correct-submit">{t('submit')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
