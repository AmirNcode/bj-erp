/**
 * Employee-import CSV v2 (FR-45): column spec, header matching, per-row
 * validation, department resolution, reporting-line sort and the department
 * manager each department gets.
 * Pure module (no Supabase / no React) — unit-testable and shared between
 * the import wizard (client) and its tests.
 *
 * Spec: docs/specs/2026-10-05-org-chart-and-personnel-import-design.md §2–§3.
 *
 * Dates go through `lib/leave/parseUserDate.ts`, shared with the holiday import:
 * Jalali (1404/04/22) or Gregorian (2025-07-13 or 2025/07/13), years < 1600 read
 * as Jalali, output always Gregorian ISO — dates in the DB are Gregorian and
 * Jalali is a presentation concern (CLAUDE.md).
 *
 * `app_bulk_create_employees` re-checks everything that matters for integrity
 * (references, codes, roles); this module exists so the uploader sees every
 * problem at once, per line, before anything is written.
 */

import { toAsciiDigits, isValidPersonnelNo } from '@/lib/employees/code';
import { parseUserDate } from '@/lib/leave/parseUserDate';
import {
  generateDepartmentCode,
  isValidDepartmentCode,
  normalizeDepartmentCode,
} from '@/lib/departments/code';

export type ImportColumnKey =
  | 'full_name'
  | 'personnel_no'
  | 'job_title'
  | 'role'
  | 'department_code'
  | 'department_name_fa'
  | 'department_name_en'
  | 'supervisor_personnel_no'
  | 'manager_personnel_no'
  | 'hire_date'
  | 'pto_days'
  | 'pto_hours';

export const IMPORT_COLUMNS: { key: ImportColumnKey; labelFa: string; required: boolean }[] = [
  { key: 'full_name', labelFa: 'نام کامل', required: true },
  { key: 'personnel_no', labelFa: 'شماره پرسنلی', required: true },
  { key: 'job_title', labelFa: 'عنوان شغلی', required: false },
  { key: 'role', labelFa: 'نقش', required: true },
  // Not a required COLUMN: a row may name its department instead (§3). Each row
  // still needs a code or a name — checked per row.
  { key: 'department_code', labelFa: 'کد بخش', required: false },
  { key: 'department_name_fa', labelFa: 'نام بخش', required: false },
  { key: 'department_name_en', labelFa: 'نام انگلیسی بخش', required: false },
  { key: 'supervisor_personnel_no', labelFa: 'شماره پرسنلی سرپرست', required: false },
  { key: 'manager_personnel_no', labelFa: 'شماره پرسنلی مدیر', required: false },
  { key: 'hire_date', labelFa: 'تاریخ استخدام', required: false },
  { key: 'pto_days', labelFa: 'مانده مرخصی (روز)', required: false },
  { key: 'pto_hours', labelFa: 'مانده مرخصی (ساعت)', required: false },
];

/** Template header cell: Farsi label with the latin key in parentheses. */
export function templateHeader(): string[] {
  return IMPORT_COLUMNS.map((c) => `${c.labelFa} (${c.key})`);
}

/**
 * How the file relates to what is already in the app (FR-49, spec
 * 2026-10-06-bulk-import-modes-design.md):
 * - `add`: create new people only; a personnel number already in the app is an error.
 * - `update`: also update people already in the app; the file overwrites the
 *   names and manager of every department it uses.
 * - `replace`: `update` plus clean-up of what the file does not mention
 *   (decided in lib/csv/import-plan.ts, not here).
 */
export type ImportMode = 'add' | 'update' | 'replace';

export type ImportRow = {
  /** 1-based CSV line number (header = line 1), for messages after sorting. */
  line: number;
  /** The personnel number is already in the app (only possible outside `add`). */
  existing: boolean;
  full_name: string;
  personnel_no: string;
  job_title: string | null;
  role: 'manager' | 'employee';
  /** Uppercase; an existing code, a code new in this file, or a generated one. */
  department_code: string;
  supervisor_personnel_no: string | null;
  manager_personnel_no: string | null;
  hire_date: string | null; // Gregorian ISO
  /** Signed remaining annual leave, in minutes. */
  balance_minutes: number;
};

