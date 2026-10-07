'use server';

/**
 * Clearance form (FR-54, فرم تسویه حساب). Every write is one RPC from
 * 20261007150002_clearance_form.sql, which re-checks permission and state; reads
 * go through `app_list_separations` / `app_get_separation` (names included, only
 * the forms the caller may read) or RLS on the tables.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { isValidSignatureData } from '@/lib/leave/signature';
import {
  isSeparationReason,
  rowsPayload,
  type DraftRow,
  type SeparationReason,
  type SeparationStatus,
  type SignoffRow,
  type UnitKind,
  type UnitRow,
} from '@/lib/clearance/model';

type Fail = { ok: false; error: string };
type Done = { ok: true } | Fail;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MANAGE_ROLES = ['admin', 'hr'];
const VIEW_ROLES = ['admin', 'hr', 'finance'];

export type ClearanceListItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  personnelNo: string | null;
  departmentNameFa: string | null;
  departmentNameEn: string | null;
  status: SeparationStatus;
  reason: SeparationReason;
  lastWorkingDay: string;
  deactivated: boolean;
  createdAt: string;
  rowsTotal: number;
  rowsSigned: number;
  awaitingMe: boolean;
};

export type ClearanceOverview = {
  ok: true;
  awaiting: ClearanceListItem[];
  /** The caller's own form (as the leaver), newest first. */
  mine: ClearanceListItem[];
  /** Everything else the caller may read: all forms for admin/hr/finance, otherwise the ones they sign. */
  others: ClearanceListItem[];
  canManage: boolean;
  canViewAll: boolean;
};

async function listForms(): Promise<{ ok: true; userId: string; roles: string[]; items: ClearanceListItem[] } | Fail> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_list_separations');
  if (error) return dbErr(error.message);
  return {
    ok: true,
    userId: c.user.id,
    roles: c.roles,
    items: (data ?? []).map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      personnelNo: r.personnel_no,
      departmentNameFa: r.department_name_fa,
      departmentNameEn: r.department_name_en,
      status: r.status as SeparationStatus,
      reason: r.reason as SeparationReason,
      lastWorkingDay: r.last_working_day,
      deactivated: !!r.deactivated_at,
      createdAt: r.created_at,
      rowsTotal: r.rows_total,
      rowsSigned: r.rows_signed,
      awaitingMe: r.awaiting_me,
    })),
  };
}

export async function getClearanceOverview(): Promise<ClearanceOverview | Fail> {
  const res = await listForms();
  if (!res.ok) return res;
  const { userId, roles, items } = res;
  return {
    ok: true,
    awaiting: items.filter((f) => f.awaitingMe),
    mine: items.filter((f) => f.employeeId === userId),
    others: items.filter((f) => f.employeeId !== userId && !f.awaitingMe),
    canManage: roles.some((r) => MANAGE_ROLES.includes(r)),
    canViewAll: roles.some((r) => VIEW_ROLES.includes(r)),
  };
}

/**
 * What the Profile card and the Home reminder need: how many forms wait on the
 * caller, and whether the caller has any reason to open the section at all.
 * Never fails loudly — a broken count must not break Profile or Home.
 */
export async function getClearanceSummary(): Promise<{ awaiting: number; visible: boolean }> {
  const res = await listForms();
  if (!res.ok) return { awaiting: 0, visible: false };
  return {
    awaiting: res.items.filter((f) => f.awaitingMe).length,
    visible: res.items.length > 0 || res.roles.some((r) => VIEW_ROLES.includes(r)),
  };
}

export type ClearanceBalance = { leaveTypeId: string; nameFa: string; nameEn: string; minutes: number };

export type ClearanceDetail = {
  id: string;
  status: SeparationStatus;
  reason: SeparationReason;
  lastWorkingDay: string;
  hireDate: string | null;
  fatherName: string | null;
  birthCertNo: string | null;
  note: string | null;
  settlementDate: string | null;
  financeNote: string | null;
  financeSignedAt: string | null;
  financeSignedByName: string | null;
  deactivatedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  employee: {
    id: string;
    name: string;
    personnelNo: string | null;
    departmentId: string | null;
    departmentNameFa: string | null;
    departmentNameEn: string | null;
    active: boolean;
  };
  rows: SignoffRow[];
  balances: ClearanceBalance[];
};

