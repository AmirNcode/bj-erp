import { describe, expect, it } from 'vitest';
import { formatNumber, localizedLeaveTypeName } from '@/lib/i18n/format';

describe('formatNumber', () => {
  it('uses English digits for English UI', () => {
    expect(formatNumber(12.5, 'en')).toBe('12.5');
  });

  it('uses Persian digits for Persian UI', () => {
    expect(formatNumber(12.5, 'fa')).toBe('۱۲٫۵');
  });
});

describe('localizedLeaveTypeName', () => {
  const annual = {
    name_fa: 'مرخصی استحقاقی',
    name_en: 'Annual Leave',
  };

  it('uses the English leave type name in English UI', () => {
    expect(localizedLeaveTypeName(annual, 'en')).toBe('Annual Leave');
  });

  it('uses the Persian leave type name in Persian UI', () => {
    expect(localizedLeaveTypeName(annual, 'fa')).toBe('مرخصی استحقاقی');
  });

  it('falls back to Persian when the English name is missing', () => {
    expect(localizedLeaveTypeName({ ...annual, name_en: null }, 'en')).toBe('مرخصی استحقاقی');
  });
});
