import { describe, expect, it } from 'vitest';
import {
  INQUIRY_HEADERS, classifyInquiry, classifyPhrase, inChargeNames, levenshtein, nameKey,
  parseInquiryRegister, parsePrice, parseRegisterDate, similarCustomerGroups, type InquiryRow,
} from '@/lib/sales/inquiry';
import type { Cell } from '@/lib/sales/xlsx';

// Column positions in INQUIRY_HEADERS.
const C = { status: 0, who: 1, rec: 2, company: 3, date: 4, no: 5, type: 6, ref: 7, desc: 8, offer: 9, wr: 10, we: 11, lr: 12, le: 13 };
function row(values: Partial<Record<keyof typeof C, Cell>>): Cell[] {
  const cells: Cell[] = INQUIRY_HEADERS.map(() => null);
  for (const [k, v] of Object.entries(values)) cells[C[k as keyof typeof C]] = v as Cell;
  return cells;
}
const parsed = (...rows: Cell[][]) => {
  const out = parseInquiryRegister([[...INQUIRY_HEADERS], ...rows]);
  if (!out.ok) throw new Error('no header');
  return out;
};

describe('header', () => {
  it('has the 14 register headers and an empty template parses clean', () => {
    expect(INQUIRY_HEADERS).toHaveLength(14);
    expect(parsed()).toEqual({ ok: true, rows: [], issues: [], unknown: [], missing: [], separators: 0 });
  });
  it('is found on row 2, with line breaks in header text', () => {
    const header = [...INQUIRY_HEADERS];
    header[9] = 'DATE OF\nCOMMERCIAL OFFER';
    const out = parseInquiryRegister([['Inquiries 2026'], header, row({ rec: 900001, company: 'Karun Tejarat' })]);
    expect(out.ok && out.rows).toHaveLength(1);
    expect(out.ok && out.missing).toEqual([]);
  });
  it('refuses a sheet without Record No.', () => {
    expect(parseInquiryRegister([['Name', 'Value'], ['a', 1]])).toEqual({ ok: false, reason: 'no_header' });
    expect(parseInquiryRegister([])).toEqual({ ok: false, reason: 'no_header' });
  });
  it('reports missing and unknown columns', () => {
    const header = [...INQUIRY_HEADERS, 'Region'];
    header[5] = 'Zzz';
    const out = parseInquiryRegister([header, [...row({ rec: 900001 }), 'South']]);
    expect(out.ok && out.missing).toEqual(['Inquiry No.']);
    expect(out.ok && out.unknown).toEqual(['Zzz', 'Region']);
  });
});

describe('parseRegisterDate', () => {
  it.each([
    ['1402/06/20', '2023-09-11'],
    ['1402-06-20', '2023-09-11'],
    ['۱۴۰۲/۰۶/۲۰', '2023-09-11'],
    ['1402/06', '2023-08-23'],
    ['1402-06', '2023-08-23'],
    ['99/03/13', '2020-06-02'],
    ['99-03-13', '2020-06-02'],
    ['01/05/10', '2022-08-01'],
    ['49/01/01', '2070-03-20'],
    ['2019-05-12', '2019-05-12'],
    ['12 May 2019', '2019-05-12'],
    ['4 Oct 2010', '2010-10-04'],
    ['May 12, 2019', '2019-05-12'],
    ['25.6.2009', '2009-06-25'],
  ])('%s -> %s', (input, iso) => {
    expect(parseRegisterDate(input)).toEqual({ iso, text: null });
  });
  it.each(['Urgent', '7/25', '13990/07/01', '139908.17', '1402/13/01', '1402/07/31', '31 Feb 2019', 'https://x.test'])(
    '%s stays text',
    (input) => {
      expect(parseRegisterDate(input)).toEqual({ iso: null, text: input });
    },
  );
  it('empty cells', () => {
    expect(parseRegisterDate(null)).toEqual({ iso: null, text: null });
    expect(parseRegisterDate('  ')).toEqual({ iso: null, text: null });
    expect(parseRegisterDate('?')).toEqual({ iso: null, text: null });
  });
});

