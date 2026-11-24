import { describe, expect, it } from 'vitest';
import { FONT_STEPS, fontScale, fontStepLabel, isFontStep } from '@/lib/prefs/fontScale';

describe('fontScale', () => {
  it('same multipliers for both languages', () => {
    expect(FONT_STEPS.map((s) => fontScale(s))).toEqual([1, 1.1, 1.2, 1.3, 1.4]);
  });
  it('rounds to 2 decimals', () => {
    for (const s of FONT_STEPS) expect(fontScale(s)).toBe(Number(fontScale(s).toFixed(2)));
  });
  it('labels', () => {
    expect(fontStepLabel(0)).toBe('100%');
    expect(fontStepLabel(4)).toBe('140%');
  });
  it('isFontStep', () => {
    expect(isFontStep(5)).toBe(false);
    expect(isFontStep(2.5)).toBe(false);
    expect(isFontStep('2')).toBe(false);
    expect(isFontStep(3)).toBe(true);
  });
});
