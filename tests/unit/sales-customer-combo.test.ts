import { describe, expect, it } from 'vitest';
import { exactCustomer, filterCustomers } from '@/app/[locale]/(app)/sales/_components/customerFilter';
import type { CustomerRef } from '@/lib/sales/types';

const c = (id: string, name: string): CustomerRef => ({ id, name, kind: null });
const list = [c('1', 'Foolad Co'), c('2', 'ایران فولاد'), c('3', 'Steel Foolad Trading'), c('4', 'Foolad'), c('5', 'Other')];

describe('filterCustomers', () => {
  it('matches on the name key, ignoring case and spaces', () => {
    expect(filterCustomers(list, 'FOOLAD ').map((x) => x.id)).toEqual(['4', '1', '3']);
  });
  it('puts the exact key first, then prefixes, then the rest', () => {
    expect(filterCustomers(list, 'foolad')[0].id).toBe('4');
    expect(filterCustomers(list, 'foolad').map((x) => x.id)).toEqual(['4', '1', '3']);
  });
  it('treats Arabic ي / ك like Persian ی / ک', () => {
    expect(filterCustomers([c('a', 'فولاد کویر')], 'كوير').map((x) => x.id)).toEqual(['a']);
    expect(filterCustomers([c('a', 'فولاد کویر')], 'كویر').map((x) => x.id)).toEqual(['a']);
  });
  it('caps the result and lists the first entries for empty text', () => {
    const many = Array.from({ length: 50 }, (_, i) => c(String(i), `Co ${i}`));
    expect(filterCustomers(many, 'co').length).toBe(30);
    expect(filterCustomers(many, '').length).toBe(30);
    expect(filterCustomers(many, 'co', 5).length).toBe(5);
  });
  it('returns nothing when no name contains the text', () => {
    expect(filterCustomers(list, 'zzz')).toEqual([]);
  });
});

describe('exactCustomer', () => {
  it('finds a name by its key only', () => {
    expect(exactCustomer(list, ' foolad ')?.id).toBe('4');
    expect(exactCustomer(list, 'foola')).toBeNull();
    expect(exactCustomer(list, '')).toBeNull();
  });
});
