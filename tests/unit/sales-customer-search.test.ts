import { describe, expect, it } from 'vitest';
import { countAnyWords, filterByWords, matchAllWords, searchWords, similarByWords } from '@/lib/sales/customerSearch';
import { customerLabel, labelOf } from '@/lib/sales/customerLabel';
import { nameKey } from '@/lib/sales/inquiry';

// Shared fold fixture: tests/sql/sales-customer-registry.sql asserts private.sales_word_key gives the same keys.
export const FOLD_FIXTURE: [string, string][] = [
  ['شرکت‌ نفتِ «فلات» ABC-12 ـ ۱۲', 'شرکتنفتفلاتabc12ـ12'],
  ['ملي مناطق نفت‌خيز جنوب', 'ملیمناطقنفتخیزجنوب'],
  ['NISOC (Co.)', 'nisocco'],
  ['  Ahvaz  ٣٤ ', 'ahvaz34'],
  ['پتروپارس، ایران؛ ٪', 'پتروپارسایران'],
  ['كيش', 'کیش'],
  ['آب و فاضلاب', 'آبوفاضلاب'],
  ['x_y/z.w', 'xyzw'],
];

describe('word fold', () => {
  it.each(FOLD_FIXTURE)('nameKey(%s)', (input, key) => expect(nameKey(input)).toBe(key));
  it('splits on white space before folding', () => {
    expect(searchWords('  نفت   جنوب ')).toEqual(['نفت', 'جنوب']);
    expect(searchWords('— ')).toEqual([]);
  });
});

describe('matchAllWords (picker, Customers tab, Records)', () => {
  const fields = ['شرکت ملی مناطق نفت‌خیز جنوب', 'NISOC'];
  it('every word, any order, either name', () => {
    expect(matchAllWords(fields, 'نفتخیز ملی')).toBe(true);
    expect(matchAllWords(fields, 'nisoc جنوب')).toBe(true);
    expect(matchAllWords(fields, 'جنوب پارس')).toBe(false);
  });
  it('folds ی/ک, ZWNJ, case and digits', () => {
    expect(matchAllWords(['كيش ۲'], 'کیش 2')).toBe(true);
    expect(matchAllWords(['نفت‌خیز'], 'نفتخيز')).toBe(true);
  });
  it('empty text matches everything', () => expect(matchAllWords([], '  ')).toBe(true));
});

describe('countAnyWords (duplicate list)', () => {
  it('ignores generic and one-letter words', () => {
    expect(countAnyWords(['شرکت فلات قاره'], 'شرکت نفت')).toBe(0);
    expect(countAnyWords(['شرکت فلات قاره'], 'فلات ایران')).toBe(1);
    expect(countAnyWords(['Falat Ghareh'], 'co falat a')).toBe(1);
  });
});

describe('filterByWords / similarByWords', () => {
  const list = [
    { id: '1', name: 'نفت فلات قاره', name_en: 'IOOC' },
    { id: '2', name: 'فلات', name_en: null },
    { id: '3', name: 'پالایش نفت آبادان', name_en: 'ABADAN REFINERY' },
  ];
  it('exact, then prefix, then contains; English names count', () => {
    expect(filterByWords(list, 'فلات').map((c) => c.id)).toEqual(['2', '1']);
    expect(filterByWords(list, 'refinery').map((c) => c.id)).toEqual(['3']);
    expect(filterByWords(list, 'ioo').map((c) => c.id)).toEqual(['1']);
    expect(filterByWords(list, '', 2).map((c) => c.id)).toEqual(['1', '2']);
  });
  it('similar: any meaningful word, most words first', () => {
    expect(similarByWords(list, 'شرکت نفت فلات').map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(similarByWords(list, 'شرکت')).toEqual([]);
  });
});

describe('customerLabel (D4)', () => {
  it('English UI prefers the English name, Farsi UI the Farsi name', () => {
    expect(customerLabel({ name: 'نیسوک', name_en: 'NISOC' }, 'en')).toBe('NISOC');
    expect(customerLabel({ name: 'نیسوک', name_en: 'NISOC' }, 'fa')).toBe('نیسوک');
    expect(customerLabel({ name: 'نیسوک', name_en: null }, 'en')).toBe('نیسوک');
    expect(labelOf(null, null, 'en')).toBe('');
  });
});
