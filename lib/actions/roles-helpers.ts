/**
 * Pure helpers for the role actions (FR-55). No Supabase imports — safe to unit
 * test, and kept out of `roles.ts` because a 'use server' file may export only
 * async functions.
 */

import { parsePermsClaim, type Perms } from '@/lib/permissions/catalog';

export type RoleKind = 'system' | 'preset' | 'custom';

export type RoleRow = {
  id: string;
  systemKey: string | null;
  kind: RoleKind;
  name: string;
  holders: number;
  permissions: Perms;
};

/** One row of `app_list_roles()`. */
export type RawRoleRow = {
  id: string;
  system_key: string | null;
  kind: string;
  name: string;
  holders: number;
  permissions: unknown;
};

/** Maps a raw `app_list_roles` row; unknown permission keys and levels are dropped. */
export function toRoleRow(raw: RawRoleRow): RoleRow {
  const kind: RoleKind = raw.kind === 'system' || raw.kind === 'preset' ? raw.kind : 'custom';
  return {
    id: raw.id,
    systemKey: raw.system_key,
    kind,
    name: raw.name,
    holders: Number(raw.holders),
    permissions: parsePermsClaim(raw.permissions) ?? {},
  };
}
