import { describe, expect, it } from 'vitest';
import { CUSTOMER_IMPORT_COLUMNS, parseCustomerSheet, templateRows, type CustomerImportColumn } from '@/lib/sales/customerImport';

const mk = (p: string) => Object.fromEntries(CUSTOMER_IMPORT_COLUMNS.map((c) => [c, `${p}${c}`])) as Record<CustomerImportColumn, string>;
const fa = mk('fa-');
const en = mk('en-');
const headerOf = (h: Record<CustomerImportColumn, string>) => CUSTOMER_IMPORT_COLUMNS.map((c) => h[c]);

describe('parseCustomerSheet', () => {
  it('skips a Farsi header row', () => {
    const r = parseCustomerSheet([headerOf(fa), ['شرکت', 'X']], fa, en);
    expect(r).toEqual({ rows: [{ row: 2, name: 'شرکت', name_en: 'X' }] });
  });
  it('skips an English header row', () => {
    const r = parseCustomerSheet([headerOf(en), ['A']], fa, en);
    expect('rows' in r && r.rows).toEqual([{ row: 2, name: 'A' }]);
  });
  it('keeps a first row without header', () => {
    const r = parseCustomerSheet([['A']], fa, en);
    expect('rows' in r && r.rows[0].row).toBe(1);
  });
  it('skips empty rows and keeps sheet row numbers', () => {
    const r = parseCustomerSheet([headerOf(fa), ['', ' ', null], ['B']], fa, en);
    expect('rows' in r && r.rows).toEqual([{ row: 3, name: 'B' }]);
  });
  it('turns numbers into text', () => {
    const r = parseCustomerSheet([['A', null, null, null, null, null, null, 3, null, null, null, null, 9121234567]], fa, en);
    expect('rows' in r && r.rows[0]).toMatchObject({ rank: '3', phone: '9121234567' });
  });
  it('reports empty and tooMany', () => {
    expect(parseCustomerSheet([headerOf(fa)], fa, en)).toEqual({ error: 'empty' });
    const many = Array.from({ length: 1001 }, (_, i) => [`n${i}`]);
    expect(parseCustomerSheet(many, fa, en)).toEqual({ error: 'tooMany' });
    expect('rows' in parseCustomerSheet(many.slice(0, 1000), fa, en)).toBe(true);
  });
  it('builds a template of header + example', () => {
    expect(templateRows(fa, en)).toHaveLength(2);
  });
});
