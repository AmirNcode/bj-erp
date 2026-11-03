import { describe, expect, it } from 'vitest';
import {
  backupIsStale,
  changedFields,
  formatBytes,
  normalizeIrMobile,
  parseOverviewRange,
  parsePage,
} from '@/lib/admin/format';

describe('normalizeIrMobile (mirrors private.normalize_ir_mobile)', () => {
  it.each([
    ['09121110001', '09121110001'],
    ['۰۹۱۲ ۱۱۱ ۰۰۰۱', '09121110001'],
    ['+98 912-111-0002', '09121110002'],
    ['00989121110004', '09121110004'],
    ['9121110005', '09121110005'],
    ['٠٩١٢١١١٠٠٠٦', '09121110006'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeIrMobile(input)).toBe(expected);
  });

  it.each(['02188776655', 'abc', '', '0912111000', '091211100011'])('refuses %s', (input) => {
    expect(normalizeIrMobile(input)).toBeNull();
  });

  it('refuses null', () => {
    expect(normalizeIrMobile(null)).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats binary units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB');
    expect(formatBytes(3.2 * 1024 ** 3)).toBe('3.2 GB');
  });
});

describe('backupIsStale', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  it('is fresh within 36 hours', () => {
    expect(backupIsStale('2026-11-02T02:00:00Z', now)).toBe(false);
  });
  it('is stale after 36 hours or with no backup', () => {
    expect(backupIsStale('2026-11-01T23:00:00Z', now)).toBe(true);
    expect(backupIsStale(null, now)).toBe(true);
  });
});

describe('changedFields', () => {
  it('lists only keys that changed, sorted', () => {
    expect(changedFields({ name: 'A', active: true, n: 1 }, { name: 'B', active: true, extra: 'x' })).toEqual([
      { key: 'extra', before: null, after: 'x' },
      { key: 'n', before: 1, after: null },
      { key: 'name', before: 'A', after: 'B' },
    ]);
  });
  it('treats an after-only row as all new', () => {
    expect(changedFields(null, { mode: 'live' })).toEqual([{ key: 'mode', before: null, after: 'live' }]);
  });
  it('compares nested values by content', () => {
    expect(changedFields({ ids: [1, 2] }, { ids: [1, 2] })).toEqual([]);
  });
});

describe('search params', () => {
  it('accepts only the range presets', () => {
    expect(parseOverviewRange('90')).toBe(90);
    expect(parseOverviewRange('12')).toBe(30);
    expect(parseOverviewRange(undefined)).toBe(30);
  });
  it('parses pages from 1', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('x')).toBe(1);
    expect(parsePage(['2'])).toBe(2);
  });
});