export type ImportDepartment = {
  code: string;
  name_fa: string;
  name_en: string;
  /** True when the import creates this department. */
  create: boolean;
  /** True when the code was generated rather than given in the file. */
  generated: boolean;
  /** Set only when the import should assign this department's manager. */
  manager_personnel_no: string | null;
  /** The department's manager after the import (assigned or already there). */
  managerName: string | null;
  /** The department already has a different manager, which is kept (`add` only). */
  keptExistingManager: boolean;
  /** Existing department whose names the file changes (`update` / `replace`). */
  rename: boolean;
  /** Existing department whose manager the file changes (`update` / `replace`). */
  managerChange: boolean;
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
    | 'badDeptCode'
    | 'deptNamesRequired'
    | 'deptCodeConflict'
    | 'unknownSupervisor'
    | 'unknownManager'
    | 'refNotManager'
    | 'selfReference'
    | 'cycle'
    | 'badDate'
    | 'badRole'
    | 'badBalance'
    | 'mixedSign'
    | 'hoursTooLarge'
    | 'deptManagerTie';
};

export type RowWarning = {
  line: number;
  messageKey: 'supervisorManagerMismatch' | 'deptNamesDiffer' | 'deptManagerKept' | 'bothSign';
  params?: Record<string, string>;
};

export type ImportContext = {
  departments: {
    code: string;
    name_fa: string;
    name_en: string | null;
    /** personnel_no of the department's current manager, if any. */
    managerPersonnelNo: string | null;
    /**
     * Whether that manager's account is active. A deactivated manager counts as
     * NO manager (spec 2026-10-06 §5): the approval engine skips them, so keeping
     * them would leave the department without a second signer. Default true.
     */
    managerActive?: boolean;
  }[];
  existingEmployees: { personnelNo: string; fullName: string; isManager: boolean }[];
  hoursPerDay: number;
};

