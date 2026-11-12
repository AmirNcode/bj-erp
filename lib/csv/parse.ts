/**
 * Minimal RFC-4180 CSV reader/writer for the employee import/export flows.
 * Hand-rolled on purpose: the only CSVs handled are our own template and
 * Excel's output of it — quoted fields, `""` escapes, CRLF, and a UTF-8 BOM.
 */

/** Parses CSV text into rows of fields. Skips rows that are entirely empty. */
export function parseCsv(text: string): string[][] {
  // Excel-on-Windows prepends a BOM; strip it or the first header is wrong.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  // Undo the formula guard `buildCsv` adds, so an exported file re-imports unchanged.
  return rows.map((r) => r.map((f) => (/^'[=+\-@\t\r]/.test(f) ? f.slice(1) : f)));
}

/**
 * CSV/formula injection guard: a cell that Excel or Sheets would read as a formula
 * (starts with = + @ tab or CR, or with - when it is not a plain number) gets a leading
 * single quote, which spreadsheets show as text. `parseCsv` strips it again.
 */
export function guardCsvCell(value: string): string {
  if (/^[=+@\t\r]/.test(value)) return `'${value}`;
  if (value.startsWith('-') && !/^-?\d+(\.\d+)?$/.test(value)) return `'${value}`;
  return value;
}

/**
 * Builds CSV text with a UTF-8 BOM and CRLF line ends — without the BOM,
 * Excel renders Farsi text as mojibake. Cells that could run as formulas are guarded
 * (`guardCsvCell`); pass `{ guard: false }` only for machine-generated values that must
 * stay byte-exact (generated passwords).
 */
export function buildCsv(rows: string[][], opts: { guard?: boolean } = {}): string {
  const guard = opts.guard ?? true;
  const escape = (raw: string) => {
    const f = guard ? guardCsvCell(raw) : raw;
    return /[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f;
  };
  return '﻿' + rows.map((r) => r.map(escape).join(',')).join('\r\n') + '\r\n';
}
