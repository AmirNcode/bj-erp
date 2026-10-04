'use client';

import { useState } from 'react';
import { countWorkingDays } from '@/lib/leave/workingDays';
import { dateObjectToGregorian, isHalfDayAllowed, type PickerDate } from '@/lib/leave/dateConvert';
import { daysToMinutes } from '@/lib/leave/duration';
import { submitRequest } from '@/lib/actions/leave/requests';
import { RequestSignatureFields, type SignatureLabels } from './_components/RequestSignature';
import {
  DateRangeFields,
  FormFeedback,
  LeaveBalancePreview,
  LeaveTypeSelect,
  ReplacementField,
} from './_components/FormParts';
import {
  useLeaveBalance,
  useReplacementCandidates,
  useRequestSubmit,
  useSignature,
} from './_components/useRequestForm';
import type { LeaveType, WorkSettings } from '@/lib/actions/leave/reference';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type DayPart = 'full' | 'am' | 'pm';

type Labels = {
  leaveType: string;
  selectType: string;
  dateRange: string;
  startDate: string;
  endDate: string;
  dayPart: string;
  dayPartFull: string;
  dayPartAm: string;
  dayPartPm: string;
  reason: string;
  submit: string;
  requestingLabel: string;
  remainingBalanceLabel: string;
  unpaidTimeOffLabel: string;
  noBalance: string;
  days: string;
  hours: string;
  minutes: string;
  and: string;
  success: string;
  errorLabel: string;
  validationSelectType: string;
  validationSelectDate: string;
  replacementTitle: string;
  replacementHint: string;
  replacementSelect: string;
  replacementNoReplacement: string;
  replacementOnLeave: string;
  replacementLoading: string;
  replacementEmpty: string;
  signature: SignatureLabels;
};

type Props = {
  leaveTypes: LeaveType[];
  workSettings: WorkSettings;
  labels: Labels;
  locale: string;
};

const selectClassName =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function LeaveRequestForm({ leaveTypes, workSettings, labels, locale }: Props) {
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [startDate, setStartDate] = useState<PickerDate | null>(null);
  const [endDate, setEndDate] = useState<PickerDate | null>(null);
  const [dayPart, setDayPart] = useState<DayPart>('full');
  const [reason, setReason] = useState('');
  const signature = useSignature();
  const { success, error, isPending, submit } = useRequestSubmit(labels.success);

  const selectedType = leaveTypes.find((t) => t.id === selectedTypeId);
  const start = startDate ? dateObjectToGregorian(startDate) : '';
  const end = endDate ? dateObjectToGregorian(endDate) : '';

  // Half-day is only offered for a single eligible day; otherwise it is a full day.
  const showHalfDay = isHalfDayAllowed(selectedType?.allow_half_day ?? false, start, end);
  const effectiveDayPart: DayPart = showHalfDay ? dayPart : 'full';

  const workingDays =
    start && end
      ? countWorkingDays(start, end, {
          weekendDays: workSettings.weekendDays,
          holidays: workSettings.holidays,
          dayPart: effectiveDayPart,
        })
      : null;
  const requestedMinutes =
    workingDays === null ? null : daysToMinutes(workingDays, workSettings.hoursPerDay);

  const balance = useLeaveBalance(selectedTypeId, requestedMinutes);
  const replacement = useReplacementCandidates(start && end ? { start, end, unit: 'day' } : null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = !selectedTypeId
      ? labels.validationSelectType
      : !start || !end
        ? labels.validationSelectDate
        : signature.problem(labels.signature);

    submit(
      problem,
      () =>
        submitRequest({
          leaveTypeId: selectedTypeId,
          start,
          end,
          dayPart: effectiveDayPart,
          reason: reason || undefined,
          replacementId: replacement.replacementId || null,
          signatureData: signature.data,
          signatureAuthorized: signature.authorized,
        }),
      () => {
        setStartDate(null);
        setEndDate(null);
        setReason('');
        replacement.reset();
        signature.reset();
        setDayPart('full');
      }
    );
  };

  return (
    <Card className="rounded-t-none">
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <LeaveTypeSelect
            id="leave_type_id"
            className={selectClassName}
            leaveTypes={leaveTypes}
            value={selectedTypeId}
            onChange={setSelectedTypeId}
            locale={locale}
            label={labels.leaveType}
            placeholder={labels.selectType}
          />

          {/* Separate dates make the range explicit and match the client's form. */}
          <DateRangeFields
            locale={locale}
            legend={labels.dateRange}
            start={startDate}
            end={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
            startField={{ id: 'daily_start_date', testId: 'daily-start-date', label: labels.startDate }}
            endField={{ id: 'daily_end_date', testId: 'daily-end-date', label: labels.endDate }}
          />

          {showHalfDay && (
            <div className="space-y-1.5">
              <Label htmlFor="day_part">{labels.dayPart}</Label>
              <select
                id="day_part"
                value={dayPart}
                onChange={(e) => setDayPart(e.target.value as DayPart)}
                className={selectClassName}
              >
                <option value="full">{labels.dayPartFull}</option>
                <option value="am">{labels.dayPartAm}</option>
                <option value="pm">{labels.dayPartPm}</option>
              </select>
            </div>
          )}

          <ReplacementField replacement={replacement} labels={labels} />

          <div className="space-y-1.5">
            <Label htmlFor="reason">{labels.reason}</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="resize-none"
            />
          </div>

          <RequestSignatureFields idPrefix="daily" {...signature.fieldProps} labels={labels.signature} />

          <LeaveBalancePreview
            requestedMinutes={requestedMinutes}
            leaveType={selectedType}
            balance={balance}
            hoursPerDay={workSettings.hoursPerDay}
            locale={locale}
            labels={labels}
            testIds={{
              container: 'leave-preview',
              requesting: 'working-days-count',
              balance: 'balance-display',
              unpaid: 'unpaid-display',
            }}
          />

          <FormFeedback
            success={success}
            error={error}
            errorLabel={labels.errorLabel}
            successTestId="success-msg"
            errorTestId="error-msg"
          />

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? '...' : labels.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
