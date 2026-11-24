import { describe, expect, it } from 'vitest';
import { formatCompactAmount as f } from '@/lib/sales/compactAmount';

describe('formatCompactAmount (en)', () => {
  it.each([
    [0, '0'],
    [950, '950'],
    [999, '999'],
    [1000, '1K'],
    [1250, '1.3K'],
    [1_049, '1K'],
    [999_950, '1M'],
    [1_500_000, '1.5M'],
    [207_466_823_839, '207.5B'],
    [2_987_061_634_441, '3T'],
    [12_400_000_000_000_000, '12,400T'],
    [-1500, '-1.5K'],
    [-950, '-950'],
    [-207_466_823_839, '-207.5B'],
  ])('%s -> %s', (n, out) => expect(f(n, 'en')).toBe(out));
});

describe('formatCompactAmount (fa)', () => {
  it('Persian digits, Latin unit letters', () => {
    expect(f(207_466_823_839, 'fa')).toBe('۲۰۷٫۵B');
    expect(f(2_987_061_634_441, 'fa')).toBe('۳T');
    expect(f(950, 'fa')).toBe('۹۵۰');
  });
  it('0 and non-finite', () => {
    expect(f(0, 'fa')).toBe('۰');
    expect(f(NaN, 'en')).toBe('—');
  });
});
