/** Admin › View as (FR-86): the picker's roster. Pure. */
import type { PersonSearchOption } from '@/components/PersonSearch';
import { subtitleRole, type BuiltInRole } from '@/lib/auth/roleSubtitle';

type ProfileRow = { id: string; full_name: string; personnel_no: string | null };
/** `role` is set for built-in roles; custom roles have it null and carry their name in `roles`. */
type RoleRow = { user_id: string; role: string | null; roles?: { name: string } | null };

/** Each person with their most senior role as a hint, so two people with one name can be told apart. */
export function buildViewAsPeople(
  profiles: ProfileRow[],
  roleRows: RoleRow[],
  roleName: (r: BuiltInRole) => string
): PersonSearchOption[] {
  const byUser = new Map<string, { builtIn: string[]; custom: { name: string; permissions: Record<string, never> }[] }>();
  for (const r of roleRows) {
    const entry = byUser.get(r.user_id) ?? { builtIn: [], custom: [] };
    if (r.role) entry.builtIn.push(r.role);
    else if (r.roles?.name) entry.custom.push({ name: r.roles.name, permissions: {} });
    byUser.set(r.user_id, entry);
  }
  return profiles.map((p) => {
    const roles = byUser.get(p.id) ?? { builtIn: [], custom: [] };
    const top = subtitleRole(roles.builtIn, roles.custom);
    return {
      id: p.id,
      name: p.full_name,
      personnelNo: p.personnel_no,
      hint: 'builtIn' in top ? roleName(top.builtIn) : top.custom,
    };
  });
}
