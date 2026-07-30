import { formatNumber } from '@/lib/i18n/format';

/**
 * "۰۹:۰۰–۱۱:۰۰" for an hourly request, digits shaped for the locale.
 *
 * Exists because an hourly request otherwise renders as a date and a duration,
 * which reads as a full day to a manager approving it. Returns null when either
 * time is missing, so callers can render nothing for daily requests.
 */
export function formatTimeRange(
  startTime: string | null,
  endTime: string | null,
  locale: string
): string | null {
  if (!startTime || !endTime) return null;
  const hm = (t: string) => {
    const [h, m] = t.split(':');
    return `${formatNumber(Number(h), locale, { minimumIntegerDigits: 2, useGrouping: false })}:${formatNumber(
      Number(m),
      locale,
      { minimumIntegerDigits: 2, useGrouping: false }
    )}`;
  };
  return `${hm(startTime)}–${hm(endTime)}`;
}
