import { buildCsv } from './parse';

/** Browser only: saves `rows` as a UTF-8 CSV (with BOM, see `buildCsv`) named `filename`. */
export function downloadCsv(rows: string[][], filename: string): void {
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Today as `YYYYMMDD` (UTC), for export file names. */
export function fileDateStamp(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10).replace(/-/g, '');
}
