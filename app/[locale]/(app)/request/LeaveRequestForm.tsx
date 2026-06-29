'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LazyDatePicker } from './LazyDatePicker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import { countWorkingDays } from '@/lib/leave/workingDays';
import { dateObjectToGregorian, isHalfDayAllowed } from '@/lib/leave/dateConvert';
import { submitRequest, getMyBalance } from '@/lib/actions/leave';
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
  dayPart: string;
  dayPartFull: string;
  dayPartAm: string;
  dayPartPm: string;
  reason: string;
  submit: string;
  preview: string;
  workingDays: string;
  remainingBalance: string;
  noBalance: string;
  success: string;
  errorLabel: string;
  from: string;
  to: string;
  validationSelectType: string;
  validationSelectDate: string;
};

type Props = {
  leaveTypes: LeaveType[];
  workSettings: WorkSettings;
  calendarPref: string; // 'jalali' | 'gregorian'
  labels: Labels;
  locale: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DateObjectLike = any;

const selectClassName =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function LeaveRequestForm({ leaveTypes, workSettings, calendarPref, labels, locale }: Props) {
  const router = useRouter();
  const isJalali = calendarPref === 'jalali';
  const calendar = isJalali ? persian : gregorian;
  const calLocale = isJalali ? persian_fa : gregorian_en;

  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [dateRange, setDateRange] = useState<DateObjectLike[]>([]);
  const [dayPart, setDayPart] = useState<DayPart>('full');
  const [reason, setReason] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceFor, setBalanceFor] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const selectedType = leaveTypes.find((t) => t.id === selectedTypeId);

  // Compute Gregorian start/end strings from DateObject range
  const getGregorianRange = useCallback(() => {
    if (dateRange.length < 2) return { start: '', end: '' };
    const start = dateObjectToGregorian(dateRange[0]);
    const end = dateObjectToGregorian(dateRange[1]);
    return { start, end };
  }, [dateRange]);

  const { start: previewStart, end: previewEnd } = getGregorianRange();

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
    dateRange.length < 2 || !previewStart || !previewEnd
      ? null
      : countWorkingDays(previewStart, previewEnd, {
          weekendDays: workSettings.weekendDays,
          holidays: workSettings.holidays,
          dayPart: effectiveDayPart,
        });

  // Balance is fetched when the selected type changes; show it only once the
  // fetch for the currently-selected type has resolved (derived, not an effect).
  const effectiveBalance = balanceFor === selectedTypeId ? balance : null;
  const balanceLoading = !!selectedTypeId && balanceFor !== selectedTypeId;

  // Fetch balance when the selected type changes. The only state updates happen
  // in the async callback, so this effect does not set state synchronously.
  useEffect(() => {
    if (!selectedTypeId) return;
    let cancelled = false;
    getMyBalance(selectedTypeId).then((res) => {
      if (cancelled) return;
      setBalance(res.ok ? res.balance : null);
      setBalanceFor(selectedTypeId);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedTypeId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!selectedTypeId) {
      setErrorMsg(labels.validationSelectType);
      return;
    }
    if (dateRange.length < 2) {
      setErrorMsg(labels.validationSelectDate);
      return;
    }

    const { start, end } = getGregorianRange();

    startTransition(async () => {
      const result = await submitRequest({
        leaveTypeId: selectedTypeId,
        start,
        end,
        dayPart: effectiveDayPart,
        reason: reason || undefined,
      });

      if (result.ok) {
        setSuccessMsg(labels.success);
        setDateRange([]);
        setReason('');
        setDayPart('full');
        // Refresh server data without a full page reload
        router.refresh();
      } else {
        setErrorMsg(result.error);
      }
    });
  };

  return (
    <Card>
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
                  {lt.name_fa}
                </option>
              ))}
            </select>
          </div>

          {/* Date range picker */}
          <div className="space-y-1.5">
            <Label>{labels.dateRange}</Label>
            <div
              style={{ direction: isJalali ? 'rtl' : 'ltr' }}
              className="w-full"
            >
              <LazyDatePicker
                range
                value={dateRange}
                onChange={(dates: DateObjectLike) => {
                  if (Array.isArray(dates)) {
                    setDateRange(dates);
                  } else {
                    setDateRange([]);
                  }
                }}
                calendar={calendar}
                locale={calLocale}
                calendarPosition={isJalali ? 'bottom-right' : 'bottom-left'}
                inputClass={`w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50`}
                containerClassName="rmdp-container w-full"
                format="YYYY/MM/DD"
                dateSeparator=" — "
              />
            </div>
          </div>

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

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="reason">{labels.reason}</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          {/* Live preview */}
          {workingDaysCount !== null && (
            <div
              className="rounded-lg bg-secondary px-4 py-3 text-sm space-y-1"
              data-testid="leave-preview"
            >
              <div data-testid="working-days-count">
                {labels.preview}: <strong>{workingDaysCount}</strong> {locale === 'fa' ? 'روز کاری' : 'working days'}
              </div>
              {selectedType?.affects_balance && (
                <div data-testid="balance-display">
                  {balanceLoading
                    ? '…'
                    : effectiveBalance !== null
                      ? (locale === 'fa'
                          ? `مانده: ${effectiveBalance} روز`
                          : `Remaining balance: ${effectiveBalance} days`)
                      : labels.noBalance}
                </div>
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
