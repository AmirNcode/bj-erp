/**
 * Employee-import CSV: column spec, header matching, per-row validation.
 * Pure module (no Supabase / no React) — unit-testable and shared between
 * the import wizard (client) and its tests.
 *
 * Dates: hire_date accepts Jalali (1404/04/22) or Gregorian (2025-07-13 or
 * 2025/07/13); years < 1600 are Jalali. Output is always Gregorian ISO —
 * dates in the DB are Gregorian, Jalali is a presentation concern (CLAUDE.md).
 */

import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import gregorian from 'react-date-object/calendars/gregorian';
import { toAsciiDigits, isValidPersonnelNo } from '@/lib/employees/code';

export type ImportColumnKey =
  | 'full_name'
  | 'personnel_no'
  | 'hire_date'
  | 'department_code'
  | 'manager_personnel_no'
  | 'role'
  | 'job_title'
  | 'annual_days'
  | 'sick_days';

export const IMPORT_COLUMNS: { key: ImportColumnKey; labelFa: string; required: boolean }[] = [
  { key: 'full_name', labelFa: 'نام کامل', required: true },
  { key: 'personnel_no', labelFa: 'شماره پرسنلی', required: true },
  { key: 'hire_date', labelFa: 'تاریخ استخدام', required: false },
  { key: 'department_code', labelFa: 'کد بخش', required: true },
  { key: 'manager_personnel_no', labelFa: 'شماره پرسنلی مدیر', required: false },
  { key: 'role', labelFa: 'نقش', required: true },
  { key: 'job_title', labelFa: 'عنوان شغلی', required: false },
  { key: 'annual_days', labelFa: 'مرخصی استحقاقی (روز)', required: false },
  { key: 'sick_days', labelFa: 'مرخصی استعلاجی (روز)', required: false },
];

/** Template header cell: Farsi label with the latin key in parentheses. */
export function templateHeader(): string[] {
  return IMPORT_COLUMNS.map((c) => `${c.labelFa} (${c.key})`);
}

export type ImportRow = {
  full_name: string;
  personnel_no: string;
  hire_date: string | null; // Gregorian ISO
  department_code: string;
  manager_personnel_no: string | null;
  role: 'manager' | 'employee';
  job_title: string | null;
  annual_days: number;
  sick_days: number;
};

export type RowError = {
  /** 1-based CSV line number (header = line 1). */
  line: number;
  field: ImportColumnKey | 'row';
  messageKey:
    | 'missingColumn'
    | 'required'
    | 'badPersonnelNo'
    | 'dupInFile'
    | 'dupExisting'
    | 'unknownDept'
    | 'unknownManager'
    | 'badDate'
    | 'badRole'
    | 'badDays';
};

export type ImportContext = {
  /** Valid department codes (lowercase). */
  deptCodes: string[];
  /** Personnel numbers already in the database. */
  existingPersonnelNos: string[];
};

/** Matches a header cell to a column key: by latin key or Farsi label. */
function matchColumn(cell: string): ImportColumnKey | null {
  const c = cell.trim().toLowerCase();
  for (const col of IMPORT_COLUMNS) {
    if (c === col.key || c.includes(`(${col.key})`) || c === col.labelFa) return col.key;
  }
  return null;
}

/**
 * Converts a hire-date cell to Gregorian ISO. Returns null for empty,
 * undefined for unparseable.
 */
export function parseHireDate(raw: string): string | null | undefined {
  const cell = toAsciiDigits(raw.trim());
  if (!cell) return null;

  const m = cell.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;

  // Same construction pattern as tests/e2e/_helpers.ts (in-repo precedent).
  const calendar = y < 1600 ? persian : gregorian;
  const obj = new DateObject({ calendar, year: y, month: mo, day: d });
  if (!obj.isValid) return undefined;
  return obj.convert(gregorian).format('YYYY-MM-DD');
}

/**
 * Parses + validates a whole CSV file (already split into rows).
 * Row order matters: a manager_personnel_no may reference an earlier row
 * in the same file or an existing employee — never a later row.
 */
export function validateImportRows(
  csvRows: string[][],
  ctx: ImportContext
): { rows: ImportRow[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const rows: ImportRow[] = [];
  if (csvRows.length === 0) return { rows, errors };

  const colIndex = new Map<ImportColumnKey, number>();
  csvRows[0].forEach((cell, i) => {
    const key = matchColumn(cell);
    if (key !== null && !colIndex.has(key)) colIndex.set(key, i);
  });

  for (const col of IMPORT_COLUMNS) {
    if (col.required && !colIndex.has(col.key)) {
      errors.push({ line: 1, field: col.key, messageKey: 'missingColumn' });
    }
  }
  if (errors.length > 0) return { rows, errors };

  const deptSet = new Set(ctx.deptCodes.map((c) => c.toLowerCase()));
  const knownPnos = new Set(ctx.existingPersonnelNos);
  const filePnos = new Set<string>();

  csvRows.slice(1).forEach((raw, i) => {
    const line = i + 2;
    const get = (key: ImportColumnKey) => {
      const idx = colIndex.get(key);
      return idx === undefined ? '' : (raw[idx] ?? '').trim();
    };
    let bad = false;
    const fail = (field: RowError['field'], messageKey: RowError['messageKey']) => {
      errors.push({ line, field, messageKey });
      bad = true;
    };

    const full_name = get('full_name');
    if (!full_name) fail('full_name', 'required');

    const personnel_no = toAsciiDigits(get('personnel_no'));
    if (!personnel_no) fail('personnel_no', 'required');
    else if (!isValidPersonnelNo(personnel_no)) fail('personnel_no', 'badPersonnelNo');
    else if (filePnos.has(personnel_no)) fail('personnel_no', 'dupInFile');
    else if (knownPnos.has(personnel_no)) fail('personnel_no', 'dupExisting');

    const department_code = get('department_code').toLowerCase();
    if (!department_code) fail('department_code', 'required');
    else if (!deptSet.has(department_code)) fail('department_code', 'unknownDept');

    const managerRaw = toAsciiDigits(get('manager_personnel_no'));
    // Backward reference only: earlier file rows are in filePnos already.
    if (managerRaw && !filePnos.has(managerRaw) && !knownPnos.has(managerRaw)) {
      fail('manager_personnel_no', 'unknownManager');
    }

    const role = get('role').toLowerCase();
    if (role !== 'manager' && role !== 'employee') fail('role', 'badRole');

    const hire_date = parseHireDate(get('hire_date'));
    if (hire_date === undefined) fail('hire_date', 'badDate');

    const parseDays = (key: ImportColumnKey): number => {
      const cell = toAsciiDigits(get(key)).replace('٫', '.');
      if (!cell) return 0;
      const n = Number(cell);
      if (!Number.isFinite(n) || n < 0 || n > 366) {
        fail(key, 'badDays');
        return 0;
      }
      return n;
    };
    const annual_days = parseDays('annual_days');
    const sick_days = parseDays('sick_days');

    if (!bad) {
      filePnos.add(personnel_no);
      rows.push({
        full_name,
        personnel_no,
        hire_date: hire_date ?? null,
        department_code,
        manager_personnel_no: managerRaw || null,
        role: role as 'manager' | 'employee',
        job_title: get('job_title') || null,
        annual_days,
        sick_days,
      });
    }
  });

  return { rows, errors };
}
