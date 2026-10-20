'use client';

/**
 * FR-70: the direct manager asks HR to extend an approved, travel-booked trip —
 * a later end date and the reason. HR decides; until then the trip keeps its dates.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PersianDateField } from '@/components/PersianDateField';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { dateObjectToGregorian, gregorianToPersianDateObject, type PickerDate } from '@/lib/leave/dateConvert';
import { requestExtension, type ExtendableTrip } from '@/lib/actions/travel';

export function ExtendTripDialog({ trip, locale }: { trip: ExtendableTrip; locale: string }) {
  const t = useTranslations('travel.extension');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<PickerDate | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const id = trip.request_id;

  const submit = () => {
    setError('');
    const newEndDate = date ? dateObjectToGregorian(date) : '';
    if (!newEndDate || newEndDate <= trip.end_date) { setError(t('newEndAfter')); return; }
    if (!reason.trim()) { setError(t('reasonRequired')); return; }
    startTransition(async () => {
      const res = await requestExtension({ requestId: id, newEndDate, reason: reason.trim() });
      if (!res.ok) { setError(res.error); return; }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) { setDate(null); setReason(''); setError(''); }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={trip.pending_extension} data-testid={`extend-open-${id}`}>
          {trip.pending_extension ? t('waiting') : t('open')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('body')}</AlertDialogDescription>
        </AlertDialogHeader>
        {trip.delegation_uncovered && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid={`extend-delegation-${id}`}>
            {t('delegationUncovered')}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`extend-date-${id}`}>{t('newEnd')}</Label>
          <PersianDateField
            id={`extend-date-${id}`}
            locale={locale}
            value={date}
            onChange={setDate}
            minDate={gregorianToPersianDateObject(trip.end_date, locale)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`extend-reason-${id}`}>{t('reason')}</Label>
          <Textarea id={`extend-reason-${id}`} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
          <Button disabled={pending} onClick={submit} data-testid={`extend-submit-${id}`}>{t('submit')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
