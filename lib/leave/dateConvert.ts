/**
 * Converts a DateObject from react-multi-date-picker to a Gregorian YYYY-MM-DD string.
 * Works regardless of which calendar the DateObject was created with (Persian, Gregorian, etc.).
 * Uses .convert() to the Gregorian calendar, then .format() — avoids timezone drift from toDate().
 */

import DateObject from 'react-date-object';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import persian_en from 'react-date-object/locales/persian_en';

type DateObjectLike = {
  convert(calendar: unknown, locale: unknown): DateObjectLike;
  format(fmt: string): string;
};

/** The value react-multi-date-picker hands back. */
export type PickerDate = DateObject;

export function dateObjectToGregorian(dateObj: DateObjectLike): string {
  return dateObj.convert(gregorian, gregorian_en).format('YYYY-MM-DD');
}

/** Convert stored Gregorian ISO into a Persian DateObject for controlled pickers. */
export function gregorianToPersianDateObject(iso: string, locale: string): DateObject | null {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new DateObject({ calendar: gregorian, locale: gregorian_en, year, month, day }).convert(
    persian,
    locale === 'fa' ? persian_fa : persian_en
  );
}

/**
 * Returns true if the given leave type allows half-day selection,
 * i.e. the type has allow_half_day=true AND exactly one day is selected (start===end).
 */
export function isHalfDayAllowed(
  allowHalfDay: boolean,
  start: string,
  end: string
): boolean {
  return allowHalfDay && start === end;
}
