/**
 * Clearance form (FR-54, فرم تسویه حساب) — pure model shared by the server
 * actions and the screens. The database is the authority (RPCs in
 * 20261007150002_clearance_form.sql); `canSignRow` / `canSignFinance` only decide
 * which buttons to show and mirror its rules.
 */

export const SEPARATION_REASONS = [
  'resignation',
  'dismissal',
  'contract_end',
  'abandonment',
  'redundancy',
] as const;
export type SeparationReason = (typeof SEPARATION_REASONS)[number];

export type SeparationStatus = 'in_progress' | 'awaiting_finance' | 'completed' | 'cancelled';

/** hr: any hr holder · department: its manager · own_department: the leaver's department manager · person: a named signer. */
export type UnitKind = 'hr' | 'department' | 'own_department' | 'person';

/** One row of the company's default list (`separation_units`). */
export type UnitRow = {
  id: string;
  kind: UnitKind;
  nameFa: string;
  nameEn: string;
  departmentId: string | null;
  signerId: string | null;
  sortOrder: number;
  active: boolean;
};

/** One row of a filed form (`separation_signoffs`), without its signature image. */
export type SignoffRow = {
  id: string;
  isHr: boolean;
  nameFa: string;
  nameEn: string;
  departmentId: string | null;
  signerId: string | null;
  signerName: string | null;
  sortOrder: number;
  signedBy: string | null;
  signedByName: string | null;
  signedAt: string | null;
  note: string | null;
};

/** A row being edited on the new-form or edit-rows screen. */
export type DraftRow = {
  key: string;
  /** The existing signoff row, when editing a filed form. */
  id?: string;
  isHr: boolean;
  nameFa: string;
  nameEn: string;
  departmentId: string | null;
  signerId: string | null;
  /** Signed rows are shown but locked. */
  signed: boolean;
};

export type Caller = { id: string; roles: readonly string[] };

const DEFAULT_HR_ROW = { nameFa: 'مدیر اداری و منابع انسانی', nameEn: 'HR & administration' };

export function isSeparationReason(value: unknown): value is SeparationReason {
  return typeof value === 'string' && (SEPARATION_REASONS as readonly string[]).includes(value);
}

/**
 * The rows a new form starts with: the HR row first (always present), then the
 * active units in order. Department rows are signed by that department's
 * manager (`departmentManagers` holds only active managers); the leaver is never
 * a signer, so such a row starts unassigned.
 */
export function draftRowsFromUnits(
  units: readonly UnitRow[],
  ctx: {
    leaverId: string;
    leaverDepartmentId: string | null;
    departmentManagers: ReadonlyMap<string, string | null>;
  }
): DraftRow[] {
  const sorted = [...units].sort((a, b) => a.sortOrder - b.sortOrder);
  const hr = sorted.find((u) => u.kind === 'hr');
  const notLeaver = (id: string | null) => (id && id !== ctx.leaverId ? id : null);

  const rows: DraftRow[] = [
    {
      key: hr?.id ?? 'hr',
      isHr: true,
      nameFa: hr?.nameFa ?? DEFAULT_HR_ROW.nameFa,
      nameEn: hr?.nameEn ?? DEFAULT_HR_ROW.nameEn,
      departmentId: null,
      signerId: null,
      signed: false,
    },
  ];

  for (const u of sorted) {
    if (u.kind === 'hr' || !u.active) continue;
    const departmentId =
      u.kind === 'own_department' ? ctx.leaverDepartmentId : u.kind === 'department' ? u.departmentId : null;
    const signerId =
      u.kind === 'person'
        ? notLeaver(u.signerId)
        : departmentId
          ? notLeaver(ctx.departmentManagers.get(departmentId) ?? null)
          : null;
    rows.push({
      key: u.id,
      isHr: false,
      nameFa: u.nameFa,
      nameEn: u.nameEn,
      departmentId,
      signerId,
      signed: false,
    });
  }
  return rows;
}

/** The `p_rows` payload of the create / set-rows RPCs. The HR row is never sent. */
export function rowsPayload(rows: readonly DraftRow[]): Array<{
  id?: string;
  name_fa: string;
  name_en: string;
  department_id?: string;
  signer_id?: string;
}> {
  return rows
    .filter((r) => !r.isHr)
    .map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      name_fa: r.nameFa.trim(),
      name_en: r.nameEn.trim(),
      ...(r.departmentId ? { department_id: r.departmentId } : {}),
      ...(r.signerId ? { signer_id: r.signerId } : {}),
    }));
}

export function canSignRow(
  row: SignoffRow,
  caller: Caller,
  leaverId: string,
  status: SeparationStatus
): boolean {
  if (status !== 'in_progress' || row.signedAt || caller.id === leaverId) return false;
  if (row.isHr) return caller.roles.includes('hr') || caller.roles.includes('admin');
  return row.signerId === caller.id;
}

export function canSignFinance(caller: Caller, leaverId: string, status: SeparationStatus): boolean {
  return status === 'awaiting_finance' && caller.id !== leaverId && caller.roles.includes('finance');
}
