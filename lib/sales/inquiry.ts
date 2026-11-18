/**
 * FR-94 §16: reading the client's inquiry register into rows the database import
 * accepts (app_sales_import_inquiries), plus the pure helpers the preview needs
 * (result classification, customer-name similarity). Pure; runs in the browser.
 */

import { toAsciiDigits } from '@/lib/employees/code';
import { parseUserDate } from '@/lib/leave/parseUserDate';
import type { Cell } from './xlsx';

/** Template header row: the register's own header text, in its order. */
export const INQUIRY_HEADERS: string[] = [
  'Result, Status, Last Action, Contract person',
  'In Charge Person in BJ',
  'Record No.',
  'Company',
  'Date',
  'Inquiry No.',
  'Tender/Project',
  'Request No./ Project Name',
  'Description',
  'DATE OF COMMERCIAL OFFER',
  'WINNER (RIAL)',
  'WINNER (EURO)',
  'LOSER (RIAL)',
  'LOSER (EURO)',
];

export type InquiryPhrase = 'won' | 'lost' | 'no_bid' | 'cancelled';

export type InquiryRow = {
  rec: number;
  buyer: string | null;
  received_on: string | null;
  received_text: string | null;
  inquiry_no: string | null;
  inquiry_type: string | null;
  customer_ref: string | null;
  description: string | null;
  submitted_on: string | null;
  offer_text: string | null;
  won_price: number | null;
  lost_price: number | null;
  currency: 'IRR' | 'EUR' | null;
  phrase: InquiryPhrase | null;
  status_note: string | null;
  in_charge: string | null;
  in_charge_flag: 'Y' | 'N' | null;
};

export type InquiryIssueCode = 'rec_missing' | 'rec_duplicate' | 'bad_date' | 'bad_number' | 'bad_value' | 'euro_as_rial';

/** A EURO cell above this is a Rial amount typed in the wrong column (largest real euro bid seen: ~10.7M). */
export const EURO_MAX = 20_000_000;
export type InquiryIssue = {
  /** Spreadsheet row number (1-based). */
  row: number;
  column: string;
  value: string;
  /** error: the row is left out. warning: the cell is left empty / kept as text, the row still imports. */
  level: 'warning' | 'error';
  code: InquiryIssueCode;
};

export type InquiryParse =
  | { ok: true; rows: InquiryRow[]; issues: InquiryIssue[]; unknown: string[]; missing: string[]; separators: number }
  | { ok: false; reason: 'no_header' };

type Field =
  | 'status' | 'in_charge' | 'rec' | 'buyer' | 'received' | 'inquiry_no' | 'inquiry_type' | 'customer_ref'
  | 'description' | 'offer' | 'win_rial' | 'win_euro' | 'lose_rial' | 'lose_euro';

const FIELD_LABEL: Record<Field, string> = {
  status: INQUIRY_HEADERS[0], in_charge: INQUIRY_HEADERS[1], rec: INQUIRY_HEADERS[2], buyer: INQUIRY_HEADERS[3],
  received: INQUIRY_HEADERS[4], inquiry_no: INQUIRY_HEADERS[5], inquiry_type: INQUIRY_HEADERS[6],
  customer_ref: INQUIRY_HEADERS[7], description: INQUIRY_HEADERS[8], offer: INQUIRY_HEADERS[9],
  win_rial: INQUIRY_HEADERS[10], win_euro: INQUIRY_HEADERS[11], lose_rial: INQUIRY_HEADERS[12],
  lose_euro: INQUIRY_HEADERS[13],
};

