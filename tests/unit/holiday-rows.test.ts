/**
 * Unit tests for the holiday-import parser (FR-40).
 *
 * The parser is the whole safety net: `bulkUpsertHolidays` writes the rows it
 * produces in one statement, so a row that parses wrong is a row that lands wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  HOLIDAY_COLUMNS,
  MAX_HOLIDAY_NAME_LENGTH,
  holidayTemplateHeader,
  holidayTemplateRows,
  parseHolidayDate,
  parseYesNo,
  validateHolidayRows,
  importCounts,
} from '@/lib/csv/holiday-rows';

const HEADER = holidayTemplateHeader();
const NO_EXISTING = { existingDates: [] };

describe('parseHolidayDate', () => {
  it('reads a Jalali date and returns Gregorian ISO', () => {
    // Farvardin 1, 1405 = 2026-03-21 (Nowruz).
    expect(parseHolidayDate('1405/01/01')).toBe('2026-03-21');
  });

  it('reads a Gregorian date unchanged', () => {
    expect(parseHolidayDate('2026-03-21')).toBe('2026-03-21');
    expect(parseHolidayDate('2026/03/21')).toBe('2026-03-21');
  });

  it('uses the year to choose the calendar, at the 1600 boundary', () => {
    // The threshold is inherited from parseHireDate so both imports agree.
    expect(parseHolidayDate('1599/01/01')).not.toBe('1599-01-01');
    expect(parseHolidayDate('1600/01/01')).toBe('1600-01-01');
  });

  it('accepts Persian digits', () => {
    expect(parseHolidayDate('۱۴۰۵/۰۱/۰۱')).toBe('2026-03-21');
  });

  it('accepts single-digit month and day', () => {
    expect(parseHolidayDate('1405/1/1')).toBe('2026-03-21');
  });

  it('returns null for an empty cell', () => {
    expect(parseHolidayDate('')).toBeNull();
    expect(parseHolidayDate('   ')).toBeNull();
  });

  it('returns undefined for junk', () => {
    expect(parseHolidayDate('not a date')).toBeUndefined();
    expect(parseHolidayDate('1405-13-01')).toBeUndefined();
    expect(parseHolidayDate('1405/01/32')).toBeUndefined();
    expect(parseHolidayDate('14050101')).toBeUndefined();
  });

  it('rejects a day that does not exist, instead of rolling it over', () => {
    // Measured, not assumed: DateObject normalises an out-of-range day and still
    // reports isValid === true, so 2026/2/30 would become 2026-03-02 and
    // 1405/12/31 would become 1406/01/02. Both must be refused.
    expect(parseHolidayDate('2026-02-30')).toBeUndefined();
    expect(parseHolidayDate('2026-04-31')).toBeUndefined();
    expect(parseHolidayDate('1405/12/31')).toBeUndefined();
  });

  it('accepts a real Jalali leap day', () => {
    // The round-trip guard must not reject genuine dates: 1403 is a leap year,
    // so 30 Esfand exists.
    expect(parseHolidayDate('1403/12/30')).toBe('2025-03-20');
    // ...and 1405 is not, so the same day does not.
    expect(parseHolidayDate('1405/12/30')).toBeUndefined();
  });

  it('accepts a real Gregorian leap day', () => {
    expect(parseHolidayDate('2024-02-29')).toBe('2024-02-29');
    expect(parseHolidayDate('2026-02-29')).toBeUndefined();
  });
});

describe('parseYesNo', () => {
  it('reads English spellings', () => {
    for (const v of ['yes', 'Y', 'TRUE', '1']) expect(parseYesNo(v)).toBe(true);
    for (const v of ['no', 'N', 'False', '0']) expect(parseYesNo(v)).toBe(false);
  });

  it('reads Farsi spellings', () => {
    expect(parseYesNo('بله')).toBe(true);
    expect(parseYesNo('آری')).toBe(true);
    expect(parseYesNo('خیر')).toBe(false);
    expect(parseYesNo('نه')).toBe(false);
  });

  it('treats an empty cell as no', () => {
    // The column is optional and the database column defaults to false.
    expect(parseYesNo('')).toBe(false);
  });

  it('returns undefined for anything else, rather than guessing', () => {
    expect(parseYesNo('maybe')).toBeUndefined();
    expect(parseYesNo('2')).toBeUndefined();
  });
});

describe('validateHolidayRows', () => {
  it('parses a good file', () => {
    const { rows, errors } = validateHolidayRows(
      [HEADER, ['1405/01/01', 'عید نوروز', 'Nowruz', 'no'], ['2026-06-04', 'رحلت امام', '', 'بله']],
      NO_EXISTING
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      holiday_date: '2026-03-21',
      name_fa: 'عید نوروز',
      name_en: 'Nowruz',
      is_recurring: false,
      isUpdate: false,
      line: 2,
    });
    expect(rows[1]).toMatchObject({
      holiday_date: '2026-06-04',
      name_en: null,
      is_recurring: true,
      line: 3,
    });
  });

  it('accepts the shipped template rows', () => {
    // The template must not teach a format the parser rejects.
    const { rows, errors } = validateHolidayRows(
      [HEADER, ...holidayTemplateRows()],
      NO_EXISTING
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it('matches headers by latin key, Farsi label, or the template form', () => {
    for (const header of [
      ['holiday_date', 'name_fa', 'name_en', 'is_recurring'],
      ['تاریخ', 'نام فارسی', 'نام انگلیسی', 'تکرار سالانه'],
      HEADER,
    ]) {
      const { rows, errors } = validateHolidayRows(
        [header, ['1405/01/01', 'نوروز', '', '']],
        NO_EXISTING
      );
      expect(errors).toEqual([]);
      expect(rows).toHaveLength(1);
    }
  });

  it('tolerates reordered and extra columns', () => {
    const { rows, errors } = validateHolidayRows(
      [
        ['name_fa', 'ignored', 'holiday_date'],
        ['نوروز', 'junk', '1405/01/01'],
      ],
      NO_EXISTING
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ holiday_date: '2026-03-21', name_fa: 'نوروز' });
    // Absent optional columns fall back to their defaults.
    expect(rows[0].name_en).toBeNull();
    expect(rows[0].is_recurring).toBe(false);
  });

  it('reports a missing required column once, not once per row', () => {
    const { rows, errors } = validateHolidayRows(
      [['name_fa'], ['نوروز'], ['روز کارگر']],
      NO_EXISTING
    );
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 1, field: 'holiday_date', messageKey: 'missingColumn' }]);
  });

  it('reports an empty file and a header-only file', () => {
    expect(validateHolidayRows([], NO_EXISTING).errors).toEqual([
      { line: 1, field: 'row', messageKey: 'noRows' },
    ]);
    expect(validateHolidayRows([HEADER], NO_EXISTING).errors).toEqual([
      { line: 1, field: 'row', messageKey: 'noRows' },
    ]);
  });

  it('flags a bad date and a missing date differently', () => {
    const { errors } = validateHolidayRows(
      [HEADER, ['', 'نوروز', '', ''], ['nonsense', 'نوروز', '', '']],
      NO_EXISTING
    );
    expect(errors).toEqual([
      { line: 2, field: 'holiday_date', messageKey: 'required' },
      { line: 3, field: 'holiday_date', messageKey: 'badDate' },
    ]);
  });

  it('requires the Farsi name', () => {
    const { rows, errors } = validateHolidayRows(
      [HEADER, ['1405/01/01', '', 'Nowruz', '']],
      NO_EXISTING
    );
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 2, field: 'name_fa', messageKey: 'required' }]);
  });

  it('rejects an over-long name in either language', () => {
    const long = 'ا'.repeat(MAX_HOLIDAY_NAME_LENGTH + 1);
    const { errors } = validateHolidayRows(
      [HEADER, ['1405/01/01', long, '', ''], ['1405/01/02', 'نوروز', long, '']],
      NO_EXISTING
    );
    expect(errors).toEqual([
      { line: 2, field: 'name_fa', messageKey: 'nameTooLong' },
      { line: 3, field: 'name_en', messageKey: 'nameTooLong' },
    ]);
  });

  it('rejects an unreadable repeats cell', () => {
    const { errors } = validateHolidayRows(
      [HEADER, ['1405/01/01', 'نوروز', '', 'sometimes']],
      NO_EXISTING
    );
    expect(errors).toEqual([{ line: 2, field: 'is_recurring', messageKey: 'badRecurring' }]);
  });

  it('catches a duplicate date inside one file, across calendars', () => {
    // The same day written once as Jalali and once as Gregorian must still
    // collide, or the upsert's outcome would depend on row order.
    const { rows, errors } = validateHolidayRows(
      [HEADER, ['1405/01/01', 'نوروز', '', ''], ['2026-03-21', 'Nowruz again', '', '']],
      NO_EXISTING
    );
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([{ line: 3, field: 'holiday_date', messageKey: 'dupInFile' }]);
  });

  it('marks an existing date as an update, NOT an error', () => {
    // This is the owner's chosen behaviour: re-uploading a corrected file fixes
    // the rows instead of being rejected.
    const { rows, errors } = validateHolidayRows(
      [HEADER, ['1405/01/01', 'عید نوروز', '', ''], ['1405/01/02', 'دوم فروردین', '', '']],
      { existingDates: ['2026-03-21'] }
    );
    expect(errors).toEqual([]);
    expect(rows[0].isUpdate).toBe(true);
    expect(rows[1].isUpdate).toBe(false);
    expect(importCounts(rows)).toEqual({ added: 1, updated: 1 });
  });

  it('collects every problem instead of stopping at the first', () => {
    const { rows, errors } = validateHolidayRows(
      [HEADER, ['bad', '', '', 'maybe'], ['1405/01/01', 'نوروز', '', '']],
      NO_EXISTING
    );
    // Three problems on line 2, and the good line still parses.
    expect(errors.filter((e) => e.line === 2)).toHaveLength(3);
    expect(rows).toHaveLength(1);
    expect(rows[0].line).toBe(3);
  });

  it('keeps the raw date for the preview', () => {
    const { rows } = validateHolidayRows(
      [HEADER, ['1405/01/01', 'نوروز', '', '']],
      NO_EXISTING
    );
    expect(rows[0].rawDate).toBe('1405/01/01');
  });
});

describe('template', () => {
  it('header covers every column, keys included for unambiguous matching', () => {
    const header = holidayTemplateHeader();
    expect(header).toHaveLength(HOLIDAY_COLUMNS.length);
    for (const col of HOLIDAY_COLUMNS) {
      expect(header.some((h) => h.includes(`(${col.key})`))).toBe(true);
    }
  });

  it('example rows have one cell per column', () => {
    for (const row of holidayTemplateRows()) {
      expect(row).toHaveLength(HOLIDAY_COLUMNS.length);
    }
  });
});