type RawDetail = {
  id: string;
  status: SeparationStatus;
  reason: SeparationReason;
  last_working_day: string;
  hire_date: string | null;
  father_name: string | null;
  birth_cert_no: string | null;
  note: string | null;
  settlement_date: string | null;
  finance_note: string | null;
  finance_signed_at: string | null;
  finance_signed_by_name: string | null;
  deactivated_at: string | null;
  created_at: string;
  created_by_name: string | null;
  employee: {
    id: string;
    name: string;
    personnel_no: string | null;
    department_id: string | null;
    department_name_fa: string | null;
    department_name_en: string | null;
    active: boolean;
  };
  rows: Array<{
    id: string;
    is_hr: boolean;
    name_fa: string;
    name_en: string;
    department_id: string | null;
    signer_id: string | null;
    signer_name: string | null;
    sort_order: number;
    signed_by: string | null;
    signed_by_name: string | null;
    signed_at: string | null;
    note: string | null;
  }>;
};

export async function getClearance(
  id: string
): Promise<{ ok: true; form: ClearanceDetail; caller: { id: string; roles: string[] } } | Fail> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const [{ data, error }, { data: balances }] = await Promise.all([
    c.supabase.rpc('app_get_separation', { p_id: id }),
    c.supabase.rpc('app_separation_balances', { p_id: id }),
  ]);
  if (error) return dbErr(error.message);
  const r = data as unknown as RawDetail;

  return {
    ok: true,
    caller: { id: c.user.id, roles: c.roles },
    form: {
      id: r.id,
      status: r.status,
      reason: r.reason,
      lastWorkingDay: r.last_working_day,
      hireDate: r.hire_date,
      fatherName: r.father_name,
      birthCertNo: r.birth_cert_no,
      note: r.note,
      settlementDate: r.settlement_date,
      financeNote: r.finance_note,
      financeSignedAt: r.finance_signed_at,
      financeSignedByName: r.finance_signed_by_name,
      deactivatedAt: r.deactivated_at,
      createdAt: r.created_at,
      createdByName: r.created_by_name,
      employee: {
        id: r.employee.id,
        name: r.employee.name,
        personnelNo: r.employee.personnel_no,
        departmentId: r.employee.department_id,
        departmentNameFa: r.employee.department_name_fa,
        departmentNameEn: r.employee.department_name_en,
        active: r.employee.active,
      },
      rows: r.rows.map((o) => ({
        id: o.id,
        isHr: o.is_hr,
        nameFa: o.name_fa,
        nameEn: o.name_en,
        departmentId: o.department_id,
        signerId: o.signer_id,
        signerName: o.signer_name,
        sortOrder: o.sort_order,
        signedBy: o.signed_by,
        signedByName: o.signed_by_name,
        signedAt: o.signed_at,
        note: o.note,
      })),
      // Balances are informational (D13): a read failure leaves the section empty.
      balances: (balances ?? []).map((b) => ({
        leaveTypeId: b.leave_type_id,
        nameFa: b.name_fa,
        nameEn: b.name_en,
        minutes: b.balance_minutes,
      })),
    },
  };
}

/** One signature image, read through RLS only when someone asks to see it. */
export async function getClearanceSignature(
  kind: 'row' | 'finance',
  id: string
): Promise<{ ok: true; signatureData: string; consentAt: string } | Fail> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (kind === 'row') {
    const { data, error } = await c.supabase
      .from('separation_signoffs')
      .select('signature_data, signature_consent_at')
      .eq('id', id)
      .maybeSingle();
    if (error) return dbErr(error.message);
    if (!data?.signature_data || !data.signature_consent_at) return dbErr('request signature not found');
    return { ok: true, signatureData: data.signature_data, consentAt: data.signature_consent_at };
  }
  const { data, error } = await c.supabase
    .from('separations')
    .select('finance_signature_data, finance_signature_consent_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return dbErr(error.message);
  if (!data?.finance_signature_data || !data.finance_signature_consent_at) {
    return dbErr('request signature not found');
  }
  return { ok: true, signatureData: data.finance_signature_data, consentAt: data.finance_signature_consent_at };
}

export type PersonOption = { id: string; name: string; personnelNo: string | null; departmentId: string | null };
export type DepartmentOption = { id: string; nameFa: string; nameEn: string; managerId: string | null };

