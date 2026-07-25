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
  return rows;
}

/**
 * Builds CSV text with a UTF-8 BOM and CRLF line ends — without the BOM,
 * Excel renders Farsi text as mojibake.
 */
export function buildCsv(rows: string[][]): string {
  const escape = (f: string) =>
    /[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f;
  return '﻿' + rows.map((r) => r.map(escape).join(',')).join('\r\n') + '\r\n';
}
