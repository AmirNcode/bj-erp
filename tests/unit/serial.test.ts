import { describe, it, expect } from 'vitest';
import { formatSerial, formatSerialLocalized } from '@/lib/leave/serial';

describe('formatSerial', () => {
  it('zero-pads the sequence to four digits', () => {
    expect(formatSerial(1404, 42)).toBe('1404-0042');
    expect(formatSerial(1404, 1)).toBe('1404-0001');
    expect(formatSerial(1405, 1234)).toBe('1405-1234');
  });

  it('does not truncate a sequence beyond four digits', () => {
    expect(formatSerial(1404, 12345)).toBe('1404-12345');
  });
});

describe('formatSerialLocalized', () => {
  it('keeps Latin digits for English', () => {
    expect(formatSerialLocalized(1404, 42, 'en')).toBe('1404-0042');
  });

  it('shapes Persian digits for Farsi', () => {
    expect(formatSerialLocalized(1404, 42, 'fa')).toBe('۱۴۰۴-۰۰۴۲');
  });

  it('never groups the year (no thousands separator)', () => {
    expect(formatSerialLocalized(1404, 1, 'en')).toBe('1404-0001');
    expect(formatSerialLocalized(1404, 1, 'fa')).not.toContain(',');
    expect(formatSerialLocalized(1404, 1, 'fa')).not.toContain('٬');
  });
});
