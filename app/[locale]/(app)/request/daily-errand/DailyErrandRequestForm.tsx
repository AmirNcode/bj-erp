'use client';

import { useState } from 'react';
import { RequestDelegationFields } from '../_components/RequestDelegationFields';
import { dateObjectToGregorian, type PickerDate } from '@/lib/leave/dateConvert';
import { countCalendarDays } from '@/lib/leave/dailyErrand';
import { isValidErrandLocation } from '@/lib/leave/errand';
import { formatDuration } from '@/lib/leave/duration';
import { submitDailyErrandRequest } from '@/lib/actions/leave/requests';
import type { WorkSettings } from '@/lib/actions/leave/reference';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RequestSignatureFields, type SignatureLabels } from '../_components/RequestSignature';
import { DateRangeFields, ErrandDetailsFields, FormFeedback, OwnPerDiemField } from '../_components/FormParts';
import { parseRials } from '@/lib/leave/perDiem';
import { useRequestSubmit, useSignature, useRequestDelegation } from '../_components/useRequestForm';

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
  ownPerDiemLabel: string;
  ownPerDiemHint: string;
  ownPerDiemInvalid: string;
  days: string;
  hours: string;
  minutes: string;
  and: string;
};

type Props = {
  workSettings: WorkSettings;
  labels: Labels;
  locale: string;
  /** The caller is the designated Head of HR: they enter their own per diem. */
  perDiemAllowed: boolean;
};

export function DailyErrandRequestForm({ workSettings, labels, locale, perDiemAllowed }: Props) {
  const [startDate, setStartDate] = useState<PickerDate | null>(null);
  const [endDate, setEndDate] = useState<PickerDate | null>(null);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [perDiem, setPerDiem] = useState('');
  const signature = useSignature();
  const { success, error, isPending, submit } = useRequestSubmit(labels.success);

  const startIso = startDate ? dateObjectToGregorian(startDate) : '';
  const endIso = endDate ? dateObjectToGregorian(endDate) : '';
  const requestedMinutes =
    countCalendarDays(startIso, endIso) * Math.round(workSettings.hoursPerDay * 60);

  const delegation = useRequestDelegation(startIso && endIso ? { start: startIso, end: endIso, unit: 'day', dayPart: 'full', replacementId: null } : null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const perDiemRials = perDiemAllowed && perDiem.trim() !== '' ? parseRials(perDiem) : null;
    const problem =
      !startIso || !endIso
        ? labels.validationSelectDate
        : !isValidErrandLocation(location)
          ? labels.validationLocation
          : Number.isNaN(perDiemRials)
            ? labels.ownPerDiemInvalid
            : signature.problem(labels.signature) ?? delegation.problem();

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
          perDiemRials,
          ...delegation.submission,
        }),
      () => {
        setStartDate(null);
        setEndDate(null);
        setLocation('');
        setDescription('');
        setPerDiem('');
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

          {perDiemAllowed && (
            <OwnPerDiemField idPrefix="daily_errand" testIdPrefix="daily-errand" value={perDiem} onChange={setPerDiem} labels={labels} />
          )}

          <RequestDelegationFields idPrefix="daily-errand" delegation={delegation} locale={locale} showCover={false} />

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
            disabled={isPending || delegation.blocked}
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
