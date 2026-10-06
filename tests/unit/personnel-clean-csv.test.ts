/**
 * The client's real personnel list (docs/files/Personnel_CLEAN.csv) through the
 * import validator — read-only, no database, nothing uploaded. Guards the file
 * and the validator together: the owner bulk-uploads this exact file.
 *
 * The file is client data and may not be committed; the suite skips when it is
 * absent (CI), rather than failing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/csv/parse';
import { validateImportRows } from '@/lib/csv/import-rows';

const file = join(__dirname, '../../docs/files/Personnel_CLEAN.csv');
const present = existsSync(file);
const result = validateImportRows(parseCsv(present ? readFileSync(file, 'utf8') : ''), {
  departments: [],
  existingEmployees: [],
  hoursPerDay: 8,
});
const dept = (code: string) => result.departments.find((d) => d.code === code);

describe.skipIf(!present)('Personnel_CLEAN.csv', () => {
  it('validates with no errors', () => {
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(138); // HR list of 2026-10-06 + the CEO
  });

  it('creates its 23 departments with the given codes', () => {
    expect(result.departments).toHaveLength(23);
    expect(result.departments.every((d) => d.create && !d.generated)).toBe(true);
  });

  it('gives every department the manager the file implies', () => {
    expect(dept('EPE')?.manager_personnel_no).toBe('100');
    expect(dept('RD')?.manager_personnel_no).toBe('185');
    expect(dept('ENGD')?.manager_personnel_no).toBe('185');
    expect(dept('WH')?.manager_personnel_no).toBe('128');
    expect(dept('MCH')?.manager_personnel_no).toBe('103');
    expect(dept('ADM')?.manager_personnel_no).toBe('124');
    expect(result.warnings.filter((w) => w.messageKey === 'bothSign')).toEqual([]);
    expect(result.warnings.filter((w) => w.messageKey === 'supervisorManagerMismatch')).toEqual([]);
  });

  it('puts the CEO first and every manager before their reports', () => {
    expect(result.rows[0].personnel_no).toBe('100');
    const seen = new Set<string>();
    for (const r of result.rows) {
      const boss = r.supervisor_personnel_no ?? r.manager_personnel_no;
      if (boss) expect(seen.has(boss)).toBe(true);
      seen.add(r.personnel_no);
    }
  });

  it('carries the 7 negative balances', () => {
    expect(result.rows.filter((r) => r.balance_minutes < 0)).toHaveLength(7);
  });
});
