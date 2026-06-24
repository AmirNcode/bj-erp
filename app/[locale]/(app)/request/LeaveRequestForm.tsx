'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import DatePicker from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import { countWorkingDays } from '@/lib/leave/workingDays';
import { dateObjectToGregorian, isHalfDayAllowed } from '@/lib/leave/dateConvert';
import { submitRequest, getMyBalance } from '@/lib/actions/leave';
import type { LeaveType, WorkSettings } from '@/lib/actions/leave';

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

export function LeaveRequestForm({ leaveTypes, workSettings, calendarPref, labels, locale }: Props) {
  const isJalali = calendarPref === 'jalali';
  const calendar = isJalali ? persian : gregorian;
  const calLocale = isJalali ? persian_fa : gregorian_en;

  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [dateRange, setDateRange] = useState<DateObjectLike[]>([]);
  const [dayPart, setDayPart] = useState<DayPart>('full');
  const [reason, setReason] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [workingDaysCount, setWorkingDaysCount] = useState<number | null>(null);
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

  // Fetch balance when type changes
  useEffect(() => {
    if (!selectedTypeId) {
      setBalance(null);
      return;
    }
    getMyBalance(selectedTypeId).then((res) => {
      if (res.ok) setBalance(res.balance);
      else setBalance(null);
    });
  }, [selectedTypeId]);

  // Compute working days preview
  useEffect(() => {
    if (dateRange.length < 2) {
      setWorkingDaysCount(null);
      return;
    }
    const { start, end } = getGregorianRange();
    if (!start || !end) return;
    const count = countWorkingDays(start, end, {
      weekendDays: workSettings.weekendDays,
      holidays: workSettings.holidays,
      dayPart,
    });
    setWorkingDaysCount(count);
  }, [dateRange, dayPart, workSettings, getGregorianRange]);

  // Reset day_part to 'full' when no longer allowed
  useEffect(() => {
    const { start, end } = getGregorianRange();
    if (!isHalfDayAllowed(selectedType?.allow_half_day ?? false, start, end)) {
      setDayPart('full');
    }
  }, [selectedType, dateRange, getGregorianRange]);

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
        dayPart,
        reason: reason || undefined,
      });

      if (result.ok) {
        setSuccessMsg(labels.success);
        setDateRange([]);
        setReason('');
        setDayPart('full');
        setWorkingDaysCount(null);
        // Refresh the page to show new request in list
        window.location.reload();
      } else {
        setErrorMsg(result.error);
      }
    });
  };

  const { start: previewStart, end: previewEnd } = getGregorianRange();
  const showHalfDay = isHalfDayAllowed(
    selectedType?.allow_half_day ?? false,
    previewStart,
    previewEnd
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-xl border border-gray-200 p-6">
      {/* Leave type */}
      <div>
        <label htmlFor="leave_type_id" className="block text-sm font-medium text-gray-700 mb-1">
          {labels.leaveType}
        </label>
        <select
          id="leave_type_id"
          value={selectedTypeId}
          onChange={(e) => setSelectedTypeId(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {labels.dateRange}
        </label>
        <div
          style={{ direction: isJalali ? 'rtl' : 'ltr' }}
          className="w-full"
        >
          <DatePicker
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
            inputClass="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            containerClassName="w-full"
            format="YYYY/MM/DD"
            dateSeparator=" — "
          />
        </div>
      </div>

      {/* Day part — only shown when single day + allow_half_day */}
      {showHalfDay && (
        <div>
          <label htmlFor="day_part" className="block text-sm font-medium text-gray-700 mb-1">
            {labels.dayPart}
          </label>
          <select
            id="day_part"
            value={dayPart}
            onChange={(e) => setDayPart(e.target.value as DayPart)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="full">{labels.dayPartFull}</option>
            <option value="am">{labels.dayPartAm}</option>
            <option value="pm">{labels.dayPartPm}</option>
          </select>
        </div>
      )}

      {/* Reason */}
      <div>
        <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
          {labels.reason}
        </label>
        <textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Live preview */}
      {workingDaysCount !== null && (
        <div
          className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800 space-y-1"
          data-testid="leave-preview"
        >
          <div data-testid="working-days-count">
            {labels.preview}: <strong>{workingDaysCount}</strong> {locale === 'fa' ? 'روز کاری' : 'working days'}
          </div>
          {selectedType?.affects_balance && (
            <div data-testid="balance-display">
              {balance !== null
                ? (locale === 'fa'
                    ? `مانده: ${balance} روز`
                    : `Remaining balance: ${balance} days`)
                : labels.noBalance}
            </div>
          )}
        </div>
      )}

      {/* Success / error */}
      {successMsg && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800" data-testid="success-msg">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800" data-testid="error-msg">
          <strong>{labels.errorLabel}:</strong> {errorMsg}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? '...' : labels.submit}
      </button>
    </form>
  );
}
