/**
 * ERP › Sales: compact amounts for the metric tiles (K / M / B / T, one decimal
 * at most, a trailing `.0` dropped). Pure; digits follow the page language, the
 * unit letters stay Latin in both.
 */

import { formatNumber } from '@/lib/i18n/format';

const UNITS = ['', 'K', 'M', 'B', 'T'] as const;

export function formatCompactAmount(value: number, locale: 'fa' | 'en'): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  let abs = Math.abs(value);
  let unit = 0;
  // Step up while the next unit applies (>= 1000 of this one), re-checking after
  // rounding so 999 950 reads 1M, not 1000K.
  while (unit < UNITS.length - 1 && Math.round(abs * 10) / 10 >= 1000) {
    abs /= 1000;
    unit += 1;
  }
  const rounded = Math.round(abs * 10) / 10;
  if (rounded === 0) return formatNumber(0, locale);
  return `${sign}${formatNumber(rounded, locale, { maximumFractionDigits: 1 })}${UNITS[unit]}`;
}
