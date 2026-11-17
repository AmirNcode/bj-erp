import { describe, expect, it } from 'vitest';
import { LEDGER_HEADERS, inChargeNames, parseLedger, templateRows } from '@/lib/sales/ledger';
import { readXlsx, writeXlsx, type Cell } from '@/lib/sales/xlsx';

/** A data row under the template: values by header position. */
function row(values: Record<number, Cell>): Cell[] {
  const cells: Cell[] = LEDGER_HEADERS.map(() => null);
  for (const [i, v] of Object.entries(values)) cells[Number(i)] = v;
  return cells;
}
const sheet = (...rows: Cell[][]) => [...templateRows(), ...rows];
const parsed = (...rows: Cell[][]) => {
  const out = parseLedger(sheet(...rows));
  if (!out.ok) throw new Error('no header');
  return out;
};

describe('template', () => {
  it('has the 47 ledger columns and parses clean, also after an xlsx round trip', () => {
    expect(LEDGER_HEADERS).toHaveLength(47);
    const out = parseLedger(readXlsx(writeXlsx('BJ Contract', templateRows()))[0].rows);
    expect(out).toEqual({ ok: true, rows: [], issues: [], unknown: [], missing: [] });
  });
  it('group titles carry no personal names', () => {
    expect(templateRows()[0].join(' ')).not.toMatch(/مهرناز|ماندانا/);
  });
});

describe('header', () => {
  it('is found on row 1 as well as row 2, with the ledger\'s own line breaks', () => {
    const header = [...LEDGER_HEADERS];
    header[8] = 'Order \nIssuance \nDate';
    header[10] = 'Pre Payment \n( yes ? no )';
    header[35] = '% of Down 4 \nAPG';
    const out = parseLedger([header, row({ 0: 8030, 8: '1404/10/11', 10: 'YES', 35: 0.25 })]);
    expect(out.ok && out.missing).toEqual([]);
    expect(out.ok && out.rows[0]).toMatchObject({ rec: 8030, order_date: '2026-01-01', prepayment: true });
    expect(out.ok && out.rows[0].bonds).toEqual([expect.objectContaining({ kind: 'advance_payment', seq: 4, percent: 0.25 })]);
  });
  it('a sheet without a Rec header is refused', () => {
    expect(parseLedger([['Name', 'Value'], ['a', 1]])).toEqual({ ok: false, reason: 'no_header' });
    expect(parseLedger([])).toEqual({ ok: false, reason: 'no_header' });
  });
  it('a missing column is reported and the rows still parse; an extra one is kept by header', () => {
    const header = [...LEDGER_HEADERS, 'Region'];
    header[5] = null as unknown as string;
    const out = parseLedger([header, [...row({ 0: 1, 1: 'A' }), 'South']]);
    expect(out.ok && out.missing).toEqual(['Project Site']);
    expect(out.ok && out.unknown).toEqual(['Region']);
    expect(out.ok && out.rows[0].custom).toEqual({ Region: 'South' });
  });
});

