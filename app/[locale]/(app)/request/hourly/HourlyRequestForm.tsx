'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LazyDatePicker } from '@/components/LazyDatePicker';
import { dateObjectToGregorian } from '@/lib/leave/dateConvert';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';
import { timeSlots, rangeMinutes } from '@/lib/leave/hourly';
import { formatDuration, projectLeaveBalance } from '@/lib/leave/duration';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import { submitHourlyRequest, getMyBalance, getReplacementCandidates } from '@/lib/actions/leave';
import { ReplacementPicker } from '../_components/ReplacementPicker';
import {
  RequestSignatureFields,
  type SignatureLabels,
} from '../_components/RequestSignature';
import type { ReplacementCandidate } from '@/lib/leave/replacement';
import type { LeaveType, WorkSettings } from '@/lib/actions/leave';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { nativeSelectClass } from '@/lib/native-select';

type Labels = {
  leaveType: string;
  selectType: string;
  date: string;
  fromTime: string;
  toTime: string;
  reason: string;
  submit: string;
  preview: string;
  durationLabel: string;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DateObjectLike = any;

/**
 * مرخصی ساعتی — the BJ-F 50208 flow: one date, a from-time and a to-time.
 *
 * Times are native <select>s of 30-minute slots across the company work window:
 * the e2e suite drives native selects with selectOption (a repo rule), and on a
 * factory-floor phone a fixed slot list beats a free-text time field.
 */
export function HourlyRequestForm({
  leaveTypes,
  workSettings,
  labels,
  locale,
}: Props) {
  const router = useRouter();
  const { isRtl, calendar, calLocale, calendarPosition } = calendarPickerConfig(locale);

  const slots = timeSlots(
    { start: workSettings.workStart, end: workSettings.workEnd },
    30
  );

  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [date, setDate] = useState<DateObjectLike | null>(null);
  const [startTime, setStartTime] = useState(slots[0] ?? '');
  const [endTime, setEndTime] = useState(slots[2] ?? slots[slots.length - 1] ?? '');
  const [reason, setReason] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [noReplacement, setNoReplacement] = useState(false);
  const [signatureData, setSignatureData] = useState('');
  const [signatureAuthorized, setSignatureAuthorized] = useState(false);
  const [candidates, setCandidates] = useState<ReplacementCandidate[]>([]);
  const [candidatesFor, setCandidatesFor] = useState<string | null>(null);
  const [balanceMinutes, setBalanceMinutes] = useState<number | null>(null);
  const [balanceFor, setBalanceFor] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const selectedType = leaveTypes.find((t) => t.id === selectedTypeId);

  const gregorianDate = useCallback(
    () => (date ? dateObjectToGregorian(date) : ''),
    [date]
  );

  const durationMinutes = rangeMinutes({ start: startTime, end: endTime });
  const overLimit = durationMinutes > workSettings.maxHourlyMinutesPerDay;

  const effectiveBalance = balanceFor === selectedTypeId ? balanceMinutes : null;
  const balanceLoading = !!selectedTypeId && balanceFor !== selectedTypeId;
  const balanceProjection =
    durationMinutes > 0 && effectiveBalance !== null
      ? projectLeaveBalance(durationMinutes, effectiveBalance)
      : null;

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

  // Availability is time-aware for hourly, so the list depends on the date AND the
  // chosen hours. Loading is derived; state is set only in the async callback.
  const isoDate = date ? dateObjectToGregorian(date) : '';
  const slotKey = isoDate && durationMinutes > 0 ? `${isoDate}:${startTime}:${endTime}` : '';
  const candidatesReady = !!slotKey && candidatesFor === slotKey;
  const shownCandidates = candidatesReady ? candidates : [];
  const candidatesLoading = !!slotKey && !candidatesReady;

  useEffect(() => {
    if (!slotKey) return;
    let cancelled = false;
    getReplacementCandidates({
      start: isoDate,
      end: isoDate,
      unit: 'hour',
      startTime,
      endTime,
    }).then((res) => {
      if (cancelled) return;
      const list = res.ok ? res.candidates : [];
      setCandidates(list);
      setCandidatesFor(slotKey);
      setReplacementId((current) =>
        current && list.some((c) => c.profileId === current && !c.unavailable) ? current : ''
      );
    });
    return () => {
      cancelled = true;
    };
  }, [slotKey, isoDate, startTime, endTime]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!selectedTypeId) {
      setErrorMsg(labels.validationSelectType);
      return;
    }
    const iso = gregorianDate();
    if (!iso) {
      setErrorMsg(labels.validationSelectDate);
      return;
    }
    if (durationMinutes <= 0) {
      setErrorMsg(labels.validationTimes);
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
      const result = await submitHourlyRequest({
        leaveTypeId: selectedTypeId,
        date: iso,
        startTime,
        endTime,
        reason: reason || undefined,
        replacementId: replacementId || null,
        signatureData,
        signatureAuthorized,
      });

      if (result.ok) {
        setSuccessMsg(labels.success);
        setDate(null);
        setReason('');
        setReplacementId('');
        setNoReplacement(false);
        setSignatureData('');
        setSignatureAuthorized(false);
        router.refresh();
      } else {
        setErrorMsg(result.error);
      }
    });
  };

  return (
    <Card className="rounded-t-none">
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" data-testid="hourly-form">
          {/* Leave type — only types the admin enabled for hourly */}
          <div className="space-y-1.5">
            <Label htmlFor="hourly_leave_type">{labels.leaveType}</Label>
            <select
              id="hourly_leave_type"
              value={selectedTypeId}
              onChange={(e) => setSelectedTypeId(e.target.value)}
              className={nativeSelectClass}
              data-testid="hourly-type"
            >
              <option value="">{labels.selectType}</option>
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {localizedLeaveTypeName(lt, locale)}
                </option>
              ))}
            </select>
          </div>

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
                calendarPosition={calendarPosition}
                inputClass="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                containerClassName="rmdp-container w-full"
                format="YYYY/MM/DD"
              />
            </div>
          </div>

          {/* From / to — native selects for e2e selectOption and phone usability */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hourly_from">{labels.fromTime}</Label>
              <select
                id="hourly_from"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={nativeSelectClass}
                dir="ltr"
                data-testid="hourly-from"
              >
                {slots.map((s) => (
                  <option key={`from-${s}`} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hourly_to">{labels.toTime}</Label>
              <select
                id="hourly_to"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={nativeSelectClass}
                dir="ltr"
                data-testid="hourly-to"
              >
                {slots.map((s) => (
                  <option key={`to-${s}`} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{labels.dailyLimitHint}</p>

          {/* Replacement / جایگزین — optional, same department, availability-aware */}
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

          <RequestSignatureFields
            idPrefix="hourly"
            value={signatureData}
            onChange={setSignatureData}
            authorized={signatureAuthorized}
            onAuthorizedChange={setSignatureAuthorized}
            labels={labels.signature}
          />

          {/* Live preview — duration and balance, both in days-and-hours */}
          {durationMinutes > 0 && (
            <div
              className="rounded-lg bg-secondary px-4 py-3 text-sm space-y-1"
              data-testid="hourly-preview"
            >
              <div data-testid="hourly-duration">
                {labels.requestingLabel}:{' '}
                <strong>
                  {formatDuration(durationMinutes, workSettings.hoursPerDay, locale, labels)}
                </strong>
              </div>
              {selectedType?.is_paid && selectedType.affects_balance && (
                <>
                  <div data-testid="hourly-balance">
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
                    <div
                      className="font-medium text-destructive"
                      data-testid="hourly-unpaid"
                    >
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

          {successMsg && (
            <div
              className="rounded-lg px-4 py-3 text-sm text-success bg-success/10 border border-success/20"
              data-testid="hourly-success"
            >
              {successMsg}
            </div>
          )}
          {errorMsg && (
            <div
              className="rounded-lg px-4 py-3 text-sm text-destructive bg-destructive/10 border border-destructive/20"
              data-testid="hourly-error"
            >
              <strong>{labels.errorLabel}:</strong> {errorMsg}
            </div>
          )}

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
