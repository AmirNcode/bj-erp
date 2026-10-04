'use client';

/**
 * Building blocks shared by the four request forms (daily leave, hourly leave,
 * hourly errand, daily errand). Every id, data-testid and string comes from the
 * caller, so each form keeps its own DOM contract with the e2e suite.
 */

import { PersianDateField } from '@/components/PersianDateField';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { LeaveType } from '@/lib/actions/leave/reference';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import { dateObjectToGregorian, type PickerDate } from '@/lib/leave/dateConvert';
import {
  formatDuration,
  type DurationLabels,
  type LeaveBalanceProjection,
} from '@/lib/leave/duration';
import { MAX_ERRAND_LOCATION_LENGTH } from '@/lib/leave/errand';
import { nativeSelectClass } from '@/lib/native-select';
import { ReplacementPicker } from './ReplacementPicker';
import type { useReplacementCandidates } from './useRequestForm';

export function LeaveTypeSelect({
  id,
  testId,
  className = nativeSelectClass,
  leaveTypes,
  value,
  onChange,
  locale,
  label,
  placeholder,
}: {
  id: string;
  testId?: string;
  className?: string;
  leaveTypes: LeaveType[];
  value: string;
  onChange: (leaveTypeId: string) => void;
  locale: string;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        data-testid={testId}
      >
        <option value="">{placeholder}</option>
        {leaveTypes.map((lt) => (
          <option key={lt.id} value={lt.id}>
            {localizedLeaveTypeName(lt, locale)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Separate start and end pickers; an end before the start is cleared. */
export function DateRangeFields({
  locale,
  legend,
  start,
  end,
  onStartChange,
  onEndChange,
  startField,
  endField,
}: {
  locale: string;
  legend: string;
  start: PickerDate | null;
  end: PickerDate | null;
  onStartChange: (value: PickerDate | null) => void;
  onEndChange: (value: PickerDate | null) => void;
  startField: { id: string; testId: string; label: string };
  endField: { id: string; testId: string; label: string };
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5" data-testid={startField.testId}>
          <Label htmlFor={startField.id}>{startField.label}</Label>
          <PersianDateField
            id={startField.id}
            locale={locale}
            value={start}
            onChange={(next) => {
              onStartChange(next);
              if (!next || (end && dateObjectToGregorian(next) > dateObjectToGregorian(end))) {
                onEndChange(null);
              }
            }}
          />
        </div>
        <div className="space-y-1.5" data-testid={endField.testId}>
          <Label htmlFor={endField.id}>{endField.label}</Label>
          <PersianDateField
            id={endField.id}
            locale={locale}
            value={end}
            minDate={start}
            onChange={(next) =>
              onEndChange(
                next && start && dateObjectToGregorian(next) < dateObjectToGregorian(start)
                  ? null
                  : next
              )
            }
          />
        </div>
      </div>
    </fieldset>
  );
}

/**
 * From/to times as native selects of fixed slots: the e2e suite drives native
 * selects with selectOption, and on a phone a slot list beats free text.
 * `prefix` yields ids `<prefix>_from` / `<prefix>_to` and test ids `<prefix>-from` / `<prefix>-to`.
 */
export function TimeRangeFields({
  prefix,
  slots,
  from,
  to,
  onFromChange,
  onToChange,
  fromLabel,
  toLabel,
}: {
  prefix: string;
  slots: string[];
  from: string;
  to: string;
  onFromChange: (time: string) => void;
  onToChange: (time: string) => void;
  fromLabel: string;
  toLabel: string;
}) {
  const fields = [
    { key: 'from', label: fromLabel, value: from, onChange: onFromChange },
    { key: 'to', label: toLabel, value: to, onChange: onToChange },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`${prefix}_${field.key}`}>{field.label}</Label>
          <select
            id={`${prefix}_${field.key}`}
            value={field.value}
            onChange={(e) => field.onChange(e.target.value)}
            className={nativeSelectClass}
            dir="ltr"
            data-testid={`${prefix}-${field.key}`}
          >
            {slots.map((s) => (
              <option key={`${field.key}-${s}`} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

/**
 * محل ماموریت (required; maxLength mirrors the CHECK constraint) and شرح ماموریت
 * (optional; stored in `reason`, so FR-25-private).
 */
export function ErrandDetailsFields({
  idPrefix,
  testIdPrefix,
  location,
  description,
  onLocationChange,
  onDescriptionChange,
  labels,
}: {
  idPrefix: string;
  testIdPrefix: string;
  location: string;
  description: string;
  onLocationChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  labels: { location: string; locationPlaceholder: string; description: string };
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}_location`}>{labels.location}</Label>
        <Input
          id={`${idPrefix}_location`}
          value={location}
          onChange={(e) => onLocationChange(e.target.value)}
          placeholder={labels.locationPlaceholder}
          maxLength={MAX_ERRAND_LOCATION_LENGTH}
          required
          data-testid={`${testIdPrefix}-location`}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}_description`}>{labels.description}</Label>
        <Textarea
          id={`${idPrefix}_description`}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={2}
          maxLength={500}
          className="resize-none"
          data-testid={`${testIdPrefix}-description`}
        />
      </div>
    </>
  );
}

/** The optional جانشین / جایگزین field, driven by `useReplacementCandidates`. */
export function ReplacementField({
  replacement,
  labels,
}: {
  replacement: ReturnType<typeof useReplacementCandidates>;
  labels: {
    replacementTitle: string;
    replacementHint: string;
    replacementSelect: string;
    replacementNoReplacement: string;
    replacementOnLeave: string;
    replacementLoading: string;
    replacementEmpty: string;
  };
}) {
  return (
    <ReplacementPicker
      candidates={replacement.candidates}
      loading={replacement.loading}
      value={replacement.replacementId}
      onChange={replacement.setReplacementId}
      noReplacement={replacement.noReplacement}
      onNoReplacementChange={replacement.setNoReplacement}
      labels={{
        title: labels.replacementTitle,
        hint: labels.replacementHint,
        select: labels.replacementSelect,
        noReplacement: labels.replacementNoReplacement,
        onLeave: labels.replacementOnLeave,
        loading: labels.replacementLoading,
        empty: labels.replacementEmpty,
      }}
    />
  );
}

/** What a paid leave request asks for, and the balance it would leave. */
export function LeaveBalancePreview({
  requestedMinutes,
  leaveType,
  balance,
  hoursPerDay,
  locale,
  labels,
  testIds,
}: {
  /** Null hides the preview. */
  requestedMinutes: number | null;
  leaveType: LeaveType | undefined;
  balance: { loading: boolean; projection: LeaveBalanceProjection | null };
  hoursPerDay: number;
  locale: string;
  labels: DurationLabels & {
    requestingLabel: string;
    remainingBalanceLabel: string;
    noBalance: string;
    unpaidTimeOffLabel: string;
  };
  testIds: { container: string; requesting: string; balance: string; unpaid: string };
}) {
  if (requestedMinutes === null) return null;
  const duration = (minutes: number) => formatDuration(minutes, hoursPerDay, locale, labels);
  const { loading, projection } = balance;

  return (
    <div className="rounded-lg bg-secondary px-4 py-3 text-sm space-y-1" data-testid={testIds.container}>
      <div data-testid={testIds.requesting}>
        {labels.requestingLabel}: <strong>{duration(requestedMinutes)}</strong>
      </div>
      {leaveType?.is_paid && leaveType.affects_balance && (
        <>
          <div data-testid={testIds.balance}>
            {loading
              ? '…'
              : projection
                ? `${labels.remainingBalanceLabel}: ${duration(projection.remainingMinutes)}`
                : labels.noBalance}
          </div>
          {projection && projection.unpaidMinutes > 0 && (
            <div className="font-medium text-destructive" data-testid={testIds.unpaid}>
              {labels.unpaidTimeOffLabel}: {duration(projection.unpaidMinutes)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Success and error banners under a request form. */
export function FormFeedback({
  success,
  error,
  errorLabel,
  successTestId,
  errorTestId,
}: {
  success: string;
  error: string;
  errorLabel: string;
  successTestId: string;
  errorTestId: string;
}) {
  return (
    <>
      {success && (
        <div
          className="rounded-lg px-4 py-3 text-sm text-success bg-success/10 border border-success/20"
          data-testid={successTestId}
        >
          {success}
        </div>
      )}
      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm text-destructive bg-destructive/10 border border-destructive/20"
          data-testid={errorTestId}
        >
          <strong>{errorLabel}:</strong> {error}
        </div>
      )}
    </>
  );
}
