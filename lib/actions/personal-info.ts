'use server';

/**
 * Personal information (FR-53). RLS on employee_personal_info is the boundary:
 * the owner, plus hr/admin of the company (hr read-only on an admin). These
 * actions validate first so the person sees every problem per field, then let
 * the database decide.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import {
  PERSONAL_INFO_FIELDS,
  parsePersonalInfoForm,
  type FieldProblem,
  type PersonalInfoKey,
  type PersonalInfoValues,
} from '@/lib/personal-info/fields';
import type { PersonalInfoImportRow } from '@/lib/personal-info/csv';
import type { Database, Json } from '@/lib/supabase/types';

const COLUMNS = PERSONAL_INFO_FIELDS.map((f) => f.key).join(', ');

export type PersonalInfoRecord = PersonalInfoValues & { complete: boolean; updatedAt: string };

export async function getPersonalInfo(
  employeeId: string
): Promise<{ ok: true; info: PersonalInfoRecord } | { ok: false; error: string }> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase
    .from('employee_personal_info')
    .select(`${COLUMNS}, complete, updated_at`)
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (error) return dbErr(error.message);
  if (!data) return dbErr('not permitted to view personal info');
  const { updated_at, ...rest } = data as unknown as PersonalInfoValues & {
    complete: boolean;
    updated_at: string;
  };
  return { ok: true, info: { ...rest, updatedAt: updated_at } };
}

export type SavePersonalInfoResult =
  | { ok: true; complete: boolean }
  | { ok: false; error: string; problems?: Partial<Record<PersonalInfoKey, FieldProblem>> };

/** `input` is the form's text per field (Persian digits, Jalali dates welcome). */
export async function savePersonalInfo(
  employeeId: string,
  input: Partial<Record<PersonalInfoKey, string>>
): Promise<SavePersonalInfoResult> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { values, problems } = parsePersonalInfoForm(input);
  if (Object.keys(problems).length > 0) {
    const err = await dbErr('personal info is invalid');
    return { ...err, problems };
  }

  const { data, error } = await c.supabase
    .from('employee_personal_info')
    .update(values)
    .eq('employee_id', employeeId)
    .select('complete');
  if (error) return dbErr(error.message);
  // RLS hides a row the caller may not edit: zero rows, no error.
  if (!data || data.length !== 1) return dbErr('personal info was not saved');
  return { ok: true, complete: data[0].complete };
}

export type PersonalInfoExportRow =
  Database['public']['Functions']['app_export_personal_info']['Returns'][number];

/** Everyone's personal info for the CSV download. Audit-logged in the database. */
export async function exportPersonalInfo(): Promise<
  { ok: true; rows: PersonalInfoExportRow[] } | { ok: false; error: string }
> {
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_export_personal_info');
  if (error) return dbErr(error.message);
  return { ok: true, rows: data ?? [] };
}

/** Personnel numbers the caller may import onto (hr: everyone but admins). */
export async function getImportablePersonnelNos(): Promise<
  { ok: true; personnelNos: string[] } | { ok: false; error: string }
> {
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;

  const [{ data: profiles, error }, { data: admins, error: rolesError }] = await Promise.all([
    c.supabase.from('profiles').select('id, personnel_no').not('personnel_no', 'is', null),
    c.supabase.from('user_roles').select('user_id').eq('role', 'admin'),
  ]);
  if (error) return dbErr(error.message);
  if (rolesError) return dbErr(rolesError.message);
  const adminIds = new Set((admins ?? []).map((r) => r.user_id));
  const isAdmin = c.roles.includes('admin');
  return {
    ok: true,
    personnelNos: (profiles ?? [])
      .filter((p) => isAdmin || !adminIds.has(p.id))
      .map((p) => p.personnel_no as string),
  };
}

export async function importPersonalInfo(
  rows: PersonalInfoImportRow[]
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const c = await requireCaller({ anyOf: ['admin', 'hr'] });
  if (!c.ok) return c;
  if (rows.length === 0) return dbErr('no rows to import');

  const { data, error } = await c.supabase.rpc('app_import_personal_info', {
    p_rows: rows as unknown as Json,
  });
  if (error) return dbErr(error.message);
  return { ok: true, updated: Number((data as { updated?: number } | null)?.updated ?? 0) };
}
