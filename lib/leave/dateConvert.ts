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

type DateObjectLike = {
  convert(calendar: unknown, locale: unknown): DateObjectLike;
  format(fmt: string): string;
};

export function dateObjectToGregorian(dateObj: DateObjectLike): string {
  return dateObj.convert(gregorian, gregorian_en).format('YYYY-MM-DD');
}

/**
 * Formats a Gregorian YYYY-MM-DD string as a Jalali (Persian) YYYY/MM/DD string
 * for display. Builds the DateObject from explicit y/m/d fields to avoid any
 * timezone drift. Returns the input unchanged if it is not a valid ISO date.
 */
export function gregorianToJalali(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const obj = new DateObject({ calendar: gregorian, locale: gregorian_en, year: y, month: m, day: d });
  return obj.convert(persian, persian_fa).format('YYYY/MM/DD');
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
