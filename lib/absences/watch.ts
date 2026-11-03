/**
 * Absence watchers (FR-75, owner 2026-11-02): who sees approved absences is a per-person list
 * on Manage › Approval steps, not a role permission. Each watcher follows some of four request
 * types and gets the 30-day Home tile, the full Absences page, or both. Pure; no I/O.
 */

/** The four request types, in the order the dialog lists them. */
export const ABSENCE_TYPES = ['leaveDay', 'leaveHour', 'errandDay', 'errandHour'] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

/** The two views, in dialog order. */
export const ABSENCE_VIEWS = ['homeTile', 'fullPage'] as const;
export type AbsenceView = (typeof ABSENCE_VIEWS)[number];

export type AbsenceWatch = Record<AbsenceType | AbsenceView, boolean>;

/** A new watcher: everything on, as in the owner's mockup. */
export const FULL_WATCH: AbsenceWatch = {
  leaveDay: true,
  leaveHour: true,
  errandDay: true,
  errandHour: true,
  homeTile: true,
  fullPage: true,
};

export type AbsenceWatchRow = {
  leave_day: boolean;
  leave_hour: boolean;
  errand_day: boolean;
  errand_hour: boolean;
  home_tile: boolean;
  full_page: boolean;
};

export const watchFromRow = (r: AbsenceWatchRow): AbsenceWatch => ({
  leaveDay: r.leave_day,
  leaveHour: r.leave_hour,
  errandDay: r.errand_day,
  errandHour: r.errand_hour,
  homeTile: r.home_tile,
  fullPage: r.full_page,
});

export const watchToRow = (w: AbsenceWatch): AbsenceWatchRow => ({
  leave_day: w.leaveDay,
  leave_hour: w.leaveHour,
  errand_day: w.errandDay,
  errand_hour: w.errandHour,
  home_tile: w.homeTile,
  full_page: w.fullPage,
});

/** Mirrors the table's CHECKs: at least one type and one view. */
export const isValidWatch = (w: AbsenceWatch): boolean =>
  ABSENCE_TYPES.some((k) => w[k]) && ABSENCE_VIEWS.some((k) => w[k]);

/** Which sections the boards show: errands when either errand type is on, leave likewise. */
export const watchedSections = (w: AbsenceWatch | null): { leave: boolean; errands: boolean } =>
  w ? { leave: w.leaveDay || w.leaveHour, errands: w.errandDay || w.errandHour } : { leave: true, errands: true };

/** The absences of the types `w` follows (all of them when `w` is null: the admin's page). */
export function filterWatched<T extends { kind: 'leave' | 'errand'; unit: 'day' | 'hour' }>(
  absences: T[],
  w: AbsenceWatch | null
): T[] {
  if (!w) return absences;
  return absences.filter((a) =>
    a.kind === 'leave' ? (a.unit === 'day' ? w.leaveDay : w.leaveHour) : a.unit === 'day' ? w.errandDay : w.errandHour
  );
}