describe('prices', () => {
  it('reads the writing styles', () => {
    expect(parsePrice('1,250,000')).toEqual({ value: 1250000, bad: false });
    expect(parsePrice('۱۷٬۷۰۰')).toEqual({ value: 17700, bad: false });
    expect(parsePrice(' 12 500 ')).toEqual({ value: 12500, bad: false });
    expect(parsePrice(3400.5)).toEqual({ value: 3400.5, bad: false });
  });
  it('blank, dash and ? are empty; a sum or text is bad', () => {
    for (const v of ['blank', 'Blank', '-', '?', '', null]) expect(parsePrice(v)).toEqual({ value: null, bad: false });
    expect(parsePrice('100 + 200')).toEqual({ value: null, bad: true });
    expect(parsePrice('TBD')).toEqual({ value: null, bad: true });
  });
  it('maps the four columns to a price and a currency, with warnings', () => {
    const out = parsed(
      row({ rec: 900001, wr: '5,000,000' }),
      row({ rec: 900002, le: '12000' }),
      row({ rec: 900003, wr: '100 + 200', we: 'blank' }),
      row({ rec: 900004, wr: '1000', lr: '2000' }),
      row({ rec: 900005, wr: '1000', we: '50' }),
    );
    expect(out.rows.map((r) => [r.won_price, r.lost_price, r.currency])).toEqual([
      [5000000, null, 'IRR'], [null, 12000, 'EUR'], [null, null, null], [1000, null, 'IRR'], [1000, null, 'IRR'],
    ]);
    expect(out.issues.map((i) => [i.row, i.code, i.level])).toEqual([
      [4, 'bad_number', 'warning'], [5, 'bad_value', 'warning'], [6, 'bad_value', 'warning'],
    ]);
  });
});

describe('phrases', () => {
  it.each([
    ['برنده شدیم', 'won'], ['Barandeh Shodim', 'won'], ['we won', 'won'],
    ['برنده نشدیم', 'lost'], ['barandeh nashodim', 'lost'], ['تایید نشدیم', 'lost'], ['Lost', 'lost'],
    ['شرکت نمی‌کنیم', 'no_bid'], ['شرکت نمی کنیم', 'no_bid'], ['قیمت ندادیم', 'no_bid'], ['did not attend', 'no_bid'],
    ['sherkat nakardim', 'no_bid'], ['باطل شد', 'cancelled'], ['kansel batel', 'cancelled'], ['Cancelled', 'cancelled'],
    ['ارسال شد', null], ['', null],
  ])('%s -> %s', (input, phrase) => {
    expect(classifyPhrase(input)).toBe(phrase);
  });
  it('won beats lost and no bid in the stated order, Arabic letters count', () => {
    expect(classifyPhrase('برنده شدیم، شرکت نمی کنیم')).toBe('won');
    expect(classifyPhrase('برنده نشدیم و باطل')).toBe('lost');
    expect(classifyPhrase('شركت نمي كنيم')).toBe('no_bid');
  });
});

describe('rows', () => {
  it('reads a full row', () => {
    const out = parsed(row({
      status: ' برنده شدیم \n 09120000000', who: ' Sara Test ', rec: '900010', company: ' Karun  Tejarat ',
      date: '99/03/13', no: 321, type: 'ESTELALAM', ref: 'RQ-1', desc: 'Pump\n\nspare', offer: '1399/04/02',
      wr: '1,000,000',
    }));
    expect(out.issues).toEqual([]);
    expect(out.rows[0]).toEqual({
      rec: 900010, buyer: 'Karun Tejarat', received_on: '2020-06-02', received_text: null, inquiry_no: '321',
      inquiry_type: 'Estelam', customer_ref: 'RQ-1', description: 'Pump\nspare', submitted_on: '2020-06-22',
      offer_text: null, won_price: 1000000, lost_price: null, currency: 'IRR', phrase: 'won',
      status_note: 'برنده شدیم\n09120000000', in_charge: 'Sara Test', in_charge_flag: null,
    } satisfies InquiryRow);
  });
  it('normalises the inquiry type, keeps other text with a warning', () => {
    const out = parsed(
      row({ rec: 900001, type: 'tender' }), row({ rec: 900002, type: 'Project' }), row({ rec: 900003, type: 'استعلام' }),
      row({ rec: 900004, type: 'Budjet price' }), row({ rec: 900005, type: 'bujet' }), row({ rec: 900006, type: 'RFQ' }),
    );
    expect(out.rows.map((r) => r.inquiry_type)).toEqual(['Tender', 'Project', 'Estelam', 'Budget price', 'Budget price', 'RFQ']);
    expect(out.issues).toEqual([{ row: 7, column: 'Tender/Project', value: 'RFQ', level: 'warning', code: 'bad_value' }]);
  });
  it('keeps unreadable dates as text; words quietly, date-like with a warning', () => {
    const out = parsed(
      row({ rec: 900001, date: 'Urgent', offer: '13990/07/01' }),
      row({ rec: 900002, date: '7/25' }),
    );
    expect(out.rows[0]).toMatchObject({ received_on: null, received_text: 'Urgent', submitted_on: null, offer_text: '13990/07/01' });
    expect(out.issues.map((i) => [i.row, i.column, i.code])).toEqual([[2, 'DATE OF COMMERCIAL OFFER', 'bad_date'], [3, 'Date', 'bad_date']]);
  });
  it('Y / N is a flag and a phrase is not a person', () => {
    const out = parsed(
      row({ rec: 900001, who: 'Y' }), row({ rec: 900002, who: 'n' }),
      row({ rec: 900003, who: 'شرکت نمی کنیم', status: 'sent' }), row({ rec: 900004, who: 'برنده شدیم' }),
      row({ rec: 900005, who: 'Sara Test' }),
    );
    expect(out.rows.map((r) => [r.in_charge, r.in_charge_flag, r.phrase])).toEqual([
      [null, 'Y', null], [null, 'N', null], [null, null, 'no_bid'], [null, null, 'won'], ['Sara Test', null, null],
    ]);
    expect(out.rows[2].status_note).toBe('sent\nشرکت نمی کنیم');
    expect(out.rows[3].status_note).toBe('برنده شدیم');
  });
  it('skips separator rows silently and counts them', () => {
    const out = parsed(
      row({ company: 'شروع سال 1402' }), row({ rec: 900001, company: 'A Co' }), row({ company: '1403' }),
      row({ company: 'Some Co', desc: 'no record number' }),
    );
    expect(out.separators).toBe(2);
    expect(out.rows).toHaveLength(1);
    expect(out.issues).toEqual([{ row: 5, column: 'Record No.', value: '', level: 'error', code: 'rec_missing' }]);
  });
  it('a missing, zero or text record number and a repeat are errors', () => {
    const out = parsed(
      row({ rec: 900001, company: 'A' }), row({ rec: 900001, company: 'B' }), row({ rec: 0 }), row({ rec: 'x7', company: 'C' }),
      row({ rec: 900002, company: 'D' }),
    );
    expect(out.rows.map((r) => r.rec)).toEqual([900001, 900002]);
    expect(out.issues.map((i) => [i.row, i.code, i.level])).toEqual([
      [3, 'rec_duplicate', 'error'], [4, 'rec_missing', 'error'], [5, 'rec_missing', 'error'],
    ]);
  });
  it('blank rows are ignored', () => {
    expect(parsed(row({}), row({ rec: 900001 })).rows).toHaveLength(1);
  });
});

