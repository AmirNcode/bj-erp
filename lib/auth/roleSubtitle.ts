/**
 * The role named under the person's name in the side panel (FR-55: the subtitle uses
 * role names). Pure.
 */

import { levelValue, type PermKey, type Perms } from '@/lib/permissions/catalog';

/** Most senior first. The `roles` messages hold the English built-in names in both locales (D11). */
export const ROLE_PRIORITY = ['admin', 'hr', 'finance', 'manager', 'security', 'employee'] as const;
export type BuiltInRole = (typeof ROLE_PRIORITY)[number];

const weight = (perms: Perms) =>
  (Object.keys(perms) as PermKey[]).reduce((sum, k) => sum + levelValue(perms[k]), 0);

/**
 * The most senior built-in role held, other than Employee; else the custom role with the
 * most access (ties by name); else Employee.
 */
export function subtitleRole(
  roles: string[],
  custom: { name: string; permissions: Perms }[]
): { builtIn: BuiltInRole } | { custom: string } {
  const top = ROLE_PRIORITY.find((r) => r !== 'employee' && roles.includes(r));
  if (top) return { builtIn: top };
  const best = [...custom].sort((a, b) => weight(b.permissions) - weight(a.permissions) || a.name.localeCompare(b.name))[0];
  return best ? { custom: best.name } : { builtIn: 'employee' };
}
