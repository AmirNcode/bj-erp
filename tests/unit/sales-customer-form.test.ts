import { describe, expect, it } from 'vitest';
import {
  cleanPeople, emptyPerson, gradeState, gradesPayload, hasPartialGrade, hasPartialPerson, hasPhone, isValidPhone, missingKeys,
  normalizePhone, personState, type PersonRow,
} from '@/lib/sales/customerForm';
import { hasGrades } from '@/lib/sales/customers';
import type { CustomerInput } from '@/lib/sales/types';

const full: CustomerInput = {
  name: 'نفت', name_en: 'NISOC', kind: 'government', ceo_name: 'A B', province_code: 'KZ', city_id: 'c1',
  address: 'x', rank: null, category_id: null, grades: [], ceo_phone: null, activity: 'Oil',
  people: [{ name: 'p', title_id: null, email: null, phones: [{ label: 'office', phone: '02112345' }] }],
};

describe('missingKeys (mirror of sales_customer_missing_of)', () => {
  it('is empty for a government customer with a description, a phone and the rest', () => expect(missingKeys(full)).toEqual([]));
  it('lists every empty required field in form order', () => {
    const empty: CustomerInput = {
      ...full, name_en: ' ', kind: null, ceo_name: null, province_code: null, city_id: null, address: '', activity: null, people: [],
    };
    expect(missingKeys(empty)).toEqual(['name_en', 'kind', 'ceo_name', 'province', 'city', 'address', 'phones', 'grade_or_activity']);
  });
  it('government without a description misses grade_or_activity', () => {
    expect(missingKeys({ ...full, activity: null })).toEqual(['grade_or_activity']);
  });
  it('a contractor with only a rank misses category and grade_or_activity', () => {
    expect(missingKeys({ ...full, kind: 'contractor', rank: 3, activity: null })).toEqual(['category', 'grade_or_activity']);
    expect(missingKeys({ ...full, kind: 'contractor', category_id: 'k', activity: null })).toEqual(['rank', 'grade_or_activity']);
  });
  it('a contractor with a description only is complete', () => {
    expect(missingKeys({ ...full, kind: 'contractor', activity: 'Roads' })).toEqual([]);
  });
  it('a complete pair meets the rule without a description, for contractor and private', () => {
    expect(missingKeys({ ...full, kind: 'contractor', rank: 3, category_id: 'k', activity: null })).toEqual([]);
    expect(missingKeys({ ...full, kind: 'private', rank: 3, category_id: 'k', activity: null })).toEqual([]);
  });
  it('a government customer never counts a leftover rank pair', () => {
    expect(missingKeys({ ...full, rank: 3, category_id: 'k', activity: null })).toEqual(['grade_or_activity']);
  });
  it('the CEO direct line alone satisfies phones', () => {
    expect(missingKeys({ ...full, people: [], ceo_phone: '09121234567' })).toEqual([]);
    expect(missingKeys({ ...full, people: [] })).toEqual(['phones']);
  });
});

describe('hasGrades', () => {
  it('is true for contractor and private only', () => {
    expect([hasGrades('contractor'), hasGrades('private'), hasGrades('government'), hasGrades(null)]).toEqual([true, true, false, false]);
  });
});

describe('phone numbers', () => {
  it('normalizes digits and separators like private.sales_phone', () => {
    expect(normalizePhone(' ۰۹۱۲ ۱۲۳-۴۵۶۷ ')).toBe('09121234567');
    expect(normalizePhone('+98 (21) 1234.5678')).toBe('+982112345678');
    expect(normalizePhone('٠٢١٣٤٥٦٧')).toBe('02134567');
  });
  it('accepts 5–15 digits with an optional +', () => {
    expect(isValidPhone('12345')).toBe(true);
    expect(isValidPhone('1234')).toBe(false);
    expect(isValidPhone('+1234567890123456')).toBe(false);
    expect(isValidPhone('abc12345')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
  it('hasPhone looks at the CEO line and every entry', () => {
    expect(hasPhone(null, [])).toBe(false);
    expect(hasPhone('12345', [])).toBe(true);
    expect(hasPhone(null, [{ phones: [{ label: 'fax', phone: '021-12345' }] }])).toBe(true);
    expect(hasPhone(null, [{ phones: [{ label: 'fax', phone: '12' }] }])).toBe(false);
  });
});

describe('key people rows', () => {
  const row = (o: Partial<PersonRow>): PersonRow => ({ ...emptyPerson(), ...o });
  it('classifies empty, partial and ok', () => {
    expect(personState(row({}))).toBe('empty');
    expect(personState(row({ name: 'a' }))).toBe('ok');
    expect(personState(row({ title_id: 't' }))).toBe('ok');
    expect(personState(row({ phones: [{ label: 'mobile', phone: '09121234567' }] }))).toBe('ok');
    expect(personState(row({ phones: [{ label: 'mobile', phone: '12' }] }))).toBe('partial');
    expect(personState(row({ name: 'a', phones: [{ label: 'mobile', phone: '12' }] }))).toBe('partial');
    expect(personState(row({ email: 'a@b.c' }))).toBe('partial');
  });
  it('blocks only on partial rows', () => {
    expect(hasPartialPerson([row({}), row({ name: 'a' })])).toBe(false);
    expect(hasPartialPerson([row({ phones: [{ label: 'office', phone: '1' }] })])).toBe(true);
  });
  it('drops empty entries, trims, normalizes numbers', () => {
    expect(cleanPeople([
      row({}),
      row({ name: ' a ', email: ' ', phones: [{ label: 'mobile', phone: ' ۰۹۱۲ ۱۲۳۴۵۶۷ ' }, { label: 'fax', phone: '' }] }),
    ])).toEqual([{ name: 'a', title_id: null, email: null, phones: [{ label: 'mobile', phone: '09121234567' }] }]);
  });
  it('a company line has no name or title', () => {
    const line = row({ companyLine: true, name: 'ignored', title_id: 't', phones: [{ label: 'fax', phone: '02112345' }] });
    expect(cleanPeople([line])).toEqual([{ name: null, title_id: null, email: null, phones: [{ label: 'fax', phone: '02112345' }] }]);
    expect(personState(row({ companyLine: true }))).toBe('empty');
  });
});

describe('rank / category rows', () => {
  const g = (key: number, rank: string, categoryId: string | null) => ({ key, rank, categoryId });
  it('classifies empty, partial and ok', () => {
    expect(gradeState(g(1, '', null))).toBe('empty');
    expect(gradeState(g(1, '2', null))).toBe('partial');
    expect(gradeState(g(1, '', 'c'))).toBe('partial');
    expect(gradeState(g(1, '2', 'c'))).toBe('ok');
  });
  it('first non-empty row is the main pair, the rest are further pairs', () => {
    expect(gradesPayload([g(1, '', null), g(2, '1', 'a'), g(3, '3', 'b')])).toEqual({
      rank: 1, category_id: 'a', grades: [{ rank: 3, category_id: 'b' }],
    });
  });
  it('the main pair may be half filled; further rows must be whole', () => {
    expect(gradesPayload([g(1, '2', null)])).toEqual({ rank: 2, category_id: null, grades: [] });
    expect(hasPartialGrade([g(1, '2', null), g(2, '1', 'a')])).toBe(false);
    expect(hasPartialGrade([g(1, '2', 'a'), g(2, '', 'b')])).toBe(true);
    expect(hasPartialGrade([g(1, '', null), g(2, '', 'b')])).toBe(false);
  });
  it('no rows: no pair', () => expect(gradesPayload([])).toEqual({ rank: null, category_id: null, grades: [] }));
});
