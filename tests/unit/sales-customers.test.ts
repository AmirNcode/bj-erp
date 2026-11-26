import { describe, expect, it } from 'vitest';
import { barPercent, persianYearOf, persianYearStarts, presentCurrencies, searchCustomers, sortCustomers } from '@/lib/sales/customers';
import type { CustomerSummary } from '@/lib/sales/types';

const c = (name: string, extra: Partial<CustomerSummary> = {}): CustomerSummary => ({
  id: name, name, name_en: null, kind: null, missing: [], records: 0, as_client: 0, open: 0, won: 0, lost: 0, no_bid: 0, archived: 0,
  cancelled: 0, decided: 0, win_rate: null, first_inquiry: null, last_inquiry: null, next_deadline: null,
  main_owner_name: null, ...extra,
});

describe('customers tab helpers', () => {
  it('searches by name key: case, spaces and Arabic letters do not matter', () => {
    const rows = [c('NISOC Co.'), c('شرکت كيان'), c('PEDEC')];
    expect(searchCustomers(rows, 'nis oc').map((r) => r.name)).toEqual(['NISOC Co.']);
    expect(searchCustomers(rows, 'کیان').map((r) => r.name)).toEqual(['شرکت كيان']);
    expect(searchCustomers(rows, '  ')).toHaveLength(3);
  });
  it('sorts numbers and dates both ways, missing values last, ties by name', () => {
    const rows = [c('B', { records: 2, win_rate: 0.5 }), c('A', { records: 2 }), c('C', { records: 9, win_rate: 0.1 })];
    expect(sortCustomers(rows, 'records', 'desc').map((r) => r.name)).toEqual(['C', 'A', 'B']);
    expect(sortCustomers(rows, 'win_rate', 'asc').map((r) => r.name)).toEqual(['C', 'B', 'A']);
    expect(sortCustomers(rows, 'win_rate', 'desc').map((r) => r.name)).toEqual(['B', 'C', 'A']);
    const dates = [c('x', { last_inquiry: '2025-01-01' }), c('y', { last_inquiry: '2026-01-01' })];
    expect(sortCustomers(dates, 'last_inquiry', 'desc').map((r) => r.name)).toEqual(['y', 'x']);
  });
  it('shows a Gregorian year as the Persian year that holds most of it', () => {
    expect(persianYearOf(2024)).toBe(1403);
    expect(persianYearOf(2026)).toBe(1405);
  });
  it('bar width is relative to the largest, never invisible for a non-zero count', () => {
    expect(barPercent(10, 10)).toBe(100);
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(0, 10)).toBe(0);
  });
  it('sorts by a per-currency money column as numbers, missing last', () => {
    const rows = [
      c('A', { sales: { EUR: 900 } }), c('B', { sales: { EUR: 1200, IRR: 5 } }), c('C', {}), c('D', { sales: { EUR: 70 } }),
    ];
    expect(sortCustomers(rows, 'sales:EUR', 'desc').map((r) => r.name)).toEqual(['B', 'A', 'D', 'C']);
    expect(sortCustomers(rows, 'sales:EUR', 'asc').map((r) => r.name)).toEqual(['D', 'A', 'B', 'C']);
    expect(sortCustomers(rows, 'sales:IRR', 'desc').map((r) => r.name)).toEqual(['B', 'A', 'C', 'D']);
    const q = [c('X', { quoted: { USD: 3 } }), c('Y', { quoted: { USD: 10 } })];
    expect(sortCustomers(q, 'quoted:USD', 'desc').map((r) => r.name)).toEqual(['Y', 'X']);
  });
  it('lists the currencies present in the company order, unknown ones last', () => {
    const rows = [c('A', { sales: { IRR: 1, XAU: 2 } }), c('B', { sales: { EUR: 1 } })];
    const list = ['EUR', 'IRR'].map((code, position) => ({ code, name_fa: code, name_en: code, symbol: null, decimals: 0, active: true, position }));
    expect(presentCurrencies(rows, 'sales', list)).toEqual(['EUR', 'IRR', 'XAU']);
    expect(presentCurrencies(rows, 'quoted', list)).toEqual([]);
  });
  it('finds 1 Farvardin of this and last Persian year', () => {
    expect(persianYearStarts('2026-11-17')).toEqual({ yearStart: '2026-03-21', prevYearStart: '2025-03-21' });
    expect(persianYearStarts('2026-03-20')).toEqual({ yearStart: '2025-03-21', prevYearStart: '2024-03-20' });
    expect(persianYearStarts('2026-03-21').yearStart).toBe('2026-03-21');
  });
});
