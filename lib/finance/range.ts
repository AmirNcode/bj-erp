/**
 * Default /finance range (FR-62, amended 2026-10-21): the current Jalali month
 * through the end of the next one, so upcoming approved trips show without
 * picking a month. Falls back to the current month when the next one is not in
 * the list, and to today when today is not in it either.
 */
import type { JalaliMonthOption } from '@/lib/actions/reports';

export function defaultFinanceRange(months: JalaliMonthOption[], today: string): { from: string; to: string } {
  const i = months.findIndex((m) => m.gregorianStart <= today && m.gregorianEnd >= today);
  if (i < 0) return { from: today, to: today };
  const current = months[i];
  return { from: current.gregorianStart, to: (months[i + 1] ?? current).gregorianEnd };
}
