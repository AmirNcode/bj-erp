/**
 * Minimal `.xlsx` reader and writer (FR-94 ledger import and its template).
 *
 * An .xlsx file is a zip of XML parts. This reads cell VALUES only (shared and
 * inline strings, numbers, booleans, error text) and writes plain cells. No
 * styles, dates-as-numbers, formulas or merged cells: the ledger keeps its dates
 * as typed Persian text, which is exactly what the importer wants.
 *
 * Runs in the browser, so an imported file never leaves the person's machine.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type Cell = string | number | null;
export type Sheet = { name: string; rows: Cell[][] };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(xml: string): string {
  return xml.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e];
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  });
}

function encode(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Every `<t>` run of a string item joined (plain text and rich text alike). */
function textOf(xml: string): string {
  // Phonetic guides (<rPh>) repeat the text in another script; skip them.
  const body = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decode(m[1] ?? '');
  return out;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
}

/** `BC12` → zero-based column index 54. */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function part(files: Record<string, Uint8Array>, path: string): string | null {
  const data = files[path.replace(/^\//, '')];
  return data ? strFromU8(data) : null;
}

function readSheet(xml: string, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  const data = xml.match(/<sheetData[^>]*>([\s\S]*?)<\/sheetData>/)?.[1] ?? '';
  let nextRow = 0;
  for (const rowMatch of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rowMatch[1], 'r'));
    const rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : nextRow;
    nextRow = rowIndex + 1;
    const cells: Cell[] = [];
    let nextCol = 0;
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cellMatch[1], 'r');
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      const type = attr(cellMatch[1], 't');
      const inner = cellMatch[2] ?? '';
      const raw = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
      let value: Cell = null;
      if (type === 'inlineStr') value = textOf(inner);
      else if (raw === undefined) value = null;
      else if (type === 's') value = shared[Number(raw)] ?? null;
      else if (type === 'str' || type === 'e') value = decode(raw);
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else {
        const n = Number(raw);
        value = Number.isFinite(n) ? n : decode(raw);
      }
      if (value === '') value = null;
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}

/** Sheets in workbook order. Throws `Error('not an xlsx file')` for anything else. */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('not an xlsx file');
  }
  const workbook = part(files, 'xl/workbook.xml');
  if (!workbook) throw new Error('not an xlsx file');

  const shared: string[] = [];
  const sst = part(files, 'xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(textOf(m[1] ?? ''));

  const targets = new Map<string, string>();
  const rels = part(files, 'xl/_rels/workbook.xml.rels') ?? '';
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }

  const sheets: Sheet[] = [];
  let n = 0;
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    n += 1;
    const name = attr(m[1], 'name') ?? `Sheet${n}`;
    const rid = attr(m[1], 'r:id');
    const xml = part(files, (rid && targets.get(rid)) || `xl/worksheets/sheet${n}.xml`);
    sheets.push({ name, rows: xml ? readSheet(xml, shared) : [] });
  }
  if (!sheets.length) throw new Error('not an xlsx file');
  return sheets;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** One-sheet workbook of plain cells (text as inline strings, numbers as numbers). */
export function writeXlsx(sheetName: string, rows: Cell[][]): Uint8Array {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          if (value === null || value === '') return '';
          const ref = `${columnName(c)}${r + 1}`;
          return typeof value === 'number' && Number.isFinite(value)
            ? `<c r="${ref}"><v>${value}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${encode(String(value))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const safeName = encode(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      `${HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>'
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `${HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
    ),
  };
  return zipSync(files);
}
