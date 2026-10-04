'use client';

import { useState } from 'react';
import { dateObjectToGregorian, type PickerDate } from '@/lib/leave/dateConvert';
import { countCalendarDays } from '@/lib/leave/dailyErrand';
import { isValidErrandLocation } from '@/lib/leave/errand';
import { formatDuration } from '@/lib/leave/duration';
import { submitDailyErrandRequest } from '@/lib/actions/leave/requests';
import type { WorkSettings } from '@/lib/actions/leave/reference';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RequestSignatureFields, type SignatureLabels } from '../_components/RequestSignature';
import { DateRangeFields, ErrandDetailsFields, FormFeedback } from '../_components/FormParts';
import { useRequestSubmit, useSignature } from '../_components/useRequestForm';

type Labels = {
  dateRange: string;
  startDate: string;
  endDate: string;
  location: string;
  locationPlaceholder: string;
  description: string;
  hint: string;
  submit: string;
  requestingLabel: string;
  success: string;
  errorLabel: string;
  validationSelectDate: string;
  validationLocation: string;
  signature: SignatureLabels;
  days: string;
  hours: string;
  minutes: string;
  and: string;
};

type Props = {
  workSettings: WorkSettings;
  labels: Labels;
  locale: string;
};

export function DailyErrandRequestForm({ workSettings, labels, locale }: Props) {
  const [startDate, setStartDate] = useState<PickerDate | null>(null);
  const [endDate, setEndDate] = useState<PickerDate | null>(null);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const signature = useSignature();
  const { success, error, isPending, submit } = useRequestSubmit(labels.success);

  const startIso = startDate ? dateObjectToGregorian(startDate) : '';
  const endIso = endDate ? dateObjectToGregorian(endDate) : '';
  const requestedMinutes =
    countCalendarDays(startIso, endIso) * Math.round(workSettings.hoursPerDay * 60);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const problem =
      !startIso || !endIso
        ? labels.validationSelectDate
        : !isValidErrandLocation(location)
          ? labels.validationLocation
          : signature.problem(labels.signature);

    submit(
      problem,
      () =>
        submitDailyErrandRequest({
          start: startIso,
          end: endIso,
          location: location.trim(),
          description: description || undefined,
          signatureData: signature.data,
          signatureAuthorized: signature.authorized,
        }),
      () => {
        setStartDate(null);
        setEndDate(null);
        setLocation('');
        setDescription('');
        signature.reset();
      }
    );
  };

  return (
    <Card className="rounded-t-none">
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" data-testid="daily-errand-form">
          <p className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
            {labels.hint}
          </p>

          <DateRangeFields
            locale={locale}
            legend={labels.dateRange}
            start={startDate}
            end={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
            startField={{
              id: 'daily_errand_start',
              testId: 'daily-errand-start-date',
              label: labels.startDate,
            }}
            endField={{
              id: 'daily_errand_end',
              testId: 'daily-errand-end-date',
              label: labels.endDate,
            }}
          />

          <ErrandDetailsFields
            idPrefix="daily_errand"
            testIdPrefix="daily-errand"
            location={location}
            description={description}
            onLocationChange={setLocation}
            onDescriptionChange={setDescription}
            labels={labels}
          />

          <RequestSignatureFields
            idPrefix="daily-errand"
            {...signature.fieldProps}
            labels={labels.signature}
          />

          {requestedMinutes > 0 && (
            <div
              className="rounded-lg bg-secondary px-4 py-3 text-sm"
              data-testid="daily-errand-preview"
            >
              {labels.requestingLabel}:{' '}
              <strong>
                {formatDuration(requestedMinutes, workSettings.hoursPerDay, locale, labels)}
              </strong>
            </div>
          )}

          <FormFeedback
            success={success}
            error={error}
            errorLabel={labels.errorLabel}
            successTestId="daily-errand-success"
            errorTestId="daily-errand-error"
          />

          <Button
            type="submit"
            disabled={isPending}
            className="w-full"
            data-testid="daily-errand-submit"
          >
            {isPending ? '...' : labels.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
