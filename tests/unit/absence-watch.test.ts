import { describe, expect, it } from 'vitest';
import {
  FULL_WATCH,
  filterWatched,
  isValidWatch,
  watchFromRow,
  watchToRow,
  watchedSections,
} from '@/lib/absences/watch';

const rows = [
  { id: 'ld', kind: 'leave' as const, unit: 'day' as const },
  { id: 'lh', kind: 'leave' as const, unit: 'hour' as const },
  { id: 'ed', kind: 'errand' as const, unit: 'day' as const },
  { id: 'eh', kind: 'errand' as const, unit: 'hour' as const },
];
const none = { leaveDay: false, leaveHour: false, errandDay: false, errandHour: false };

describe('absence watch (FR-75)', () => {
  it('a new watcher starts with everything on (owner mockup)', () => {
    expect(Object.values(FULL_WATCH).every(Boolean)).toBe(true);
  });
  it('needs at least one type and one view, like the table CHECKs', () => {
    expect(isValidWatch(FULL_WATCH)).toBe(true);
    expect(isValidWatch({ ...FULL_WATCH, ...none })).toBe(false);
    expect(isValidWatch({ ...FULL_WATCH, homeTile: false, fullPage: false })).toBe(false);
    expect(isValidWatch({ ...FULL_WATCH, ...none, errandHour: true, homeTile: false })).toBe(true);
  });
  it('row mapping round-trips', () => {
    const w = { ...FULL_WATCH, leaveHour: false, fullPage: false };
    expect(watchFromRow(watchToRow(w))).toEqual(w);
  });
  it('filters by kind and unit; null (the admin) keeps everything', () => {
    expect(filterWatched(rows, { ...FULL_WATCH, ...none, leaveHour: true }).map((r) => r.id)).toEqual(['lh']);
    expect(filterWatched(rows, { ...FULL_WATCH, ...none, errandDay: true, errandHour: true }).map((r) => r.id)).toEqual(['ed', 'eh']);
    expect(filterWatched(rows, null)).toHaveLength(4);
  });
  it('a section shows when either of its types is on', () => {
    expect(watchedSections({ ...FULL_WATCH, ...none, leaveHour: true })).toEqual({ leave: true, errands: false });
    expect(watchedSections({ ...FULL_WATCH, ...none, errandDay: true })).toEqual({ leave: false, errands: true });
    expect(watchedSections(null)).toEqual({ leave: true, errands: true });
  });
});