/** Header text reduced to lower-case letters and digits. */
function headerKey(cell: Cell): string {
  return toAsciiDigits(String(cell ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const NAMED: Record<string, Field> = {
  resultstatuslastactioncontractperson: 'status',
  inchargepersoninbj: 'in_charge',
  recordno: 'rec',
  company: 'buyer',
  date: 'received',
  inquiryno: 'inquiry_no',
  tenderproject: 'inquiry_type',
  requestnoprojectname: 'customer_ref',
  description: 'description',
  dateofcommercialoffer: 'offer',
  winnerrial: 'win_rial',
  winnereuro: 'win_euro',
  loserrial: 'lose_rial',
  losereuro: 'lose_euro',
};

const EMPTY = new Set(['', '-', '–', '—', '?', '؟', 'blank']);

/** A one-line value; null for empty or a placeholder. */
function text(cell: Cell): string | null {
  if (cell === null) return null;
  const value = typeof cell === 'number' ? String(cell) : cell.replace(/\s+/g, ' ').trim();
  return EMPTY.has(value.toLowerCase()) ? null : value;
}

/** A multi-line value (line breaks kept); null when empty. */
function longText(cell: Cell): string | null {
  if (cell === null) return null;
  const value = typeof cell === 'number'
    ? String(cell)
    : cell.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  return value === '' ? null : value;
}

// ---------------------------------------------------------------- dates

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function full(y: number | string, m: number | string, d: number | string): string | null {
  return parseUserDate(`${y}-${m}-${d}`) ?? null;
}

function dateIso(s: string): string | null {
  let m: RegExpMatchArray | null;
  // 1402-06, 1402/06 (day 1)
  if ((m = s.match(/^(\d{4})[/-](\d{1,2})$/))) return full(m[1], m[2], 1);
  // 1402/06/20, 1402-06-20, 2019-05-12
  if ((m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/))) return full(m[1], m[2], m[3]);
  // 99/03/13: two-digit year, 50 and up is 13YY, below is 14YY
  if ((m = s.match(/^(\d{2})[/-](\d{1,2})[/-](\d{1,2})$/))) {
    const yy = Number(m[1]);
    return full(yy >= 50 ? 1300 + yy : 1400 + yy, m[2], m[3]);
  }
  // 25.6.2009, 25/6/2009 (day first; Gregorian years only)
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/))) {
    return Number(m[3]) >= 1600 ? full(m[3], m[2], m[1]) : null;
  }
  // 12 May 2019, 4 Oct 2010, 4th Oct, 2010
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ -]([a-z]{3})[a-z]*\.?,?[ -](\d{4})$/i))) {
    const mo = MONTHS[m[2].toLowerCase()];
    return mo && Number(m[3]) >= 1600 ? full(m[3], mo, m[1]) : null;
  }
  // May 12, 2019
  if ((m = s.match(/^([a-z]{3})[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i))) {
    const mo = MONTHS[m[1].toLowerCase()];
    return mo && Number(m[3]) >= 1600 ? full(m[3], mo, m[2]) : null;
  }
  return null;
}

/**
 * Reads a register date. `iso` is the Gregorian date when the text is a real date;
 * otherwise `text` keeps what was written (null for an empty cell).
 */
export function parseRegisterDate(raw: string | number | null): { iso: string | null; text: string | null } {
  if (raw === null || raw === undefined) return { iso: null, text: null };
  const s = toAsciiDigits(String(raw)).replace(/\s+/g, ' ').trim();
  if (EMPTY.has(s.toLowerCase())) return { iso: null, text: null };
  const iso = dateIso(s);
  return iso ? { iso, text: null } : { iso: null, text: s };
}

// ---------------------------------------------------------------- prices

