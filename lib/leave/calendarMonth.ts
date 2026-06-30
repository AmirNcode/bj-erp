import DateObject from 'react-date-object';
import gregorian from 'react-date-object/calendars/gregorian';
import persian from 'react-date-object/calendars/persian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import gregorian_fa from 'react-date-object/locales/gregorian_fa';
import persian_en from 'react-date-object/locales/persian_en';
import persian_fa from 'react-date-object/locales/persian_fa';
import type { CalendarEntry, WorkSettings } from '@/lib/actions/leave';

export type CalendarPref = 'jalali' | 'gregorian' | string;

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

const MS_PER_DAY = 86_400_000;

function normalizedCalendarPref(calendarPref: CalendarPref): 'jalali' | 'gregorian' {
  return calendarPref === 'gregorian' ? 'gregorian' : 'jalali';
}

function normalizedLocale(locale: string): 'fa' | 'en' {
  return locale === 'fa' ? 'fa' : 'en';
}

function displayConfig(calendarPref: CalendarPref, locale: string) {
  const pref = normalizedCalendarPref(calendarPref);
  const lang = normalizedLocale(locale);

  if (pref === 'jalali') {
    return {
      calendar: persian,
      locale: lang === 'fa' ? persian_fa : persian_en,
    };
  }

  return {
    calendar: gregorian,
    locale: lang === 'fa' ? gregorian_fa : gregorian_en,
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

export function addDays(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
  return Math.floor((endMs - startMs) / MS_PER_DAY);
}

function isoWeekday(iso: string): number {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function isWorkingDate(iso: string, workSettings: WorkSettings): boolean {
  if (workSettings.weekendDays.includes(isoWeekday(iso))) return false;
  return !workSettings.holidays.includes(iso);
}

export function nextWorkingDateAfter(iso: string, workSettings: WorkSettings): string {
  let candidate = addDays(iso, 1);

  for (let i = 0; i < 370; i++) {
    if (isWorkingDate(candidate, workSettings)) return candidate;
    candidate = addDays(candidate, 1);
  }

  return addDays(iso, 1);
}

export function formatCalendarDate(
  iso: string,
  calendarPref: CalendarPref,
  locale: string,
  format = 'YYYY/MM/DD'
): string {
  const date = fromIso(iso);
  if (!date) return iso;

  const config = displayConfig(calendarPref, locale);
  return date.convert(config.calendar, config.locale).format(format);
}

export function currentCalendarMonthRange(
  calendarPref: CalendarPref,
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

  const config = displayConfig(calendarPref, locale);
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
  const formatter = new Intl.DateTimeFormat(normalizedLocale(locale) === 'fa' ? 'fa-IR' : 'en-US', {
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
  calendarPref,
  locale,
  workSettings,
  maxVisibleNames = 2,
}: {
  entries: CalendarEntry[];
  rangeStart: string;
  rangeEnd: string;
  calendarPref: CalendarPref;
  locale: string;
  workSettings: WorkSettings;
  maxVisibleNames?: number;
}): CalendarMonth {
  const weekStartsOn = normalizedCalendarPref(calendarPref) === 'jalali' ? 6 : 1;
  const leadDays = (isoWeekday(rangeStart) - weekStartsOn + 7) % 7;
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
            returnDate: nextWorkingDateAfter(entry.end_date, workSettings),
          }))
      : [];

    return {
      iso,
      inMonth,
      dayLabel: formatCalendarDate(iso, calendarPref, locale, 'D'),
      ariaLabel: formatCalendarDate(iso, calendarPref, locale, 'MMMM D, YYYY'),
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
