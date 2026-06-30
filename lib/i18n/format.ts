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