/** A price cell: value (null when empty or unreadable) and whether it was unreadable. */
export function parsePrice(cell: Cell): { value: number | null; bad: boolean } {
  if (cell === null) return { value: null, bad: false };
  if (typeof cell === 'number') {
    return Number.isFinite(cell) && cell > 0 ? { value: cell, bad: false } : { value: null, bad: !Number.isFinite(cell) || cell < 0 };
  }
  const value = text(cell);
  if (value === null) return { value: null, bad: false };
  const cleaned = toAsciiDigits(value).replace(/[,،٬\s]/g, '').replace(/٫/g, '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { value: null, bad: true };
  const n = Number(cleaned);
  return n > 0 ? { value: n, bad: false } : { value: null, bad: false };
}

// ---------------------------------------------------------------- phrases

/** Text prepared for matching: ي/ك to Persian forms, ZWNJ as a space, lower case. */
function phraseText(s: string): string {
  return s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').toLowerCase();
}

const PHRASES: [InquiryPhrase, RegExp][] = [
  ['won', /برنده\s*شدیم|barandeh\s*shodim|\bwon\b/],
  ['lost', /برنده\s*نشدیم|بردنده\s*نشدیم|تایید\s*نشدیم|barandeh\s*nashodim|\blost\b/],
  ['no_bid', /شرکت\s*نمی\s*کنیم|شرکت\s*نکردیم|شرکت\s*نمیکنیم|پیشنهاد\s*ندادیم|قیمت\s*ندادیم|did not attend|sherkat\s*na|ferestadeh\s*nashod/],
  ['cancelled', /باطل|کنسل|لغو|batel|cancel/],
];

/** The result a status / in-charge text states, first match in the order won, lost, no bid, cancelled. */
export function classifyPhrase(s: string | null | undefined): InquiryPhrase | null {
  if (!s) return null;
  const t = phraseText(s);
  for (const [phrase, re] of PHRASES) if (re.test(t)) return phrase;
  return null;
}

// ---------------------------------------------------------------- inquiry type

/** tender / project / estelam (typos too) / budget price; anything else is null. */
export function normalizeInquiryType(s: string): 'Tender' | 'Project' | 'Estelam' | 'Budget price' | null {
  const k = phraseText(s).replace(/[^a-z؀-ۿ]+/g, '');
  if (k === 'tender' || k === 'مناقصه') return 'Tender';
  if (k === 'project' || k === 'پروژه') return 'Project';
  if ((k.startsWith('est') && k.endsWith('am')) || k === 'استعلام') return 'Estelam';
  if (/^bu?d?[gj]e?t(price)?$/.test(k) || k.startsWith('بودجه')) return 'Budget price';
  return null;
}

// ---------------------------------------------------------------- parser

const isBlank = (row: Cell[]) => row.every((c) => text(c) === null);

/**
 * Reads the sheet's rows. The header row is the first of the first five rows with a
 * "Record No." cell. Rows without a usable record number and repeats of one are errors
 * and left out; separator rows ("start of year …") are skipped and counted; anything
 * else unreadable is a warning and that cell stays empty (a date stays as text).
 */
export function parseInquiryRegister(sheet: Cell[][]): InquiryParse {
  const headerIndex = sheet.slice(0, 5).findIndex((row) => row.some((c) => headerKey(c) === 'recordno'));
  if (headerIndex < 0) return { ok: false, reason: 'no_header' };

  const seenField = new Set<Field>();
  const columns = sheet[headerIndex].map((cell): { field: Field | null; label: string } => {
    const label = String(cell ?? '').replace(/\s+/g, ' ').trim();
    const field = NAMED[headerKey(cell)];
    if (!field || seenField.has(field)) return { field: null, label };
    seenField.add(field);
    return { field, label };
  });
  const missing = (Object.keys(FIELD_LABEL) as Field[]).filter((f) => !seenField.has(f)).map((f) => FIELD_LABEL[f]);
  const unknown = [...new Set(columns.flatMap((c) => (c.field === null && c.label ? [c.label] : [])))];
  const labelOf = (f: Field) => FIELD_LABEL[f];

  const rows: InquiryRow[] = [];
  const issues: InquiryIssue[] = [];
  const seen = new Set<number>();
  let separators = 0;

  for (let i = headerIndex + 1; i < sheet.length; i += 1) {
    const cells = sheet[i] ?? [];
    if (isBlank(cells)) continue;
    const rowNo = i + 1;
    const by: Partial<Record<Field, Cell>> = {};
    columns.forEach((column, c) => {
      if (column.field) by[column.field] = cells[c] ?? null;
    });
    const cell = (f: Field): Cell => by[f] ?? null;

    // Record number.
    const recCell = cell('rec');
    let rec: number | null = null;
    if (typeof recCell === 'number') rec = recCell;
    else {
      const t = text(recCell);
      if (t !== null && /^\d+$/.test(toAsciiDigits(t))) rec = Number(toAsciiDigits(t));
    }
    if (rec === null || !Number.isInteger(rec) || rec < 1 || rec > 2147483647) {
      const company = text(cell('buyer'));
      const onlyCompany = columns.every((column, c) => column.field === 'buyer' || text(cells[c] ?? null) === null);
      if (text(recCell) === null && onlyCompany && company !== null && /شروع|^\d{4}$/.test(toAsciiDigits(company))) {
        separators += 1;
        continue;
      }
      issues.push({ row: rowNo, column: labelOf('rec'), value: String(recCell ?? ''), level: 'error', code: 'rec_missing' });
      continue;
    }
    if (seen.has(rec)) {
      issues.push({ row: rowNo, column: labelOf('rec'), value: String(rec), level: 'error', code: 'rec_duplicate' });
      continue;
    }
    seen.add(rec);

    const rowIssues: InquiryIssue[] = [];
    const warn = (field: Field, value: Cell, code: InquiryIssueCode) =>
      rowIssues.push({ row: rowNo, column: labelOf(field), value: String(value ?? ''), level: 'warning', code });

    const dateOf = (field: Field): { iso: string | null; text: string | null } => {
      const c = cell(field);
      const r = parseRegisterDate(c);
      // Words ("Urgent") are kept as text quietly; something that looks like a date but is not gets a warning.
      if (r.iso === null && r.text !== null && /\d/.test(r.text)) warn(field, c, 'bad_date');
      return r;
    };
    const received = dateOf('received');
    const offer = dateOf('offer');

    let inquiryType = text(cell('inquiry_type'));
    if (inquiryType !== null) {
      const normal = normalizeInquiryType(inquiryType);
      if (normal) inquiryType = normal;
      else warn('inquiry_type', cell('inquiry_type'), 'bad_value');
    }

    // Prices: one price per side, rial before euro; both sides filled keeps the winner.
    const side = (rial: Field, euro: Field): { value: number | null; currency: 'IRR' | 'EUR' | null } => {
      const r = parsePrice(cell(rial));
      const e = parsePrice(cell(euro));
      if (r.bad) warn(rial, cell(rial), 'bad_number');
      if (e.bad) warn(euro, cell(euro), 'bad_number');
      if (r.value !== null && e.value !== null) warn(euro, cell(euro), 'bad_value');
      if (r.value !== null) return { value: r.value, currency: 'IRR' };
      if (e.value !== null && e.value > EURO_MAX) {
        warn(euro, cell(euro), 'euro_as_rial');
        return { value: e.value, currency: 'IRR' };
      }
      if (e.value !== null) return { value: e.value, currency: 'EUR' };
      return { value: null, currency: null };
    };
    const won = side('win_rial', 'win_euro');
    let lost = side('lose_rial', 'lose_euro');
    if (won.value !== null && lost.value !== null) {
      warn('lose_rial', cell('lose_rial') ?? cell('lose_euro'), 'bad_value');
      lost = { value: null, currency: null };
    }

    // In charge: a Y / N flag or a result phrase is not a person.
    const icText = text(cell('in_charge'));
    let inCharge: string | null = icText;
    let flag: 'Y' | 'N' | null = null;
    let icNote: string | null = null;
    if (icText !== null) {
      if (/^[yn]$/i.test(icText)) {
        flag = icText.toUpperCase() as 'Y' | 'N';
        inCharge = null;
      } else if (classifyPhrase(icText)) {
        icNote = icText;
        inCharge = null;
      }
    }
    const statusText = longText(cell('status'));
    const statusNote = [statusText, icNote].filter((v): v is string => v !== null).join('\n') || null;

    issues.push(...rowIssues);
    rows.push({
      rec,
      buyer: text(cell('buyer')),
      received_on: received.iso,
      received_text: received.text,
      inquiry_no: text(cell('inquiry_no')),
      inquiry_type: inquiryType,
      customer_ref: text(cell('customer_ref')),
      description: longText(cell('description')),
      submitted_on: offer.iso,
      offer_text: offer.text,
      won_price: won.value,
      lost_price: lost.value,
      currency: won.value !== null ? won.currency : lost.currency,
      phrase: classifyPhrase([statusText, icText].filter(Boolean).join('\n')),
      status_note: statusNote,
      in_charge: inCharge,
      in_charge_flag: flag,
    });
  }
  return { ok: true, rows, issues, unknown, missing, separators };
}

// ---------------------------------------------------------------- classification

export type InquiryClass =
  | 'skip_app' | 'fill_only' | 'won_new' | 'won_finish' | 'lost' | 'no_bid' | 'cancelled' | 'open' | 'archived';

/**
 * What the import does with a row (spec 16.2 / 16.3), for the preview counts.
 * `existing`: how a record with this number already exists. `cutoffIso`: received on or
 * after it is recent. A LOSER price on a contract-ledger record changes nothing (fill only).
 */
export function classifyInquiry(
  row: Pick<InquiryRow, 'received_on' | 'won_price' | 'lost_price' | 'phrase'>,
  existing: 'app' | 'ledger' | 'inquiry' | null,
  cutoffIso: string,
): InquiryClass {
  if (existing === 'app') return 'skip_app';
  if (existing === 'ledger') return 'fill_only';
  const recent = row.received_on !== null && row.received_on >= cutoffIso;
  if (row.won_price !== null || row.phrase === 'won') return recent ? 'won_new' : 'won_finish';
  if (row.lost_price !== null || row.phrase === 'lost') return 'lost';
  if (row.phrase === 'no_bid') return 'no_bid';
  if (row.phrase === 'cancelled') return 'cancelled';
  return recent ? 'open' : 'archived';
}

// ---------------------------------------------------------------- people

/** Distinct in-charge names with their row counts, most used first. */
export function inChargeNames(rows: Pick<InquiryRow, 'in_charge'>[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.in_charge) counts.set(r.in_charge, (counts.get(r.in_charge) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- customer names

/**
 * The SQL `private.sales_name_key` (lower, trim, collapse spaces, Arabic ي / ك to
 * Persian, no ZWNJ) with every other non-letter, non-digit removed.
 */
export function nameKey(s: string): string {
  return toAsciiDigits(s)
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/‌/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export type CustomerGroup = {
  /** Name key of the group's most used spelling. */
  key: string;
  /** The spellings found in the file, most used first. */
  spellings: { name: string; count: number }[];
  /** The customer that already exists under this key (or a near one). */
  existing: string | null;
  /** The name to offer: the existing customer, else the most used spelling. */
  suggested: string;
  /** false: same key (certain). true: a near key (confirm in the preview). */
  probable: boolean;
};

/**
 * Groups spellings of one company. Same key = certain. A different key within 1 edit
 * (key length 5–9) or 2 edits (10+) is probable, unless both sides have 50+ rows
 * (two real companies). Only groups with something to decide are returned.
 */
export function similarCustomerGroups(names: { name: string; count: number }[], existing: string[]): CustomerGroup[] {
  const byKey = new Map<string, { total: number; spellings: Map<string, number> }>();
  for (const { name, count } of names) {
    const display = name.replace(/\s+/g, ' ').trim();
    const key = nameKey(display);
    if (!key) continue;
    const entry = byKey.get(key) ?? { total: 0, spellings: new Map<string, number>() };
    entry.total += count;
    entry.spellings.set(display, (entry.spellings.get(display) ?? 0) + count);
    byKey.set(key, entry);
  }
  const existingByKey = new Map<string, string>();
  for (const name of existing) {
    const key = nameKey(name);
    if (key && !existingByKey.has(key)) existingByKey.set(key, name.replace(/\s+/g, ' ').trim());
  }

  const near = (a: string, b: string): boolean => {
    const shortest = Math.min(a.length, b.length);
    if (shortest < 5) return false;
    const limit = Math.max(a.length, b.length) >= 10 ? 2 : 1;
    return Math.abs(a.length - b.length) <= limit && levenshtein(a, b) <= limit;
  };

  const keys = [...byKey.keys()].sort((a, b) => byKey.get(b)!.total - byKey.get(a)!.total || a.localeCompare(b));
  const used = new Set<string>();
  const groups: CustomerGroup[] = [];
  for (const head of keys) {
    if (used.has(head)) continue;
    used.add(head);
    const members = [head];
    for (const other of keys) {
      if (used.has(other)) continue;
      if (byKey.get(head)!.total >= 50 && byKey.get(other)!.total >= 50) continue;
      if (near(head, other)) {
        used.add(other);
        members.push(other);
      }
    }
    // An existing customer under the head's key, else under a near key.
    let existingName = existingByKey.get(head) ?? null;
    let existingNear = false;
    if (existingName === null) {
      for (const [key, name] of existingByKey) {
        if (members.some((m) => near(m, key) || m === key)) {
          existingName = name;
          existingNear = true;
          break;
        }
      }
    }
    const spellings = members
      .flatMap((k) => [...byKey.get(k)!.spellings].map(([name, count]) => ({ name, count })))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const probable = members.length > 1 || existingNear;
    const needsChoice = spellings.length > 1 || (existingName !== null && existingName !== spellings[0].name);
    if (!needsChoice) continue;
    groups.push({ key: head, spellings, existing: existingName, suggested: existingName ?? spellings[0].name, probable });
  }
  return groups;
}
