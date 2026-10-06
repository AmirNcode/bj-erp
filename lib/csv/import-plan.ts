/**
 * Bulk import plan (FR-49). Pure — no Supabase, no React.
 *
 * Turns the validator's result, the app's current state and the uploader's
 * choices into an explicit plan the wizard shows and the database executes:
 * creates, updates, reactivations, people the file leaves out, deactivations,
 * manager reassignments, department deletions, and the conflicts that must be
 * answered before importing.
 *
 * Spec: docs/specs/2026-10-06-bulk-import-modes-design.md. The SQL
 * (`app_bulk_import_employees`) re-checks every invariant; this module decides
 * WHAT to ask and shows the consequence before anything is written.
 */

import type { ImportDepartment, ImportMode, ImportResult, ImportRow } from '@/lib/csv/import-rows';
import { normalizeFaName } from '@/lib/org/tree';

export type ExistingEmployee = {
  id: string;
  personnelNo: string | null;
  fullName: string;
  active: boolean;
  isAdmin: boolean;
  isManager: boolean;
  managerId: string | null;
  departmentCode: string | null;
  /** Pending leave/errand requests — whose signers may change (O3). */
  pendingRequests: number;
};

export type ExistingDepartment = {
  code: string;
  managerPersonnelNo: string | null;
  /** Profiles in the department, active or not. */
  memberCount: number;
};

export type MissingDecision = 'deactivate' | 'keep';

export type ConflictKind = 'sameName' | 'managerDeactivated' | 'deptManagerReplaced';

export type ConflictOption =
  | 'deactivateOld'
  | 'keepBoth'
  | 'deactivateToo'
  | 'noManager'
  | 'pickManager'
  | 'fileReplaces'
  | 'keepAsManager';

export const CONFLICT_OPTIONS: Record<ConflictKind, ConflictOption[]> = {
  sameName: ['deactivateOld', 'keepBoth'],
  managerDeactivated: ['deactivateToo', 'noManager', 'pickManager'],
  deptManagerReplaced: ['fileReplaces', 'keepAsManager'],
};

export type Conflict = {
  /** `${kind}:${personId}` — stable key for the uploader's answer. */
  id: string;
  kind: ConflictKind;
  personId: string;
  personName: string;
  params: Record<string, string>;
  options: ConflictOption[];
  /** The uploader's answer, if given and still valid. */
  choice: ConflictOption | null;
};

export type ImportChoices = {
  missingDefault: MissingDecision;
  /** Per-person override of `missingDefault`, by profile id. */
  overrides: Record<string, MissingDecision>;
  /** Conflict answers by conflict id. */
  resolutions: Record<string, ConflictOption>;
  /** For `pickManager`: the chosen manager's personnel number, by conflict id. */
  pickedManagers: Record<string, string>;
  overwriteBalances: boolean;
};

export const DEFAULT_CHOICES: ImportChoices = {
  missingDefault: 'deactivate',
  overrides: {},
  resolutions: {},
  pickedManagers: {},
  overwriteBalances: false,
};

export type MissingPerson = {
  id: string;
  fullName: string;
  personnelNo: string | null;
  decision: MissingDecision;
  overridden: boolean;
};

export type ImportPlan = {
  mode: ImportMode;
  creates: ImportRow[];
  updates: ImportRow[];
  /** Existing inactive people in the file — reactivated (O1). */
  reactivations: ImportRow[];
  /** Active, non-admin people the file leaves out (`replace` only). */
  missing: MissingPerson[];
  /** Profile ids to deactivate. */
  deactivate: string[];
  /** Kept people whose manager changes: null = no manager. */
  reassign: { id: string; managerPersonnelNo: string | null }[];
  /** Departments to send to the database, conflict answers applied. */
  departments: ImportDepartment[];
  /** Unused, empty departments deleted (`replace`). */
  deleteDepartments: string[];
  /** Unused departments kept because people (active or not) are still in them. */
  keptDepartments: string[];
  conflicts: Conflict[];
  /** File rows holding the manager role — offered by `pickManager` (O2). */
  managerCandidates: { personnelNo: string; fullName: string }[];
  /** Pending requests whose signers may change (O3). */
  pendingSignerChanges: number;
  /** Every conflict answered (and every `pickManager` has a person). */
  ready: boolean;
};