/** Pickers for the new-form, edit-rows and default-rows screens (admin / hr). */
export async function getClearanceSetup(): Promise<
  | {
      ok: true;
      people: PersonOption[];
      departments: DepartmentOption[];
      /** Active department managers only: an inactive one cannot sign. */
      departmentManagers: Record<string, string | null>;
      units: UnitRow[];
      callerId: string;
      callerIsAdmin: boolean;
    }
  | Fail
> {
  const c = await requireCaller({ anyOf: MANAGE_ROLES, company: true });
  if (!c.ok) return c;

  const [people, departments, units] = await Promise.all([
    c.supabase
      .from('profiles')
      .select('id, full_name, personnel_no, department_id')
      .eq('company_id', c.companyId)
      .eq('active', true)
      .order('full_name'),
    c.supabase
      .from('departments')
      .select('id, name_fa, name_en, manager_id')
      .eq('company_id', c.companyId)
      .order('name_fa'),
    c.supabase
      .from('separation_units')
      .select('id, kind, name_fa, name_en, department_id, signer_id, sort_order, active')
      .order('sort_order'),
  ]);
  if (people.error) return dbErr(people.error.message);
  if (departments.error) return dbErr(departments.error.message);
  if (units.error) return dbErr(units.error.message);

  const activeIds = new Set((people.data ?? []).map((p) => p.id));
  const departmentManagers: Record<string, string | null> = {};
  for (const d of departments.data ?? []) {
    departmentManagers[d.id] = d.manager_id && activeIds.has(d.manager_id) ? d.manager_id : null;
  }

  return {
    ok: true,
    callerId: c.user.id,
    callerIsAdmin: c.roles.includes('admin'),
    people: (people.data ?? []).map((p) => ({
      id: p.id,
      name: p.full_name,
      personnelNo: p.personnel_no,
      departmentId: p.department_id,
    })),
    departments: (departments.data ?? []).map((d) => ({
      id: d.id,
      nameFa: d.name_fa,
      nameEn: d.name_en ?? d.name_fa,
      managerId: d.manager_id,
    })),
    departmentManagers,
    units: (units.data ?? []).map((u) => ({
      id: u.id,
      kind: u.kind as UnitKind,
      nameFa: u.name_fa,
      nameEn: u.name_en,
      departmentId: u.department_id,
      signerId: u.signer_id,
      sortOrder: u.sort_order,
      active: u.active,
    })),
  };
}

export type LeaverWarnings = {
  pendingRequests: number;
  directReports: number;
  departmentsManaged: number;
  approvalSteps: number;
};

/** What the new-form screen fills in once a leaver is picked (D8, D12). */
export async function getLeaverPrefill(employeeId: string): Promise<
  | {
      ok: true;
      fatherName: string | null;
      birthCertNo: string | null;
      hireDate: string | null;
      warnings: LeaverWarnings;
    }
  | Fail
