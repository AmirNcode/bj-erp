import { describe, it, expect } from 'vitest';
import {
  errandMinutes,
  isValidErrandLocation,
  MAX_ERRAND_LOCATION_LENGTH,
} from '@/lib/leave/errand';

const LOCATION = 'اداره کار اهواز';

describe('errandMinutes', () => {
  it('measures a normal range', () => {
    expect(errandMinutes('09:00', '11:00')).toBe(120);
    expect(errandMinutes('09:15', '09:45')).toBe(30);
  });

  it('tolerates the HH:MM:SS Postgres returns', () => {
    expect(errandMinutes('09:00:00', '11:30:00')).toBe(150);
  });

  it('returns 0 for a reversed or empty range, never a negative', () => {
    expect(errandMinutes('11:00', '09:00')).toBe(0);
    expect(errandMinutes('09:00', '09:00')).toBe(0);
  });

  it('measures a range outside the work-hours window, which an errand may use', () => {
    // Errands are NOT bound by [work_start, work_end] (D3) — 05:30 to 19:00 is a
    // legitimate day trip, and the maths must not silently clamp it.
    expect(errandMinutes('05:30', '19:00')).toBe(810);
  });
});

describe('isValidErrandLocation', () => {
  it('accepts ordinary text', () => {
    expect(isValidErrandLocation(LOCATION)).toBe(true);
  });

  it('rejects empty and whitespace-only input, matching btrim(...) <> \'\'', () => {
    expect(isValidErrandLocation('')).toBe(false);
    expect(isValidErrandLocation('   ')).toBe(false);
    expect(isValidErrandLocation('\t\n ')).toBe(false);
  });

  it('accepts exactly the maximum length and rejects one character more', () => {
    expect(isValidErrandLocation('x'.repeat(MAX_ERRAND_LOCATION_LENGTH))).toBe(true);
    expect(isValidErrandLocation('x'.repeat(MAX_ERRAND_LOCATION_LENGTH + 1))).toBe(false);
  });

  it('measures the TRIMMED length, as the SQL stores the trimmed value', () => {
    const padded = `  ${'x'.repeat(MAX_ERRAND_LOCATION_LENGTH)}  `;
    expect(isValidErrandLocation(padded)).toBe(true);
  });

  it('pins the limit to the CHECK constraint', () => {
    expect(MAX_ERRAND_LOCATION_LENGTH).toBe(200);
  });
});
