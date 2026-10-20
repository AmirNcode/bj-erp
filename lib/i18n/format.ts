import { APP_TIME_ZONE } from '@/lib/appDate';

export function appLocale(locale: string): 'fa' | 'en' {
  return locale === 'fa' ? 'fa' : 'en';
}

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(appLocale(locale) === 'fa' ? 'fa-IR' : 'en-US', {
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

export function localizedLeaveTypeName(
  leaveType: { name_fa: string; name_en: string | null },
  locale: string
): string {
  return appLocale(locale) === 'fa' ? leaveType.name_fa : leaveType.name_en ?? leaveType.name_fa;
}

/**
 * A timestamp on the Persian calendar, in the Tehran timezone.
 *
 * Signature and decision timestamps always print Jalali regardless of the UI
 * language — they are evidence on a document the company files, and FR-23 made
 * Persian the only calendar. The timezone is explicit because a Client
 * Component server-renders first, and `Intl` without `timeZone` uses the
 * container's UTC on the server and the device's zone in the browser, which is
 * how production hydration error #418 happened once already.
 *
 * Lives here rather than beside the signature component so Server Components
 * can use it without importing a `'use client'` module.
 */
export function formatPersianConsentTimestamp(value: string, locale: string): string {
  return new Intl.DateTimeFormat(
    appLocale(locale) === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US-u-ca-persian',
    { dateStyle: 'medium', timeStyle: 'short', timeZone: APP_TIME_ZONE }
  ).format(new Date(value));
}

/**
 * ICU's Farsi pattern for this style is «۱۴۰۵ آبان ۶, چهارشنبه», which reads
 * backwards to a Farsi reader, so Farsi is assembled as «چهارشنبه ۶ آبان ۱۴۰۵».
 */
const persianLongDate = (locale: string, timeZone: string) => {
  const fa = appLocale(locale) === 'fa';
  const fmt = new Intl.DateTimeFormat(fa ? 'fa-IR-u-ca-persian' : 'en-US-u-ca-persian',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone });
  return {
    format(date: Date): string {
      if (!fa) return fmt.format(date);
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        fmt.formatToParts(date).find((p) => p.type === type)?.value ?? '';
      return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`;
    },
  };
};

/** "Saturday, Aban 1, 1405 AP" / «شنبه ۱ آبان ۱۴۰۵» for a Gregorian `YYYY-MM-DD` day. */
export function formatLongPersianDate(isoDate: string, locale: string): string {
  return persianLongDate(locale, 'UTC').format(new Date(`${isoDate}T00:00:00Z`));
}

/**
 * One edge of an absence window, as a Persian day plus a Tehran clock time.
 * Midnight has no useful clock time: a window starting at 00:00 starts at the
 * beginning of that day, and one ending at 00:00 (exclusive) ends with the
 * previous day, so `time` is null for both and the caller says "start/end of day".
 */
export function formatTehranWindowEdge(
  value: string,
  locale: string,
  edge: 'start' | 'end'
): { date: string; time: string | null } {
  const at = new Date(value);
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: APP_TIME_ZONE,
  }).format(at);
  if (clock === '00:00') {
    const day = edge === 'end' ? new Date(at.getTime() - 1) : at;
    return { date: persianLongDate(locale, APP_TIME_ZONE).format(day), time: null };
  }
  const [h, m] = clock.split(':');
  const digits = (n: string) => formatNumber(Number(n), locale, { minimumIntegerDigits: 2, useGrouping: false });
  return { date: persianLongDate(locale, APP_TIME_ZONE).format(at), time: `${digits(h)}:${digits(m)}` };
}