describe('values as the sample ledger writes them', () => {
  it('reads a full row', () => {
    const out = parsed(row({
      0: 9694, 1: 'Tehran Jonoob', 2: 'IGEDC', 3: 'C', 4: 'TJ-DZP-PUR-H-2402-0933', 5: 'Poldokhtar - Dezful',
      6: '8', 7: 'Month', 9: ' 1403/02/19', 10: 'Yes', 11: ' 1403/02/19', 12: '1403/10/19', 13: 'NO',
      14: 'ON-OFF', 15: 711000, 16: 'Euro', 17: 'current', 18: 'Kimia Saki',
      19: 0.12, 20: 'Yes', 22: 85320, 23: 0.25, 24: 'Safteh', 26: 177750, 39: 1000, 40: '1403/03/01',
    }));
    expect(out.issues).toEqual([]);
    expect(out.rows[0]).toEqual({
      rec: 9694, buyer: 'Tehran Jonoob', client: 'IGEDC', kind: 'contractor', customer_ref: 'TJ-DZP-PUR-H-2402-0933',
      project_site: 'Poldokhtar - Dezful', delivery_amount: 8, delivery_unit: 'month', delivery_text: null,
      order_date: null, contract_start: '2024-05-08', prepayment: true, prepayment_date: '2024-05-08',
      delivery_date: '2025-01-08', addendum: false, description: 'ON-OFF', total_value: 711000, currency: 'EUR',
      status: 'current', in_charge: 'Kimia Saki',
      bonds: [
        { kind: 'performance', seq: 1, percent: 0.12, form: 'bank', issued_on: null, amount: 85320, status: null, note: null },
        { kind: 'advance_payment', seq: 1, percent: 0.25, form: 'safteh', issued_on: null, amount: 177750, status: null, note: null },
      ],
      payments: [{ seq: 1, amount: 1000, paid_on: '2024-05-21' }],
      custom: {},
    });
  });
  it('normalises the known oddities', () => {
    const out = parsed(
      row({ 0: 1, 2: '-', 7: 'Mounth', 16: 'UDS', 24: 'چک', 6: '4-12', 15: '۱۷٬۷۰۰', 4: 182592 }),
      row({ 0: '2', 16: 'Rial', 20: 'YES-باطل شده است', 26: 0, 7: 'Day', 6: 1.5 }),
    );
    expect(out.issues).toEqual([]);
    expect(out.rows[0]).toMatchObject({ client: null, delivery_unit: 'month', currency: 'USD', delivery_amount: null,
      delivery_text: '4-12', total_value: 17700, customer_ref: '182592' });
    expect(out.rows[0].bonds).toEqual([expect.objectContaining({ kind: 'advance_payment', form: 'cheque' })]);
    expect(out.rows[1]).toMatchObject({ rec: 2, currency: 'IRR', delivery_amount: 1.5, delivery_unit: 'day' });
    expect(out.rows[1].bonds).toEqual([expect.objectContaining({ kind: 'performance', form: 'bank', status: 'void', note: 'YES-باطل شده است' })]);
  });
  it('a formula amount of 0 with nothing else is not a guarantee; "No" is none', () => {
    const out = parsed(row({ 0: 1, 26: 0, 22: 0, 20: 'No' }));
    expect(out.rows[0].bonds).toEqual([]);
    expect(out.issues).toEqual([]);
  });
  it('unreadable cells are warnings; the cell stays empty and the row imports', () => {
    const out = parsed(row({ 0: 5, 9: '1403/13/45', 15: 'TBD', 19: 'طی نامه مبلغ ریالی', 26: '#VALUE!', 10: 'maybe', 12: 45000, 16: 'Bitcoin!' }));
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ contract_start: null, total_value: null, prepayment: null, delivery_date: null, currency: null, bonds: [] });
    expect(out.issues.map((i) => `${i.row}:${i.level}:${i.code}`).sort()).toEqual([
      '3:warning:bad_date', '3:warning:bad_date', '3:warning:bad_number', '3:warning:bad_number', '3:warning:bad_number',
      '3:warning:bad_value', '3:warning:bad_value',
    ]);
  });
  it('a typed percent above 1 is read as a percentage', () => {
    expect(parsed(row({ 0: 1, 19: 10 })).rows[0].bonds[0].percent).toBe(0.1);
  });
});

describe('Rec', () => {
  it('rows without a usable Rec and repeated Recs are errors and left out; blank rows are skipped', () => {
    const out = parsed(row({ 0: 7 }), row({}), row({ 1: 'no rec' }), row({ 0: 7, 1: 'again' }), row({ 0: 'abc' }), row({ 0: 1.5 }), row({ 0: '۸۰۳۰' }));
    expect(out.rows.map((r) => r.rec)).toEqual([7, 8030]);
    expect(out.issues.map((i) => `${i.row}:${i.code}`)).toEqual(['5:rec_missing', '6:rec_duplicate', '7:rec_missing', '8:rec_missing']);
    expect(out.issues.every((i) => i.level === 'error')).toBe(true);
  });
});

describe('in-charge names', () => {
  it('lists each name once', () => {
    const out = parsed(row({ 0: 1, 18: 'Sara Mohsen' }), row({ 0: 2, 18: 'Kimia  Saki' }), row({ 0: 3, 18: 'Sara Mohsen' }), row({ 0: 4 }));
    expect(inChargeNames(out.rows)).toEqual(['Kimia Saki', 'Sara Mohsen']);
  });
});
