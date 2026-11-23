import { describe, expect, it } from 'vitest';
import { FONT_STEPS, fontScale, fontStepLabel, isFontStep } from '@/lib/prefs/fontScale';

describe('fontScale', () => {
  it('English multipliers', () => {
    expect(fontScale(0, 'en')).toBe(1);
    expect(fontScale(4, 'en')).toBe(1.4);
  });
  it('Farsi gets one extra step', () => {
    expect(fontScale(0, 'fa')).toBe(1.1);
    expect(fontScale(4, 'fa')).toBe(1.5);
  });
  it('rounds to 2 decimals', () => {
    for (const s of FONT_STEPS) {
      for (const l of ['fa', 'en'] as const) {
        expect(fontScale(s, l)).toBe(Number(fontScale(s, l).toFixed(2)));
      }
    }
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