export function buildImportPlan(input: {
  result: ImportResult;
  mode: ImportMode;
  employees: ExistingEmployee[];
  departments: ExistingDepartment[];
  choices: ImportChoices;
}): ImportPlan {
  const { result, mode, employees, departments, choices } = input;
  const byPno = new Map(employees.filter((e) => e.personnelNo).map((e) => [e.personnelNo!, e]));
  const byId = new Map(employees.map((e) => [e.id, e]));

  const creates = result.rows.filter((r) => !r.existing);
  const updates = result.rows.filter((r) => r.existing);
  const reactivations = updates.filter((r) => byPno.get(r.personnel_no)?.active === false);

  const filePnos = new Set(result.rows.map((r) => r.personnel_no));
  const fileNames = new Map(result.rows.map((r) => [normalizeFaName(r.full_name), r]));
  const managerCandidates = result.rows
    .filter((r) => r.role === 'manager')
    .map((r) => ({ personnelNo: r.personnel_no, fullName: r.full_name }));
  const candidatePnos = new Set(managerCandidates.map((c) => c.personnelNo));

  // ── People the file leaves out (replace only) ─────────────────────────────
  const missing: MissingPerson[] =
    mode === 'replace'
      ? employees
          .filter((e) => e.active && !e.isAdmin && !(e.personnelNo && filePnos.has(e.personnelNo)))
          .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'))
          .map((e) => {
            const override = choices.overrides[e.id];
            return {
              id: e.id,
              fullName: e.fullName,
              personnelNo: e.personnelNo,
              decision: override ?? choices.missingDefault,
              overridden: override !== undefined && override !== choices.missingDefault,
            };
          })
      : [];

  // Departments whose manager the file changes: code → the file's new manager.
  const fileDeptManager = new Map(
    result.departments.filter((d) => d.manager_personnel_no).map((d) => [d.code, d.manager_personnel_no!])
  );
  const currentDeptManagerOf = new Map<string, string>(); // person pno → dept code
  for (const d of departments) {
    if (d.managerPersonnelNo) currentDeptManagerOf.set(d.managerPersonnelNo, d.code);
  }

  // ── Conflicts for kept people, to a fixed point ───────────────────────────
  // Deactivating someone (by default or by an answer) can create a conflict for
  // the people who report to them, so re-run until nothing changes.
  const deactivated = new Set(missing.filter((m) => m.decision === 'deactivate').map((m) => m.id));
  let conflicts: Conflict[] = [];
  for (let pass = 0; pass < employees.length + 2; pass++) {
    const before = deactivated.size;
    conflicts = [];
    for (const m of missing) {
      if (deactivated.has(m.id)) continue;
      const person = byId.get(m.id)!;
      const add = (kind: ConflictKind, params: Record<string, string>) => {
        const id = `${kind}:${m.id}`;
        const answer = choices.resolutions[id];
        const options = CONFLICT_OPTIONS[kind];
        conflicts.push({
          id,
          kind,
          personId: m.id,
          personName: m.fullName,
          params,
          options,
          choice: answer && options.includes(answer) ? answer : null,
        });
      };

      const twin = fileNames.get(normalizeFaName(person.fullName));
      if (twin) add('sameName', { personnelNo: twin.personnel_no, oldPersonnelNo: person.personnelNo ?? '—' });

      const boss = person.managerId ? byId.get(person.managerId) : undefined;
      if (boss && (!boss.active || deactivated.has(boss.id))) add('managerDeactivated', { manager: boss.fullName });

      const managesCode = person.personnelNo ? currentDeptManagerOf.get(person.personnelNo) : undefined;
      const fileManager = managesCode ? fileDeptManager.get(managesCode) : undefined;
      if (managesCode && fileManager && fileManager !== person.personnelNo) {
        add('deptManagerReplaced', {
          code: managesCode,
          newManager: result.rows.find((r) => r.personnel_no === fileManager)?.full_name ?? fileManager,
        });
      }
    }
    for (const c of conflicts) {
      if (c.choice === 'deactivateOld' || c.choice === 'deactivateToo') deactivated.add(c.personId);
    }
    if (deactivated.size === before) break;
  }
  // A person deactivated by one answer no longer has other open conflicts.
  conflicts = conflicts.filter((c) => !deactivated.has(c.personId) || c.choice === 'deactivateOld' || c.choice === 'deactivateToo');

  const reassign: ImportPlan['reassign'] = [];
  const keepDeptManagerCodes = new Set<string>();
  for (const c of conflicts) {
    if (deactivated.has(c.personId)) continue;
    if (c.choice === 'noManager') reassign.push({ id: c.personId, managerPersonnelNo: null });
    if (c.choice === 'pickManager') {
      const picked = choices.pickedManagers[c.id];
      if (picked && candidatePnos.has(picked)) reassign.push({ id: c.personId, managerPersonnelNo: picked });
    }
    if (c.choice === 'keepAsManager') keepDeptManagerCodes.add(c.params.code);
  }

  const deptOut = result.departments.map((d) =>
    keepDeptManagerCodes.has(d.code) ? { ...d, manager_personnel_no: null, managerChange: false } : d
  );

  // ── Departments the file does not use (replace) ───────────────────────────
  const usedCodes = new Set(result.departments.map((d) => d.code));
  const deleteDepartments: string[] = [];
  const keptDepartments: string[] = [];
  if (mode === 'replace') {
    for (const d of departments) {
      if (usedCodes.has(d.code)) continue;
      (d.memberCount === 0 ? deleteDepartments : keptDepartments).push(d.code);
    }
  }

  // ── Pending requests whose signers may change (O3) ────────────────────────
  const changedDeptManager = new Set(deptOut.filter((d) => d.managerChange).map((d) => d.code));
  const affected = new Set<string>();
  for (const r of updates) {
    const e = byPno.get(r.personnel_no)!;
    const newBossPno = r.supervisor_personnel_no ?? r.manager_personnel_no;
    const oldBossPno = e.managerId ? byId.get(e.managerId)?.personnelNo ?? null : null;
    if (newBossPno !== oldBossPno || r.department_code !== e.departmentCode || changedDeptManager.has(r.department_code)) {
      affected.add(e.id);
    }
  }
  for (const a of reassign) affected.add(a.id);
  for (const e of employees) {
    if (e.active && e.departmentCode && changedDeptManager.has(e.departmentCode) && !deactivated.has(e.id)) affected.add(e.id);
  }
  const pendingSignerChanges = [...affected].reduce((n, id) => n + (byId.get(id)?.pendingRequests ?? 0), 0);

  const ready = conflicts.every(
    (c) => c.choice !== null && (c.choice !== 'pickManager' || candidatePnos.has(choices.pickedManagers[c.id] ?? ''))
  );

  return {
    mode,
    creates,
    updates,
    reactivations,
    missing,
    deactivate: [...deactivated],
    reassign,
    departments: deptOut,
    deleteDepartments,
    keptDepartments,
    conflicts,
    managerCandidates,
    pendingSignerChanges,
    ready,
  };
}