export type ImportResult = {
  /** Valid rows, ordered so every in-file manager precedes their reports. */
  rows: ImportRow[];
  departments: ImportDepartment[];
  errors: RowError[];
  warnings: RowWarning[];
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
 * undefined for unparseable — including a day that does not exist in its month.
 */
export const parseHireDate = parseUserDate;

/** '' → 0; signed integer (ASCII '-' or U+2212) → number; anything else → null. */
function parseSignedInt(raw: string): number | null {
  const cell = toAsciiDigits(raw.trim()).replace('−', '-');
  if (cell === '') return 0;
  if (!/^-?\d+$/.test(cell)) return null;
  const n = Number(cell);
  return n === 0 ? 0 : n; // never -0
}

type Draft = {
  line: number;
  bad: boolean;
  full_name: string;
  personnel_no: string;
  job_title: string | null;
  role: 'manager' | 'employee' | null;
  codeRaw: string;
  nameFa: string;
  nameEn: string;
  department_code: string;
  sup: string;
  mgr: string;
  hire_date: string | null;
  balance_minutes: number;
};

/**
 * Parses + validates a whole CSV file (already split into rows).
 * References may point anywhere in the file or at an existing employee; the
 * returned rows are sorted so the database can create managers first.
 */
export function validateImportRows(
  csvRows: string[][],
  ctx: ImportContext,
  mode: ImportMode = 'add'
): ImportResult {
  const fileWins = mode !== 'add';
  const errors: RowError[] = [];
  const warnings: RowWarning[] = [];
  const result = (rows: ImportRow[], departments: ImportDepartment[]): ImportResult => ({
    rows,
    departments,
    errors,
    warnings,
  });
  if (csvRows.length === 0) return result([], []);

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
  if (!colIndex.has('department_code') && !colIndex.has('department_name_fa') && !colIndex.has('department_name_en')) {
    errors.push({ line: 1, field: 'department_code', messageKey: 'missingColumn' });
  }
  if (errors.length > 0) return result([], []);

  const existingPnos = new Map(ctx.existingEmployees.map((e) => [e.personnelNo, e]));
  const minutesPerDay = Math.round(ctx.hoursPerDay * 60);

  // ── Pass 1: per-row fields ────────────────────────────────────────────────
  const seenPnos = new Set<string>();
  const drafts: Draft[] = csvRows.slice(1).map((raw, i) => {
    const line = i + 2;
    const get = (key: ImportColumnKey) => {
      const idx = colIndex.get(key);
      return idx === undefined ? '' : (raw[idx] ?? '').trim();
    };
    const d: Draft = {
      line,
      bad: false,
      full_name: get('full_name'),
      personnel_no: toAsciiDigits(get('personnel_no')),
      job_title: get('job_title') || null,
      role: null,
      codeRaw: get('department_code'),
      nameFa: get('department_name_fa'),
      nameEn: get('department_name_en'),
      department_code: '',
      sup: toAsciiDigits(get('supervisor_personnel_no')),
      mgr: toAsciiDigits(get('manager_personnel_no')),
      hire_date: null,
      balance_minutes: 0,
    };
    const fail = (field: RowError['field'], messageKey: RowError['messageKey']) => {
      errors.push({ line, field, messageKey });
      d.bad = true;
    };

    if (!d.full_name) fail('full_name', 'required');

    if (!d.personnel_no) fail('personnel_no', 'required');
    else if (!isValidPersonnelNo(d.personnel_no)) fail('personnel_no', 'badPersonnelNo');
    else if (seenPnos.has(d.personnel_no)) fail('personnel_no', 'dupInFile');
    else if (mode === 'add' && existingPnos.has(d.personnel_no)) fail('personnel_no', 'dupExisting');
    if (d.personnel_no) seenPnos.add(d.personnel_no);

    const role = get('role').toLowerCase();
    if (role === 'manager' || role === 'employee') d.role = role;
    else fail('role', 'badRole');

    const hire = parseHireDate(get('hire_date'));
    if (hire === undefined) fail('hire_date', 'badDate');
    else d.hire_date = hire;

    if (d.sup && d.sup === d.personnel_no) fail('supervisor_personnel_no', 'selfReference');
    if (d.mgr && d.mgr === d.personnel_no) fail('manager_personnel_no', 'selfReference');

    const days = parseSignedInt(get('pto_days'));
    const hours = parseSignedInt(get('pto_hours'));
    if (days === null || Math.abs(days) > 366) fail('pto_days', 'badBalance');
    else if (hours === null) fail('pto_hours', 'badBalance');
    else if (Math.abs(hours) >= ctx.hoursPerDay) fail('pto_hours', 'hoursTooLarge');
    else if ((days > 0 && hours < 0) || (days < 0 && hours > 0)) fail('pto_hours', 'mixedSign');
    else d.balance_minutes = days * minutesPerDay + hours * 60;

    return d;
  });

  // ── Pass 2: departments ───────────────────────────────────────────────────
  type NewDept = { name_fa: string; name_en: string; generated: boolean };
  const existingByCode = new Map(ctx.departments.map((dep) => [normalizeDepartmentCode(dep.code), dep]));
  const existingByFa = new Map(ctx.departments.map((dep) => [dep.name_fa.trim(), normalizeDepartmentCode(dep.code)]));
  const existingByEn = new Map(
    ctx.departments
      .filter((dep) => dep.name_en)
      .map((dep) => [dep.name_en!.trim().toLowerCase(), normalizeDepartmentCode(dep.code)])
  );
  const newDepts = new Map<string, NewDept>();
  const newByFa = new Map<string, string>();
  const newByEn = new Map<string, string>();
  const namesDifferWarned = new Set<string>();
  // Generated codes must not collide with a code some LATER row gives explicitly.
  const taken = new Set<string>(existingByCode.keys());
  for (const d of drafts) {
    const c = normalizeDepartmentCode(d.codeRaw);
    if (isValidDepartmentCode(c)) taken.add(c);
  }
  const registerNew = (code: string, def: NewDept) => {
    newDepts.set(code, def);
    newByFa.set(def.name_fa, code);
    newByEn.set(def.name_en.toLowerCase(), code);
  };
  const matchByName = (fa: string, en: string): string =>
    (fa && existingByFa.get(fa)) ||
    (en && existingByEn.get(en.toLowerCase())) ||
    (fa && newByFa.get(fa)) ||
    (en && newByEn.get(en.toLowerCase())) ||
    '';

  // 2a. Definitions first, from EVERY row that names a new department, so a row
  // may use a code (or a name) that a later row defines — rows are in any order.
  // An explicit code claims its names before generated codes are handed out.
  for (const d of drafts) {
    const code = normalizeDepartmentCode(d.codeRaw);
    if (code && isValidDepartmentCode(code) && !existingByCode.has(code) && !newDepts.has(code) && d.nameFa && d.nameEn) {
      registerNew(code, { name_fa: d.nameFa, name_en: d.nameEn, generated: false });
    }
  }
  for (const d of drafts) {
    if (normalizeDepartmentCode(d.codeRaw) || !d.nameFa || !d.nameEn || matchByName(d.nameFa, d.nameEn)) continue;
    const generated = generateDepartmentCode(d.nameEn, taken);
    taken.add(generated);
    registerNew(generated, { name_fa: d.nameFa, name_en: d.nameEn, generated: true });
  }

  // 2b. Resolve each row against existing and newly defined departments.
  for (const d of drafts) {
    const fail = (field: RowError['field'], messageKey: RowError['messageKey']) => {
      errors.push({ line: d.line, field, messageKey });
      d.bad = true;
    };
    const code = normalizeDepartmentCode(d.codeRaw);
    if (code) {
      if (!isValidDepartmentCode(code)) {
        fail('department_code', 'badDeptCode');
        continue;
      }
      const ex = existingByCode.get(code);
      if (ex) {
        const differs =
          (d.nameFa && d.nameFa !== ex.name_fa.trim()) ||
          (d.nameEn && d.nameEn.toLowerCase() !== (ex.name_en ?? '').trim().toLowerCase());
        // Outside `add` the file's names win (ImportDepartment.rename), so it is not a warning.
        if (differs && !fileWins && !namesDifferWarned.has(code)) {
          namesDifferWarned.add(code);
          warnings.push({ line: d.line, messageKey: 'deptNamesDiffer', params: { code } });
        }
      } else if (newDepts.has(code)) {
        const def = newDepts.get(code)!;
        if ((d.nameFa && d.nameFa !== def.name_fa) || (d.nameEn && d.nameEn !== def.name_en)) {
          fail('department_code', 'deptCodeConflict');
          continue;
        }
      } else {
        fail('department_code', 'deptNamesRequired');
        continue;
      }
      d.department_code = code;
    } else if (d.nameFa || d.nameEn) {
      const match = matchByName(d.nameFa, d.nameEn);
      if (match) d.department_code = match;
      else fail('department_code', 'deptNamesRequired');
    } else {
      fail('department_code', 'required');
    }
  }

  // ── Pass 3: references ────────────────────────────────────────────────────
  const byPno = new Map<string, Draft>();
  for (const d of drafts) {
    if (d.personnel_no && !byPno.has(d.personnel_no)) byPno.set(d.personnel_no, d);
  }
  const nameOf = (pno: string) => byPno.get(pno)?.full_name ?? existingPnos.get(pno)?.fullName ?? pno;
  const holdsManager = (pno: string) =>
    byPno.get(pno)?.role === 'manager' || existingPnos.get(pno)?.isManager === true;

  for (const d of drafts) {
    const refs: [string, 'supervisor_personnel_no' | 'manager_personnel_no', RowError['messageKey']][] = [
      [d.sup, 'supervisor_personnel_no', 'unknownSupervisor'],
      [d.mgr, 'manager_personnel_no', 'unknownManager'],
    ];
    for (const [ref, field, unknownKey] of refs) {
      if (!ref || ref === d.personnel_no) continue; // self already reported
      if (!byPno.has(ref) && !existingPnos.has(ref)) {
        errors.push({ line: d.line, field, messageKey: unknownKey });
        d.bad = true;
      } else if (!holdsManager(ref)) {
        errors.push({ line: d.line, field, messageKey: 'refNotManager' });
        d.bad = true;
      }
    }
  }

  // Cycles among in-file reporting lines (effective manager = supervisor ?? manager).
  const eff = (d: Draft) => d.sup || d.mgr;
  const state = new Map<Draft, 'visiting' | 'done'>();
  const inCycle = new Set<Draft>();
  const visit = (d: Draft, path: Draft[]) => {
    const s = state.get(d);
    if (s === 'done') return;
    if (s === 'visiting') {
      for (const n of path.slice(path.indexOf(d))) inCycle.add(n);
      return;
    }
    state.set(d, 'visiting');
    const parent = eff(d) ? byPno.get(eff(d)) : undefined;
    if (parent && parent !== d) visit(parent, [...path, d]);
    state.set(d, 'done');
  };
  for (const d of drafts) visit(d, []);
  for (const d of drafts) {
    if (inCycle.has(d)) {
      errors.push({ line: d.line, field: 'row', messageKey: 'cycle' });
      d.bad = true;
    }
  }

  // Supervisor should report to the same manager as their team.
  for (const d of drafts) {
    const sup = d.sup ? byPno.get(d.sup) : undefined;
    if (sup && sup.mgr && d.mgr && sup.mgr !== d.mgr) {
      warnings.push({
        line: d.line,
        messageKey: 'supervisorManagerMismatch',
        params: { supervisor: sup.full_name, manager: nameOf(d.mgr) },
      });
    }
  }

  // ── Department managers ───────────────────────────────────────────────────
  const heads = new Set(drafts.map((d) => d.mgr).filter(Boolean));
  const codesInFile: string[] = [];
  for (const d of drafts) {
    if (d.department_code && !codesInFile.includes(d.department_code)) codesInFile.push(d.department_code);
  }
  const effectiveDeptManager = new Map<string, string | null>();
  const departments: ImportDepartment[] = codesInFile.map((code) => {
    const members = drafts.filter((d) => d.department_code === code);
    const tally = (list: Draft[]) => {
      const counts = new Map<string, number>();
      for (const m of list) if (m.mgr) counts.set(m.mgr, (counts.get(m.mgr) ?? 0) + 1);
      return counts;
    };
    let counts = tally(members.filter((m) => !heads.has(m.personnel_no)));
    if (counts.size === 0) counts = tally(members);
    let derived: string | null = null;
    if (counts.size > 0) {
      const max = Math.max(...counts.values());
      const top = [...counts.entries()].filter(([, n]) => n === max).map(([pno]) => pno);
      if (top.length > 1) {
        errors.push({ line: members[0].line, field: 'manager_personnel_no', messageKey: 'deptManagerTie' });
        for (const m of members) m.bad = true;
      } else {
        derived = top[0];
      }
    }

    const ex = existingByCode.get(code);
    const current = ex && ex.managerActive !== false ? ex.managerPersonnelNo : null;
    let assign: string | null = null;
    let kept = false;
    if (current && derived && current !== derived) {
      if (fileWins) {
        assign = derived;
      } else {
        kept = true;
        warnings.push({ line: members[0].line, messageKey: 'deptManagerKept', params: { code } });
      }
    } else if (!current && derived) {
      assign = derived;
    }
    const finalManager = assign ?? current ?? derived;
    effectiveDeptManager.set(code, finalManager);

    // The file's names for this department: the first member row that gives them.
    const named = members.find((m) => m.nameFa && m.nameEn);
    const rename =
      fileWins &&
      !!ex &&
      !!named &&
      (named.nameFa !== ex.name_fa.trim() || named.nameEn !== (ex.name_en ?? '').trim());

    const def = newDepts.get(code);
    return {
      code,
      name_fa: rename ? named!.nameFa : (ex?.name_fa ?? def?.name_fa ?? ''),
      name_en: rename ? named!.nameEn : (ex?.name_en ?? def?.name_en ?? ''),
      create: !ex,
      generated: def?.generated ?? false,
      manager_personnel_no: assign,
      managerName: finalManager ? nameOf(finalManager) : null,
      keptExistingManager: kept,
      rename,
      managerChange: !!ex && !!assign && !!ex.managerPersonnelNo && assign !== ex.managerPersonnelNo,
    };
  });

  // Someone other than the file's supervisor/manager would sign (FR-47 rule).
  for (const d of drafts) {
    const dm = effectiveDeptManager.get(d.department_code);
    if (dm && dm !== d.personnel_no && dm !== eff(d) && dm !== d.mgr) {
      warnings.push({ line: d.line, messageKey: 'bothSign', params: { departmentManager: nameOf(dm) } });
    }
  }

  // ── Sort valid rows: in-file managers first ───────────────────────────────
  const good = drafts.filter((d) => !d.bad);
  const goodSet = new Set(good);
  const emitted = new Set<Draft>();
  const ordered: Draft[] = [];
  const emit = (d: Draft) => {
    if (emitted.has(d)) return;
    emitted.add(d);
    const parent = eff(d) ? byPno.get(eff(d)) : undefined;
    if (parent && parent !== d && goodSet.has(parent)) emit(parent);
    ordered.push(d);
  };
  for (const d of good) emit(d);

  const rows: ImportRow[] = ordered.map((d) => ({
    line: d.line,
    existing: existingPnos.has(d.personnel_no),
    full_name: d.full_name,
    personnel_no: d.personnel_no,
    job_title: d.job_title,
    role: d.role as 'manager' | 'employee',
    department_code: d.department_code,
    supervisor_personnel_no: d.sup || null,
    manager_personnel_no: d.mgr || null,
    hire_date: d.hire_date,
    balance_minutes: d.balance_minutes,
  }));

  errors.sort((a, b) => a.line - b.line);
  warnings.sort((a, b) => a.line - b.line);
  return result(rows, departments);
}
