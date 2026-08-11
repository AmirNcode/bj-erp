'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LazyDatePicker } from '@/components/LazyDatePicker';
import { dateObjectToGregorian } from '@/lib/leave/dateConvert';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';
import { countCalendarDays } from '@/lib/leave/dailyErrand';
import {
  isValidErrandLocation,
  MAX_ERRAND_LOCATION_LENGTH,
} from '@/lib/leave/errand';
import { formatDuration } from '@/lib/leave/duration';
import { submitDailyErrandRequest } from '@/lib/actions/leave';
import type { WorkSettings } from '@/lib/actions/leave';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  RequestSignatureFields,
  type SignatureLabels,
} from '../_components/RequestSignature';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DateObjectLike = any;

export function DailyErrandRequestForm({ workSettings, labels, locale }: Props) {
  const router = useRouter();
  const { isRtl, calendar, calLocale, calendarPosition } = calendarPickerConfig(locale);

  const [startDate, setStartDate] = useState<DateObjectLike | null>(null);
  const [endDate, setEndDate] = useState<DateObjectLike | null>(null);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [signatureData, setSignatureData] = useState('');
  const [signatureAuthorized, setSignatureAuthorized] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const startIso = startDate ? dateObjectToGregorian(startDate) : '';
  const endIso = endDate ? dateObjectToGregorian(endDate) : '';
  const requestedMinutes =
    countCalendarDays(startIso, endIso) * Math.round(workSettings.hoursPerDay * 60);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!startIso || !endIso) {
      setErrorMsg(labels.validationSelectDate);
      return;
    }
    if (!isValidErrandLocation(location)) {
      setErrorMsg(labels.validationLocation);
      return;
    }
    if (!signatureData) {
      setErrorMsg(labels.signature.validationSignature);
      return;
    }
    if (!signatureAuthorized) {
      setErrorMsg(labels.signature.validationAuthorization);
      return;
    }

    startTransition(async () => {
      const result = await submitDailyErrandRequest({
        start: startIso,
        end: endIso,
        location: location.trim(),
        description: description || undefined,
        signatureData,
        signatureAuthorized,
      });

      if (result.ok) {
        setSuccessMsg(labels.success);
        setStartDate(null);
        setEndDate(null);
        setLocation('');
        setDescription('');
        setSignatureData('');
        setSignatureAuthorized(false);
        router.refresh();
      } else {
        setErrorMsg(result.error);
      }
    });
  };

  const datePickerProps = {
    calendar,
    locale: calLocale,
    calendarPosition,
    inputClass:
      'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
    containerClassName: 'rmdp-container w-full',
    format: 'YYYY/MM/DD',
  };

  return (
    <Card className="rounded-t-none">
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" data-testid="daily-errand-form">
          <p className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
            {labels.hint}
          </p>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{labels.dateRange}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5" data-testid="daily-errand-start-date">
                <Label htmlFor="daily_errand_start">{labels.startDate}</Label>
                <div
                  style={{ direction: isRtl ? 'rtl' : 'ltr' }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                >
                  <LazyDatePicker
                    id="daily_errand_start"
                    value={startDate}
                    onChange={(date: DateObjectLike) => {
                      const next = date ?? null;
                      setStartDate(next);
                      if (
                        !next ||
                        (endDate && dateObjectToGregorian(next) > dateObjectToGregorian(endDate))
                      ) {
                        setEndDate(null);
                      }
                    }}
                    {...datePickerProps}
                  />
                </div>
              </div>

              <div className="space-y-1.5" data-testid="daily-errand-end-date">
                <Label htmlFor="daily_errand_end">{labels.endDate}</Label>
                <div
                  style={{ direction: isRtl ? 'rtl' : 'ltr' }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                >
                  <LazyDatePicker
                    id="daily_errand_end"
                    value={endDate}
                    minDate={startDate ?? undefined}
                    onChange={(date: DateObjectLike) => {
                      const next = date ?? null;
                      setEndDate(
                        next &&
                          startDate &&
                          dateObjectToGregorian(next) < dateObjectToGregorian(startDate)
                          ? null
                          : next
                      );
                    }}
                    {...datePickerProps}
                  />
                </div>
              </div>
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="daily_errand_location">{labels.location}</Label>
            <Input
              id="daily_errand_location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder={labels.locationPlaceholder}
              maxLength={MAX_ERRAND_LOCATION_LENGTH}
              required
              data-testid="daily-errand-location"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="daily_errand_description">{labels.description}</Label>
            <Textarea
              id="daily_errand_description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={500}
              className="resize-none"
              data-testid="daily-errand-description"
            />
          </div>

          <RequestSignatureFields
            idPrefix="daily-errand"
            value={signatureData}
            onChange={setSignatureData}
            authorized={signatureAuthorized}
            onAuthorizedChange={setSignatureAuthorized}
            labels={labels.signature}
          />

          {requestedMinutes > 0 && (
            <div
              className="rounded-lg bg-secondary px-4 py-3 text-sm"
              data-testid="daily-errand-preview"
            >
              {labels.requestingLabel}:{' '}
              <strong>
                {formatDuration(
                  requestedMinutes,
                  workSettings.hoursPerDay,
                  locale,
                  labels
                )}
              </strong>
            </div>
          )}

          {successMsg && (
            <div
              className="rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success"
              data-testid="daily-errand-success"
            >
              {successMsg}
            </div>
          )}
          {errorMsg && (
            <div
              className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              data-testid="daily-errand-error"
            >
              <strong>{labels.errorLabel}:</strong> {errorMsg}
            </div>
          )}

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
