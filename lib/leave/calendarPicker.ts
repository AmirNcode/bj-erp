import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import persian_en from 'react-date-object/locales/persian_en';

/** Shared Persian-calendar configuration for every date picker. */
export function calendarPickerConfig(locale: string) {
  const isRtl = locale === 'fa';

  return {
    isRtl,
    calendar: persian,
    calLocale: isRtl ? persian_fa : persian_en,
    calendarPosition: isRtl ? 'bottom-right' : 'bottom-left',
  };
}
