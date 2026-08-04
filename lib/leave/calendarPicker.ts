import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import persian_en from 'react-date-object/locales/persian_en';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import gregorian_fa from 'react-date-object/locales/gregorian_fa';

/**
 * Shared display configuration for every date picker.
 * An explicit Gregorian preference wins; missing/unknown preferences fail back
 * to Persian so the Farsi-first app never silently opens a Gregorian calendar.
 */
export function calendarPickerConfig(
  calendarPref: string | null | undefined,
  locale: string
) {
  const isJalali = calendarPref !== 'gregorian';
  const isRtl = locale === 'fa';

  return {
    isJalali,
    isRtl,
    calendar: isJalali ? persian : gregorian,
    calLocale: isJalali
      ? isRtl
        ? persian_fa
        : persian_en
      : isRtl
        ? gregorian_fa
        : gregorian_en,
    calendarPosition: isRtl ? 'bottom-right' : 'bottom-left',
  };
}
