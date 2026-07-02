import { describe, it, expect } from 'vitest';
import { todayInAppTz, nowInAppTz } from '@/lib/appDate';

describe('todayInAppTz (Asia/Tehran, UTC+3:30)', () => {
  it('rolls to the next day at 20:30 UTC', () => {
    // 20:30 UTC = 00:00 Tehran (next day)
    expect(todayInAppTz(new Date('2026-01-01T20:29:59Z'))).toBe('2026-01-01');
    expect(todayInAppTz(new Date('2026-01-01T20:30:00Z'))).toBe('2026-01-02');
  });

  it('matches the UTC date during the overlapping hours', () => {
    expect(todayInAppTz(new Date('2026-07-02T12:00:00Z'))).toBe('2026-07-02');
  });

  it('crosses month and year boundaries correctly', () => {
    expect(todayInAppTz(new Date('2025-12-31T21:00:00Z'))).toBe('2026-01-01');
  });
});

describe('nowInAppTz', () => {
  it('returns a Date whose UTC fields equal the Tehran date', () => {
    const d = nowInAppTz(new Date('2026-01-01T22:00:00Z')); // 01:30 Tehran, Jan 2
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(2);
  });

  it('is pinned to noon UTC so date-only math cannot drift', () => {
    const d = nowInAppTz(new Date('2026-03-15T05:00:00Z'));
    expect(d.getUTCHours()).toBe(12);
  });
});
