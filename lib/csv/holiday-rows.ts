/**
 * Holiday-import CSV: column spec, header matching, per-row validation (FR-40).
 *
 * Pure module (no Supabase / no React), mirroring `lib/csv/import-rows.ts` so the
 * dialog can reuse the employee wizard's error-rendering shape and so every
 * branch is unit-testable without a request.
 *
 * Dates go through `lib/leave/parseUserDate.ts`, shared with the employee import
 * so an admin learns one rule for both files and the two can never drift: Jalali
 * (`1405/01/01`) or Gregorian (`2026-03-21` / `2026/03/21`), years below 1600 read
 * as Jalali, output always Gregorian ISO, because dates in the database are
 * Gregorian and Jalali is a presentation concern (CLAUDE.md).
 */

import { toAsciiDigits } from '@/lib/employees/code';
import { parseUserDate } from '@/lib/leave/parseUserDate';

export type HolidayColumnKey = 'holiday_date' | 'name_fa' | 'name_en' | 'is_recurring';

export const HOLIDAY_COLUMNS: {
  key: HolidayColumnKey;
  labelFa: string;
  required: boolean;
}[] = [
  { key: 'holiday_date', labelFa: 'تاریخ', required: true },
  { key: 'name_fa', labelFa: 'نام فارسی', required: true },
  { key: 'name_en', labelFa: 'نام انگلیسی', required: false },
  { key: 'is_recurring', labelFa: 'تکرار سالانه', required: false },
];

/**
 * A name long enough to be a mis-mapped column rather than a holiday.
 *
 * The database puts no limit on `holidays.name_fa`, so this is the app's own
 * guard: without it, a file whose columns are shifted by one silently stores a
 * paragraph as a holiday name and the settings list becomes unreadable. 200 is
 * the same bound `errand_location` already uses.
 */
export const MAX_HOLIDAY_NAME_LENGTH = 200;

/** Template header cell: Farsi label with the latin key in parentheses. */
export function holidayTemplateHeader(): string[] {
  return HOLIDAY_COLUMNS.map((c) => `${c.labelFa} (${c.key})`);
}

/**
 * Two filled example rows under the header.
 *
 * Jalali deliberately: every date this app displays is Jalali, so a Gregorian
 * example would teach the admin the wrong habit even though both parse. The
 * repeats column shows one Farsi and one English spelling, because Excel in a
 * Farsi locale will not necessarily write what an English template suggests.
 */
export function holidayTemplateRows(): string[][] {
  return [
    ['1405/01/01', 'عید نوروز', 'Nowruz', 'خیر'],
    ['1405/01/12', 'روز جمهوری اسلامی', 'Islamic Republic Day', 'no'],
  ];
}

export type HolidayRow = {
  /** Gregorian ISO — what the database stores. */
  holiday_date: string;
  name_fa: string;
  name_en: string | null;
  is_recurring: boolean;
  /** True when this date is already in the company's holiday list. */
  isUpdate: boolean;
  /** 1-based CSV line, so the preview can point at the source row. */
  line: number;
  /** The date as written in the file, for the preview. */
  rawDate: string;
};

export type HolidayRowError = {
  /** 1-based CSV line number (header = line 1). */
  line: number;
  field: HolidayColumnKey | 'row';
  messageKey:
    | 'missingColumn'
    | 'required'
    | 'badDate'
    | 'badRecurring'
    | 'nameTooLong'
    | 'dupInFile'
    | 'noRows';
};

export type HolidayImportContext = {
  /** Gregorian ISO dates already stored for this company. */
  existingDates: string[];
};

/** Matches a header cell to a column key: by latin key or Farsi label. */
function matchColumn(cell: string): HolidayColumnKey | null {
  const c = cell.trim().toLowerCase();
  for (const col of HOLIDAY_COLUMNS) {
    if (c === col.key || c.includes(`(${col.key})`) || c === col.labelFa) return col.key;
  }
  return null;
}

/**
 * Converts a date cell to Gregorian ISO.
 * Returns undefined for anything unparseable, null for an empty cell.
 *
 * Shared with the employee import — one implementation, so the two cannot drift
 * again. See `parseUserDate` for why `isValid` alone is not sufficient.
 */
export const parseHolidayDate = parseUserDate;

const YES = new Set(['yes', 'y', 'true', '1', 'بله', 'آری', 'بلي', 'دارد']);
const NO = new Set(['no', 'n', 'false', '0', 'خیر', 'نه', 'ندارد', 'خير']);

