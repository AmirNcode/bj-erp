'use client';

import { useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LazyDatePicker } from '../LazyDatePicker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import persian_en from 'react-date-object/locales/persian_en';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import gregorian_fa from 'react-date-object/locales/gregorian_fa';
import { dateObjectToGregorian } from '@/lib/leave/dateConvert';
import { timeSlots, timeToMinutes } from '@/lib/leave/hourly';
import { errandMinutes, isValidErrandLocation, MAX_ERRAND_LOCATION_LENGTH } from '@/lib/leave/errand';
import { formatDuration } from '@/lib/leave/duration';
import { submitErrandRequest } from '@/lib/actions/leave';
import type { WorkSettings } from '@/lib/actions/leave';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { nativeSelectClass } from '@/lib/native-select';

type Labels = {
  date: string;
  fromTime: string;
  toTime: string;
  location: string;
  locationPlaceholder: string;
  description: string;
  hint: string;
  submit: string;
  preview: string;
  durationLabel: string;
  success: string;
  errorLabel: string;
  validationSelectDate: string;
  validationTimes: string;
  validationLocation: string;
  days: string;
  hours: string;
  minutes: string;
  and: string;
};

type Props = {
  /** Only for hoursPerDay (duration rendering) and a sensible default time. */
  workSettings: WorkSettings;
  calendarPref: string;
  labels: Labels;
  locale: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DateObjectLike = any;

/**
 * Times span the WHOLE day, not the company work window.
 *
 * Hourly leave is confined to [work_start, work_end]; an errand deliberately is
 * not (D3) — a worker can be sent out before the shift starts or get back after
 * it ends. Offering only in-window slots would impose a rule the database does
 * not have.
 */
const DAY_SLOTS = timeSlots({ start: '00:00', end: '23:30' }, 30);

/** First slot at or after `time`, so a default derived from work_start lands on the grid. */
function slotIndexAtOrAfter(time: string): number {
  const target = timeToMinutes(time);
  const i = DAY_SLOTS.findIndex((s) => timeToMinutes(s) >= target);
  return i === -1 ? 0 : i;
}

/**
 * ماموریت ساعتی — the BJ-F 50207 flow: one date, a departure time, a return
 * time, محل ماموریت, and an optional شرح ماموریت.
 *
 * No leave type, no balance line, no replacement picker: an errand is work, so
 * none of those apply. Times are native <select>s of 30-minute slots — the e2e
 * suite drives native selects with selectOption (a repo rule), and on a
 * factory-floor phone a fixed slot list beats a free-text time field.
 */
export function ErrandRequestForm({ workSettings, calendarPref, labels, locale }: Props) {
  const router = useRouter();
  const isJalali = calendarPref === 'jalali';
  const isRtl = locale === 'fa';
  const calendar = isJalali ? persian : gregorian;
  const calLocale = isJalali
    ? isRtl
      ? persian_fa
      : persian_en
    : isRtl
      ? gregorian_fa
      : gregorian_en;

  const defaultFrom = slotIndexAtOrAfter(workSettings.workStart);

  const [date, setDate] = useState<DateObjectLike | null>(null);
  const [startTime, setStartTime] = useState(DAY_SLOTS[defaultFrom] ?? '08:00');
  const [endTime, setEndTime] = useState(
    DAY_SLOTS[defaultFrom + 2] ?? DAY_SLOTS[DAY_SLOTS.length - 1] ?? '10:00'
  );
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const gregorianDate = useCallback(() => (date ? dateObjectToGregorian(date) : ''), [date]);

  const durationMinutes = errandMinutes(startTime, endTime);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const iso = gregorianDate();
    if (!iso) {
      setErrorMsg(labels.validationSelectDate);
      return;
    }
    if (durationMinutes <= 0) {
      setErrorMsg(labels.validationTimes);
      return;
    }
    if (!isValidErrandLocation(location)) {
      setErrorMsg(labels.validationLocation);
      return;
    }

    startTransition(async () => {
      const result = await submitErrandRequest({
        date: iso,
        startTime,
        endTime,
        location: location.trim(),
        description: description || undefined,
      });

      if (result.ok) {
        setSuccessMsg(labels.success);
        setDate(null);
        setLocation('');
        setDescription('');
        router.refresh();
      } else {
        setErrorMsg(result.error);
      }
    });
  };

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" data-testid="errand-form">
          {/* An errand is work — say so before anything is filled in. */}
          <p
            className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground"
            data-testid="errand-hint"
          >
            {labels.hint}
          </p>

          {/* Single date */}
          <div className="space-y-1.5">
            <Label>{labels.date}</Label>
            <div
              style={{ direction: isRtl ? 'rtl' : 'ltr' }}
              className="w-full"
              onKeyDown={(e) => {
                // Enter commits the date in the picker; it must not also submit.
                if (e.key === 'Enter') e.preventDefault();
              }}
            >
              <LazyDatePicker
                value={date}
                onChange={(d: DateObjectLike) => setDate(d ?? null)}
                calendar={calendar}
                locale={calLocale}
                calendarPosition={isRtl ? 'bottom-right' : 'bottom-left'}
                inputClass="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                containerClassName="rmdp-container w-full"
                format="YYYY/MM/DD"
              />
            </div>
          </div>

          {/* ساعت خروج / ساعت برگشت */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="errand_from">{labels.fromTime}</Label>
              <select
                id="errand_from"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={nativeSelectClass}
                dir="ltr"
                data-testid="errand-from"
              >
                {DAY_SLOTS.map((s) => (
                  <option key={`from-${s}`} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="errand_to">{labels.toTime}</Label>
              <select
                id="errand_to"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={nativeSelectClass}
                dir="ltr"
                data-testid="errand-to"
              >
                {DAY_SLOTS.map((s) => (
                  <option key={`to-${s}`} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* محل ماموریت — required. maxLength mirrors the CHECK constraint. */}
          <div className="space-y-1.5">
            <Label htmlFor="errand_location">{labels.location}</Label>
            <Input
              id="errand_location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={labels.locationPlaceholder}
              maxLength={MAX_ERRAND_LOCATION_LENGTH}
              required
              data-testid="errand-location"
            />
          </div>

          {/* شرح ماموریت — optional; stored in `reason`, so FR-25-private. */}
          <div className="space-y-1.5">
            <Label htmlFor="errand_description">{labels.description}</Label>
            <Textarea
              id="errand_description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              className="resize-none"
              data-testid="errand-description"
            />
          </div>

          {/* Live preview — duration only. There is no balance to show. */}
          {durationMinutes > 0 && (
            <div
              className="rounded-lg bg-secondary px-4 py-3 text-sm space-y-1"
              data-testid="errand-preview"
            >
              <div data-testid="errand-duration">
                {labels.preview}: {labels.durationLabel}{' '}
                <strong>
                  {formatDuration(durationMinutes, workSettings.hoursPerDay, locale, labels)}
                </strong>
              </div>
            </div>
          )}

          {successMsg && (
            <div
              className="rounded-lg px-4 py-3 text-sm text-success bg-success/10 border border-success/20"
              data-testid="errand-success"
            >
              {successMsg}
            </div>
          )}
          {errorMsg && (
            <div
              className="rounded-lg px-4 py-3 text-sm text-destructive bg-destructive/10 border border-destructive/20"
              data-testid="errand-error"
            >
              <strong>{labels.errorLabel}:</strong> {errorMsg}
            </div>
          )}

          <Button type="submit" disabled={isPending} className="w-full" data-testid="errand-submit">
            {isPending ? '...' : labels.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
