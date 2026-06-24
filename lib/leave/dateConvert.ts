/**
 * Converts a DateObject from react-multi-date-picker to a Gregorian YYYY-MM-DD string.
 * Works regardless of which calendar the DateObject was created with (Persian, Gregorian, etc.).
 * Uses .convert() to the Gregorian calendar, then .format() — avoids timezone drift from toDate().
 */

import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';

type DateObjectLike = {
  convert: (calendar: unknown, locale: unknown) => DateObjectLike;
  format: (fmt: string) => string;
};

export function dateObjectToGregorian(dateObj: DateObjectLike): string {
  return dateObj.convert(gregorian, gregorian_en).format('YYYY-MM-DD');
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
