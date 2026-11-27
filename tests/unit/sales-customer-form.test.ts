import { describe, expect, it } from 'vitest';
import {
  cleanContacts, contactState, emptyContactRow, gradeState, gradesPayload, hasPartialContact, hasPartialGrade, missingKeys,
} from '@/lib/sales/customerForm';
import type { CustomerInput } from '@/lib/sales/types';

const full: CustomerInput = {
  name: 'نفت', name_en: 'NISOC', kind: 'government', ceo_name: 'A B', province_code: 'KZ', city_id: 'c1',
  address: 'x', rank: null, category_id: null, grades: [],
  contacts: [{ person: 'p', title: null, label: 'office', phone: '021', email: null }],
};

describe('missingKeys', () => {
  it('is empty for a complete government customer', () => expect(missingKeys(full)).toEqual([]));
  it('lists every empty required field in form order', () => {
    const empty: CustomerInput = { ...full, name_en: ' ', kind: null, ceo_name: null, province_code: null, city_id: null, address: '', contacts: [] };
    expect(missingKeys(empty)).toEqual(['name_en', 'kind', 'ceo_name', 'province', 'city', 'address', 'contacts']);
  });
  it('asks for rank and category only from a contractor', () => {
    expect(missingKeys({ ...full, kind: 'contractor' })).toEqual(['rank', 'category']);
    expect(missingKeys({ ...full, kind: 'contractor', rank: 3, category_id: 'k' })).toEqual([]);
  });
});

describe('contact rows', () => {
  const row = (o: Partial<ReturnType<typeof emptyContactRow>>) => ({ ...emptyContactRow(), ...o });
  it('classifies empty, partial and ok', () => {
    expect(contactState(row({}))).toBe('empty');
    expect(contactState(row({ person: 'a' }))).toBe('partial');
    expect(contactState(row({ phone: '1' }))).toBe('partial');
    expect(contactState(row({ title: 'x' }))).toBe('partial');
    expect(contactState(row({ person: 'a', phone: '1' }))).toBe('ok');
  });
  it('blocks only on partial rows', () => {
    expect(hasPartialContact([row({}), row({ person: 'a', phone: '1' })])).toBe(false);
    expect(hasPartialContact([row({ person: 'a' })])).toBe(true);
  });
  it('drops empty rows and trims the rest', () => {
    expect(cleanContacts([row({}), row({ person: ' a ', phone: ' 1 ', email: ' ' })])).toEqual([
      { person: 'a', title: null, label: 'office', phone: '1', email: null },
    ]);
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
