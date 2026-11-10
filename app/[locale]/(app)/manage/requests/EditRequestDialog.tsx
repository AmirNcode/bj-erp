'use client';

/**
 * FR-91: edit an approved request of any of the four types. One dialog: a daily / hourly
 * switch when the caller may save the request as either, then the date range (day part for a
 * single leave day) or one date with a time range, the per diem of a daily trip, a reason and
 * the editor's signature. The signed values stay on record; the database applies the same
 * limits as for a new request and refuses a change that would make leave unpaid.
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
import { editRequest } from '@/lib/actions/leave/edit';
import type { ReviewActionRequest } from './RequestReviewActions';
import { dateObjectToGregorian, gregorianToPersianDateObject, type PickerDate } from '@/lib/leave/dateConvert';
import { timeSlots } from '@/lib/leave/hourly';
import { parseRials } from '@/lib/leave/perDiem';
import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';
import { nativeSelectClass } from '@/lib/native-select';
import { subTabClass, subTabListClass } from '@/lib/ui/tabs';
import { RequestSignatureFields } from '../../request/_components/RequestSignature';
import { DateRangeFields, TimeRangeFields } from '../../request/_components/FormParts';

type Unit = 'day' | 'hour';
type DayPart = 'full' | 'am' | 'pm';

const hm = (t: string | null) => (t ? t.slice(0, 5) : '');

export function EditRequestDialog({ request, units, locale, workWindow, buttonClassName }: {
  request: ReviewActionRequest;
  /** Units the caller may save the request as, the current one first. */
  units: Unit[];
  locale: string;
  /** Company working hours: the choices of the hourly time selects. */
  workWindow: { start: string; end: string };
  buttonClassName?: string;
}) {
  const t = useTranslations('requestEdit');
  const tReq = useTranslations('request');
  const tHourly = useTranslations('hourly');
  const tErrand = useTranslations('errand');
  const tPerDiem = useTranslations('travel.correction');
  const tc = useTranslations('common');
  const tSignature = useTranslations('signature');
  const router = useRouter();
  const signatureLabels = signatureLabelsFrom(tSignature, 'approverTitle');

  // The signed times may be off the 30-minute grid; keep them selectable.
  const slots = (() => {
    const grid = timeSlots(workWindow, 30);
    const extra = [hm(request.start_time), hm(request.end_time)].filter((s) => s && !grid.includes(s));
    return extra.length ? [...grid, ...extra].sort() : grid;
  })();
  const firstSlot = slots[0] ?? '';
  const thirdSlot = slots[2] ?? slots[slots.length - 1] ?? '';

  const currentPerDiem = request.per_diem_rials == null ? '' : String(request.per_diem_rials);
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<Unit>(request.unit);
  const [start, setStart] = useState<PickerDate | null>(null);
  const [end, setEnd] = useState<PickerDate | null>(null);
  const [dayPart, setDayPart] = useState<DayPart>(request.day_part);
  const [startTime, setStartTime] = useState(hm(request.start_time) || firstSlot);
  const [endTime, setEndTime] = useState(hm(request.end_time) || thirdSlot);
  const [perDiem, setPerDiem] = useState(currentPerDiem);
  const [reason, setReason] = useState('');
  const [signatureData, setSignatureData] = useState('');
  const [signatureAuthorized, setSignatureAuthorized] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setUnit(request.unit);
    setStart(gregorianToPersianDateObject(request.start_date, locale));
    setEnd(gregorianToPersianDateObject(request.end_date, locale));
    setDayPart(request.day_part);
    setStartTime(hm(request.start_time) || firstSlot);
    setEndTime(hm(request.end_time) || thirdSlot);
    setPerDiem(currentPerDiem);
    setReason(''); setSignatureData(''); setSignatureAuthorized(false); setError('');
  };

  const isLeave = request.kind === 'leave';
  const startIso = start ? dateObjectToGregorian(start) : '';
  const endIso = unit === 'hour' ? startIso : end ? dateObjectToGregorian(end) : '';
  // A half day only exists for one leave day; anything else is a full day.
  const showDayPart = isLeave && unit === 'day' && !!startIso && startIso === endIso;
  const targetDayPart: DayPart = showDayPart ? dayPart : 'full';
  const showPerDiem = !isLeave && unit === 'day';

  const perDiemChanged = showPerDiem && perDiem.trim() !== '' && perDiem !== currentPerDiem;
  const changed =
    unit !== request.unit
    || startIso !== request.start_date
    || endIso !== request.end_date
    || targetDayPart !== request.day_part
    || (unit === 'hour' && (startTime !== hm(request.start_time) || endTime !== hm(request.end_time)))
    || perDiemChanged;
  const ready = changed && reason.trim() !== '' && !!signatureData && signatureAuthorized;

  const submit = () => {
    setError('');
    if (!startIso || !endIso) { setError(unit === 'hour' ? tErrand('validationSelectDate') : tReq('validationSelectDate')); return; }
    if (unit === 'hour' && (!startTime || !endTime || endTime <= startTime)) { setError(tHourly('validationTimes')); return; }
    let perDiemRials: number | null = null;
    if (perDiemChanged) {
      perDiemRials = parseRials(perDiem);
      if (Number.isNaN(perDiemRials)) { setError(tPerDiem('perDiemInvalid')); return; }
    }
    if (!reason.trim()) { setError(t('reasonRequired')); return; }
    if (!signatureData) { setError(signatureLabels.validationSignature); return; }
    if (!signatureAuthorized) { setError(signatureLabels.validationAuthorization); return; }
    startTransition(async () => {
      const res = await editRequest({
        requestId: request.id,
        unit,
        start: startIso,
        end: endIso,
        dayPart: targetDayPart,
        startTime: unit === 'hour' ? startTime : null,
        endTime: unit === 'hour' ? endTime : null,
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

  // The hourly form keeps one date; back to daily it must not leave an end before the start.
  const switchUnit = (next: Unit) => {
    setUnit(next);
    if (next === 'day' && start && (!end || dateObjectToGregorian(end) < dateObjectToGregorian(start))) setEnd(start);
  };

  const unitLabel = { day: t('unitDay'), hour: t('unitHour') } as const;
  const id = request.id;

  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); if (next) reset(); }}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className={buttonClassName} data-testid={`edit-request-${id}`}>{t('open')}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="default" className="max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('body')}</AlertDialogDescription>
        </AlertDialogHeader>

        {units.length > 1 && (
          <div role="radiogroup" aria-label={tReq('tabs.label')} className={subTabListClass} data-testid="edit-unit">
            {units.map((u) => (
              <button key={u} type="button" role="radio" aria-checked={unit === u} className={subTabClass(unit === u)}
                onClick={() => switchUnit(u)} data-testid={`edit-unit-${u}`}>
                {unitLabel[u]}
              </button>
            ))}
          </div>
        )}

        {unit === 'day' ? (
          <DateRangeFields
            locale={locale}
            legend={tReq('dateRange')}
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
            startField={{ id: `edit-start-${id}`, testId: 'edit-start', label: tReq('startDate') }}
            endField={{ id: `edit-end-${id}`, testId: 'edit-end', label: tReq('endDate') }}
          />
        ) : (
          <>
            <div className="space-y-1.5" data-testid="edit-date">
              <Label htmlFor={`edit-date-${id}`}>{t('date')}</Label>
              <PersianDateField id={`edit-date-${id}`} locale={locale} value={start} onChange={setStart} />
            </div>
            <TimeRangeFields
              prefix={`edit-time-${id}`}
              slots={slots}
              from={startTime}
              to={endTime}
              onFromChange={setStartTime}
              onToChange={setEndTime}
              fromLabel={tHourly('fromTime')}
              toLabel={tHourly('toTime')}
            />
          </>
        )}

        {showDayPart && (
          <div className="space-y-1.5">
            <Label htmlFor={`edit-day-part-${id}`}>{tReq('dayPart')}</Label>
            <select id={`edit-day-part-${id}`} value={dayPart} onChange={(e) => setDayPart(e.target.value as DayPart)}
              className={nativeSelectClass} data-testid="edit-day-part">
              <option value="full">{tReq('dayPartFull')}</option>
              <option value="am">{tReq('dayPartAm')}</option>
              <option value="pm">{tReq('dayPartPm')}</option>
            </select>
          </div>
        )}

        {showPerDiem && (
          <div className="space-y-1.5">
            <Label htmlFor={`edit-per-diem-${id}`}>{tPerDiem('perDiemLabel')}</Label>
            <Input id={`edit-per-diem-${id}`} inputMode="numeric" dir="ltr" autoComplete="off" value={perDiem}
              onChange={(e) => setPerDiem(e.target.value)} data-testid="edit-per-diem" />
            <p className="text-xs text-muted-foreground">{tPerDiem('perDiemHint')}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`edit-reason-${id}`}>{t('reason')}</Label>
          <Textarea id={`edit-reason-${id}`} maxLength={1000} value={reason}
            onChange={(e) => setReason(e.target.value)} data-testid="edit-reason" />
        </div>
        <RequestSignatureFields
          idPrefix={`edit-${id}`}
          value={signatureData}
          onChange={setSignatureData}
          authorized={signatureAuthorized}
          onAuthorizedChange={setSignatureAuthorized}
          labels={signatureLabels}
        />
        {error && <p role="alert" className="text-sm text-destructive" data-testid="edit-error">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
          <Button disabled={pending || !ready} onClick={submit} data-testid="edit-submit">{t('submit')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
