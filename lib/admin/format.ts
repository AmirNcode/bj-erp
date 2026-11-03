/**
 * Pure helpers for the admin panel (FR-77/78). No I/O; unit-tested.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Iranian mobile → `09XXXXXXXXX`, or null. Mirrors SQL `private.normalize_ir_mobile` so the
 * test-SMS box can refuse a bad number before the round trip.
 */
export function normalizeIrMobile(input: string | null | undefined): string | null {
  const latin = (input ?? '').replace(/[۰-۹٠-٩]/g, (d) => {
    const p = PERSIAN_DIGITS.indexOf(d);
    return String(p >= 0 ? p : ARABIC_DIGITS.indexOf(d));
  });
  const digits = latin.replace(/[^0-9]/g, '').replace(/^(0098|98|0)/, '');
  return /^9[0-9]{9}$/.test(digits) ? `0${digits}` : null;
}

/** 1536 → "1.5 KB"; binary units, one decimal from KB up. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Hours since `iso`, or null when there is no timestamp. */
export function hoursSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  return Number.isFinite(at) ? (now.getTime() - at) / 3_600_000 : null;
}

/** The newest backup is stale after 36 hours (the timer runs daily); no backup at all is stale. */
export function backupIsStale(newest: string | null | undefined, now: Date = new Date()): boolean {
  const hours = hoursSince(newest, now);
  return hours === null || hours > 36;
}

export type FieldChange = { key: string; before: unknown; after: unknown };

/**
 * The fields an audit row changed: keys whose value differs between before and after, in a
 * stable order. A row with only `after` (an insert or an action) lists every key.
 */
export function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): FieldChange[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  return keys
    .filter((key) => JSON.stringify(b[key] ?? null) !== JSON.stringify(a[key] ?? null))
    .map((key) => ({ key, before: b[key] ?? null, after: a[key] ?? null }));
}

/** An audit value as one short line. */
export function auditValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Rows per page in the audit and SMS logs. */
export const AUDIT_PAGE_SIZE = 50;
export const SMS_PAGE_SIZE = 50;

/** Overview range presets, in days back from today (Tehran). */
export const OVERVIEW_RANGES = [7, 30, 90, 365] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export function parseOverviewRange(value: string | string[] | undefined): OverviewRange {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (OVERVIEW_RANGES as readonly number[]).includes(n) ? (n as OverviewRange) : 30;
}

/** A 1-based page number from a search param; anything odd is page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const n = Number.parseInt(Array.isArray(value) ? value[0] : value ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
