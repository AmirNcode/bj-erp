import { describe, expect, it } from 'vitest';
import { currencyLabel, formatMoney, matchCurrency } from '@/lib/sales/money';
import type { Currency } from '@/lib/sales/types';

const cur = (c: Partial<Currency> & Pick<Currency, 'code' | 'name_fa' | 'name_en'>): Currency =>
  ({ symbol: null, decimals: 0, active: true, position: 0, ...c });
const usd = cur({ code: 'USD', name_en: 'US dollar', name_fa: 'دلار', symbol: '$', decimals: 2 });
const irr = cur({ code: 'IRR', name_en: 'Rial', name_fa: 'ریال', decimals: 0 });
const eur = cur({ code: 'EUR', name_en: 'Euro', name_fa: 'یورو', symbol: '€', decimals: 2 });
const tmn = cur({ code: 'TMN', name_en: 'Toman', name_fa: 'تومان' });

describe('formatMoney', () => {
  it('uses the symbol when set and the decimals of the currency', () => {
    expect(formatMoney(1234.5, 'USD', [usd], 'en')).toBe('1,234.50 $');
  });
  it('uses the localized name when there is no symbol', () => {
    expect(formatMoney(1500000, 'IRR', [irr], 'fa')).toBe('۱٬۵۰۰٬۰۰۰ ریال');
    expect(formatMoney(1500000, 'IRR', [irr], 'en')).toBe('1,500,000 Rial');
  });
  it('shows an unknown code raw, and a missing amount as a dash', () => {
    expect(formatMoney(5, 'ZZZ', [usd], 'en')).toBe('5 ZZZ');
    expect(formatMoney(null, 'USD', [usd], 'en')).toBe('—');
    expect(formatMoney(undefined, null, [], 'en')).toBe('—');
  });
  it('shows a bare number when the record has no currency', () => {
    expect(formatMoney(7, null, [usd], 'en')).toBe('7');
  });
  it('an inactive currency still renders on old records', () => {
    expect(formatMoney(10, 'TMN', [{ ...tmn, active: false }], 'en')).toBe('10 Toman');
  });
});

describe('currencyLabel', () => {
  it('is the localized name, or the raw code when unknown', () => {
    expect(currencyLabel('TMN', [tmn], 'fa')).toBe('تومان');
    expect(currencyLabel('TMN', [tmn], 'en')).toBe('Toman');
    expect(currencyLabel('ZZZ', [tmn], 'en')).toBe('ZZZ');
  });
});

describe('matchCurrency', () => {
  const list = [irr, eur, usd, tmn];
  it('matches the code or either name, ignoring case and spaces', () => {
    expect(matchCurrency(' toman ', list)).toBe('TMN');
    expect(matchCurrency('تومان', list)).toBe('TMN');
    expect(matchCurrency('us DOLLAR', list)).toBe('USD');
    expect(matchCurrency('eur', list)).toBe('EUR');
  });
  it('keeps the ledger aliases as a fallback', () => {
    expect(matchCurrency('€', list)).toBe('EUR');
    expect(matchCurrency('UDS', list)).toBe('USD');
    expect(matchCurrency('Rials', list)).toBe('IRR');
  });
  it('does not map an alias to a currency the company does not have, nor to an inactive one', () => {
    expect(matchCurrency('dirham', list)).toBeNull();
    expect(matchCurrency('toman', [{ ...tmn, active: false }])).toBeNull();
    expect(matchCurrency('gold', list)).toBeNull();
  });
});
