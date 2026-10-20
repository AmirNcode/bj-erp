import DateObject from 'react-date-object';
import gregorian from 'react-date-object/calendars/gregorian';
import persian from 'react-date-object/calendars/persian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import persian_en from 'react-date-object/locales/persian_en';
import persian_fa from 'react-date-object/locales/persian_fa';
import type { CalendarEntry } from '@/lib/actions/leave/calendar';
import type { WorkSettings } from '@/lib/actions/leave/reference';
import { isoWeekdayOf, nextWorkingDay } from './weekend';
import { addDays, daysBetween } from './isoDate';
import { appLocale } from '@/lib/i18n/format';

export type CalendarDayEntry = CalendarEntry & {
  returnDate: string;
};

export type CalendarDayCell = {
  iso: string;
  inMonth: boolean;
  dayLabel: string;
  ariaLabel: string;
  entries: CalendarDayEntry[];
  count: number;
  visibleNames: string[];
  hasMore: boolean;
};

export type CalendarMonth = {
  days: CalendarDayCell[];
  weekdayLabels: string[];
};

function displayConfig(locale: string) {
  const lang = appLocale(locale);

  return {
    calendar: persian,
    locale: lang === 'fa' ? persian_fa : persian_en,
  };
}

function fromIso(iso: string): DateObject | null {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new DateObject({ calendar: gregorian, locale: gregorian_en, year, month, day });
}

function isoFromDateObject(date: DateObject): string {
  return date.convert(gregorian, gregorian_en).format('YYYY-MM-DD');
}

export function formatCalendarDate(
  iso: string,
  locale: string,
  format = 'YYYY/MM/DD'
): string {
  const date = fromIso(iso);
  if (!date) return iso;

  const config = displayConfig(locale);
  return date.convert(config.calendar, config.locale).format(format);
}

export function currentCalendarMonthRange(
  now = new Date(),
  locale = 'en'
): { rangeStart: string; rangeEnd: string; monthLabel: string } {
  const todayIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
    .toISOString()
    .slice(0, 10);
  const today = fromIso(todayIso);

  if (!today) {
    return { rangeStart: todayIso, rangeEnd: todayIso, monthLabel: todayIso };
  }

  const config = displayConfig(locale);
  const displayToday = today.convert(config.calendar, config.locale);
  const start = new DateObject({
    calendar: config.calendar,
    locale: config.locale,
    year: displayToday.year,
    month: displayToday.month.number,
    day: 1,
  });
  const end = new DateObject({
    calendar: config.calendar,
    locale: config.locale,
    year: displayToday.year,
    month: displayToday.month.number,
    day: displayToday.month.length,
  });

  const label = new DateObject({
    calendar: config.calendar,
    locale: config.locale,
    year: displayToday.year,
    month: displayToday.month.number,
    day: 1,
  }).format('MMMM YYYY');

  return {
    rangeStart: isoFromDateObject(start),
    rangeEnd: isoFromDateObject(end),
    monthLabel: label,
  };
}

function weekdayLabels(weekStartsOn: number, locale: string): string[] {
  const labels: string[] = [];
  const formatter = new Intl.DateTimeFormat(appLocale(locale) === 'fa' ? 'fa-IR' : 'en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });

  for (let i = 0; i < 7; i++) {
    const isoDay = ((weekStartsOn + i - 1) % 7) + 1;
    labels.push(formatter.format(new Date(Date.UTC(2024, 0, isoDay))));
  }

  return labels;
}

export function buildCalendarMonth({
  entries,
  rangeStart,
  rangeEnd,
  locale,
  workSettings,
  maxVisibleNames = 2,
}: {
  entries: CalendarEntry[];
  rangeStart: string;
  rangeEnd: string;
  locale: string;
  workSettings: WorkSettings;
  maxVisibleNames?: number;
}): CalendarMonth {
  const weekStartsOn = 6;
  // rangeStart comes from currentCalendarMonthRange, so it is always a valid date.
  const leadDays = (isoWeekdayOf(rangeStart)! - weekStartsOn + 7) % 7;
  const gridStart = addDays(rangeStart, -leadDays);
  const cellCount = Math.ceil((daysBetween(gridStart, rangeEnd) + 1) / 7) * 7;

  const sortedEntries = [...entries].sort((a, b) =>
    a.employee_name.localeCompare(b.employee_name)
  );

  const days: CalendarDayCell[] = Array.from({ length: cellCount }, (_, index) => {
    const iso = addDays(gridStart, index);
    const inMonth = iso >= rangeStart && iso <= rangeEnd;
    const dayEntries = inMonth
      ? sortedEntries
          .filter((entry) => entry.start_date <= iso && entry.end_date >= iso)
          .map((entry) => ({
            ...entry,
            returnDate: nextWorkingDay(entry.end_date, workSettings) ?? addDays(entry.end_date, 1),
          }))
      : [];

    return {
      iso,
      inMonth,
      dayLabel: formatCalendarDate(iso, locale, 'D'),
      ariaLabel: formatCalendarDate(iso, locale, 'MMMM D, YYYY'),
      entries: dayEntries,
      count: dayEntries.length,
      visibleNames: dayEntries.slice(0, maxVisibleNames).map((entry) => entry.employee_name),
      hasMore: dayEntries.length > maxVisibleNames,
    };
  });

  return {
    days,
    weekdayLabels: weekdayLabels(weekStartsOn, locale),
  };
}
