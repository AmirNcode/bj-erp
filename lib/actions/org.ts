'use server';

import { requireCaller } from '@/lib/auth/context';
import { dbErr } from '@/lib/errors/db-error';
import type { OrgPerson } from '@/lib/org/tree';

/**
 * Every active colleague with their manager link, for the Organization tab
 * (FR-44). Any signed-in user: `get_org_chart()` is SECURITY DEFINER and
 * returns names, titles, departments and reporting lines only.
 */
export async function getOrgChart(): Promise<
  { ok: true; people: OrgPerson[]; myId: string } | { ok: false; error: string }
> {
  const c = await requireCaller();
  if (!c.ok) return c;

  const { data, error } = await c.supabase.rpc('get_org_chart');
  if (error) return dbErr(error.message);

  return {
    ok: true,
    myId: c.user.id,
    people: (data ?? []).map((r) => ({
      id: r.profile_id,
      fullName: r.full_name,
      jobTitle: r.job_title,
      departmentId: r.department_id,
      departmentNameFa: r.department_name_fa,
      departmentNameEn: r.department_name_en,
      managerId: r.manager_id,
      isDepartmentManager: r.is_department_manager,
    })),
  };
}