> {
  const c = await requireCaller({ anyOf: MANAGE_ROLES });
  if (!c.ok) return c;

  const [info, profile, warnings] = await Promise.all([
    c.supabase
      .from('employee_personal_info')
      .select('father_name, birth_cert_no')
      .eq('employee_id', employeeId)
      .maybeSingle(),
    c.supabase.from('profiles').select('hire_date').eq('id', employeeId).maybeSingle(),
    c.supabase.rpc('app_separation_warnings', { p_employee_id: employeeId }),
  ]);
  if (warnings.error) return dbErr(warnings.error.message);
  const w = (warnings.data ?? {}) as Record<string, number>;

  return {
    ok: true,
    fatherName: info.data?.father_name ?? null,
    birthCertNo: info.data?.birth_cert_no ?? null,
    hireDate: profile.data?.hire_date ?? null,
    warnings: {
      pendingRequests: Number(w.pending_requests ?? 0),
      directReports: Number(w.direct_reports ?? 0),
      departmentsManaged: Number(w.departments_managed ?? 0),
      approvalSteps: Number(w.approval_steps ?? 0),
    },
  };
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export type CreateClearanceInput = {
  employeeId: string;
  reason: SeparationReason;
  lastWorkingDay: string;
  fatherName: string | null;
  birthCertNo: string | null;
  note: string | null;
  rows: DraftRow[];
};

export async function createClearance(
  input: CreateClearanceInput
): Promise<{ ok: true; id: string } | Fail> {
  const c = await requireCaller({ anyOf: MANAGE_ROLES });
  if (!c.ok) return c;
  if (!isSeparationReason(input.reason)) return dbErr('invalid reason');
  if (!ISO_DATE.test(input.lastWorkingDay)) return dbErr('last working day is required');

  const { data, error } = await c.supabase.rpc('app_create_separation', {
    p_employee_id: input.employeeId,
    p_reason: input.reason,
    p_last_working_day: input.lastWorkingDay,
    p_father_name: clean(input.fatherName),
    p_birth_cert_no: clean(input.birthCertNo),
    p_note: clean(input.note),
    p_rows: rowsPayload(input.rows),
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true, id: data as string };
}

export async function updateClearance(
  id: string,
  input: { reason: SeparationReason; lastWorkingDay: string; note: string | null }
): Promise<Done> {
  const c = await requireCaller({ anyOf: MANAGE_ROLES });
  if (!c.ok) return c;
  if (!isSeparationReason(input.reason)) return dbErr('invalid reason');
  if (!ISO_DATE.test(input.lastWorkingDay)) return dbErr('last working day is required');

  const { error } = await c.supabase.rpc('app_update_separation', {
    p_id: id,
    p_reason: input.reason,
    p_last_working_day: input.lastWorkingDay,
    p_note: clean(input.note),
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function setClearanceRows(id: string, rows: DraftRow[]): Promise<Done> {
  const c = await requireCaller({ anyOf: MANAGE_ROLES });
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_set_separation_signoffs', {
    p_id: id,
    p_rows: rowsPayload(rows),
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function cancelClearance(id: string): Promise<Done> {
  const c = await requireCaller({ anyOf: MANAGE_ROLES });
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_cancel_separation', { p_id: id });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export type SignInput = { signatureData: string; signatureAuthorized: boolean; note: string | null };

function checkSignature(input: SignInput): string | null {
  if (!input.signatureAuthorized) return 'signature authorization is required';
  if (!input.signatureData) return 'signature is required';
  if (!isValidSignatureData(input.signatureData)) return 'signature data is invalid';
  return null;
}

export async function signClearanceRow(rowId: string, input: SignInput): Promise<Done> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const bad = checkSignature(input);
  if (bad) return dbErr(bad);

  const { error } = await c.supabase.rpc('app_sign_separation_row', {
    p_row_id: rowId,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
    p_note: clean(input.note),
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function signClearanceFinance(
  id: string,
  input: SignInput & { settlementDate: string | null }
): Promise<Done> {
  const c = await requireCaller({ anyOf: ['finance'] });
  if (!c.ok) return c;
  const bad = checkSignature(input);
  if (bad) return dbErr(bad);
  if (input.settlementDate && !ISO_DATE.test(input.settlementDate)) return dbErr('invalid date');

  const { error } = await c.supabase.rpc('app_sign_separation_finance', {
    p_id: id,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
    p_note: clean(input.note),
    p_settlement_date: input.settlementDate,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function saveClearanceUnits(units: UnitRow[]): Promise<Done> {
  const c = await requireCaller({ anyOf: MANAGE_ROLES });
  if (!c.ok) return c;
  const payload = [...units]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((u) => ({
      ...(u.id && !u.id.startsWith('new-') ? { id: u.id } : {}),
      kind: u.kind,
      name_fa: u.nameFa.trim(),
      name_en: u.nameEn.trim(),
      ...(u.kind === 'department' && u.departmentId ? { department_id: u.departmentId } : {}),
      ...(u.kind === 'person' && u.signerId ? { signer_id: u.signerId } : {}),
      active: u.active,
    }));
  const { error } = await c.supabase.rpc('app_save_separation_units', { p_units: payload });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

/** Every signature image of one form, for the printed sheet (RLS decides who may read). */
export async function getClearanceSignaturesForPrint(
  id: string
): Promise<{ ok: true; rows: Record<string, string>; finance: string | null } | Fail> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const [rows, form] = await Promise.all([
    c.supabase
      .from('separation_signoffs')
      .select('id, signature_data')
      .eq('separation_id', id)
      .not('signature_data', 'is', null),
    c.supabase.from('separations').select('finance_signature_data').eq('id', id).maybeSingle(),
  ]);
  if (rows.error) return dbErr(rows.error.message);
  if (form.error) return dbErr(form.error.message);
  return {
    ok: true,
    rows: Object.fromEntries((rows.data ?? []).map((r) => [r.id, r.signature_data as string])),
    finance: form.data?.finance_signature_data ?? null,
  };
}
