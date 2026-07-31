import { describe, expect, it } from 'vitest';
import {
  isValidIsoDate,
  validateHourlySettings,
} from '@/lib/leave/settings-validation';

describe('isValidIsoDate', () => {
  it('accepts real Gregorian dates', () => {
    expect(isValidIsoDate('2026-07-30')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects impossible or loosely formatted dates', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-7-30')).toBe(false);
  });
});

describe('validateHourlySettings', () => {
  it('accepts an ordered work window and a cap inside it', () => {
    expect(validateHourlySettings('07:00', '15:00', 240)).toEqual({
      ok: true,
      workStart: '07:00',
      workEnd: '15:00',
      capMinutes: 240,
    });
  });

  it('rejects malformed/reversed windows and impossible caps', () => {
    expect(validateHourlySettings('7:00', '15:00', 240)).toEqual({ ok: false });
    expect(validateHourlySettings('15:00', '07:00', 240)).toEqual({ ok: false });
    expect(validateHourlySettings('07:00', '15:00', 481)).toEqual({ ok: false });
    expect(validateHourlySettings('07:00', '15:00', 12.5)).toEqual({ ok: false });
  });
});