/**
 * Reads the repeats-yearly cell. Empty means no — the column is optional and
 * the database column defaults to false.
 *
 * Both Farsi and English spellings are accepted in both directions: the file is
 * edited in Excel by a Farsi-speaking admin, and insisting on the template's own
 * English words would reject the answer they would naturally type.
 */
export function parseYesNo(raw: string): boolean | undefined {
  const c = toAsciiDigits(raw.trim()).toLowerCase();
  if (!c) return false;
  if (YES.has(c)) return true;
  if (NO.has(c)) return false;
  return undefined;
}

/**
 * Parses and validates a whole holiday CSV (already split into rows).
 *
 * Every row is checked before anything is written, so the caller can show the
 * complete problem list instead of failing on the first bad line. A date that
 * already exists is NOT an error — it is marked `isUpdate`, because overwriting
 * is what makes re-uploading a corrected file the natural fix for a typo.
 */
export function validateHolidayRows(
  csvRows: string[][],
  ctx: HolidayImportContext
): { rows: HolidayRow[]; errors: HolidayRowError[] } {
  const errors: HolidayRowError[] = [];
  const rows: HolidayRow[] = [];

  if (csvRows.length === 0) {
    errors.push({ line: 1, field: 'row', messageKey: 'noRows' });
    return { rows, errors };
  }

  const colIndex = new Map<HolidayColumnKey, number>();
  csvRows[0].forEach((cell, i) => {
    const key = matchColumn(cell);
    // First occurrence wins, so a duplicated header does not shift the mapping.
    if (key !== null && !colIndex.has(key)) colIndex.set(key, i);
  });

  for (const col of HOLIDAY_COLUMNS) {
    if (col.required && !colIndex.has(col.key)) {
      errors.push({ line: 1, field: col.key, messageKey: 'missingColumn' });
    }
  }
  // Without the required columns every row error would be a repeat of the above.
  if (errors.length > 0) return { rows, errors };

  if (csvRows.length === 1) {
    errors.push({ line: 1, field: 'row', messageKey: 'noRows' });
    return { rows, errors };
  }

  const existing = new Set(ctx.existingDates);
  // Gregorian ISO → line, so two spellings of one day (Jalali in one row,
  // Gregorian in another) are still caught as the same date.
  const seen = new Map<string, number>();

  const cellAt = (row: string[], key: HolidayColumnKey) => {
    const i = colIndex.get(key);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  for (let r = 1; r < csvRows.length; r++) {
    const row = csvRows[r];
    const line = r + 1; // header is line 1
    let bad = false;

    const rawDate = cellAt(row, 'holiday_date');
    const date = parseHolidayDate(rawDate);
    if (date === null) {
      errors.push({ line, field: 'holiday_date', messageKey: 'required' });
      bad = true;
    } else if (date === undefined) {
      errors.push({ line, field: 'holiday_date', messageKey: 'badDate' });
      bad = true;
    }

    const nameFa = cellAt(row, 'name_fa');
    if (!nameFa) {
      errors.push({ line, field: 'name_fa', messageKey: 'required' });
      bad = true;
    } else if (nameFa.length > MAX_HOLIDAY_NAME_LENGTH) {
      errors.push({ line, field: 'name_fa', messageKey: 'nameTooLong' });
      bad = true;
    }

    const nameEn = cellAt(row, 'name_en');
    if (nameEn.length > MAX_HOLIDAY_NAME_LENGTH) {
      errors.push({ line, field: 'name_en', messageKey: 'nameTooLong' });
      bad = true;
    }

    const recurring = parseYesNo(cellAt(row, 'is_recurring'));
    if (recurring === undefined) {
      errors.push({ line, field: 'is_recurring', messageKey: 'badRecurring' });
      bad = true;
    }

    if (date && seen.has(date)) {
      // Two rows for one day would make the upsert's outcome depend on row
      // order, which is not something the admin can see or reason about.
      errors.push({ line, field: 'holiday_date', messageKey: 'dupInFile' });
      bad = true;
    }

    if (bad || !date) continue;

    seen.set(date, line);
    rows.push({
      holiday_date: date,
      name_fa: nameFa,
      name_en: nameEn || null,
      is_recurring: recurring === true,
      isUpdate: existing.has(date),
      line,
      rawDate,
    });
  }

  return { rows, errors };
}

/** How many rows will be inserted vs overwritten — the preview's headline. */
export function importCounts(rows: HolidayRow[]): { added: number; updated: number } {
  const updated = rows.filter((r) => r.isUpdate).length;
  return { added: rows.length - updated, updated };
}
