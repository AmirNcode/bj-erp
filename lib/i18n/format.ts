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
    { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' }
  ).format(new Date(value));
}
