'use client';

import { useState, useTransition } from 'react';
import DatePicker from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import { dateObjectToGregorian, gregorianToJalali } from '@/lib/leave/dateConvert';
import { upsertHoliday, deleteHoliday, getCompanyHolidays, type Holiday } from '@/lib/actions/settings';

type Labels = {
  holidaysTitle: string;
  addHoliday: string;
  dateLabel: string;
  nameFaLabel: string;
  nameEnLabel: string;
  recurringLabel: string;
  delete: string;
  noHolidays: string;
  errorLabel: string;
};

// react-multi-date-picker passes a DateObject; we only ever read it via dateObjectToGregorian.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DateObjectLike = any;

export function HolidayEditor({
  initial,
  calendarPref,
  labels,
}: {
  initial: Holiday[];
  calendarPref: string;
  labels: Labels;
}) {
  const isJalali = calendarPref === 'jalali';
  const [holidays, setHolidays] = useState<Holiday[]>(initial);
  const [picked, setPicked] = useState<DateObjectLike | null>(null);
  const [nameFa, setNameFa] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const show = (d: string) => (isJalali ? gregorianToJalali(d) : d);

  const onAdd = () => {
    setErrMsg('');
    if (!picked || !nameFa) {
      setErrMsg(labels.errorLabel);
      return;
    }
    const date = dateObjectToGregorian(picked);
    startTransition(async () => {
      const res = await upsertHoliday({ date, nameFa, nameEn, isRecurring: recurring });
      if (!res.ok) {
        setErrMsg(res.error);
        return;
      }
      // Re-read so rows carry their real DB ids (needed for a subsequent delete).
      const refreshed = await getCompanyHolidays();
      if (refreshed.ok) setHolidays(refreshed.holidays);
      setPicked(null);
      setNameFa('');
      setNameEn('');
      setRecurring(false);
    });
  };

  const onDelete = (id: string) => {
    setErrMsg('');
    startTransition(async () => {
      const res = await deleteHoliday(id);
      if (!res.ok) {
        setErrMsg(res.error);
        return;
      }
      const refreshed = await getCompanyHolidays();
      if (refreshed.ok) setHolidays(refreshed.holidays);
    });
  };

  return (
    <section className="space-y-4" data-testid="holiday-editor">
      <h2 className="text-lg font-semibold">{labels.holidaysTitle}</h2>
      {errMsg && (
        <p role="alert" data-testid="holiday-error" className="text-sm text-red-700">
          {labels.errorLabel}: {errMsg}
        </p>
      )}

      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">{labels.dateLabel}</label>
          <DatePicker
            value={picked}
            onChange={setPicked}
            calendar={isJalali ? persian : gregorian}
            locale={isJalali ? persian_fa : gregorian_en}
            inputClass="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hol-name-fa" className="text-sm font-medium">
            {labels.nameFaLabel}
          </label>
          <input
            id="hol-name-fa"
            data-testid="holiday-name-fa"
            value={nameFa}
            onChange={(e) => setNameFa(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hol-name-en" className="text-sm font-medium">
            {labels.nameEnLabel}
          </label>
          <input
            id="hol-name-en"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            disabled={isPending}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            disabled={isPending}
          />
          {labels.recurringLabel}
        </label>
        <button
          type="button"
          data-testid="holiday-add"
          onClick={onAdd}
          disabled={isPending}
          className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {labels.addHoliday}
        </button>
      </div>

      {holidays.length === 0 ? (
        <p className="text-sm text-gray-500">{labels.noHolidays}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200" data-testid="holiday-list">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                <span className="font-mono">{show(h.holiday_date)}</span> · {h.name_fa}
              </span>
              <button
                type="button"
                onClick={() => onDelete(h.id)}
                disabled={isPending}
                className="text-red-600 hover:underline text-xs disabled:opacity-50"
              >
                {labels.delete}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
