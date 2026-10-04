'use client';

import { useState } from 'react';
import { dateObjectToGregorian, type PickerDate } from '@/lib/leave/dateConvert';
import { timeSlots, timeToMinutes } from '@/lib/leave/hourly';
import { errandMinutes, isValidErrandLocation } from '@/lib/leave/errand';
import { formatDuration } from '@/lib/leave/duration';
import { submitErrandRequest } from '@/lib/actions/leave/requests';
import type { WorkSettings } from '@/lib/actions/leave/reference';
import { PersianDateField } from '@/components/PersianDateField';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RequestSignatureFields, type SignatureLabels } from '../_components/RequestSignature';
import { ErrandDetailsFields, FormFeedback, TimeRangeFields } from '../_components/FormParts';
import { useRequestSubmit, useSignature } from '../_components/useRequestForm';

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
  signature: SignatureLabels;
  days: string;
  hours: string;
  minutes: string;
  and: string;
};

type Props = {
  /** Only for hoursPerDay (duration rendering) and a sensible default time. */
  workSettings: WorkSettings;
  labels: Labels;
  locale: string;
};

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
 * none of those apply.
 */
export function ErrandRequestForm({ workSettings, labels, locale }: Props) {
  const defaultFrom = slotIndexAtOrAfter(workSettings.workStart);

  const [date, setDate] = useState<PickerDate | null>(null);
  const [startTime, setStartTime] = useState(DAY_SLOTS[defaultFrom] ?? '08:00');
  const [endTime, setEndTime] = useState(
    DAY_SLOTS[defaultFrom + 2] ?? DAY_SLOTS[DAY_SLOTS.length - 1] ?? '10:00'
  );
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const signature = useSignature();
  const { success, error, isPending, submit } = useRequestSubmit(labels.success);

  const isoDate = date ? dateObjectToGregorian(date) : '';
  const durationMinutes = errandMinutes(startTime, endTime);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = !isoDate
      ? labels.validationSelectDate
      : durationMinutes <= 0
        ? labels.validationTimes
        : !isValidErrandLocation(location)
          ? labels.validationLocation
          : signature.problem(labels.signature);

    submit(
      problem,
      () =>
        submitErrandRequest({
          date: isoDate,
          startTime,
          endTime,
          location: location.trim(),
          description: description || undefined,
          signatureData: signature.data,
          signatureAuthorized: signature.authorized,
        }),
      () => {
        setDate(null);
        setLocation('');
        setDescription('');
        signature.reset();
      }
    );
  };

  return (
    <Card className="rounded-t-none">
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" data-testid="errand-form">
          {/* An errand is work — say so before anything is filled in. */}
          <p
            className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground"
            data-testid="errand-hint"
          >
            {labels.hint}
          </p>

          <div className="space-y-1.5">
            <Label>{labels.date}</Label>
            <PersianDateField locale={locale} value={date} onChange={setDate} />
          </div>

          {/* ساعت خروج / ساعت برگشت */}
          <TimeRangeFields
            prefix="errand"
            slots={DAY_SLOTS}
            from={startTime}
            to={endTime}
            onFromChange={setStartTime}
            onToChange={setEndTime}
            fromLabel={labels.fromTime}
            toLabel={labels.toTime}
          />

          <ErrandDetailsFields
            idPrefix="errand"
            testIdPrefix="errand"
            location={location}
            description={description}
            onLocationChange={setLocation}
            onDescriptionChange={setDescription}
            labels={labels}
          />

          <RequestSignatureFields idPrefix="errand" {...signature.fieldProps} labels={labels.signature} />

          {/* Duration only: an errand spends no balance. */}
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

          <FormFeedback
            success={success}
            error={error}
            errorLabel={labels.errorLabel}
            successTestId="errand-success"
            errorTestId="errand-error"
          />

          <Button type="submit" disabled={isPending} className="w-full" data-testid="errand-submit">
            {isPending ? '...' : labels.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
