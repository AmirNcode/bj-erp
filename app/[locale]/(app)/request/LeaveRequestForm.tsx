'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LazyDatePicker } from '@/components/LazyDatePicker';
import { countWorkingDays } from '@/lib/leave/workingDays';
import { dateObjectToGregorian, isHalfDayAllowed } from '@/lib/leave/dateConvert';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import {
  daysToMinutes,
  formatDuration,
  projectLeaveBalance,
} from '@/lib/leave/duration';
import { submitRequest, getMyBalance, getReplacementCandidates } from '@/lib/actions/leave';
import { ReplacementPicker } from './_components/ReplacementPicker';
import {
  RequestSignatureFields,
  type SignatureLabels,
} from './_components/RequestSignature';
import type { ReplacementCandidate } from '@/lib/leave/replacement';
import type { LeaveType, WorkSettings } from '@/lib/actions/leave';
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
  preview: string;
  workingDaysLabel: string;
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
  from: string;
  to: string;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DateObjectLike = any;

const selectClassName =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function LeaveRequestForm({ leaveTypes, workSettings, labels, locale }: Props) {
  const router = useRouter();
  const { isRtl, calendar, calLocale, calendarPosition } = calendarPickerConfig(locale);

  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [startDate, setStartDate] = useState<DateObjectLike | null>(null);
  const [endDate, setEndDate] = useState<DateObjectLike | null>(null);
  const [dayPart, setDayPart] = useState<DayPart>('full');
  const [reason, setReason] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [noReplacement, setNoReplacement] = useState(false);
  const [signatureData, setSignatureData] = useState('');
  const [signatureAuthorized, setSignatureAuthorized] = useState(false);
  const [candidates, setCandidates] = useState<ReplacementCandidate[]>([]);
  // Which range the current list was fetched for; loading is DERIVED from it, the
  // same way the balance effect avoids setting state synchronously.
  const [candidatesFor, setCandidatesFor] = useState<string | null>(null);
  const [balanceMinutes, setBalanceMinutes] = useState<number | null>(null);
  const [balanceFor, setBalanceFor] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const selectedType = leaveTypes.find((t) => t.id === selectedTypeId);

  const previewStart = startDate ? dateObjectToGregorian(startDate) : '';
  const previewEnd = endDate ? dateObjectToGregorian(endDate) : '';

  // Half-day is only offered for a single eligible day; otherwise the day part
  // is treated as a full day. Derived during render — no effect needed.
  const showHalfDay = isHalfDayAllowed(
    selectedType?.allow_half_day ?? false,
    previewStart,
    previewEnd
  );
  const effectiveDayPart: DayPart = showHalfDay ? dayPart : 'full';

  // Working-days preview is a pure function of the range, work settings, and the
  // effective day part — derive it rather than storing it via an effect.
  const workingDaysCount =
    !previewStart || !previewEnd
      ? null
      : countWorkingDays(previewStart, previewEnd, {
          weekendDays: workSettings.weekendDays,
          holidays: workSettings.holidays,
          dayPart: effectiveDayPart,
        });
  const requestedMinutes =
    workingDaysCount === null
      ? null
      : daysToMinutes(workingDaysCount, workSettings.hoursPerDay);

  // Balance is fetched when the selected type changes; show it only once the
  // fetch for the currently-selected type has resolved (derived, not an effect).
  const effectiveBalance = balanceFor === selectedTypeId ? balanceMinutes : null;
  const balanceLoading = !!selectedTypeId && balanceFor !== selectedTypeId;
  const balanceProjection =
    requestedMinutes !== null && effectiveBalance !== null
      ? projectLeaveBalance(requestedMinutes, effectiveBalance)
      : null;

  // Fetch balance when the selected type changes. The only state updates happen
  // in the async callback, so this effect does not set state synchronously.
  useEffect(() => {
    if (!selectedTypeId) return;
    let cancelled = false;
    getMyBalance(selectedTypeId).then((res) => {
      if (cancelled) return;
      setBalanceMinutes(res.ok ? res.balanceMinutes : null);
      setBalanceFor(selectedTypeId);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedTypeId]);

  // Availability depends on the chosen dates, so the list is re-fetched whenever
  // they change, and a pick that is no longer valid is dropped. State is only set
  // inside the async callback — never synchronously in the effect.
  const rangeKey = previewStart && previewEnd ? `${previewStart}:${previewEnd}` : '';
  const candidatesReady = !!rangeKey && candidatesFor === rangeKey;
  const shownCandidates = candidatesReady ? candidates : [];
  const candidatesLoading = !!rangeKey && !candidatesReady;

  useEffect(() => {
    if (!rangeKey) return;
    let cancelled = false;
    const [start, end] = rangeKey.split(':');
    getReplacementCandidates({ start, end, unit: 'day' }).then((res) => {
      if (cancelled) return;
      const list = res.ok ? res.candidates : [];
      setCandidates(list);
      setCandidatesFor(rangeKey);
      setReplacementId((current) =>
        current && list.some((c) => c.profileId === current && !c.unavailable) ? current : ''
      );
    });
    return () => {
      cancelled = true;
    };
  }, [rangeKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!selectedTypeId) {
      setErrorMsg(labels.validationSelectType);
      return;
    }
    if (!previewStart || !previewEnd) {
      setErrorMsg(labels.validationSelectDate);
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
      const result = await submitRequest({
        leaveTypeId: selectedTypeId,
        start: previewStart,
        end: previewEnd,
        dayPart: effectiveDayPart,
        reason: reason || undefined,
        replacementId: replacementId || null,
        signatureData,
        signatureAuthorized,
      });

      if (result.ok) {
        setSuccessMsg(labels.success);
        setStartDate(null);
        setEndDate(null);
        setReason('');
        setReplacementId('');
        setNoReplacement(false);
        setSignatureData('');
        setSignatureAuthorized(false);
        setDayPart('full');
        // Refresh server data without a full page reload
        router.refresh();
      } else {
        setErrorMsg(result.error);
      }
    });
  };

  return (
    <Card className="rounded-t-none">
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Leave type */}
          <div className="space-y-1.5">
            <Label htmlFor="leave_type_id">{labels.leaveType}</Label>
            <select
              id="leave_type_id"
              value={selectedTypeId}
              onChange={(e) => setSelectedTypeId(e.target.value)}
              className={selectClassName}
            >
              <option value="">{labels.selectType}</option>
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {localizedLeaveTypeName(lt, locale)}
                </option>
              ))}
            </select>
          </div>

          {/* Separate dates make the range explicit and match the client's form. */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{labels.dateRange}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5" data-testid="daily-start-date">
                <Label htmlFor="daily_start_date">{labels.startDate}</Label>
                <div
                  style={{ direction: isRtl ? 'rtl' : 'ltr' }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                >
                  <LazyDatePicker
                    id="daily_start_date"
                    value={startDate}
                    onChange={(date: DateObjectLike) => {
                      const next = date ?? null;
                      setStartDate(next);
                      if (
                        !next ||
                        (endDate &&
                          dateObjectToGregorian(next) > dateObjectToGregorian(endDate))
                      ) {
                        setEndDate(null);
                      }
                    }}
                    calendar={calendar}
                    locale={calLocale}
                    calendarPosition={calendarPosition}
                    inputClass="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    containerClassName="rmdp-container w-full"
                    format="YYYY/MM/DD"
                  />
                </div>
              </div>
              <div className="space-y-1.5" data-testid="daily-end-date">
                <Label htmlFor="daily_end_date">{labels.endDate}</Label>
                <div
                  style={{ direction: isRtl ? 'rtl' : 'ltr' }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                >
                  <LazyDatePicker
                    id="daily_end_date"
                    value={endDate}
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
                    minDate={startDate ?? undefined}
                    calendar={calendar}
                    locale={calLocale}
                    calendarPosition={calendarPosition}
                    inputClass="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    containerClassName="rmdp-container w-full"
                    format="YYYY/MM/DD"
                  />
                </div>
              </div>
            </div>
          </fieldset>

          {/* Day part — only shown when single day + allow_half_day */}
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

          {/* Replacement / جانشین — optional, same department, availability-aware */}
          <ReplacementPicker
            candidates={shownCandidates}
            loading={candidatesLoading}
            value={replacementId}
            onChange={setReplacementId}
            noReplacement={noReplacement}
            onNoReplacementChange={setNoReplacement}
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

          {/* Reason */}
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

          <RequestSignatureFields
            idPrefix="daily"
            value={signatureData}
            onChange={setSignatureData}
            authorized={signatureAuthorized}
            onAuthorizedChange={setSignatureAuthorized}
            labels={labels.signature}
          />

          {/* Live preview */}
          {requestedMinutes !== null && (
            <div
              className="rounded-lg bg-secondary px-4 py-3 text-sm space-y-1"
              data-testid="leave-preview"
            >
              <div data-testid="working-days-count">
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
              {selectedType?.is_paid && selectedType.affects_balance && (
                <>
                  <div data-testid="balance-display">
                    {balanceLoading
                      ? '…'
                      : balanceProjection
                        ? `${labels.remainingBalanceLabel}: ${formatDuration(
                            balanceProjection.remainingMinutes,
                            workSettings.hoursPerDay,
                            locale,
                            labels
                          )}`
                        : labels.noBalance}
                  </div>
                  {balanceProjection && balanceProjection.unpaidMinutes > 0 && (
                    <div className="font-medium text-destructive" data-testid="unpaid-display">
                      {labels.unpaidTimeOffLabel}:{' '}
                      {formatDuration(
                        balanceProjection.unpaidMinutes,
                        workSettings.hoursPerDay,
                        locale,
                        labels
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Success / error */}
          {successMsg && (
            <div className="rounded-lg px-4 py-3 text-sm text-success bg-success/10 border border-success/20" data-testid="success-msg">
              {successMsg}
            </div>
          )}
          {errorMsg && (
            <div className="rounded-lg px-4 py-3 text-sm text-destructive bg-destructive/10 border border-destructive/20" data-testid="error-msg">
              <strong>{labels.errorLabel}:</strong> {errorMsg}
            </div>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full"
          >
            {isPending ? '...' : labels.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
