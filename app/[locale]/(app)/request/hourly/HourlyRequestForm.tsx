'use client';

import { useState } from 'react';
import { dateObjectToGregorian, type PickerDate } from '@/lib/leave/dateConvert';
import { timeSlots, rangeMinutes } from '@/lib/leave/hourly';
import { submitHourlyRequest } from '@/lib/actions/leave/requests';
import { RequestSignatureFields, type SignatureLabels } from '../_components/RequestSignature';
import {
  FormFeedback,
  LeaveBalancePreview,
  LeaveTypeSelect,
  ReplacementField,
  TimeRangeFields,
} from '../_components/FormParts';
import {
  useLeaveBalance,
  useReplacementCandidates,
  useRequestSubmit,
  useSignature,
} from '../_components/useRequestForm';
import type { LeaveType, WorkSettings } from '@/lib/actions/leave/reference';
import { PersianDateField } from '@/components/PersianDateField';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Labels = {
  leaveType: string;
  selectType: string;
  date: string;
  fromTime: string;
  toTime: string;
  reason: string;
  submit: string;
  requestingLabel: string;
  remainingBalanceLabel: string;
  unpaidTimeOffLabel: string;
  noBalance: string;
  success: string;
  errorLabel: string;
  validationSelectType: string;
  validationSelectDate: string;
  validationTimes: string;
  dailyLimitHint: string;
  replacementTitle: string;
  replacementHint: string;
  replacementSelect: string;
  replacementNoReplacement: string;
  replacementOnLeave: string;
  replacementLoading: string;
  replacementEmpty: string;
  signature: SignatureLabels;
  days: string;
  hours: string;
  minutes: string;
  and: string;
};

type Props = {
  /** Already filtered to types with allow_hourly — the SQL re-checks anyway. */
  leaveTypes: LeaveType[];
  workSettings: WorkSettings;
  labels: Labels;
  locale: string;
};

/**
 * مرخصی ساعتی — the BJ-F 50208 flow: one date, a from-time and a to-time, as
 * 30-minute slots across the company work window.
 */
export function HourlyRequestForm({ leaveTypes, workSettings, labels, locale }: Props) {
  const slots = timeSlots({ start: workSettings.workStart, end: workSettings.workEnd }, 30);

  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [date, setDate] = useState<PickerDate | null>(null);
  const [startTime, setStartTime] = useState(slots[0] ?? '');
  const [endTime, setEndTime] = useState(slots[2] ?? slots[slots.length - 1] ?? '');
  const [reason, setReason] = useState('');
  const signature = useSignature();
  const { success, error, isPending, submit } = useRequestSubmit(labels.success);

  const selectedType = leaveTypes.find((t) => t.id === selectedTypeId);
  const isoDate = date ? dateObjectToGregorian(date) : '';
  const durationMinutes = rangeMinutes({ start: startTime, end: endTime });
  const overLimit = durationMinutes > workSettings.maxHourlyMinutesPerDay;

  const balance = useLeaveBalance(selectedTypeId, durationMinutes > 0 ? durationMinutes : null);
  // Availability is time-aware for hourly leave: it depends on the date AND the hours.
  const replacement = useReplacementCandidates(
    isoDate && durationMinutes > 0
      ? { start: isoDate, end: isoDate, unit: 'hour', startTime, endTime }
      : null
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = !selectedTypeId
      ? labels.validationSelectType
      : !isoDate
        ? labels.validationSelectDate
        : durationMinutes <= 0
          ? labels.validationTimes
          : signature.problem(labels.signature);

    submit(
      problem,
      () =>
        submitHourlyRequest({
          leaveTypeId: selectedTypeId,
          date: isoDate,
          startTime,
          endTime,
          reason: reason || undefined,
          replacementId: replacement.replacementId || null,
          signatureData: signature.data,
          signatureAuthorized: signature.authorized,
        }),
      () => {
        setDate(null);
        setReason('');
        replacement.reset();
        signature.reset();
      }
    );
  };

  return (
    <Card className="rounded-t-none">
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" data-testid="hourly-form">
          {/* Only types the admin enabled for hourly */}
          <LeaveTypeSelect
            id="hourly_leave_type"
            testId="hourly-type"
            leaveTypes={leaveTypes}
            value={selectedTypeId}
            onChange={setSelectedTypeId}
            locale={locale}
            label={labels.leaveType}
            placeholder={labels.selectType}
          />

          <div className="space-y-1.5">
            <Label>{labels.date}</Label>
            <PersianDateField locale={locale} value={date} onChange={setDate} />
          </div>

          <TimeRangeFields
            prefix="hourly"
            slots={slots}
            from={startTime}
            to={endTime}
            onFromChange={setStartTime}
            onToChange={setEndTime}
            fromLabel={labels.fromTime}
            toLabel={labels.toTime}
          />

          <p className="text-sm text-muted-foreground">{labels.dailyLimitHint}</p>

          <ReplacementField replacement={replacement} labels={labels} />

          <div className="space-y-1.5">
            <Label htmlFor="hourly_reason">{labels.reason}</Label>
            <Textarea
              id="hourly_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="resize-none"
            />
          </div>

          <RequestSignatureFields idPrefix="hourly" {...signature.fieldProps} labels={labels.signature} />

          <LeaveBalancePreview
            requestedMinutes={durationMinutes > 0 ? durationMinutes : null}
            leaveType={selectedType}
            balance={balance}
            hoursPerDay={workSettings.hoursPerDay}
            locale={locale}
            labels={labels}
            testIds={{
              container: 'hourly-preview',
              requesting: 'hourly-duration',
              balance: 'hourly-balance',
              unpaid: 'hourly-unpaid',
            }}
          />

          <FormFeedback
            success={success}
            error={error}
            errorLabel={labels.errorLabel}
            successTestId="hourly-success"
            errorTestId="hourly-error"
          />

          <Button
            type="submit"
            disabled={isPending || overLimit}
            className="w-full"
            data-testid="hourly-submit"
          >
            {isPending ? '...' : labels.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
