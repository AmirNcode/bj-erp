import { formatNumber } from '@/lib/i18n/format';

/**
 * Request serial numbers (spec §7.6) — the شماره on the client's paper forms.
 *
 * Stored as two integers; formatting lives here rather than in SQL, because a
 * display string in the database is a presentation concern leaking into storage.
 */

/** `1404-0042`, Latin digits — for filenames, URLs, and anything machine-read. */
export function formatSerial(year: number, seq: number): string {
  return `${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * The same number with locale-shaped digits, for showing a worker.
 *
 * Separate from `formatSerial` on purpose: HR reads these aloud in Farsi, so the
 * screen should show Persian digits — but a Latin form is still needed wherever the
 * value is copied rather than read.
 */
export function formatSerialLocalized(year: number, seq: number, locale: string): string {
  const opts = { useGrouping: false } as const;
  const y = formatNumber(year, locale, opts);
  const s = formatNumber(seq, locale, { ...opts, minimumIntegerDigits: 4 });
  return `${y}-${s}`;
}
