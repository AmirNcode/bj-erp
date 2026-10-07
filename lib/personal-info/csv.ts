/**
 * Personal-info CSV (FR-53): export rows and import validation.
 *
 * Same header style as the roster import (`Farsi label (key)`), and the export
 * uses exactly the import header, so export → edit in Excel → import round-trips.
 * Choice cells are written as Farsi words and read back as either the Farsi word
 * or the latin key. An empty cell means "leave unchanged" on import.
 * Pure module, unit-tested.
 */

import { normalizePersonnelNo, isValidPersonnelNo } from '@/lib/employees/code';
import {
  PERSONAL_INFO_FIELDS,
  fieldToInput,
  parseFieldInput,
  type FieldProblem,
  type PersonalInfoKey,
} from './fields';

/** Farsi words for choice values, used in CSV cells (the UI uses next-intl). */
export const CHOICE_LABELS_FA: Record<string, string> = {
  male: 'مرد',
  female: 'زن',
  single: 'مجرد',
  married: 'متاهل',
  below_diploma: 'زیر دیپلم',
  diploma: 'دیپلم',
  associate: 'کاردانی',
  bachelor: 'کارشناسی',
  master: 'کارشناسی ارشد',
  doctorate: 'دکتری',
  completed: 'پایان خدمت',
  exempt: 'معافیت دائم',
  educational_exempt: 'معافیت تحصیلی',
  eligible: 'مشمول',
  not_applicable: 'غیرمشمول',
};

const KEY_BY_FA_LABEL = new Map(Object.entries(CHOICE_LABELS_FA).map(([k, fa]) => [fa, k]));

type CsvColumnKey = 'personnel_no' | 'full_name' | PersonalInfoKey;

const COLUMNS: { key: CsvColumnKey; labelFa: string }[] = [
  { key: 'personnel_no', labelFa: 'شماره پرسنلی' },
  { key: 'full_name', labelFa: 'نام کامل' },
  ...PERSONAL_INFO_FIELDS.map((f) => ({ key: f.key, labelFa: f.labelFa })),
];

export function personalInfoHeader(): string[] {
  return COLUMNS.map((c) => `${c.labelFa} (${c.key})`);
}

/** One exported row (from app_export_personal_info) → CSV cells in header order. */
export function personalInfoCsvRow(
  row: { personnel_no: string | null; full_name: string } & Record<PersonalInfoKey, string | number | null>
): string[] {
  return COLUMNS.map((c) => {
    if (c.key === 'personnel_no') return row.personnel_no ?? '';
    if (c.key === 'full_name') return row.full_name;
    const field = PERSONAL_INFO_FIELDS.find((f) => f.key === c.key)!;
    const text = fieldToInput(field, row[c.key]);
    return field.kind === 'choice' ? (CHOICE_LABELS_FA[text] ?? text) : text;
  });
}

function matchColumn(cell: string): CsvColumnKey | null {
  const c = cell.replace(/^﻿/, '').trim().toLowerCase();
  for (const col of COLUMNS) {
    if (c === col.key || c.includes(`(${col.key})`) || c === col.labelFa) return col.key;
  }
  return null;
}

export type PersonalInfoImportRow = { personnel_no: string } & Partial<
  Record<PersonalInfoKey, string | number>
>;

export type PersonalInfoImportError = {
  line: number;
  field: CsvColumnKey | null;
  problem: FieldProblem | 'missingColumn' | 'personnelNo' | 'unknownEmployee' | 'duplicate' | 'empty';
  value?: string;
};

/**
 * Validates a parsed CSV (first row = header). `knownPersonnelNos` are the
 * company's personnel numbers the caller may edit; anything else is an error
 * here, and again in app_import_personal_info.
 */
export function validatePersonalInfoCsv(
  csvRows: string[][],
  knownPersonnelNos: Set<string>
): { rows: PersonalInfoImportRow[]; errors: PersonalInfoImportError[] } {
  const errors: PersonalInfoImportError[] = [];
  const rows: PersonalInfoImportRow[] = [];
  if (csvRows.length < 2) {
    errors.push({ line: 1, field: null, problem: 'empty' });
    return { rows, errors };
  }

  const colIndex = new Map<CsvColumnKey, number>();
  csvRows[0].forEach((cell, i) => {
    const key = matchColumn(cell);
    if (key !== null && !colIndex.has(key)) colIndex.set(key, i);
  });
  if (!colIndex.has('personnel_no')) {
    errors.push({ line: 1, field: 'personnel_no', problem: 'missingColumn' });
    return { rows, errors };
  }

  const seen = new Set<string>();
  csvRows.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    if (cells.every((c) => c.trim() === '')) return;
    const pno = normalizePersonnelNo(cells[colIndex.get('personnel_no')!] ?? '');
    if (!isValidPersonnelNo(pno)) {
      errors.push({ line, field: 'personnel_no', problem: 'personnelNo', value: pno });
      return;
    }
    if (seen.has(pno)) {
      errors.push({ line, field: 'personnel_no', problem: 'duplicate', value: pno });
      return;
    }
    seen.add(pno);
    if (!knownPersonnelNos.has(pno)) {
      errors.push({ line, field: 'personnel_no', problem: 'unknownEmployee', value: pno });
      return;
    }

    const row: PersonalInfoImportRow = { personnel_no: pno };
    let bad = false;
    for (const field of PERSONAL_INFO_FIELDS) {
      const i = colIndex.get(field.key);
      if (i === undefined) continue;
      let raw = (cells[i] ?? '').trim();
      if (field.kind === 'choice') raw = KEY_BY_FA_LABEL.get(raw) ?? raw.toLowerCase();
      const res = parseFieldInput(field, raw);
      if (!res.ok) {
        errors.push({ line, field: field.key, problem: res.problem, value: cells[i] });
        bad = true;
      } else if (res.value !== null) {
        row[field.key] = res.value;
      }
    }
    if (!bad && Object.keys(row).length > 1) rows.push(row);
  });

  return { rows, errors };
}