describe('classifyInquiry', () => {
  const base = { received_on: '2026-09-01', won_price: null, lost_price: null, phrase: null } as const;
  const cutoff = '2026-05-17';
  it('record made in the app is skipped; a contract-ledger record is only filled, even with a LOSER price', () => {
    expect(classifyInquiry({ ...base, won_price: 5 }, 'app', cutoff)).toBe('skip_app');
    expect(classifyInquiry({ ...base, lost_price: 5, phrase: 'lost' }, 'ledger', cutoff)).toBe('fill_only');
  });
  it('won: new when recent, finish when old or undated', () => {
    expect(classifyInquiry({ ...base, won_price: 5 }, null, cutoff)).toBe('won_new');
    expect(classifyInquiry({ ...base, phrase: 'won', received_on: '2025-01-01' }, null, cutoff)).toBe('won_finish');
    expect(classifyInquiry({ ...base, won_price: 5, received_on: null }, 'inquiry', cutoff)).toBe('won_finish');
  });
  it('lost, no bid, cancelled follow won in order', () => {
    expect(classifyInquiry({ ...base, lost_price: 5 }, null, cutoff)).toBe('lost');
    expect(classifyInquiry({ ...base, phrase: 'lost', received_on: null }, null, cutoff)).toBe('lost');
    expect(classifyInquiry({ ...base, phrase: 'no_bid' }, null, cutoff)).toBe('no_bid');
    expect(classifyInquiry({ ...base, phrase: 'cancelled' }, null, cutoff)).toBe('cancelled');
    expect(classifyInquiry({ ...base, phrase: 'no_bid', lost_price: 1 }, null, cutoff)).toBe('lost');
  });
  it('open from the cut-off day on, archived before it or without a date', () => {
    expect(classifyInquiry({ ...base, received_on: '2026-05-17' }, null, cutoff)).toBe('open');
    expect(classifyInquiry({ ...base, received_on: '2026-05-16' }, null, cutoff)).toBe('archived');
    expect(classifyInquiry({ ...base, received_on: null }, 'inquiry', cutoff)).toBe('archived');
  });
});

describe('inChargeNames', () => {
  it('counts distinct names, most used first', () => {
    const rows = [{ in_charge: 'B' }, { in_charge: 'A' }, { in_charge: null }, { in_charge: 'A' }, { in_charge: 'C' }];
    expect(inChargeNames(rows)).toEqual([{ name: 'A', count: 2 }, { name: 'B', count: 1 }, { name: 'C', count: 1 }]);
  });
});

