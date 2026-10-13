import { describe, it, expect } from 'vitest';
import { formatRials, parseRials } from '@/lib/leave/perDiem';

describe('parseRials', () => {
  it('reads Latin, Persian and Arabic-Indic digits with separators', () => {
    expect(parseRials('1500000')).toBe(1500000);
    expect(parseRials('1,500,000')).toBe(1500000);
    expect(parseRials('۱٬۵۰۰٬۰۰۰')).toBe(1500000);
    expect(parseRials('٢٠٠ ٠٠٠')).toBe(200000);
    expect(parseRials('0')).toBe(0);
  });

  it('refuses anything that is not a whole non-negative amount', () => {
    expect(parseRials('')).toBeNaN();
    expect(parseRials('-5')).toBeNaN();
    expect(parseRials('12.5')).toBeNaN();
    expect(parseRials('abc')).toBeNaN();
    expect(parseRials('1234567890123456')).toBeNaN();
  });
});

describe('formatRials', () => {
  it('groups digits per locale', () => {
    expect(formatRials(1500000, 'en')).toBe('1,500,000');
    expect(formatRials(1500000, 'fa')).toBe('۱٬۵۰۰٬۰۰۰');
  });
});
