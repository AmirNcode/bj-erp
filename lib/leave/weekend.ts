// ISO weekday numbers: Mon=1 .. Sun=7. The Iranian/Persian week is shown Sat..Fri.
export const WEEKDAYS: { iso: number; key: string }[] = [
  { iso: 6, key: 'sat' },
  { iso: 7, key: 'sun' },
  { iso: 1, key: 'mon' },
  { iso: 2, key: 'tue' },
  { iso: 3, key: 'wed' },
  { iso: 4, key: 'thu' },
  { iso: 5, key: 'fri' },
];

/**
 * How often a weekday is off (FR-41).
 *
 * The client's real week is Friday off every week and Thursday off every other
 * week, which a single list of weekday numbers cannot express.
 */
export type WeekendFrequency = 'working' | 'weekly' | 'biweekly';

/**
 * MIRRORS `private.is_company_weekend`
 * (supabase/migrations/20260818170001_weekend_frequency.sql).
 *
 * The database is authoritative — `compute_requested_minutes` calls the SQL
 * version and is what actually charges the ledger. This exists so the request
 * form can preview a duration, the calendar can shade non-working days, and the
 * rule can be unit-tested exhaustively. The two must stay in lockstep, the same
 * standing contract as `countWorkingDays` / `compute_requested_minutes`.
 */
export type WeekendRule = {
  /** ISO weekday numbers that are off EVERY week. */
  weekendDays: number[];
  /** ISO weekday numbers that are off every OTHER week. */
  biweeklyWeekendDays?: number[];
  /** Any date whose week is an off week. Required when the list is non-empty. */
  biweeklyAnchor?: string | null;
};

const MS_PER_DAY = 86_400_000;

/**
 * The Saturday the week grid is counted from — 2000-01-01 was a Saturday, the
 * first day of the Iranian week.
 *
 * Saturday and not Monday: on an ISO Monday grid, the Saturday and the Thursday
 * of the SAME Iranian working week fall in different buckets and can land on
 * opposite parities, so one week would show two days off and the next none. The
 * SQL helper uses this identical epoch.
 */
const WEEK_EPOCH_MS = Date.UTC(2000, 0, 1);

/** ISO weekday (Mon=1 … Sun=7) of a `YYYY-MM-DD` string, parsed as UTC. */
export function isoWeekdayOf(iso: string): number | null {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  const day = new Date(ms).getUTCDay(); // 0 (Sun) … 6 (Sat)
  return day === 0 ? 7 : day;
}

/** Which whole week a date falls in, on the Saturday-aligned grid. */
function weekIndex(ms: number): number {
  // Math.floor, not a truncating division: a date before the epoch must bucket
  // downward. The epoch is far in the past, but relying on that is the kind of
  // assumption that breaks exactly once.
  return Math.floor((ms - WEEK_EPOCH_MS) / MS_PER_DAY / 7);
}

/** True when the date is a non-working weekend day under this rule. */
export function isWeekendDate(iso: string, rule: WeekendRule): boolean {
  const weekday = isoWeekdayOf(iso);
  if (weekday === null) return false;

  if (rule.weekendDays.includes(weekday)) return true;

  const biweekly = rule.biweeklyWeekendDays ?? [];
  if (biweekly.length === 0 || !rule.biweeklyAnchor) return false;
  if (!biweekly.includes(weekday)) return false;

  const dateMs = Date.parse(`${iso}T00:00:00Z`);
  const anchorMs = Date.parse(`${rule.biweeklyAnchor}T00:00:00Z`);
  if (Number.isNaN(dateMs) || Number.isNaN(anchorMs)) return false;

  return Math.abs(weekIndex(dateMs) - weekIndex(anchorMs)) % 2 === 0;
}

export type WeekendValidation =
  | { ok: true; days: number[]; biweeklyDays: number[]; anchor: string | null }
  | { ok: false; reason: 'out_of_range' | 'all_week' | 'anchor_required' | 'overlap' };

/**
 * Normalize + validate a weekend selection (ISO numbers).
 *
 * Three rules, all mirrored by CHECK constraints on `work_settings`:
 *   - every number is a real weekday
 *   - the union of both lists leaves at least one working day, or nothing could
 *     ever be requested
 *   - a bi-weekly list needs an anchor, because without one the parity — i.e.
 *     WHICH Thursdays are off — is undefined. Defaulting it would silently pick.
 *
 * A day may not be in both lists: "off weekly" and "off fortnightly" are
 * contradictory, and the weekly branch would win silently.
 */
export function validateWeekendDays(
  days: number[],
  biweeklyDays: number[] = [],
  anchor: string | null = null
): WeekendValidation {
  const uniq = Array.from(new Set(days)).sort((a, b) => a - b);
  const uniqBi = Array.from(new Set(biweeklyDays)).sort((a, b) => a - b);

  if ([...uniq, ...uniqBi].some((d) => d < 1 || d > 7)) {
    return { ok: false, reason: 'out_of_range' };
  }
  if (uniqBi.some((d) => uniq.includes(d))) {
    return { ok: false, reason: 'overlap' };
  }
  if (new Set([...uniq, ...uniqBi]).size >= 7) {
    return { ok: false, reason: 'all_week' };
  }
  if (uniqBi.length > 0 && !anchor) {
    return { ok: false, reason: 'anchor_required' };
  }

  return {
    ok: true,
    days: uniq,
    biweeklyDays: uniqBi,
    // An anchor with no bi-weekly day is meaningless; drop it rather than store
    // a value nothing reads.
    anchor: uniqBi.length > 0 ? anchor : null,
  };
}

/** The per-weekday frequency a settings UI edits, derived from the two lists. */
export function frequencyOf(
  iso: number,
  weekendDays: number[],
  biweeklyDays: number[]
): WeekendFrequency {
  if (weekendDays.includes(iso)) return 'weekly';
  if (biweeklyDays.includes(iso)) return 'biweekly';
  return 'working';
}