describe('names', () => {
  it('nameKey follows the SQL key and drops punctuation', () => {
    expect(nameKey('  Karun   Tejarat ')).toBe('karuntejarat');
    expect(nameKey('Karun-Tejarat (Co.)')).toBe('karuntejaratco');
    expect(nameKey('كارون‌تجارت')).toBe(nameKey('کارونتجارت'));
    expect(nameKey('شركت ۱۲')).toBe('شرکت12');
  });
  it('levenshtein', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('karun', 'karoon')).toBe(2);
    expect(levenshtein('same', 'same')).toBe(0);
    expect(levenshtein('abc', 'abd')).toBe(1);
  });
});

describe('similarCustomerGroups', () => {
  it('same key is one certain group; the most used spelling is suggested', () => {
    const g = similarCustomerGroups([{ name: 'Karun Tejarat', count: 4 }, { name: 'karun  tejarat', count: 1 }, { name: 'Other Co Ltd', count: 3 }], []);
    expect(g).toEqual([{
      key: 'karuntejarat',
      spellings: [{ name: 'Karun Tejarat', count: 4 }, { name: 'karun tejarat', count: 1 }],
      existing: null, suggested: 'Karun Tejarat', probable: false,
    }]);
  });
  it('one or two edits on a long key is probable; short keys never are', () => {
    const g = similarCustomerGroups([
      { name: 'Karun Tejarat', count: 5 }, { name: 'Karoon Tejarat', count: 2 }, // 13 chars, distance 1
      { name: 'Alpha Group', count: 3 }, { name: 'Alphx Groop', count: 1 }, // 10 chars, distance 2
      { name: 'Mehr', count: 3 }, { name: 'Mahr', count: 1 }, // too short
      { name: 'Nasim Co', count: 3 }, { name: 'Nasim Corp', count: 1 }, // 7 vs 9 chars, distance 2 on a short key
    ], []);
    expect(g.map((x) => [x.suggested, x.probable])).toEqual([['Karun Tejarat', true], ['Alpha Group', true]]);
  });
  it('two big companies with near names stay apart', () => {
    expect(similarCustomerGroups([{ name: 'Karun Tejarat', count: 60 }, { name: 'Karoon Tejarat', count: 50 }], [])).toEqual([]);
    expect(similarCustomerGroups([{ name: 'Karun Tejarat', count: 60 }, { name: 'Karoon Tejarat', count: 49 }], [])).toHaveLength(1);
  });
  it('an existing customer is offered first, and no group when it already matches exactly', () => {
    const g = similarCustomerGroups([{ name: 'karun tejarat', count: 7 }, { name: 'Karoon Tejarat', count: 1 }], ['Karun Tejarat']);
    expect(g).toEqual([expect.objectContaining({ existing: 'Karun Tejarat', suggested: 'Karun Tejarat', probable: true })]);
    expect(similarCustomerGroups([{ name: 'Karun Tejarat', count: 7 }], ['Karun Tejarat'])).toEqual([]);
    expect(similarCustomerGroups([{ name: 'Karun Tejarat', count: 7 }], ['Unrelated Co'])).toEqual([]);
  });
  it('a single spelling near an existing customer is a probable group', () => {
    const g = similarCustomerGroups([{ name: 'Karoon Tejarat', count: 2 }], ['Karun Tejarat']);
    expect(g).toEqual([{
      key: 'karoontejarat', spellings: [{ name: 'Karoon Tejarat', count: 2 }], existing: 'Karun Tejarat',
      suggested: 'Karun Tejarat', probable: true,
    }]);
  });
  it('sums the counts of an identical name listed twice and skips empty names', () => {
    const g = similarCustomerGroups([{ name: 'A Co Ltd', count: 1 }, { name: 'A Co Ltd', count: 2 }, { name: ' ', count: 9 }, { name: 'a co ltd.', count: 1 }], []);
    expect(g[0].spellings).toEqual([{ name: 'A Co Ltd', count: 3 }, { name: 'a co ltd.', count: 1 }]);
  });
});

describe('euro column holding a Rial amount', () => {
  it('imports an amount above EURO_MAX as IRR with a warning', () => {
    const header = INQUIRY_HEADERS;
    const row = header.map((h) => (h === 'Record No.' ? '900101' : h === 'Company' ? 'Karun Tejarat' : h === 'WINNER (EURO)' ? '197,500,000,000' : ''));
    const p = parseInquiryRegister([header, row]);
    if (!p.ok) throw new Error('no header');
    expect(p.rows[0].won_price).toBe(197_500_000_000);
    expect(p.rows[0].currency).toBe('IRR');
    expect(p.issues.some((i) => i.code === 'euro_as_rial')).toBe(true);
  });
  it('keeps a normal euro amount as EUR', () => {
    const header = INQUIRY_HEADERS;
    const row = header.map((h) => (h === 'Record No.' ? '900102' : h === 'LOSER (EURO)' ? '506,350' : ''));
    const p = parseInquiryRegister([header, row]);
    if (!p.ok) throw new Error('no header');
    expect(p.rows[0].currency).toBe('EUR');
  });
});
