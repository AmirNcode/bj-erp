/**
 * Per diem (حق ماموریت روزانه, FR-61) amounts: whole Rials.
 */

/**
 * Typed amount → whole Rials, or NaN. Accepts Persian and Arabic-Indic digits
 * and the usual thousands separators (`,` `٬` `،` spaces), since HR types
 * amounts the way they read them.
 */
export function parseRials(raw: string): number {
  const ascii = raw
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,\s٬،]/g, '');
  if (!/^[0-9]{1,15}$/.test(ascii)) return Number.NaN;
  return Number(ascii);
}

/** Rials with locale digits and grouping, e.g. ۱٬۵۰۰٬۰۰۰. */
export function formatRials(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(value);
}
