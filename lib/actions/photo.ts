'use server';

/**
 * Profile photos (FR-82). Everything goes through the app_*profile_photo* functions; the table is
 * in schema private. The image itself is served by app/api/photo/[id] so it never rides in page
 * payloads or polls.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { isValidPhotoData } from '@/lib/photo/process';

export type PhotoInfo = { version: number; locked: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** version + lock for one person, or null when they have no photo. */
export async function getPhotoInfo(employeeId: string): Promise<{ ok: true; photo: PhotoInfo | null } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!UUID_RE.test(employeeId)) return dbErr('employee not found');
  const { data, error } = await c.supabase.rpc('app_profile_photo_versions', { p_ids: [employeeId] });
  if (error) return dbErr(error.message);
  const row = data?.[0];
  return { ok: true, photo: row ? { version: row.version, locked: row.locked } : null };
}

/** Photo versions for the people on one screen. Ids without a photo are absent. */
export async function getPhotoVersions(
  employeeIds: string[]
): Promise<{ ok: true; versions: Record<string, number> } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const ids = [...new Set(employeeIds.filter((id) => UUID_RE.test(id)))].slice(0, 2000);
  if (ids.length === 0) return { ok: true, versions: {} };
  const { data, error } = await c.supabase.rpc('app_profile_photo_versions', { p_ids: ids });
  if (error) return dbErr(error.message);
  return { ok: true, versions: Object.fromEntries((data ?? []).map((r) => [r.employee_id, r.version])) };
}

export async function setProfilePhoto(input: {
  employeeId: string;
  photoData: string;
  /** HR / admin only; ignored by the database for one's own photo. */
  locked?: boolean;
}): Promise<{ ok: true; version: number } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!UUID_RE.test(input.employeeId)) return dbErr('employee not found');
  if (!isValidPhotoData(input.photoData)) return dbErr('photo data is invalid');
  const { data, error } = await c.supabase.rpc('app_set_profile_photo', {
    p_employee: input.employeeId,
    p_data: input.photoData,
    p_locked: typeof input.locked === 'boolean' ? input.locked : null,
  });
  if (error) return dbErr(error.message);
  return { ok: true, version: Number(data) };
}

export async function setProfilePhotoLock(input: {
  employeeId: string;
  locked: boolean;
}): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!UUID_RE.test(input.employeeId)) return dbErr('employee not found');
  const { error } = await c.supabase.rpc('app_set_profile_photo_lock', {
    p_employee: input.employeeId,
    p_locked: input.locked,
  });
  if (error) return dbErr(error.message);
  return { ok: true };
}

export async function removeProfilePhoto(employeeId: string): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!UUID_RE.test(employeeId)) return dbErr('employee not found');
  const { error } = await c.supabase.rpc('app_remove_profile_photo', { p_employee: employeeId });
  if (error) return dbErr(error.message);
  return { ok: true };
}
